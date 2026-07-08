/**
 * LIVE variant of setup-stripe-webhook.ts.
 *
 * Creates (or updates) the Stripe webhook endpoint pointing at the production
 * Railway URL, subscribing to every event Lume handles. Prints the signing
 * secret to stdout — set it manually as STRIPE_WEBHOOK_SECRET on Railway (this
 * script never writes to .env.local).
 *
 * SAFETY: requires a LIVE key (sk_live_) AND --confirm-live.
 *
 * Run: railway run npx tsx scripts/setup-stripe-webhook-live.ts --confirm-live [https://custom-url]
 */
import dotenv from 'dotenv';
import Stripe from 'stripe';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY!;
const CONFIRM = process.argv.includes('--confirm-live');

if (!STRIPE_KEY?.startsWith('sk_live_')) {
  console.error('This is the LIVE webhook script. Refusing to run without a sk_live_ key.');
  console.error('For test mode use scripts/setup-stripe-webhook.ts <ngrok-url>.');
  process.exit(1);
}
if (!CONFIRM) {
  console.error('Refusing to modify LIVE webhooks without --confirm-live.');
  process.exit(1);
}

const DEFAULT_BASE = 'https://lumeeeeeeeeee-production.up.railway.app';
const base = process.argv.find((a) => a.startsWith('http')) || process.env.PUBLIC_URL || DEFAULT_BASE;
const url = `${base.replace(/\/$/, '')}/api/webhooks/stripe`;

const stripe = new Stripe(STRIPE_KEY);

const ENABLED_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.finalized',
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'account.updated',
  'account.application.authorized',
  'account.application.deauthorized',
];

async function main() {
  console.log(`\n--- Setting up Stripe webhook — LIVE ---\n`);
  console.log(`URL: ${url}`);
  console.log(`Mode: LIVE (${STRIPE_KEY.slice(0, 12)}...)\n`);

  const existingList = await stripe.webhookEndpoints.list({ limit: 100 });
  const existing = existingList.data.find((w) => w.url === url);

  let secret: string;

  if (existing) {
    console.log(`✓ Found existing webhook ${existing.id}`);
    await stripe.webhookEndpoints.update(existing.id, {
      enabled_events: ENABLED_EVENTS,
      description: 'Lume CRM — production',
    });
    console.log(`✓ Updated enabled_events (${ENABLED_EVENTS.length} events)`);
    secret = existing.secret || '';
    if (!secret) {
      console.log('⚠ Secret not returned on update — recreating endpoint to fetch it');
      await stripe.webhookEndpoints.del(existing.id);
      const fresh = await stripe.webhookEndpoints.create({ url, enabled_events: ENABLED_EVENTS, description: 'Lume CRM — production' });
      secret = fresh.secret!;
      console.log(`✓ Recreated webhook ${fresh.id}`);
    }
  } else {
    const created = await stripe.webhookEndpoints.create({ url, enabled_events: ENABLED_EVENTS, description: 'Lume CRM — production' });
    console.log(`✓ Created webhook ${created.id}`);
    secret = created.secret!;
  }

  if (!secret) { console.error('Failed to retrieve webhook signing secret.'); process.exit(1); }

  console.log(`\n============================================================`);
  console.log(`Set this on Railway (do NOT commit it):`);
  console.log(`  STRIPE_WEBHOOK_SECRET=${secret}`);
  console.log(`============================================================`);
  console.log(`\n✅ Done. After setting the var on Railway, redeploy so the server loads it.`);
  console.log(`   URL: ${url}   Events: ${ENABLED_EVENTS.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
