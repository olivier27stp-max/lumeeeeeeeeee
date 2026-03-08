# Payments Setup (Stripe + PayPal)

## 1) Environment Variables
Set these on the API server (`server/index.ts` reads them):

```bash
# Supabase
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PAYMENTS_ENCRYPTION_KEY=

# Stripe
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# PayPal
PAYPAL_CLIENT_ID=
PAYPAL_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_ENV=sandbox

# Optional
API_PORT=3001
PUBLIC_BASE_URL=http://localhost:3000
```

## 2) SQL Migration
Run this migration in Supabase SQL editor:

- `supabase/migrations/20260304180000_payments_real_module.sql`
- `supabase/migrations/20260304203000_payment_settings_secure.sql`

This creates/updates:
- `payment_providers`
- `payments`
- `payment_provider_settings`
- `payment_provider_secrets`
- RLS policies
- idempotency unique indexes
- invoice recalculation trigger/function
- `rpc_payments_overview_kpis`
- `rpc_list_payments`

## 3) Stripe Webhook
In Stripe Dashboard:
1. Add endpoint: `https://<your-domain>/api/webhooks/stripe`
2. Subscribe to event: `payment_intent.succeeded`
3. Copy signing secret into `STRIPE_WEBHOOK_SECRET`

## 4) PayPal Webhook
In PayPal Developer Dashboard:
1. Add webhook URL: `https://<your-domain>/api/webhooks/paypal`
2. Subscribe to event: `PAYMENT.CAPTURE.COMPLETED`
3. Copy webhook id into `PAYPAL_WEBHOOK_ID`

## 5) App Usage
1. Open `/payments/settings`
2. Enable Stripe and/or PayPal
3. Set default provider (optional)
4. Open an invoice with balance > 0
5. Click `Pay now`

## 6) Test Sandbox Flow
### Stripe
1. Enable Stripe in `/payments/settings`
2. In invoice details click `Pay now`
3. Use Stripe test card `4242 4242 4242 4242`
4. Confirm payment appears in `/payments` and invoice balance updates

### PayPal
1. Enable PayPal in `/payments/settings`
2. In invoice details choose PayPal
3. Complete sandbox payment
4. Confirm payment appears in `/payments` and invoice balance updates

## 7) Idempotency
- Stripe/PayPal webhook inserts are protected by unique indexes:
  - `(provider, provider_payment_id)`
  - `(provider, provider_event_id)`
- Duplicate webhook events do not create duplicate rows.
