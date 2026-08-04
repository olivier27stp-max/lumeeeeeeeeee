// ============================================================
// Referral rewards — shared logic for the referral program.
//
// Program (see project_referral_program):
//  - Referrer (code owner): earns 1 free month per referred org that subscribes
//    to a paid plan. Delivered as a Stripe customer balance credit (Jobber-style)
//    on their next invoice — NOT a DB-only period extension, so Stripe stays the
//    source of truth and never re-charges a "free" month.
//  - Friend (code user): gets their first month free, applied as a one-time
//    Stripe coupon on the Checkout Session (handled in the checkout route).
//
// Eligibility: only paid-plan orgs can generate a code (enforced in
// routes/referrals.ts), so the referrer always has a live Stripe customer + sub.
// ============================================================

import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

/** One free month, in cents, resolved from the referrer's own active plan + currency. */
const FALLBACK_REWARD_CENTS = 2900; // Pro monthly USD — used only if the plan lookup fails.

export interface ReferralLookup {
  id: string;
  referrer_user_id: string;
  referrer_org_id: string;
  code: string;
}

/**
 * Look up a referral code's owner (the template row, referred_email='').
 * Returns null if the code doesn't exist. Does NOT check self-referral — the
 * caller compares referrer_org_id against the buyer's org.
 */
export async function lookupReferralCode(
  admin: SupabaseClient,
  code: string,
): Promise<ReferralLookup | null> {
  const normalized = (code || '').trim();
  if (!normalized) return null;

  const { data } = await admin
    .from('referrals')
    .select('id, referrer_user_id, referrer_org_id, code')
    .eq('code', normalized)
    .limit(1)
    .maybeSingle();

  return (data as ReferralLookup) || null;
}

/**
 * Resolve the referrer's monthly price (cents) for the free-month credit,
 * based on their current active subscription's plan + currency. Falls back to a
 * sane default if anything is missing.
 */
