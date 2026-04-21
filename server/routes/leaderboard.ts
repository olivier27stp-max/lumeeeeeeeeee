import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { getLeaderboard, getRepPerformance, calculateRepStats } from '../lib/field-sales/leaderboard-engine';
import { getRepBadges } from '../lib/field-sales/gamification-engine';

const router = Router();

// GET /api/leaderboard?period=daily|weekly|monthly&teamId=...
router.get('/leaderboard', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const period = (req.query.period as string) || 'daily';
  if (!['daily', 'weekly', 'monthly'].includes(period)) {
    return res.status(400).json({ error: 'Invalid period. Use daily, weekly, or monthly.' });
  }

  const teamId = req.query.teamId as string | undefined;

  try {
    const sc = getServiceClient();
    const entries = await getLeaderboard(sc, auth.orgId, period as 'daily' | 'weekly' | 'monthly', undefined, teamId);
    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/leaderboard/rep/:userId?from=...&to=...
router.get('/leaderboard/rep/:userId', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { userId } = req.params;
  const from = req.query.from as string;
  const to = req.query.to as string;

  if (!from || !to) {
    return res.status(400).json({ error: 'from and to query parameters are required.' });
  }

  try {
    const sc = getServiceClient();
    const [performance, badges] = await Promise.all([
      getRepPerformance(sc, auth.orgId, userId, { from, to }),
      getRepBadges(sc, auth.orgId, userId),
    ]);
    res.json({ performance, badges });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/leaderboard/realtime/:userId — live stats from today's events
router.get('/leaderboard/realtime/:userId', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const stats = await calculateRepStats(sc, auth.orgId, req.params.userId);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
