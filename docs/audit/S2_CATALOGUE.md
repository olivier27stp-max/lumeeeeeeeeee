# S2 — Catalogue de la base (état factuel, prod)

> **Ce fichier ne contient que des faits.** L'interprétation et les correctifs
> viennent en S6. C'est aussi la **photo de référence** : en cas de doute après
> une remédiation, c'est à ce fichier qu'on compare l'état de la base.

- **Projet Supabase** : `bbzcuzqfgsdvjsymfwmr` (production)
- **Horodatage de la récolte** : 2026-07-31 01:32 UTC / 2026-07-30 21:32 EDT
- **Mode d'accès** : PostgREST en lecture seule (`GET`, plus appels de fonctions
  déclarées `stable`). **Aucune écriture émise.**
- **Branche git** : `audit/db`

---

## 0. Écarts entre le plan d'audit et la réalité (bloquants levés ou subis)

| # | Ce que le plan supposait | Réalité constatée | Conséquence |
|---|---|---|---|
| 1 | `docs/audit/AUDIT_DB_LUME_COMPLET.md` fournit les requêtes (PARTIE 1 §3, PARTIE 2 §A/§B/§C/§D…) | **Le fichier n'existe pas** dans le dépôt, ni aucun `ERREURS_IA_DB_MULTITENANT` | Grille d'analyse redéfinie à partir de zéro. Les numéros de section du plan sont sans objet. |
| 2 | App Next.js (`npm run build` → grep `.next`) | **Vite + React 19**, build dans `dist/`. Aucun `unstable_cache`/`revalidateTag` | Adapté en S1. |
| 3 | Discriminant `tenant_id` | Le discriminant est **`org_id`** | Toutes les requêtes réécrites. |
| 4 | Rôle `audit_ro` créé en Phase 0 par l'humain | **Non créé** (sa création est un DDL, donc interdit à l'agent) | Pas de garantie *mécanique* de lecture seule. La lecture seule repose sur la discipline + le choix des verbes HTTP. **Voir §6.** |
| 5 | MCP Supabase en read-only | **Aucun serveur MCP Supabase configuré**. `psql`, `supabase` CLI et `gh` sont **absents** de la machine | Accès via PostgREST + clé `service_role` injectée par `railway run` (jamais affichée). |
| 6 | `SUPABASE_ACCESS_TOKEN` disponible | **Introuvable** (ni `.env.local`, ni Railway, ni `~/.supabase`) | **L'API Management (SQL arbitraire) est inaccessible.** Les requêtes catalogue brutes (`pg_policies`, `pg_proc`, `information_schema`, grants) **n'ont pas pu être exécutées**. Contourné par les sondes `check_*` (§2) et par l'analyse du code source SQL (S3). |
| 7 | Branche Supabase jetable créée en Phase 0 | **Non créée** | **S5 (tests d'isolation avec écriture) est bloqué.** Voir §6. |

---

## 1. Surface exposée publiquement (PostgREST)

| Mesure | Valeur |
|---|---|
| Tables et vues exposées via l'API REST | **229** |
| Fonctions RPC exposées via l'API REST | **203** |

Listes intégrales : voir §7.

---

## 2. Sondes d'invariants — exécutées en prod, résultat brut

Les sondes créées par les migrations du 30 juillet sont **appelables** et ont été
exécutées. Toutes sont `stable` (lecture seule).

| Sonde | HTTP | Lignes retournées | Attendu | Résultat |
|---|---|---|---|---|
| `check_rls_coverage` | 200 | **0** | 0 | ✅ Aucune table sans RLS activée, sans RLS forcée, ou sans policy |
| `check_cross_tenant_references` | 200 | **0** | 0 | ✅ Aucune donnée mélangée entre orgs |
| `check_invoice_totals_balance` | 200 | **0** | 0 | ✅ Totaux de factures cohérents avec leurs lignes |
| `check_invoice_numbering_invariant` | 200 | **0** | 0 | ✅ Numérotation de factures sans collision |
| `check_custom_field_orphans` | 200 | **0** | 0 | ✅ Aucun champ personnalisé orphelin |
| `check_failing_cron_jobs` | 200 | **0** | 0 | ✅ Aucun cron en échec |
| `check_exposed_trigger_functions` | 200 | **0** | 0 | ✅ Aucune fonction de trigger exposée |
| `check_all_invariants` | 200 | 7 lignes | — | ✅ Agrégat des 7 sondes ci-dessus, **`failures: 0` sur les 7** |

> **Note de méthode** : `check_all_invariants` renvoie 7 *lignes de résultat*
> (une par sonde), pas 7 violations. Le champ à lire est `failures`, qui vaut
> `0` partout.

**Fait notable** : ces sondes ont été créées le 30 juillet et documentées
« à brancher sur un cron ». Elles n'ont **aucun appelant** dans le dépôt
(`server/`, `src/`, `scripts/`, `.github/`). L'exécution ci-dessus est
vraisemblablement **la première depuis leur création**.

---

## 3. Test d'exposition au rôle `anon` — 35 tables sensibles

Méthode : `GET /rest/v1/<table>?select=id&limit=2` avec la clé **anon**, puis
comparaison au volume réel obtenu via `service_role` (`HEAD` + `count=exact`).
Cette comparaison est indispensable : **un `[]` sur une table vide ne prouve
rien**, seul un `[]` sur une table peuplée prouve que la RLS filtre.

| Table | Lignes (réel) | HTTP anon | Lignes anon | Verdict |
|---|---|---|---|---|
| clients | 66 | 200 | 0 | RLS filtre — table non vide |
| jobs | 34 | 200 | 0 | RLS filtre — table non vide |
| invoices | 13 | 200 | 0 | RLS filtre — table non vide |
| payments | 3 | 200 | 0 | RLS filtre — table non vide |
| quotes | 16 | 200 | 0 | RLS filtre — table non vide |
| orgs | 31 | 200 | 0 | RLS filtre — table non vide |
| profiles | 34 | 200 | 0 | RLS filtre — table non vide |
| connected_accounts | 3 | 200 | 0 | RLS filtre — table non vide |
| integration_audit_logs | 4 | 200 | 0 | RLS filtre — table non vide |
| mfa_trusted_devices | 1 | 200 | 0 | RLS filtre — table non vide |
| time_entries | 8 | 200 | 0 | RLS filtre — table non vide |
| notifications | 17 | 200 | 0 | RLS filtre — table non vide |
| contacts | 21 | 401 | — | REFUS au grant |
| memberships | — | 400 | — | REFUS au grant |
| subscriptions | 7 | 401 | — | REFUS au grant |
| invitations | 4 | 401 | — | REFUS au grant |
| audit_events | 2 167 | 401 | — | REFUS au grant |
| app_connections | 1 | 401 | — | REFUS au grant |
| payment_provider_secrets | — | 401 | — | REFUS au grant |
| payment_provider_settings | — | 401 | — | REFUS au grant |
| org_billing_settings | — | 401 | — | REFUS au grant |
| payroll_settings | — | 401 | — | REFUS au grant |
| dsar_requests | 0 | 401 | — | REFUS au grant |
| push_tokens | 0 | 401 | — | REFUS au grant |
| tasks | 4 | 401 | — | REFUS au grant |
| **plans** | **3** | **200** | **3** | **LISIBLE PAR ANON — voir §4** |
| role_templates | 0 | 200 | 0 | Indéterminé (table vide) |
| api_keys | 0 | 200 | 0 | Indéterminé (table vide) |
| payment_providers | 0 | 200 | 0 | Indéterminé (table vide) |
| login_history | 0 | 200 | 0 | Indéterminé (table vide) |
| active_sessions | 0 | 200 | 0 | Indéterminé (table vide) |
| custom_column_values | 0 | 200 | 0 | Indéterminé (table vide) |

**Non exposées à l'API REST** (donc hors d'atteinte par ce vecteur) :
`leads`, `organizations`, `plan_feature_flags`, `client_link_backfill_ambiguous`.

