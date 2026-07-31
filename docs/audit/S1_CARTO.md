# S1 — Cartographie des accès base de données

**Périmètre analysé** : copie exacte de `origin/main`, commit `9680ec5` (« Securite: desactive le commutateur de role en production ») — le code réellement déployé en production.
**Méthode** : lecture de code source uniquement. Aucun accès réseau à la base. Aucune valeur de secret n'est reproduite ici.
**Date de la passe** : 2026-07-30.

> ⚠️ **Cette version remplace intégralement la précédente.** La passe antérieure avait analysé un répertoire de travail en retard de 741 commits sur la branche déployée et avait produit 7 findings de fuite cross-tenant tous faux : les gardes existaient déjà sur `main`. Chaque finding ci-dessous est accompagné de l'extrait exact qui le prouve, et pour chaque route déclarée vulnérable la **ligne manquante** est écrite explicitement.

---

## 0. Couverture réelle

| Élément | Compte |
|---|---|
| Fichiers de routes dans `server/routes/` | 69 |
| Fichiers **montés** dans `server/index.ts` | 64 |
| Fichiers **non montés** (code mort HTTP) | 5 |
| Handlers HTTP totaux détectés dans `server/routes/` | 447 |
| Handlers **atteignables** (fichiers montés) | 413 |
| Handlers dans les fichiers non montés (inatteignables) | 34 |
| Handlers **lus ligne à ligne** pendant cette passe | ≈ 120 |
| Handlers classés par motif automatisé (voir §2, légende) | ≈ 293 |
| Points d'instanciation d'un client Supabase (serveur) | 6 |
| Appels `getServiceClient()` dans `server/` | 458 |
| Appels `requireAuthedClient(req, …)` dans `server/` | 360 |

**Honnêteté sur la couverture** : 120 handlers sur 413 ont été relus intégralement, en priorisant (a) toute route où l'`org_id` peut venir du client, (b) toute route `getServiceClient()` sans `.eq('org_id', …)` visible dans le corps du handler, (c) toutes les routes publiques/token. Les ~293 restants sont classés par détection de motif ; leur ligne de garde est citée dans le tableau §2 mais **n'a pas été relue en contexte**. Ne pas les considérer comme « prouvés sûrs ».

---

## 1. Points d'instanciation d'un client base de données

### 1.1 Serveur (`server/`)

| # | Fichier:ligne | Clé utilisée | Portée | Note |
|---|---|---|---|---|
| 1 | `server/lib/supabase.ts:10` | **anon** + JWT utilisateur forwardé | par requête | `createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authorizationHeader } } })` — c'est **le seul client soumis à la RLS**. Créé à chaque appel de `requireAuthedClient`, jamais mis en cache → pas de fuite de session inter-requêtes. |
| 2 | `server/lib/supabaseAdmin.ts:14` | **service_role** | **cache module** (`cachedAdminClient`) | Instance unique réutilisée par tout le processus. Aucun token utilisateur porté → cache sain. |
| 3 | `server/lib/supabase.ts:16-24` | **service_role** (via #2) | cache module (`adminClientCache`) | `getServiceClient()` — **contourne la RLS**. 458 appels. |
| 4 | `server/routes/auth.ts:25` | **service_role** | nouvelle instance par appel | `getAdminClient()` local au routeur d'inscription. |
| 5 | `server/lib/integrations/service.ts:19-23` | **service_role** | nouvelle instance **par appel** | `getDb()` lit `process.env.SUPABASE_SERVICE_ROLE_KEY` directement, sans passer par `config.ts` ni `getServiceClient()`. Duplication du chemin privilégié. |
| 6 | `server/lib/scheduler.ts:584` et `server/index.ts:758` | **service_role** | démons de fond | Client des tâches planifiées / moteur d'automatisation. Pas de contexte utilisateur par construction. |

Extrait clé (`server/lib/supabase.ts:9-24`) :

```ts
export function buildSupabaseWithAuth(authorizationHeader: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorizationHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getServiceClient() {
  if (!supabaseServiceRoleKey) { throw new Error('SUPABASE_SERVICE_ROLE_KEY is required …'); }
  if (!adminClientCache) { adminClientCache = getSupabaseAdminClient(supabaseUrl, supabaseServiceRoleKey); }
  return adminClientCache;
}
```

### 1.2 Frontend (`src/`)

| Fichier:ligne | Clé | Note |
|---|---|---|
| `src/lib/supabase.ts:14` | **anon** (`VITE_SUPABASE_ANON_KEY`), `flowType: 'pkce'`, session en `localStorage` sous `lume-auth-token` | Client navigateur. **78 tables/vues distinctes** sont interrogées directement depuis `src/` via ce client → toute l'isolation de ces 78 objets repose sur la RLS, pas sur l'API Express. |
| `src/lib/stripeClient.ts:15` | **service_role** (passée en argument) | ⚠️ Fichier physiquement dans `src/` mais importé **uniquement côté serveur** (`server/lib/payments.ts:5`). Vérifié : aucun fichier de `src/` ne l'importe → il ne part pas dans le bundle Vite. Emplacement trompeur, à déplacer sous `server/`. |
| `src/lib/paypalClient.ts:22` | **service_role** (passée en argument) | Idem, importé par `server/lib/payments.ts:6` seulement. |

### 1.3 Autres moteurs

* **Aucun** `new Pool`, `postgres(`, `drizzle`, `prisma`, `knex` dans `server/` ni `src/`.
* Le paquet `pg` (`package.json:87`) n'est utilisé que par des scripts hors-runtime : `scripts/test-rls-isolation.ts:19`, `scripts/apply-migration.ts:4`, etc. Pas de connexion Postgres directe dans le serveur applicatif.

---

## 2. Tableau de toutes les routes API montées

### Ce qui est monté, et dans quel ordre

`server/index.ts` monte 64 routeurs sous `/api` (lignes 357-463), plus :

* `server/index.ts:273` et `:276` — `POST /api/webhooks/stripe` et `/api/webhooks/stripe-connect`, montés **avant** `express.json()` (raw body requis pour la signature).
* `server/index.ts:416` — `app.use('/', quoteRedirectRouter)` → `GET /q/:token` à la racine.
* `server/index.ts:480` — `POST /api/workflows/execute-action` défini **inline dans `index.ts`**, pas dans un fichier de routes. Il fait `requireAuthedClient` puis `getServiceClient()` et passe `orgId: auth.orgId` au contexte d'action (`index.ts:494`). Seule route applicative hors `server/routes/`.
* `server/index.ts:210` `/api/__build`, `:675` `/api/health`.

Chaînes globales appliquées avant les routeurs : CSRF par en-tête (`:229-240`), rate-limiting mémoire + Redis (`:314-352`), `mfaEnforcementMiddleware()` (`:359`), `rbacMiddleware()` (`:362`).

### Code mort HTTP — 5 fichiers, 34 handlers inatteignables

`server/index.ts:51-52` le documente :

```ts
// Removed: campaigns / booking / recurring-invoices / webhooks-config /
// quickbooks-export — corresponding UI features deleted.
```

| Fichier | Handlers | Encore chargé au runtime ? |
|---|---|---|
| `server/routes/campaigns.ts` | 10 | **Oui** — `server/routes/cron.ts:79` fait `await import('./campaigns.js')` pour récupérer `processCampaign`. Le module s'exécute, son `Router()` n'est jamais monté. |
| `server/routes/booking.ts` | 8 | Non |
| `server/routes/webhooks-config.ts` | 7 | Non |
| `server/routes/recurring-invoices.ts` | 5 | Non |
| `server/routes/quickbooks-export.ts` | 4 | Non |

Ces 34 handlers **ne sont pas exclus de l'audit DB** : leur code contient encore des requêtes `service_role` qui redeviendraient atteignables au premier `app.use('/api', campaignsRouter)`.

### Légende du tableau

* **Client utilisé** : `service_role (Lxx)` = ligne du `getServiceClient()` → **RLS contournée** ; `JWT user (Lxx)` = client issu de `requireAuthedClient`, RLS active.
* **Origine de l'org_id** : `session` = dérivé du JWT via `requireAuthedClient` ; `**client**` = lu dans le body/query (toujours suivi d'une re-validation, voir §3) ; `token/secret public` = route non authentifiée protégée par un jeton porteur.
* **Garde constatée** : première ligne détectée pour chaque mécanisme. `cmp org_id` = comparaison explicite `row.org_id !== auth.orgId`. `membre/rôle` = `isOrgMember` / `isOrgAdminOrOwner` / `has_org_admin_role` / `canEditCourse` / `canViewCourse`.
* Les lignes citées sont des **numéros de ligne réels** dans le fichier indiqué — vérifiables par lecture directe.
* Deux artefacts de détection connus : `GET /api/search` et `GET /api/search/suggestions` (`server/routes/search.ts:364-365`) délèguent à `handleSuggestions`, dont l'authentification est à `server/routes/search.ts:289` ; les routes de `cron.ts` sont gardées par `checkCronAuth()` (`server/routes/cron.ts:21-46`, comparaison `timingSafeEqual` sur `CRON_SECRET`), helper que le détecteur ne suit pas.

