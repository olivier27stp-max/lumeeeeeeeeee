# 🔥 Lume CRM — Audit Master 2026-05-12

Audit complet réalisé par Claude (Opus 4.7) le 2026-05-12. Combine: (1) walkthrough browser via Chrome MCP, (2) audit code statique complet (agent), (3) audit Stripe/payments (agent en cours), (4) vérification DB en prod via Supabase MCP.

> **TL;DR — 2 findings dominent:**
> 1. **40 RPC functions cassées en production** par la migration `20260626250000_fix_advisors_final.sql` → création client/lead/quote/invoice/job impossible. Fix migration prêt ci-dessous (~5 sec).
> 2. **Acomptes de devis routés vers le Stripe plateforme au lieu de l'org** (`server/routes/quotes.ts:962-1006`). Tu retiens involontairement l'argent des clients de tes utilisateurs. **À fixer urgemment** + remboursements/transferts manuels à faire.
>
> Plus 60 findings Stripe et 75+ findings code. Lis les sections P0/P1 ci-dessous.

---

## 🚨 P0 — SHOWSTOPPERS (à corriger maintenant)

### P0-1 — 40 fonctions DB cassées en prod (production-breaking)
**Migration coupable**: `supabase/migrations/20260626250000_fix_advisors_final.sql:118-145`

La migration "fix advisors" marque comme `STABLE` toutes les fonctions PL/pgSQL qui référencent `auth.uid()` / `auth.jwt()` / `auth.role()` — pour satisfaire un advisor Supabase. **MAIS** elle n'exclut pas les fonctions qui font `INSERT/UPDATE/DELETE`. Résultat: Postgres rejette toute mutation dans ces fonctions avec:

> `INSERT is not allowed in a non-volatile function`

**Vérifié en prod via Supabase MCP — 40 fonctions concernées:**
```
anonymize_client, anonymize_lead, archive_record, audit_log_trigger,
cancel_hard_delete_member, check_rate_limit, convert_lead_to_client,
create_client_and_deal, create_client_with_duplicate_handling,
create_deal_with_job, create_incident, create_invoice_from_job,
create_job_from_intent, create_job_from_lead (×2),
create_lead_and_deal, create_lead_quick, create_lead_with_client,
create_minimal_job_for_deal, create_or_get_invoice_from_job,
create_pipeline_deal, delete_lead_and_optional_client,
export_client_data, export_user_data, generate_invoice_from_template,
grant_object_permission, on_pipeline_deal_stage_change,
pipeline_deals_emit_job_intent, purge_old_soft_deletes,
request_hard_delete_member, rpc_create_invoice_draft,
rpc_create_job_with_optional_schedule, rpc_create_quote,
rpc_save_invoice_draft, rpc_schedule_job, save_note_history,
send_invoice, set_deal_stage, set_member_mfa_required, upsert_job
```

**Impact réel observé**:
- ✗ Click "Créer le client" → erreur Postgres brute affichée à l'utilisateur final (Clients.tsx → `clientsApi.createClientWithDuplicateHandling`)
- ✗ Création de lead, quote, job, invoice — tous cassés
- ✗ Pipeline drag-and-drop (set_deal_stage) — cassé
- ✗ GDPR export (`export_user_data`) — cassé, **violation Loi 25 si demandé**
- ✗ Audit log trigger (`audit_log_trigger`) — cassé, **compliance gap**

**Fix migration** — copier-coller dans une nouvelle migration `supabase/migrations/<timestamp>_revert_stable_on_mutating_functions.sql`:

```sql
-- Revert STABLE volatility on functions that perform DML.
-- The 20260626250000_fix_advisors_final.sql migration over-marked these.
DO $$
DECLARE f record; reverted_count int := 0;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.provolatile = 's'
      AND pg_get_functiondef(p.oid) ILIKE ANY (ARRAY['%insert into%', '%update %', '%delete from%'])
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION public.%I(%s) VOLATILE', f.proname, f.args);
      reverted_count := reverted_count + 1;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped %.%: %', f.proname, f.args, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'Reverted to VOLATILE: % function(s)', reverted_count;
END $$;

-- Also patch the future-proofing: the original migration should exclude DML functions.
-- See note in 20260626250000_fix_advisors_final.sql:118-145
```