async function resolveRewardCents(
  admin: SupabaseClient,
  referrerOrgId: string,
): Promise<{ cents: number; currency: string }> {
  const { data: sub } = await admin
    .from('subscriptions')
    .select('plan_id, currency')
    .eq('org_id', referrerOrgId)
    .in('status', ['active', 'trialing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const currency = (sub?.currency || 'CAD').toUpperCase();

  let cents = FALLBACK_REWARD_CENTS;
  if (sub?.plan_id) {
    const { data: plan } = await admin
      .from('plans')
      .select('monthly_price_usd, monthly_price_cad')
      .eq('id', sub.plan_id)
      .maybeSingle();
    const price = currency === 'USD' ? plan?.monthly_price_usd : plan?.monthly_price_cad;
    if (price && price > 0) cents = price;
  }

  return { cents, currency };
}

/**
 * Guarantee the org has a usable Stripe customer id, creating one if needed.
 *
 * Only the Stripe checkout webhook ever writes `subscriptions.stripe_customer_id`,
 * so orgs provisioned any other way (legacy rows, dev-switch-plan, seeded/test
 * orgs) have none — and a referrer without a customer cannot be credited. Rather
 * than let the reward silently fail, we look in both tables and, as a last
 * resort, create the customer on Stripe and persist it to both places so every
 * future credit, invoice and portal call finds it.
 *
 * Returns null only when Stripe is unconfigured or the create call fails.
 */
export async function ensureStripeCustomerForOrg(
  admin: SupabaseClient,
  stripe: Stripe | null,
  orgId: string,
  opts: { currency?: string } = {},
): Promise<string | null> {
  // 1. Already on the subscription?
  const { data: sub } = await admin
    .from('subscriptions')
    .select('id, stripe_customer_id')
    .eq('org_id', orgId)
    .in('status', ['active', 'trialing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sub?.stripe_customer_id) return sub.stripe_customer_id;

  // 2. Or on the billing profile? Backfill the subscription row while we're here.
  const { data: profile } = await admin
    .from('billing_profiles')
    .select('stripe_customer_id, billing_email, company_name')
    .eq('org_id', orgId)
    .maybeSingle();
  if (profile?.stripe_customer_id) {
    if (sub?.id) {
      await admin
        .from('subscriptions')
        .update({ stripe_customer_id: profile.stripe_customer_id })
        .eq('id', sub.id);
    }
    return profile.stripe_customer_id;
  }

  // 3. Nowhere yet — create it on Stripe so this org is creditable from now on.
  if (!stripe) {
    console.warn('[referral-rewards] Stripe not configured — cannot create customer for org', orgId);
    return null;
  }

  const { data: org } = await admin
    .from('orgs')
    .select('name, email')
    .eq('id', orgId)
    .maybeSingle();

  const email = profile?.billing_email || org?.email || undefined;
  const name = profile?.company_name || org?.name || undefined;

  try {
    const customer = await stripe.customers.create({
      email,
      name,
      metadata: { org_id: orgId, created_by: 'referral_reward_backfill' },
    });

    // Persist to both tables so nothing has to re-create it later.
    await admin
      .from('billing_profiles')
      .upsert(
        {
          org_id: orgId,
          stripe_customer_id: customer.id,
          billing_email: email,
          company_name: name,
          currency: (opts.currency || 'CAD').toUpperCase(),
        },
        { onConflict: 'org_id' },
      );
    if (sub?.id) {
      await admin.from('subscriptions').update({ stripe_customer_id: customer.id }).eq('id', sub.id);
    }

    console.log(`[referral-rewards] Created Stripe customer ${customer.id} for org ${orgId}`);
    return customer.id;
  } catch (err: any) {
    console.error('[referral-rewards] Stripe customer create failed for org', orgId, err?.message);
    return null;
  }
}

export interface AwardReferrerRewardArgs {
  admin: SupabaseClient;
  stripe: Stripe | null;
  referralCode: string;
  /** The org that just subscribed using the code (the friend). */
  referredOrgId: string;
  referredUserId: string;
  referredEmail: string;
  now?: Date;
}

export interface AwardResult {
  /** True only when the Stripe credit actually landed. */
  awarded: boolean;
  reason?: 'code_not_found' | 'self_referral' | 'already_rewarded' | 'credit_failed';
  /** Conversion was recorded but the credit didn't apply — needs manual follow-up. */
  pending?: boolean;
}

/**
 * Award the referrer their free-month reward for a converted referral.
 *
 * Idempotent per (code, referred org): a second call for the same referred org
 * is a no-op. Credits the referrer's Stripe customer balance by one month, then
 * records a `rewarded` referrals row and notifies them by email (best-effort).
 *
 * Safe to call from both the Stripe webhook and the legacy subscribe path.
 */
export async function awardReferrerReward(args: AwardReferrerRewardArgs): Promise<AwardResult> {
  const { admin, stripe, referralCode, referredOrgId, referredUserId, referredEmail } = args;
  const now = args.now || new Date();

  const referral = await lookupReferralCode(admin, referralCode);
  if (!referral) return { awarded: false, reason: 'code_not_found' };

  // Reject self-referral (same org using its own code).
  if (referral.referrer_org_id === referredOrgId) {
    return { awarded: false, reason: 'self_referral' };
  }

  // Idempotency: one reward per referred org per code.
  const { data: alreadyRewarded } = await admin
    .from('referrals')
    .select('id')
    .eq('code', referralCode)
    .eq('referred_org_id', referredOrgId)
    .eq('status', 'rewarded')
    .maybeSingle();

  if (alreadyRewarded) return { awarded: false, reason: 'already_rewarded' };

  const { cents, currency } = await resolveRewardCents(admin, referral.referrer_org_id);

  // Guarantee a Stripe customer exists (creating one if the org never had one),
  // so every referrer is creditable regardless of how their org was provisioned.
  const stripeCustomerId = await ensureStripeCustomerForOrg(
    admin,
    stripe,
    referral.referrer_org_id,
    { currency },
  );

  // ── Apply the reward as a Stripe customer balance credit (Jobber-style) ──
  // A negative balance is a credit that reduces the customer's next invoice.
  // Stripe stays the source of truth, so the referrer's recurring sub simply
  // charges less (or nothing) on the next cycle — no DB/Stripe desync.
  let creditApplied = false;
  if (stripe && stripeCustomerId) {
    try {
      await stripe.customers.createBalanceTransaction(stripeCustomerId, {
        amount: -Math.abs(cents), // negative = credit
        currency: currency.toLowerCase(),
        description: `Referral reward — free month (code ${referralCode})`,
        metadata: {
          referral_code: referralCode,
          referred_org_id: referredOrgId,
          reward_type: 'free_month',
        },
      });
      creditApplied = true;
    } catch (err: any) {
      // Never fail the referred customer's activation on a reward-credit error.
      console.error('[referral-rewards] Stripe balance credit failed:', err?.message);
    }
  } else {
    console.warn('[referral-rewards] No Stripe customer for referrer org', referral.referrer_org_id, '— credit skipped.');
  }

  // If the credit did not actually land, record the conversion as
  // `reward_pending` instead of `rewarded`. Writing `rewarded` here would let the
  // idempotency check above suppress every future retry, permanently burying a
  // credit the referrer genuinely earned. `reward_pending` keeps it visible and
  // replayable. Real cases: referrer org has no Stripe customer anywhere, or the
  // Stripe call failed (currency mismatch, API outage).
  const finalStatus = creditApplied ? 'rewarded' : 'reward_pending';
  if (!creditApplied) {
    console.error(
      `[referral-rewards] Reward NOT credited for code ${referralCode} (referrer org ${referral.referrer_org_id}) — recorded as reward_pending for manual follow-up.`,
    );
  }

  // ── Record the referral outcome (one row per converted referred org) ──
  const { error: recordErr } = await admin.from('referrals').insert({
    referrer_user_id: referral.referrer_user_id,
    referrer_org_id: referral.referrer_org_id,
    code: referralCode,
    referred_email: (referredEmail || '').toLowerCase(),
    referred_org_id: referredOrgId,
    referred_user_id: referredUserId,
    status: finalStatus,
    reward_amount_cents: cents,
    reward_currency: currency,
    converted_at: now.toISOString(),
    rewarded_at: creditApplied ? now.toISOString() : null,
  });
  if (recordErr) {
    // CRITICAL: la ligne d'idempotence n'a pas été écrite — un webhook rejoué
    // re-créditerait le parrain. Suivi manuel requis.
    console.error(
      `[referral-rewards] CRITICAL: referrals insert failed — idempotency row missing (code=${referralCode}, referrer_org=${referral.referrer_org_id}, referrer_user=${referral.referrer_user_id}, referred_org=${referredOrgId}, referred_user=${referredUserId}, credit_applied=${creditApplied}):`,
      recordErr.message,
    );
    return creditApplied
      ? { awarded: true, pending: true }
      : { awarded: false, reason: 'credit_failed', pending: true };
  }

  // Flag any pre-existing signed_up row for this referred email (link tracking).
  await admin
    .from('referrals')
    .update({
      status: finalStatus,
      referred_org_id: referredOrgId,
      referred_user_id: referredUserId,
      converted_at: now.toISOString(),
      rewarded_at: creditApplied ? now.toISOString() : null,
    })
    .eq('code', referralCode)
    .eq('referred_email', (referredEmail || '').toLowerCase())
    .eq('status', 'signed_up');

  // ── Notify the referrer (best-effort) ──
  // Only when the credit actually landed — the email states the credit is already
  // applied, so sending it on a pending reward would be a false promise.
  try {
    const { sendEmail, isMailerConfigured } = await import('./mailer');
    if (creditApplied && isMailerConfigured()) {
      const { data: referrerUser } = await admin.auth.admin.getUserById(referral.referrer_user_id);
      const referrerEmail = referrerUser?.user?.email;
      if (referrerEmail) {
        await sendEmail({
          to: referrerEmail,
          subject: '🎁 You earned a free month — your referral subscribed!',
          html: `<h2>Your referral just subscribed</h2><p>Great news — a business you referred to Lume CRM just signed up for a paid plan, so <strong>your next month is on us</strong>. We've applied a one-month credit to your account; it will reduce your next invoice automatically.</p><p>Keep sharing your link to stack more free months.</p>`,
        });
      }
    }
  } catch (err) {
    console.error('[referral-rewards] referrer reward email failed:', err);
  }

  return creditApplied
    ? { awarded: true }
    : { awarded: false, reason: 'credit_failed', pending: true };
}
