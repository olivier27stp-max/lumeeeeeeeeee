import { Router } from 'express';
import crypto from 'crypto';
import Stripe from 'stripe';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { getBaseUrl, platformOwnerId } from '../lib/config';

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// ── Programme de parrainage: désactivé pour le public ──
// La récompense du parrain est un crédit Stripe qui n'a pas encore été validé
// par un vrai paiement de bout en bout. Tant que ce n'est pas prouvé, on ne
// distribue pas de codes: un code partagé promet un mois gratuit qu'on ne sait
// pas encore livrer. Le propriétaire de la plateforme garde l'accès pour tester.
// Pour rouvrir sans redéployer: REFERRALS_ENABLED=true sur Railway.
const referralsPubliclyEnabled = process.env.REFERRALS_ENABLED === 'true';

/** True si l'appelant peut utiliser le programme (public activé, ou propriétaire). */
function referralsAllowedFor(userId: string): boolean {
  return referralsPubliclyEnabled || (!!platformOwnerId && userId === platformOwnerId);
}

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

// ─── GET /referrals/me — Get or create user's referral code ─────

router.get('/referrals/me', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    if (!referralsAllowedFor(auth.user.id)) {
      return res.status(404).json({ error: 'Not found.' });
    }

    const admin = getServiceClient();

    // Gate: only orgs on a paid plan can refer. We gate on the PLAN tier, not
    // the subscription's amount_cents — comped/trial rows can have amount 0 but
    // still be a real paid-tier plan. Any active sub on a non-starter plan
    // (a plan whose own price is > 0) qualifies.
    const { data: activeSub } = await admin
      .from('subscriptions')
      .select('id, plan_id')
      .eq('org_id', auth.orgId)
      .in('status', ['active', 'trialing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let onPaidPlan = false;
    if (activeSub?.plan_id) {
      const { data: planRow } = await admin
        .from('plans')
        .select('slug, monthly_price_usd, monthly_price_cad')
        .eq('id', activeSub.plan_id)
        .maybeSingle();
      onPaidPlan = !!planRow && planRow.slug !== 'starter' &&
        ((planRow.monthly_price_usd || 0) > 0 || (planRow.monthly_price_cad || 0) > 0);
    }

    if (!onPaidPlan) {
      return res.status(403).json({
        error: 'referral_requires_paid_plan',
        message: 'Upgrade to a paid plan to unlock your referral link and earn free months.',
      });
    }

    // Check if user already has a referral code
    const { data: existing } = await admin
      .from('referrals')
      .select('code')
      .eq('referrer_user_id', auth.user.id)
      .eq('referrer_org_id', auth.orgId)
      .eq('referred_email', '') // The "template" row
      .maybeSingle();

    let code: string;

    if (existing?.code) {
      code = existing.code;
    } else {
      // Generate a unique referral code
      code = `LUME-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

      const { error } = await admin
        .from('referrals')
        .insert({
          referrer_user_id: auth.user.id,
          referrer_org_id: auth.orgId,
          code,
          referred_email: '',
          status: 'invited',
        });

      if (error) {
        console.error('[referrals/me] create error:', error.message);
        return res.status(500).json({ error: 'Failed to create referral code.' });
      }
    }

    // Make sure this referrer has a Stripe customer BEFORE anyone uses their
    // code. The reward is a Stripe balance credit, so an org without a customer
    // could not be paid. Doing it here (rather than only at credit time) means
    // every org that owns a live code is creditable. Non-blocking: the link is
    // still returned if Stripe is down — the credit path re-attempts this.
    try {
      const { ensureStripeCustomerForOrg } = await import('../lib/referral-rewards');
      await ensureStripeCustomerForOrg(admin, stripe, auth.orgId);
    } catch (err: any) {
      console.error('[referrals/me] ensure Stripe customer failed:', err?.message);
    }

    const baseUrl = getBaseUrl();
    // Point at the public pricing page — the real funnel is Book a Demo, not
    // self-serve checkout. BookDemoForm reads ?ref= (sessionStorage 'lume_ref')
    // and includes the code in the demo request email, so sales can put it in
    // the Stripe Payment Link's metadata. /checkout is a legacy dead end.
    const referralLink = `${baseUrl}/pricing?ref=${code}`;

    return res.json({ code, referral_link: referralLink });
  } catch (err: any) {
    console.error('[referrals/me]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /referrals/history — Get referral history ──────────────

router.get('/referrals/history', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    if (!referralsAllowedFor(auth.user.id)) {
      return res.status(404).json({ error: 'Not found.' });
    }

    const admin = getServiceClient();

    const { data: referrals, error } = await admin
      .from('referrals')
      .select('*')
      .eq('referrer_user_id', auth.user.id)
      .eq('referrer_org_id', auth.orgId)
      .neq('referred_email', '')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[referrals/history]', error.message);
      return res.status(500).json({ error: 'Failed to load referral history.' });
    }

    // Stats. Reward = 1 free month per converted (rewarded) referral.
    const total = (referrals || []).length;
    const converted = (referrals || []).filter((r: any) => ['subscribed', 'reward_pending', 'rewarded'].includes(r.status)).length;
    const pending = (referrals || []).filter((r: any) => ['invited', 'signed_up'].includes(r.status)).length;
    const freeMonths = (referrals || []).filter((r: any) => r.status === 'rewarded').length;

    return res.json({
      referrals: referrals || [],
      stats: {
        total,
        converted,
        pending,
        free_months_earned: freeMonths,
      },
    });
  } catch (err: any) {
    console.error('[referrals/history]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /referrals/track — Track a referral link click ────────

router.post('/referrals/track', async (req, res) => {
  try {
    // Route publique: fermée tant que le programme n'est pas activé, sinon un
    // lien déjà partagé continuerait d'enregistrer des parrainages qu'on ne
    // récompenserait pas.
    if (!referralsPubliclyEnabled) return res.status(404).json({ error: 'Not found.' });

    const { code, email } = req.body;
    if (!code) return res.status(400).json({ error: 'Referral code is required.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email format.' });

    const admin = getServiceClient();

    // Verify the referral code exists
    const { data: referral } = await admin
      .from('referrals')
      .select('referrer_user_id, referrer_org_id, code')
      .eq('code', code)
      .limit(1)
      .maybeSingle();

    if (!referral) {
      return res.status(404).json({ error: 'Invalid referral code.' });
    }

    // If email provided, create a tracked referral entry
    if (email) {
      const { data: existingTracked } = await admin
        .from('referrals')
        .select('id')
        .eq('code', code)
        .eq('referred_email', email.toLowerCase())
        .maybeSingle();

      if (!existingTracked) {
        await admin.from('referrals').insert({
          referrer_user_id: referral.referrer_user_id,
          referrer_org_id: referral.referrer_org_id,
          code,
          referred_email: email.toLowerCase(),
          status: 'signed_up',
        });
      }
    }

    return res.json({ valid: true, code });
  } catch (err: any) {
    console.error('[referrals/track]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /referrals/validate/:code — Validate referral code ─────

router.get('/referrals/validate/:code', async (req, res) => {
  try {
    // Fermée avec le reste du programme: un code ne doit pas se déclarer
    // "valide" à un visiteur si aucune récompense ne sera versée.
    if (!referralsPubliclyEnabled) return res.status(404).json({ valid: false, error: 'Not found.' });

    const { code } = req.params;
    const admin = getServiceClient();

    const { data: referral } = await admin
      .from('referrals')
      .select('code, referrer_user_id')
      .eq('code', code)
      .limit(1)
      .maybeSingle();

    if (!referral) {
      return res.status(404).json({ valid: false, error: 'Invalid referral code.' });
    }

    return res.json({ valid: true, code: referral.code });
  } catch (err: any) {
    console.error('[referrals/validate]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