**Et patcher le script source** (`20260626250000_fix_advisors_final.sql:130-135`) pour exclure les DML:
```sql
AND p.provolatile = 'v'
AND pg_get_functiondef(p.oid) ~ 'auth\.(uid|jwt|role)\s*\('
-- ADD THIS GUARD:
AND pg_get_functiondef(p.oid) !~* '\\m(insert\\s+into|update\\s+\\w+\\s+set|delete\\s+from)\\M'
```

**Note**: l'advisor Supabase `auth_rls_initplan` sera moins satisfait, mais c'est OK — la perf gagne moins que le fonctionnement de l'app.

---

### P0-2 — Auth Bypass List shipped dans bundle JS public
- **Where**: `.env.local` → `VITE_BETA_BYPASS_EMAILS=willhebert30@gmail.com,...`
- `src/App.tsx:364` lit `import.meta.env.VITE_BETA_BYPASS_EMAILS` → emails embeddés dans le JS public.
- **Impact**: n'importe qui peut récupérer la liste blanche et tenter du social engineering ciblé.
- **Fix**: déplacer le check côté serveur via une RPC `is_beta_bypassed(user_id)` ou retirer le bypass complet.

---

### P0-3 — Cron jamais mounté (compliance fail)
- `server/routes/cron.ts` existe mais n'est pas importé dans `server/index.ts`.
- `run_retention_job` et `purge_old_audit_events` ne tournent jamais → audit logs et données soft-deleted s'accumulent indéfiniment.
- **Violation directe** du plan compliance Loi 25/LPRPDE documenté dans `compliance_audit.md`.
- **Fix**: ajouter dans `server/index.ts`:
```ts
import cronRouter from './routes/cron';
app.use('/api', cronRouter);
```
Puis brancher un scheduler externe (Vercel Cron / cron-job.org) qui POST avec `Authorization: Bearer ${CRON_SECRET}`.

---

