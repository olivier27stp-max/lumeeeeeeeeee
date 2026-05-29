/**
 * Creates (or updates) a Stripe webhook endpoint pointing to the local ngrok tunnel.
 * Run: npx tsx scripts/setup-stripe-webhook.ts <ngrok-url>
 *
 * Subscribes to all events relevant to Lume:
 *   - customer.subscription.* (sub lifecycle)
 *   - invoice.* (renewals + failed payments)
 *   - checkout.session.completed (initial activation)
 *   - account.updated (Connect onboarding state changes)
 *   - payment_intent.* (Destination charges)
 *
 * Writes the new webhook signing secret to .env.local
 */
import dotenv from 'dotenv';
import Stripe from 'stripe';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY!;
if (!STRIPE_KEY?.startsWith('sk_test_')) {
  console.error('Refusing to run on a live Stripe key. Use sk_test_ only.');
  process.exit(1);
}

const ngrokBase = process.argv[2];
if (!ngrokBase) {
  console.error('Usage: npx tsx scripts/setup-stripe-webhook.ts <ngrok-url>');
  process.exit(1);
}
const url = `${ngrokBase.replace(/\/$/, '')}/api/webhooks/stripe`;

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
  console.log(`\n--- Setting up Stripe webhook ---\n`);
  console.log(`URL: ${url}`);
  console.log(`Mode: TEST (${STRIPE_KEY.slice(0, 12)}...)\n`);

  // Find any existing webhook with the same URL to avoid duplicates
  const existingList = await stripe.webhookEndpoints.list({ limit: 100 });
  const existing = existingList.data.find((w) => w.url === url);

  let secret: string;

  if (existing) {
    console.log(`✓ Found existing webhook ${existing.id}`);
    await stripe.webhookEndpoints.update(existing.id, {
      enabled_events: ENABLED_EVENTS,
      description: 'Lume CRM — dev ngrok tunnel',
    });
    console.log(`✓ Updated enabled_events (${ENABLED_EVENTS.length} events)`);
    secret = existing.secret || '';
    if (!secret) {
      console.log('⚠ Secret not returned on update — re-creating endpoint to fetch it');
      await stripe.webhookEndpoints.del(existing.id);
      const fresh = await stripe.webhookEndpoints.create({
        url,
        enabled_events: ENABLED_EVENTS,
        description: 'Lume CRM — dev ngrok tunnel',
      });
      secret = fresh.secret!;
      console.log(`✓ Recreated webhook ${fresh.id}`);
    }
  } else {
    const created = await stripe.webhookEndpoints.create({
      url,
      enabled_events: ENABLED_EVENTS,
      description: 'Lume CRM — dev ngrok tunnel',
    });
    console.log(`✓ Created webhook ${created.id}`);
    secret = created.secret!;
  }

  if (!secret) {
    console.error('Failed to retrieve webhook signing secret.');
    process.exit(1);
  }

  // Patch .env.local with the new STRIPE_WEBHOOK_SECRET
  const envPath = path.resolve(process.cwd(), '.env.local');
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const line = `STRIPE_WEBHOOK_SECRET=${secret}`;
  if (envContent.includes('STRIPE_WEBHOOK_SECRET=')) {
    envContent = envContent.replace(/STRIPE_WEBHOOK_SECRET=.*/m, line);
  } else {
    envContent = envContent.trimEnd() + '\n' + line + '\n';
  }
  fs.writeFileSync(envPath, envContent);
  console.log(`✓ Wrote STRIPE_WEBHOOK_SECRET to .env.local`);

  console.log(`\n✅ Done. Restart your Express server to load the new secret.`);
  console.log(`   URL: ${url}`);
  console.log(`   Events: ${ENABLED_EVENTS.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