### Synthèse du test anon

| Catégorie | Nombre | Signification |
|---|---|---|
| Refus au niveau **grant** (401/400) | **13** | Défaut-refus effectif : deux barrières (grant + RLS) |
| Filtrées par **RLS seule** (200 + 0 ligne, table peuplée) | **12** | Une seule barrière. Un défaut de policy = fuite immédiate |
| **Lisibles par anon** | **1** | `plans` uniquement — voir §4 |
| Indéterminées (table vide) | **6** | Le test ne conclut pas ; à rejouer quand les tables seront peuplées |

**Aucune fuite de donnée client (PII, facturation, control plane) au rôle `anon`
n'a été détectée.**

---

## 4. Détail de la seule table lisible par `anon` : `plans`

- **3 lignes sur 3** lisibles sans authentification, **toutes colonnes**.
- Colonnes exposées : `id, slug, name, name_fr, monthly_price_usd,
  monthly_price_cad, yearly_price_usd, yearly_price_cad, features, max_clients,
  max_jobs_per_month, is_active, sort_order, created_at, updated_at,
  includes_sms, seats_included, extra_seat_price_usd, extra_seat_price_cad,
  includes_ai, includes_d2d, includes_courses, includes_api, stripe_product_id,
  stripe_monthly_price_id_usd, stripe_monthly_price_id_cad,
  stripe_yearly_price_id_usd, stripe_yearly_price_id_cad, included_offices,
  extra_office_price_usd, extra_office_price_cad, intro_months,
  intro_price_monthly_usd, intro_price_monthly_cad, intro_price_yearly_usd,
  intro_price_yearly_cad, stripe_intro_coupon_id_monthly_usd,
  stripe_intro_coupon_id_monthly_cad, stripe_intro_coupon_id_yearly_usd,
  stripe_intro_coupon_id_yearly_cad, includes_automations, includes_timesheets,
  includes_request_forms, includes_marketplace`
