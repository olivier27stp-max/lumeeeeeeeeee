/**
 * LIVE variant of sync-stripe-products.ts.
 *
 * Creates (or finds) one Stripe Product per plan + 4 recurring Prices each
 * (monthly/yearly × USD/CAD) from the FULL-price columns, plus an intro Coupon
 * per interval×currency (from intro_price_* columns), and writes all IDs back to
 * the plans table. Idempotent.
 *
 * SAFETY:
 *   - Requires a LIVE key (sk_live_) AND an explicit --confirm-live flag.
 *   - Without --confirm-live it runs a DRY RUN: it reads Stripe + the DB and
 *     prints exactly what it would create/overwrite, writing NOTHING.
 *   - Before any write it dumps the current plans Stripe-ID columns (backup).
 *
 * Run (dry run):   railway run npx tsx scripts/sync-stripe-products-live.ts
 * Run (for real):  railway run npx tsx scripts/sync-stripe-products-live.ts --confirm-live
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY!;
const CONFIRM = process.argv.includes('--confirm-live');
const DRY = !CONFIRM;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !STRIPE_KEY) {
  console.error('Missing env vars (VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY).');
  process.exit(1);
}
if (!STRIPE_KEY.startsWith('sk_live_')) {
  console.error('This is the LIVE sync script. Refusing to run without a sk_live_ key.');
  console.error('For test mode use scripts/sync-stripe-products.ts.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const stripe = new Stripe(STRIPE_KEY);

type Cur = 'usd' | 'cad';
type Iv = 'month' | 'year';

interface PlanRow {
  id: string; slug: string; name: string;
  monthly_price_usd: number; monthly_price_cad: number;
  yearly_price_usd: number; yearly_price_cad: number;
  intro_months: number | null;
  intro_price_monthly_usd: number | null; intro_price_monthly_cad: number | null;
  intro_price_yearly_usd: number | null; intro_price_yearly_cad: number | null;
  stripe_product_id: string | null;
  stripe_monthly_price_id_usd: string | null; stripe_monthly_price_id_cad: string | null;
  stripe_yearly_price_id_usd: string | null; stripe_yearly_price_id_cad: string | null;
  stripe_intro_coupon_id_monthly_usd: string | null; stripe_intro_coupon_id_monthly_cad: string | null;
  stripe_intro_coupon_id_yearly_usd: string | null; stripe_intro_coupon_id_yearly_cad: string | null;
}

const tag = DRY ? '[dry-run] would' : '  ✓';

async function findOrCreateProduct(plan: PlanRow): Promise<string> {
  if (plan.stripe_product_id) {
    try { const p = await stripe.products.retrieve(plan.stripe_product_id); if (p.active) return p.id; } catch { /* recreate */ }
  }
  const search = await stripe.products.search({ query: `metadata['plan_id']:'${plan.id}'`, limit: 1 });
  if (search.data.length > 0) return search.data[0].id;
  if (DRY) { console.log(`  ${tag} CREATE product "Lume ${plan.name}"`); return `(new-product:${plan.slug})`; }
  const product = await stripe.products.create({
    name: `Lume ${plan.name}`,
    description: `Lume CRM ${plan.name} subscription`,
    metadata: { plan_id: plan.id, plan_slug: plan.slug },
  });
  console.log(`  ✓ Created product ${product.id}`);
  return product.id;
}

async function findOrCreatePrice(productId: string, currency: Cur, interval: Iv, unitAmount: number, planId: string): Promise<string> {
  if (!productId.startsWith('prod_')) { // dry-run placeholder product
    console.log(`  ${tag} CREATE price ${currency.toUpperCase()} ${interval} ${(unitAmount / 100).toFixed(2)}`);
    return `(new-price:${currency}-${interval})`;
  }
  const list = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const match = list.data.find((p) => p.currency === currency && p.unit_amount === unitAmount && p.recurring?.interval === interval && p.active);
  if (match) return match.id;
  if (DRY) { console.log(`  ${tag} CREATE price ${currency.toUpperCase()} ${interval} ${(unitAmount / 100).toFixed(2)}`); return `(new-price:${currency}-${interval})`; }
  const price = await stripe.prices.create({ product: productId, currency, unit_amount: unitAmount, recurring: { interval }, metadata: { plan_id: planId } });
  console.log(`  ✓ Created price ${price.id} (${currency.toUpperCase()} ${interval} ${unitAmount}¢)`);
  return price.id;
}

async function findOrCreateCoupon(plan: PlanRow, currency: Cur, interval: 'monthly' | 'yearly', fullCents: number, introCents: number, existingId: string | null): Promise<string> {
  const amountOff = fullCents - introCents;
  const months = plan.intro_months || 3;
  if (existingId) {
    try { const c = await stripe.coupons.retrieve(existingId); if (c.valid) return c.id; } catch { /* recreate */ }
  }
  const list = await stripe.coupons.list({ limit: 100 });
  const match = list.data.find((c) =>
    c.metadata?.plan_id === plan.id && c.metadata?.interval === interval &&
    c.metadata?.currency === currency && c.amount_off === amountOff && c.currency === currency && c.valid);
  if (match) return match.id;
  const durationDesc = interval === 'yearly' ? 'once' : `${months}mo`;
  if (DRY) { console.log(`  ${tag} CREATE coupon ${currency.toUpperCase()} ${interval} −${(amountOff / 100).toFixed(2)} (${durationDesc})`); return `(new-coupon:${currency}-${interval})`; }
  const params: Stripe.CouponCreateParams = {
    name: `Lume ${plan.name} intro`, currency, amount_off: amountOff,
    metadata: { plan_id: plan.id, interval, currency },
    ...(interval === 'yearly' ? { duration: 'once' } : { duration: 'repeating', duration_in_months: months }),
  };
  const coupon = await stripe.coupons.create(params);
  console.log(`  ✓ Created coupon ${coupon.id} (${currency.toUpperCase()} ${interval} −${amountOff}¢ ${durationDesc})`);
  return coupon.id;
}

