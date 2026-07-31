# S7 — Récolte catalogue complète (angles morts levés)

- **Accès** : API Management Supabase, jeton personnel fourni le 2026-07-31.
- **Base** : PostgreSQL **17.6**, projet `bbzcuzqfgsdvjsymfwmr` (production).
- **Méthode** : `SELECT` sur `pg_catalog` / `information_schema` uniquement.
  L'outil utilisé refuse toute requête contenant un mot-clé d'écriture sauf
  `ALLOW_WRITE=1` explicite.

Ce fichier lève les 10 angles morts listés dans `AUDIT_FINDINGS.md §4`.

---

## 1. Corrections apportées à l'audit préparatoire

**Quatre constats de l'audit préparatoire étaient FAUX.** Ils venaient de
`supabase/complete_schema.sql`, périmé de 121 migrations. Le catalogue réel les
dément :

| Constat préparatoire | Réalité en base | Verdict |
|---|---|---|
| « Vues sans `security_invoker` — vecteur de contournement RLS » | **0 vue concernée** | ❌ Faux — corrigé depuis |
| « `search_path` non figé sur certaines `SECURITY DEFINER` » | **0 fonction sans `search_path`** | ❌ Faux — 100 % figées |
| « Contraintes laissées `NOT VALID` après le durcissement » | **0 contrainte `NOT VALID`** | ❌ Faux — toutes validées |
| « Tables sans clé primaire » | **0 table** | ❌ Faux |

Ajouté à la vérification de `postgres.rolbypassrls` et aux tests d'isolation
(§4), cela veut dire que **le durcissement du 30 juillet est réellement en
place en base**, contrairement à ce que laissait craindre la lecture du source.

---

## 2. Preuve définitive du P0-1 (avant correctif)

Obtenue par `pg_proc`, plus aucune déduction :

```
proname          : list_archived_items
owner            : postgres
security_definer : true
grants           : postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
garde_membership : false      ← aucun has_org_membership dans le corps
utilise_auth_uid : false      ← AUCUNE logique d'autorisation, même pas auth.uid()
```

Et le maillon qui ferme le raisonnement :

```
rolname        rolbypassrls   rolsuper
postgres       true           false      ← la RLS ne s'applique PAS dans le corps
service_role   true           false
authenticated  false          false
anon           false          false
```

Le commentaire de `20260751101400_secdef_least_privilege.sql:164`
(« filtre par RLS en interne (verifie : 0 fuite) ») était donc **factuellement
faux** : la fonction appartient à `postgres`, qui contourne la RLS.

---

## 3. Findings nouveaux issus du catalogue

### 3.1 — Fonctions `SECURITY DEFINER` prenant l'org en paramètre, sans garde (P1)

15 candidates détectées, **triées une par une**. 5 sont les fonctions de garde
elles-mêmes (`has_org_membership` ×2, `has_org_admin_role`, `has_org_role`,
`verify_org_access`, `has_object_permission`) — normal qu'elles ne se gardent
pas. Restent :

| Fonction | Effet | Garde ? | Sévérité |
|---|---|---|---|
| `create_minimal_job_for_deal(p_org_id, …)` | `insert into jobs` dans l'org **passée en paramètre** | **AUCUNE** | **P1** |
| `record_consent(…, p_org_id)` | `insert into consents` dans l'org passée en paramètre | **AUCUNE** | **P1** — falsification de registre de consentement (Loi 25) |
| `create_lead_quick(…, p_org_id)` | création de lead | aucun mécanisme de refus | **P1 — à confirmer** |
| `crm_next_invoice_number(p_org_id)` | **incrémente** la séquence de facturation d'une org arbitraire | pas de garde d'org | **P2** — permet de brûler/décaler la numérotation d'un tiers |
| `check_subscription_active(p_org_id)` | booléen | — | P3 — oracle sur l'abonnement d'un tiers |
| `hard_delete_client(p_org_id, p_client_id)` | suppression en cascade | ✅ **PROTÉGÉE** par délégation | — |

> `hard_delete_client` ne fait que 86 caractères : elle délègue à
> `delete_client_cascade(p_org_id, p_client_id, auth.uid())`, qui **contient**
> la garde `IF v_uid IS NOT NULL AND NOT has_org_admin_role(v_uid, p_org…)`.
> C'est exactement le motif qui avait produit les 7 faux positifs : **toujours
> remonter dans la fonction appelée avant de conclure.**

### 3.2 — Policies (P1/P2)

| Constat | Nombre |
|---|---|
| Policies avec `USING (true)` ou `WITH CHECK (true)` | **22** |
| Policies `INSERT`/`UPDATE`/`ALL` **sans** `WITH CHECK` | **16** |

Une policy d'écriture sans `WITH CHECK` laisse déplacer une ligne vers une autre
organisation. Le durcissement du 30 juillet en avait corrigé 49 ; il en reste 16.
**À examiner une par une avant tout correctif** — certaines sont légitimes
(tables sans `org_id`, ou policies `SELECT` élargies volontairement).

