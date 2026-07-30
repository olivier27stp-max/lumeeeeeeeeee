# Audit sécurité base de données — Lume

Dernière passe : **2026-07-30**. Environnement audité : **production**.

Ce document est le compte rendu de l'audit et le mode d'emploi pour le
rejouer. Les correctifs eux-mêmes vivent dans `supabase/migrations/`.

---

## Comment revérifier

| Quoi | Comment | Attendu |
|---|---|---|
| Contrôles structurels | coller `scripts/audit-securite-db.sql` dans le SQL editor | toutes les lignes à **0** |
| Isolation multi-tenant | `npm run test:rls` | `✅ PASS` |
| Écritures réelles | `node scripts/local-audit-ecriture.mjs` | **10/10** |
| Parcours navigateur | `node scripts/local-audit-e2e.mjs` | **12/12** |
| Sonde continue | automatique, 04h17 UTC | `security_canary_runs.ok = true` |

La CI exécute le test d'isolation **à chaque merge** (job *RLS cross-tenant
isolation*). Il est armé : le secret `RLS_TEST_DB_URL` est configuré.

---

## État actuel

| Domaine | Note |
|---|---|
| Isolation RLS (lecture) | A |
| Isolation RLS (écriture) | A |
| Fonctions `SECURITY DEFINER` | A+ |
| Injection SQL | A |
| Control plane | A+ |
| Facturation / anti-fraude | A+ |
| Traces d'audit | A |
| Intégrité des données | A+ |
| Concurrence (*lost update*) | A− |
| Défaut-refus structurel | A− |
| Rétention / Loi 25 | A− |
| Performance RLS | A |

**Un point reste ouvert** : `pg_net` exécutable par `anon` — voir plus bas.

---

## Corrigé lors de cet audit

### Failles exploitables trouvées et fermées

1. **Vol de plan** — la policy `Own data only` sur `subscriptions` était
   `FOR ALL` sans `WITH CHECK`. N'importe quel client pouvait s'octroyer le
   forfait le plus cher depuis son navigateur, sans passer par Stripe.

2. **Trois fuites cross-org sans authentification** — `ac_client_name`,
   `resolve_primary_property` et `ac_log_event` étaient appelables par
   `anon` avec les droits du propriétaire : nom de n'importe quel client, et
   insertion de notifications chez n'importe quelle organisation.

3. **Tenant hopping** — 49 policies `UPDATE` sans `WITH CHECK`. Sans lui,
   Postgres réutilise `USING`, qui contraint la ligne *avant* modification :
   on pouvait donc déplacer ses propres lignes vers une autre organisation.

4. **Jetons OAuth exposés** — `app_connections` laissait lire *et écrire*
   les jetons chiffrés (QuickBooks entre autres).

### Durcissement structurel

- **212 → 59 tables écrivables.** La RLS n'est plus la seule couche : une
  table oubliée est désormais inerte au lieu d'être ouverte.