async function main() {
  console.log(`\n=== SYNC STRIPE PRODUCTS + PRICES + COUPONS — LIVE (${STRIPE_KEY.slice(0, 12)}...) ===`);
  console.log(DRY ? '\n🟡 DRY RUN — no writes. Re-run with --confirm-live to apply.\n' : '\n🔴 LIVE MODE — creating real Stripe objects and updating the DB.\n');

  const { data: plans, error } = await supabase
    .from('plans')
    .select('id, slug, name, monthly_price_usd, monthly_price_cad, yearly_price_usd, yearly_price_cad, intro_months, intro_price_monthly_usd, intro_price_monthly_cad, intro_price_yearly_usd, intro_price_yearly_cad, stripe_product_id, stripe_monthly_price_id_usd, stripe_monthly_price_id_cad, stripe_yearly_price_id_usd, stripe_yearly_price_id_cad, stripe_intro_coupon_id_monthly_usd, stripe_intro_coupon_id_monthly_cad, stripe_intro_coupon_id_yearly_usd, stripe_intro_coupon_id_yearly_cad')
    .eq('is_active', true)
    .order('sort_order');

  if (error || !plans) { console.error('Failed to load plans:', error?.message); process.exit(1); }

  // ── Backup: dump current Stripe-ID columns before touching anything ──
  console.log('--- BACKUP: current plans Stripe IDs (save this) ---');
  for (const p of plans as PlanRow[]) {
    console.log(JSON.stringify({
      slug: p.slug, stripe_product_id: p.stripe_product_id,
      stripe_monthly_price_id_usd: p.stripe_monthly_price_id_usd, stripe_monthly_price_id_cad: p.stripe_monthly_price_id_cad,
      stripe_yearly_price_id_usd: p.stripe_yearly_price_id_usd, stripe_yearly_price_id_cad: p.stripe_yearly_price_id_cad,
    }));
  }
  console.log('----------------------------------------------------\n');

  for (const plan of plans as PlanRow[]) {
    console.log(`→ ${plan.name} (${plan.slug})  full monthly CAD ${(plan.monthly_price_cad / 100).toFixed(2)}  intro months=${plan.intro_months ?? '—'}`);
    const productId = await findOrCreateProduct(plan);

    const mUsd = await findOrCreatePrice(productId, 'usd', 'month', plan.monthly_price_usd, plan.id);
    const mCad = await findOrCreatePrice(productId, 'cad', 'month', plan.monthly_price_cad, plan.id);
    const yUsd = await findOrCreatePrice(productId, 'usd', 'year', plan.yearly_price_usd, plan.id);
    const yCad = await findOrCreatePrice(productId, 'cad', 'year', plan.yearly_price_cad, plan.id);

    // Coupons only where an intro price is configured for that interval×currency.
    const update: Record<string, any> = {
      stripe_product_id: productId,
      stripe_monthly_price_id_usd: mUsd, stripe_monthly_price_id_cad: mCad,
      stripe_yearly_price_id_usd: yUsd, stripe_yearly_price_id_cad: yCad,
    };
    const couponJobs: Array<[Cur, 'monthly' | 'yearly', number, number | null, string | null, string]> = [
      ['usd', 'monthly', plan.monthly_price_usd, plan.intro_price_monthly_usd, plan.stripe_intro_coupon_id_monthly_usd, 'stripe_intro_coupon_id_monthly_usd'],
      ['cad', 'monthly', plan.monthly_price_cad, plan.intro_price_monthly_cad, plan.stripe_intro_coupon_id_monthly_cad, 'stripe_intro_coupon_id_monthly_cad'],
      ['usd', 'yearly', plan.yearly_price_usd, plan.intro_price_yearly_usd, plan.stripe_intro_coupon_id_yearly_usd, 'stripe_intro_coupon_id_yearly_usd'],
      ['cad', 'yearly', plan.yearly_price_cad, plan.intro_price_yearly_cad, plan.stripe_intro_coupon_id_yearly_cad, 'stripe_intro_coupon_id_yearly_cad'],
    ];
    for (const [cur, iv, fullCents, introCents, existing, col] of couponJobs) {
      if (introCents != null && introCents < fullCents) {
        update[col] = await findOrCreateCoupon(plan, cur, iv, fullCents, introCents, existing);
      }
    }

    if (DRY) {
      console.log(`  ${tag} UPDATE plans row with the IDs above`);
    } else {
      const { error: updErr } = await supabase.from('plans').update(update).eq('id', plan.id);
      if (updErr) console.error(`  ✗ DB update failed:`, updErr.message);
      else console.log(`  ✓ DB updated`);
    }
    console.log('');
  }

  console.log(DRY
    ? '🟡 DRY RUN complete. Review the plan above, then re-run with --confirm-live.\n'
    : '✅ LIVE sync complete. Stripe products/prices/coupons are now the source of truth.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
