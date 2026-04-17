import { Router } from 'express';
import { z } from 'zod';
import Stripe from 'stripe';
import { validate } from '../lib/validation';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';

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

    const { data: subscription } = await admin
      .from('subscriptions')
      .select('*')
      .eq('org_id', auth.orgId)
      .in('status', ['active', 'trialing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: billing_profile } = await admin
      .from('billing_profiles')
      .select('*')
      .eq('org_id', auth.orgId)
      .maybeSingle();

    return res.json({ subscription, billing_profile });
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

    // Upsert org
    await admin.from('orgs').update({
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
    }).eq('id', auth.orgId);

    // Upsert billing profile
    await admin.from('billing_profiles').upsert({
      org_id: auth.orgId,
      billing_email: email,
      full_name,
      company_name,
      phone,
      address, city, region, country, postal_code,
      currency,
    }, { onConflict: 'org_id' });

    // Update profile name
    await admin.from('profiles').update({ full_name }).eq('id', auth.user.id);

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

    // ── Email verification gate ──
    // Block paid plan activation if the user's billing email is not verified.
    // billing_email_verified is set to true by the verify-email endpoint.
    // For backward compat: users who registered via normal flow and verified
    // before this flag existed will have email_confirmed_at but no flag —
    // we check both, but prefer the explicit flag.
    const { data: userData } = await admin.auth.admin.getUserById(auth.user.id);
    const userMeta = userData?.user?.user_metadata || {};
    const hasVerificationFlag = 'billing_email_verified' in userMeta;
    const isEmailVerified = hasVerificationFlag
      ? !!userMeta.billing_email_verified
      : !!userData?.user?.email_confirmed_at; // legacy fallback
    if (!isEmailVerified) {
      console.log(`[billing/subscribe] Blocked: user ${auth.user.id} email not verified`);
      return res.status(403).json({
        error: 'Email verification required before subscribing to a paid plan.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    // Get the plan
    const { data: plan, error: planError } = await admin
      .from('plans')
      .select('*')
      .eq('slug', plan_slug)
      .eq('is_active', true)
      .maybeSingle();

    if (planError || !plan) {
      return res.status(404).json({ error: 'Plan not found.' });
    }

    // Calculate amount
    const priceField = interval === 'yearly'
      ? (currency === 'USD' ? 'yearly_price_usd' : 'yearly_price_cad')
      : (currency === 'USD' ? 'monthly_price_usd' : 'monthly_price_cad');
    let amountCents = plan[priceField] || 0;

    // Apply promo code
    let appliedPromo = null;
    if (promo_code) {
      const { data: promo } = await admin
        .from('promo_codes')
        .select('*')
        .eq('code', promo_code.toUpperCase())
        .eq('is_active', true)
        .maybeSingle();

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

        // Create and confirm PaymentIntent
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

    // Referral tracking
    if (referral_code) {
      await admin.from('referrals').update({
        status: 'subscribed',
        referred_org_id: auth.orgId,
        referred_user_id: auth.user.id,
        converted_at: now.toISOString(),
      }).eq('code', referral_code).eq('status', 'signed_up');

      try {
        const { sendEmail, isMailerConfigured } = await import('../lib/mailer');
        if (isMailerConfigured()) {
          const lumeOwnerEmail = process.env.LUME_OWNER_EMAIL || 'admin@lume.crm';
          const { data: referral } = await admin
            .from('referrals')
            .select('*, referrer:profiles!referrer_user_id(full_name)')
            .eq('code', referral_code)
            .maybeSingle();

          await sendEmail({
            to: lumeOwnerEmail,
            subject: 'New referral conversion!',
            html: `<h2>Referral Conversion</h2><p>Referrer: ${(referral as any)?.referrer?.full_name || 'Unknown'}</p><p>Company: ${company_name || 'N/A'}</p><p>Plan: ${plan.name} (${interval})</p>`,
          });
        }
      } catch {}
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

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount_cents,
      currency: (currency || 'CAD').toLowerCase(),
      customer: customerId,
      automatic_payment_methods: { enabled: true },
    });

    return res.json({ client_secret: paymentIntent.client_secret });
  } catch (err: any) {
    console.error('[billing/create-payment-intent]', err.message);
    return res.status(500).json({ error: err.message });
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

    const { error } = await admin
      .from('subscriptions')
      .update({ cancel_at_period_end: true })
      .eq('org_id', auth.orgId)
      .eq('status', 'active');

    if (error) {
      return res.status(500).json({ error: 'Failed to cancel subscription.' });
    }

    return res.json({ message: 'Subscription will be canceled at the end of the billing period.' });
  } catch (err: any) {
    console.error('[billing/cancel]', err.message);
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
      return res.status(404).json({ error: 'Invalid promo code.' });
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
    const { data: allUsers } = await admin.auth.admin.listUsers();
    const existingUser = allUsers?.users.find((u: any) => u.email === email) as any;
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

    // Create Stripe Checkout Session
    // SECURITY: Never store passwords in Stripe metadata
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: (currency || 'CAD').toLowerCase(),
          product_data: {
            name: `Lume ${plan.name} — ${interval === 'yearly' ? 'Annual' : 'Monthly'}`,
            description: (plan.features || []).slice(0, 3).join(', '),
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
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
    });

    return res.json({ url: session.url });
  } catch (err: any) {
    console.error('[billing/create-checkout-session]', err.message);
    return res.status(500).json({ error: err.message });
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
    return res.status(500).json({ error: err.message });
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