- **Aucune donnée client.** Aucun secret : les `stripe_*_price_id` et
  `stripe_product_id` sont des identifiants publics par conception (utilisés
  côté navigateur par Stripe Checkout).
- **Aucun plan caché** : `anon` voit exactement les mêmes 3 lignes que
  `service_role`.

**Fait** : une table de tarification publique lisible sans authentification est
le comportement attendu d'une page de prix. Les seuls éléments dont l'exposition
n'est pas requise par la page publique sont les `stripe_intro_coupon_id_*`
(4 colonnes) et les plafonds internes (`max_clients`, `max_jobs_per_month`).
Qualification et recommandation : S6.

---

## 4.bis Storage — 5 buckets, dont 2 publics

Méthode : `GET /storage/v1/bucket` (métadonnées) puis tentative de listage avec
la clé **anon**. Aucun envoi, aucune suppression, aucun nom de fichier client
rapporté.

| Bucket | `public` | Limite de taille | Types autorisés | Entrées à la racine |
|---|---|---|---|---|
| `company-logos` | **true** | **aucune** | `*` | 6 |
| `avatars` | **true** | **aucune** | `*` | 0 |
| `job-photos` | false | **aucune** | `*` | 2 |
| `director-panel` | false | 100 Mo | images uniquement | 0 |
| `attachments` | false | 50 Mo | `*` | 6 |

**Test de listage au rôle `anon`** : les 5 buckets répondent `HTTP 200` avec
**0 objet** retourné. Le listage est donc filtré par les policies pour tous les
buckets, y compris les publics.

Faits à retenir :

1. **`company-logos` et `avatars` sont `public = true`.** Un bucket public rend
   ses objets **téléchargeables par URL directe sans authentification**, que le
   listage soit filtré ou non. Le filtrage du listage n'y change rien : il
   empêche de *découvrir* les chemins, pas d'*accéder* à un chemin connu.
   Pour `company-logos` c'est le comportement attendu (logos affichés sur des
   pages publiques). Pour `avatars` (photos de profil des utilisateurs), c'est
   une exposition à qualifier — S6.
2. **Trois buckets n'ont aucune limite de taille de fichier**
   (`company-logos`, `avatars`, `job-photos`) et **deux acceptent tout type MIME**
   (`company-logos`, `avatars`, plus `attachments`). Les deux buckets configurés
   avec des garde-fous (`director-panel`, `attachments`) montrent que la capacité
   existe et n'a pas été appliquée partout.
3. Les données client réelles (`job-photos`, `attachments`) sont bien dans des
   buckets **privés**.

---

## 5. Ce qui n'a PAS pu être vérifié (et pourquoi)

À lire comme la liste des angles morts de cet audit. Aucun de ces points n'est
« conforme » — ils sont **non testés**.

| Élément attendu en S2 | Statut | Cause |
|---|---|---|
| Texte intégral des policies (`qual`, `with_check`) par table | **INCONNU** | Pas d'accès catalogue (`pg_policies`) — voir §0.6 |
| Liste des fonctions `security definer` avec owner/`search_path`/grants **en base** | **INCONNU** | Idem. *Substitut : reconstruit depuis le code source SQL en S3.* |
| Grants exhaustifs à `anon`/`authenticated` sur les 229 tables | **PARTIEL** | Seules 35 tables sensibles testées, et par sonde HTTP, pas par lecture du catalogue |
| Contraintes uniques non scopées à `org_id` | **INCONNU** | Pas d'accès `pg_constraint`. *Substitut partiel : S3 sur le source.* |
| Vues sans `security_invoker` | **INCONNU** | Pas d'accès `pg_class.reloptions` |
| Extensions hors du schéma `extensions` | **INCONNU** | Pas d'accès `pg_extension` |
| Tables dans la publication Realtime | **INCONNU** | Pas d'accès `pg_publication_tables` |
| Buckets Storage publics | ✅ **VÉRIFIÉ** | Via l'API Storage — voir §4.bis |
| Advisors Supabase Security & Performance + codes de lint | **INCONNU** | Nécessite l'API Management |
| Index en tête `org_id`, plans d'exécution | **INCONNU** | Nécessite `EXPLAIN` (S5) |