| Route | Source | Client utilisé | Origine org_id | Garde constatée |
|---|---|---|---|---|
| `GET /api/activity-notes` | server/routes/activity-notes.ts:17 | service_role (L28) | session (requireAuth L19) | auth L19 ; .eq(org_id) L32 |
| `POST /api/activity-notes` | server/routes/activity-notes.ts:46 | service_role (L60) + JWT user (L57) | session (requireAuth L48) | auth L48 ; membre/rôle L57 ; insert org=auth L64 |
| `DELETE /api/activity-notes/:id` | server/routes/activity-notes.ts:81 | service_role (L89) + JWT user (L102) | session (requireAuth L83) | auth L83 ; membre/rôle L102 ; .eq(org_id) L94 |
| `POST /api/agent/connect` | server/routes/agent-auth.ts:82 | — | token/secret public (L88) | token L88 |
| `POST /api/agent/webhook` | server/routes/agent-auth.ts:113 | service_role (L129) | token/secret public (L118) | insert org=auth L133 |
| `POST /api/agent/chat` | server/routes/agent.ts:22 | — | session (requireAuth L31) | auth L31 ; .eq(org_id) L46 |
| `GET /api/agreements/public/:token` | server/routes/agreements.ts:176 | service_role (L181) | token/secret public (L178) | .eq(org_id) L218 |
| `POST /api/agreements/public/sign` | server/routes/agreements.ts:293 | service_role (L304) | token/secret public (L299) | token L299 |
| `POST /api/emails/send-agreement` | server/routes/agreements.ts:374 | service_role (L400) | session (requireAuth L376) | auth L376 ; membre/rôle L384 ; .eq(org_id) L391 |
| `POST /api/agreements/send-sms` | server/routes/agreements.ts:480 | service_role (L495) | session (requireAuth L482) | auth L482 ; membre/rôle L492 ; .eq(org_id) L501 |
| `GET /api/audit-log` | server/routes/audit-log.ts:7 | service_role (L11) | session (requireAuth L9) | auth L9 ; .eq(org_id) L18 |
| `POST /api/auth/register` | server/routes/auth.ts:60 | — | — | **aucune détectée** |
| `POST /api/auth/verify-email` | server/routes/auth.ts:151 | — | — | **aucune détectée** |
| `POST /api/auth/resend-verification` | server/routes/auth.ts:212 | — | — | **aucune détectée** |
| `POST /api/auth/register-checkout` | server/routes/auth.ts:263 | — | — | **aucune détectée** |
| `POST /api/automations/events/appointment-created` | server/routes/automation-events.ts:22 | service_role (L31) | session (requireAuth L24) | auth L24 ; .eq(org_id) L42 |
| `POST /api/automations/events/appointment-cancelled` | server/routes/automation-events.ts:92 | — | session (requireAuth L94) | auth L94 |
| `POST /api/automations/events/job-completed` | server/routes/automation-events.ts:120 | service_role (L129) | session (requireAuth L122) | auth L122 ; .eq(org_id) L134 ; insert org=auth L206 |
| `POST /api/automations/events/deal-stage-changed` | server/routes/automation-events.ts:230 | service_role (L238) | session (requireAuth L232) | auth L232 ; .eq(org_id) L247 |
| `POST /api/automations/events/quote-sent` | server/routes/automation-events.ts:292 | — | session (requireAuth L294) | auth L294 |
| `POST /api/automations/events/quote-approved` | server/routes/automation-events.ts:312 | — | session (requireAuth L314) | auth L314 |
| `POST /api/automations/events/invoice-paid` | server/routes/automation-events.ts:333 | service_role (L340) | session (requireAuth L335) | auth L335 ; .eq(org_id) L345 |
| `POST /api/automations/events/lead-created` | server/routes/automation-events.ts:388 | service_role (L395) | session (requireAuth L390) | auth L390 ; .eq(org_id) L400 |
| `POST /api/automations/events/lead-status-changed` | server/routes/automation-events.ts:423 | service_role (L430) | session (requireAuth L425) | auth L425 ; .eq(org_id) L435 |
| `GET /api/automations/test` | server/routes/automation-test.ts:36 | service_role (L44) + JWT user (L40) | session (requireAuth L38) | auth L38 ; membre/rôle L40 ; .eq(org_id) L57 |
| `GET /api/billing/plans` | server/routes/billing.ts:45 | service_role (L54) | — | **aucune détectée** |
| `GET /api/billing/current` | server/routes/billing.ts:75 | service_role (L85) | session (requireAuth L82) | auth L82 ; .eq(org_id) L114 ; .in(org_id) L103 |
| `POST /api/billing/onboarding` | server/routes/billing.ts:148 | service_role (L153) | session (requireAuth L150) | auth L150 ; insert org=auth L172 |
| `POST /api/billing/subscribe` | server/routes/billing.ts:192 | service_role (L197) | session (requireAuth L194) | auth L194 ; cmp org_id L433 ; .eq(org_id) L288 ; insert org=auth L297 |
| `POST /api/billing/create-payment-intent` | server/routes/billing.ts:548 | service_role (L563) | session (requireAuth L554) | auth L554 ; .eq(org_id) L567 ; insert org=auth L574 |
| `POST /api/billing/cancel` | server/routes/billing.ts:605 | service_role (L610) | session (requireAuth L607) | auth L607 ; membre/rôle L611 ; .in(org_id) L622 |
| `POST /api/billing/change-plan` | server/routes/billing.ts:682 | service_role (L689) | session (requireAuth L686) | auth L686 ; membre/rôle L690 ; .in(org_id) L710 |
| `POST /api/billing/dev-switch-plan` | server/routes/billing.ts:940 | service_role (L951) | session (requireAuth L948) | auth L948 ; membre/rôle L952 ; .eq(org_id) L971 ; insert org=auth L998 |
| `POST /api/billing/cancel-scheduled-change` | server/routes/billing.ts:1022 | service_role (L1029) | session (requireAuth L1026) | auth L1026 ; membre/rôle L1030 ; .in(org_id) L1038 |
| `GET /api/billing/seats` | server/routes/billing.ts:1082 | service_role (L1087) | session (requireAuth L1084) | auth L1084 ; .in(org_id) L1097 |
| `POST /api/billing/seats` | server/routes/billing.ts:1145 | service_role (L1152) | session (requireAuth L1149) | auth L1149 ; membre/rôle L1153 ; .in(org_id) L1163 |
| `GET /api/billing/offices` | server/routes/billing.ts:1300 | service_role (L1305) | session (requireAuth L1302) | auth L1302 ; .in(org_id) L1314 |
| `POST /api/billing/offices` | server/routes/billing.ts:1356 | service_role (L1363) | session (requireAuth L1360) | auth L1360 ; membre/rôle L1364 ; .in(org_id) L1374 |
| `POST /api/billing/customer-portal` | server/routes/billing.ts:1477 | service_role (L1484) | session (requireAuth L1481) | auth L1481 ; .in(org_id) L1489 |
| `POST /api/billing/validate-promo` | server/routes/billing.ts:1514 | service_role (L1519) | — | **aucune détectée** |
| `POST /api/billing/create-checkout-session` | server/routes/billing.ts:1540 | service_role (L1546) | — | **aucune détectée** |
| `POST /api/billing/confirm-checkout` | server/routes/billing.ts:1763 | service_role (L1769) | — | **aucune détectée** |
| `POST /api/billing/set-initial-password` | server/routes/billing.ts:1843 | service_role (L1858) | — | **aucune détectée** |
| `POST /api/billing/complete-setup` | server/routes/billing.ts:1898 | service_role (L1902) | session (requireAuth L1900) | auth L1900 ; .eq(org_id) L1918 ; insert org=auth L1906 |
| `GET /api/billing/email-verified` | server/routes/billing.ts:1939 | service_role (L1944) | session (requireAuth L1941) | auth L1941 |
| `POST /api/billing/resend-receipt` | server/routes/billing.ts:1962 | service_role (L1967) | session (requireAuth L1964) | auth L1964 ; membre/rôle L1968 ; .in(org_id) L1983 |
| `GET /api/billing/receipt-history` | server/routes/billing.ts:2006 | service_role (L2011) | session (requireAuth L2008) | auth L2008 ; .eq(org_id) L2015 |
| `GET /api/checklist-templates` | server/routes/checklists.ts:44 | JWT user (L50) | session (requireAuth L46) | auth L46 ; .eq(org_id) L53 |
| `POST /api/checklist-templates` | server/routes/checklists.ts:68 | service_role (L73) | session (requireAuth L70) | auth L70 ; membre/rôle L74 ; insert org=auth L87 |
| `PATCH /api/checklist-templates/:id` | server/routes/checklists.ts:106 | service_role (L111) | session (requireAuth L108) | auth L108 ; membre/rôle L112 ; .eq(org_id) L132 |
| `DELETE /api/checklist-templates/:id` | server/routes/checklists.ts:146 | service_role (L151) | session (requireAuth L148) | auth L148 ; membre/rôle L152 ; .eq(org_id) L160 |
| `GET /api/jobs/:jobId/checklists` | server/routes/checklists.ts:175 | JWT user (L180) | session (requireAuth L177) | auth L177 ; .eq(org_id) L183 |
| `POST /api/jobs/:jobId/checklists` | server/routes/checklists.ts:196 | service_role (L206) | session (requireAuth L198) | auth L198 ; .eq(org_id) L213 ; insert org=auth L235 |
| `PATCH /api/jobs/:jobId/checklists/:id` | server/routes/checklists.ts:253 | service_role (L263) | session (requireAuth L255) | auth L255 ; .eq(org_id) L282 |
| `DELETE /api/jobs/:jobId/checklists/:id` | server/routes/checklists.ts:296 | service_role (L301) | session (requireAuth L298) | auth L298 ; .eq(org_id) L307 |
| `GET /api/commissions` | server/routes/commissions.ts:25 | service_role (L35) | session (requireAuth L26) | auth L26 ; membre/rôle L36 |
| `POST /api/commissions/project-for-job` | server/routes/commissions.ts:54 | service_role (L62) | session (requireAuth L55) | auth L55 |
| `POST /api/commissions/void-for-job` | server/routes/commissions.ts:73 | service_role (L81) | session (requireAuth L74) | auth L74 ; membre/rôle L94 |
| `POST /api/commissions/generate-for-invoice` | server/routes/commissions.ts:103 | service_role (L109) | session (requireAuth L104) | auth L104 |
| `POST /api/commissions/:id/mark-paid` | server/routes/commissions.ts:118 | service_role (L122) | session (requireAuth L119) | auth L119 |
| `POST /api/commissions/:id/approve` | server/routes/commissions.ts:131 | service_role (L136) | session (requireAuth L132) | auth L132 |
| `POST /api/commissions/:id/reverse` | server/routes/commissions.ts:145 | service_role (L152) | session (requireAuth L146) | auth L146 |
| `GET /api/commissions/rules` | server/routes/commissions.ts:162 | service_role (L167) | session (requireAuth L163) | auth L163 |
| `POST /api/commissions/rules` | server/routes/commissions.ts:176 | service_role (L189) | session (requireAuth L177) | auth L177 |
| `PUT /api/commissions/rules/:id` | server/routes/commissions.ts:215 | service_role (L232) | session (requireAuth L216) | auth L216 ; .eq(org_id) L237 |
| `POST /api/commissions/rules/assign-member` | server/routes/commissions.ts:251 | service_role (L260) | session (requireAuth L252) | auth L252 ; .eq(org_id) L264 |
| `DELETE /api/commissions/rules/:id` | server/routes/commissions.ts:292 | service_role (L296) | session (requireAuth L293) | auth L293 ; .eq(org_id) L299 |
| `GET /api/commissions/settings` | server/routes/commissions.ts:307 | service_role (L311) | session (requireAuth L308) | auth L308 ; .eq(org_id) L312 ; insert org=auth L313 |
| `PUT /api/commissions/settings` | server/routes/commissions.ts:320 | service_role (L325) | session (requireAuth L321) | auth L321 ; insert org=auth L326 |
| `PUT /api/commissions/rules/:id` | server/routes/commissions.ts:341 | service_role (L346) | session (requireAuth L342) | auth L342 |
| `GET /api/commissions/payroll-preview` | server/routes/commissions.ts:356 | service_role (L369) | session (requireAuth L357) | auth L357 ; membre/rôle L370 |
| `GET /api/commissions/me` | server/routes/commissions.ts:380 | service_role (L384) | session (requireAuth L381) | auth L381 ; membre/rôle L385 |
| `POST /api/communications/send-sms` | server/routes/communications.ts:33 | service_role (L48) | session (requireAuth L35) | auth L35 |
| `POST /api/communications/send-email` | server/routes/communications.ts:144 | service_role (L159) | session (requireAuth L146) | auth L146 |
| `GET /api/communications/messages` | server/routes/communications.ts:222 | service_role (L231) | session (requireAuth L224) | auth L224 ; .eq(org_id) L235 |
| `GET /api/communications/channels` | server/routes/communications.ts:256 | service_role (L262) | session (requireAuth L258) | auth L258 ; .eq(org_id) L266 |
| `GET /api/communications/settings` | server/routes/communications.ts:282 | service_role (L288) | session (requireAuth L284) | auth L284 ; .eq(org_id) L292 |
| `POST /api/communications/provision-sms` | server/routes/communications.ts:307 | — | session (requireAuth L309) | auth L309 |
| `GET /api/communications/a2p/status` | server/routes/communications.ts:346 | service_role (L352) | session (requireAuth L348) | auth L348 ; .eq(org_id) L356 |
| `POST /api/communications/a2p/submit-brand` | server/routes/communications.ts:366 | — | session (requireAuth L368) | auth L368 |
| `POST /api/communications/a2p/submit-campaign` | server/routes/communications.ts:381 | — | session (requireAuth L383) | auth L383 |
| `POST /api/communications/a2p/refresh` | server/routes/communications.ts:396 | — | session (requireAuth L398) | auth L398 |
| `POST /api/connect/create-account` | server/routes/connect.ts:18 | JWT user (L24) | **client** (L23) → puis re-validé | auth L20 ; membre/rôle L24 |
| `POST /api/connect/create-onboarding-link` | server/routes/connect.ts:38 | JWT user (L44) | **client** (L43) → puis re-validé | auth L40 ; membre/rôle L44 |
| `POST /api/connect/refresh-onboarding-link` | server/routes/connect.ts:60 | JWT user (L66) | **client** (L65) → puis re-validé | auth L62 ; membre/rôle L66 |
| `POST /api/connect/dashboard-link` | server/routes/connect.ts:82 | JWT user (L88) | **client** (L87) → puis re-validé | auth L84 ; membre/rôle L88 |
| `GET /api/connect/account-status` | server/routes/connect.ts:100 | JWT user (L106) | **client** (L105) → puis re-validé | auth L102 ; membre/rôle L106 |
| `GET /api/courses` | server/routes/courses.ts:204 | service_role (L210) | session (requireAuth L207) | auth L207 ; .eq(org_id) L216 |
| `GET /api/courses/my-role` | server/routes/courses.ts:305 | service_role (L309) | session (requireAuth L307) | auth L307 ; .eq(org_id) L314 |
| `GET /api/courses/org-members` | server/routes/courses.ts:325 | service_role (L329) | session (requireAuth L327) | auth L327 ; .eq(org_id) L334 |
| `GET /api/courses/progress/summary` | server/routes/courses.ts:344 | service_role (L348) | session (requireAuth L346) | auth L346 |
| `GET /api/courses/:id` | server/routes/courses.ts:389 | service_role (L397) | session (requireAuth L395) | auth L395 ; membre/rôle L410 ; .eq(org_id) L403 |
| `POST /api/courses` | server/routes/courses.ts:449 | service_role (L454) | session (requireAuth L452) | auth L452 ; insert org=auth L458 |
| `PATCH /api/courses/:id` | server/routes/courses.ts:484 | service_role (L488) | session (requireAuth L486) | auth L486 ; .eq(org_id) L507 |
| `DELETE /api/courses/:id` | server/routes/courses.ts:518 | service_role (L522) | session (requireAuth L520) | auth L520 ; .eq(org_id) L528 |
| `POST /api/courses/:id/duplicate` | server/routes/courses.ts:540 | service_role (L544) | session (requireAuth L542) | auth L542 ; .eq(org_id) L550 ; insert org=auth L559 |
| `POST /api/courses/:courseId/modules` | server/routes/courses.ts:619 | service_role (L623) | session (requireAuth L621) | auth L621 ; .eq(org_id) L626 |
| `PATCH /api/courses/modules/:id` | server/routes/courses.ts:646 | service_role (L650) | session (requireAuth L648) | auth L648 ; membre/rôle L656 ; cmp org_id L660 |
| `DELETE /api/courses/modules/:id` | server/routes/courses.ts:680 | service_role (L684) | session (requireAuth L682) | auth L682 ; membre/rôle L689 ; cmp org_id L693 |
| `PUT /api/courses/:courseId/modules/reorder` | server/routes/courses.ts:704 | service_role (L708) | session (requireAuth L706) | auth L706 |
| `POST /api/courses/modules/:moduleId/lessons` | server/routes/courses.ts:742 | service_role (L746) | session (requireAuth L744) | auth L744 ; membre/rôle L751 |
| `PATCH /api/courses/lessons/:id` | server/routes/courses.ts:783 | service_role (L787) | session (requireAuth L785) | auth L785 ; membre/rôle L792 |
| `DELETE /api/courses/lessons/:id` | server/routes/courses.ts:815 | service_role (L819) | session (requireAuth L817) | auth L817 ; membre/rôle L824 |
| `POST /api/courses/lessons/:id/duplicate` | server/routes/courses.ts:836 | service_role (L840) | session (requireAuth L838) | auth L838 ; membre/rôle L845 |
| `PUT /api/courses/modules/:moduleId/lessons/reorder` | server/routes/courses.ts:881 | service_role (L885) | session (requireAuth L883) | auth L883 ; membre/rôle L890 |
| `POST /api/courses/:id/assign` | server/routes/courses.ts:910 | service_role (L914) | session (requireAuth L912) | auth L912 ; cmp org_id L918 |
| `DELETE /api/courses/assignments/:id` | server/routes/courses.ts:941 | service_role (L945) | session (requireAuth L943) | auth L943 ; cmp org_id L951 |
| `GET /api/courses/:id/progress` | server/routes/courses.ts:966 | service_role (L970) | session (requireAuth L968) | auth L968 |
| `POST /api/courses/progress` | server/routes/courses.ts:985 | service_role (L989) | session (requireAuth L987) | auth L987 ; cmp org_id L1011 |
| `GET /api/courses/:id/team-progress` | server/routes/courses.ts:1046 | service_role (L1050) | session (requireAuth L1048) | auth L1048 ; .eq(org_id) L1096 |
| `POST /api/cron/retention` | server/routes/cron.ts:48 | service_role (L50) | — | **aucune détectée** |
| `POST /api/cron/purge-audit` | server/routes/cron.ts:57 | service_role (L59) | — | **aucune détectée** |
| `POST /api/cron/campaigns` | server/routes/cron.ts:66 | service_role (L69) | — | **aucune détectée** |
| `POST /api/cron/recurring-invoices` | server/routes/cron.ts:97 | service_role (L100) | — | **aucune détectée** |
| `POST /api/cron/webhook-retries` | server/routes/cron.ts:111 | — | token/secret public (L122) | token L122 |
| `POST /api/cron/release-sms-numbers` | server/routes/cron.ts:125 | — | token/secret public (L128) | token L128 |
| `GET /api/dsr/export/me` | server/routes/dsr.ts:31 | service_role (L35) | session (requireAuth L32) | auth L32 |
| `GET /api/dsr/export/client/:id` | server/routes/dsr.ts:61 | service_role (L68) | session (requireAuth L62) | auth L62 ; cmp org_id L83 |
| `POST /api/dsr/erase/client/:id` | server/routes/dsr.ts:106 | service_role (L118) | session (requireAuth L107) | auth L107 |
| `POST /api/dsr/erase/lead/:id` | server/routes/dsr.ts:128 | service_role (L143) | session (requireAuth L129) | auth L129 |
| `POST /api/dsr/request` | server/routes/dsr.ts:153 | service_role (L165) | session (requireAuth L154) | auth L154 ; insert org=auth L169 |
| `POST /api/dsr/consent` | server/routes/dsr.ts:187 | service_role (L196) | — | .eq(org_id) L206 |
| `GET /api/email/accounts` | server/routes/email-accounts.ts:80 | — | session (requireAuth L82) | auth L82 |
| `POST /api/email/:provider/connect` | server/routes/email-accounts.ts:92 | — | session (requireAuth L94) | auth L94 |
| `GET /api/email/:provider/callback` | server/routes/email-accounts.ts:117 | — | — | **aucune détectée** |
| `POST /api/email/accounts/:id/disconnect` | server/routes/email-accounts.ts:152 | — | session (requireAuth L154) | auth L154 |
| `POST /api/email/accounts/:id/sync` | server/routes/email-accounts.ts:164 | — | session (requireAuth L166) | auth L166 |
| `GET /api/email/accounts/:id/threads` | server/routes/email-accounts.ts:188 | service_role (L199) | session (requireAuth L190) | auth L190 |
| `GET /api/email/threads/:threadId` | server/routes/email-accounts.ts:215 | service_role (L220) | session (requireAuth L217) | auth L217 |
| `POST /api/email/send` | server/routes/email-accounts.ts:250 | service_role (L265) | session (requireAuth L252) | auth L252 |
| `GET /api/email/messages/:messageId/attachments/:attachmentId` | server/routes/email-accounts.ts:318 | service_role (L323) | session (requireAuth L320) | auth L320 |
| `GET /api/email-templates` | server/routes/email-templates.ts:14 | service_role (L19) | session (requireAuth L16) | auth L16 ; .eq(org_id) L24 |
| `GET /api/email-templates/:id` | server/routes/email-templates.ts:43 | service_role (L49) | session (requireAuth L45) | auth L45 ; .eq(org_id) L55 |
| `POST /api/email-templates` | server/routes/email-templates.ts:68 | service_role (L73) | session (requireAuth L70) | auth L70 ; .eq(org_id) L82 |
| `PUT /api/email-templates/:id` | server/routes/email-templates.ts:111 | service_role (L117) | session (requireAuth L113) | auth L113 ; .eq(org_id) L126 |
| `POST /api/email-templates/:id/duplicate` | server/routes/email-templates.ts:157 | service_role (L163) | session (requireAuth L159) | auth L159 ; .eq(org_id) L170 |
| `POST /api/email-templates/:id/set-default` | server/routes/email-templates.ts:203 | service_role (L209) | session (requireAuth L205) | auth L205 ; .eq(org_id) L216 |
| `DELETE /api/email-templates/:id` | server/routes/email-templates.ts:248 | service_role (L254) | session (requireAuth L250) | auth L250 ; .eq(org_id) L260 |
| `POST /api/emails/send-invoice` | server/routes/emails.ts:156 | service_role (L203) + JWT user (L277) | session (requireAuth L158) | auth L158 ; membre/rôle L167 ; .eq(org_id) L175 |
| `POST /api/emails/send-quote` | server/routes/emails.ts:330 | JWT user (L413) | session (requireAuth L332) | auth L332 ; membre/rôle L338 ; .eq(org_id) L346 |
| `POST /api/emails/send-mobile-quote` | server/routes/emails.ts:437 | — | session (requireAuth L439) | auth L439 ; membre/rôle L446 ; .eq(org_id) L453 |
| `POST /api/emails/send-custom` | server/routes/emails.ts:506 | JWT user (L511) | session (requireAuth L508) | auth L508 ; membre/rôle L511 |
| `GET /api/features` | server/routes/feature-flags.ts:9 | JWT user (L14) | session (requireAuth L11) | auth L11 ; .eq(org_id) L17 |
| `PUT /api/features/:feature` | server/routes/feature-flags.ts:36 | service_role (L49) | session (requireAuth L38) | auth L38 ; membre/rôle L50 ; insert org=auth L60 |
| `GET /api/houses` | server/routes/field-sales.ts:70 | service_role (L73) | session (requireAuth L71) | auth L71 ; .eq(org_id) L106 |
| `GET /api/houses/:id` | server/routes/field-sales.ts:142 | service_role (L145) | session (requireAuth L143) | auth L143 ; .eq(org_id) L155 |
| `POST /api/houses` | server/routes/field-sales.ts:219 | service_role (L222) | session (requireAuth L220) | auth L220 ; membre/rôle L237 ; .eq(org_id) L242 ; insert org=auth L294 |
| `PUT /api/houses/:id` | server/routes/field-sales.ts:466 | service_role (L469) | session (requireAuth L467) | auth L467 ; .eq(org_id) L498 |
| `DELETE /api/houses/:id` | server/routes/field-sales.ts:512 | service_role (L515) | session (requireAuth L513) | auth L513 ; .eq(org_id) L525 |
| `POST /api/houses/:id/link` | server/routes/field-sales.ts:557 | service_role (L560) | session (requireAuth L558) | auth L558 ; .eq(org_id) L574 ; insert org=auth L592 |
| `POST /api/houses/:id/events` | server/routes/field-sales.ts:618 | service_role (L621) | session (requireAuth L619) | auth L619 ; .eq(org_id) L635 ; insert org=auth L647 |
| `DELETE /api/events/:eventId` | server/routes/field-sales.ts:798 | service_role (L801) | session (requireAuth L799) | auth L799 ; .eq(org_id) L809 |
| `GET /api/territories` | server/routes/field-sales.ts:825 | service_role (L828) | session (requireAuth L826) | auth L826 ; .eq(org_id) L837 |
| `POST /api/territories` | server/routes/field-sales.ts:851 | service_role (L854) | session (requireAuth L852) | auth L852 ; insert org=auth L863 |
| `PUT /api/territories/:id` | server/routes/field-sales.ts:883 | service_role (L886) | session (requireAuth L884) | auth L884 ; .eq(org_id) L903 |
| `DELETE /api/territories/:id` | server/routes/field-sales.ts:917 | service_role (L920) | session (requireAuth L918) | auth L918 ; .eq(org_id) L930 |
| `GET /api/stats` | server/routes/field-sales.ts:942 | service_role (L945) | session (requireAuth L943) | auth L943 ; .eq(org_id) L956 |
| `GET /api/stats/daily` | server/routes/field-sales.ts:1008 | service_role (L1011) | session (requireAuth L1009) | auth L1009 ; .eq(org_id) L1022 |
| `GET /api/stats/leaderboard` | server/routes/field-sales.ts:1040 | service_role (L1043) | session (requireAuth L1041) | auth L1041 ; .eq(org_id) L1057 |
| `GET /api/settings` | server/routes/field-sales.ts:1103 | service_role (L1106) | session (requireAuth L1104) | auth L1104 ; .eq(org_id) L1115 ; insert org=auth L1123 |
| `PUT /api/settings` | server/routes/field-sales.ts:1146 | service_role (L1149) | session (requireAuth L1147) | auth L1147 ; insert org=auth L1167 |
| `GET /api/pins` | server/routes/field-sales.ts:1189 | service_role (L1192) | session (requireAuth L1190) | auth L1190 ; .eq(org_id) L1206 |
| `GET /api/reps` | server/routes/field-sales.ts:1283 | service_role (L1286) | session (requireAuth L1284) | auth L1284 ; .eq(org_id) L1289 |
| `POST /api/reps` | server/routes/field-sales.ts:1296 | service_role (L1299) | session (requireAuth L1297) | auth L1297 ; insert org=auth L1304 |
| `PUT /api/reps/:id` | server/routes/field-sales.ts:1312 | service_role (L1315) | session (requireAuth L1313) | auth L1313 ; .eq(org_id) L1321 |
| `DELETE /api/reps/:id` | server/routes/field-sales.ts:1328 | service_role (L1331) | session (requireAuth L1329) | auth L1329 ; .eq(org_id) L1335 |
| `GET /api/teams` | server/routes/field-sales.ts:1341 | service_role (L1344) | session (requireAuth L1342) | auth L1342 ; .eq(org_id) L1348 |
| `POST /api/teams` | server/routes/field-sales.ts:1355 | service_role (L1358) | session (requireAuth L1356) | auth L1356 ; insert org=auth L1363 |
| `GET /api/ai/territory/recommendations` | server/routes/field-sales.ts:1382 | service_role (L1385) | session (requireAuth L1383) | auth L1383 ; .eq(org_id) L1396 |
| `POST /api/ai/schedule/recommendations` | server/routes/field-sales.ts:1451 | service_role (L1454) | session (requireAuth L1452) | auth L1452 ; insert org=auth L1461 |
| `GET /api/ai/follow-ups` | server/routes/field-sales.ts:1480 | service_role (L1483) | session (requireAuth L1481) | auth L1481 |
| `GET /api/ai/daily-plan` | server/routes/field-sales.ts:1507 | service_role (L1510) | session (requireAuth L1508) | auth L1508 |
| `GET /api/ai/territory-assignments` | server/routes/field-sales.ts:1536 | service_role (L1539) | session (requireAuth L1537) | auth L1537 |
| `POST /api/ai/recalculate` | server/routes/field-sales.ts:1555 | service_role (L1558) | session (requireAuth L1556) | auth L1556 |
| `POST /api/auto-pin` | server/routes/field-sales.ts:1573 | service_role (L1576) | session (requireAuth L1574) | auth L1574 ; insert org=auth L1585 |
| `POST /api/pin-from-entity` | server/routes/field-sales.ts:1615 | service_role (L1618) | session (requireAuth L1616) | auth L1616 ; .eq(org_id) L1637 ; insert org=auth L1681 |
| `GET /api/operating-profile` | server/routes/field-sales.ts:1705 | service_role (L1708) | session (requireAuth L1706) | auth L1706 ; .eq(org_id) L1714 ; insert org=auth L1719 |
| `PUT /api/operating-profile` | server/routes/field-sales.ts:1744 | service_role (L1747) | session (requireAuth L1745) | auth L1745 ; insert org=auth L1756 |
| `GET /api/pipeline` | server/routes/field-sales.ts:1781 | service_role (L1784) | session (requireAuth L1782) | auth L1782 ; .eq(org_id) L1798 |
| `PUT /api/pipeline/:id` | server/routes/field-sales.ts:1848 | service_role (L1851) | session (requireAuth L1849) | auth L1849 ; .eq(org_id) L1877 |
| `GET /api/pipeline/reps` | server/routes/field-sales.ts:1889 | service_role (L1892) | session (requireAuth L1890) | auth L1890 ; .eq(org_id) L1898 |
| `POST /api/field-sessions/start` | server/routes/field-sessions.ts:23 | service_role (L33) | session (requireAuth L24) | auth L24 |
| `POST /api/field-sessions/:id/end` | server/routes/field-sessions.ts:51 | service_role (L61) | session (requireAuth L52) | auth L52 |
| `POST /api/field-sessions/:id/pause` | server/routes/field-sessions.ts:70 | service_role (L75) | session (requireAuth L71) | auth L71 |
| `POST /api/field-sessions/:id/resume` | server/routes/field-sessions.ts:84 | service_role (L89) | session (requireAuth L85) | auth L85 |
| `POST /api/field-sessions/:id/gps` | server/routes/field-sessions.ts:98 | service_role (L108) | session (requireAuth L99) | auth L99 |
| `GET /api/field-sessions/:id/trail` | server/routes/field-sessions.ts:119 | service_role (L124) | session (requireAuth L120) | auth L120 |
| `GET /api/field-sessions/active` | server/routes/field-sessions.ts:133 | service_role (L138) | session (requireAuth L134) | auth L134 |
| `GET /api/field-sessions/active/all` | server/routes/field-sessions.ts:147 | service_role (L152) | session (requireAuth L148) | auth L148 |
| `GET /api/field-sessions/history` | server/routes/field-sessions.ts:161 | service_role (L174) | session (requireAuth L162) | auth L162 |
| `GET /api/gamification/badges` | server/routes/gamification.ts:23 | service_role (L28) | session (requireAuth L24) | auth L24 |
| `POST /api/gamification/badges` | server/routes/gamification.ts:37 | service_role (L47) | session (requireAuth L38) | auth L38 |
| `GET /api/gamification/badges/rep/:userId` | server/routes/gamification.ts:58 | service_role (L63) | session (requireAuth L59) | auth L59 |
| `GET /api/gamification/challenges` | server/routes/gamification.ts:74 | service_role (L79) | session (requireAuth L75) | auth L75 |
| `POST /api/gamification/challenges` | server/routes/gamification.ts:88 | service_role (L98) | session (requireAuth L89) | auth L89 |
| `POST /api/gamification/challenges/:id/join` | server/routes/gamification.ts:111 | service_role (L116) | session (requireAuth L112) | auth L112 |
| `GET /api/gamification/battles` | server/routes/gamification.ts:127 | service_role (L132) | session (requireAuth L128) | auth L128 |
| `POST /api/gamification/battles` | server/routes/gamification.ts:141 | service_role (L151) | session (requireAuth L142) | auth L142 |
| `POST /api/geocode-job` | server/routes/geocode.ts:9 | — | session (requireAuth L11) | auth L11 ; .eq(org_id) L29 |
| `POST /api/geocode-batch` | server/routes/geocode.ts:82 | JWT user (L118) | session (requireAuth L84) | auth L84 ; .eq(org_id) L93 |
| `GET /api/goals` | server/routes/goals.ts:10 | service_role (L14) | session (requireAuth L12) | auth L12 ; .eq(org_id) L16 |
| `POST /api/goals` | server/routes/goals.ts:26 | service_role (L30) | session (requireAuth L28) | auth L28 ; insert org=auth L35 |
| `DELETE /api/goals/:id` | server/routes/goals.ts:47 | service_role (L51) | session (requireAuth L49) | auth L49 ; .eq(org_id) L52 |
| `GET /api/goals/progress` | server/routes/goals.ts:61 | service_role (L65) | session (requireAuth L63) | auth L63 ; .eq(org_id) L70 |
| `POST /api/incidents` | server/routes/incidents.ts:25 | service_role (L35) | session (requireAuth L26) | auth L26 |
| `GET /api/incidents` | server/routes/incidents.ts:54 | service_role (L58) | session (requireAuth L55) | auth L55 ; .eq(org_id) L62 |
| `GET /api/incidents/:id` | server/routes/incidents.ts:75 | service_role (L82) | session (requireAuth L76) | auth L76 ; .eq(org_id) L85 |
| `PATCH /api/incidents/:id` | server/routes/incidents.ts:107 | service_role (L121) | session (requireAuth L108) | auth L108 ; cmp org_id L126 |
| `POST /api/incidents/:id/timeline` | server/routes/incidents.ts:147 | service_role (L157) | session (requireAuth L148) | auth L148 ; cmp org_id L160 |
| `GET /api/incidents/anomalies` | server/routes/incidents.ts:176 | service_role (L188) | session (requireAuth L177) | auth L177 |
| `POST /api/incidents/failed-login` | server/routes/incidents.ts:200 | service_role (L207) | — | **aucune détectée** |
| `GET /api/integrations` | server/routes/integrations.ts:31 | — | session (requireAuth L33) | auth L33 |
| `GET /api/integrations/native-status` | server/routes/integrations.ts:48 | — | session (requireAuth L50) | auth L50 |
| `GET /api/integrations/:appId/status` | server/routes/integrations.ts:96 | — | session (requireAuth L98) | auth L98 |
| `GET /api/integrations/:appId/provider` | server/routes/integrations.ts:109 | — | — | **aucune détectée** |
| `GET /api/integrations-providers` | server/routes/integrations.ts:126 | — | — | **aucune détectée** |
| `POST /api/integrations/:appId/connect/oauth` | server/routes/integrations.ts:136 | — | session (requireAuth L138) | auth L138 |
| `GET /api/integrations/:appId/callback` | server/routes/integrations.ts:170 | — | — | **aucune détectée** |
| `POST /api/integrations/:appId/connect/credentials` | server/routes/integrations.ts:215 | — | session (requireAuth L217) | auth L217 |
| `POST /api/integrations/:appId/test` | server/routes/integrations.ts:255 | — | session (requireAuth L257) | auth L257 |
| `POST /api/integrations/:appId/disconnect` | server/routes/integrations.ts:268 | — | session (requireAuth L270) | auth L270 |
| `POST /api/integrations/:appId/refresh` | server/routes/integrations.ts:286 | — | session (requireAuth L288) | auth L288 |
| `GET /api/invitations/list` | server/routes/invitations.ts:142 | service_role (L147) | session (requireAuth L144) | auth L144 ; .eq(org_id) L153 |
| `POST /api/invitations/send` | server/routes/invitations.ts:223 | service_role (L229) | **client** (L241) → puis re-validé | auth L225 ; membre/rôle L230 ; cmp org_id L241 ; .eq(org_id) L267 ; .in(org_id) L300 |
| `POST /api/invitations/accept` | server/routes/invitations.ts:409 | service_role (L412) | — | .eq(org_id) L478 |
| `GET /api/invitations/verify/:token` | server/routes/invitations.ts:574 | service_role (L581) | token/secret public (L576) | token L576 |
| `POST /api/invitations/resend` | server/routes/invitations.ts:622 | service_role (L627) | session (requireAuth L624) | auth L624 ; membre/rôle L628 ; .eq(org_id) L640 |
| `POST /api/invitations/revoke` | server/routes/invitations.ts:703 | service_role (L708) | session (requireAuth L705) | auth L705 ; membre/rôle L709 ; .eq(org_id) L720 |
| `POST /api/invitations/update-role` | server/routes/invitations.ts:735 | service_role (L740) | session (requireAuth L737) | auth L737 ; membre/rôle L741 ; .eq(org_id) L753 |
| `POST /api/invitations/remove-member` | server/routes/invitations.ts:802 | service_role (L807) | session (requireAuth L804) | auth L804 ; membre/rôle L808 ; .eq(org_id) L824 |
| `POST /api/invitations/reactivate-member` | server/routes/invitations.ts:878 | service_role (L883) | session (requireAuth L880) | auth L880 ; membre/rôle L884 ; .eq(org_id) L895 ; .in(org_id) L911 |
| `POST /api/invitations/delete-member` | server/routes/invitations.ts:961 | service_role (L966) | session (requireAuth L963) | auth L963 ; membre/rôle L967 ; .eq(org_id) L981 |
| `POST /api/jobs/assign-team` | server/routes/jobs.ts:13 | service_role (L19) + JWT user (L46) | session (requireAuth L15) | auth L15 ; membre/rôle L46 |
| `GET /api/jobs/search-for-invoice` | server/routes/jobs.ts:78 | service_role (L84) | session (requireAuth L80) | auth L80 ; .eq(org_id) L89 |
| `GET /api/clients/search` | server/routes/jobs.ts:112 | service_role (L122) | session (requireAuth L114) | auth L114 ; .eq(org_id) L126 |
| `POST /api/clients/by-ids` | server/routes/jobs.ts:157 | service_role (L165) | session (requireAuth L159) | auth L159 ; .eq(org_id) L169 |
| `GET /api/leaderboard` | server/routes/leaderboard.ts:60 | service_role (L78) | session (requireAuth L61) | auth L61 |
| `GET /api/leaderboard/rep/:userId` | server/routes/leaderboard.ts:132 | service_role (L145) | session (requireAuth L133) | auth L133 |
| `GET /api/leaderboard/rep/:userId/profile` | server/routes/leaderboard.ts:167 | service_role (L177) | session (requireAuth L168) | auth L168 ; .eq(org_id) L210 ; .in(org_id) L183 |
| `GET /api/leaderboard/realtime/:userId` | server/routes/leaderboard.ts:239 | service_role (L244) | session (requireAuth L240) | auth L240 |
| `GET /api/leaderboard/offices` | server/routes/leaderboard.ts:255 | service_role (L259) | session (requireAuth L256) | auth L256 |
| `PATCH /api/leaderboard/rep/:userId/experience` | server/routes/leaderboard.ts:275 | service_role (L288) + JWT user (L279) | session (requireAuth L276) | auth L276 ; membre/rôle L279 ; .in(org_id) L295 |
| `PATCH /api/leaderboard/rep/:userId/visibility` | server/routes/leaderboard.ts:306 | service_role (L319) + JWT user (L310) | session (requireAuth L307) | auth L307 ; membre/rôle L310 ; .in(org_id) L326 |
| `POST /api/leads/create` | server/routes/leads.ts:12 | service_role (L45) + JWT user (L36) | **client** (L17) → puis re-validé | auth L14 ; membre/rôle L36 ; .eq(org_id) L84 |
| `POST /api/leads/soft-delete` | server/routes/leads.ts:191 | service_role (L200) + JWT user (L216) | session (requireAuth L193) | auth L193 ; membre/rôle L216 ; .eq(org_id) L234 |
| `POST /api/deals/soft-delete` | server/routes/leads.ts:251 | service_role (L262) + JWT user (L259) | session (requireAuth L253) | auth L253 ; membre/rôle L259 ; cmp org_id L273 |
| `POST /api/clients/soft-delete` | server/routes/leads.ts:299 | service_role (L307) + JWT user (L319) | session (requireAuth L301) | auth L301 ; membre/rôle L319 ; .eq(org_id) L334 |
| `POST /api/invoices/from-job` | server/routes/leads.ts:372 | JWT user (L386) | **client** (L377) → puis re-validé | auth L374 ; membre/rôle L386 |
| `POST /api/leads/update-status` | server/routes/leads.ts:458 | service_role (L499) + JWT user (L467) | **client** (L463) → puis re-validé | auth L460 ; membre/rôle L467 ; .eq(org_id) L475 |
| `POST /api/leads/convert-to-job` | server/routes/leads.ts:526 | service_role (L553) + JWT user (L535) | **client** (L531) → puis re-validé | auth L528 ; membre/rôle L535 ; .eq(org_id) L546 |
| `POST /api/leads/resolve-client` | server/routes/leads.ts:655 | service_role (L665) | session (requireAuth L657) | auth L657 ; .eq(org_id) L667 |
| `POST /api/public/book-demo` | server/routes/marketing.ts:67 | — | — | **aucune détectée** |
| `GET /api/me/is-beta-bypassed` | server/routes/me.ts:18 | — | session (requireAuth L19) | auth L19 |
| `POST /api/messages/send` | server/routes/messages.ts:15 | service_role (L31) | session (requireAuth L17) | auth L17 ; .eq(org_id) L37 |
| `POST /api/messages/inbound` | server/routes/messages.ts:110 | service_role (L192) | token/secret public (L124) | token L124 |
| `POST /api/messages/status` | server/routes/messages.ts:417 | service_role (L461) | token/secret public (L420) | token L420 |
| `GET /api/messages/twilio-diagnostic` | server/routes/messages.ts:487 | service_role (L512) | session (requireAuth L489) | auth L489 ; .eq(org_id) L516 |
| `GET /api/mfa/sms/status` | server/routes/mfa-sms.ts:49 | service_role (L53) | session (requireAuth L51) | auth L51 |
| `POST /api/mfa/sms/enroll/start` | server/routes/mfa-sms.ts:70 | service_role (L79) | session (requireAuth L72) | auth L72 ; insert org=auth L82 |
| `POST /api/mfa/sms/enroll/verify` | server/routes/mfa-sms.ts:98 | service_role (L102) | session (requireAuth L100) | auth L100 |
| `POST /api/mfa/sms/challenge/start` | server/routes/mfa-sms.ts:116 | service_role (L120) | session (requireAuth L118) | auth L118 |
| `POST /api/mfa/sms/challenge/verify` | server/routes/mfa-sms.ts:137 | service_role (L141) | session (requireAuth L139) | auth L139 |
| `GET /api/notifications` | server/routes/notifications.ts:12 | service_role (L16) | session (requireAuth L14) | auth L14 ; .eq(org_id) L20 |
| `GET /api/notifications/unread-count` | server/routes/notifications.ts:33 | service_role (L37) | session (requireAuth L35) | auth L35 ; .eq(org_id) L42 |
| `POST /api/notifications/read` | server/routes/notifications.ts:56 | service_role (L60) | session (requireAuth L58) | auth L58 ; .eq(org_id) L64 |
| `DELETE /api/notifications/:id` | server/routes/notifications.ts:76 | service_role (L80) | session (requireAuth L78) | auth L78 ; .eq(org_id) L85 |
| `POST /api/onboarding/complete` | server/routes/onboarding.ts:41 | service_role (L46) | session (requireAuth L43) | auth L43 ; .eq(org_id) L103 |
| `GET /api/me/setup-status` | server/routes/onboarding.ts:163 | service_role (L167) | session (requireAuth L165) | auth L165 ; .eq(org_id) L175 |
| `POST /api/me/setup-completed` | server/routes/onboarding.ts:221 | service_role (L225) | session (requireAuth L223) | auth L223 ; insert org=auth L229 |
| `GET /api/` | server/routes/org-knowledge.ts:11 | service_role (L14) | session (requireAuth L12) | auth L12 ; .eq(org_id) L21 |
| `POST /api/` | server/routes/org-knowledge.ts:39 | service_role (L42) | session (requireAuth L40) | auth L40 ; insert org=auth L59 |
| `DELETE /api/:id` | server/routes/org-knowledge.ts:80 | service_role (L83) | session (requireAuth L81) | auth L81 ; .eq(org_id) L91 |
| `POST /api/bulk` | server/routes/org-knowledge.ts:101 | service_role (L104) | session (requireAuth L102) | auth L102 ; insert org=auth L118 |
| `POST /api/orgs/create-office` | server/routes/orgs.ts:42 | service_role (L47) | session (requireAuth L44) | auth L44 ; .eq(org_id) L54 |
| `POST /api/payment-requests/create` | server/routes/payment-requests.ts:202 | JWT user (L208) | **client** (L207) → puis re-validé | auth L204 ; membre/rôle L208 |
| `POST /api/payment-requests/resend` | server/routes/payment-requests.ts:291 | JWT user (L297) | **client** (L296) → puis re-validé | auth L293 ; membre/rôle L297 |
| `GET /api/payment-requests/:id/status` | server/routes/payment-requests.ts:359 | JWT user (L365) | **client** (L364) → puis re-validé | auth L361 ; membre/rôle L365 |
| `GET /api/payments/settings` | server/routes/payments.ts:593 | JWT user (L601) | **client** (L594) → puis re-validé | auth L596 ; membre/rôle L601 |
| `POST /api/payments/keys` | server/routes/payments.ts:633 | JWT user (L644) | **client** (L638) → puis re-validé | auth L635 ; membre/rôle L644 |
| `POST /api/payments/settings` | server/routes/payments.ts:664 | JWT user (L675) | **client** (L671) → puis re-validé | auth L666 ; membre/rôle L675 ; .eq(org_id) L726 |
| `GET /api/payments/payouts/summary` | server/routes/payments.ts:766 | JWT user (L773) | **client** (L771) → puis re-validé | auth L768 ; membre/rôle L773 |
| `GET /api/payments/payouts/list` | server/routes/payments.ts:794 | JWT user (L801) | **client** (L799) → puis re-validé | auth L796 ; membre/rôle L801 |
| `GET /api/payments/payouts/detail` | server/routes/payments.ts:842 | JWT user (L852) | **client** (L847) → puis re-validé | auth L844 ; membre/rôle L852 |
| `GET /api/payments/:id/detail` | server/routes/payments.ts:880 | service_role (L892) + JWT user (L886) | **client** (L885) → puis re-validé | auth L882 ; membre/rôle L886 ; .eq(org_id) L897 |
| `POST /api/payments/payouts/email-csv` | server/routes/payments.ts:935 | JWT user (L942) | **client** (L940) → puis re-validé | auth L937 ; membre/rôle L942 |
| `GET /api/payments/providers/status` | server/routes/payments.ts:1023 | JWT user (L1028) | **client** (L1027) → puis re-validé | auth L1025 |
| `POST /api/payments/providers/settings` | server/routes/payments.ts:1054 | JWT user (L1060) | **client** (L1059) → puis re-validé | auth L1056 ; membre/rôle L1060 ; .eq(org_id) L1091 |
| `POST /api/payments/stripe/create-intent` | server/routes/payments.ts:1103 | — | session (requireAuth L1105) | auth L1105 |
| `GET /api/payments/stripe/transactions` | server/routes/payments.ts:1161 | — | session (requireAuth L1163) | auth L1163 |
| `GET /api/payments/stripe/balance` | server/routes/payments.ts:1213 | — | session (requireAuth L1215) | auth L1215 |
| `POST /api/payments/paypal/create-order` | server/routes/payments.ts:1238 | — | session (requireAuth L1240) | auth L1240 |
| `POST /api/payments/paypal/capture-order` | server/routes/payments.ts:1311 | — | session (requireAuth L1313) | auth L1313 |
| `POST /api/webhooks/paypal` | server/routes/payments.ts:1370 | — | — | **aucune détectée** |
| `POST /api/payments/refund` | server/routes/payments.ts:1397 | service_role (L1415) + JWT user (L1403) | session (requireAuth L1399) | auth L1399 ; membre/rôle L1403 ; .eq(org_id) L1420 |
| `GET /api/payroll/settings` | server/routes/payroll.ts:30 | service_role (L34) | session (requireAuth L31) | auth L31 |
| `PUT /api/payroll/settings` | server/routes/payroll.ts:43 | service_role (L47) | session (requireAuth L44) | auth L44 ; membre/rôle L48 ; insert org=auth L59 |
| `GET /api/payroll/current-period` | server/routes/payroll.ts:84 | service_role (L88) | session (requireAuth L85) | auth L85 ; membre/rôle L89 ; .eq(org_id) L102 |
| `GET /api/payroll/period-summary` | server/routes/payroll.ts:226 | service_role (L230) | session (requireAuth L227) | auth L227 ; membre/rôle L231 |
| `POST /api/payroll/adjustments` | server/routes/payroll.ts:253 | service_role (L257) | session (requireAuth L254) | auth L254 ; membre/rôle L258 ; insert org=auth L271 |
| `DELETE /api/payroll/adjustments/:id` | server/routes/payroll.ts:289 | service_role (L293) | session (requireAuth L290) | auth L290 ; membre/rôle L294 ; .eq(org_id) L301 |
| `POST /api/payroll/mark-paid` | server/routes/payroll.ts:310 | service_role (L314) | session (requireAuth L311) | auth L311 ; membre/rôle L315 ; insert org=auth L329 |
| `POST /api/payroll/unmark-paid` | server/routes/payroll.ts:352 | service_role (L356) | session (requireAuth L353) | auth L353 ; membre/rôle L357 ; .eq(org_id) L368 |
| `GET /api/payroll/history` | server/routes/payroll.ts:380 | service_role (L384) | session (requireAuth L381) | auth L381 ; membre/rôle L385 ; .eq(org_id) L394 |
| `GET /api/payroll/export` | server/routes/payroll.ts:407 | service_role (L411) | session (requireAuth L408) | auth L408 ; membre/rôle L412 |
| `GET /api/platform-admin/check` | server/routes/platform-admin.ts:30 | — | — | **aucune détectée** |
| `GET /api/platform-admin/business` | server/routes/platform-admin.ts:46 | service_role (L49) | session (requireAuth L48) | auth L48 |
| `GET /api/platform-admin/revenue-series` | server/routes/platform-admin.ts:143 | service_role (L146) | session (requireAuth L145) | auth L145 |
| `GET /api/platform-admin/growth-series` | server/routes/platform-admin.ts:193 | service_role (L196) | session (requireAuth L195) | auth L195 |
| `GET /api/platform-admin/operations` | server/routes/platform-admin.ts:219 | service_role (L222) | session (requireAuth L221) | auth L221 ; .in(org_id) L259 |
| `GET /api/platform-admin/users` | server/routes/platform-admin.ts:305 | service_role (L308) | session (requireAuth L307) | auth L307 |
| `GET /api/platform-admin/billing` | server/routes/platform-admin.ts:412 | service_role (L415) | session (requireAuth L414) | auth L414 ; .in(org_id) L444 |
| `GET /api/platform-admin/org/:orgId` | server/routes/platform-admin.ts:494 | service_role (L497) | session (requireAuth L496) | auth L496 ; .eq(org_id) L502 |
| `GET /api/portal/:token` | server/routes/portal.ts:22 | service_role (L33) | token/secret public (L24) | .eq(org_id) L71 |
| `GET /api/pay/:publicToken` | server/routes/public-pay.ts:16 | service_role (L49) | token/secret public (L16) | .eq(org_id) L94 |
| `POST /api/pay/:publicToken/create-payment-intent` | server/routes/public-pay.ts:131 | service_role (L182) | token/secret public (L131) | token L131 |
| `GET /api/quote-templates` | server/routes/quote-templates.ts:10 | JWT user (L15) | session (requireAuth L12) | auth L12 ; .eq(org_id) L18 |
| `GET /api/quote-templates/:id` | server/routes/quote-templates.ts:32 | JWT user (L37) | session (requireAuth L34) | auth L34 ; .eq(org_id) L41 |
| `POST /api/quote-templates` | server/routes/quote-templates.ts:55 | service_role (L73) | session (requireAuth L57) | auth L57 ; .eq(org_id) L80 ; insert org=auth L88 |
| `PUT /api/quote-templates/:id` | server/routes/quote-templates.ts:145 | service_role (L163) | session (requireAuth L147) | auth L147 ; .eq(org_id) L170 |
| `PATCH /api/quote-templates/:id/default` | server/routes/quote-templates.ts:239 | service_role (L244) | session (requireAuth L241) | auth L241 ; .eq(org_id) L249 |
| `PATCH /api/quote-templates/:id/active` | server/routes/quote-templates.ts:272 | service_role (L277) | session (requireAuth L274) | auth L274 ; .eq(org_id) L282 |
| `DELETE /api/quote-templates/:id` | server/routes/quote-templates.ts:300 | service_role (L305) | session (requireAuth L302) | auth L302 ; .eq(org_id) L312 |
| `POST /api/quote-templates/:id/duplicate` | server/routes/quote-templates.ts:332 | service_role (L337) | session (requireAuth L334) | auth L334 ; .eq(org_id) L342 ; insert org=auth L351 |
| `GET /api/q/:token` | server/routes/quotes.ts:77 | service_role (L82) | token/secret public (L79) | token L79 |
| `POST /api/quotes/:id/track-view` | server/routes/quotes.ts:166 | service_role (L169) | token/secret public (L171) | token L171 |
| `POST /api/quotes/send-email` | server/routes/quotes.ts:255 | service_role (L263) | session (requireAuth L257) | auth L257 ; .eq(org_id) L268 |
| `POST /api/quotes/send-sms` | server/routes/quotes.ts:410 | service_role (L420) | session (requireAuth L412) | auth L412 ; .eq(org_id) L425 |
| `POST /api/quotes/convert-to-job` | server/routes/quotes.ts:547 | service_role (L555) + JWT user (L572) | session (requireAuth L549) | auth L549 ; .eq(org_id) L557 ; insert org=auth L594 |
| `GET /api/quotes/public/:token` | server/routes/quotes.ts:702 | service_role (L707) | token/secret public (L704) | .eq(org_id) L722 |
| `POST /api/quotes/public/accept` | server/routes/quotes.ts:848 | service_role (L861) | token/secret public (L854) | token L854 |
| `GET /api/quotes/public/signature` | server/routes/quotes.ts:974 | service_role (L979) | token/secret public (L976) | token L976 |
| `POST /api/quotes/public/deposit-intent` | server/routes/quotes.ts:1019 | service_role (L1027) | token/secret public (L1025) | .eq(org_id) L1102 |
| `POST /api/quotes/public/deposit-confirm` | server/routes/quotes.ts:1163 | service_role (L1171) | token/secret public (L1169) | .eq(org_id) L1198 |
| `POST /api/quotes/public/decline` | server/routes/quotes.ts:1259 | service_role (L1267) | token/secret public (L1265) | .eq(org_id) L1309 |
| `POST /api/quotes/public/request-changes` | server/routes/quotes.ts:1347 | service_role (L1355) | token/secret public (L1353) | .eq(org_id) L1396 |
| `POST /api/quotes/convert-to-invoice` | server/routes/quotes.ts:1427 | service_role (L1435) + JWT user (L1449) | session (requireAuth L1429) | auth L1429 ; .eq(org_id) L1437 |
| `GET /api/referrals/me` | server/routes/referrals.ts:25 | service_role (L34) | session (requireAuth L27) | auth L27 ; .eq(org_id) L43 ; insert org=auth L88 |
| `GET /api/referrals/history` | server/routes/referrals.ts:128 | service_role (L137) | session (requireAuth L130) | auth L130 |
| `POST /api/referrals/track` | server/routes/referrals.ts:175 | service_role (L186) | — | **aucune détectée** |
| `GET /api/referrals/validate/:code` | server/routes/referrals.ts:229 | service_role (L236) | — | **aucune détectée** |
| `POST /api/cron/payment-reminders` | server/routes/reminders-cron.ts:93 | service_role (L95) | token/secret public (L233) | .eq(org_id) L128 |
| `GET /api/reminders/settings` | server/routes/reminders.ts:65 | — | session (requireAuth L67) | auth L67 |
| `PATCH /api/reminders/settings` | server/routes/reminders.ts:76 | service_role (L121) + JWT user (L80) | session (requireAuth L78) | auth L78 ; membre/rôle L80 ; .eq(org_id) L125 |
| `GET /api/reminders/log` | server/routes/reminders.ts:135 | JWT user (L140) | session (requireAuth L137) | auth L137 |
| `GET /api/request-forms` | server/routes/request-forms.ts:14 | JWT user (L19) | session (requireAuth L16) | auth L16 ; .eq(org_id) L22 |
| `POST /api/request-forms` | server/routes/request-forms.ts:34 | service_role (L39) | session (requireAuth L36) | auth L36 ; .eq(org_id) L58 ; insert org=auth L41 |
| `POST /api/request-forms/regenerate-key` | server/routes/request-forms.ts:83 | service_role (L88) | session (requireAuth L85) | auth L85 ; .eq(org_id) L92 |
| `GET /api/request-forms/submissions` | server/routes/request-forms.ts:123 | service_role (L128) | session (requireAuth L125) | auth L125 ; .eq(org_id) L133 |
| `GET /api/request-forms/submissions/:id` | server/routes/request-forms.ts:152 | service_role (L157) | session (requireAuth L154) | auth L154 ; .eq(org_id) L161 |
| `PATCH /api/request-forms/submissions/:id` | server/routes/request-forms.ts:174 | service_role (L196) | session (requireAuth L176) | auth L176 ; .eq(org_id) L200 |
| `DELETE /api/request-forms/submissions/:id` | server/routes/request-forms.ts:219 | service_role (L224) | session (requireAuth L221) | auth L221 ; .eq(org_id) L228 |
| `GET /api/public/form/:apiKey` | server/routes/request-forms.ts:251 | service_role (L258) | token/secret public (L251) | .eq(org_id) L279 |
| `POST /api/public/form/:apiKey/submit` | server/routes/request-forms.ts:361 | service_role (L372) | token/secret public (L361) | .eq(org_id) L409 |
| `POST /api/roles/update-preset` | server/routes/role-presets.ts:38 | service_role (L43) | session (requireAuth L40) | auth L40 ; membre/rôle L44 ; .eq(org_id) L86 ; insert org=auth L65 |
| `GET /api/roles/member-permissions` | server/routes/role-presets.ts:147 | service_role (L151) | session (requireAuth L149) | auth L149 ; membre/rôle L152 |
| `POST /api/roles/member-permissions` | server/routes/role-presets.ts:174 | service_role (L178) | session (requireAuth L176) | auth L176 ; membre/rôle L179 ; .eq(org_id) L199 |
| `POST /api/roles/member-permissions/reset` | server/routes/role-presets.ts:223 | service_role (L227) | session (requireAuth L225) | auth L225 ; membre/rôle L228 ; .eq(org_id) L239 |
| `GET /api/roles/presets` | server/routes/role-presets.ts:280 | service_role (L285) | session (requireAuth L282) | auth L282 ; .eq(org_id) L289 |
| `POST /api/route-optimization/optimize` | server/routes/route-optimization.ts:52 | — | session (requireAuth L54) | auth L54 ; .eq(org_id) L77 |
| `GET /api/scheduled-reports` | server/routes/scheduled-reports.ts:12 | service_role (L16) | session (requireAuth L14) | auth L14 ; .eq(org_id) L19 |
| `POST /api/scheduled-reports` | server/routes/scheduled-reports.ts:29 | service_role (L33) | session (requireAuth L31) | auth L31 ; insert org=auth L38 |
| `PUT /api/scheduled-reports/:id` | server/routes/scheduled-reports.ts:54 | service_role (L58) | session (requireAuth L56) | auth L56 ; .eq(org_id) L71 |
| `DELETE /api/scheduled-reports/:id` | server/routes/scheduled-reports.ts:81 | service_role (L85) | session (requireAuth L83) | auth L83 ; .eq(org_id) L89 |
| `POST /api/scheduled-reports/:id/send-now` | server/routes/scheduled-reports.ts:98 | service_role (L104) | session (requireAuth L100) | auth L100 ; .eq(org_id) L106 |
| `GET /api/search` | server/routes/search.ts:364 | — | — | **aucune détectée** |
| `GET /api/search/suggestions` | server/routes/search.ts:365 | — | — | **aucune détectée** |
| `GET /api/search/results` | server/routes/search.ts:367 | service_role (L388) | session (requireAuth L383) | auth L383 |
| `GET /api/security/alerts` | server/routes/security.ts:40 | service_role (L45) | session (requireAuth L42) | auth L42 ; .eq(org_id) L54 |
| `POST /api/security/alerts/:id/acknowledge` | server/routes/security.ts:81 | service_role (L86) | session (requireAuth L83) | auth L83 ; .eq(org_id) L95 |
| `GET /api/security/events` | server/routes/security.ts:112 | service_role (L117) | session (requireAuth L114) | auth L114 ; .eq(org_id) L125 |
| `GET /api/security/login-history` | server/routes/security.ts:146 | service_role (L151) | session (requireAuth L148) | auth L148 ; .eq(org_id) L159 |
| `GET /api/security/blocked-ips` | server/routes/security.ts:180 | service_role (L185) | session (requireAuth L182) | auth L182 |
| `POST /api/security/block-ip` | server/routes/security.ts:203 | service_role (L225) | session (requireAuth L205) | auth L205 ; insert org=auth L236 |
| `DELETE /api/security/block-ip/:id` | server/routes/security.ts:254 | service_role (L259) | session (requireAuth L256) | auth L256 ; .eq(org_id) L264 |
| `GET /api/security/summary` | server/routes/security.ts:277 | service_role (L282) | session (requireAuth L279) | auth L279 ; .eq(org_id) L296 |
| `POST /api/security/api-keys` | server/routes/security.ts:334 | — | session (requireAuth L336) | auth L336 |
| `GET /api/security/api-keys` | server/routes/security.ts:369 | service_role (L374) | session (requireAuth L371) | auth L371 ; .eq(org_id) L378 |
| `DELETE /api/security/api-keys/:id` | server/routes/security.ts:392 | — | session (requireAuth L394) | auth L394 |
| `GET /api/security/sessions` | server/routes/security.ts:408 | service_role (L413) | session (requireAuth L410) | auth L410 |
| `POST /api/security/sessions/invalidate-all` | server/routes/security.ts:432 | service_role (L437) | session (requireAuth L434) | auth L434 |
| `POST /api/security/csp-report` | server/routes/security.ts:453 | — | — | **aucune détectée** |
| `GET /api/security/export-log` | server/routes/security.ts:487 | service_role (L492) | session (requireAuth L489) | auth L489 ; .eq(org_id) L500 |
| `POST /api/security/check-password` | server/routes/security.ts:515 | service_role (L520) | — | **aucune détectée** |
| `POST /api/support` | server/routes/support.ts:35 | service_role (L50) | session (requireAuth L37) | auth L37 ; .eq(org_id) L58 |
| `GET /api/survey/:token` | server/routes/surveys.ts:13 | service_role (L18) | token/secret public (L15) | .eq(org_id) L44 |
| `POST /api/survey/:token` | server/routes/surveys.ts:65 | service_role (L77) | token/secret public (L67) | .eq(org_id) L113 |
| `GET /api/taxes` | server/routes/taxes.ts:97 | service_role (L101) | session (requireAuth L99) | auth L99 ; .eq(org_id) L104 |
| `GET /api/taxes/resolve` | server/routes/taxes.ts:126 | service_role (L130) | session (requireAuth L128) | auth L128 ; .eq(org_id) L154 |
| `GET /api/taxes/collected` | server/routes/taxes.ts:220 | service_role (L224) | session (requireAuth L222) | auth L222 ; .eq(org_id) L233 |
| `POST /api/taxes/setup` | server/routes/taxes.ts:323 | service_role (L327) | session (requireAuth L325) | auth L325 ; membre/rôle L328 ; .eq(org_id) L342 ; insert org=auth L352 |
| `POST /api/taxes/config` | server/routes/taxes.ts:399 | service_role (L403) | session (requireAuth L401) | auth L401 ; membre/rôle L404 ; .eq(org_id) L420 ; insert org=auth L412 |
| `PUT /api/taxes/config/:id` | server/routes/taxes.ts:445 | service_role (L449) | session (requireAuth L447) | auth L447 ; membre/rôle L450 ; .eq(org_id) L462 |
| `DELETE /api/taxes/config/:id` | server/routes/taxes.ts:475 | service_role (L479) | session (requireAuth L477) | auth L477 ; membre/rôle L480 ; .eq(org_id) L485 |
| `DELETE /api/taxes/group/:id` | server/routes/taxes.ts:496 | service_role (L500) | session (requireAuth L498) | auth L498 ; membre/rôle L501 ; .eq(org_id) L508 |
| `PATCH /api/taxes/group/:id/default` | server/routes/taxes.ts:525 | service_role (L529) | session (requireAuth L527) | auth L527 ; membre/rôle L530 ; .eq(org_id) L535 |
| `POST /api/team/:memberId/request-delete` | server/routes/team-compliance.ts:45 | service_role (L55) | session (requireAuth L46) | auth L46 |
| `POST /api/team/:memberId/cancel-delete` | server/routes/team-compliance.ts:69 | service_role (L76) | session (requireAuth L70) | auth L70 |
| `POST /api/team/:memberId/mfa-required` | server/routes/team-compliance.ts:87 | service_role (L96) | session (requireAuth L88) | auth L88 |
| `POST /api/team/:memberId/force-logout` | server/routes/team-compliance.ts:110 | service_role (L117) | session (requireAuth L111) | auth L111 ; membre/rôle L129 ; cmp org_id L126 ; insert org=auth L145 |
| `GET /api/team/:userId/audit` | server/routes/team-compliance.ts:159 | service_role (L168) | session (requireAuth L160) | auth L160 ; membre/rôle L174 ; .eq(org_id) L172 |
| `POST /api/team-suggestions` | server/routes/team-suggestions.ts:58 | — | session (requireAuth L60) | auth L60 ; .eq(org_id) L76 |
| `GET /api/timesheets/active` | server/routes/timesheets.ts:53 | JWT user (L57) | session (requireAuth L55) | auth L55 |
| `POST /api/timesheets/punch-in` | server/routes/timesheets.ts:65 | service_role (L78) + JWT user (L70) | session (requireAuth L67) | auth L67 ; .eq(org_id) L83 ; insert org=auth L95 |
| `POST /api/timesheets/punch-out` | server/routes/timesheets.ts:143 | service_role (L165) + JWT user (L150) | session (requireAuth L145) | auth L145 ; .eq(org_id) L150 |
| `POST /api/timesheets/break/start` | server/routes/timesheets.ts:197 | service_role (L216) + JWT user (L203) | session (requireAuth L199) | auth L199 ; .eq(org_id) L204 |
| `POST /api/timesheets/break/end` | server/routes/timesheets.ts:228 | service_role (L246) + JWT user (L234) | session (requireAuth L230) | auth L230 ; .eq(org_id) L235 |
| `POST /api/tracking/start` | server/routes/tracking.ts:51 | service_role (L55) | session (requireAuth L53) | auth L53 ; insert org=auth L73 |
| `POST /api/tracking/stop` | server/routes/tracking.ts:103 | service_role (L107) | session (requireAuth L105) | auth L105 ; insert org=auth L118 |
| `POST /api/tracking/point` | server/routes/tracking.ts:140 | service_role (L144) | session (requireAuth L142) | auth L142 ; insert org=auth L164 |
| `POST /api/tracking/points-batch` | server/routes/tracking.ts:208 | service_role (L212) | session (requireAuth L210) | auth L210 ; insert org=auth L228 |
| `GET /api/tracking/consents` | server/routes/tracking.ts:278 | service_role (L282) | session (requireAuth L280) | auth L280 ; membre/rôle L283 ; .eq(org_id) L290 |
| `POST /api/tracking/consents/re-request` | server/routes/tracking.ts:322 | service_role (L326) | session (requireAuth L324) | auth L324 ; membre/rôle L327 ; .eq(org_id) L335 |
| `POST /api/tracking/event` | server/routes/tracking.ts:355 | service_role (L359) | session (requireAuth L357) | auth L357 ; insert org=auth L363 |