### 3.3 — Surface et divers

| Constat | Valeur | Lecture |
|---|---|---|
| Tables du schéma `public` avec un `GRANT` à `anon` | **223** | La RLS est la seule barrière pour toutes. Testé sur 35 : elle tient. |
| Tables publiées en **Realtime** | **15** | À revoir : Realtime respecte la RLS, mais élargit la surface |
| Clés étrangères **sans index** | **6** | Scan complet à chaque suppression du parent |
| Extensions installées | 10 | À vérifier : schéma d'installation |

---

## 4. Correctif P0-1 — APPLIQUÉ ET VÉRIFIÉ

**Appliqué le 2026-07-31 à 02:20 UTC** sur la production.

**Méthode sûre** : le corps a été **lu depuis `pg_proc.prosrc`** puis réécrit
avec la garde insérée après le `BEGIN`. Aucune transcription manuelle, donc
aucun risque de diverger du code réellement déployé (précaution justifiée : la
base a dérivé du dépôt, cf. `has_org_role` absente des migrations).

Garde ajoutée :

```sql
if auth.uid() is not null
   and not public.has_org_membership(auth.uid(), p_org_id) then
  raise exception 'Not authorized for this organization.' using errcode = '42501';
end if;
```

`auth.uid()` NULL (appel serveur `service_role`) passe volontairement, pour ne
rien casser côté serveur — motif déjà retenu ailleurs dans le schéma.

### Vérification par exécution, en transaction annulée

| Test | Attendu | Obtenu | Verdict |
|---|---|---|---|
| Utilisateur authentifié **non membre** de l'org ciblée | refus | `ERROR 42501: Not authorized for this organization.` | ✅ |
| **Membre légitime** sur sa propre org | résultat normal | `{clients, leads, jobs}` | ✅ |

État après écriture : `garde_presente: true`, grants **inchangés**
(`authenticated` conserve `EXECUTE`, la fonctionnalité Archives continue de
marcher), `search_path = public, pg_temp`, corps 2 038 caractères.

**Rollback** : réappliquer le corps sans le bloc de garde. Le corps d'origine
(1 463 caractères) est reconstituable depuis
`20260705000000_eliminate_leads_table.sql:739-781`.

⚠️ **Ce correctif a été appliqué directement en base, hors du système de
migrations.** Il faut le consigner dans une migration pour qu'il survive à un
`db reset` — sinon il aggrave la dérive constatée en P2-2.

---

## 4.bis Deuxième vague de correctifs — APPLIQUÉE le 2026-07-31 à 02:36 UTC

### Policies : 0 vulnérabilité réelle (correction d'un constat antérieur)

Les 583 policies ont été relues. **Les 22 en `USING (true)` et les 16 sans
`WITH CHECK` sont toutes bénignes** :

- 21 des 22 policies `true` sont `roles={service_role}` — or `service_role`
  contourne déjà la RLS, elles ne changent donc rien. La 22ᵉ est
  `plans_public_read`, la table tarifaire publique assumée.
- Sur les 16 sans `WITH CHECK` : **point de sémantique PostgreSQL déterminant** —
  pour une policy `UPDATE` ou `ALL`, si `WITH CHECK` est absent, **l'expression
  `USING` sert aussi à valider la nouvelle ligne**. Il n'y a donc pas de trou.
  Le reste du lot est soit `USING false` (refus explicite : `audit_events`,
  `login_history`, `data_export_log`, `webhook_events` — bon design), soit
  réservé à `service_role`.

**Aucun correctif de policy n'était nécessaire.**

### Fonctions : 3 droits retirés

Retrait de `EXECUTE` à `authenticated` sur `create_minimal_job_for_deal`,
`record_consent` et `crm_next_invoice_number`. Choix du **revoke plutôt que
d'une garde dans le corps** : aucune n'est appelée depuis le navigateur, et
leurs appelants SQL sont tous `SECURITY DEFINER` propriété de `postgres` — leur
corps s'exécute donc avec les droits de postgres, indépendamment de ceux de
l'appelant. Le changement le moins risqué possible : zéro ligne de logique
métier touchée. Consigné dans `20260751102200`.

**Vérifié par exécution** : un utilisateur authentifié appelant directement
`create_minimal_job_for_deal` reçoit `ERROR 42501: permission denied`.

### Deux candidats écartés après vérification

| Fonction | Verdict |
|---|---|
| `create_client_and_deal` | **Protégée** — garde via `current_org_id()`. Ma détection initiale ne cherchait pas ce motif. |
| `create_lead_quick` | **Non exploitable** — la table `leads` **n'existe plus** (supprimée par `eliminate_leads_table`). La fonction insère dans `contacts` puis échoue sur `leads`, et l'erreur annule la transaction. Fonction morte, à supprimer par hygiène. |

### Bug fonctionnel découvert (hors périmètre sécurité)

`create_minimal_client_for_deal()` est **cassée en production** :
`cols text[] := array[]::text[]` puis `cols := cols || 'org_id'` →
PostgreSQL résout vers `anyarray || anyarray` et échoue avec
`22P02: malformed array literal: "org_id"`.