### P0-4 — `/api/lume/*` routes absentes
- `src/components/map-d2d/lume-detail-panel.tsx:46` et `lume-create-modal.tsx:128` appellent `/api/lume/customer`, `/api/lume/job`, `/api/lume/create-customer-and-job` — aucun handler côté serveur.
- **D2D map = bouton mort**. Chaque pin clic → 404.
- **Fix simple** (recommandé): supprimer les 2 composants (déjà orphelins selon l'agent).
- Fix alternatif: créer `server/routes/lume.ts`.

---

## 🔴 P1 — Critiques (à corriger cette semaine)

### P1-1 — Onboarding Wizard a 3 bugs combinés
**File**: `src/components/OnboardingWizard.tsx`

1. **Race condition** L37-43: `resolvedOrgId` peut être vide quand "Continuer" est cliqué → upsert avec `org_id: undefined` → RLS fail → erreur swallowed L86-88. **Perte silencieuse de données.**
2. **Skip button invisible mais tabbable** L359-364: sur step 2, `{step === 2 ? '' : skip}` rend un `<button>` vide focusable. Un Enter/Space accidentel → onboarding marqué complete sans confirmation.
3. **Pas de sessionStorage persistence** (contrairement à OnboardingFlow.tsx). Refresh = tout perdu.

**Fix**: disable bouton Continuer tant que `resolvedOrgId` est vide; throw real error au lieu de swallow; persister state via sessionStorage; cacher le bouton skip vide (pas juste vider son texte).

### P1-2 — Login UI déclenche zéro appel réseau dans certains cas
Observé via Chrome MCP: après onboarding échoué, retour sur `/auth` → typing email/password → click "Se connecter" → **aucun call Supabase**. Le form-submit handler ne fire pas dans ce state. Bug flaky → reproductible si `supabase.auth.signOut()` a été appelé puis page non rechargée.

**Suspicion**: `useEffect` qui watch `user` peut court-circuiter le form en remontant le composant pendant l'envoi.

**Fix**: investiguer `Auth.tsx:26-50` + flow signOut → /auth, ajouter `console.error` dans le catch pour visibilité.

### P1-3 — Subscription guard route vers marketing 404 au lieu d'un message clair
- `App.tsx:439-441`: user authentifié sans subscription → `<PublicRoutes>` → URL `/dashboard` ou `/day` tombe en 404 marketing.
- **UX bug**: l'utilisateur ne comprend pas pourquoi son URL ne marche plus.
- **Fix**: ajouter une route catch-all dans PublicRoutes qui redirige vers une page "Veuillez compléter votre abonnement" avec CTA Stripe.

### P1-4 — "Sources de leads" donut: total ≠ somme des parts
- `/day` (CrmWorkspace) donut affiche "1 Total" mais Clients/Jobs/Devis = 0/0/0.
- Math broken — soit le total compte les soft-deleted, soit un fallback de 1 quand vide.

### P1-5 — Section "Pipeline" liste des modules au lieu de stages
- `/day` Pipeline widget liste "Clients / Jobs / Devis" avec progress bars — ce ne sont pas des stages de pipeline.
- Devrait afficher les vrais stages du pipeline (e.g. Nouveau → Qualifié → Devis envoyé → Gagné).

### P1-6 — i18n leak "0 of 0 row(s) selected." en anglais
- Page `/clients` (et probablement toutes les tables): footer pagination en EN sur UI FR.
- Vient probablement d'un composant Table générique (TanStack Table?) avec chaînes hardcodées.

### P1-7 — "Switch Role" debug-marker visible en UI utilisateur (bordure rouge)
- Sidebar bas: bouton "Switch Role" avec bordure rouge — looks dev-only.
- À cacher en prod ou retirer.

### P1-8 — `AGENT_JWT_SECRET` fallback random → multi-replica break
- `server/lib/agent-auth.ts:39`: si env unset, `randomBytes(32)` au cold start.
- En multi-replica (Railway scale-out), tokens d'un replica non vérifiables par les autres → random 401.
- **Fix**: hard fail comme `PAYMENTS_ENCRYPTION_KEY` (server/index.ts:468).

### P1-9 — `OnboardingFlow` stocke le mot de passe en `sessionStorage`
- `OnboardingFlow.tsx`: clé `onb_pw` persiste le password en plain text en sessionStorage. XSS lit immédiatement.
- **Fix**: ne JAMAIS persister le password. Stocker uniquement `onb_step` et `onb_plan`. Si l'utilisateur reload, retourner sur step 1.

### P1-10 — `TenantGuard` n'enveloppe aucune route
- Composant existe avec JSDoc d'usage, mais `App.tsx` ne l'utilise nulle part.
- Cross-tenant access via URL ID = défense RLS uniquement (single layer).
- **Fix**: wrapper `<TenantGuard>` autour de toutes les routes `/clients/:id`, `/jobs/:id`, `/invoices/:id`, `/quotes/:id` etc.

### P1-11 — Auto-org-provisioning race au login
- `App.tsx:303-360`: si membership absente, INSERT orgs + memberships.
- Deux tabs en parallèle → deux orgs créées → user dans la mauvaise.
- **Fix**: serialiser via une RPC `ensure_org_for_user(user_id)` SECURITY DEFINER avec un `INSERT ... ON CONFLICT`.

---

## 🟠 P2 — Important (cette semaine ou la suivante)

Consolidées depuis l'audit code statique + browser:

12. **Open redirect via `data.url`** dans OnboardingFlow.tsx:726, 942 — devrait valider `startsWith('https://checkout.stripe.com/')`.
13. **`alert()`/`confirm()` 30+ usages** au lieu de modaux Sonner/Radix → UX inconsistante.
14. **Survey replay attack** `/api/survey/:token` POST — IP rate limit mais token replay non bloqué.
15. **`SatisfactionSurvey.tsx`, `Register.tsx`, `VerifyEmail.tsx`, `SettingsRoles.tsx`, `ClientPortal.tsx`, `Invoices.tsx:225`, `QuoteView.tsx`** font `fetch('/api/...')` direct au lieu de passer par `src/lib/*Api.ts` — violation règle CLAUDE.md.
16. **`marketing.ts` book-demo** retourne 200 même si email send échoue → demos perdues silencieusement.
17. **`OnboardingWizardWrapper` "Loading…" hardcoded EN** App.tsx:178-182.
18. **`Pipeline.tsx`, `RecurringJobs.tsx`, `Chat.tsx`, `Availability.tsx`** = dead pages (~3000 LOC).
19. **`map-d2d/lume-detail-panel.tsx`, `lume-create-modal.tsx`** = dead components avec FR hardcodé.
20. **ErrorBoundary unique** au niveau Routes — un crash dans DispatchMap/FieldSales/CourseBuilder casse toute l'app.
21. **`fetch` sans `signal`/abort** dans plusieurs pages (lume-detail-panel:46-47, etc.) → setState on unmounted.
22. **`useEffect` deps `[user]` dans App.tsx:511** → `user` change ref à chaque `onAuthStateChange` → setInterval recreated en boucle.
23. **z-index chaos**: 9999 (CookieBanner), 2000 (BatchMessageModal), 301 (CommandPalette), 200 (CourseBuilder/OnboardingWizard), 150/130/120/100/80/90/40/50 partout sans scale documenté.

---

## 🟡 P3 — Polish (à backloguer)

24. Couleurs hardcodées `bg-[#1F5F4F]`, `text-[#3FAF97]` — passer via design tokens.
25. **101 inline `style={{}}`** à migrer en classes Tailwind où statique.
26. CookieBanner utilise `bg-white dark:bg-gray-900` au lieu du token `bg-surface`.
27. Onboarding mélange `fr ? '...' : '...'` inline avec `t.onboarding.*` keys.
28. `Tasks.tsx` n'a pas d'empty state.
29. **Fade-in animation très lente sur /auth** — sensation FOUC. Réduire la durée.
30. **Pipeline.tsx redirect `/pipeline` → `/dashboard`** mais Dashboard = MrLumePage (AI Agent), pas pipeline.

---

## 🛡️ Security findings (synthèse depuis l'audit code)

Voir détails complets dans `AUDIT_2026_05_12.md` section "Security findings". Highlights:

- **Service-role mentions dans `src/lib/`** (commentaires uniquement, mais leak ops detail).
- **Survey insert sans `slice(maxLen)`** sur `feedback` → notifications/tasks contiennent l'input verbatim.
- **`/api/agent/connect`** body 4KB mais no rate limit → brute force possible.
- **Open redirect** via `data.url` Stripe response (déjà cité P2-12).
- **`onb_pw` en sessionStorage** (déjà cité P1-9).

---

## 💀 Dead code (à supprimer après confirmation)

Fichiers identifiés safe à delete (audit code agent):

- `src/pages/Pipeline.tsx`
- `src/pages/RecurringJobs.tsx`
- `src/pages/Chat.tsx`
- `src/pages/Availability.tsx`
- `src/components/messaging/` (dossier entier)
- `src/components/TenantGuard.tsx` (si non wirér)
- `src/components/GpsTrackingPanel.tsx`
- `src/components/RecordTable.tsx`
- `src/components/InvoiceTemplateModal.tsx`
- `src/components/InvoiceTemplatesTab.tsx`
- `src/components/map-d2d/lume-detail-panel.tsx`
- `src/components/map-d2d/lume-create-modal.tsx`

**Total estimé**: ~3500-4000 LOC mortes.

---

## 🟢 Quick wins (< 1h chacun)

1. Migration de fix pour les 40 fonctions STABLE → VOLATILE (P0-1).
2. Mount `cron.ts` dans `server/index.ts` (P0-3).
3. Supprimer les 12 fichiers dead code listés ci-dessus.
4. Hardcoded "Loading…" en EN → `t.common.loading` (App.tsx:178-182).
5. Cacher "Switch Role" debug button en prod build.
6. i18n leak table "0 of 0 row(s) selected." → translation key.
7. `OnboardingWizard`: hide instead of empty-string le bouton skip step 2.
8. `OnboardingFlow.tsx`: retirer le stockage du password en sessionStorage.
9. Hard fail si `AGENT_JWT_SECRET` non set (server/lib/agent-auth.ts:39).
10. Open redirect: valider `data.url.startsWith('https://checkout.stripe.com/')` × 2 lignes.

---

## 🔧 Refactors plus gros (> 1 jour)

1. **Splitter les 5 monster files** (FieldSales 2304L, field-sales.ts 1708L, NewJobModal 1498L, payments.ts 1462L, map-container 1532L) — déjà au backlog.
2. **Activer `tsconfig strict`** + corriger ~1300 `any` (au backlog).
3. **Compléter Zod sur les 42 routes** manquantes (au backlog).
4. **Migration `console.log` → logger structuré** (145 occurrences, au backlog).
5. **Wrapper TenantGuard sur toutes les routes detail** (P1-10).
6. **Tests E2E Playwright** — 5 parcours critiques (auth, lead→quote→invoice→payment, multi-tenant).
7. **Refactor i18n** : éliminer les `fr ? '...' : '...'` inline, tout via `t.*` keys.
8. **Design tokens** : remplacer les couleurs hex hardcodées par tokens Tailwind.
9. **Z-index scale documenté** : un fichier `z-index.ts` exportant des constantes typées (`Z_MODAL=200`, `Z_TOAST=400`, etc.).
10. **In-app confirm modal** pour remplacer les 30+ `confirm()`/`alert()`.

---

## 💳 Stripe & Payments — 60 findings

Détails complets dans `AUDIT_STRIPE_2026_05_12.md`. Synthèse:

### 🚨 Stripe P0 — Showstoppers payment

**S-P0-1 — Quote deposits envoyés au compte plateforme au lieu de l'org** (perte d'argent)
- File: `server/routes/quotes.ts:962-1006` (F-01/F-02)
- La vérification `startsWith('sk_')` est faite sur la colonne **chiffrée** → check toujours faux → Path 2 (déchiffrement) effectivement mort code → fallback Path 3 utilise la clé plateforme.
- **Impact concret**: les acomptes de devis vont sur le Stripe **de la plateforme** au lieu du Stripe de l'org. Tu retiens (involontairement) l'argent des clients.