---

## 3. Routes où l'org_id vient du client

40 handlers acceptent un `orgId` d'origine cliente (body, query ou dérivé d'un `:id` de chemin). **Aucun P0 confirmé** : les 40 revalident.

Deux motifs de revalidation, tous deux valides :

**a) `parseOrgId` + contrôle d'appartenance** (14 routes : `connect.ts`, `leads.ts`, `payments.ts`, `payment-requests.ts`) —

```ts
// server/routes/leads.ts:16,35-36
const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });
```

`parseOrgId` (`server/lib/helpers.ts:131-136`) rejette tout ce qui n'est pas un UUID. `isOrgMember` (`server/lib/supabase.ts:159-174`) interroge `has_org_membership` **avec le client JWT**, donc sous RLS.

**b) En-tête `x-org-id`** — `requireAuthedClient` (`server/lib/supabase.ts:144-149`) accepte un office actif fourni par le client, mais uniquement après vérification d'appartenance :

```ts
const headerOrg = req.header('x-org-id');
if (headerOrg && ORG_UUID_RE.test(headerOrg)) {
  const { data: isMember } = await client.rpc('has_org_membership', { p_user: user.id, p_org: headerOrg });
  if (shouldUseRequestedOrg(headerOrg, isMember === true)) orgId = headerOrg;
}
if (!orgId) orgId = await resolveOrgId(client);
```

