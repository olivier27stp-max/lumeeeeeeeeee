/**
 * Creates (or finds) one Stripe Product per Lume plan + 4 recurring Prices each
 * (monthly USD, monthly CAD, yearly USD, yearly CAD) and saves all IDs back to plans table.
 *
 * Idempotent: re-running won't create duplicates — it finds existing products by metadata.plan_id
 * and existing prices by exact (currency, interval, unit_amount, product).
 *
 * Run: npx tsx scripts/sync-stripe-products.ts
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !STRIPE_KEY) {
  console.error('Missing env vars');
  process.exit(1);
}

if (!STRIPE_KEY.startsWith('sk_test_')) {
  console.error('Refusing to run on live key.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const stripe = new Stripe(STRIPE_KEY);

interface PlanRow {
  id: string;
  slug: string;
  name: string;
  monthly_price_usd: number;
  monthly_price_cad: number;
  yearly_price_usd: number;
  yearly_price_cad: number;
  stripe_product_id: string | null;
  stripe_monthly_price_id_usd: string | null;
  stripe_monthly_price_id_cad: string | null;
  stripe_yearly_price_id_usd: string | null;
  stripe_yearly_price_id_cad: string | null;
}

async function findOrCreateProduct(plan: PlanRow): Promise<string> {
  // 1. Try the existing id in DB
  if (plan.stripe_product_id) {
    try {
      const existing = await stripe.products.retrieve(plan.stripe_product_id);
      if (existing.active) return existing.id;
    } catch { /* fall through to lookup */ }
  }

  // 2. Search by metadata.plan_id (idempotent across reruns)
  const search = await stripe.products.search({
    query: `metadata['plan_id']:'${plan.id}'`,
    limit: 1,
  });
  if (search.data.length > 0) return search.data[0].id;

  // 3. Create
  const product = await stripe.products.create({
    name: `Lume ${plan.name}`,
    description: `Lume CRM ${plan.name} subscription`,
    metadata: { plan_id: plan.id, plan_slug: plan.slug },
  });
  console.log(`  ✓ Created product ${product.id} for ${plan.name}`);
  return product.id;
}

async function findOrCreatePrice(
  productId: string,
  currency: 'usd' | 'cad',
  interval: 'month' | 'year',
  unitAmount: number,
  planId: string,
): Promise<string> {
  // Search for an existing matching price
  const list = await stripe.prices.list({
    product: productId,
    active: true,
    limit: 100,
  });
  const match = list.data.find(
    (p) =>
      p.currency === currency &&
      p.unit_amount === unitAmount &&
      p.recurring?.interval === interval &&
      p.active,
  );
  if (match) return match.id;

  // Create
  const price = await stripe.prices.create({
    product: productId,
    currency,
    unit_amount: unitAmount,
    recurring: { interval },
    metadata: { plan_id: planId },
  });
  console.log(`  ✓ Created price ${price.id} (${currency.toUpperCase()} ${interval} ${unitAmount}¢)`);
  return price.id;
}

async function main() {
  console.log('\n--- Syncing Stripe Products + Prices with Lume plans ---\n');

  const { data: plans, error } = await supabase
    .from('plans')
    .select('id, slug, name, monthly_price_usd, monthly_price_cad, yearly_price_usd, yearly_price_cad, stripe_product_id, stripe_monthly_price_id_usd, stripe_monthly_price_id_cad, stripe_yearly_price_id_usd, stripe_yearly_price_id_cad')
    .eq('is_active', true)
    .order('sort_order');

  if (error || !plans) {
    console.error('Failed to load plans:', error?.message);
    process.exit(1);
  }

  for (const plan of plans as PlanRow[]) {
    console.log(`→ ${plan.name} (${plan.slug})`);
    const productId = await findOrCreateProduct(plan);

    const monthlyUsd = await findOrCreatePrice(productId, 'usd', 'month', plan.monthly_price_usd, plan.id);
    const monthlyCad = await findOrCreatePrice(productId, 'cad', 'month', plan.monthly_price_cad, plan.id);
    const yearlyUsd = await findOrCreatePrice(productId, 'usd', 'year', plan.yearly_price_usd, plan.id);
    const yearlyCad = await findOrCreatePrice(productId, 'cad', 'year', plan.yearly_price_cad, plan.id);

    const { error: updErr } = await supabase
      .from('plans')
      .update({
        stripe_product_id: productId,
        stripe_monthly_price_id_usd: monthlyUsd,
        stripe_monthly_price_id_cad: monthlyCad,
        stripe_yearly_price_id_usd: yearlyUsd,
        stripe_yearly_price_id_cad: yearlyCad,
      })
      .eq('id', plan.id);

    if (updErr) console.error(`  ✗ DB update failed:`, updErr.message);
    else console.log(`  ✓ DB updated`);
    console.log('');
  }

  console.log('✅ All plans synced. Stripe Products are now the source of truth.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