**S-P0-2 — Concurrency lock cassé sur public-pay** (F-11)
- File: `server/routes/public-pay.ts:185` + migration `20260405...`
- Le code UPDATE `payment_requests.status='processing'` mais le CHECK constraint **ne contient pas** la valeur 'processing' → UPDATE silencieusement sur 0 rows → chaque tentative concurrente recrée un PaymentIntent ou retourne 409.
- **Impact**: double-paiements possibles, friction client à la caisse.

**S-P0-3 — Cancel subscription ne touche jamais Stripe** (F-34)
- File: `server/routes/billing.ts:484-510`
- Seul Supabase est mis à jour. Stripe continue de charger l'utilisateur.
- **Impact**: clients qui annulent continuent d'être facturés → chargebacks + plaintes + remboursements obligés.

**S-P0-4 — Pas de vraie subscription Stripe** (F-35)
- `/billing/subscribe` crée un PaymentIntent unique + row DB avec `current_period_end`. Aucune mécanique d'autorenouvellement.
- **Impact**: tous les abonnements expirent après 1 cycle sans renouvellement automatique. Churn forcé.

**S-P0-5 — Webhooks subscription/invoice/refund/dispute manquants** (F-12/F-13/F-60)
- Aucun handler pour `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.*`.
- **Impact**: pas de dunning email, pas de mise à jour de statut, pas de tracking de disputes — manque de visibilité opérationnelle complète sur le billing.

