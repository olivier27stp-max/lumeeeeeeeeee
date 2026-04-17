import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import {
  getBadges,
  createBadge,
  getRepBadges,
  getActiveChallenges,
  createChallenge,
  joinChallenge,
  getActiveBattles,
  createBattle,
  getFeed,
  createFeedPost,
  addReaction,
  removeReaction,
  addComment,
} from '../lib/field-sales/gamification-engine';

const router = Router();

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

// GET /api/gamification/feed?visibility=company&teamId=...&cursor=...
router.get('/gamification/feed', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const visibility = req.query.visibility as string | undefined;
  const teamId = req.query.teamId as string | undefined;
  const cursor = req.query.cursor as string | undefined;

  try {
    const sc = getServiceClient();
    const posts = await getFeed(sc, auth.orgId, {
      visibility,
      teamId,
      cursor,
      userId: auth.user.id,
    });
    res.json(posts);
  } catch (err: any) {
    return sendSafeError(res, err, 'Gamification operation failed.', '[gamification]');
  }
});

// POST /api/gamification/feed
router.post('/gamification/feed', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { type, visibility, team_id, title, body, image_url } = req.body;

  try {
    const sc = getServiceClient();
    const post = await createFeedPost(sc, auth.orgId, {
      user_id: auth.user.id,
      type: type || 'manual',
      visibility: visibility || 'company',
      team_id: team_id || null,
      title, body, image_url,
    });
    res.json(post);
  } catch (err: any) {
    return sendSafeError(res, err, 'Gamification operation failed.', '[gamification]');
  }
});

// POST /api/gamification/feed/:id/react
router.post('/gamification/feed/:id/react', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { emoji } = req.body;
  if (!emoji || !['fire', 'clap', 'trophy', 'heart'].includes(emoji)) {
    return res.status(400).json({ error: 'emoji must be one of: fire, clap, trophy, heart' });
  }

  try {
    const sc = getServiceClient();
    const reaction = await addReaction(sc, req.params.id, auth.user.id, emoji);
    res.json(reaction);
  } catch (err: any) {
    return sendSafeError(res, err, 'Gamification operation failed.', '[gamification]');
  }
});

// DELETE /api/gamification/feed/:id/react
router.delete('/gamification/feed/:id/react', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    await removeReaction(sc, req.params.id, auth.user.id);
    res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Gamification operation failed.', '[gamification]');
  }
});

// POST /api/gamification/feed/:id/comment
router.post('/gamification/feed/:id/comment', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { body } = req.body;
  if (!body) {
    return res.status(400).json({ error: 'body is required.' });
  }

  try {
    const sc = getServiceClient();
    const comment = await addComment(sc, req.params.id, auth.user.id, body);
    res.json(comment);
  } catch (err: any) {
    return sendSafeError(res, err, 'Gamification operation failed.', '[gamification]');
  }
});

export default router;
