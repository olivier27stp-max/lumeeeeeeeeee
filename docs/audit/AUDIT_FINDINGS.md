# AUDIT_FINDINGS — Lume CRM, base de données et accès

- **Cible** : projet Supabase `bbzcuzqfgsdvjsymfwmr` — production (https://lumecrm.net)
- **Commit audité** : `9680ec5`, **confirmé déployé** (Railway, déploiement SUCCESS du 2026-07-31 01:04 UTC)
- **Fenêtre d'audit** : 2026-07-31 01:32 → 02:30 UTC (point de retour PITR : **01:32 UTC**)
- **Écritures émises sur la production : AUCUNE.** Seuls des `GET`/`HEAD` et des
  fonctions `stable` ont été appelés.

**Sévérités** — P0 : fuite ou écriture cross-org possible en production ·
P1 : contournement sous condition · P2 : durcissement / conformité ·
P3 : performance / hygiène.

> **Règle appliquée** : aucun finding n'est écrit sans preuve reproductible.
> Les findings d'une première passe qui ne résistaient pas à la vérification ont
> été **retirés** — voir §3, c'est une partie essentielle de ce rapport.

---

## 1. Findings confirmés

### P0-1 — `list_archived_items(uuid)` : lecture des archives de n'importe quelle organisation

| | |
|---|---|
| **Composant** | Fonction SQL `public.list_archived_items(p_org_id uuid)` |
| **Sévérité** | **P0** (latent — voir « État actuel ») |
| **Exploitable par** | Tout compte authentifié, y compris un compte gratuit créé pour l'occasion |

**Ce qui est exploitable concrètement** — chaîne complète, chaque maillon vérifié :

1. Un visiteur **anonyme** ouvre un formulaire de demande public de l'organisation
   cible (ces formulaires sont publics par conception, embarqués sur le site du
   client) et envoie une image via `POST /public/form/:apiKey/upload`.
   La réponse contient `path = request-forms/<ORG_UUID>/…` →
   **l'UUID de l'organisation cible est obtenu sans authentification**.
   Preuve : `server/routes/request-forms.ts:344` (construction du chemin) et
   `:351` (`return res.json({ url: pub.publicUrl, path })`).
2. L'attaquant crée un compte Lume ordinaire (n'importe quelle organisation).
3. Depuis le navigateur, il appelle
   `supabase.rpc('list_archived_items', { p_org_id: '<ORG_UUID cible>' })`.
4. Il reçoit les **clients archivés** (nom, prénom, compagnie, **courriel**,
   statut) et les **jobs archivés** de l'organisation cible.

**Preuve de la vulnérabilité elle-même :**

- La fonction est `SECURITY DEFINER` et **ne contient aucune vérification
  d'appartenance** : elle filtre uniquement sur le paramètre reçu.
  `supabase/migrations/20260705000000_eliminate_leads_table.sql:739-781` —
  les trois `SELECT` font `WHERE c.org_id = p_org_id` et rien d'autre.
- Le droit d'exécution est accordé à `authenticated` :
  `supabase/migrations/20260320000000_archive_system.sql:255` →
  `grant execute on function public.list_archived_items(uuid) to authenticated, service_role;`
- **La redéfinition de juillet n'a pas retiré ce droit** : `CREATE OR REPLACE
  FUNCTION` **préserve les privilèges existants** en PostgreSQL. Aucun `REVOKE`
  postérieur n'existe dans les 345 migrations (recherche exhaustive effectuée).
- Le durcissement du 30 juillet l'a **explicitement conservée**, sur un
  raisonnement erroné : `20260751101400_secdef_least_privilege.sql:164` indique
  « *filtre par RLS en interne (verifie : 0 fuite)* ». C'est faux : une fonction
  `SECURITY DEFINER` s'exécute avec les droits de son propriétaire, et la
  migration `20260751100000_force_rls_all_tables.sql:9` constate elle-même que
  `postgres` possède `rolbypassrls = true`. **La RLS ne s'applique donc pas à
  l'intérieur de cette fonction.**
- L'application appelle déjà cette fonction avec un `org_id` fourni côté client :
  `src/lib/archiveApi.ts:27` →
  `supabase.rpc('list_archived_items', { p_org_id: orgId })`. Le fait que la
  fonctionnalité « Archives » marche en production **prouve que le droit
  `authenticated` est bien effectif en base**.

**Vérification live effectuée** (lecture seule) : la fonction répond `HTTP 200`
et n'est **pas** exposée au rôle `anon` (absente de la spec OpenAPI d'`anon`) —
l'exposition est donc bien limitée à `authenticated`, ce qui correspond au grant
du code source.

**État actuel — nuance déterminante** : **aucune organisation ne possède
d'élément archivé en production** (0 client archivé, 0 job archivé, mesuré). La
fuite ne restitue donc **rien aujourd'hui**. Elle devient exploitable **au
premier archivage**, sur une fonctionnalité déjà livrée et accessible aux
utilisateurs. C'est un P0 latent : à corriger **avant** la mise en service, pas
après.

**Correctif proposé** (non appliqué, voir `RLS_FIXES.sql`) : ajouter la garde
d'appartenance en tête de fonction, sans toucher à la signature ni aux droits —
l'application continue de fonctionner à l'identique pour les appels légitimes.

---

### P1-1 — Une organisation sans membre est revendicable comme `owner`

| | |
|---|---|
| **Composant** | Policy `memberships_insert_org` + fonction `org_has_no_members(uuid)` |
| **Sévérité** | **P1** |
| **Mesure en production** | **12 organisations sur 31 n'ont aucun membre** |

**Ce qui est exploitable** : tout utilisateur authentifié qui connaît l'UUID
d'une organisation sans membre peut s'y insérer comme `owner` et prendre le
contrôle de l'organisation et de ses données.

**Preuve** — `supabase/migrations/20260711120000_fix_memberships_role_escalation.sql:53-63` :

```sql
create policy memberships_insert_org on public.memberships
  for insert to authenticated
  with check (
    public.has_org_admin_role(auth.uid(), org_id)
    or (
      user_id = auth.uid()
      and lower(coalesce(role, '')) = 'owner'
      and public.org_has_no_members(org_id)     -- ← branche « bootstrap »
    )
  );