`shouldUseRequestedOrg` (`server/lib/active-org.ts:19-24`) exige `isMember === true` strictement. **C'est la garde d'entrée de tout le serveur** : si elle tombe, les 413 routes tombent.

**Un seul cas à surveiller — `GET /api/payments/providers/status`** (`server/routes/payments.ts:1023-1027`) :

```ts
const requestedOrgId = parseOrgId(req.query.orgId) || auth.orgId;
const settings = await getPaymentProviderSettings(auth.client, requestedOrgId);
```

Il n'y a **pas** d'`isOrgMember` ici, contrairement à ses voisines `/payments/keys` (`payments.ts:643`) et `/payments/settings` (`payments.ts:675`). L'isolation repose entièrement sur le `.single()` RLS de `server/lib/payments.ts:124-128` :

```ts
const { data, error } = await client
  .from('payment_provider_settings')
  .select('org_id,default_provider,…')
  .eq('org_id', orgId)
  .single();
```

Si cette lecture passe, le code enchaîne **en service_role** sur les secrets (`server/lib/payments.ts:136-142`) :

```ts
const admin = getServiceClient();
const { data: providerSecretRow } = await admin
  .from('payment_provider_secrets')
  .select('org_id,stripe_publishable_key,paypal_client_id')
  .eq('org_id', orgId)
```

