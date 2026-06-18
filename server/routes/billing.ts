import { Router } from 'express';
import { z } from 'zod';
import Stripe from 'stripe';
import { validate } from '../lib/validation';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner, findUserByEmail } from '../lib/supabase';

const router = Router();

// ── Stripe client ──
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// ─── Validation schemas ──────────────────────────────────────────

const onboardingSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required.'),
  company_name: z.string().trim().min(1, 'Company name is required.'),
  email: z.string().trim().email('Valid email is required.'),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  region: z.string().trim().optional(),
  country: z.string().trim().optional().default('CA'),
  postal_code: z.string().trim().optional(),
  industry: z.string().trim().optional(),
  company_size: z.string().trim().optional(),
  currency: z.enum(['USD', 'CAD']).default('CAD'),
});

const subscribeSchema = z.object({
  plan_slug: z.string().trim().min(1, 'Plan is required.'),
  interval: z.enum(['monthly', 'yearly']).default('monthly'),
  currency: z.enum(['USD', 'CAD']).default('CAD'),
  payment_method_id: z.string().trim().optional(), // Stripe PaymentMethod ID
  promo_code: z.string().trim().optional(),
  referral_code: z.string().trim().optional(),
  billing_email: z.string().trim().email().optional(),
  company_name: z.string().trim().optional(),
  country: z.string().trim().optional(),
  postal_code: z.string().trim().optional(),
});

// ─── GET /billing/plans — List available plans ──────────────────

