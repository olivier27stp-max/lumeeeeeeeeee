# AUDIT COMPLET — Lume CRM (lecture seule)

**Date :** 2026-07-31
**Périmètre :** Frontend SPA (Vite + React 19) · API Express (`server/`) · Supabase (219 tables, 588 policies, 320 fonctions)
**Méthode :** cartographie exhaustive (4 passes d'inventaire) + vérification adverse ligne-à-ligne des failles candidates. Chaque constat cite un `fichier:ligne` ou un objet SQL nommé, vérifié sur le code / la migration / le snapshot de prod.
**Référentiel de schéma faisant foi :** `supabase/SCHEMA_SNAPSHOT.md` (généré depuis la prod le 2026-07-31 15:19 UTC). `supabase/complete_schema.sql` est **périmé de 185 tables** et n'a **pas** été utilisé comme source (voir C2-01).

> ⚠️ **Stack réelle : il n'y a PAS de Next.js.** Le front est un SPA Vite + React ; tout le backend est un unique serveur Express. La consigne « route handlers Next.js » est sans objet ; les « routes back » ci-dessous sont les routers Express.

---

## 1. TABLEAU DE BORD

| Catégorie | Note /10 | Verdict |
|---|---|---|
| **Sécurité & isolation multi-tenant** | **3/10** | Plafonnée par une fuite d'isolation cross-tenant confirmée (`quote_line_items_public_read` : tout porteur de la clé anon publique lit les lignes de devis de **tous** les tenants). Fondations par ailleurs solides (RLS FORCÉE 219/219, `search_path` sur 100 % des SECDEF, signatures webhook correctes), mais une seule faille d'isolation plafonne la note. |
| **Qualité schéma & code** | **6/10** | Schéma discipliné (argent en cents + CHECK, `has_org_membership` cohérent, 130 FK composites same-org). Mais hygiène de code faible : 547 `as any`, 221 `catch {}` vides, 130 `console.log` serveur, Zod absent sur les plus grosses surfaces mutantes, dérive massive des migrations et noms de fichiers à dates impossibles. |
| **Cohérence front ↔ back** | **5/10** | 2 appels front vers des routes **non montées** (404 garanti), 54 `fetch()` hors de `src/lib` (violation de la règle projet), pas de client HTTP partagé (`authHeaders()` dupliqué 15×), 2 fichiers serveur (`stripeClient.ts`/`paypalClient.ts`) égarés dans `src/lib`. |
| **Intégrité relationnelle & code mort** | **6/10** | Intégrité relationnelle forte (564 FK dont 130 composites same-org anti-cross-tenant, `ON DELETE` cohérents). Mais résidus morts nombreux : 5 routers non montés, ~12 fonctions `*_lead*` orphelines (table `leads` supprimée), `complete_schema.sql` fantôme, `security_canary_runs` avec 0 policy. |
| **NOTE GLOBALE** | **5/10** | Ingénierie sérieuse et défense en profondeur réelle, mais **3 policies `anon` résiduelles + un trou de cloisonnement Storage** interdisent la mise en prod en l'état. Toutes corrigeables en < 1 h de SQL. |

---

## 2. GO / NO-GO

### ❌ NO-GO pour demain matin avec de vrais clients payants.

**Ce ne sont PAS des blocages structurels** — ce sont 4 correctifs SQL/config de quelques minutes chacun. Mais tant qu'ils sont en place, un tiers muni de la clé `anon` publique (présente dans le bundle JS de tout visiteur) peut lire/écrire des données cross-tenant.

**Bloqueurs absolus (à lever avant le premier client payant) :**

1. **[CRITIQUE] `quote_line_items_public_read`** — SELECT `anon` sur `quote_line_items` avec prédicat tautologique (`view_token IS NOT NULL`, et `view_token` a `DEFAULT gen_random_uuid()` donc jamais NULL). Lecture de **toutes** les lignes de devis (descriptions, quantités, prix) de **tous** les tenants. → **C1-01**
2. **[CRITIQUE] `surveys_update_anon`** — UPDATE `anon` sur `satisfaction_surveys` sans liaison au token/org (`USING (submitted_at IS NULL)`). Écriture aveugle sur **tous** les sondages non soumis de **tous** les tenants. Le correctif de mai visait la mauvaise table (`public.surveys` au lieu de `satisfaction_surveys`) et n'a jamais pris effet. → **C1-02**
3. **[CRITIQUE] Storage — branche « legacy path »** — les policies SELECT `attachments`/`job-photos` autorisent tout utilisateur authentifié de n'importe quel org à lister/lire les fichiers sous `clients/%`, `jobs/%`, `checklists/%`, `quotes/photos/%`, `avatars/%` — préfixes vers lesquels **4 flux d'upload écrivent encore aujourd'hui**. → **C1-04**
4. **[MAJEUR — à trancher] Auto-provisionnement via `checkout.session.completed`** — le handler ne valide jamais `session.amount_total` contre le prix du plan et n'examine pas le compte d'origine de l'event ; les deux secrets webhook sont testés sur les deux endpoints. Exploitabilité réelle conditionnée à la config Stripe (types d'events souscrits sur le webhook Connect) — **NON VÉRIFIABLE depuis le repo**. → **C1-05**

