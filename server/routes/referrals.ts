import { Router } from 'express';
import crypto from 'crypto';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { getBaseUrl } from '../lib/config';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

// ─── GET /referrals/me — Get or create user's referral code ─────

router.get('/referrals/me', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();

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

    const baseUrl = getBaseUrl();
    const referralLink = `${baseUrl}/signup?ref=${code}`;

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

    // Stats
    const total = (referrals || []).length;
    const converted = (referrals || []).filter((r: any) => ['subscribed', 'reward_pending', 'rewarded'].includes(r.status)).length;
    const pending = (referrals || []).filter((r: any) => ['invited', 'signed_up'].includes(r.status)).length;
    const totalRewards = converted * 15000; // $150 USD in cents

    return res.json({
      referrals: referrals || [],
      stats: {
        total,
        converted,
        pending,
        total_rewards_cents: totalRewards,
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