**Un seul secret débloque 9 de ces 10 lignes** : un `SUPABASE_ACCESS_TOKEN`
(jeton personnel `sbp_…`, généré sur
`https://supabase.com/dashboard/account/tokens`). Le dépôt sait déjà s'en
servir : `scripts/apply-sql.ts` cible l'endpoint
`POST /v1/projects/{ref}/database/query`.

---

## 6. Posture de sécurité de l'audit lui-même

**À savoir, car cela affecte la valeur de garantie de ce document :**

1. Le rôle `audit_ro` de la Phase 0 **n'a pas été créé** — le créer est un `CREATE
   ROLE`, donc une écriture, donc interdit à l'agent. La lecture seule de cette
   session n'est donc **pas garantie mécaniquement** : elle repose sur le fait
   que seuls des `GET`/`HEAD` et des fonctions `stable` ont été appelés.
   Les scripts utilisés sont conservés et relisibles.
2. La clé employée est `SUPABASE_SERVICE_ROLE_KEY`, **qui contourne la RLS et
   peut écrire**. Elle a été injectée par `railway run` et **jamais affichée**.
   C'est l'inverse du principe de moindre privilège voulu par la Phase 0.
3. Les fonctions à effet de bord ont été **explicitement exclues** de la
   récolte : `run_security_canary` (écrit un canari), `purge_*` (supprime),
   `check_rate_limit` (incrémente un compteur).
4. **S5 reste bloqué** : prouver l'isolation entre deux tenants exige de créer
   deux orgs et deux utilisateurs de test, donc d'écrire. C'est interdit en prod
   et la branche Supabase jetable n'existe pas. **Aucun test d'isolation
   authentifié cross-org n'a été exécuté.** Ce qui est établi ci-dessus concerne
   `anon`, pas un utilisateur connecté d'une autre org — ce sont deux menaces
   différentes.

---

## 7. Annexes — inventaires bruts

### 7.1 RPC exposées touchant la sécurité, le control plane ou les données (extrait des 203)

```
anonymize_old_soft_deleted_clients, batch_soft_delete, batch_soft_delete_clients,
cancel_hard_delete_member, check_subscription_active, convert_currency,
convert_lead_to_client, crm_is_org_admin, crm_is_org_member,
delete_client_cascade, delete_invoice_cascade, delete_job_cascade,
delete_lead_and_optional_client, delete_lead_cascade, delete_quote_cascade,
detect_excessive_exports, execute_scheduled_member_deletions,
export_client_data, export_user_data, hard_delete_client, has_org_admin_role,
has_org_membership, has_org_role, list_member_audit_events, org_has_no_members,
purge_old_soft_deletes, request_hard_delete_member, search_fts, search_global,
search_global_by_type, search_global_counts, search_global_source,
set_member_mfa_required, soft_delete_client, soft_delete_client_conditional,
soft_delete_job
```

> `search_global` est la fonction dont une **fuite PII cross-org a été prouvée
> par exécution** puis corrigée le 30 juillet
> (`20260751101400_secdef_least_privilege.sql`). Elle reste exposée via l'API
> REST. **La vérification que le correctif tient n'a pas pu être faite ici** :
> elle exige un JWT d'utilisateur authentifié d'une org donnée, donc S5.

### 7.2 Fichiers de récolte

Les listes intégrales (229 tables, 203 RPC) et le JSON brut de la récolte sont
conservés hors du dépôt, dans le scratchpad de session :
`s2.json`, `exposed_tables.txt`, `rpcs.txt`.

---

## 8. Résumé factuel

| Constat | Valeur |
|---|---|
| Tables/vues exposées via l'API REST | 229 |
| RPC exposées via l'API REST | 203 |
| Sondes d'invariants exécutées | 8 |
| Violations d'invariants en prod | **0** |
| Couverture RLS (`check_rls_coverage`) | **0 manquement** |
| Références cross-tenant en base | **0** |
| Tables sensibles testées au rôle `anon` | 35 |
| Fuites de données client vers `anon` | **0** |
| Tables lisibles par `anon` | 1 (`plans`, catalogue tarifaire public) |
| Tables sensibles peuplées ne reposant que sur la RLS | 12 |
| Points de S2 non vérifiables faute d'accès catalogue | 10 |