→ **Question directe pour l'audit DB** : la RLS de `payment_provider_settings` est-elle activée et scopée sur `has_org_membership` ? Si non, cette route rend les clés publiques Stripe/PayPal de n'importe quel tenant. Ligne manquante côté applicatif : un `isOrgMember(auth.client, auth.user.id, requestedOrgId)` avant la ligne 1027, à l'image de `payments.ts:643`.

Effet de bord secondaire : `getPaymentProviderSettings` appelle d'abord `ensurePaymentSettingsRow(client, orgId)` → `client.rpc('ensure_payment_settings_row', { p_org: orgId })` (`server/lib/payments.ts:97`). **INCONNU — à vérifier : `ensure_payment_settings_row` est-elle `SECURITY DEFINER` ?** Si oui, un appel avec un `orgId` étranger crée une ligne dans le tenant d'autrui avant même que la RLS ne bloque la lecture.

---

## 4. Routes `getServiceClient()` sans filtre `org_id` — le vrai risque d'IDOR

Rappel méthodologique appliqué : avant de conclure, la fonction appelée en aval a été relue. Une garde placée **dans la fonction appelée** ou en **pré-vérification explicite** compte comme protection valide.

### 4.1 Faux positifs écartés (gardes trouvées en aval — ne pas rapporter)

