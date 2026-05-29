/**
 * Triggers a real Stripe event by lightly updating willhebert30's existing subscription.
 * Stripe will then POST customer.subscription.updated to our ngrok webhook URL.
 * Run: npx tsx scripts/test-webhook.ts
 */
import dotenv from 'dotenv';
import Stripe from 'stripe';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY!;
if (!STRIPE_KEY?.startsWith('sk_test_')) process.exit(1);

const stripe = new Stripe(STRIPE_KEY);

async function main() {
  const subId = 'sub_1TcS9x1MfRbVcYlQW0IAgsup'; // willhebert30 Autopilot annual

  console.log(`Triggering customer.subscription.updated on ${subId}...`);

  // Add a benign metadata field — Stripe fires customer.subscription.updated
  await stripe.subscriptions.update(subId, {
    metadata: {
      webhook_test_at: new Date().toISOString(),
    },
  });

  console.log(`✓ Stripe event fired. Check Express logs for webhook receipt.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
