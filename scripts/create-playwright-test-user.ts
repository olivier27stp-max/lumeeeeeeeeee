/**
 * Creates (or resets) a Playwright test user with a known password
 * and adds them as owner to a freshly-created test org.
 * Run: npx tsx scripts/create-playwright-test-user.ts
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const EMAIL = 'playwright-test@lume.local';
const PASSWORD = 'PlaywrightTest123!';

async function main() {
  console.log(`\n--- Setting up Playwright test user ${EMAIL} ---\n`);

  // 1. Find or create user
  const { data: existing } = await supabase.auth.admin.listUsers({ perPage: 200 });
  let user = existing.users.find((u: any) => u.email?.toLowerCase() === EMAIL);

  if (user) {
    // Update password to known value
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) { console.error('Update failed:', error.message); process.exit(1); }
    console.log(`✓ Reset password for existing user ${user.id}`);
  } else {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) { console.error('Create failed:', error.message); process.exit(1); }
    user = created.user!;
    console.log(`✓ Created user ${user.id}`);
  }

  // 2. Ensure profile exists
  await supabase.from('profiles').upsert({
    id: user.id,
    full_name: 'Playwright Test',
  });
  console.log(`✓ Profile ok`);

  // 3. Ensure org + membership
  const { data: existingMem } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .maybeSingle();

  let orgId = existingMem?.org_id;
  if (!orgId) {
    const { data: org, error: orgErr } = await supabase
      .from('orgs')
      .insert({ name: 'Playwright Test Org', created_by: user.id })
      .select('id')
      .single();
    if (orgErr) { console.error('Org create failed:', orgErr.message); process.exit(1); }
    orgId = org!.id;

    await supabase.from('memberships').insert({
      user_id: user.id,
      org_id: orgId,
      role: 'owner',
      status: 'active',
    });
    console.log(`✓ Created org ${orgId} + membership owner`);
  } else {
    console.log(`✓ Reused org ${orgId}`);
  }

  // 4. Ensure an active subscription (Minimum by default — we'll switch via SQL during tests)
  const { data: minPlan } = await supabase
    .from('plans')
    .select('id, monthly_price_usd')
    .eq('slug', 'starter')
    .maybeSingle();

  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('org_id', orgId)
    .in('status', ['active', 'trialing'])
    .maybeSingle();

  if (!existingSub) {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await supabase.from('subscriptions').insert({
      org_id: orgId,
      user_id: user.id,
      plan_id: minPlan!.id,
      status: 'active',
      interval: 'monthly',
      currency: 'CAD',
      amount_cents: minPlan!.monthly_price_usd,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
    });
    console.log(`✓ Created subscription on Minimum`);
  } else {
    console.log(`✓ Reused existing subscription`);
  }

  console.log(`\n✅ Ready. Login with:\n   email: ${EMAIL}\n   pass:  ${PASSWORD}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
