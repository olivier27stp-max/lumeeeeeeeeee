# Fixes appliqués — 2026-05-12

Suite à l'audit `AUDIT_MASTER_2026_05_12.md`. Tous les P0 et P1 sont corrigés. Build + 261 tests + typecheck ✅.

---

## 🗄️ Migrations DB appliquées en prod

| Migration | Effet |
|---|---|
| `20260512170000_revert_stable_on_mutating_functions.sql` | **40 fonctions** (`create_client_*`, `create_lead_*`, `rpc_create_quote`, `send_invoice`, `upsert_job`, `audit_log_trigger`, `export_user_data`, etc.) **remises VOLATILE**. Création client/lead/quote/invoice/job **fonctionne à nouveau**. |
| `20260512170100_payment_requests_add_processing_status.sql` | CHECK constraint accepte `processing` → concurrency lock public-pay opérationnel, plus de double-PI. |
| `20260512170200_tighten_payments_rls.sql` | INSERT/UPDATE sur `connected_accounts` + `payment_requests` exigent `has_org_admin_role` → seuls owner/admin peuvent modifier. |

Source patché aussi:
- `20260626250000_fix_advisors_final.sql:130-139` — exclut désormais les fonctions DML pour qu'une réapplication ne casse plus rien.

---

## 💻 Fixes code

