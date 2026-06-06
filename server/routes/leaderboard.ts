import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { getLeaderboard, getRepPerformance, calculateRepStats } from '../lib/field-sales/leaderboard-engine';
import { getRepBadges } from '../lib/field-sales/gamification-engine';
import { cached } from '../lib/cache';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

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

    // Un "office" = un org. Le leaderboard mélange tous les offices de la
    // même compagnie (company_group_id) pour créer l'esprit de compétition.
    const { orgIds, groupId } = await resolveCompanyOrgIds(sc, auth.orgId);

    const cacheKey = `leaderboard:group:${groupId}:${period}:${teamId || 'all'}`;
    const entries = await cached(cacheKey, 45, () =>
      getLeaderboard(sc, orgIds, period as 'daily' | 'weekly' | 'monthly', undefined, teamId)
    );
    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Résout l'ensemble des org_id appartenant à la même compagnie que `orgId`
 * (offices partageant le même company_group_id). Renvoie le groupe et la
 * liste d'orgs. Fallback sur l'org seul si aucun groupe.
 */
async function resolveCompanyOrgIds(
  sc: ReturnType<typeof getServiceClient>,
  orgId: string
): Promise<{ orgIds: string[]; groupId: string }> {
  const { data: org } = await sc
    .from('orgs')
    .select('company_group_id')
    .eq('id', orgId)
    .maybeSingle();

  const groupId = org?.company_group_id as string | undefined;
  if (!groupId) return { orgIds: [orgId], groupId: orgId };

  const { data: siblings } = await sc
    .from('orgs')
    .select('id')
    .eq('company_group_id', groupId);

  const orgIds = (siblings || []).map((o: any) => o.id);
  return { orgIds: orgIds.length > 0 ? orgIds : [orgId], groupId };
}

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
    // Le leaderboard mélange les offices d'une compagnie : un rep cliqué peut
    // appartenir à un autre office. On résout le groupe pour ses stats.
    const { orgIds, groupId } = await resolveCompanyOrgIds(sc, auth.orgId);
    const cacheKey = `rep-perf:group:${groupId}:${userId}:${from}:${to}`;
    const payload = await cached(cacheKey, 60, async () => {
      const [performance, badges] = await Promise.all([
        getRepPerformance(sc, orgIds, userId, { from, to }),
        getRepBadges(sc, auth.orgId, userId),
      ]);
      return { performance, badges };
    });
    res.json(payload);
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
    const { orgIds } = await resolveCompanyOrgIds(sc, auth.orgId);
    const stats = await calculateRepStats(sc, orgIds, req.params.userId);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
