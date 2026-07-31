# S3 — Control plane, fonctions SQL, secrets, chemin d'invitation

**Portée** : code source SQL uniquement (migrations de `origin/main`). Aucune requête base.
**Corpus** : 346 entrées sous `supabase/migrations/` sur `origin/main` (345 fichiers `.sql` + `proposed/`).
**Règle appliquée partout** : pour chaque objet, seule la **dernière** définition dans l'ordre lexicographique
des noms de fichiers fait foi. Toutes les citations ci-dessous sont `fichier:ligne` sur `origin/main`.
`supabase/complete_schema.sql` n'a pas été utilisé comme état courant.

**Aucune écriture, aucune migration, aucun DDL n'a été produit.**

---

## ⛔ P0 — `list_archived_items(uuid)` : fuite cross-org lisible par tout compte authentifié

**Preuve** : `supabase/migrations/20260705000000_eliminate_leads_table.sql:739-781`

```
CREATE OR REPLACE FUNCTION public.list_archived_items(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
...
  FROM public.clients c
  WHERE c.org_id = p_org_id AND c.archived_at IS NOT NULL ...
  FROM public.jobs j
  WHERE j.org_id = p_org_id AND j.archived_at IS NOT NULL;
```

- `SECURITY DEFINER`, `search_path` figé à `public`.
- Le tenant vient **du paramètre**, jamais du serveur (`current_org_id()` n'est pas appelé).
- **Aucune** vérification d'appartenance dans le corps : il n'existe ni `has_org_membership`,
  ni `has_org_admin_role`, ni `verify_org_access` entre `BEGIN` (ligne 745) et `RETURN` (ligne 780).
- Grant effectif : `grant execute on function public.list_archived_items(uuid) to authenticated, service_role;`
  — `supabase/migrations/20260320000000_archive_system.sql:255`. **Jamais révoqué ensuite.**
- La migration de durcissement la **conserve explicitement** :
  `supabase/migrations/20260751101400_secdef_least_privilege.sql:164`
  > `list_archived_items(uuid)  -> filtre par RLS en interne (verifie : 0 fuite)`

Ce raisonnement est faux. Une fonction `SECURITY DEFINER` s'exécute avec les droits du propriétaire,
et la migration `20260751100000_force_rls_all_tables.sql:9` affirme elle-même :
> `service_role et postgres ont rolbypassrls = true (verifie en prod).`
`BYPASSRLS` est évalué avant `FORCE ROW LEVEL SECURITY` (dit ligne 10 de la même migration). Si le
propriétaire de la fonction est `postgres`, la RLS de `clients`/`jobs` **ne filtre rien** à l'intérieur.

**Ce qu'un attaquant obtient** : pour tout `org_id` qu'il connaît — le sien passé (ex-membre retiré des
`memberships`), celui d'un formulaire public, celui vu dans une URL de portail — le nom, la compagnie,
le courriel et le statut de tous les clients archivés, ainsi que les jobs archivés (titre, numéro,
`client_name`, statut). Un ancien employé conserve donc un accès en lecture permanent.

INCONNU — à vérifier : propriétaire réel de la fonction en prod (`pg_proc.proowner`) et
`rolbypassrls` de ce rôle. Si le propriétaire n'a pas `BYPASSRLS`, la sévérité retombe à P3.
La vérification tient en une requête (agent live) ; tant qu'elle n'est pas faite, traiter comme P0.

**Rien n'a été corrigé.**

---

## 1. Control plane — tables réellement présentes

Tables cherchées et **absentes** du corpus : `organizations`, `org_members`, `entitlements`,
`feature_flags`, `usage_counters`, `roles`, `permissions`, `integration_credentials`.
`plan_feature_flags` n'est **pas** une table : c'est un jeu de colonnes ajouté à `plans`
(`20260711000000_plan_feature_flags.sql:15-18`).

Deux migrations portent l'essentiel des grants effectifs et sont citées en boucle ci-dessous :

| Migration | Effet |
|---|---|
| `20260730110000_durcissement_control_plane.sql:47-64` | `revoke insert, update, delete ... from authenticated, anon` sur 33 tables système |
| `20260730110000...:119-176` | révoque `DELETE` sur toute table `public` absente d'une liste blanche de 173 tables « front » |
| `20260730140000_defaut_refus_et_contraintes_metier.sql:50-93` | `revoke insert, update, delete` sur 96 tables supplémentaires |
| `20260730100000_audit_securite_ecritures_clients.sql:44,116-130` | ferme `subscriptions`, `app_connections`, `connected_accounts` |

### 1.1 `orgs` — **écriture directe possible : OUI (INSERT)**

Policies effectives :

| Cmd | Policy gagnante | Prédicat |
|---|---|---|
| SELECT | `orgs_select` `20260601000000_multi_tenant_orgs_invitations.sql:41` + `orgs_select_member` `20260321000000_mega_security_performance_fix.sql:1227` | `id = auth.uid() or has_org_membership(auth.uid(), id)` |
| INSERT | `orgs_insert` `20260601000000...:55` **∪** `orgs_insert_authenticated` `20260321000000...:1225` | `owner_id = auth.uid()` **OU** `auth.uid() IS NOT NULL` |
| UPDATE | `orgs_update` `20260717270000_dedupe_orgs_update_policy.sql:14-17` | `created_by = auth.uid() or has_org_admin_role(auth.uid(), id)` |
| DELETE | `orgs_delete_owner` `20260321000000...:1223` | `has_org_role(auth.uid(), id, {owner})` |

Grants : `orgs` figure dans la liste blanche « front » (`20260730110000...:130`) et dans aucune des deux
listes de révocation → `authenticated` conserve INSERT/UPDATE/DELETE.

Les deux policies INSERT sont PERMISSIVE, donc **unies**. `orgs_insert_authenticated` n'exige rien d'autre
que d'être connecté : **toutes les colonnes sont libres**, y compris `id`, `created_by`, `owner_id` et
`company_group_id`.

**Ce qu'un attaquant gagne** : il insère une org dont il choisit `created_by = <uid d'une victime>`.
Le trigger `BEFORE INSERT` `assign_org_company_group()` (`20260607000000_office_company_groups.sql:39-62`)
recopie alors le `company_group_id` de la victime :

```
select o.company_group_id into new.company_group_id
from public.orgs o
where o.created_by = new.created_by ...
```

Son org rejoint le « groupe compagnie » de la victime. Or `companyOrgIds()`
(`server/lib/supabase.ts:105-120`) résout ce groupe **en service_role** et sert de périmètre à des lectures
agrégées (leaderboard, sièges, pairs de paie). L'exploitation exige de connaître le `uid` de la victime :
`profiles_select_own` (`20260321000000...:1337-1340`) restreint la lecture des profils aux co-membres,
donc pas d'oracle évident. **P2 — non exploitable en l'état sans un UUID obtenu ailleurs.**
INCONNU — à vérifier : un endpoint qui renverrait `company_group_id` ou un `user_id` hors org.

### 1.2 `memberships` — **écriture directe possible : OUI, encadrée**

Grants : absente des deux listes de révocation ; présente dans la liste blanche
`20260730110000...:130` → `authenticated` garde INSERT/UPDATE/DELETE. **La RLS est la seule barrière.**

| Cmd | Policy gagnante | Prédicat |
|---|---|---|
| SELECT | `memberships_select_own_org` `20260321000000...:1227`… ∪ `memberships_select_self_or_admin` `20260321000000...:1229` | org du user |
| INSERT | `memberships_insert_org` `20260711120000_fix_memberships_role_escalation.sql:54-63` ∪ `memberships_insert_owner_bootstrap` `20260321000000...:950-954` | admin de l'org **OU** (`user_id = auth.uid()` ET `role='owner'` ET `org_has_no_members(org_id)`) |
| UPDATE | `memberships_update_org` `20260711120000...:26-29` | `user_id = auth.uid() or has_org_admin_role(auth.uid(), org_id)` |
| DELETE | `memberships_delete_org` `20260711120000...:33-35` | `user_id = auth.uid() or has_org_admin_role(...)` |

Garde colonne : trigger `trg_enforce_membership_role_change` (`20260711120000...:91-93`), fonction dans sa
**dernière** version `20260717290000_block_permission_self_escalation.sql:25-28` :

```
v_sensitive_change := (new.role is distinct from old.role)
  or (new.permissions is distinct from old.permissions)
  or (new.scope is distinct from old.scope);
```

L'auto-promotion par `role`, `permissions` ou `scope` est donc **fermée** (`:36-38`).

Restent deux trous :

1. **`memberships_insert_owner_bootstrap` n'est jamais supprimée** après `20260321000000...:949`. Elle est
   unie à la branche bootstrap de `memberships_insert_org`, plus permissive encore
   (`20260711120000...:58-62` : aucune condition sur `orgs.created_by`). Conséquence : **tout compte
   authentifié qui connaît l'`org_id` d'une organisation sans aucun membership peut s'y insérer comme
   `owner`.** Une org devient vide après départ/suppression de son dernier membre.
   **P2** (il faut connaître l'UUID de l'org).
2. `team_id` et `department_id` ne figurent **pas** dans `v_sensitive_change`
   (`20260717290000...:25-28`). Un membre dont le `scope` vaut `team` peut donc, sur sa propre ligne,
   changer de `team_id` et élargir sa visibilité aux données d'une autre équipe de son org. **P2 intra-org.**

### 1.3 `invitations` — **écriture directe possible : NON**

`revoke insert, update, delete on public.invitations from authenticated, anon` —
`20260730140000_defaut_refus_et_contraintes_metier.sql:73` (nom dans le tableau) exécuté ligne `:90`.

Les policies restées en base sont désormais sans effet pour l'écriture, mais elles documentent ce que
l'absence de ce `revoke` autoriserait — et c'est **la ligne unique qui tient toute la sécurité de
l'invitation** :

- `invitations_insert` `20260619000000_fix_invitations_table.sql:108-111` :
  `with check (has_org_membership(auth.uid(), org_id))` → **n'importe quel membre**, même `technician`,
  pourrait fabriquer une invitation `role='admin'` avec un `token_hash` qu'il contrôle.
- `invitations_update` `20260619000000...:114-118` :
  `using (has_org_membership(...) or email = (select email from auth.users where id = auth.uid()))`
  → l'invité pourrait réécrire **son propre** `role` en `admin` avant d'accepter.
  `20260730120000_with_check_toutes_policies_update.sql:46-47` recopie `USING` en `WITH CHECK`, ce qui ne
  contraint pas la colonne `role`.

Si ce `revoke` disparaît (nouvelle table `invitations` recréée, `db reset` partiel, grant Supabase par
défaut réappliqué), l'escalade rôle redevient immédiate. **À traiter comme un invariant à tester en CI.**

### 1.4 `subscriptions`, `plans`, `promo_codes`, `referrals`, `org_features` — **NON**

- `subscriptions` : `revoke insert, update, delete on public.subscriptions from authenticated, anon`
  — `20260730100000_audit_securite_ecritures_clients.sql:44`. La policy `subscriptions_all` `FOR ALL`
  (`20260601000001_billing_subscriptions_referrals.sql:128`) n'a jamais été supprimée : elle est neutralisée
  par le retrait du privilège, pas par la RLS. Défense mono-couche.
- `plans`, `promo_codes`, `referrals`, `org_features` : `20260730110000...:48-56` (tableau `cibles`),
  exécution ligne `:61`.
- Lecture : `plans_public_read ... for select to anon, authenticated using (true)`
  — `20260421195740_enable_rls_exposed_tables.sql:161-162`. Volontaire (page tarifs). Sans risque : la table
  ne contient que la grille publique.

**Gain si écriture possible** : forfait Enterprise gratuit, `extra_seats` illimité, codes promo fabriqués,
drapeaux de fonctionnalités payantes activés. C'est fermé.

### 1.5 `api_keys`, `audit_events`, `role_templates`, `payment_provider_secrets` — **NON**

Tous dans le tableau `cibles` de `20260730110000...:48-56`.

- `api_keys` — policies admin `20260604000000_advanced_security.sql:61-82`. **Gain si écriture** : forger
  une clé d'API valide.
- `audit_events` — la policy `audit_events_insert_org` `20260620000000_rls_missing_tables.sql:22`
  laisserait tout membre **forger** des lignes d'audit dans son org ; fermée par le revoke, plus trigger
  append-only `audit_events_append_only()` `20260751100100_audit_events_append_only.sql:26`.
  **Gain si écriture** : effacer ses traces après intrusion.
- `role_templates` — `20260717300000_create_role_templates.sql:37-43`. **Gain** : redéfinir le préréglage
  de permissions appliqué à chaque nouvel arrivant (`resolveInvitePermissions`, `server/routes/invitations.ts:41-58`).
- `payment_provider_secrets` — policies `service_role` seulement,
  `20260603000000_cyber_security_hardening.sql:421-427`. **Gain** : les credentials Stripe/PayPal.

### 1.6 `app_connections`, `connected_accounts` — **NON** (et lecture restreinte par colonne)

`20260730100000_audit_securite_ecritures_clients.sql:116-117` révoque les écritures ; `:122` révoque le
`SELECT` global et `:124-131` le ré-accorde **colonne par colonne** en excluant
`encrypted_access_token`, `encrypted_refresh_token`, `encrypted_credentials`, `credentials`.
C'est le seul endroit du corpus qui traite correctement le fait que la RLS filtre les lignes, jamais les
colonnes. Un canari surveille la régression : `20260730180000_canari_ssrf_pgnet.sql:93-99`.

Note historique : les policies gagnantes sur `app_connections`
(`20260321000000...:340,352`, `has_org_membership`) sont **plus larges** que celles d'origine
(`20260312500000_app_connections.sql:46-60`, `role in ('owner','admin')`). Sans les grants colonne, tout
membre écrirait les jetons OAuth. Le durcissement repose donc sur les grants, pas sur la RLS.

### 1.7 Tables « serveur uniquement »

`20260717230000_lock_serveronly_tables.sql:25-48` : `mfa_sms_challenges`, `email_oauth_states`,
`org_client_counters`, `org_job_counters`, `lead_lists` → `revoke all ... from anon, authenticated` +
policy `RESTRICTIVE ... using (false)`. C'est le patron correct (privilège **et** policy). **NON.**

### 1.8 Tableau de verdict

| Table | Écriture directe `authenticated` | Ligne qui le prouve |
|---|---|---|
| `orgs` | **OUI** (INSERT libre, UPDATE admin, DELETE owner) | `20260321000000:1225` ; absente des `revoke` |
| `memberships` | **OUI** (bornée par RLS + trigger) | `20260711120000:26,33,54` ; absente des `revoke` |
| `invitations` | NON | `20260730140000:73` + `:90` |
| `subscriptions` | NON | `20260730100000:44` |
| `plans` | NON | `20260730110000:48` + `:61` |
| `promo_codes`, `referrals`, `org_features` | NON | `20260730110000:52-54` + `:61` |
| `api_keys`, `audit_events`, `role_templates` | NON | `20260730110000:48,56` + `:61` |
| `payment_provider_secrets` | NON | `20260730110000:50` + `:61` |
| `app_connections`, `connected_accounts` | NON (+ SELECT par colonne) | `20260730100000:116-131` |
| `billing_profiles` | NON | `20260730140000:58` + `:90` |

---

## 2. Fonctions SQL `SECURITY DEFINER`

### 2.1 Couverture

- **282 noms de fonctions distincts** créés par le corpus.
- **225** dont la **dernière** définition porte `security definer`.
- **90** d'entre elles acceptent un paramètre `p_org_id` / `org_id` / `p_user_id` de type `uuid`
  → c'est la population prioritaire (b) demandée, et elle a été **traitée intégralement** (analyse
  automatisée du corps de la dernière définition + lecture manuelle des 12 plus exposées).
- Les catégories (c) — `search_*`, `export_*`, `*delete*`, `convert_*`/`auto_convert_*` — ont été
  traitées intégralement : 3 `search_global*` + `search_global_source` + `search_fts`,
  2 `export_*`, 11 `*delete*`, 0 fonction `convert_*`/`auto_convert_*` dans le corpus.
- Catégorie (a) « exposées à `anon` » : **non vérifiable depuis le source**. Les révocations décisives
  sont écrites en `DO $$ … has_function_privilege(…) $$` (`20260729120000:40-55`,
  `20260751101400:54-104`), c'est-à-dire évaluées sur l'état de la base, pas exprimées en SQL statique.
  Le corpus permet seulement d'identifier les fonctions qu'**aucune** révocation statique ne couvre.
  INCONNU — à vérifier en base : `has_function_privilege('anon'|'authenticated', oid, 'EXECUTE')` sur les
  225 fonctions `security definer`.
- **`search_path`** : sur les 225, **223 le figent**. Deux ne le figent pas :
  `rpc_ai_recent_conversations` (`20260317000000_ai_conversations.sql`) et
  `increment_unread_count` (`20260601000002_sms_inbound_helpers.sql:2`, révoquée par
  `20260751101400:84`). **P2** pour la première.

### 2.2 Répartition de la garde d'appartenance (90 fonctions à paramètre org/user)

| Situation | Nombre |
|---|---|
| Garde inconditionnelle dans le corps | 37 |
| Garde **sautée** quand `auth.uid()` est NULL | 15 |
| **Aucune** garde d'appartenance dans le corps | 38 |

Sur les 38 sans garde, 26 sont neutralisées par une révocation statique explicite
(listes B et A de `20260751101400:75-90` et `:54-66`, `20260513020000`, `20260513022000`,
`20260624000001:106`, `20260717150000`). **Restent celles qui sont sans garde ET sans révocation :**

| Fonction | Dernière définition | Ce qu'elle permet |
|---|---|---|
| `list_archived_items(uuid)` | `20260705000000:739` | **P0**, voir en tête |
| `crm_next_invoice_number(uuid)` | `20260751100600:30` | voir 2.3 |
| `create_lead_with_client(...)` | `20260705000000:686` | INSERT client+lead dans un `p_org_id` arbitraire |
| `ensure_client_for_lead(uuid,uuid,…)` | `20260327000000:238` | INSERT client dans un `p_org_id` arbitraire |
| `create_minimal_job_for_deal(uuid,uuid,uuid,text)` | `20260305230000:392` | INSERT job dans un `p_org_id` arbitraire |
| `rpc_recalculate_quote(uuid)` | `20260430000000:352` | UPDATE des totaux d'un devis d'une autre org |
| `record_consent(text,uuid,…)` | `20260625000001:102` | forger un consentement Loi 25 dans une autre org |
| `check_subscription_active(uuid)` | `20260603000000:587` | lire l'état d'abonnement de n'importe quelle org |
| `has_permission`, `get_user_scope`, `can_access_resource` | `20260614000000:165,213,233` | lire les droits d'un `p_user_id` arbitraire |
| `org_has_no_members(uuid)` | `20260711120000:39` | oracle « cette org est vide » — chaîne avec 1.2 |
| `is_conversation_participant(uuid,uuid)` | `20260619000000_fix_internal_messaging_rls_recursion.sql:14` | brique RLS, conservation justifiée |

`rpc_recalculate_quote` est, comme `list_archived_items`, **conservée volontairement** par
`20260751101400:165` au motif qu'elle « agit sur un devis déjà soumis à la RLS ». Même erreur de
raisonnement : `SECURITY DEFINER` + propriétaire `BYPASSRLS` ⇒ la RLS ne s'applique pas.
Écriture cross-org, mais qui exige de connaître l'UUID du devis → **P2**.

Les trois `create_*`/`ensure_*` sont des primitives d'**écriture** cross-org : connaître un `org_id`
suffit pour polluer les données d'un autre tenant (faux clients, faux jobs). **P1.**

### 2.3 `crm_next_invoice_number(uuid)` — numérotation d'une autre org

`20260751100600_secure_invoice_numbering_fallback.sql:30-72`. `SECURITY DEFINER`,
`set search_path = public, pg_temp`, **aucune** garde d'appartenance. Aucune révocation, ni statique ni
dynamique : elle est créée après le balayage de `20260729120000` et n'est ni une fonction trigger
(cible A de `20260751101400`) ni dans la liste B.

Appelée par un utilisateur `authenticated` non membre, elle délègue à `invoice_next_number(p_org)`
(`20260732000000_plain_numbers_smallest_gap.sql:80-82`) dont la garde lève l'exception → échec.
Mais cette garde est de la forme **conditionnelle** :

```
if auth.uid() is not null and not public.has_org_membership(auth.uid(), p_org) then
  raise exception 'Not allowed for this organization';
```

Donc pour un appelant **sans JWT** (`anon`), la garde est sautée, et `invoice_next_number` fait un
`insert … on conflict do update` sur `public.invoice_sequences` de l'org visée
(`20260732000000:92-96`) : le compteur de factures d'un autre tenant est incrémenté. C'est exactement le
scénario que `20260730110000:27-28` décrit comme devant être impossible (« casser la numérotation
séquentielle exigée par Revenu Québec »).

**P1 conditionnel.** INCONNU — à vérifier : `has_function_privilege('anon','public.crm_next_invoice_number(uuid)','EXECUTE')`.

### 2.4 Le motif `auth.uid() is not null and …` — faiblesse systémique

15 fonctions à paramètre org l'emploient, dont `invoice_next_number`, `get_invoice_next_number`,
`set_invoice_next_number`, `org_smallest_free_number`, `batch_soft_delete_clients`,
`delete_invoice_cascade`, `delete_quote_cascade`, `export_client_data`, `export_user_data`, et les
8 `rpc_insights_*`. Le motif est assumé (`20260751101900:19-30`) : il permet l'appel serveur en
`service_role`. Mais il transforme la garde en **no-op pour tout appelant sans JWT**. La sûreté repose
entièrement sur le fait qu'`anon` n'a jamais `EXECUTE` — c'est-à-dire sur des révocations dynamiques,
elles-mêmes déjà prises en défaut (§5). Une seule fonction qui repart avec le grant Supabase par défaut,
et `export_client_data(<n'importe quel client>)` devient un export PII anonyme.

**Recommandation (non appliquée)** : remplacer par un test de rôle explicite
(`current_user = 'service_role'` / `auth.role() = 'service_role'`) plutôt que par « pas de JWT ».
**P2.**

### 2.5 `search_global*` — traité, sauf la fonction qui fait le travail

`search_global`, `search_global_by_type`, `search_global_counts` sont révoquées à
`20260751101400:130-135` (`from public, anon, authenticated`) et les appelants basculés sur
`getServiceClient()`. Correct.

Mais **`search_global_source(uuid, text)` n'est pas révoquée**. Sa dernière définition
(`20260745000000_global_search_payments.sql:63-341`) est précédée d'un `drop function if exists`
(`:29`), donc la fonction repart avec l'ACL par défaut ; le seul grant retiré est
`revoke all on function public.search_global_source(uuid, text) from public;` (`:405`) — **pas `anon`,
pas `authenticated`**.

Contrairement à ce qu'affirme `20260751101400:12-19`, cette fonction **a** une garde d'org, et elle est
correcte : la CTE `guard` (`20260745000000:75-78`)

```
guard as (
  select 1 as ok from args a
  where a.raw_q <> '' and a.org_id is not null and public.has_org_membership(a.user_id, a.org_id)
),
```

est jointe à `query_terms` (`:93`), lui-même joint en `join query_terms qt on true` par **chacune** des
12 CTE `*_ranked` (vérifié une par une : `:53,86,103,131,159,186,216,243,262,278,292`) et
`leads_ranked` dérive de `lead_candidates` (`:186`). Aucune branche n'échappe à la garde.
La garde existe d'ailleurs depuis la V1 (`20260303233000_global_search.sql:53-58`).

**Conséquence** : la fuite « prouvée » décrite dans `20260751101400:10-19` n'est **pas reproductible
depuis le code source des migrations**. Soit la base de production portait une définition antérieure
non versionnée, soit le test s'est exécuté sous un rôle `BYPASSRLS`. C'est un écart source/prod à lever.
Effet résiduel : un membre peut contourner la révocation du §C en appelant `search_global_source`
directement — mais uniquement sur **sa propre** org. **P3.**

INCONNU — à vérifier : `prosrc` de `search_global_source` en prod vs `20260745000000`.

### 2.6 SQL dynamique

Analyse automatisée des **282** dernières définitions :

- **0 fonction** construit du SQL dynamique par concaténation (`EXECUTE … || …`) sans `format()`.
- Une seule fonction assemble un identifiant : `org_smallest_free_number`
  (`20260732000000_plain_numbers_smallest_gap.sql:49-60`), qui utilise `format('… %1$I … public.%2$I …')`
  avec `v_col`/`v_tbl` issus d'une **liste blanche** en dur (`:43-48`) et passe `p_org` par `using $1`.
  Correct.
- `crm_next_invoice_number` (`20260751100600:50`) fait `execute 'select public.invoice_next_number($1)' … using p_org_id`
  — chaîne constante, paramètre lié. Correct.

**Aucune injection SQL identifiée dans les corps de fonctions.**

### 2.7 Fonctions référencées mais introuvables dans le corpus

- **`has_org_role(uuid, uuid, text[])`** — utilisée dans des policies gagnantes
  (`20260321000000:958,1223,1229`, citée `20260717270000:8`) mais **jamais créée** par aucune des
  345 migrations. Un `db reset` échouerait sur ces `CREATE POLICY`.
- **`get_user_id_by_email(text)`** — appelée par `server/routes/invitations.ts:270,438` et
  jamais définie dans le corpus. Fonction email → `user_id` : si elle est exécutable par
  `authenticated`, c'est un oracle d'énumération de comptes.

Les deux sont **hors périmètre auditable depuis la source**. INCONNU — à vérifier :
définition, `prosecdef`, `proconfig` et grants de `has_org_role` et `get_user_id_by_email`. **P2.**

---

## 3. Secrets en dur

**Aucune valeur de secret n'a été trouvée en dur** dans un corps de fonction SQL ni dans une migration.
Recherche menée sur les 345 fichiers pour : `sk_live`/`sk_test`/`pk_live`/`rk_live`, `whsec_`,
SID Twilio (`AC` + 32 hex), `SG.`, jetons Slack (`xox…`), JWT (`eyJhbGciOi`), `AKIA…`,
`-----BEGIN …`, URL avec credentials (`scheme://user:pass@`), `service_role_key`, `anon_key`,
affectations littérales `password|secret|token|api_key = '…'`.

Emplacements où un secret **transite**, sans valeur écrite :

| Emplacement | Nature | Commentaire |
|---|---|---|
| `20260750000000_schedule_sms_number_release.sql:13` | commentaire d'installation | indique de créer le secret via `vault.create_secret('<valeur CRON_SECRET de Railway>', 'cron_secret')` — **placeholder**, pas de valeur |
| `20260750000000...:29-38` | corps de `trigger_sms_number_release()` | lit `vault.decrypted_secrets` (`cron_secret`, `app_base_url`) au moment de l'appel. Bon patron. Fonction révoquée : `20260750000000...:53` |
| `20260604000000_advanced_security.sql:130` | colonne `secret_rotation_log.secret_name` | ne stocke que le **nom** (`'STRIPE_SECRET_KEY'`), pas la valeur |
| `20260735000000_email_accounts.sql:6` | commentaire | mentionne `PAYMENTS_ENCRYPTION_KEY` par son nom |

Points d'attention connexes (P3) : trois policies dépendent d'un GUC applicatif au lieu d'une garde
vérifiable — `20260318000000_ai_tool_calls.sql:33,38`
(`org_id = current_setting('app.current_org_id', true)::uuid`) et
`20260513000000_demo_requests.sql:34` (`current_setting('app.platform_owner_id', true)`).
Un GUC absent rend la policy fausse (fail-closed, donc pas une fuite), mais le contrat n'est écrit
nulle part et rien ne garantit qu'un chemin ne le positionne pas.

---

## 4. Chemin d'invitation et d'ajout de membre — bout en bout

### 4.1 Le flux

| Étape | Emplacement | Contrôle |
|---|---|---|
| 1. Émission | `server/routes/invitations.ts:223-233` | `requireAuthedClient()` puis `isOrgAdminOrOwner(admin, auth.user.id, auth.orgId)` → **403 si non admin** |
| 2. Office cible | `:241-261` | si `org_id` ≠ org courante : même `company_group_id` **et** admin de la cible |
| 3. Sièges | `:295-323` | plafond plan + `extra_seats` sur tout le groupe |
| 4. Insertion | `:331-349` | `getServiceClient()` ; `org_id = targetOrgId` (jamais `req.body` non validé), `token: null`, `token_hash` = SHA-256, expiration 48 h |
| 5. Acceptation | `:409-419` | `findInvitationByToken()` (`:66-89`) : lookup par `token_hash`, comparaison en temps constant ; statut ≠ `pending` → 404 |
| 6. Expiration | `:422-429` | > `expires_at` → passage en `expired`, 410 |
| 7. Compte existant | `:448-471` | exige un Bearer valide **dont le `user.id` == le compte lié à l'e-mail invité** → sinon 401 |
| 8. Création membership | `:489-500` / `:537-549` | `role`, `scope`, `team_id`, `department_id`, `permissions` lus **depuis la ligne `invitations`** |
| 9. Rate limit | `:92-95`, `:409`, `:574` | `redisRateLimit` par IP sur `accept` et `verify` |

`auth.orgId` provient de `requireAuthedClient()` (`server/lib/supabase.ts:122+`), pas du corps HTTP :
le principe « le tenant vient du serveur » est respecté à l'étape 1.

### 4.2 Réponse aux deux questions

**« Un utilisateur peut-il se rattacher à une org dont il n'a pas l'invitation ? »**

Par le serveur : **non**. Il faudrait un `token` de 32 octets aléatoires (`:327`) dont seul le SHA-256 est
stocké (`:328,341-342`) ; le lookup se fait sur `token_hash` avec comparaison en temps constant (`:87`)
et rate-limit par IP (`:409`). L'étape 7 (`:464-471`) empêche en outre d'attacher le compte d'un tiers.

Par PostgREST : **non**, mais pour une seule raison — deux lignes :
`20260730140000_defaut_refus_et_contraintes_metier.sql:73` (`'invitations'` dans le tableau `cibles`)
et `:90` (`revoke insert, update, delete on public.%I from authenticated, anon`).
Sans elles, `invitations_insert` (`20260619000000:108-111`) laisse tout membre créer une invitation
avec un `token_hash` de son choix.

Par `memberships` en direct : **oui, dans un cas** — une org **sans aucun membership**.
`memberships_insert_org` (`20260711120000:54-63`) accepte
`user_id = auth.uid() and lower(role) = 'owner' and public.org_has_no_members(org_id)`,
sans exiger de lien avec l'org (ni `created_by`, ni invitation). L'exploitation demande de connaître
l'UUID de l'org. **P2.**

**« Peut-il s'auto-promouvoir owner/admin ? »**

- Sur sa propre ligne `memberships` : **non**.
  `20260717290000_block_permission_self_escalation.sql:36-38` :
  `if auth.uid() = old.user_id then raise exception 'You cannot change your own role or permissions.'`
  — couvre `role`, `permissions` et `scope` (`:25-28`).
- Par l'API : **non**. `POST /invitations/update-role` exige admin
  (`server/routes/invitations.ts:737-742`), refuse de toucher un `owner` (`:760-761`) et exige `owner`
  pour rétrograder un `admin` (`:765-775`).
- Par la table `invitations` : **non**, uniquement grâce au `revoke` du §4.2 ci-dessus. La policy
  `invitations_update` (`20260619000000:114-118`) autoriserait sinon l'invité —
  `email = (select email from auth.users where id = auth.uid())` — à passer son propre `role` à `admin`
  avant d'accepter, `role` n'étant contraint par aucun `WITH CHECK` (`20260730120000:46-47` recopie
  seulement `USING`) et `'admin'` étant permis par `invitations_role_check`
  (`20260619000000:56-57`). **Trou latent, à couvrir par un test CI.**
- Par `has_org_admin_role` : **non**, sauf le repli mono-tenant
  `20260601000000_multi_tenant_orgs_invitations.sql:165` — `if p_user = p_org then return true; end if;`
  (idem `has_org_membership`, `20260302210000_crm_core.sql:32`). Quiconque contrôle une org dont l'`id`
  vaut son propre `uid` en est automatiquement owner. Combiné à `current_org_id()` qui retourne
  `v_user` en dernier recours (`20260302210000:115`) et à l'INSERT libre sur `orgs`
  (`20260321000000:1225`, `id` non contraint), c'est une porte de repli qu'aucune règle métier ne
  justifie plus. Aucun gain cross-tenant démontré. **P2 — dette à retirer.**

---

## 5. Vérification demandée — reste-t-il des fonctions du 30 juillet exposées ?

`20260751101300_lock_trigger_functions.sql` corrige `audit_events_append_only()` et
`sync_legacy_money_columns()`. Balayage exhaustif des **34 fonctions** créées par les migrations
`20260729*`, `2026073*` et `20260751*` :

| Fonction | Migration | Couverture |
|---|---|---|
| `assign_client_number`, `assign_job_number`, `bump_row_version`, `enforce_invoice_immutability`, `job_agreements_enforce_job_only`, `set_email_accounts_updated_at`, `set_email_threads_updated_at`, `set_activity_notes_updated_at`, `sync_legacy_money_columns`, `audit_events_append_only` | 29000000 → 51101100 | ✅ balayage A de `20260751101400:54-66` (toutes retournent `trigger`) + `20260751101300:28-36` |
| `run_security_canary` | `20260730180000:45` | ✅ `:127` |
| `purge_old_location_data` | `20260730160000:32` | ✅ `:71-72` |
| `check_invoice_numbering_invariant`, `check_custom_field_orphans`, `check_cross_tenant_references`, `check_invoice_totals_balance`, `check_rls_coverage`, `check_all_invariants`, `check_exposed_trigger_functions`, `check_failing_cron_jobs`, `cleanup_expired_oauth_states` | 51100600 → 51101700 | ✅ `revoke` explicite dans leur propre migration |
| `org_smallest_free_number` | `20260732000000:25` | ✅ `:66` (`from public, anon`) — **pas `authenticated`**, volontaire (RPC front), garde interne présente |
| `rpc_update_entity_number`, `rpc_peek_next_numbers`, `rpc_create_quote`, `rpc_create_invoice_draft`, `invoice_next_number`, `create_client_with_duplicate_handling` | 29000000 → 32000000 | ✅ RPC front assumées ; tenant issu de `current_org_id()`, pas d'un paramètre |
| `lume_storage_object_org`, `lume_storage_is_legacy_path` | `20260729120000_storage:37,62` | ✅ `security invoker`, `search_path = ''`, pas de donnée |
| **`crm_next_invoice_number`** | `20260751100600:30` | ❌ **aucune révocation** — voir §2.3, **P1 conditionnel** |
| **`search_global_source`** | `20260745000000:63` | ❌ `revoke … from public` seulement (`:405`) — voir §2.5, **P3** |
| **`is_valid_timezone(text)`** | `20260751101800:57` | ❌ aucune révocation. `immutable`, **non** `security definer`, aucune donnée → **P3** |
| **`next_recurrence_at(...)`** | `20260751101800:132` | ❌ aucune révocation. `immutable`, **non** `security definer`, aucune donnée → **P3** |
| `export_client_data`, `export_user_data` | `20260751101900:36`, `20260751102000:28` | ⚠️ `create or replace` → l'ACL antérieure est **conservée** (`20260625000001:` grant `authenticated`, `anon` retiré par `20260729120000`). Sûres **tant qu'`anon` n'a pas `EXECUTE`** ; garde conditionnelle (§2.4) |

**Réponse** : oui, quatre fonctions créées dans cette fenêtre ont échappé au verrouillage —
`crm_next_invoice_number`, `search_global_source`, `is_valid_timezone`, `next_recurrence_at`.
Les deux dernières sont inoffensives (pas de `security definer`, pas d'accès aux données).

### 5.1 La cause structurelle n'est pas corrigée

`20260729120000_revoke_anon_security_definer.sql:62-63` (répété `20260730100000:` en fin de §4) pose :

```
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from public;
```

et se présente comme « le correctif structurel : sans ceci, la prochaine fonction ajoutée repart
exposée » (`:60-61`). **Ce correctif n'a pas tenu** — et c'est l'audit lui-même qui le prouve :
`20260751101300:6-12` constate qu'`audit_events_append_only()`, créée par `20260751100100` c'est-à-dire
**après** ce `ALTER DEFAULT PRIVILEGES`, était exécutable par `anon`.

Cause probable : `ALTER DEFAULT PRIVILEGES` sans `FOR ROLE` ne s'applique qu'au rôle courant, et les
objets sont créés par un autre rôle (ou l'entrée Supabase par défaut `FOR ROLE postgres … GRANT … TO
anon, authenticated, service_role` reste en place). INCONNU — à vérifier :
`select * from pg_default_acl where defaclnamespace = 'public'::regnamespace;`

Conséquence : **toute fonction ajoutée après le 30 juillet repart exposée à `anon` et `authenticated`
par défaut**, et la seule sonde en place — `check_exposed_trigger_functions()`
(`20260751101400:176-191`) — ne détecte que les fonctions dont le type de retour est `trigger`
(`:188`). Une nouvelle RPC `SECURITY DEFINER` ordinaire exposée à `anon` passe sous le radar.
**P1 (processus).**

### 5.2 Autres écarts source / production relevés

Ces points empêchent de considérer le corpus de migrations comme la source de vérité complète :

1. `has_org_role(...)` et `get_user_id_by_email(...)` utilisées mais jamais créées (§2.7).
2. `20260728000000_jwt_org_claims_scaling.sql:9-10` affirme que `has_org_membership` appelle
   `current_org_ids()` ; or la **dernière** définition de `has_org_membership`
   (`20260302210000_crm_core.sql:17-59`) interroge directement `memberships` et n'appelle rien de tel.
3. Fuite `search_global` « prouvée » (`20260751101400:10-19`) non reproductible depuis le source (§2.5).
4. Cinq migrations de juillet documentent explicitement avoir été « appliquées en production via l'API
   Supabase » puis consignées après coup (`20260730100000:3-8`, `20260730110000:4-5`,
   `20260730120000:4`, `20260730140000:4`, `20260730150000`). L'ordre réel d'application n'est donc pas
   celui des noms de fichiers.

---

## 6. Synthèse

| Fonction / Table | Risque | Sévérité | Preuve (fichier:ligne) |
|---|---|---|---|
| `list_archived_items(uuid)` | Lecture cross-org des clients et jobs archivés (nom, compagnie, e-mail, statut) par tout compte authentifié connaissant un `org_id` | **P0** | `20260705000000_eliminate_leads_table.sql:739-781` ; grant `20260320000000_archive_system.sql:255` ; conservée à tort `20260751101400_secdef_least_privilege.sql:164` |
| `crm_next_invoice_number(uuid)` | Sans garde et sans révocation ; via `invoice_next_number` (garde sautée si `auth.uid()` NULL) permet d'incrémenter `invoice_sequences` d'une autre org | **P1** (cond. `anon`) | `20260751100600_secure_invoice_numbering_fallback.sql:30,50` ; garde conditionnelle `20260732000000_plain_numbers_smallest_gap.sql:80-82` |
| `create_lead_with_client` / `ensure_client_for_lead` / `create_minimal_job_for_deal` | Écriture cross-org : créer clients, leads et jobs dans un `p_org_id` arbitraire | **P1** | `20260705000000:686` ; `20260327000000_leads_clients_sync.sql:238` ; `20260305230000_schema_coherence_cleanup.sql:392` |
| `ALTER DEFAULT PRIVILEGES` inopérant + sonde limitée aux triggers | Toute nouvelle fonction repart exposée à `anon`/`authenticated` sans détection | **P1** | `20260729120000_revoke_anon_security_definer.sql:62-63` ; démenti `20260751101300_lock_trigger_functions.sql:6-12` ; sonde `20260751101400:188` |
| `memberships` — bootstrap owner | Tout compte authentifié connaissant l'UUID d'une org **sans membre** s'y insère comme `owner` | **P2** | `20260711120000_fix_memberships_role_escalation.sql:54-63` ; policy jumelle jamais supprimée `20260321000000_mega_security_performance_fix.sql:950-954` |
| `orgs` — INSERT sans contrainte de colonnes + trigger `assign_org_company_group` | Insérer une org avec `created_by` = uid d'une victime fait hériter son `company_group_id` → périmètre `companyOrgIds()` élargi | **P2** | `20260321000000:1225` ; `20260607000000_office_company_groups.sql:44-53` ; `server/lib/supabase.ts:105-120` |
| `invitations` — policies laxistes neutralisées par un seul `revoke` | Si le `revoke` saute : tout membre forge une invitation `admin` ; tout invité réécrit son `role` avant acceptation | **P2** (latent) | policies `20260619000000_fix_invitations_table.sql:108-118` ; seul rempart `20260730140000:73` + `:90` |
| Motif `auth.uid() is not null and …` (15 fonctions) | Garde d'org inopérante pour tout appelant sans JWT, dont `export_client_data`/`export_user_data` | **P2** | `20260751101900_fix_dsr_export.sql:53` ; `20260751102000_fix_export_user_data_org.sql:42` ; `20260732000000:80` |
| `rpc_recalculate_quote(uuid)` | Réécriture des totaux d'un devis d'une autre org (UUID requis) ; conservée sur un raisonnement RLS erroné | **P2** | `20260430000000_quotes_system.sql:352-399` ; `20260751101400:165` |
| `record_consent(...)` | Forger un consentement Loi 25 dans une org arbitraire | **P2** | `20260625000001_dsr_and_consents.sql:102` ; grant `:128` |
| `has_permission` / `get_user_scope` / `can_access_resource` | Lecture des droits d'un `p_user_id` arbitraire | **P2** | `20260614000000_rbac_roles_scopes_permissions.sql:165,213,233` |
| Repli mono-tenant `p_user = p_org` | `has_org_membership` et `has_org_admin_role` retournent `true` sans consulter `memberships` | **P2** | `20260302210000_crm_core.sql:32` ; `20260601000000_multi_tenant_orgs_invitations.sql:165` ; `current_org_id` `20260302210000:115` |
| `has_org_role` / `get_user_id_by_email` absentes du corpus | Objets utilisés en policy et en route serveur, non auditables ; `db reset` casserait | **P2** | usages `20260321000000:958,1223,1229` ; `server/routes/invitations.ts:270,438` ; 0 `CREATE FUNCTION` dans 345 migrations |
| `memberships.team_id` hors garde | Un membre de scope `team` change sa propre équipe et élargit sa visibilité | **P2** | `20260717290000_block_permission_self_escalation.sql:25-28` |
| `rpc_ai_recent_conversations` sans `search_path` | Seule fonction `security definer` du corpus sans `search_path` figé | **P2** | `20260317000000_ai_conversations.sql` |
| `search_global_source(uuid,text)` | Non révoquée après `drop`/`create` ; contourne la fermeture de `search_global` — mais garde d'org interne correcte, pas de fuite cross-org | **P3** | `20260745000000_global_search_payments.sql:29,63,75-78,405` |
| `is_valid_timezone`, `next_recurrence_at` | Créées après le balayage, non révoquées ; non `security definer`, aucune donnée | **P3** | `20260751101800_recurrence_timezone.sql:57,132` |
| Policies dépendant d'un GUC applicatif | `ai_tool_calls`, `demo_requests` reposent sur `current_setting('app.*')` sans contrat écrit | **P3** | `20260318000000_ai_tool_calls.sql:33,38` ; `20260513000000_demo_requests.sql:34` |
| Secrets en dur | **Aucun** trouvé dans les 345 migrations | — | recherche §3 |
| Injection SQL dans les fonctions | **Aucune** : 0 `EXECUTE … ||` sans `format()` sur 282 dernières définitions | — | analyse §2.6 ; seul cas dynamique `20260732000000:49-60`, `%1$I`/`%2$I` + liste blanche `:43-48` |

### Points à lever en base (agent live)

1. `proowner` et `rolbypassrls` du propriétaire des fonctions `SECURITY DEFINER` → confirme ou infirme le P0.
2. `has_function_privilege('anon'|'authenticated', oid, 'EXECUTE')` sur les 225 fonctions `security definer`.
3. `pg_default_acl` du schéma `public` → confirme §5.1.
4. Existence, `prosecdef`, `proconfig` et grants de `has_org_role` et `get_user_id_by_email`.
5. Nombre d'orgs sans aucun `membership` → mesure l'exposition du bootstrap owner (§1.2).
6. `prosrc` de `search_global_source` en prod vs `20260745000000` → mesure l'écart source/prod.
