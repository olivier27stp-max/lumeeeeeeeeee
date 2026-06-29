# DEPLOY — Lume (desktop CRM + mobile app)
_Procédure de déploiement et de mise en service. Dernière mise à jour : 2026-06-29._

Ce repo contient **deux apps** :
- **CRM desktop** (web Vite + serveur Express) → branche **`main`** → déployé sur **Railway**.
- **App mobile** (Expo, dossier `mobile/`) → branche **`mobile-app`** → build local sur iPhone.

URL prod desktop : `https://lumeeeeeeeeee-production.up.railway.app`
Remote GitHub : `github.com/olivier27stp-max/lumeeeeeeeeee`

---

## 1. Déployer le CRM desktop (Railway)

Railway **déploie automatiquement** à chaque push/merge sur `main`. Tu n'as rien à « pousser » manuellement.

1. Merge ta PR (ou push) sur `main`.
2. Railway détecte le changement → lance un déploiement.
3. Dashboard Railway → service → **Deployments** → attendre le statut **Success**.
4. Vérifier la santé : ouvrir `https://lumeeeeeeeeee-production.up.railway.app/api/health` → doit répondre **200 / ok**.

> Pas de CLI Railway installée localement. Pour déployer = merger sur `main`. Pour
> piloter Railway sans navigateur, installer `npm i -g @railway/cli` + un `RAILWAY_TOKEN`.

---

## 2. Variables d'environnement (Railway → service → Variables)

Source de vérité : `server/lib/env-validation.ts`.

### Requises en production (le serveur **refuse de démarrer** sans) — déjà en place
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (⚠️ jamais en variable `VITE_*`)
- `FRONTEND_URL` (pour le CORS)
- `PII_ENCRYPTION_KEY` **ou** `PAYMENTS_ENCRYPTION_KEY` (32 octets base64)

### Pour activer les paiements (Stripe) — à ajouter
| Variable | Format | Source |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_...` | Stripe → Developers → API keys |
| `STRIPE_PUBLISHABLE_KEY` | `pk_...` | idem |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Stripe → Webhooks (endpoint principal) |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `whsec_...` | Stripe → Webhooks (endpoint Connect) |

### Marge plateforme (optionnel — défaut déjà 2.9 % + 30¢)
- `PLATFORM_FEE_PERCENT` (défaut `2.9`)
- `PLATFORM_FEE_FIXED_CENTS` (défaut `30`)

> Modifier une variable → Railway relance un déploiement (normal).
> Les secrets ne se « devinent » pas : il faut les coller depuis Stripe.

---

## 3. Migrations base de données (Supabase)

Le push GitHub ne lance **pas** les migrations — c'est manuel, dans Supabase.

1. Supabase → ton projet → **SQL Editor** → **New query**.
2. Coller le contenu de `supabase/migrations/2026070*.sql` (ou le fichier regroupé
   `~/Desktop/Lume-Backups/mobile-migrations-ALL.sql`).
3. **Run**. Les migrations mobiles sont **idempotentes** (`IF NOT EXISTS`,
   `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`) → sûres à relancer.
4. Vérifier :
   ```sql
   select table_name from information_schema.tables
   where table_schema='public'
     and table_name in ('job_time_logs','job_materials','push_tokens');
   ```

Migrations mobiles (juin 2026) : `job_time_logs`, `field_daily_stats_trigger`,
`job_materials`, `push_tokens`, `peer_payout_visibility`, `push_sender`.
**Appliquées le 2026-06-29.**

---

## 4. Activer les paiements (Stripe Connect) — manuel, non automatisable

Modèle = plateforme Stripe Connect (chaque compagnie = compte Express ; marge = spread
automatique via `application_fee`). Tant que ce n'est pas connecté : facture « Payments
unavailable » + dépôt de soumission impayable.

1. **Plateforme** (une fois) : Stripe Dashboard → **Connect → Get started**, puis KYC
   plateforme + compte bancaire. Mettre les `STRIPE_*` dans Railway (§2).
2. **Par compagnie** : desktop → **Settings → Payments** (`/settings/payments`) →
   « Connect Stripe » → onboarding hébergé. (Aussi dispo sur mobile : écran
   `payments-setup.tsx`.)
3. Une fois `charges_enabled = true` → paiements actifs partout (factures, dépôts,
   liens envoyés depuis le mobile).

> 2FA + identité Stripe → impossible à automatiser par un robot/navigateur.

---

## 5. App mobile (rappel)

- Branche `mobile-app`. Build Release sur l'iPhone de William (udid
  `00008150-000142942204401C`, bundle `com.wilheb.lumecrm`) :
  `cd mobile && npx expo run:ios --configuration Release --device 00008150-000142942204401C`
- Voir la mémoire `mobile-release-build-workflow` pour les pièges (bundle stale,
  device verrouillé, etc.).

---

## Sauvegardes

- Bundle complet du repo + historique : `~/Desktop/Lume-Backups/lume-FULL-repo-<date>.bundle`
  (restaurable via `git clone <bundle>`).
- Copie navigable : `~/Desktop/Lume-Backups/lume-code-copy-<date>/`.

## Règle importante

**Une seule session Claude Code à la fois sur ce repo** — deux agents en parallèle
s'écrasent les fichiers.
