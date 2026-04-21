import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import {
  getBadges,
  createBadge,
  getRepBadges,
  getActiveChallenges,
  createChallenge,
  joinChallenge,
  getActiveBattles,
  createBattle,
} from '../lib/field-sales/gamification-engine';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

// ── Badges ──────────────────────────────────────────────────────────────

// GET /api/gamification/badges
router.get('/gamification/badges', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const badges = await getBadges(sc, auth.orgId);
    res.json(badges);
  } catch (err: any) {
    return sendSafeError(res, err, 'Gamification operation failed.', '[gamification]');
  }
});

// POST /api/gamification/badges
router.post('/gamification/badges', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { slug, name_en, name_fr, description_en, description_fr, icon, color, category, criteria } = req.body;
  if (!slug || !name_en || !name_fr) {
    return res.status(400).json({ error: 'slug, name_en, and name_fr are required.' });
  }

  try {
    const sc = getServiceClient();
    const badge = await createBadge(sc, auth.orgId, {
      slug, name_en, name_fr, description_en, description_fr, icon, color, category, criteria,
    });
    res.json(badge);
  } catch (err: any) {
    return sendSafeError(res, err, 'Gamification operation failed.', '[gamification]');
  }
});

// GET /api/gamification/badges/rep/:userId
router.get('/gamification/badges/rep/:userId', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const badges = await getRepBadges(sc, auth.orgId, req.params.userId);
    res.json(badges);
  } catch (err: any) {
    return sendSafeError(res, err, 'Gamification operation failed.', '[gamification]');
  }
});

// ── Challenges ──────────────────────────────────────────────────────────

// GET /api/gamification/challenges
router.get('/gamification/challenges', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const challenges = await getActiveChallenges(sc, auth.orgId);
    res.json(challenges);
  } catch (err: any) {
    return sendSafeError(res, err, 'Gamification operation failed.', '[gamification]');
  }
});

// POST /api/gamification/challenges
router.post('/gamification/challenges', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { name_en, name_fr, description_en, description_fr, type, metric_slug, target_value, start_date, end_date, prize_description } = req.body;
  if (!name_en || !name_fr || !type || !metric_slug || !start_date || !end_date) {
    return res.status(400).json({ error: 'name_en, name_fr, type, metric_slug, start_date, and end_date are required.' });
  }

  try {
    const sc = getServiceClient();
    const challenge = await createChallenge(sc, auth.orgId, {
      created_by: auth.user.id,
      name_en, name_fr, description_en, description_fr,
      type, metric_slug, target_value, start_date, end_date, prize_description,
    });
    res.json(challenge);
  } catch (err: any) {
    return sendSafeError(res, err, 'Gamification operation failed.', '[gamification]');
  }
});

// POST /api/gamification/challenges/:id/join
router.post('/gamification/challenges/:id/join', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const participant = await joinChallenge(sc, req.params.id, auth.user.id);
    res.json(participant);
  } catch (err: any) {
    return sendSafeError(res, err, 'Gamification operation failed.', '[gamification]');
  }
});

// ── Battles ─────────────────────────────────────────────────────────────

// GET /api/gamification/battles
router.get('/gamification/battles', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const battles = await getActiveBattles(sc, auth.orgId);
    res.json(battles);
  } catch (err: any) {
    return sendSafeError(res, err, 'Gamification operation failed.', '[gamification]');
  }
});

// POST /api/gamification/battles
router.post('/gamification/battles', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { name, type, metric_slug, challenger_user_id, opponent_user_id, start_date, end_date, prize_description } = req.body;
  if (!name || !type || !metric_slug || !start_date || !end_date) {
    return res.status(400).json({ error: 'name, type, metric_slug, start_date, and end_date are required.' });
  }

  try {
    const sc = getServiceClient();
    const battle = await createBattle(sc, auth.orgId, {
      created_by: auth.user.id,
      name, type, metric_slug,
      challenger_user_id: challenger_user_id || auth.user.id,
      opponent_user_id, start_date, end_date, prize_description,
    });
    res.json(battle);
  } catch (err: any) {
    return sendSafeError(res, err, 'Gamification operation failed.', '[gamification]');
  }
});

// ── Social Feed ─────────────────────────────────────────────────────────

export default router;