| Route | Pourquoi ce n'est PAS une fuite |
|---|---|
| `POST /api/field-sessions/:id/gps` (`field-sessions.ts:98`) | `recordGpsPoint(sc, req.params.id, auth.user.id, lat, lng, accuracy, auth.orgId)` (L111) → garde dans `server/lib/field-sales/session-engine.ts:174-182` : `.eq('id', sessionId).eq('org_id', orgId)` puis `if (!session) throw`. |
| `GET /api/field-sessions/:id/trail` (`field-sessions.ts:119`) | Idem, `session-engine.ts:207-215`. |
| Les 17 routes de `commissions.ts` | Toutes passent `auth.orgId` au moteur ; `server/lib/field-sales/commission-engine.ts` contient 27 `.eq('org_id', …)` — ex. `markCommissionPaid` L546 : `.eq('id', entryId).eq('org_id', orgId)`. |
| `PATCH/DELETE /api/courses/modules/:id`, `…/lessons/:id`, `PUT …/modules/reorder` | `canEditCourse` (`courses.ts:111-137`) : `if (!course \|\| course.org_id !== orgId) return false;`. Le reorder scope en plus par `.eq('course_id', req.params.courseId)` (`courses.ts:714`). |
| `POST /api/team/:memberId/*` (`team-compliance.ts`) | `guardMemberAdmin` (`team-compliance.ts:26-39`) : `if (member.org_id !== auth.orgId) return 403` **puis** `has_org_admin_role`. Le commentaire L21-23 documente exactement pourquoi la garde interne des RPC ne suffit pas. |
| `PATCH /api/incidents/:id`, `POST /api/incidents/:id/timeline` | Pré-vérification `incidents.ts:122-126` : `if (!existing \|\| existing.org_id !== auth.orgId) return 404`. |
| `GET /api/email/threads/:threadId`, `/email/send`, attachements | Isolation **par utilisateur** (`.eq('user_id', ctx.user.id)` — `email-accounts.ts:225, 280, 329`), plus stricte que par org. |
| `GET /api/leaderboard*` | Scope résolu serveur via `resolveCompanyOrgIds(sc, auth.orgId)` (`leaderboard.ts:110-129`) ; le `?orgId=` client passe par `resolveActiveOrgId`. |
| `POST /api/dsr/consent` | Route publique **avec** garde d'intégrité `dsr.ts:202-214` : le sujet doit appartenir à l'`org_id` fourni. |
| Toutes les `/api/platform-admin/*` | `requirePlatformOwner` (`platform-admin.ts:20-26`) : `if (auth.user.id !== platformOwnerId) 403`. Cross-tenant **par conception**, gate à un seul UUID d'env. |
| Toutes les `/api/cron/*` | `checkCronAuth` (`cron.ts:21-46`), comparaison `crypto.timingSafeEqual` sur `CRON_SECRET`. |
| Routes publiques `/q/:token`, `/quotes/public/*`, `/pay/:publicToken`, `/portal/:token`, `/survey/:token`, `/public/form/:apiKey`, `/agreements/public/*` | Résolution par jeton porteur non devinable, org dérivée de la ligne trouvée. `quotes.ts:179-181` refuse même explicitement un UUID brut pour empêcher l'énumération. |