**Atténuation importante :** les 3 policies `anon` sont **vestigiales** — aucune ne sert l'application (les flux publics passent par le service-client serveur, token-lié). Les supprimer ne casse rien. Après ces 4 correctifs, un GO devient défendable.

---

## 3. CARTOGRAPHIE (Étape 0)

### 3.1 Base de données (source : `SCHEMA_SNAPSHOT.md`, prod 2026-07-31)

| Objet | Total prod | Points clés |
|---|---|---|
| Tables | 219 | RLS activée **219/219** ; **FORCE ROW LEVEL SECURITY 219/219** (`20260751100000_force_rls_all_tables.sql`). 171 ont `org_id` ; 48 non (catalogues globaux `plans`/`promo_codes`, ou isolées via FK parent). 35 en soft-delete. |
| Vues | 11 | Toutes en `security_invoker` ; 0 en `security_barrier`. 20 `GRANT … TO anon` sur des vues (RLS s'applique quand même). Vues fantômes en migration mais supprimées en prod : `leads_active`, `v_client_portfolio`, `v_job_full`. |
| Fonctions | 320 | 249 `SECURITY DEFINER` (78 %) ; **0 sans `search_path`** parmi les SECDEF ✅ ; 211 en `search_path=public` sans `pg_temp` (durci mais pas maximal). ~12 fonctions `*_lead*` mortes. |
| Triggers | 222 | Doublons : `payment_provider_secrets`/`payment_provider_settings` portent chacun **3** triggers `set_updated_at()` identiques ; `jobs` en a 3. |
| Policies | 588 | Prédicat dominant `has_org_membership((SELECT auth.uid()), org_id)` (249 occurrences). 22 policies `USING (true)` — **21 sont `service_role`** (bénin), 1 est `plans_public_read`. 3 policies `anon` permissives problématiques (C1-01/02/03). |
| Storage | 4 buckets | `company-logos` (public, volontaire), `attachments`/`job-photos`/`director-panel` (privés depuis `20260717250000`). Policies org-scoped depuis `20260729120000` **mais** branche legacy ouverte (C1-04). |
| Edge Functions | 0 | Aucune fonction Deno / `supabase/functions/`. Tout est dans Express. |
| pg_cron | 10 jobs | Rétention, purges, canary sécurité. `lume_release_sms_numbers` **INACTIF**. |

### 3.2 Backend Express (`server/` — 69 routers)

- **Middlewares globaux** (ordre) : trust proxy → CSP/headers → CORS (allowlist `FRONTEND_URL`) → **raw body Stripe** (`index.ts:273,276`, avant `express.json`) → `express.json({limit:'512kb'})` → sécurité (tracing, IP-block, rate-limit 300/min) → audit → rate-limiters → **MFA** (2 préfixes) → **RBAC** (`route-permissions.ts`, ~180 règles ; routes sans règle → auth propre du handler).
- **Auth handler** : `requireAuthedClient` (`server/lib/supabase.ts:122`) — Bearer only (pas de cookie), résout l'org via `x-org-id` **avec vérif d'appartenance anti-IDOR** (vérifiée saine, cf. constats refutés C1).
- **`getServiceClient()` (bypass RLS) : utilisé dans 61 des 69 routers.** Chaque endpoint token-public tourne **entièrement** sur le service-client → l'isolation y est de la logique applicative, pas du RLS.
- **5 routers présents mais NON MONTÉS** (code mort) : `campaigns.ts`, `booking.ts`, `recurring-invoices.ts`, `webhooks-config.ts`, `quickbooks-export.ts`.
- **Webhooks entrants** : Stripe (`constructEvent` + raw body + anti-replay 300s), PayPal (`verify-webhook-signature`), Twilio (`validateRequest`) — **tous correctement signés**. Cron via `x-cron-secret` timing-safe.
- **SQL brut : aucun.** 59 `.rpc()` vers fonctions nommées, paramètres bindés — pas d'injection.

### 3.3 Frontend (`src/` — 83 `*Api.ts`)

- **Accès supabase-js direct : 79 tables/vues** + **46 RPC** appelés depuis le front. Client créé dans `src/lib/supabase.ts:14` (clé **anon** uniquement, PKCE, token en `localStorage`).
- **54 `fetch()` hors de `src/lib`** (violation de la règle projet). Pas de client HTTP partagé : `authHeaders()` réécrit dans 15 fichiers, `apiFetch()` dans 9.
- **2 fichiers serveur égarés dans le tree client** : `src/lib/stripeClient.ts`, `src/lib/paypalClient.ts` (client service-role + SDK Node `stripe`). **Non importés** → non bundlés → pas de fuite réelle, mais à déplacer dans `server/`.
- **Aucun secret commité.** Seul `.env.example` est suivi par git ; `.env.local` correctement ignoré. Aucune clé `VITE_`-préfixée n'est un secret (sauf le nom-piège `VITE_SUPABASE_SERVICE_ROLE_KEY` lu côté serveur, non bundlé — C1-09).

### 3.4 Tableau objet → défini où → utilisé par qui (objets sensibles)

| Objet | Défini | Utilisé par |
|---|---|---|
| `quote_line_items_public_read` (policy) | prod (snapshot `:5211`) | **personne** (vestigial) — front auth via `quote_line_items_select`, public via `quotes.ts:727` service-client |
| `surveys_update_anon` (policy) | `20260325000001_automation_engine.sql:303` | **personne** — `surveys.ts:18,88` utilise le service-client token-lié |
| `plans_public_read` (policy) | prod (`:5122`) | **personne côté anon** — lu serveur (`payments.ts:1549`, `billing.ts:1825`) |
| `getServiceClient()` | `server/lib/supabase.ts:16` | 61/69 routers |
| bucket `attachments` (privé) | `20260717250000` | `storage.ts`, `specificNotesApi.ts`, `measurementApi.ts`, `ClientDetails.tsx`, `JobDetails.tsx` |
| `org_knowledge` (table+router) | `org-knowledge.ts` | **personne** (0 lignes prod, 0 appelant) |
| routes `recurring-invoices` / `quickbooks-export` | routers non montés | appelées par le front → **404** (C3-01) |

---

## 4. DÉTAIL PAR CATÉGORIE

### CATÉGORIE 1 — SÉCURITÉ & ISOLATION MULTI-TENANT

---

**[CRITIQUE] C1-01 — Fuite cross-tenant : lignes de devis lisibles par tout porteur de la clé anon**
**Objet SQL :** policy `quote_line_items_public_read` (prod `SCHEMA_SNAPSHOT.md:5211`)
**Ce que j'ai vu :**
```sql
-- roles={anon}, SELECT
USING (EXISTS (SELECT 1 FROM quotes q
               WHERE q.id = quote_line_items.quote_id
                 AND q.view_token IS NOT NULL))
```
`quotes.view_token uuid NOT NULL DEFAULT gen_random_uuid()` (`:2899`) → le prédicat est **toujours vrai**. Équivaut à `USING (true)`. `quote_line_items` n'a **pas** de colonne `org_id` (`:2756`), donc rien d'autre ne contraint la lecture.
**Pourquoi c'est un problème :** la clé `anon` est publique (bundle JS). PostgREST est directement joignable : `GET /rest/v1/quote_line_items?select=*` renvoie **toutes** les lignes de devis de **tous** les orgs.
**Impact si exploité :** un client voit descriptions, quantités et prix unitaires (`unit_price_cents`, `total_cents`) de tous les devis de tous les autres clients — grille tarifaire complète des concurrents.
**Test SQL (à ne PAS exécuter) :**
```sql
SET ROLE anon;
SELECT count(*), count(DISTINCT quote_id) FROM public.quote_line_items;
-- Faille : lignes de PLUSIEURS orgs. Isolé correctement : 0.
```
**Correctif :**
```sql
DROP POLICY IF EXISTS quote_line_items_public_read ON public.quote_line_items;
-- Le flux public légitime passe déjà par server/routes/quotes.ts:727 (service-client, token-lié).
```
**Effort :** 5 min.

---

**[CRITIQUE] C1-02 — Écriture cross-tenant : tout anon peut altérer les sondages non soumis de tous les orgs**
**Objet SQL :** policy `surveys_update_anon` (`20260325000001_automation_engine.sql:303`, live `SCHEMA_SNAPSHOT.md:5378`)
**Ce que j'ai vu :**
```sql
-- roles={anon}, UPDATE
USING      (submitted_at IS NULL)
WITH CHECK (submitted_at IS NOT NULL)
```
Aucune référence au `token` ni à `org_id`. Le correctif du 2026-05-12 (`20260512200000_drop_anon_using_true_policies.sql:35`) est gardé par `IF to_regclass('public.surveys') IS NOT NULL` — or la table s'appelle `satisfaction_surveys`, donc `to_regclass('public.surveys')` est NULL → le DROP **ne s'exécute jamais**. Confirmé vivant en prod.
**Pourquoi c'est un problème :** `PATCH /rest/v1/satisfaction_surveys?submitted_at=is.null` avec `{"rating":1,"submitted_at":"…"}` mute toutes les lignes non soumises, tous tenants confondus. `WITH CHECK` force juste à les marquer soumises — ce qui verrouille le vrai client (rejet 409 à `surveys.ts:86`).
**Impact si exploité :** falsification/sabotage massif des avis de tous les clients ; déni de service sur la soumission légitime. (Pas de lecture : aucune policy SELECT anon → écriture aveugle.)
**Test SQL (ne pas exécuter) :**
```sql
SET ROLE anon;
UPDATE public.satisfaction_surveys SET rating = 1, submitted_at = now() WHERE submitted_at IS NULL;
-- Faille : >0 lignes multi-org. Isolé : 0.
```
**Correctif :** `DROP POLICY IF EXISTS surveys_update_anon ON public.satisfaction_surveys;` (bon nom de table)
**Effort :** 5 min.

---

**[MAJEUR] C1-03 — Insertion anon de lignes de tracking sur n'importe quelle facture**
**Objet SQL :** policy `quote_views_insert_anon` (`SCHEMA_SNAPSHOT.md:5285`)
**Ce que j'ai vu :** `WITH CHECK (EXISTS (SELECT 1 FROM invoices i WHERE i.id = quote_views.invoice_id AND i.deleted_at IS NULL))` — `ip_address`, `user_agent`, `client_id` tous choisis par l'appelant.
**Pourquoi c'est un problème :** insertion illimitée contre tout `invoice_id` non supprimé ; oracle d'existence d'ID + pollution de la table analytics. Pas de lecture cross-tenant.
**Impact :** empoisonnement des stats de vues ; flooding. Vestigial (seuls `quotes.ts:118,206` écrivent, en service-client).
**Correctif :** `DROP POLICY IF EXISTS quote_views_insert_anon ON public.quote_views;`
**Effort :** 5 min.

---

**[MAJEUR] C1-04 — Cloisonnement Storage contourné par la branche « legacy path »**
**Fichier :** `supabase/migrations/20260729120000_storage_org_scoped_policies.sql:61-75, 96-105, 138-147`
**Ce que j'ai vu :**
```sql
create policy "attachments_select_own_org" on storage.objects for select to authenticated
using ( bucket_id = 'attachments'
        and ( public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
              or public.lume_storage_is_legacy_path(name) ) );  -- ← branche OR
-- lume_storage_is_legacy_path : name LIKE 'clients/%' OR 'jobs/%' OR 'checklists/%'
--                               OR 'quotes/photos/%' OR 'avatars/%' OR 'specific-notes/%' …
```
La branche legacy court-circuite `has_org_membership` en SELECT. Le commentaire prétend que ces chemins sont un résidu à re-migrer — **faux** : 4 flux d'upload y écrivent **encore** :
- `src/pages/ClientDetails.tsx:230` → `clients/${client.id}/…`
- `src/pages/JobDetails.tsx:287` → `jobs/${job.id}/…`
- `src/pages/QuoteNew.tsx:515` → `quotes/photos/…`
- `src/pages/settings/ProfileSettings.tsx:302` / `D2DOnboarding.tsx:84` → `avatars/${userId}.…`
**Pourquoi c'est un problème :** la policy régit les lignes de `storage.objects` → un utilisateur authentifié d'un org peut faire `POST /storage/v1/object/list/attachments` avec `prefix:"clients/"` et **énumérer** tous les objets de tous les tenants, puis les télécharger. Les avatars sont directement dérivables (`avatars/${userId}`, `userId` visible entre collègues via `profiles_select_own`).
**Impact si exploité :** lecture des photos de chantier, pièces jointes clients et avatars de tous les autres tenants.
**Test (ne pas exécuter) :** en tant qu'utilisateur d'org A, appeler l'API list Storage `prefix:"jobs/"` → renvoie des chemins d'org B.
**Correctif :** retirer la branche `or public.lume_storage_is_legacy_path(name)` des 2 policies SELECT, **après** re-préfixage des 4 flux sous `${orgId}/…` (comme `OnboardingWizard.tsx:70` et `request-forms.ts:344` le font déjà) + backfill des objets existants. Puis `DROP FUNCTION lume_storage_is_legacy_path`.
**Effort :** 2–4 h.

---

**[MAJEUR — à trancher] C1-05 — Webhook `checkout.session.completed` : montant jamais validé, compte d'origine ignoré**
**Fichier :** `server/routes/payments.ts:562-569` (dispatch) + `:1507-1629` (handler) ; `:96-105` (double secret)
**Ce que j'ai vu :**
- Les deux secrets `[stripeWebhookSecret, stripeConnectWebhookSecret]` sont testés **quel que soit l'endpoint** (`:96-105`) → domaines de confiance fusionnés.
- Garde de dispatch : `if (meta.plan_slug && session.payment_status === 'paid')` (`:562`).
- Le handler sélectionne le plan **uniquement** via `meta.plan_id` (`:1549`) et ne compare **jamais** `session.amount_total` au prix (`:1628` lit `amount_total` mais ne le valide pas).
- Sur collision d'email (`:1557`, `:1588`), il annule les abonnements actifs de l'org trouvée (`:1616-1620`) et en crée un nouveau.
- `event.account` est lu (`:136`) pour le log mais **jamais** utilisé pour refuser un event de compte connecté.
**Pourquoi c'est un problème :** un marchand Connect onboardé peut créer une Checkout Session dans **son propre** compte à 1 $, `metadata={plan_slug:'…', plan_id:'<uuid lisible via plans_public_read>', email:'…'}`. L'event Connect est signé par Stripe avec le secret Connect → accepté. Le handler provisionne le plan haut de gamme pour 1 $, ou — via collision d'email — annule/repoint l'abonnement d'un autre org.
**Impact :** perte de revenu + manipulation de facturation cross-tenant par collision d'email.
**NON VÉRIFIÉ :** dépend des **types d'events souscrits** sur l'endpoint webhook Connect côté dashboard Stripe. Invérifiable depuis le repo.
**Correctif :** (1) séparer les handlers, un endpoint = un secret ; (2) rejeter tout event avec `event.account` non nul dans le handler billing plateforme ; (3) valider `session.amount_total` contre `plans.monthly_price_*` (± promo connue).
**Effort :** 2–3 h.

---

**[MINEUR] C1-06 — `plans_public_read` expose les IDs Stripe (produit/prix/coupons) à l'anon**
**Objet SQL :** `plans_public_read` — SELECT `USING (true)` roles `{anon,authenticated}` (`SCHEMA_SNAPSHOT.md:5122`). Colonnes au-delà du tarif : `stripe_product_id`, `stripe_*_price_id_*`, `stripe_intro_coupon_id_*`, flags d'entitlement.
**Pourquoi c'est un problème :** disclosure inutile + **enabler direct de C1-05** (fournit le `plan_id` UUID sinon à deviner).
**Correctif :** exposer une **vue** restreinte (nom, prix, features), révoquer le SELECT anon sur la table brute.
**Effort :** 30 min.

---

**[MINEUR] C1-07 — Identifiants GPS tiers (Traccar/Life360) en clair, lisibles par tout membre de l'org**
**Objet SQL :** `gps_providers.config jsonb` (`SCHEMA_SNAPSHOT.md:1706`) ; policy `gps_providers_org` — `ALL` roles `{public}`, `USING (org_id IN (SELECT … memberships …))` (`:4566`). Écrit en clair à `src/lib/locationApi.ts:151`.
**Pourquoi c'est un problème :** contrairement à `payment_provider_secrets` (chiffré AES-256-GCM + service-role only), les credentials de flotte GPS sont en clair et lisibles par **n'importe quel employé** (pas seulement owner/admin).
**Correctif :** chiffrer `config` via `crypto.ts` ; restreindre la policy à `has_org_admin_role`.
**Effort :** 2 h.

---

**[MINEUR] C1-08 — `PII_ENCRYPTION_KEY` ne chiffre rien (théâtre de conformité)**
**Fichier :** `server/lib/env-validation.ts:122-123` vs `src/lib/crypto.ts:10`
**Ce que j'ai vu :** l'assertion de démarrage affirme « PII data cannot be stored unencrypted » et est satisfaite dès que `PAYMENTS_ENCRYPTION_KEY` est présent. Or `crypto.ts` ne lit **que** `PAYMENTS_ENCRYPTION_KEY` et ne chiffre que les secrets paiement/intégration/email. `clients.email/.phone/.address`, corps de `messages`, points GPS restent **en clair**. `PII_ENCRYPTION_KEY` n'apparaît que dans la validation.
**Impact :** faux sentiment de conformité Loi 25 ; un dump DB expose tout le PII client en clair.
**Correctif :** chiffrer réellement les colonnes PII sensibles **ou** corriger le message. Décision produit (le chiffrement colonne casse recherche/tri — d'où les colonnes `email_blind`/`phone_blind` déjà présentes).
**Effort :** message 15 min ; chiffrement réel 1–2 j.

---

**[MINEUR] C1-09 — Logs serveur : `email`/`phone`/`address` non rédigés ; nom-piège `VITE_SUPABASE_SERVICE_ROLE_KEY`**
**Fichiers :** `server/lib/logger.ts:12-30` (set `REDACTED_FIELDS` sans email/phone/address/name) ; `server/lib/pii-redaction.ts` existe mais câblé uniquement aux prompts IA sortants. `VITE_SUPABASE_SERVICE_ROLE_KEY` lu côté serveur — préfixe `VITE_` sur une clé service-role = footgun (absent des ARG Dockerfile donc pas bundlé, mais à renommer).
**Impact :** tout `logger.info({ client })` imprime email/téléphone en clair.
**Correctif :** ajouter email/phone/address au set de rédaction (ou brancher `redactPii`) ; renommer la clé.
**Effort :** 30 min.

**Constats REFUTÉS (vérifiés sains — ne PAS corriger) :** mass-assignment (`req.body` spread : 4 hits, tous Zod-strippés ou allowlist) ; IDOR `x-org-id` (`requireAuthedClient` vérifie l'appartenance contre `user.id` du JWT, fail-closed, `supabase.ts:143-149`) ; auto-escalade de rôle via `memberships_update_org` (bloquée par le trigger `enforce_membership_role_change`, `20260717290000` — `raise 42501` si `auth.uid() = old.user_id`) ; CSRF « `Content-Type: application/json` » (moot : auth Bearer-only, token en localStorage, pas de cookie) ; `payment_provider_secrets`/`subscriptions`/`orgs`/`profiles`/`quotes` (correctement scoped) ; idempotence webhook Stripe (présente, 2 couches) ; `billing.ts confirm-checkout` (lecture seule, ne provisionne rien).

---

### CATÉGORIE 2 — QUALITÉ DU SCHÉMA & DU CODE

**[MAJEUR] C2-01 — Dérive massive `complete_schema.sql` vs prod.** Le fichier (11 535 lignes) ne contient que **26 tables** ; **185 des 219 tables de prod y sont absentes**. Il définit encore 4 tables **supprimées** (`leads`, `pipeline_stages`, `availabilities`, `client_link_backfill_ambiguous`) et duplique `teams` 3×, `payments` 3×. → *Correctif :* supprimer/remplacer par un pointeur vers `SCHEMA_SNAPSHOT.md`. **10 min.**

**[MAJEUR] C2-02 — Noms de migrations à dates impossibles + doublons.** 57 fichiers jour 32→51 (`20260732…`→`20260751…`, compteurs synthétiques). 25 préfixes 14-chiffres dupliqués (ex. deux `20260751103400_*`). Le tri lexicographique tient mais tout parsing de date casse. → *Correctif :* convention de séquence documentée ; ne pas renommer l'historique appliqué. **Politique 1 h.**

**[MAJEUR] C2-03 — Validation Zod absente sur les plus grosses surfaces mutantes.** `field-sales.ts` (37 endpoints, 0 Zod : `:219,:466,:625,:1153,:1751`), `commissions.ts` (`:176,:215,:320`), `payroll.ts` (`:43,:253,:310`), `security.ts`, `quotes.ts` (12 dont 8 publics, 0 `validate()`). **Atténué** par des allowlists manuelles (pas de mass-assignment), mais types/plages non contraints. → *Correctif :* Zod sur les endpoints mutants publics en priorité. **1 j.**

**[MINEUR] C2-04 — Hygiène de code.** `as any` : **547** (195 server + 352 src). `catch {}` vides : **221**. `console.log` serveur : **130** (bruit + risque PII). `TODO/FIXME` : 3 (sain). → *Correctif :* lint `no-empty-catch` + logger rédacteur. **1–2 j incrémental.**

**[MINEUR] C2-05 — Triggers `updated_at` dupliqués.** `payment_provider_secrets`/`payment_provider_settings` : 3 triggers identiques chacun ; `jobs` : 3. → *Correctif :* supprimer les redondants. **30 min.**

**[MINEUR] C2-06 — Colonnes argent legacy en double.** `invoices`/`jobs` portent `total_cents integer` (source de vérité, CHECK non-négatif) **et** `total numeric` legacy, synchronisés par `sync_legacy_money_columns`. **Bon point** : argent bien en cents entiers (aucune colonne argent en `double precision` — vérifié). Double représentation = risque de dérive. → *Correctif :* déprécier les colonnes `numeric`. **1 j.**

**Points positifs vérifiés :** RLS FORCÉE 219/219 ; `search_path` sur 100 % des SECDEF ; argent en cents + CHECK (`invoices_money_non_negative`, `invoices_void_zero_paid`) ; 130 FK composites `_same_org` ; wrapping InitPlan `(SELECT auth.uid())` cohérent.

---

### CATÉGORIE 3 — COHÉRENCE FRONT ↔ BACK

**[MAJEUR] C3-01 — Appels front vers des routes NON MONTÉES (404 garanti).** `src/lib/recurringInvoicesApi.ts` → `/api/recurring-invoices` (router non monté, `index.ts:51-52`) ; `src/pages/QuickBooksExport.tsx:30` → `/api/quickbooks-export/:kind.csv` (non monté). Fonctionnalités « factures récurrentes » et « export QuickBooks » cassées. → *Correctif :* monter les routers (après vérif RBAC) ou retirer l'UI. **15 min–1 h.**

**[MINEUR] C3-02 — 54 `fetch()` hors `src/lib`.** Violation de la règle CLAUDE.md. 20 pages/composants/hooks (ex. `Auth.tsx:64`, `NotificationBell.tsx:39`, couche parallèle `features/agent/lib/agentApi.ts:51`). `authHeaders()` dupliqué 15×, `apiFetch()` 9×. → *Correctif :* wrapper HTTP partagé. **1 j.**

**[MINEUR] C3-03 — Fichiers serveur dans le tree client.** `src/lib/stripeClient.ts` + `paypalClient.ts` (client service-role + SDK Node). Non importés → non bundlés. → *Correctif :* déplacer dans `server/lib/`. **30 min.**

**[MINEUR] C3-04 — Appels RPC/table directs depuis des pages** (`Clients.tsx:139,141`, `Invoices.tsx:341`, `D2DDashboard.tsx:458`) au lieu de `src/lib`. Cohérent avec C3-02.

---

### CATÉGORIE 4 — INTÉGRITÉ RELATIONNELLE & CODE MORT

**[MAJEUR] C4-01 — Bug de montage `org-knowledge` : shadow de `/api` + fuite de middlewares sur 29 routers.**
**Fichier :** `server/index.ts:397` (`app.use('/api', orgKnowledgeRouter)`) + `server/routes/org-knowledge.ts:11,39,80,101` (chemins nus).
Faute de préfixe `/org-knowledge`, les routes réelles deviennent `GET/POST /api`, `DELETE /api/:id`, `POST /api/bulk`. Surtout, `router.use(maxBodySize())` + `guardCommonShape` (`:7-8`) s'appliquent à **toute** requête `/api/*` atteignant la ligne 397 → imposés à 29 routers montés après (`quotes`, `billing`, `courses`, `payroll`, `security`…). Conséquence : les **bodies tableau sont rejetés (400)** partout après la ligne 397 — y compris le propre `/bulk` d'org-knowledge, injoignable par construction. Seule `.passthrough()` dans `commonFieldsSchema` (`validation-guards.ts:62`) évite un strip global catastrophique. Pas de crossing d'isolation (handler DELETE scoped `.eq('org_id', auth.orgId)`) ; `org_knowledge` est du **code mort** (0 ligne prod, 0 appelant). → *Correctif :* `app.use('/api/org-knowledge', orgKnowledgeRouter)` ou supprimer le router. **5 min.**

**[MINEUR] C4-02 — Routers morts (non montés) :** `campaigns.ts`, `booking.ts`, `recurring-invoices.ts`, `webhooks-config.ts`, `quickbooks-export.ts`. `booking` mort des deux côtés ; les 2 autres appelés par le front → 404 (C3-01). → *Correctif :* monter ou supprimer. **1 h.**

**[MINEUR] C4-03 — Fonctions orphelines de l'ère `leads`.** Table `leads` supprimée (`20260705000000:1269`) mais ~12 fonctions subsistent (`create_lead_with_client`, `delete_lead_cascade`, `restore_lead`, `anonymize_lead`, `create_job_from_lead`, `trg_leads_fts_update`…). → *Correctif :* `DROP FUNCTION` groupé (confiance élevée). **1 h.**

**[MINEUR] C4-04 — `security_canary_runs` : RLS + FORCE mais 0 policy.** Verrouillée à tout sauf BYPASSRLS. Probablement volontaire (canary interne) — à documenter.

**[MINEUR] C4-05 — Résidu « director panel » (module AI déprécié).** Migration `20260420000000_director_panel.sql` (table + bucket `director-panel`) toujours en prod ; bucket passé privé mais jamais supprimé. Candidat suppression **si le module est bien abandonné** (à confirmer côté produit).

**Points positifs vérifiés :** 564 FK dont **130 composites `_same_org`** — une FK vers une ligne d'un autre tenant est structurellement impossible sur ces 130 relations (ex. `satisfaction_surveys_client_id_same_org FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)`). Pattern anti-cross-tenant exemplaire.

---

## 5. PLAN DE CORRECTION (ordonné par impact ÷ effort)

### 🔴 Bloqueurs V1 (avant tout client payant) — ~45 min de SQL + 1 décision

| # | Correctif | Effort | Impact |
|---|---|---|---|
| C1-01 | `DROP POLICY quote_line_items_public_read` | 5 min | Ferme la fuite cross-tenant des prix de devis |
| C1-02 | `DROP POLICY surveys_update_anon` (bon nom de table) | 5 min | Ferme l'écriture anon cross-tenant des sondages |
| C1-03 | `DROP POLICY quote_views_insert_anon` | 5 min | Ferme l'insertion anon / oracle d'ID |
| C1-06 | Vue restreinte `plans` + révoquer SELECT anon table brute | 30 min | Réduit disclosure + coupe l'enabler de C1-05 |
| C1-05 | Séparer secrets webhook + rejeter `event.account` + valider `amount_total` | 2–3 h | Ferme l'auto-provisionnement / hijack facturation |

### 🟠 Haute priorité (semaine 1)

| # | Correctif | Effort |
|---|---|---|
| C1-04 | Re-préfixer 4 flux d'upload sous `${orgId}/`, backfill, retirer branche legacy | 2–4 h |
| C4-01 | Corriger le montage `org-knowledge` (ou supprimer) | 5 min |
| C3-01 | Monter ou retirer `recurring-invoices` + `quickbooks-export` | 15 min–1 h |
| C1-07 | Chiffrer `gps_providers.config` + policy admin-only | 2 h |
| C2-01 | Supprimer `complete_schema.sql` périmé | 10 min |
| C1-09 | Rédiger email/phone dans les logs + renommer la clé `VITE_` | 30 min |

### 🟡 Dette (mois 1)

C2-03 (Zod sur endpoints publics) · C1-08 (décision chiffrement PII) · C3-02/03 (client HTTP partagé, déplacer fichiers serveur) · C4-02/03/05 (nettoyage code mort) · C2-04/05/06 (hygiène, triggers dupliqués, colonnes argent legacy).

---

## 6. CE QUE JE N'AI PAS PU VÉRIFIER

1. **Exploitabilité réelle de C1-05** — dépend des **types d'events souscrits** sur l'endpoint webhook Connect (dashboard Stripe). Invisible depuis le repo. *Manque :* Stripe → Developers → Webhooks → endpoint Connect → événements écoutés.
2. **État live des GRANTs PostgreSQL** — `SCHEMA_SNAPSHOT.md` n'a pas de section GRANTs. Les verdicts « anon peut… » supposent le `GRANT ALL … TO anon` par défaut de Supabase, révoqué seulement pour 5 tables (`20260717230000_lock_serveronly_tables.sql:38`). *Manque :* dump `information_schema.role_table_grants`.
3. **Exécution effective des tests d'isolation** — les tests SQL de preuve (C1-01/02/04) sont **écrits mais non exécutés** (lecture seule). *Manque :* staging + clé anon.
4. **`director-panel` réellement abandonné (C4-05)** — décision produit, non déductible du code.
5. **Types TS front vs schéma DB, ligne à ligne** — vérification par échantillon (79 tables, 46 RPC). Une divergence de champ isolée a pu échapper. *Manque :* comparaison automatisée types générés ↔ snapshot.
6. **`complete_schema.sql` volontairement ignoré** (périmé de 185 tables) — je me suis appuyé exclusivement sur le snapshot de prod + migrations.
7. **Dépendances npm vulnérables** — non auditées (`npm audit` non lancé). *Manque :* sortie `npm audit --json`.