- **33 tables de control plane** fermées en écriture (forfaits, séquences de
  facturation, traces d'audit, anti-brute-force, idempotence des paiements).
- **14 tables d'audit** en *append-only* : on ajoute, on ne réécrit pas.
- **Factures émises immuables** — montants et numéro figés dès que le statut
  quitte `draft`, comme l'exige la conservation des pièces comptables.
- **Verrou optimiste** sur `jobs` / `quotes` / `invoices` : deux répartiteurs
  ne peuvent plus s'écraser mutuellement en silence.
- **Rétention GPS** (Loi 25) : 180 jours pour les traces de déplacement,
  3 ans pour les preuves de présence.
- **Performance** : `auth.uid()` évalué une fois par requête au lieu d'une
  fois par ligne (28 policies).

---

## Vérifié — sans problème trouvé

Ces points ont été audités et n'ont **rien** révélé. Consigné pour éviter de
les réauditer sans raison.

- **Injection SQL** — 20 fonctions à SQL dynamique, dont 5 avec
  concaténation. Toutes utilisent `format()` avec `%I`/`%L` et passent les
  valeurs par `USING`, et toutes vérifient le rôle admin en première ligne.
  `purge_old_soft_deletes` va plus loin : sa liste de tables est codée en
  dur. **Aucune n'est vulnérable.**
- **Secrets en dur** dans les corps de fonction : aucun. (Les corps sont
  lisibles par tout rôle authentifié — un secret y serait public.)
- **Realtime** — 15 tables publiées, toutes avec une policy `SELECT`.
  `job_intents` est en `replica identity FULL` (diffuse l'ancienne ligne sur
  UPDATE) mais ne contient aucun renseignement personnel.
- **Oracle par contrainte unique** — 19 uniques non scopées à `org_id`, mais
  18 portent sur des tokens ou identifiants externes, où l'unicité globale
  est *voulue*. Le seul cas métier, `jobs.deal_id`, a une FK vers
  `pipeline_deals` qui est cloisonnée : la FK échoue avant la contrainte,
  donc pas d'oracle.
- **Doublons `NULLS DISTINCT`** — 7 contraintes exposées au piège
  `NULL ≠ NULL`, **0 doublon réel** en base.
- **Index `org_id`** — présents sur toutes les tables concernées.
- **Rôles privilégiés** — seul `supabase_etl_admin` a `BYPASSRLS`, c'est un
  rôle géré par Supabase.
- **Intégrité** — 0 référence croisée entre organisations, 0 doublon de
  numéro de facture, 0 table sans clé primaire, 0 colonne monétaire en
  virgule flottante, 0 date sans fuseau horaire.

---

## Reste à faire

### 1. `pg_net` accessible à `anon` — à appliquer

**→ `scripts/A-APPLIQUER-dashboard-pgnet.sql`**

`net.http_post` est exécutable **sans être connecté**. C'est une SSRF depuis
la base : exfiltration vers un serveur tiers, accès à des services internes,
ou perturbation du worker réseau (`worker_restart`).

Ne peut pas être corrigé depuis une connexion externe : les fonctions
appartiennent à `supabase_admin`, et un `REVOKE` lancé par `postgres` via le
pooler est **ignoré en silence** — l'ACL reste inchangée sans qu'aucune
erreur ne soit levée. Il faut passer par le SQL editor du dashboard.

Sans risque : les deux seuls appelants (`fn_push_on_notification`,
`trigger_sms_number_release`) sont `SECURITY DEFINER` et continueront de
fonctionner.

### 2. Verrou optimiste dans l'interface

Actif en base et vérifié, mais le message de conflit n'est câblé que sur les
jobs. À étendre aux soumissions et aux factures, écran par écran.

### 3. Vulnérabilités npm

Voir `docs/audit-dependances.md`. 0 critique ; les 3 « élevées » sont non
exploitables ici. **Ne pas lancer `npm audit fix --force`** : il propose une
rétrogradation de `react-router` 7.13.1 → 7.11.0.

---

## Pièges rencontrés — à savoir avant de recommencer

**`REVOKE ... FROM anon` ne suffit pas.** Si l'ACL affiche `=X/...` en tête,
le privilège vient du pseudo-rôle `PUBLIC`, qui englobe `anon` sans le
nommer. Il faut `REVOKE ... FROM public`. Ce piège a fait échouer deux
tentatives de correctif, chaque fois sans message d'erreur.

**La RLS filtre les lignes, jamais les colonnes.** Un `GRANT SELECT` au
niveau table couvre toutes les colonnes et prime sur un `REVOKE` par
colonne. Pour protéger une colonne (jeton, `version`), il faut retirer le
grant global puis ré-accorder colonne par colonne.

**`has_table_privilege(..., 'update')` renvoie faux dès qu'un grant est par
colonne.** Utiliser `has_column_privilege` pour ces tables, sinon elles
ressortent en faux négatif.

**Postgres normalise le texte des policies.** `(select auth.uid())` ressort
en `( SELECT auth.uid() AS uid)` : chercher la forme littérale produit des
faux positifs massifs. Une première détection annonçait 399 policies à
optimiser, il y en avait 28.

**Une policy sans `WITH CHECK` sur une table dont le grant a été révoqué est
inerte.** Sans filtrer sur le privilège, le contrôle remonte 14 faux
positifs permanents — et un contrôle toujours rouge finit ignoré.
