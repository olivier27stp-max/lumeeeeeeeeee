# API Key Rotation Checklist

All external API keys should be rotated periodically (every 90 days minimum)
or immediately if a breach is suspected.

## Supabase
1. Go to https://supabase.com/dashboard/project/bbzcuzqfgsdvjsymfwmr/settings/api
2. Click "Generate new anon key" → update `VITE_SUPABASE_ANON_KEY` in `.env.local`
3. Click "Generate new service role key" → update `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`
4. Redeploy the app

## Twilio
1. Go to https://console.twilio.com → Account → API keys
2. Create a new Auth Token → update `TWILIO_AUTH_TOKEN` in `.env.local`
3. Revoke the old token after deployment
4. `TWILIO_ACCOUNT_SID` doesn't need rotation (it's not a secret)

## Stripe (Test keys — rotate when moving to production)
1. Go to https://dashboard.stripe.com/apikeys
2. Roll the Secret Key → update `STRIPE_SECRET_KEY` in `.env.local`
3. Roll the Publishable Key → update `STRIPE_PUBLISHABLE_KEY` in `.env.local`
4. Regenerate webhook signing secret → update `STRIPE_WEBHOOK_SECRET`

## Resend
1. Go to https://resend.com/api-keys
2. Create new API key → update `RESEND_API_KEY` in `.env.local`
3. Delete the old key

## Gemini
1. Go to https://aistudio.google.com/apikey
2. Create new API key → update `GEMINI_API_KEY` in `.env.local`
3. Delete the old key

## Google Maps
1. Go to https://console.cloud.google.com/apis/credentials
2. Create new API key → update `VITE_GOOGLE_MAPS_API_KEY` in `.env.local`
3. Restrict the new key to your domains
4. Delete the old key

## Mapbox
1. Go to https://account.mapbox.com/access-tokens
2. Create new token → update `VITE_MAPBOX_TOKEN` in `.env.local`
3. Delete the old token

## After Rotation
- [ ] Update `.env.local` with all new keys
- [ ] Restart the dev server: `npm run api:dev`
- [ ] Verify Stripe webhooks work
- [ ] Verify SMS sending works
- [ ] Verify email sending works
- [ ] Verify AI chat works
- [ ] Deploy to production
- [ ] Delete/revoke all old keys in their respective dashboards