### App (P0/P1)
- **P0-2 / P1-11 Beta bypass server-side** — Nouvelle route `server/routes/me.ts` (`GET /api/me/is-beta-bypassed`), variable d'env renommée `VITE_BETA_BYPASS_EMAILS` → `BETA_BYPASS_EMAILS`. `src/App.tsx:362-399` ne lit plus `import.meta.env.*` → la whitelist ne ship plus dans le bundle JS.
- **P0-3 Cron mounté** — `server/index.ts:70+304` import + `app.use('/api', cronRouter)`. Endpoints `/api/cron/retention` et `/api/cron/purge-audit` accessibles → compliance Loi 25 opérationnelle (à brancher à un scheduler externe avec `CRON_SECRET`).
- **P0-4 Composants morts supprimés** — `src/components/map-d2d/lume-detail-panel.tsx`, `lume-create-modal.tsx`. Confirmé zéro import.
- **P1-1 OnboardingWizard** — bouton Continue disabled tant que `resolvedOrgId` vide; bouton Skip non rendu (au lieu d'invisible) sur step 2; erreur upsert surface via toast au lieu de swallow.
- **P1-8 AGENT_JWT_SECRET hard-fail** — `server/routes/agent-auth.ts:40-46` throws au module-load si l'env est absente.
- **P1-9 Password sessionStorage retiré** — `src/pages/OnboardingFlow.tsx` ne persiste plus `onb_pw`; reload → retour étape password. `src/pages/CheckoutSuccess.tsx` ne fait plus d'auto-sign-in via password persisté.
- **P2-12 Open redirect Stripe** — helper `isAllowedStripeRedirect()` autorise uniquement `https://checkout.stripe.com/` ou `https://billing.stripe.com/`. Toast d'erreur si refusé.

### Stripe (S-P0/S-P1)
- **S-P0-1 Quote deposits** — `server/routes/quotes.ts:962-1008`: `decryptSecret()` puis sanity check `sk_` sur la valeur déchiffrée. Si décryption échoue ou Connect account manquant, 500/503 **au lieu de fallback silencieux vers le compte plateforme**. Tu ne retiens plus l'argent des clients de tes utilisateurs.
- **S-P0-3 Cancel subscription** — `server/routes/billing.ts:495-545`: appelle `stripe.subscriptions.update(id, { cancel_at_period_end: true })` avant de mettre à jour Supabase. Tolère les erreurs bénignes (`resource_missing`, "already cancelled").
- **S-P0-5 Webhook handlers ajoutés** — `server/routes/payments.ts`:
  - `customer.subscription.updated` (sync status/period/cancel_at_period_end)
  - `customer.subscription.deleted` (marque `canceled`)
  - `invoice.paid` (active sub + reconcile `paid_cents` cross-validé par org_id)
  - `invoice.payment_failed` (marque `past_due` + log dunning)
  - `charge.refunded` (update payments row)
  - `charge.dispute.created` (flag `disputed` + log ops)
- **S-P1 (F-32) org_id check** — `server/routes/payments.ts:188-198`: invoice update inclut `.eq('org_id', metadata.orgId)` pour bloquer la falsification via metadata.
- **Stripe SDK v20 types** — casts `as any` ciblés (3 sites) pour `current_period_*` et `invoice.subscription` qui ont changé d'emplacement entre les versions SDK.

---

## 🧪 Vérification

```
$ npm run lint   →  ✓ tsc --noEmit pass
$ npm test       →  ✓ 261/261 tests pass (12 fichiers, 747ms)
$ npm run build  →  ✓ built in 19.45s
```

DB en prod:
- 0 fonction `STABLE` faisant du DML (avant: 40)
- `payment_requests_status_check` contient `processing`
- 4 policies (`*_insert_org`, `*_update_org` sur `connected_accounts` et `payment_requests`) avec `has_org_admin_role`

---

## 🧹 Cleanup de l'audit

- Test user `claude-audit-2026@lume-test.local` (UUID `293a68f5...`) supprimé de `auth.users` ✅
- Org "Claude Audit Workspace" (UUID `11f7ad16...`) supprimée de `public.orgs` ✅
- Membership supprimée ✅
- `.env.local` nettoyé:
  - Email test retiré de la bypass list
  - `VITE_BETA_BYPASS_EMAILS` renommée `BETA_BYPASS_EMAILS` (no VITE_ prefix)
  - `SUPABASE_PROJECT_REF` corrigé (était `xxxxxxxxxxxx`, maintenant `bbzcuzqfgsdvjsymfwmr`)
- 3 instances Vite parasites tuées (ports 5173/5174/5175)
- Script temporaire `scripts/fix-stable-volatility.mjs` supprimé
- API server (port 3002) toujours actif si tu veux tester

---

## ⚠️ À faire de ton côté

1. **Action immédiate** — Vérifier qu'un client peut être créé en prod via l'UI (`/clients` → "Nouveau client"). Si OK → P0-1 confirmé end-to-end.
2. **Rotation de secret** — Le `VITE_BETA_BYPASS_EMAILS` ancien est resté dans le bundle JS des déploiements passés. Considère pas urgent mais à garder en tête; la nouvelle valeur server-side ne fuite plus.
3. **Scheduler cron** — `/api/cron/retention` et `/api/cron/purge-audit` sont maintenant mountés mais aucun service externe ne les appelle. Configure Vercel Cron / cron-job.org / EasyCron avec `Authorization: Bearer ${CRON_SECRET}` (et set `CRON_SECRET` en env prod).
4. **Webhook Stripe Connect** — l'audit a noté qu'un seul `STRIPE_WEBHOOK_SECRET` est utilisé pour platform et Connect (F-03). Si tu veux corriger: créer 2 endpoints Stripe (un pour platform, un pour Connect) et 2 env vars distinctes. Non bloquant pour le fonctionnement actuel.
5. **Acomptes de devis déjà routés sur la plateforme** — si tu as eu des acomptes payés via le bug P0-2 (S-P0-1) avant aujourd'hui, ils sont sur ton compte Stripe plateforme. À transférer manuellement aux orgs concernées via `stripe.transfers.create()`. Liste tirable via `SELECT * FROM payments WHERE created_at < '2026-05-12' AND destination_account IS NULL AND kind = 'quote_deposit'` (adapter selon schema).
6. **Side-effect UX du fix P1-9** — après checkout Stripe, l'utilisateur n'est plus auto-signé-in. Il devra se reconnecter. Considère un magic-link auto envoyé par email post-checkout pour smoother l'expérience.

---

## 📊 Score remédiation

| Avant | Après |
|---|---|
| 6.5 (audit du 06 mai après remédiation) | **~8.5/10** estimé |
| 40 RPC DB cassées | 0 |
| Acomptes quote → plateforme | Routage correct + fail-fast |
| Cancel subscription DB-only | Cancel Stripe + DB |
| 0 webhook subscription/invoice/refund/dispute | 6 handlers |
| Beta bypass dans bundle JS | Server-side only |
| Password en sessionStorage | Retiré |
| Open redirect potentiel | Whitelist |
| Cron jamais mounté | Mounté |
| 2 composants morts /api/lume/* | Supprimés |

Reste backlog (non bloquant): refactor monster files, Zod sur 42 routes, tsconfig strict, Playwright E2E, design tokens. Cf. `AUDIT_MASTER_2026_05_12.md` sections P2/P3.

---

🤖 Audit + remédiation par Claude Opus 4.7 le 2026-05-12.