### 4.2 P0-CANDIDAT — `POST /api/dsr/erase/client/:id` et `POST /api/dsr/erase/lead/:id`

**Fichier** : `server/routes/dsr.ts:106-123` et `dsr.ts:128-148`.

```ts
router.post('/dsr/erase/client/:id', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const clientId = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return res.status(400).json({ error: 'Invalid client id' });

  const { confirm } = req.body || {};
  if (confirm !== 'ERASE') { … }

  const svc = getServiceClient();
  const { error } = await svc.rpc('anonymize_client', { p_client_id: clientId });
  if (error) return sendSafeError(res, error, 'Anonymization failed.', '[dsr/erase/client]');

  return res.status(200).json({ ok: true, anonymized: clientId });
});
```

`auth` est récupéré puis **jamais utilisé** : `auth.orgId` n'apparaît nulle part dans le handler. Aucun contrôle de rôle non plus, alors que l'en-tête du fichier annonce « `POST /api/dsr/erase/client/:id` : anonymise un client (**admin org**) » (`dsr.ts:7`).

**Ligne qui manque**, et elle existe littéralement 30 lignes plus haut dans le même fichier, sur la route sœur `GET /dsr/export/client/:id` (`dsr.ts:75-83`) :

```ts
const { data: client, error: clientErr } = await svc
  .from('clients').select('org_id').eq('id', clientId).maybeSingle();
if (!client) return res.status(404).json({ error: 'Client not found' });
if (client.org_id !== auth.orgId) return res.status(403).json({ error: 'Forbidden' });
```

**Ce qui bloque aujourd'hui** — et uniquement cela : la garde interne du RPC, `supabase/migrations/20260625000001_dsr_and_consents.sql:149-152` :

```sql
v_caller_has_access := public.has_org_admin_role(auth.uid(), v_org);
if not v_caller_has_access then
  raise exception 'Only org admin/owner can anonymize clients';
end if;
```

Or `has_org_admin_role(NULL, …)` renvoie `false` (`supabase/complete_schema.sql:6973-6975` : `if p_user is null or p_org is null then return false;`), et `auth.uid()` **est NULL sous service_role**. Le projet le sait et l'a écrit noir sur blanc pour la fonction jumelle, dans `supabase/migrations/20260751101900_fix_dsr_export.sql:11-15` :

> « export_client_data() et export_user_data() valident l'appelant avec `auth.uid()`. Or les routes /api/dsr/export/* les invoquent via getServiceClient() — service_role, où auth.uid() vaut NULL. has_org_membership(NULL, org) => false (vérifié). La garde refusait donc TOUT LE MONDE. »

**Double conclusion** :

1. **Aujourd'hui** : `/dsr/erase/client/:id` et `/dsr/erase/lead/:id` sont **cassés en production** — ils échouent systématiquement. Le droit à l'effacement (Loi 25 art. 28.1, RGPD art. 17, délai 30 jours) n'est pas servi. C'est le symétrique exact du bug corrigé pour l'export.
2. **Au premier correctif appliqué au RPC** — et le correctif évident est celui déjà employé pour `export_client_data` (`20260751101900_fix_dsr_export.sql:54` : `if auth.uid() is not null and not …`) — ces deux routes deviennent une **IDOR destructive cross-tenant non authentifiée par org** : n'importe quel membre de n'importe quelle org anonymise le client de n'importe quel tenant avec son seul UUID.

**Recommandation** : ajouter la pré-vérification d'org **dans la route** *avant* de toucher au RPC, jamais l'inverse. `anonymize_client` n'a **aucune** migration ultérieure (vérifié : seuls `20260506120000` et `20260625000001` la mentionnent).

**INCONNU — à vérifier : l'état réel de `public.anonymize_client` en base de production** (une modification hors migration est possible). Si la garde `auth.uid()` a déjà été assouplie, le point 2 est actif dès maintenant.

### 4.3 P1 — `POST /api/gamification/challenges/:id/join` : écriture cross-tenant

**Fichier** : `server/routes/gamification.ts:111-119`.

```ts
router.post('/gamification/challenges/:id/join', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const participant = await joinChallenge(sc, req.params.id, auth.user.id);
    res.json(participant);
```

`auth.orgId` n'est pas transmis. La fonction appelée, `server/lib/field-sales/gamification-engine.ts:29-46`, ne connaît même pas la notion d'org :

```ts
export async function joinChallenge(supabase: SupabaseClient, challengeId: string, userId: string) {
  const { data, error } = await supabase
    .from('fs_challenge_participants')
    .insert({ challenge_id: challengeId, user_id: userId, current_value: 0 })
    .select().single();
```

C'est la **seule** fonction du moteur sans scope org — sa voisine `updateChallengeProgress` (même fichier, L53-58) fait bien `.eq('id', challengeId).eq('org_id', orgId)`.

**Ligne manquante** : une pré-vérification `sc.from('fs_challenges').select('id').eq('id', req.params.id).eq('org_id', auth.orgId).maybeSingle()` renvoyant 404, ou un paramètre `orgId` supplémentaire sur `joinChallenge` comme le fait `recordGpsPoint`.

**Impact** : écriture d'une ligne dans `fs_challenge_participants` rattachée au défi d'un autre tenant (pollution de classement, inscription non sollicitée). Pas de lecture de données d'autrui constatée — `getActiveChallenges` filtre par org. Sévérité modérée, mais c'est bien un franchissement de frontière tenant en écriture, sans aucune garde.

### 4.4 Écart mineur — `POST /api/courses/:id/assign`

`server/routes/courses.ts:910-938`. Le cours est bien vérifié (`courses.ts:917-918` : `if (!course || course.org_id !== auth.orgId) return 403`), mais les `user_ids` et `team_ids` du body sont insérés **sans vérifier qu'ils appartiennent à l'org** :

```ts
for (const uid of user_ids || []) rows.push({ course_id: req.params.id, user_id: uid, assigned_by: auth.user.id });
```

Ligne manquante : un filtrage des `user_ids` contre `memberships` scopé `auth.orgId`. Impact limité : `canViewCourse` (`courses.ts:160-167`) exige de toute façon une `membership` dans l'org du lecteur, donc l'assignation orpheline ne donne pas d'accès. À traiter comme hygiène de données, pas comme fuite.

---

## 5. Clients au niveau module portant un token utilisateur — et caches

### 5.1 Fuite de session inter-requêtes : **aucune trouvée**

Les 6 points d'instanciation du §1.1 ont été relus : les deux clients mis en cache au niveau module (`supabaseAdmin.ts:14`, `supabase.ts:20-22`) utilisent la **service_role** et ne portent aucun en-tête `Authorization` d'utilisateur. Le seul client porteur d'un JWT utilisateur (`supabase.ts:9-14`) est construit **à chaque appel** de `requireAuthedClient` et n'est jamais stocké. **Pas de finding.**

### 5.2 Caches — clés vérifiées