router.get('/billing/plans', async (_req, res) => {
  try {
    const admin = getServiceClient();
    const { data: plans, error } = await admin
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[billing/plans]', error.message);
      return res.status(500).json({ error: 'Failed to load plans.' });
    }

    return res.json({ plans: plans || [] });
  } catch (err: any) {
    console.error('[billing/plans]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /billing/current — Get current subscription ────────────

router.get('/billing/current', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();

    // Fetch subscription and billing_profile in parallel
    const [subRes, profileRes] = await Promise.all([
      admin
        .from('subscriptions')
        .select('*')
        .eq('org_id', auth.orgId)
        .in('status', ['active', 'trialing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('billing_profiles')
        .select('*')
        .eq('org_id', auth.orgId)
        .maybeSingle(),
    ]);

    return res.json({ subscription: subRes.data, billing_profile: profileRes.data });
  } catch (err: any) {
    console.error('[billing/current]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /billing/onboarding — Save onboarding data ────────────

router.post('/billing/onboarding', validate(onboardingSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { full_name, company_name, email, phone, address, city, region, country, postal_code, industry, company_size, currency } = req.body;

    // Run the 3 independent writes in parallel
    await Promise.all([
      admin.from('orgs').update({
        name: company_name,
        phone: phone || undefined,
        email: email || undefined,
        address: address || undefined,
        city: city || undefined,
        region: region || undefined,
        country: country || undefined,
        postal_code: postal_code || undefined,
        industry: industry || undefined,
        company_size: company_size || undefined,
        currency: currency || undefined,
      }).eq('id', auth.orgId),
      admin.from('billing_profiles').upsert({
        org_id: auth.orgId,
        billing_email: email,
        full_name,
        company_name,
        phone,
        address, city, region, country, postal_code,
        currency,
      }, { onConflict: 'org_id' }),
      admin.from('profiles').update({ full_name }).eq('id', auth.user.id),
    ]);

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[billing/onboarding]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /billing/subscribe — Create subscription with Stripe payment ──

router.post('/billing/subscribe', validate(subscribeSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { plan_slug, interval, currency, promo_code, referral_code, payment_method_id, billing_email, company_name, country, postal_code } = req.body;

    // ── Fetch user auth info, plan, and promo code in parallel ──
    // These three lookups are independent — running them in parallel saves 2 round-trips.
    const [userRes, planRes, promoRes] = await Promise.all([
      admin.auth.admin.getUserById(auth.user.id),
      admin
        .from('plans')
        .select('*')
        .eq('slug', plan_slug)
        .eq('is_active', true)
        .maybeSingle(),
      promo_code
        ? admin
            .from('promo_codes')
            .select('*')
            .eq('code', promo_code.toUpperCase())
            .eq('is_active', true)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    // Email verification gate
    const userMeta = userRes.data?.user?.user_metadata || {};
    const hasVerificationFlag = 'billing_email_verified' in userMeta;
    const isEmailVerified = hasVerificationFlag
      ? !!userMeta.billing_email_verified
      : !!userRes.data?.user?.email_confirmed_at; // legacy fallback
    if (!isEmailVerified) {
      console.log(`[billing/subscribe] Blocked: user ${auth.user.id} email not verified`);
      return res.status(403).json({
        error: 'Email verification required before subscribing to a paid plan.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    const plan = planRes.data;
    if (planRes.error || !plan) {
      return res.status(404).json({ error: 'Plan not found.' });
    }

    // Calculate amount
    const priceField = interval === 'yearly'
      ? (currency === 'USD' ? 'yearly_price_usd' : 'yearly_price_cad')
      : (currency === 'USD' ? 'monthly_price_usd' : 'monthly_price_cad');
    let amountCents = plan[priceField] || 0;

    // Apply promo code (already fetched in parallel above)
    let appliedPromo = null;
    if (promo_code) {
      const promo = promoRes.data as any;

      if (promo) {
        const now = new Date();
        const validFrom = new Date(promo.valid_from);
        const validUntil = promo.valid_until ? new Date(promo.valid_until) : null;
        const withinLimit = !promo.max_uses || promo.current_uses < promo.max_uses;

        if (now >= validFrom && (!validUntil || now <= validUntil) && withinLimit) {
          if (promo.discount_type === 'percentage') {
            amountCents = Math.round(amountCents * (1 - promo.discount_value / 100));
          } else {
            amountCents = Math.max(0, amountCents - promo.discount_value);
          }
          appliedPromo = promo.code;
          await admin.from('promo_codes').update({ current_uses: promo.current_uses + 1 }).eq('id', promo.id);
        }
      }
    }

    // ── Stripe payment (if amount > 0 and Stripe is configured) ──
    let stripePaymentId: string | null = null;

    if (amountCents > 0 && stripe && payment_method_id) {
      try {
        // Get or create Stripe customer
        const { data: billingProfile } = await admin
          .from('billing_profiles')
          .select('stripe_customer_id')
          .eq('org_id', auth.orgId)
          .maybeSingle();

        let customerId = billingProfile?.stripe_customer_id;

        if (!customerId) {
          const customer = await stripe.customers.create({
            email: billing_email || auth.user.email || undefined,
            name: company_name || undefined,
            metadata: { org_id: auth.orgId, user_id: auth.user.id },
          });
          customerId = customer.id;

          await admin.from('billing_profiles').upsert({
            org_id: auth.orgId,
            stripe_customer_id: customerId,
            billing_email: billing_email || undefined,
            company_name: company_name || undefined,
            country: country || undefined,
            postal_code: postal_code || undefined,
            currency,
          }, { onConflict: 'org_id' });
        }

        // Attach payment method to customer
        await stripe.paymentMethods.attach(payment_method_id, { customer: customerId });
        await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: payment_method_id } });

        // Create and confirm PaymentIntent — idempotency prevents double-charge on retry
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: currency.toLowerCase(),
          customer: customerId,
          payment_method: payment_method_id,
          confirm: true,
          automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
          metadata: {
            org_id: auth.orgId,
            plan_slug,
            interval,
          },
        }, {
          idempotencyKey: `sub-intent-${auth.orgId}-${plan_slug}-${interval}-${payment_method_id}`,
        });

        if (paymentIntent.status !== 'succeeded') {
          return res.status(402).json({ error: 'Payment failed. Please check your card details.', status: paymentIntent.status });
        }

        stripePaymentId = paymentIntent.id;
      } catch (stripeErr: any) {
        console.error('[billing/subscribe] Stripe error:', stripeErr.message);
        return res.status(402).json({ error: stripeErr.message || 'Payment failed.' });
      }
    } else if (amountCents > 0 && !stripe) {
      console.warn('[billing/subscribe] Stripe not configured — creating subscription without payment');
    }

    // Calculate period
    const now = new Date();
    const periodEnd = new Date(now);
    if (interval === 'yearly') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    else periodEnd.setMonth(periodEnd.getMonth() + 1);

    // Cancel existing active subscriptions
    await admin
      .from('subscriptions')
      .update({ status: 'canceled', canceled_at: now.toISOString() })
      .eq('org_id', auth.orgId)
      .eq('status', 'active');

    // Create subscription — use only columns that exist in the table
    const subInsert: Record<string, any> = {
      org_id: auth.orgId,
      user_id: auth.user.id,
      plan_id: plan.id,
      status: 'active',
    };
    // Add optional columns if they exist (won't error if missing)
    const optionalFields: Record<string, any> = {
      interval,
      currency,
      amount_cents: amountCents,
      promo_code: appliedPromo,
      referral_code: referral_code || null,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
    };

    // Try with all fields first, fallback to minimal
    let subscription: any = null;
    let subError: any = null;

    const { data: sub1, error: err1 } = await admin
      .from('subscriptions')
      .insert({ ...subInsert, ...optionalFields })
      .select('*')
      .single();

    if (err1) {
      console.warn('[billing/subscribe] full insert failed, trying minimal:', err1.message);
      // Fallback: just the required columns
      const { data: sub2, error: err2 } = await admin
        .from('subscriptions')
        .insert(subInsert)
        .select('*')
        .single();
      subscription = sub2;
      subError = err2;
    } else {
      subscription = sub1;
    }

    if (subError) {
      console.error('[billing/subscribe] error:', subError.message);
      return res.status(500).json({ error: 'Failed to create subscription.' });
    }

    // Update billing profile
    if (billing_email || company_name) {
      await admin.from('billing_profiles').upsert({
        org_id: auth.orgId,
        billing_email: billing_email || undefined,
        company_name: company_name || undefined,
        country: country || undefined,
        postal_code: postal_code || undefined,
        currency,
      }, { onConflict: 'org_id' });
    }

    // ── Referral reward: referrer earns 1 free month per PAID referral ──
    // Reward model: extend the referrer's current_period_end by 30 days.
    // Unlimited stacking; gated so only paying referrers have a link, so the
    // referrer always has a period to extend. See project_referral_program.
    if (referral_code) {
      try {
        // Look up the template row (referred_email='') for the code's owner.
        const { data: referral } = await admin
          .from('referrals')
          .select('id, referrer_user_id, referrer_org_id')
          .eq('code', referral_code)
          .limit(1)
          .maybeSingle();

        // Guards: code must exist, and self-referral (same org) is rejected.
        if (referral && referral.referrer_org_id !== auth.orgId) {
          // Mark the conversion. Insert a dedicated rewarded row for this
          // referred org if one isn't already there (idempotent on org).
          const { data: alreadyRewarded } = await admin
            .from('referrals')
            .select('id')
            .eq('code', referral_code)
            .eq('referred_org_id', auth.orgId)
            .eq('status', 'rewarded')
            .maybeSingle();

          if (!alreadyRewarded) {
            // Extend the referrer's active subscription by 30 days, stacking
            // on whatever current_period_end they already have.
            const { data: referrerSub } = await admin
              .from('subscriptions')
              .select('id, current_period_end')
              .eq('org_id', referral.referrer_org_id)
              .in('status', ['active', 'trialing'])
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (referrerSub) {
              const base = referrerSub.current_period_end
                ? new Date(referrerSub.current_period_end)
                : new Date(now);
              // Stack from the later of (now, existing end) so an expired
              // period doesn't shrink the gift.
              const from = base > now ? base : new Date(now);
              const extended = new Date(from);
              extended.setDate(extended.getDate() + 30);

              await admin
                .from('subscriptions')
                .update({ current_period_end: extended.toISOString() })
                .eq('id', referrerSub.id);
            }

            // Record the rewarded referral (one row per converted referred org).
            await admin.from('referrals').insert({
              referrer_user_id: referral.referrer_user_id,
              referrer_org_id: referral.referrer_org_id,
              code: referral_code,
              referred_email: (billing_email || auth.user.email || '').toLowerCase(),
              referred_org_id: auth.orgId,
              referred_user_id: auth.user.id,
              status: 'rewarded',
              converted_at: now.toISOString(),
              rewarded_at: now.toISOString(),
            });

            // Also flag any pre-existing signed_up row for this referred org.
            await admin
              .from('referrals')
              .update({ status: 'rewarded', referred_org_id: auth.orgId, referred_user_id: auth.user.id, converted_at: now.toISOString(), rewarded_at: now.toISOString() })
              .eq('code', referral_code)
              .eq('referred_email', (billing_email || auth.user.email || '').toLowerCase())
              .eq('status', 'signed_up');

            // Notify the referrer: they earned a free month.
            try {
              const { sendEmail, isMailerConfigured } = await import('../lib/mailer');
              if (isMailerConfigured()) {
                const { data: referrerUser } = await admin.auth.admin.getUserById(referral.referrer_user_id);
                const referrerEmail = referrerUser?.user?.email;
                if (referrerEmail) {
                  await sendEmail({
                    to: referrerEmail,
                    subject: '🎁 You earned a free month — your referral subscribed!',
                    html: `<h2>Your referral just subscribed</h2><p>Great news — someone you referred to Lume CRM just signed up for a paid plan, so <strong>your next month is on us</strong>. We've already extended your billing period by 30 days.</p><p>Keep sharing your link to stack more free months.</p>`,
                  });
                }
              }
            } catch (err) { console.error('[billing] referrer reward email failed:', err); }
          }
        }
      } catch (err) { console.error('[billing] referral reward failed:', err); }
    }

    // ── Send receipt email (if paid plan, non-blocking) ──
    if (amountCents > 0 && subscription) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      try {
        const { sendPaymentReceipt } = await import('../lib/billing-email');
        await sendPaymentReceipt({
          orgId: auth.orgId,
          subscriptionId: subscription.id,
          recipientEmail: billing_email || auth.user.email || '',
          companyName: company_name || '',
          planName: plan.name,
          interval,
          amountCents,
          currency,
          taxes: null,
          stripePaymentIntentId: stripePaymentId,
          stripeCheckoutSessionId: null,
          paymentDate: now,
          dashboardUrl: frontendUrl,
          billingUrl: `${frontendUrl}/settings/billing`,
        });
      } catch (emailErr: any) {
        console.error('[billing/subscribe] Receipt email error (non-blocking):', emailErr.message);
      }
    }

    return res.json({ subscription });
  } catch (err: any) {
    console.error('[billing/subscribe]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /billing/create-payment-intent — For Stripe Elements ──

router.post('/billing/create-payment-intent', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe not configured.' });
    }

    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { amount_cents, currency } = req.body;
    if (!amount_cents || amount_cents <= 0) {
      return res.status(400).json({ error: 'Amount must be > 0.' });
    }

    // Get or create Stripe customer
    const admin = getServiceClient();
    const { data: billingProfile } = await admin
      .from('billing_profiles')
      .select('stripe_customer_id')
      .eq('org_id', auth.orgId)
      .maybeSingle();

    let customerId = billingProfile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: auth.user.email || undefined,
        metadata: { org_id: auth.orgId },
      });
      customerId = customer.id;
      await admin.from('billing_profiles').upsert({
        org_id: auth.orgId,
        stripe_customer_id: customerId,
        currency: currency || 'CAD',
      }, { onConflict: 'org_id' });
    }

    // Idempotency bucketed per minute so retries within a burst dedupe,
    // but distinct user-initiated attempts still succeed.
    const bucket = Math.floor(Date.now() / 60_000);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount_cents,
      currency: (currency || 'CAD').toLowerCase(),
      customer: customerId,
      automatic_payment_methods: { enabled: true },
    }, {
      idempotencyKey: `pi-${auth.orgId}-${amount_cents}-${bucket}`,
    });

    return res.json({ client_secret: paymentIntent.client_secret });
  } catch (err: any) {
    console.error('[billing/create-payment-intent]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /billing/cancel — Cancel subscription ─────────────────

router.post('/billing/cancel', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins or owners can cancel subscriptions.' });
    }

    // F-34: Look up the Stripe subscription id first and tell Stripe to cancel
    // at period end. The previous implementation only flipped the DB flag, so
    // Stripe kept charging at the next renewal.
    const { data: subRow, error: subFetchErr } = await admin
      .from('subscriptions')
      .select('id, stripe_subscription_id, status')
      .eq('org_id', auth.orgId)
      .eq('status', 'active')
      .maybeSingle();

    if (subFetchErr) {
      console.error('[billing/cancel] subscription lookup failed', subFetchErr.message);
      return res.status(500).json({ error: 'Failed to cancel subscription.' });
    }

    if (!subRow) {
      return res.status(404).json({ error: 'No active subscription to cancel.' });
    }

    if (subRow.stripe_subscription_id && stripe) {
      try {
        await stripe.subscriptions.update(subRow.stripe_subscription_id, {
          cancel_at_period_end: true,
        });
      } catch (stripeErr: any) {
        const code = stripeErr?.code || stripeErr?.raw?.code || '';
        const msg = stripeErr?.message || '';
        // Tolerate "already cancelled / not found" — we'll still mirror in DB.
        const benign =
          code === 'resource_missing' ||
          /No such subscription/i.test(msg) ||
          /canceled/i.test(msg);
        if (!benign) {
          console.error('[billing/cancel] Stripe cancel failed', { code, msg });
          return res.status(502).json({ error: 'Failed to cancel subscription with Stripe.' });
        }
      }
    }

    const { error } = await admin
      .from('subscriptions')
      .update({ cancel_at_period_end: true })
      .eq('id', subRow.id);

    if (error) {
      return res.status(500).json({ error: 'Failed to cancel subscription.' });
    }

    return res.json({ message: 'Subscription will be canceled at the end of the billing period.' });
  } catch (err: any) {
    console.error('[billing/cancel]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /billing/change-plan — Change plan or interval on existing sub ──
// Uses Stripe's stripe.subscriptions.update with prorations.
// Stripe credits/charges the difference automatically on next invoice.

const changePlanSchema = z.object({
  plan_slug: z.string().trim().min(1, 'Plan is required.'),
  interval: z.enum(['monthly', 'yearly']).default('monthly'),
});

router.post('/billing/change-plan', validate(changePlanSchema), async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured.' });

    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins or owners can change plans.' });
    }

    const { plan_slug, interval } = req.body as { plan_slug: string; interval: 'monthly' | 'yearly' };

    // Fetch target plan
    const { data: targetPlan } = await admin
      .from('plans')
      .select('*')
      .eq('slug', plan_slug)
      .eq('is_active', true)
      .maybeSingle();
    if (!targetPlan) return res.status(404).json({ error: 'Plan not found.' });

    // Fetch current sub
    const { data: subRow } = await admin
      .from('subscriptions')
      .select('id, plan_id, interval, currency, stripe_subscription_id, status')
      .eq('org_id', auth.orgId)
      .in('status', ['active', 'trialing'])
      .maybeSingle();
    if (!subRow) return res.status(404).json({ error: 'No active subscription found.' });

    // No-op if nothing changes
    if (subRow.plan_id === targetPlan.id && subRow.interval === interval) {
      return res.json({ message: 'Already on this plan and interval.', no_change: true });
    }

    // Compute new price
    const currency = (subRow.currency || 'CAD').toUpperCase();
    const priceField = interval === 'yearly'
      ? (currency === 'USD' ? 'yearly_price_usd' : 'yearly_price_cad')
      : (currency === 'USD' ? 'monthly_price_usd' : 'monthly_price_cad');
    const amountCents = targetPlan[priceField] || 0;

    // If no Stripe sub linked (e.g. legacy), just update DB
    if (!subRow.stripe_subscription_id) {
      const now = new Date();
      const periodEnd = new Date(now);
      if (interval === 'yearly') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      else periodEnd.setMonth(periodEnd.getMonth() + 1);

      await admin.from('subscriptions').update({
        plan_id: targetPlan.id,
        interval,
        amount_cents: amountCents,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
      }).eq('id', subRow.id);

      return res.json({ message: 'Plan changed (no Stripe link).', no_stripe: true });
    }

    // Retrieve Stripe sub to get current item id
    let stripeSub: Stripe.Subscription;
    try {
      stripeSub = await stripe.subscriptions.retrieve(subRow.stripe_subscription_id);
    } catch (err: any) {
      console.error('[billing/change-plan] Stripe retrieve failed', err.message);
      return res.status(502).json({ error: 'Failed to load Stripe subscription.' });
    }

    const currentItemId = stripeSub.items.data[0]?.id;
    if (!currentItemId) {
      return res.status(500).json({ error: 'Stripe subscription has no items.' });
    }

    // ── Determine direction: upgrade vs downgrade ──
    const { data: currentPlanRow } = await admin
      .from('plans')
      .select('sort_order, monthly_price_usd, monthly_price_cad, yearly_price_usd, yearly_price_cad')
      .eq('id', subRow.plan_id)
      .maybeSingle();
    const currentPrice = currentPlanRow?.[priceField] || 0;
    const targetSortOrder = targetPlan.sort_order ?? 0;
    const currentSortOrder = currentPlanRow?.sort_order ?? 0;
    // Downgrade: lower plan tier OR cheaper price (e.g. yearly→monthly = downgrade)
    const isDowngrade = targetSortOrder < currentSortOrder || amountCents < currentPrice;

    // Resolve the persistent Stripe Price ID for the target plan + interval + currency.
    // These IDs are pre-created via scripts/sync-stripe-products.ts and stored on plans.
    const priceIdField =
      interval === 'yearly'
        ? currency === 'USD' ? 'stripe_yearly_price_id_usd' : 'stripe_yearly_price_id_cad'
        : currency === 'USD' ? 'stripe_monthly_price_id_usd' : 'stripe_monthly_price_id_cad';
    let newPriceId: string | null = targetPlan[priceIdField] || null;

    // Lazy fallback: if the persistent ID isn't set yet (e.g. plan added later),
    // create one and save it back to the plan row so we never pay this cost again.
    if (!newPriceId) {
      try {
        let productId: string | null = targetPlan.stripe_product_id;
        if (!productId) {
          const product = await stripe.products.create({
            name: `Lume ${targetPlan.name}`,
            description: `Lume CRM ${targetPlan.name} subscription`,
            metadata: { plan_id: targetPlan.id, plan_slug: targetPlan.slug },
          });
          productId = product.id;
        }
        const price = await stripe.prices.create({
          product: productId,
          currency: currency.toLowerCase(),
          unit_amount: amountCents,
          recurring: { interval: interval === 'yearly' ? 'year' : 'month' },
          metadata: { plan_id: targetPlan.id },
        });
        newPriceId = price.id;
        // Persist for future calls
        await admin.from('plans').update({
          stripe_product_id: productId,
          [priceIdField]: newPriceId,
        }).eq('id', targetPlan.id);
      } catch (err: any) {
        console.error('[billing/change-plan] Stripe price create failed', err.message);
        return res.status(502).json({ error: `Stripe price creation failed: ${err.message}` });
      }
    }

    if (isDowngrade) {
      // ── DOWNGRADE: schedule the change at end of current period ──
      // Use Subscription Schedules so the user keeps current plan until period end,
      // then auto-switches to new plan with no proration (they already paid for current month).
      try {
        // First, retrieve existing schedule if any (so we don't duplicate)
        if (stripeSub.schedule) {
          // Release existing schedule first
          try {
            await stripe.subscriptionSchedules.release(stripeSub.schedule as string);
          } catch { /* ignore */ }
        }

        // Create a schedule from the current subscription
        const schedule = await stripe.subscriptionSchedules.create({
          from_subscription: subRow.stripe_subscription_id,
        });

        // Update the schedule: keep current phase, then add a new phase with the target plan.
        // Stripe v18+ moved current_period_end to the subscription item.
        const currentItem = stripeSub.items.data[0];
        const periodEndUnix: number = (currentItem as any).current_period_end
          ?? (stripeSub as any).current_period_end;

        await stripe.subscriptionSchedules.update(schedule.id, {
          end_behavior: 'release',
          phases: [
            {
              items: [{ price: currentItem.price.id, quantity: currentItem.quantity || 1 }],
              start_date: schedule.phases[0].start_date,
              end_date: periodEndUnix,
              proration_behavior: 'none',
            },
            {
              items: [{ price: newPriceId, quantity: 1 }],
              proration_behavior: 'none',
              metadata: {
                plan_slug: targetPlan.slug,
                plan_id: targetPlan.id,
                interval,
              },
            },
          ],
          metadata: {
            ...stripeSub.metadata,
            scheduled_plan_slug: targetPlan.slug,
            scheduled_plan_id: targetPlan.id,
            scheduled_interval: interval,
          },
        });

        // Mark DB to indicate a scheduled change (UI shows banner)
        await admin.from('subscriptions').update({
          scheduled_plan_id: targetPlan.id,
          scheduled_interval: interval,
          scheduled_at: new Date(periodEndUnix * 1000).toISOString(),
        }).eq('id', subRow.id);

        const effectiveDate = new Date(periodEndUnix * 1000).toLocaleDateString('en-CA', {
          year: 'numeric', month: 'long', day: 'numeric',
        });

        return res.json({
          message: `Plan will change to ${targetPlan.name} on ${effectiveDate}.`,
          scheduled: true,
          effective_date: new Date(periodEndUnix * 1000).toISOString(),
          plan: { slug: targetPlan.slug, name: targetPlan.name, interval, amount_cents: amountCents },
        });
      } catch (err: any) {
        console.error('[billing/change-plan] Stripe schedule create failed', err.message);
        return res.status(502).json({ error: `Schedule creation failed: ${err.message}` });
      }
    }

    // ── UPGRADE: apply immediately with proration, billed right away ──
    // 'always_invoice' charges the prorated difference NOW on a new invoice
    // (rather than waiting for the next billing cycle — important for annual plans).
    try {
      await stripe.subscriptions.update(subRow.stripe_subscription_id, {
        proration_behavior: 'always_invoice',
        billing_cycle_anchor: 'unchanged',
        items: [{
          id: currentItemId,
          price: newPriceId,
        }],
        metadata: {
          ...stripeSub.metadata,
          plan_slug: targetPlan.slug,
          plan_id: targetPlan.id,
          interval,
        },
      });
    } catch (err: any) {
      console.error('[billing/change-plan] Stripe update failed', err.message);
      return res.status(502).json({ error: `Stripe update failed: ${err.message}` });
    }

    // Mirror in DB — webhook will also update but we want immediate UI feedback
    await admin.from('subscriptions').update({
      plan_id: targetPlan.id,
      interval,
      amount_cents: amountCents,
      scheduled_plan_id: null,
      scheduled_interval: null,
      scheduled_at: null,
    }).eq('id', subRow.id);

    return res.json({
      message: 'Plan upgraded. Proration applied on next invoice.',
      upgraded: true,
      plan: { slug: targetPlan.slug, name: targetPlan.name, interval, amount_cents: amountCents },
    });
  } catch (err: any) {
    console.error('[billing/change-plan]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /billing/dev-switch-plan — TEMPORARY test-only plan switcher ──────
// Switches the org's plan directly in the DB, bypassing Stripe entirely.
// Intended for testing plan-gated UI (locked tabs, "Discover features", etc.).
// Admin/owner only. Remove before relying on real billing flows.
const devSwitchPlanSchema = z.object({
  plan_slug: z.string().trim().min(1, 'Plan is required.'),
  interval: z.enum(['monthly', 'yearly']).default('monthly'),
});

router.post('/billing/dev-switch-plan', validate(devSwitchPlanSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins or owners can switch plans.' });
    }

    const { plan_slug, interval } = req.body as { plan_slug: string; interval: 'monthly' | 'yearly' };

    const { data: targetPlan } = await admin
      .from('plans')
      .select('*')
      .eq('slug', plan_slug)
      .eq('is_active', true)
      .maybeSingle();
    if (!targetPlan) return res.status(404).json({ error: 'Plan not found.' });

    // Existing active/trialing sub for this org, if any
    const { data: subRow } = await admin
      .from('subscriptions')
      .select('id, currency')
      .eq('org_id', auth.orgId)
      .in('status', ['active', 'trialing'])
      .maybeSingle();

    const currency = (subRow?.currency || 'CAD').toUpperCase();
    const priceField = interval === 'yearly'
      ? (currency === 'USD' ? 'yearly_price_usd' : 'yearly_price_cad')
      : (currency === 'USD' ? 'monthly_price_usd' : 'monthly_price_cad');
    const amountCents = (targetPlan as any)[priceField] || 0;

    const now = new Date();
    const periodEnd = new Date(now);
    if (interval === 'yearly') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    else periodEnd.setMonth(periodEnd.getMonth() + 1);

    if (subRow) {
      await admin.from('subscriptions').update({
        plan_id: targetPlan.id,
        interval,
        amount_cents: amountCents,
        status: 'active',
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        updated_at: now.toISOString(),
      }).eq('id', subRow.id);
    } else {
      await admin.from('subscriptions').insert({
        org_id: auth.orgId,
        plan_id: targetPlan.id,
        interval,
        currency,
        amount_cents: amountCents,
        status: 'active',
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
      });
    }

    return res.json({
      message: `Switched to ${targetPlan.name} (${interval}).`,
      plan: { slug: targetPlan.slug, name: targetPlan.name, interval, amount_cents: amountCents },
    });
  } catch (err: any) {
    console.error('[billing/dev-switch-plan]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /billing/cancel-scheduled-change — Cancel a scheduled plan change ──
// Releases the Stripe Subscription Schedule so the current plan continues unchanged.

router.post('/billing/cancel-scheduled-change', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured.' });

    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins or owners can cancel scheduled changes.' });
    }

    const { data: subRow } = await admin
      .from('subscriptions')
      .select('id, stripe_subscription_id, scheduled_plan_id')
      .eq('org_id', auth.orgId)
      .in('status', ['active', 'trialing'])
      .maybeSingle();
    if (!subRow) return res.status(404).json({ error: 'No active subscription found.' });
    if (!subRow.scheduled_plan_id) {
      return res.status(400).json({ error: 'No scheduled change to cancel.' });
    }

    if (subRow.stripe_subscription_id) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(subRow.stripe_subscription_id);
        if (stripeSub.schedule) {
          await stripe.subscriptionSchedules.release(stripeSub.schedule as string);
        }
      } catch (err: any) {
        // Tolerate already-released schedules / missing schedules
        const code = err?.code || err?.raw?.code || '';
        const msg = err?.message || '';
        const benign = code === 'resource_missing' || /not_active|released/i.test(msg);
        if (!benign) {
          console.error('[billing/cancel-scheduled-change] Stripe release failed', err.message);
          return res.status(502).json({ error: `Stripe release failed: ${err.message}` });
        }
      }
    }

    await admin.from('subscriptions').update({
      scheduled_plan_id: null,
      scheduled_interval: null,
      scheduled_at: null,
    }).eq('id', subRow.id);

    return res.json({ message: 'Scheduled plan change canceled.' });
  } catch (err: any) {
    console.error('[billing/cancel-scheduled-change]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /billing/seats — Current usage vs plan seats + cost preview ──
// Returns { included, used, extras_charged, extra_price_cents, currency }

router.get('/billing/seats', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();

    const { data: subRow } = await admin
      .from('subscriptions')
      .select('id, plan_id, currency, extra_seats')
      .eq('org_id', auth.orgId)
      .in('status', ['active', 'trialing'])
      .maybeSingle();

    if (!subRow) {
      return res.json({ included: 0, used: 0, extras_charged: 0, extra_price_cents: 0, currency: 'USD' });
    }

    const { data: plan } = await admin
      .from('plans')
      .select('seats_included, extra_seat_price_usd, extra_seat_price_cad')
      .eq('id', subRow.plan_id)
      .maybeSingle();

    const { count: usedCount } = await admin
      .from('memberships')
      .select('user_id', { count: 'exact', head: true })
      .eq('org_id', auth.orgId)
      .or('status.is.null,status.eq.active');

    const currency = (subRow.currency || 'CAD').toUpperCase();
    const extraPrice = currency === 'USD'
      ? plan?.extra_seat_price_usd ?? 0
      : plan?.extra_seat_price_cad ?? 0;

    return res.json({
      included: plan?.seats_included ?? 0,
      used: usedCount ?? 0,
      extras_charged: subRow.extra_seats ?? 0,
      extra_price_cents: extraPrice,
      currency,
    });
  } catch (err: any) {
    console.error('[billing/seats]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /billing/seats — Set extra seat count (auto-syncs Stripe sub item) ──
// Used by invite flow when adding a member would exceed seats_included.

const setSeatsSchema = z.object({
  extra_seats: z.number().int().min(0).max(1000),
});

router.post('/billing/seats', validate(setSeatsSchema), async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured.' });

    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins or owners can update seat counts.' });
    }

    const { extra_seats } = req.body as { extra_seats: number };

    const { data: subRow } = await admin
      .from('subscriptions')
      .select('id, plan_id, currency, interval, stripe_subscription_id, stripe_seat_item_id, extra_seats')
      .eq('org_id', auth.orgId)
      .in('status', ['active', 'trialing'])
      .maybeSingle();
    if (!subRow) return res.status(404).json({ error: 'No active subscription found.' });

    if (subRow.extra_seats === extra_seats) {
      return res.json({ message: 'Already at requested seat count.', no_change: true });
    }

    const { data: plan } = await admin
      .from('plans')
      .select('id, name, slug, extra_seat_price_usd, extra_seat_price_cad')
      .eq('id', subRow.plan_id)
      .maybeSingle();
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    const currency = (subRow.currency || 'CAD').toUpperCase();
    const unitAmount = currency === 'USD'
      ? plan.extra_seat_price_usd
      : plan.extra_seat_price_cad;
    if (!unitAmount) return res.status(400).json({ error: 'Plan does not support extra seats.' });

    // If no Stripe sub linked, just update DB
    if (!subRow.stripe_subscription_id) {
      await admin.from('subscriptions').update({ extra_seats }).eq('id', subRow.id);
      return res.json({ message: 'Seats updated (no Stripe link).', no_stripe: true, extra_seats });
    }

    // If we already have a seat line item on Stripe, just update its quantity
    if (subRow.stripe_seat_item_id && extra_seats > 0) {
      try {
        await stripe.subscriptionItems.update(subRow.stripe_seat_item_id, {
          quantity: extra_seats,
          proration_behavior: 'always_invoice',
        });
      } catch (err: any) {
        console.error('[billing/seats] Stripe seat item update failed', err.message);
        return res.status(502).json({ error: `Stripe update failed: ${err.message}` });
      }

      await admin.from('subscriptions').update({ extra_seats }).eq('id', subRow.id);
      return res.json({ message: 'Seat quantity updated.', extra_seats });
    }

    // Remove the seat line item if going down to 0
    if (subRow.stripe_seat_item_id && extra_seats === 0) {
      try {
        await stripe.subscriptionItems.del(subRow.stripe_seat_item_id, {
          proration_behavior: 'always_invoice',
        });
      } catch (err: any) {
        console.error('[billing/seats] Stripe seat item delete failed', err.message);
        return res.status(502).json({ error: `Stripe delete failed: ${err.message}` });
      }

      await admin.from('subscriptions').update({
        extra_seats: 0,
        stripe_seat_item_id: null,
      }).eq('id', subRow.id);
      return res.json({ message: 'Extra seats removed.', extra_seats: 0 });
    }

    // First-time add: find or create a single shared "Extra seat" Stripe Product per plan,
    // then find or create the matching Price (one per currency × interval).
    // This keeps the Stripe Dashboard clean — no duplicates across orgs.
    try {
      const extraSeatInterval: 'month' | 'year' = subRow.interval === 'yearly' ? 'year' : 'month';

      // 1. Find or create the seat product (one per plan)
      let seatProductId: string | null = null;
      const productSearch = await stripe.products.search({
        query: `metadata['plan_id']:'${plan.id}' AND metadata['type']:'extra_seat'`,
        limit: 1,
      });
      if (productSearch.data.length > 0) {
        seatProductId = productSearch.data[0].id;
      } else {
        const product = await stripe.products.create({
          name: `Lume ${plan.name} — Extra user seat`,
          description: `Additional user seat for the Lume ${plan.name} plan`,
          metadata: { plan_id: plan.id, plan_slug: plan.slug, type: 'extra_seat' },
        });
        seatProductId = product.id;
      }

      // 2. Find or create the matching price (currency + interval + unit_amount)
      const priceList = await stripe.prices.list({
        product: seatProductId,
        active: true,
        limit: 100,
      });
      const matchingPrice = priceList.data.find(
        (p) =>
          p.currency === currency.toLowerCase() &&
          p.unit_amount === unitAmount &&
          p.recurring?.interval === extraSeatInterval,
      );
      const seatPriceId = matchingPrice
        ? matchingPrice.id
        : (await stripe.prices.create({
            product: seatProductId,
            currency: currency.toLowerCase(),
            unit_amount: unitAmount,
            recurring: { interval: extraSeatInterval },
            metadata: { plan_id: plan.id, type: 'extra_seat' },
          })).id;

      const newItem = await stripe.subscriptionItems.create({
        subscription: subRow.stripe_subscription_id,
        price: seatPriceId,
        quantity: extra_seats,
        proration_behavior: 'always_invoice',
      });

      await admin.from('subscriptions').update({
        extra_seats,
        stripe_seat_item_id: newItem.id,
      }).eq('id', subRow.id);

      return res.json({ message: 'Extra seats added and billed.', extra_seats });
    } catch (err: any) {
      console.error('[billing/seats] Stripe seat item create failed', err.message);
      return res.status(502).json({ error: `Stripe create failed: ${err.message}` });
    }
  } catch (err: any) {
    console.error('[billing/seats POST]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /billing/offices — Included offices vs extras billed ──
// Returns { included, extras_charged, extra_price_cents, currency }
// Offices have no usage entity (unlike seats); extras are a manual purchase.

router.get('/billing/offices', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();

    const { data: subRow } = await admin
      .from('subscriptions')
      .select('id, plan_id, currency, extra_offices')
      .eq('org_id', auth.orgId)
      .in('status', ['active', 'trialing'])
      .maybeSingle();

    if (!subRow) {
      return res.json({ included: 0, extras_charged: 0, extra_price_cents: 0, currency: 'USD' });
    }

    const { data: plan } = await admin
      .from('plans')
      .select('included_offices, extra_office_price_usd, extra_office_price_cad')
      .eq('id', subRow.plan_id)
      .maybeSingle();

    const currency = (subRow.currency || 'CAD').toUpperCase();
    const extraPrice = currency === 'USD'
      ? plan?.extra_office_price_usd ?? 0
      : plan?.extra_office_price_cad ?? 0;

    return res.json({
      included: plan?.included_offices ?? 0,
      extras_charged: subRow.extra_offices ?? 0,
      extra_price_cents: extraPrice,
      currency,
    });
  } catch (err: any) {
    console.error('[billing/offices]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /billing/offices — Set extra office count (auto-syncs Stripe sub item) ──

const setOfficesSchema = z.object({
  extra_offices: z.number().int().min(0).max(1000),
});

router.post('/billing/offices', validate(setOfficesSchema), async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured.' });

    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins or owners can update office counts.' });
    }

    const { extra_offices } = req.body as { extra_offices: number };

    const { data: subRow } = await admin
      .from('subscriptions')
      .select('id, plan_id, currency, interval, stripe_subscription_id, stripe_office_item_id, extra_offices')
      .eq('org_id', auth.orgId)
      .in('status', ['active', 'trialing'])
      .maybeSingle();
    if (!subRow) return res.status(404).json({ error: 'No active subscription found.' });

    if (subRow.extra_offices === extra_offices) {
      return res.json({ message: 'Already at requested office count.', no_change: true });
    }

    const { data: plan } = await admin
      .from('plans')
      .select('name, slug, extra_office_price_usd, extra_office_price_cad')
      .eq('id', subRow.plan_id)
      .maybeSingle();
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    const currency = (subRow.currency || 'CAD').toUpperCase();
    const unitAmount = currency === 'USD'
      ? plan.extra_office_price_usd
      : plan.extra_office_price_cad;
    if (!unitAmount) return res.status(400).json({ error: 'Plan does not support extra offices.' });

    // If no Stripe sub linked, just update DB
    if (!subRow.stripe_subscription_id) {
      await admin.from('subscriptions').update({ extra_offices }).eq('id', subRow.id);
      return res.json({ message: 'Offices updated (no Stripe link).', no_stripe: true, extra_offices });
    }

    // If we already have an office line item on Stripe, just update its quantity
    if (subRow.stripe_office_item_id && extra_offices > 0) {
      try {
        await stripe.subscriptionItems.update(subRow.stripe_office_item_id, {
          quantity: extra_offices,
          proration_behavior: 'always_invoice',
        });
      } catch (err: any) {
        console.error('[billing/offices] Stripe office item update failed', err.message);
        return res.status(502).json({ error: `Stripe update failed: ${err.message}` });
      }

      await admin.from('subscriptions').update({ extra_offices }).eq('id', subRow.id);
      return res.json({ message: 'Office quantity updated.', extra_offices });
    }

    // Remove the office line item if going down to 0
    if (subRow.stripe_office_item_id && extra_offices === 0) {
      try {
        await stripe.subscriptionItems.del(subRow.stripe_office_item_id, {
          proration_behavior: 'always_invoice',
        });
      } catch (err: any) {
        console.error('[billing/offices] Stripe office item delete failed', err.message);
        return res.status(502).json({ error: `Stripe delete failed: ${err.message}` });
      }

      await admin.from('subscriptions').update({
        extra_offices: 0,
        stripe_office_item_id: null,
      }).eq('id', subRow.id);
      return res.json({ message: 'Extra offices removed.', extra_offices: 0 });
    }

    // First-time add: create Stripe Product + Price for the office, then attach to sub
    try {
      const product = await stripe.products.create({
        name: `Lume ${plan.name} — Extra office`,
        metadata: { plan_slug: plan.slug, type: 'extra_office' },
      });
      const price = await stripe.prices.create({
        product: product.id,
        currency: currency.toLowerCase(),
        unit_amount: unitAmount,
        recurring: { interval: subRow.interval === 'yearly' ? 'year' : 'month' },
      });

      const newItem = await stripe.subscriptionItems.create({
        subscription: subRow.stripe_subscription_id,
        price: price.id,
        quantity: extra_offices,
        proration_behavior: 'always_invoice',
      });

      await admin.from('subscriptions').update({
        extra_offices,
        stripe_office_item_id: newItem.id,
      }).eq('id', subRow.id);

      return res.json({ message: 'Extra offices added and billed.', extra_offices });
    } catch (err: any) {
      console.error('[billing/offices] Stripe office item create failed', err.message);
      return res.status(502).json({ error: `Stripe create failed: ${err.message}` });
    }
  } catch (err: any) {
    console.error('[billing/offices POST]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /billing/customer-portal — Open Stripe Customer Portal ──
// User can manage card, view invoices, download receipts directly on Stripe.

router.post('/billing/customer-portal', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured.' });

    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();

    const { data: subRow } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('org_id', auth.orgId)
      .in('status', ['active', 'trialing', 'past_due'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!subRow?.stripe_customer_id) {
      return res.status(404).json({ error: 'No Stripe customer linked to this account.' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const session = await stripe.billingPortal.sessions.create({
      customer: subRow.stripe_customer_id,
      return_url: `${frontendUrl}/settings?tab=billing`,
    });

    return res.json({ url: session.url });
  } catch (err: any) {
    console.error('[billing/customer-portal]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /billing/validate-promo — Validate promo code ─────────

router.post('/billing/validate-promo', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code is required.' });

    const admin = getServiceClient();
    const { data: promo } = await admin
      .from('promo_codes')
      .select('code, discount_type, discount_value')
      .eq('code', code.toUpperCase().trim())
      .eq('is_active', true)
      .maybeSingle();

    if (!promo) {
      return res.status(400).json({ error: 'Invalid promo code.' });
    }

    return res.json({ promo });
  } catch (err: any) {
    console.error('[billing/validate-promo]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /billing/create-checkout-session — Stripe hosted checkout (PUBLIC — no auth required) ──

router.post('/billing/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe not configured.' });
    }

    const admin = getServiceClient();
    const { plan_slug, interval, currency, promo_code, email, full_name, company_name } = req.body;

    if (!email) return res.status(400).json({ error: 'Email is required.' });

    // ── Email verification gate for existing users ──
    // Targeted lookup (was: listUsers — O(N) + 50-row default page)
    const existingUser: any = await findUserByEmail(admin, email);
    if (existingUser) {
      const meta = existingUser.user_metadata || {};
      const hasFlag = 'billing_email_verified' in meta;
      const isVerified = hasFlag ? !!meta.billing_email_verified : !!existingUser.email_confirmed_at;
      if (!isVerified) {
        console.log(`[billing/create-checkout-session] Blocked: user ${email} email not verified`);
        return res.status(403).json({
          error: 'Please verify your email address before proceeding to payment.',
          code: 'EMAIL_NOT_VERIFIED',
        });
      }
    }

    // Get plan
    const { data: plan } = await admin
      .from('plans')
      .select('*')
      .eq('slug', plan_slug)
      .eq('is_active', true)
      .maybeSingle();

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found.' });
    }

    // Calculate price
    const priceField = interval === 'yearly'
      ? (currency === 'USD' ? 'yearly_price_usd' : 'yearly_price_cad')
      : (currency === 'USD' ? 'monthly_price_usd' : 'monthly_price_cad');
    let amountCents = plan[priceField] || 0;

    // Apply promo if provided
    const discounts: any[] = [];
    if (promo_code) {
      const { data: promo } = await admin
        .from('promo_codes')
        .select('*')
        .eq('code', promo_code.toUpperCase())
        .eq('is_active', true)
        .maybeSingle();

      if (promo) {
        // For Stripe Checkout, we'll apply as a line item discount
        if (promo.discount_type === 'percentage') {
          amountCents = Math.round(amountCents * (1 - promo.discount_value / 100));
        } else {
          amountCents = Math.max(0, amountCents - promo.discount_value);
        }
      }
    }

    // Create Stripe customer (no auth needed — use email from request)
    const customer = await stripe.customers.create({
      email,
      name: full_name || undefined,
      metadata: { company_name: company_name || '', plan_slug },
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    // Resolve persistent Stripe Price ID for this plan + interval + currency.
    const priceIdField =
      interval === 'yearly'
        ? currency === 'USD' ? 'stripe_yearly_price_id_usd' : 'stripe_yearly_price_id_cad'
        : currency === 'USD' ? 'stripe_monthly_price_id_usd' : 'stripe_monthly_price_id_cad';
    let priceId: string | null = plan[priceIdField] || null;

    // Lazy fallback if the persistent Price ID isn't set yet.
    if (!priceId) {
      let productId: string | null = plan.stripe_product_id;
      if (!productId) {
        const product = await stripe.products.create({
          name: `Lume ${plan.name}`,
          description: `Lume CRM ${plan.name} subscription`,
          metadata: { plan_id: plan.id, plan_slug: plan.slug },
        });
        productId = product.id;
      }
      const price = await stripe.prices.create({
        product: productId,
        currency: (currency || 'CAD').toLowerCase(),
        unit_amount: amountCents,
        recurring: { interval: interval === 'yearly' ? 'year' : 'month' },
        metadata: { plan_id: plan.id },
      });
      priceId = price.id;
      await admin.from('plans').update({
        stripe_product_id: productId,
        [priceIdField]: priceId,
      }).eq('id', plan.id);
    }

    // Create Stripe Checkout Session — uses the persistent Price ID, no duplicates.
    // Promo discounts (if any) flow through Stripe Coupons, not inline price_data.
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      billing_address_collection: 'required',
      customer_update: { address: 'auto', name: 'auto' },
      payment_method_types: ['card'],
      payment_method_collection: 'always',
      phone_number_collection: { enabled: true },
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      discounts: discounts.length > 0 ? discounts : undefined,
      metadata: {
        email,
        full_name: full_name || '',
        company_name: company_name || '',
        plan_slug,
        plan_id: plan.id,
        interval,
        currency,
        promo_code: promo_code || '',
      },
      success_url: `${frontendUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/checkout?plan=${plan_slug}&interval=${interval}`,
    }, {
      idempotencyKey: `checkout-${customer.id}-${plan.id}-${interval}-${Math.floor(Date.now() / 60_000)}`,
    });

    return res.json({ url: session.url });
  } catch (err: any) {
    console.error('[billing/create-checkout-session]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /billing/confirm-checkout — Poll status after Stripe redirect ──
// This endpoint does NOT activate subscriptions — that's handled by the webhook.
// It polls for the webhook-confirmed subscription and returns status to the frontend.

router.post('/billing/confirm-checkout', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe not configured.' });
    }

    const admin = getServiceClient();
    const { session_id } = req.body;
    if (!session_id) {
      return res.status(400).json({ error: 'session_id is required.' });
    }

    // Retrieve the checkout session from Stripe to get metadata
    const session = await stripe.checkout.sessions.retrieve(session_id);

    // If payment isn't complete yet, tell frontend to retry
    if (session.payment_status !== 'paid') {
      return res.status(202).json({ status: 'pending', message: 'Payment not yet confirmed.' });
    }

    const meta = session.metadata || {};
    const userEmail = meta.email || '';

    // Check if the webhook has already processed this session
    const { data: processed } = await admin
      .from('processed_checkout_sessions')
      .select('subscription_id, org_id, user_id')
      .eq('stripe_checkout_session_id', session_id)
      .maybeSingle();

    if (processed) {
      // Webhook has processed — subscription is active
      return res.json({
        status: 'confirmed',
        email: userEmail,
        userId: processed.user_id,
        subscriptionId: processed.subscription_id,
      });
    }

    // Webhook hasn't processed yet — tell frontend to poll again
    return res.status(202).json({
      status: 'processing',
      message: 'Payment received. Setting up your account...',
      email: userEmail,
    });
  } catch (err: any) {
    console.error('[billing/confirm-checkout]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /billing/email-verified — Check if current user's email is verified ──

router.get('/billing/email-verified', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { data: userData } = await admin.auth.admin.getUserById(auth.user.id);
    const meta = userData?.user?.user_metadata || {};
    const hasFlag = 'billing_email_verified' in meta;
    const verified = hasFlag ? !!meta.billing_email_verified : !!userData?.user?.email_confirmed_at;

    return res.json({
      verified,
      email: userData?.user?.email || null,
    });
  } catch (err: any) {
    console.error('[billing/email-verified]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /billing/resend-receipt — Resend payment receipt for a subscription ──

router.post('/billing/resend-receipt', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const canManage = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!canManage) {
      return res.status(403).json({ error: 'Only admins or owners can resend receipts.' });
    }

    const { subscription_id } = req.body;
    if (!subscription_id) {
      return res.status(400).json({ error: 'subscription_id is required.' });
    }

    // Verify subscription belongs to the org
    const { data: sub } = await admin
      .from('subscriptions')
      .select('id')
      .eq('id', subscription_id)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (!sub) {
      return res.status(404).json({ error: 'Subscription not found.' });
    }

    const { resendPaymentReceipt } = await import('../lib/billing-email');
    const result = await resendPaymentReceipt(subscription_id);

    if (result.sent) {
      return res.json({ ok: true, message: 'Receipt resent successfully.' });
    } else {
      return res.status(400).json({ error: result.error || 'Failed to resend receipt.' });
    }
  } catch (err: any) {
    console.error('[billing/resend-receipt]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /billing/receipt-history — Get receipt email history for org ──

router.get('/billing/receipt-history', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { data: receipts, error } = await admin
      .from('billing_receipt_log')
      .select('id, recipient_email, email_type, plan_name, amount_cents, currency, status, sent_at, created_at')
      .eq('org_id', auth.orgId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[billing/receipt-history]', error.message);
      return res.status(500).json({ error: 'Failed to load receipt history.' });
    }

    return res.json({ receipts: receipts || [] });
  } catch (err: any) {
    console.error('[billing/receipt-history]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
