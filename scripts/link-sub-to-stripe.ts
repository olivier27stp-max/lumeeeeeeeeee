/**
 * One-shot script: Link an existing DB subscription to a real Stripe customer + subscription.
 *
 * Used for fixing legacy/manually-created subscriptions so the user can:
 *   - Open the Stripe Customer Portal
 *   - Use the change-plan endpoint with real proration
 *
 * Uses a test card token (only works with sk_test_ keys).
 *
 * Run with:
 *   npx tsx scripts/link-sub-to-stripe.ts <email>
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !STRIPE_KEY) {
  console.error('Missing env vars: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / STRIPE_SECRET_KEY');
  process.exit(1);
}

if (!STRIPE_KEY.startsWith('sk_test_')) {
  console.error('Refusing to run on a live Stripe key. Use sk_test_ only.');
  process.exit(1);
}

const email = process.argv[2];
if (!email) {
  console.error('Usage: npx tsx scripts/link-sub-to-stripe.ts <email>');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const stripe = new Stripe(STRIPE_KEY);

async function main() {
  console.log(`\n--- Linking sub for ${email} to Stripe ---\n`);

  // 1. Find user → org → sub
  const { data: userList } = await supabase.auth.admin.listUsers({ perPage: 200 });
  const user = userList.users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }
  console.log(`✓ User: ${user.id}`);

  const { data: mem } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!mem) {
    console.error('No membership found');
    process.exit(1);
  }
  console.log(`✓ Org: ${mem.org_id}`);

  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .select('id, plan_id, interval, currency, status, stripe_customer_id, stripe_subscription_id')
    .eq('org_id', mem.org_id)
    .eq('status', 'active')
    .maybeSingle();
  if (subErr) {
    console.error('Sub query error:', subErr.message);
    process.exit(1);
  }
  if (!sub) {
    console.error('No active subscription found');
    process.exit(1);
  }

  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .select('slug, name, monthly_price_usd, monthly_price_cad, yearly_price_usd, yearly_price_cad')
    .eq('id', sub.plan_id)
    .maybeSingle();
  if (planErr || !plan) {
    console.error('Plan query error:', planErr?.message || 'not found');
    process.exit(1);
  }
  console.log(`✓ Sub: ${sub.id} — ${plan.name} ${sub.interval}`);

  if (sub.stripe_customer_id && sub.stripe_subscription_id) {
    console.log('Already linked to Stripe. Nothing to do.');
    return;
  }

  // 2. Create or reuse Stripe customer
  let customerId = sub.stripe_customer_id;
  if (!customerId) {
    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data.length > 0) {
      customerId = existing.data[0].id;
      console.log(`✓ Reused Stripe customer: ${customerId}`);
    } else {
      const customer = await stripe.customers.create({
        email,
        name: user.user_metadata?.full_name || email,
        metadata: { org_id: mem.org_id, user_id: user.id, source: 'link-sub-to-stripe-script' },
      });
      customerId = customer.id;
      console.log(`✓ Created Stripe customer: ${customerId}`);
    }
  }

  // 3. Attach a test payment method (4242 always succeeds in test mode)
  const pm = await stripe.paymentMethods.create({
    type: 'card',
    card: { token: 'tok_visa' },
  });
  await stripe.paymentMethods.attach(pm.id, { customer: customerId });
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: pm.id },
  });
  console.log(`✓ Attached test card pm_${pm.id.slice(3, 10)}…`);

  // 4. Create Stripe subscription matching plan + interval
  const currency = (sub.currency || 'CAD').toUpperCase();
  const priceField = sub.interval === 'yearly'
    ? (currency === 'USD' ? 'yearly_price_usd' : 'yearly_price_cad')
    : (currency === 'USD' ? 'monthly_price_usd' : 'monthly_price_cad');
  const amountCents = plan[priceField] || 0;

  // Stripe subscriptions.create requires a real Price (not inline price_data).
  // Create the Product + Price first, then attach.
  const product = await stripe.products.create({
    name: `Lume ${plan.name}`,
    metadata: { plan_slug: plan.slug, plan_id: sub.plan_id },
  });
  const price = await stripe.prices.create({
    product: product.id,
    currency: currency.toLowerCase(),
    unit_amount: amountCents,
    recurring: { interval: sub.interval === 'yearly' ? 'year' : 'month' },
  });
  console.log(`✓ Created Stripe product + price: ${price.id}`);

  const stripeSub = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: price.id }],
    metadata: { org_id: mem.org_id, plan_slug: plan.slug, plan_id: sub.plan_id, source: 'link-sub-to-stripe-script' },
  });
  console.log(`✓ Created Stripe sub: ${stripeSub.id}`);

  // 5. Update DB
  const { error } = await supabase
    .from('subscriptions')
    .update({
      stripe_customer_id: customerId,
      stripe_subscription_id: stripeSub.id,
    })
    .eq('id', sub.id);
  if (error) {
    console.error('Failed to update DB:', error.message);
    process.exit(1);
  }
  console.log(`✓ DB sub updated with stripe_customer_id + stripe_subscription_id\n`);

  console.log(`Done. You can now:`);
  console.log(`  - Click "Manage billing" → opens Stripe Customer Portal`);
  console.log(`  - Click upgrade/downgrade → real Stripe subscription update with proration\n`);
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