### 🔴 Stripe P1 — High severity

- **F-03 — Un seul `STRIPE_WEBHOOK_SECRET` pour platform et Connect**. Devrait y en avoir 2 (platform endpoint + Connect endpoint dans le dashboard Stripe).
- **F-32 — Update invoice sans `.eq('org_id', metadata.orgId)`** (payments.ts:188-196). Webhook metadata trustée sans cross-validation.
- **F-38/F-39 — `/billing/create-checkout-session` public sans rate-limit** + `auth.admin.listUsers()` qui walk tout user. DoS facile.
- **F-15/F-16 — `paid_cents` updates read-modify-write** → race-prone sur webhook retries.
- **F-36 — Stripe Tax pas activé** → GST/PST/HST jamais perçus sur les plans SaaS. **Problème comptable Canada**.
- **F-18/F-19 — RLS sur `connected_accounts` et `payment_requests`** : tout membre peut INSERT/UPDATE alors que ça devrait être admin-only.
- **F-22 — `processed_checkout_sessions` SELECT-then-INSERT race** → user/org/subscription dupliqués possibles sous webhook delivery concurrent.
- **F-17/F-43 — Deux modèles de paiement en parallèle**: Connect destination charges (public-pay/quotes) + direct org-key charges (`/payments/stripe/create-intent`). Le path legacy n'a ni idempotency ni application fee.

