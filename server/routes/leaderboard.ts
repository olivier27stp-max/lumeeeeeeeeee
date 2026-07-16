import { Router } from 'express';
import { requireAuthedClient, getServiceClient, isOrgMember, isOrgAdminOrOwner } from '../lib/supabase';
import { ORG_UUID_RE, shouldUseRequestedOrg, leaderboardOrgIds } from '../lib/active-org';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { getLeaderboard, getRepPerformance, calculateRepStats, periodRange, type DateWindow } from '../lib/field-sales/leaderboard-engine';
import { endOfDay, startOfDay } from 'date-fns';
import { getRepBadges } from '../lib/field-sales/gamification-engine';
import { cached } from '../lib/cache';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

/**
 * Résout l'office "actif" pour cette requête. Le serveur ne connaît que la
 * première membership via current_org_id(), donc le client transmet l'office
 * réellement sélectionné (?orgId=...). On ne l'honore QUE si l'utilisateur en
 * est bien membre (anti-IDOR), sinon on retombe sur auth.orgId.
 */
async function resolveActiveOrgId(
  auth: NonNullable<Awaited<ReturnType<typeof requireAuthedClient>>>,
  req: any
): Promise<string> {
  const requested = (req.query.orgId as string) || '';
  if (ORG_UUID_RE.test(requested) && requested !== auth.orgId) {
    const member = await isOrgMember(auth.client, auth.user.id, requested);
    if (shouldUseRequestedOrg(requested, member)) return requested;
  }
  return auth.orgId;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fenêtre de dates de la requête : soit une plage explicite ?from=&to=
 * (YYYY-MM-DD, bornes inversées tolérées), soit le period legacy
 * daily|weekly|monthly. Renvoie aussi une clé stable pour le cache.
 */
function resolveWindow(req: any): { window: DateWindow; key: string } | null {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  if (from && to && DATE_ONLY_RE.test(from) && DATE_ONLY_RE.test(to)) {
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    return {
      window: {
        start: startOfDay(new Date(`${lo}T00:00:00`)).toISOString(),
        end: endOfDay(new Date(`${hi}T00:00:00`)).toISOString(),
      },
      key: `${lo}_${hi}`,
    };
  }

  const period = (req.query.period as string) || 'daily';
  if (!['daily', 'weekly', 'monthly'].includes(period)) return null;
  return { window: periodRange(period as 'daily' | 'weekly' | 'monthly'), key: period };
}

// GET /api/leaderboard?from=YYYY-MM-DD&to=YYYY-MM-DD (ou ?period=daily|weekly|monthly)
//   &teamId=...&scope=mine|all&orgId=...&experience=...
router.get('/leaderboard', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const resolvedWindow = resolveWindow(req);
  if (!resolvedWindow) {
    return res.status(400).json({ error: 'Invalid period. Use from/to dates or daily, weekly, monthly.' });
  }
  const { window, key: windowKey } = resolvedWindow;

  const teamId = req.query.teamId as string | undefined;
  const experienceRaw = req.query.experience as string | undefined;
  const experience = experienceRaw === 'rookie' || experienceRaw === 'experienced' ? experienceRaw : undefined;
  // 'mine' = uniquement l'office actif ; 'all' = tous les offices de la
  // compagnie (company_group_id). Défaut prudent : 'all' (comportement legacy).
  const scope = (req.query.scope as string) === 'mine' ? 'mine' : 'all';

  try {
    const sc = getServiceClient();
    const activeOrgId = await resolveActiveOrgId(auth, req);

    // Un "office" = un org. En scope 'all' le leaderboard mélange tous les
    // offices de la même compagnie pour créer l'esprit de compétition ; en
    // scope 'mine' on se limite à l'office actif.
    let orgIds: string[];
    let cacheKey: string;
    if (scope === 'mine') {
      orgIds = leaderboardOrgIds('mine', activeOrgId, []);
      cacheKey = `leaderboard:mine:${activeOrgId}:${windowKey}:${teamId || 'all'}:${experience || 'all'}`;
    } else {
      const resolved = await resolveCompanyOrgIds(sc, activeOrgId);
      orgIds = leaderboardOrgIds('all', activeOrgId, resolved.orgIds);
      cacheKey = `leaderboard:all:${resolved.groupId}:${windowKey}:${teamId || 'all'}:${experience || 'all'}`;
    }

    const entries = await cached(cacheKey, 45, () =>
      getLeaderboard(sc, orgIds, window, teamId, experience)
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

// GET /api/leaderboard/offices — the offices (orgs) of the caller's company.
// An "office" = an org; siblings share a company_group_id.
router.get('/leaderboard/offices', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const { orgIds } = await resolveCompanyOrgIds(sc, auth.orgId);
    const { data, error } = await sc
      .from('orgs')
      .select('id, name')
      .in('id', orgIds)
      .order('name');
    if (error) throw error;
    res.json({ offices: data || [], activeOrgId: auth.orgId });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/leaderboard/rep/:userId/experience — admin tags a rep rookie/experienced.
// Body: { experience_level: 'rookie' | 'experienced' | null }
router.patch('/leaderboard/rep/:userId/experience', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId);
  if (!canManage) return res.status(403).json({ error: 'Only owner/admin can classify reps.' });

  const level = req.body?.experience_level;
  if (level !== null && level !== 'rookie' && level !== 'experienced') {
    return res.status(400).json({ error: 'experience_level must be rookie, experienced, or null.' });
  }

  try {
    const sc = getServiceClient();
    // Scope the update to reps in the admin's company (all offices).
    const { orgIds } = await resolveCompanyOrgIds(sc, auth.orgId);
    const { error } = await sc
      .from('memberships')
      .update({ experience_level: level })
      .eq('user_id', req.params.userId)
      .in('org_id', orgIds);
    if (error) throw error;
    res.json({ ok: true, experience_level: level });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
