import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../lib/validation';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';

const router = Router();

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
  promo_code: z.string().trim().optional(),
  referral_code: z.string().trim().optional(),
  // Billing info
  billing_email: z.string().trim().email().optional(),
  card_name: z.string().trim().optional(),
  company_name: z.string().trim().optional(),
  country: z.string().trim().optional(),
  postal_code: z.string().trim().optional(),
});

// ─── GET /billing/plans — List available plans ──────────────────

router.get('/billing/plans', async (req, res) => {
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

    // Get subscription
    const { data: sub } = await admin
      .from('subscriptions')
      .select('*, plans(*)')
      .eq('org_id', auth.orgId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get billing profile
    const { data: billing } = await admin
      .from('billing_profiles')
      .select('*')
      .eq('org_id', auth.orgId)
      .maybeSingle();

    return res.json({
      subscription: sub || null,
      billing_profile: billing || null,
    });
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

    // Update org info
    const { error: orgError } = await admin
      .from('orgs')
      .upsert({
        id: auth.orgId,
        name: company_name,
        owner_id: auth.user.id,
        phone,
        email,
        address,
        city,
        region,
        country: country || 'CA',
        postal_code,
        industry,
        company_size,
        currency,
      }, { onConflict: 'id' });

    if (orgError) {
      console.error('[billing/onboarding] org error:', orgError.message);
    }

    // Update billing profile
    const { error: billingError } = await admin
      .from('billing_profiles')
      .upsert({
        org_id: auth.orgId,
        billing_email: email,
        full_name,
        company_name,
        address,
        city,
        region,
        country: country || 'CA',
        postal_code,
        phone,
        currency,
      }, { onConflict: 'org_id' });

    if (billingError) {
      console.error('[billing/onboarding] billing error:', billingError.message);
      return res.status(500).json({ error: 'Failed to save billing profile.' });
    }

    // Update user profile
    await admin
      .from('profiles')
      .update({ full_name })
      .eq('id', auth.user.id);

    return res.json({ message: 'Onboarding data saved.' });
  } catch (err: any) {
    console.error('[billing/onboarding]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /billing/subscribe — Create subscription ──────────────

router.post('/billing/subscribe', validate(subscribeSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { plan_slug, interval, currency, promo_code, referral_code, billing_email, card_name, company_name, country, postal_code } = req.body;

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

    // Apply promo code if provided
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

          // Increment usage
          await admin
            .from('promo_codes')
            .update({ current_uses: promo.current_uses + 1 })
            .eq('id', promo.id);
        }
      }
    }

    // Calculate period
    const now = new Date();
    const periodEnd = new Date(now);
    if (interval === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    // Cancel any existing active subscription
    await admin
      .from('subscriptions')
      .update({ status: 'canceled', canceled_at: now.toISOString() })
      .eq('org_id', auth.orgId)
      .eq('status', 'active');

    // Create subscription
    const { data: subscription, error: subError } = await admin
      .from('subscriptions')
      .insert({
        org_id: auth.orgId,
        plan_id: plan.id,
        status: amountCents === 0 ? 'active' : 'active', // In production, would be 'incomplete' until payment
        interval,
        currency,
        amount_cents: amountCents,
        promo_code: appliedPromo,
        referral_code: referral_code || null,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
      })
      .select('*, plans(*)')
      .single();

    if (subError) {
      console.error('[billing/subscribe] error:', subError.message);
      return res.status(500).json({ error: 'Failed to create subscription.' });
    }

    // Update billing profile
    if (billing_email || company_name) {
      await admin
        .from('billing_profiles')
        .upsert({
          org_id: auth.orgId,
          billing_email: billing_email || undefined,
          company_name: company_name || undefined,
          country: country || undefined,
          postal_code: postal_code || undefined,
          currency,
        }, { onConflict: 'org_id' });
    }

    // If referral code used, update referral status
    if (referral_code) {
      await admin
        .from('referrals')
        .update({
          status: 'subscribed',
          referred_org_id: auth.orgId,
          referred_user_id: auth.user.id,
          converted_at: now.toISOString(),
        })
        .eq('code', referral_code)
        .eq('status', 'signed_up');

      // Notify Lume owner about referral conversion
      const resendApiKey = process.env.RESEND_API_KEY;
      const lumeOwnerEmail = process.env.LUME_OWNER_EMAIL || 'admin@lume.crm';
      if (resendApiKey) {
        try {
          const { Resend } = await import('resend');
          const resend = new Resend(resendApiKey);

          const { data: referral } = await admin
            .from('referrals')
            .select('*, referrer:profiles!referrer_user_id(full_name)')
            .eq('code', referral_code)
            .maybeSingle();

          await resend.emails.send({
            from: 'Lume CRM <noreply@lume.crm>',
            to: lumeOwnerEmail,
            subject: 'New referral conversion!',
            html: `
              <h2>Referral Conversion</h2>
              <p><strong>Referrer:</strong> ${(referral as any)?.referrer?.full_name || 'Unknown'}</p>
              <p><strong>Referred company:</strong> ${company_name || 'N/A'}</p>
              <p><strong>Plan:</strong> ${plan.name} (${interval})</p>
              <p><strong>Date:</strong> ${now.toISOString()}</p>
              <p><strong>Reward:</strong> $150 USD prepaid</p>
            `,
          });
        } catch {}
      }
    }

    return res.json({ subscription });
  } catch (err: any) {
    console.error('[billing/subscribe]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
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

export default router;