Conséquence : `create_client_and_deal()` échoue systématiquement, ainsi que
`create_lead_and_deal()` et `create_deal_with_job()`. Impact réel nul
aujourd'hui — aucun appelant applicatif (0 occurrence dans `src/` et `server/`).
Documenté dans la migration, non corrigé (décision produit : réparer ou supprimer).

### Advisors Supabase

| Advisor | Constat notable |
|---|---|
| Security | **112 fonctions `SECURITY DEFINER` appelables par `authenticated`** — la famille du P0. Les 4 traitées ici en font partie ; **les 108 autres n'ont pas été auditées une par une.** |
| Security | 4 fonctions à `search_path` mutable (`leads_force_org_id`, `leads_set_user_id`, `_point_in_zone_ring`, `ac_fmt_dollars`) |
| Security | `pg_net` installée dans le schéma `public` ; `security_canary_runs` sans policy (intentionnel) |
| Performance | **427 index jamais utilisés**, 14 FK sans index, 45 policies permissives multiples, 12 `auth_rls_initplan` non optimisées, 1 index dupliqué |

---

## 4.ter Troisième vague — les 109 `SECURITY DEFINER` triées une par une

L'advisor signalait 112 fonctions `SECURITY DEFINER` appelables par
`authenticated` (109 au moment du tri). **Toutes ont été classées.**

| Catégorie | Nombre |
|---|---|
| Possèdent déjà un motif d'autorisation | **95** |
| Ne touchent aucune table (utilitaires purs) | **4** |
| Sans aucune garde | **10** |
| — dont primitives de garde elles-mêmes (normal) | 5 |
| — **cas réels traités** | **5** |

### Les 5 cas réels

| Fonction | Traitement | Raison |
|---|---|---|
| `rpc_recalculate_quote(p_quote_id)` | **Garde dans le corps** | **Appelée par le navigateur** (`src/lib/quotesApi.ts:345`, `:552`) — un revoke aurait cassé l'édition de devis |
| `resolve_primary_property(p_client_id)` | Revoke | 0 appelant applicatif ; ses 2 appelants sont des triggers `SECURITY DEFINER` postgres |
| `user_org_ids(p_user_id)` | Revoke | 0 référence nulle part |
| `same_company_orgs(p_user)` | Revoke | 0 référence nulle part |
| `check_subscription_active(p_org_id)` | Revoke | 0 référence nulle part |

**`rpc_recalculate_quote` est la sœur de `list_archived_items`** :
`20260751101400` les avait épargnées **toutes les deux**, sur le même
raisonnement erroné. Elle **écrit** — elle recalcule subtotal, remise, taxes et
total d'un devis désigné par un simple UUID. Tout compte authentifié pouvait
donc écraser les montants du devis d'une autre organisation.

**Vérification obligatoire avant chaque revoke** : contrôler qu'aucune **policy
RLS** n'utilise la fonction. Les expressions de policy s'évaluent avec les
privilèges de l'utilisateur courant ; révoquer une fonction employée dans une
policy aurait cassé l'évaluation de cette policy — donc l'accès à la table.
Résultat du contrôle : 0 policy concernée sur les 4.

**Vérifié par exécution** : non-membre → `42501 Not authorized for this quote.` ;
membre légitime → passe sans exception.

### État final des 9 fonctions traitées

| Fonction | `authenticated` | Garde |
|---|---|---|
| `list_archived_items` | conservé | ✅ |
| `rpc_recalculate_quote` | conservé | ✅ |
| `create_minimal_job_for_deal` | **retiré** | — |
| `record_consent` | **retiré** | — |
| `crm_next_invoice_number` | **retiré** | — |
| `resolve_primary_property` | **retiré** | — |
| `user_org_ids` | **retiré** | — |
| `same_company_orgs` | **retiré** | — |
| `check_subscription_active` | **retiré** | — |

Les deux qui conservent l'accès sont exactement celles dont le navigateur a
besoin ; elles sont désormais gardées.

> **Incident de méthode évité de justesse** : la migration `20260751102300` a
> d'abord été rédigée **à la main** à partir d'une lecture partielle du corps.
> La comparaison au `prosrc` réel a révélé des `coalesce()` ajoutés par erreur.
> La migration a été **régénérée à partir du corps exact lu en base**.
> Règle : ne jamais retranscrire un corps de fonction, toujours le lire.

---

## 5. Ce qui reste non vérifié

- **Advisors Supabase Security & Performance** — non récupérés (endpoint distinct).
- **Isolation authentifiée cross-org à grande échelle (S5)** — les deux tests du
  §4 sont une preuve ponctuelle sur une seule fonction, pas la campagne complète
  sur les 229 tables et 203 RPC.
- **Les 22 policies `true` et les 16 sans `WITH CHECK`** — comptées, pas encore
  analysées une par une.
- **`create_lead_quick`** — absence de garde à confirmer par lecture du corps.