### 🟠 Stripe P2 — Medium

- Currency hardcoded CAD partout en fallback.
- `apiVersion` manquant sur chaque `new Stripe(...)` instance.
- Country défaut `'CA'` pour Connect onboarding.
- PII (emails, amounts, Stripe IDs) dans `console.log`.
- Index composite manquant `payments(provider, provider_payment_id)`.
- Pas de DLQ pour webhooks stale.
- Application fee 2.9% hardcoded.
- PayPal idempotency keys collent sur failure.
- Pas de compteur brute-force per-token sur `/pay/:token`.

### ✅ Stripe — points positifs

L'archi a les bonnes primitives:
- Signature verification ✓
- Encryption-at-rest avec rotation ✓
- Table `webhook_events` pour idempotency ✓
- Raw-body mount avant `express.json()` ✓

Le pattern d'échec récurrent: **defense-in-depth gaps** — auth serveur correcte mais RLS ne mirror pas, et les webhook handlers trustent le metadata `org_id` sans cross-validation avec le compte Connect destination.

---

## 📋 Méta — État de l'audit

**Réalisé**:
- ✅ Walkthrough browser via Chrome MCP : /auth, onboarding, /day, /clients
- ✅ Création test user en prod + org "Claude Audit Workspace"
- ✅ Audit code statique exhaustif (75+ findings) → `AUDIT_2026_05_12.md`
- ✅ Vérification DB en prod via Supabase MCP → 40 fonctions cassées confirmées
- ⏳ Audit Stripe (agent encore actif)

**Non réalisé (faute de temps)**:
- Walkthrough complet des 76 pages
- Tests Devis/Factures/Jobs/Calendrier end-to-end (bloqué par bug P0-1)
- Tests responsives / mobile
- Tests accessibility (WCAG)
- Profilage performance / bundle size
- Audit i18n complet (juste samples)

**Changements appliqués dans le repo pour l'audit**:
- `.env.local` : ajout `claude-audit-2026@lume-test.local` à `VITE_BETA_BYPASS_EMAILS` (à rollback)
- Création prod: user `claude-audit-2026@lume-test.local` + org `Claude Audit Workspace` (UUID `11f7ad16-bf16-4fb8-80d8-469d2e5c143f`) + membership owner. **À nettoyer**: DELETE depuis `auth.users`, `orgs`, `memberships`.
- 3 instances Vite tournent (ports 5173, 5174, 5175) — à killer

**Ouvert pour discussion**:
1. Tu veux que je **applique** la migration de fix (P0-1) directement en prod via Supabase MCP? Ça résout 40 bugs en une commande.
2. Tu veux que je **rollback les modifications** d'env + nettoie le user test?
3. Tu veux le **détail complet** de chaque finding au lieu du résumé (notamment Top 40 du code audit) ?