```

L'oracle qui permet de tester une cible est lui aussi ouvert : `:48-49` →
`grant execute on function public.org_has_no_members(uuid) to authenticated, service_role;`

**Vérification live** (lecture seule, `org_has_no_members` est `stable`) :
**12 des 31 organisations retournent `true`**, donc revendicables.

**Ce qui limite la sévérité** : il faut connaître l'UUID d'une organisation
*vide*. Le vecteur de fuite d'UUID identifié en P0-1 (formulaire public) ne
fonctionne **pas** ici, car une organisation qui possède un formulaire de
demande a nécessairement au moins un membre — celui qui l'a créé. Le risque
porte donc sur les inscriptions abandonnées et sur toute autre voie de
divulgation d'UUID. **INCONNU — à vérifier : existe-t-il un autre chemin par
lequel l'UUID d'une organisation vide devient public (lien d'invitation expiré,
page de réservation, journal d'erreur côté client) ?**

**Note** : la branche « bootstrap » est **nécessaire** au parcours d'inscription
(le premier membre doit pouvoir se créer). Le correctif ne consiste pas à la
supprimer, mais à la borner dans le temps (voir `RLS_FIXES.sql`).

---

### P2-1 — L'UUID d'organisation fuit par un endpoint public non authentifié

**Preuve** : `server/routes/request-forms.ts:344` puis `:351`. Le chemin de
stockage `request-forms/<ORG_UUID>/…` est renvoyé tel quel au client anonyme.

Pris isolément l'UUID n'est pas un secret, mais il est le **premier maillon** de
P0-1 et le prérequis de P1-1. Le supprimer casse les deux chaînes à la racine et
ne coûte rien : il suffit de ne pas retourner `path` (l'URL publique suffit au
client), ou de dériver le préfixe d'un identifiant opaque.

---

### P2-2 — Les migrations ne décrivent pas fidèlement la production

**Preuve** : la fonction `has_org_role` est **exposée et présente en
production** (relevée dans la spec OpenAPI, 203 RPC), mais **n'est créée par
aucune des 345 migrations** (recherche exhaustive). Des objets ont donc été
appliqués hors du système de migrations.

Cohérent avec un autre constat structurel : `supabase/migrations/` contient
**25 collisions de timestamps** portant sur 53 fichiers, or
`supabase_migrations.schema_migrations.version` a ce préfixe pour **clé
primaire** — le répertoire n'est donc **pas déployable par `supabase db push`**,
ce qui explique l'application manuelle.

**Conséquence directe sur cet audit** : toute conclusion tirée du code source
seul est sujette à caution, et un `db reset` ne reproduirait pas la production.
C'est aussi ce qui rend l'accès catalogue (voir §4) indispensable.

---

### P2-3 — Télémétrie de sécurité entièrement vide

Six tables existent, sont exposées, et ne contiennent **rien** :
`login_history`, `failed_login_attempts`, `active_sessions`, `security_alerts`,
`security_incidents`, `ip_blocklist`. `data_export_log` est également vide alors
que la migration `N7.7` du 30 juillet a été déployée pour l'alimenter.

En cas d'incident après la mise en service, **il n'y aura aucune trace**. Ce
n'est pas une donnée manquante mais du code d'écriture manquant.

**INCONNU — à vérifier : exécuter un export de portabilité et confirmer qu'une
ligne apparaît dans `data_export_log`.**

---

### P2-4 — Deux buckets Storage publics, trois sans limite de taille

| Bucket | `public` | Limite | Types |
|---|---|---|---|
| `company-logos` | **true** | aucune | `*` |
| `avatars` | **true** | aucune | `*` |
| `job-photos` | false | aucune | `*` |
| `director-panel` | false | 100 Mo | images |
| `attachments` | false | 50 Mo | `*` |

Un bucket `public = true` rend ses objets **téléchargeables par URL directe sans
authentification**. Le listage est correctement filtré (testé : `anon` obtient 0
objet sur les 5 buckets), mais cela empêche seulement de *découvrir* les
chemins, pas d'*accéder* à un chemin connu. Pour `company-logos` c'est voulu ;
pour `avatars` (photos de profil) c'est à trancher. L'absence de limite de
taille et de restriction MIME sur trois buckets est un vecteur de coût/abus,
alors que les deux autres buckets montrent que le garde-fou existe.

---

### P3-1 — Doublons d'identité clients

7 lignes sur 66 (~10 % de la base clients) participent à un doublon
`(org_id, email)` ou `(org_id, phone)` au sein d'une même organisation.
Cohérent avec le retrait délibéré de la contrainte d'unicité et une
déduplication applicative (`create_client_with_duplicate_handling`) sujette aux
courses concurrentes.

**Non réparable par requête** : fusionner deux fiches engage jobs, devis,
factures et paiements. C'est une décision métier.

---

### P3-2 — 113 tables vides exposées à l'API REST

Sur **229** tables/vues exposées, **113 sont totalement vides** (49 %). Chacune
porte ses policies et ses grants, est écrivable si ses policies le permettent,
et n'a jamais été éprouvée. C'est de la surface d'attaque sans contrepartie.

---

### P3-3 — `plans` lisible sans authentification

3 lignes sur 3, toutes colonnes, y compris `stripe_intro_coupon_id_*` et les
plafonds internes (`max_clients`, `max_jobs_per_month`). Aucune donnée client,
aucun secret (les identifiants de prix Stripe sont publics par conception).
Comportement normal pour une page tarifaire ; seules 4 colonnes de coupons et
2 de plafonds n'ont pas à y être.

---

## 2. Ce qui a été vérifié et trouvé CONFORME

C'est la partie qui donne la mesure de la couverture — elle compte autant que
les trous.

| Contrôle | Méthode | Résultat |
|---|---|---|
| Couverture RLS (activée + **forcée** + au moins une policy) | `check_rls_coverage()` en prod | **0 manquement** |
| Références cross-tenant sur toutes les FK | `check_cross_tenant_references()` | **0 violation** ⚠️ valeur probante faible, voir §5 |
| Cohérence totaux de factures ↔ lignes | `check_invoice_totals_balance()` | 0 violation |
| Numérotation de factures | `check_invoice_numbering_invariant()` | 0 collision |
| Champs personnalisés orphelins | `check_custom_field_orphans()` | 0 |
| Tâches cron en échec | `check_failing_cron_jobs()` | 0 |
| Fonctions de trigger exposées | `check_exposed_trigger_functions()` | 0 |
| Fuite de données client vers `anon` | 35 tables sensibles testées en direct | **0 fuite** |
| Défaut-refus au niveau grant | idem | 13 tables refusent dès le grant (401/400) |
| Listage Storage au rôle `anon` | 5 buckets testés | 0 objet listé |
| Secrets serveur dans le bundle client | `npm run build` + inspection de `dist/` | **0 occurrence** de `service_role`/`sb_secret`/`eyJ` |
| Injection SQL dans les fonctions | Revue du source des 225 fonctions `security definer` | **0** — aucune concaténation `EXECUTE … \|\|` ; le seul cas dynamique utilise `format('%1$I')` sur liste blanche |
| Secrets en dur dans les fonctions SQL | Revue du source | **0** — le seul accès secret passe par `vault.decrypted_secrets`, correctement révoqué |
| `search_path` figé sur les `security definer` | Revue du source | 223 / 225 |
| Auto-promotion de rôle dans `memberships` | Revue policy + trigger | Bloquée (`enforce_membership_role_change`) |
| Rattachement à une org sans invitation | Flux reconstitué de bout en bout | Bloqué, **sauf** le cas P1-1 |

---

## 3. Findings RETIRÉS après vérification — faux positifs

Une première passe de cartographie du code avait rapporté **7 fuites
cross-tenant « confirmées en production »**. **Les sept sont fausses.**

**Cause** : cette passe a analysé le répertoire de travail local, qui est
**741 commits en retard** sur la branche déployée (104 fichiers serveur
diffèrent ; l'un des fichiers incriminés, `server/lib/gamification-engine.ts`,
**n'existe même pas** sur `origin/main`).

Vérification effectuée fichier par fichier sur `origin/main` — les gardes
existent, souvent avec un commentaire explicite :

| Finding retiré | Réalité sur `origin/main` |
|---|---|
| `POST /api/quotes/send-sms` | `.eq('org_id', auth.orgId)` — commentaire : *tenant guard — never send another org's quote from their Twilio number* |
| `POST /api/leads/resolve-client` | Pré-vérification explicite + 404 : *Verify the lead/client belongs to the caller's org before resolving* |
| `field-sessions/:id/gps` et `/trail` | `auth.orgId` passé en argument à `recordGpsPoint(...)` et `getGpsTrail(...)` |
| `canEditCourse` (module courses) | Porte d'isolation explicite : `if (!course \|\| course.org_id !== orgId) return false;` |
| `scheduled-reports/:id/send-now` | Pré-vérification explicite + 404 |
| `taxes.ts` | Filtrage par org présent ; les numéros de ligne cités ne correspondent pas au code déployé |
| `gamification-engine.ts` | Fichier **absent** de la branche déployée |

**À retenir** : la branche `feat/mobile-profile-web-parity` sur laquelle le
travail mobile est en cours ignore tout le durcissement de juillet. Ce n'est pas
un problème de production, mais ce le deviendra au moment de fusionner.

---

## 4. Angles morts — ce qui n'a PAS pu être vérifié

Aucun de ces points n'est « conforme » : ils sont **non testés**.

**Cause unique et commune** : ni `SUPABASE_ACCESS_TOKEN`, ni chaîne de connexion
Postgres directe, ni `psql`, ni CLI Supabase ne sont disponibles sur cette
machine. **Les requêtes catalogue brutes n'ont pas pu être exécutées.**

| Non vérifié | Impact |
|---|---|
| Texte réel des policies (`qual` / `with_check`) en base | Élevé — c'est le cœur de la RLS |
| Grants effectifs sur les 229 tables et 203 RPC | Élevé — seules 35 tables sondées par HTTP |
| Fonctions `security definer` : propriétaire, `search_path`, droits **en base** | Élevé — le source n'est pas fidèle (voir P2-2) |
| Vues sans `security_invoker` | Élevé — vecteur classique de contournement RLS |
| Contraintes restées `NOT VALID` | Moyen |
| FK sans index, colonnes `*_id` sans FK, tables sans PK | Moyen |
| Types : `timestamp` sans fuseau, montants en flottant | Moyen |
| Uniques rendues inopérantes par les `NULL` | Moyen |
| Tables dans la publication Realtime | Moyen |
| Advisors Supabase Security & Performance | Moyen |
| Plans d'exécution (`EXPLAIN`), Seq Scan sous RLS | Faible ici — 8 354 lignes en tout |

**Un seul secret débloque 10 de ces 11 lignes** : un jeton personnel Supabase
(`sbp_…`, à générer sur https://supabase.com/dashboard/account/tokens). Le dépôt
sait déjà s'en servir (`scripts/apply-sql.ts`).

**Non exécuté également : S5 (tests d'isolation authentifiés).** Prouver qu'un
utilisateur de l'organisation A ne peut pas lire l'organisation B exige de créer
deux organisations et deux utilisateurs de test, donc **d'écrire**. Interdit en
production, et la branche Supabase jetable de la Phase 0 n'a pas été créée.
**Tout ce qui est établi ci-dessus concernant `anon` ne dit rien du cas
« utilisateur authentifié d'une autre organisation »** — ce sont deux menaces
différentes, et c'est précisément celle qu'exploite P0-1.

---

## 5. Réserve méthodologique sur les résultats « 0 violation »

La base de production contient **8 354 lignes au total**, et son jeu de données
n'exerce presque pas le multi-tenant :

| Table | Lignes | Organisations concernées |
|---|---|---|
| `clients` | 66 | 14 (dont 53 dans une seule) |
| `jobs` | 34 | **1** |
| `invoices` | 13 | 2 |
| `quotes` | 16 | 2 |
| `payments` | 3 | **1** |

Sur 31 organisations, 17 n'ont pas même un client.

Un contrôle de références croisées entre organisations sur `jobs` ou `payments`
**ne peut structurellement rien trouver** quand ces tables n'existent que dans
une seule organisation. Les résultats « 0 violation » sur les **données** ont
donc une valeur probante faible. Seuls les contrôles **structurels** —
couverture RLS, crons, fonctions de trigger exposées — gardent une valeur pleine,
car ils ne dépendent pas du remplissage.

**Ce qui protège la production aujourd'hui, ce sont les contraintes et les
policies, pas l'absence constatée de dégâts.**