| Cache | Fichier | Clé | Contient l'org ? |
|---|---|---|---|
| TTL générique | `server/lib/cache.ts:11` | fournie par l'appelant | — |
| ↳ épingles carte | `server/routes/field-sales.ts:1200` | `pins:${auth.orgId}` | ✅ |
| ↳ notifications | `server/routes/notifications.ts:39` | `notifs:unread:${auth.orgId}` | ✅ |
| ↳ objectifs | `server/routes/goals.ts:67` | `goals:progress:${auth.orgId}` | ✅ |
| ↳ classement | `server/routes/leaderboard.ts:87-92` | `leaderboard:mine:${activeOrgId}:…` / `leaderboard:all:${resolved.groupId}:…` | ✅ (groupe d'offices, volontaire) |
| ↳ perf. d'un rep | `server/routes/leaderboard.ts:149` | `rep-perf:group:${groupId}:${userId}:${from}:${to}` | ✅ |
| contexte RBAC | `server/lib/rbac.ts:152` | `${userId}:${orgId}` (`rbac.ts:160`) | ✅ |
| consentement géoloc | `server/lib/location-consent.ts:20` | `${userId}:${orgId}` (`location-consent.ts:34`) | ✅ |
| rate-limiting | `server/index.ts:243`, `security.ts:28`, `rate-limiter.ts:67` | IP ou `sub` JWT | N/A (pas de donnée tenant) |

**Aucun cache mal clé.** Note d'exploitation : `server/lib/cache.ts:3-6` précise que le cache est par processus ; en multi-réplica les TTL divergent mais ne se croisent pas entre tenants.

### 5.3 Surface d'auth morte — `X-API-Key`

`server/lib/api-keys.ts:149-187` définit un middleware `apiKeyAuth()` qui attache `(req as any).orgId = keyData.orgId`. **Ce middleware n'est monté nulle part** (vérifié sur tout `server/`). Pourtant `server/index.ts:234` exempte ces requêtes du contrôle CSRF :

```ts
// API key requests are not vulnerable to CSRF
if (req.headers['x-api-key']) return next();
```

Conséquence actuelle : envoyer un en-tête `x-api-key` arbitraire (même invalide, puisque rien ne le valide) suffit à **désactiver le contrôle CSRF par en-tête** sur toute requête `/api` mutante. Le seul consommateur réel de `validateApiKey` est `POST /api/agent/connect` (`server/routes/agent-auth.ts:88`), qui lit le jeton dans le **body**, pas dans l'en-tête.

Ligne manquante : soit monter `apiKeyAuth()`, soit retirer l'exemption `index.ts:234`. Sévérité réelle faible (la protection CSRF principale reste le CORS strict de `index.ts:182-205`), mais c'est un contournement gratuit d'un contrôle déclaré.

---

## 6. RPC appelées

### 6.1 Depuis `server/` (47, dédupliqué)

`anonymize_client`, `apply_invoice_payment`, `cancel_hard_delete_member`, `check_password_strength`, `create_incident`, `create_invoice_from_job`, `create_invoice_from_milestone`, `current_org_id`, `detect_login_anomalies`, `ensure_payment_settings_row`, `export_client_data`, `export_user_data`, `get_user_id_by_email`, `has_org_admin_role`, `has_org_membership`, `invalidate_all_sessions`, `invalidate_user_sessions`, `invoice_next_number`, `list_member_audit_events`, `next_recurrence_at`, `provision_sms_channel`, `purge_old_audit_events`, `recalculate_invoice_totals`, `record_consent`, `record_email_opt_out`, `record_failed_login`, `release_advisory_lock`, `request_hard_delete_member`, `reverse_invoice_payment`, `rpc_create_invoice_draft`, `rpc_create_job_with_optional_schedule`, `rpc_insights_churn_risk`, `rpc_insights_client_lifetime_value`, `rpc_insights_invoices_summary`, `rpc_insights_lead_conversion`, `rpc_insights_overview`, `rpc_insights_revenue_series`, `rpc_list_invoices`, `run_retention_job`, `search_global`, `search_global_by_type`, `search_global_counts`, `security_maintenance`, `set_deal_stage`, `set_member_mfa_required`, `try_advisory_lock`, `verify_org_access`.

### 6.2 Depuis `src/` — appelées **directement par le navigateur** avec la clé anon (48, dédupliqué)

`batch_soft_delete_clients`, `create_client_with_duplicate_handling`, `create_job_from_intent`, `create_pipeline_deal`, `current_org_id`, `delete_client_cascade`, `delete_invoice_cascade`, `delete_job_cascade`, `delete_lead_and_optional_client`, `delete_lead_cascade`, `delete_quote_cascade`, `finish_job_and_prepare_invoice`, `get_available_slots`, `list_archived_items`, `restore_client`, `restore_job`, `restore_lead`, `rpc_add_visit`, `rpc_create_invoice_draft`, `rpc_create_job_with_optional_schedule`, `rpc_create_quote`, `rpc_insights_budget_vs_actual`, `rpc_insights_churn_risk`, `rpc_insights_client_lifetime_value`, `rpc_insights_cohort_retention`, `rpc_insights_invoices_summary`, `rpc_insights_job_profitability`, `rpc_insights_lead_conversion`, `rpc_insights_overview`, `rpc_insights_period_comparison`, `rpc_insights_pipeline_velocity`, `rpc_insights_revenue_forecast`, `rpc_insights_revenue_series`, `rpc_insights_team_performance`, `rpc_invoices_kpis_30d`, `rpc_list_invoices`, `rpc_list_payments`, `rpc_payments_overview_kpis`, `rpc_peek_next_numbers`, `rpc_recalculate_quote`, `rpc_reschedule_event`, `rpc_save_invoice_draft`, `rpc_schedule_job`, `rpc_unschedule_job`, `rpc_update_entity_number`, `seed_automation_presets`, `set_deal_stage`, `soft_delete_job`.

**C'est la liste la plus importante du document pour l'audit DB.** Chacune de ces fonctions est exposée à `authenticated` via PostgREST. Toute fonction `SECURITY DEFINER` de cette liste qui accepte un identifiant en paramètre **sans** vérifier `has_org_membership(auth.uid(), …)` est une fuite cross-tenant directe, indépendante de toute route Express. Les 12 `delete_*_cascade` / `restore_*` / `batch_soft_delete_clients` sont les plus sensibles (destructives, prennent un UUID).

### 6.3 Précédent avéré — `search_global` : le modèle exact de la faille à chercher

`supabase/migrations/20260751101400_secdef_least_privilege.sql:9-20` documente une fuite **prouvée en prod** :

> « FUITE REELLE PROUVEE avant ecriture de cette migration. En se faisant passer pour un utilisateur authentifie NON MEMBRE de l'org : `select * from search_global('<org-d-un-autre>', 'a', 20, 0);` -> 20 lignes : noms de clients (…), titres de jobs, montants (33000 cents). Aucune verification d'org. »

Le correctif retenu (L130-135) est une **révocation**, pas une garde :

```sql
revoke all on function public.search_global(uuid, text, integer, integer)
  from public, anon, authenticated;
```

La même migration reconnaît que la garde n'a pas pu être ajoutée (L110-121 : deux tentatives abandonnées, dont une qui « installait une fausse protection »). Les corps de `search_global`, `search_global_by_type`, `search_global_counts` **prennent toujours `p_org` en paramètre sans aucune vérification** — seule la permission a été retirée.

⚠️ **Piège de source** : `supabase/complete_schema.sql:3145-3147` contient encore les anciens `grant execute … to authenticated`. **Ce fichier est un instantané périmé, il ne doit pas servir de vérité de référence** — la vérité est la suite des migrations horodatées.

---

## 7. SQL brut et interpolation de chaînes

### 7.1 SQL brut : **néant**

Aucune occurrence de `queryRawUnsafe`, `sql.raw`, `knex.raw`, ni de template literal passé à un `.query(` dans `server/` ou `src/`. Tout passe par le query-builder `supabase-js` ou par des RPC. **Pas de surface d'injection SQL classique.**

### 7.2 Interpolation dans les filtres PostgREST — 10 occurrences

| Fichier:ligne | Valeur interpolée | Origine | Assainie ? |
|---|---|---|---|
| `server/routes/jobs.ts:96` | `q` | **`req.query.q` client** | ❌ **`.trim()` seulement** |
| `server/routes/jobs.ts:134` | `safe` | `req.query.q` client | ⚠️ partiel (`%` et `_` échappés, pas `,` `(` `)`) |
| `server/lib/agent/tools.ts:169` | `t` | body agent | ✅ `term.replace(/[%,()]/g, ' ')` |
| `server/lib/agent/tools.ts:321` | `t` | body agent | ✅ idem |
| `server/routes/security.ts:189, 309` | `auth.orgId` | session (UUID validé) | ✅ non contrôlable |
| `server/routes/campaigns.ts:124, 478` | `orgId` | session | ✅ (fichier non monté) |
| `server/routes/team-suggestions.ts:124` | `date` | serveur | ✅ |
| `server/routes/platform-admin.ts:76` | ISO date serveur | serveur | ✅ |

**Le seul cas non assaini** — `server/routes/jobs.ts:83-96` :

```ts
const q = (req.query.q as string || '').trim();
const admin = getServiceClient();
let query = admin.from('jobs').select(…)
  .eq('org_id', auth.orgId)          // ← ligne 89 : le scope tenant tient
  …
if (q) {
  query = query.or(`title.ilike.%${q}%,client_name.ilike.%${q}%`);   // ← ligne 96
}
```

**Sévérité honnête : faible, pas une fuite cross-tenant.** Le `.eq('org_id', auth.orgId)` de la ligne 89 est un prédicat `AND` séparé que le `or=` injecté ne peut pas retirer. Un appelant peut en revanche injecter des conditions arbitraires (`,` et `and(…)` sont la syntaxe PostgREST) et transformer la route en oracle booléen sur les colonnes de `jobs` **de sa propre org**. Incohérence à corriger : la route sœur ligne 134 et l'outil agent ligne 168 assainissent, celle-ci non. Ligne manquante à 96 : la même `replace(/[%,()]/g, ' ')` qu'à `agent/tools.ts:168`.

---

## 8. Helpers d'isolation : lesquels existent, lesquels servent

| Helper | Fichier | Appels hors définition |
|---|---|---|
| `requireAuthedClient` | `server/lib/supabase.ts:122` | **360** |
| `getServiceClient` | `server/lib/supabase.ts:16` | **458** |
| `isOrgAdminOrOwner` | `server/lib/supabase.ts:176` | **77** |
| `isOrgMember` | `server/lib/supabase.ts:159` | **28** |
| `shouldUseRequestedOrg` | `server/lib/active-org.ts:19` | 1 (`supabase.ts:148`) — mais c'est **la** garde de l'en-tête `x-org-id` |
| `parseOrgId` | `server/lib/helpers.ts:131` | 14 |
| `companyOrgIds` | `server/lib/supabase.ts:105` | groupes d'offices (billing, leaderboard) |
| **`assertOrgAccess` / `verifyOrgAccess`** | **`server/lib/org-access.ts:26, 44`** | **0 — ZÉRO** |

### 8.1 `server/lib/org-access.ts` existe, est documenté, et n'est appelé nulle part

Le fichier existe (53 lignes), son en-tête décrit précisément la règle « le tenant vient du serveur, jamais du client » :

```
 * When a route uses getServiceClient() (bypasses RLS), ANY org_id read from
 * the request body is untrusted. Call `assertOrgAccess()` before any write
 * or read scoped to that org_id to prevent cross-tenant override.
```

Vérification exhaustive sur `server/` et `src/` : **aucun import de `org-access`, aucun appel à `assertOrgAccess`, aucun appel à `verifyOrgAccess`.** Le helper est du code mort.

Deux conséquences pour l'audit DB :

1. Le RPC `verify_org_access(p_user_id, p_org_id)` figure dans la liste §6.1 uniquement à cause de ce fichier mort. **En pratique, il n'est jamais appelé par l'application.** Si l'audit DB constate des appels à `verify_org_access` en base, ils ne viennent pas de ce code.
2. `assertOrgAccess` s'appuie sur `req.user?.id` (`org-access.ts:48`), un champ que **rien ne peuple** dans ce serveur : l'identité vient de `requireAuthedClient` qui **retourne** `{ client, orgId, user }` sans l'attacher à `req`. Le commentaire L45 renvoie à `server/lib/auth.ts`, **fichier qui n'existe pas**. Le helper serait donc silencieusement inopérant s'il était branché tel quel (`userId` undefined → `OrgAccessError('Unauthenticated')` sur tout le monde) — même famille de bug que le §4.2.

L'isolation réelle est portée par `requireAuthedClient` + `isOrgMember`/`isOrgAdminOrOwner` + des `.eq('org_id', …)` écrits à la main dans chaque handler. C'est fonctionnel, mais **il n'y a aucun point de passage obligé** : la sécurité de 413 routes dépend de la discipline de 458 sites d'appel `getServiceClient()`, sans filet.

---

## Les 5 constats qui vont le plus influencer l'audit de la DB

### 1. Une migration corrigeant deux fuites **prouvées en production** n'a jamais été appliquée

`supabase/migrations/proposed/20260725000000_CRITICAL_rls_leak_fixes.sql` — le répertoire `proposed/` n'est pas lu par la CLI Supabase, qui ne charge que `supabase/migrations/*.sql`. En-tête du fichier (L1-5) :

> « 🔴 CRITIQUE — Correctifs de fuite inter-tenant (RLS). Audit 2026-07-08. **NON APPLIQUÉ**. Les deux fuites ci-dessous ont été **PROUVÉES en prod**. »

**Fuite A — la vue `properties_active` ignore la RLS.** L11-17 :

> « Prouvé : un user authentifié d'un org voit `properties` = 1 org (RLS ok), mais `properties_active` = **48 propriétés / 14 orgs** (adresses + GPS de tous). Cause : la vue n'a pas `security_invoker`. »

Vérifié dans le lignage des migrations appliquées — `supabase/migrations/20260707000000_properties_feature.sql:67-69` :

```sql
-- active view, matching clients_active / jobs_active convention
create or replace view public.properties_active as
  select * from public.properties where deleted_at is null;
```

Aucun `with (security_invoker = true)`, alors que **toutes** les vues sœurs l'ont (`20260321000000_mega_security_performance_fix.sql:13, 17, 21, 25, 29, 33, 37, 41`, `20260628000000_views_security_invoker.sql:20-21`, `20260714000000_jobs_derived_status.sql:23`…). Aucune migration appliquée ne corrige `properties_active`. Aggravant : `properties_active` n'est référencée **nulle part** dans `src/` ni `server/` — c'est une vue inutilisée qui expose 14 tenants.

**Fuite B — le correctif `surveys_select_anon` vise le mauvais nom de policy.** La policy créée est `surveys_select_anon` (`20260325000001_automation_engine.sql:298-301`) :

```sql
create policy "surveys_select_anon" on public.satisfaction_surveys
  for select to anon
  using (true);
```

Le correctif exécute (`20260513020000_security_p0_fixes.sql:114`) :

```sql
EXECUTE 'DROP POLICY IF EXISTS satisfaction_surveys_select_anon ON public.satisfaction_surveys';
```

`satisfaction_surveys_select_anon` ≠ `surveys_select_anon`. Le `IF EXISTS` avale l'absence : le `DROP` n'a **rien supprimé**, et le récapitulatif de la migration (L162) déclare pourtant « DROPPED (cross-tenant leak) ». Aucune migration ultérieure ne retouche ces policies. À vérifier en priorité, avec sa jumelle `surveys_update_anon` (`20260325000001:303-307`, `for update to anon using (submitted_at is null)`) qui autorise un anonyme à écrire dans les sondages non soumis de tous les tenants.

**Action DB n°1** : `select relname, reloptions from pg_class where relkind='v' and relnamespace='public'::regnamespace` et `select * from pg_policies where tablename='satisfaction_surveys'`.

### 2. Le motif « la garde vit dans le RPC, et `auth.uid()` y est NULL » a déjà cassé et va recasser

Le projet a documenté ce piège (`20260751101900_fix_dsr_export.sql:11-15`) et l'a corrigé pour `export_client_data` / `export_user_data`. Mais `anonymize_client` (`20260625000001_dsr_and_consents.sql:149-152`) porte toujours la garde `has_org_admin_role(auth.uid(), v_org)` **et** ses deux routes appelantes (`server/routes/dsr.ts:106, 128`) n'ont aucune vérification d'org côté serveur (§4.2). Résultat : droit à l'effacement inopérant aujourd'hui, IDOR destructive cross-tenant demain si quelqu'un « répare » le RPC sans toucher aux routes.

**Action DB n°2** : inventorier toutes les fonctions `SECURITY DEFINER` dont la garde repose sur `auth.uid()` **et** qui sont appelées depuis `server/` en `service_role`. La liste §6.1 est le point de départ ; `set_member_mfa_required`, `request_hard_delete_member`, `cancel_hard_delete_member`, `list_member_audit_events`, `invalidate_user_sessions` sont dans ce cas (mais leurs routes, elles, gardent explicitement — `team-compliance.ts:26-39`).

### 3. 48 RPC et 78 tables/vues sont atteignables **directement** depuis le navigateur

Le frontend parle à PostgREST avec la clé anon + JWT (`src/lib/supabase.ts:14`). Il interroge 78 objets distincts en direct et appelle 48 RPC (§6.2). Pour tous ces objets, **l'API Express n'est pas une frontière de sécurité** — un attaquant contourne les 413 routes et leurs gardes en une requête `curl`.

`search_global` prouve que le risque est réel et pas théorique (§6.3) : `SECURITY DEFINER` + `p_org` en paramètre + `grant to authenticated` = lecture de tous les tenants, constatée en prod. La correction retenue a été de **révoquer** — le corps de la fonction reste non gardé.

**Action DB n°3** : croiser `pg_proc.prosecdef = true` × `has_function_privilege('authenticated', oid, 'EXECUTE')` × présence d'un paramètre `uuid`, et pour chaque résultat vérifier qu'un `has_org_membership(auth.uid(), …)` figure dans le corps. Priorité aux 12 `delete_*_cascade` / `restore_*` / `batch_soft_delete_clients` de la liste §6.2.

### 4. La RLS est le dernier rempart — et pour certaines routes, le seul

Deux surfaces n'ont **aucune** garde applicative et délèguent tout à la RLS :

* `GET /api/payments/providers/status` (`server/routes/payments.ts:1023-1027`) → l'unique barrière est le `.single()` RLS de `server/lib/payments.ts:124-128`, après quoi le code lit `payment_provider_secrets` **en service_role** (`payments.ts:136-142`).
* Les 78 objets lus en direct par le frontend (§1.2).

À l'inverse, 458 appels `getServiceClient()` **contournent** la RLS. Le serveur est donc simultanément le contournement le plus large de la RLS et son consommateur le plus dépendant, sans point de passage obligé (§8).

**Action DB n°4** : pour chaque table du §1.2 accédée directement par le frontend, vérifier `relrowsecurity = true` **et** `relforcerowsecurity`, et que chaque policy utilise `has_org_membership(auth.uid(), org_id)`. En particulier `payment_provider_settings`, `payment_provider_secrets`, `properties`, `memberships`, `orgs`, `profiles`.

### 5. `complete_schema.sql` est périmé — ne pas l'utiliser comme référence

`supabase/complete_schema.sql:3145-3147` contient encore :

```sql
grant execute on function public.search_global(uuid, text, int, int) to authenticated;
```

alors que `20260751101400_secdef_least_privilege.sql:130-135` révoque exactement ces droits. Le fichier contient aussi **deux définitions concurrentes** de `has_org_admin_role` — une `plpgsql` (L6962, avec un `if p_user = p_org then return true` surprenant) et une `sql` (L7283) — sans qu'on puisse déterminer laquelle est en base.

**Action DB n°5** : reconstruire la vérité depuis `pg_catalog` (`pg_proc.prosrc`, `pg_policies`, `pg_class.reloptions`), jamais depuis `complete_schema.sql`. Ordonner le lignage par nom de fichier de migration ; noter que la numérotation `20260751…` dépasse les mois réels (751 > 12), donc le tri lexicographique est le seul ordre fiable.

---

## Annexe — points ouverts (`INCONNU`)

| # | Question | Pourquoi ça compte |
|---|---|---|
| 1 | État réel en base de `public.anonymize_client` — la garde `auth.uid()` est-elle toujours là ? | Décide si §4.2 est « cassé » ou « exploitable ». |
| 2 | `public.ensure_payment_settings_row(uuid)` est-elle `SECURITY DEFINER` ? | Si oui, `payments.ts:1023` permet de créer une ligne dans un tenant tiers (§3). |
| 3 | `properties_active` a-t-elle `security_invoker` en base ? | Fuite prouvée de 14 orgs si non (constat 1). |
| 4 | Les policies `surveys_select_anon` / `surveys_update_anon` existent-elles encore ? | Le `DROP` correctif visait le mauvais nom (constat 1). |
| 5 | Les révocations de `20260751101400` ont-elles été **effectivement appliquées** en prod ? | Sans elles, `search_global` fuit encore (§6.3). |
| 6 | Combien des 48 RPC frontend sont `SECURITY DEFINER` sans garde d'org ? | Chemin d'attaque qui contourne totalement Express (constat 3). |
| 7 | RLS activée + forcée sur les 78 objets lus en direct par le navigateur ? | Seule protection de ces objets (constat 4). |
| 8 | Existe-t-il des lignes déjà croisées entre orgs ? | La sonde `references_croisees_orgs` de `20260730180000_canari_ssrf_pgnet.sql:110-116` répond directement — lire `public.security_canary_runs`. |
