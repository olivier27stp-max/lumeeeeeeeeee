/**
 * LUME CRM — Platform Admin Routes (v2)
 * ========================================
 * Founder control center: SaaS-focused metrics.
 * Tabs: Business, Operations, Users, Billing
 *
 * Every route checks PLATFORM_OWNER_ID.
 * All queries use getServiceClient() (service_role — bypasses RLS).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { platformOwnerId } from '../lib/config';

const router = Router();

// ─── Auth guard ─────────────────────────────────────────────────

async function requirePlatformOwner(req: Request, res: Response) {
  if (!platformOwnerId) { res.status(503).json({ error: 'Platform admin not configured.' }); return null; }
  const auth = await requireAuthedClient(req, res);
  if (!auth) return null;
  if (auth.user.id !== platformOwnerId) { res.status(403).json({ error: 'Forbidden.' }); return null; }
  return auth;
}

// ─── GET /platform-admin/check ──────────────────────────────────

router.get('/platform-admin/check', async (req, res) => {
  try {
    if (!platformOwnerId) return res.json({ isPlatformOwner: false });
    const authHeader = req.header('authorization');
    if (!authHeader) return res.json({ isPlatformOwner: false });
    const { buildSupabaseWithAuth } = await import('../lib/supabase');
    const client = buildSupabaseWithAuth(authHeader);
    const { data: { user } } = await client.auth.getUser();
    return res.json({ isPlatformOwner: user?.id === platformOwnerId });
  } catch { return res.json({ isPlatformOwner: false }); }
});

// ═══════════════════════════════════════════════════════════════
// TAB: BUSINESS — MRR, subscriptions, growth, revenue
// ═══════════════════════════════════════════════════════════════

router.get('/platform-admin/business', async (req, res) => {
  try {
    if (!await requirePlatformOwner(req, res)) return;
    const admin = getServiceClient();

    const now = new Date();
    const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date(now); sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const [
      orgsResult,
      orgs30dResult,
      subsAllResult,
      canceledResult,
      new30dSubsResult,
      // Subscriptions active in last 30d (for platform revenue based on subscription billing)
      subsActive30dResult,
      subsActivePrev30dResult,
    ] = await Promise.all([
      admin.from('orgs').select('id', { count: 'exact', head: true }),
      admin.from('orgs').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo.toISOString()),
      // All subscriptions (not just active) for breakdown
      admin.from('subscriptions').select('id, org_id, plan_id, status, interval, amount_cents, current_period_end, trial_end, canceled_at, created_at, plans(slug, name)'),
      // Canceled in last 30d
      admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'canceled').gte('canceled_at', thirtyDaysAgo.toISOString()),
      // New subscriptions in last 30d
      admin.from('subscriptions').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo.toISOString()),
      // Active subscriptions with period starting in last 30d (platform revenue)
      admin.from('subscriptions').select('amount_cents, interval, status, current_period_start, created_at').in('status', ['active', 'trialing']),
      // For growth comparison: subscriptions that were active 30-60 days ago
      admin.from('subscriptions').select('amount_cents, interval, status, created_at, canceled_at').or(`status.in.(active,trialing),and(status.eq.canceled,canceled_at.gte.${thirtyDaysAgo.toISOString()})`),
    ]);

    // Gracefully handle missing subscription columns (migration may not be applied yet)
    if (subsAllResult.error) console.warn('[platform-admin/business] subscriptions query error:', subsAllResult.error.message);
    const allSubs = subsAllResult.data || [];
    const activeSubs = allSubs.filter((s: any) => s.status === 'active' || s.status === 'trialing');

    // Calculate MRR from active subscriptions
    let mrrCents = 0;
    for (const s of activeSubs) {
      const monthly = s.interval === 'yearly' ? Math.round((s.amount_cents || 0) / 12) : (s.amount_cents || 0);
      mrrCents += monthly;
    }

    // ARPU (per paying workspace)
    const payingCount = activeSubs.filter((s: any) => (s.amount_cents || 0) > 0).length;
    const arpuCents = payingCount > 0 ? Math.round(mrrCents / payingCount) : 0;

    // Platform revenue (based on subscriptions, not client payments)
    // Revenue 30d = MRR from currently active subscriptions (what the platform earns this month)
    const revenue30d = mrrCents;
    // Previous 30d: estimate from subscriptions that existed 30-60 days ago
    // Use subs that are currently active OR were canceled after 30 days ago (they were active in prev period)
    let prevMrrCents = 0;
    for (const s of subsActivePrev30dResult.data || []) {
      // Only count subs that existed before 30 days ago
      if (new Date(s.created_at) > thirtyDaysAgo) continue;
      const monthly = s.interval === 'yearly' ? Math.round((s.amount_cents || 0) / 12) : (s.amount_cents || 0);
      prevMrrCents += monthly;
    }
    const revenuePrev30d = prevMrrCents;
    const revenueGrowthPct = revenuePrev30d > 0 ? Math.round(((revenue30d - revenuePrev30d) / revenuePrev30d) * 100) : null;

    // Plan breakdown
    const byPlan = new Map<string, { name: string; slug: string; active: number; trialing: number; mrr_cents: number }>();
    for (const s of allSubs) {
      const plan = (s as any).plans;
      const key = plan?.slug || 'unknown';
      const ex = byPlan.get(key) || { name: plan?.name || 'Unknown', slug: key, active: 0, trialing: 0, mrr_cents: 0 };
      if (s.status === 'active') ex.active++;
      if (s.status === 'trialing') ex.trialing++;
      if (s.status === 'active' || s.status === 'trialing') {
        ex.mrr_cents += s.interval === 'yearly' ? Math.round((s.amount_cents || 0) / 12) : (s.amount_cents || 0);
      }
      byPlan.set(key, ex);
    }

    return res.json({
      totalOrgs: orgsResult.count || 0,
      newOrgs30d: orgs30dResult.count || 0,
      mrrCents,
      arpuCents,
      activeSubscriptions: activeSubs.length,
      newSubscriptions30d: new30dSubsResult.count || 0,
      canceled30d: canceledResult.count || 0,
      revenue30dCents: revenue30d,
      revenueGrowthPct,
      planBreakdown: Array.from(byPlan.values()).sort((a, b) => b.mrr_cents - a.mrr_cents),
    });
  } catch (err: any) {
    console.error('[platform-admin/business]', err.message);
    return res.status(500).json({ error: 'Failed to load business metrics.' });
  }
});

// Revenue time series — based on subscription MRR over time
router.get('/platform-admin/revenue-series', async (req, res) => {
  try {
    if (!await requirePlatformOwner(req, res)) return;
    const admin = getServiceClient();
    const days = Math.min(365, Math.max(7, parseInt(req.query.days as string) || 30));
    const since = new Date(); since.setDate(since.getDate() - days);

    // Fetch all subscriptions (active, trialing, canceled) created before end of period
    const { data: subs, error } = await admin.from('subscriptions')
      .select('amount_cents, interval, status, created_at, canceled_at')
      .lte('created_at', new Date().toISOString());
    if (error) {
      // Subscriptions table may not have expected columns yet — return empty series
      console.warn('[platform-admin/revenue-series] subscriptions query failed:', error.message);
      const byDay = new Map<string, number>();
      for (let i = 0; i < days; i++) {
        const d = new Date(); d.setDate(d.getDate() - (days - 1 - i));
        byDay.set(d.toISOString().slice(0, 10), 0);
      }
      return res.json({ series: Array.from(byDay.entries()).map(([date, cents]) => ({ date, revenue_cents: cents })) });
    }

    // For each day, calculate what the MRR was at that point
    const byDay = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(); d.setDate(d.getDate() - (days - 1 - i));
      const dayStr = d.toISOString().slice(0, 10);
      const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999);

      // MRR at this day = sum of subscriptions that were active on this day
      let dayMrr = 0;
      for (const s of subs || []) {
        const createdAt = new Date(s.created_at);
        if (createdAt > dayEnd) continue; // Not created yet
        // If canceled before this day, skip
        if (s.canceled_at && new Date(s.canceled_at) < d) continue;
        const monthly = s.interval === 'yearly' ? Math.round((s.amount_cents || 0) / 12) : (s.amount_cents || 0);
        dayMrr += monthly;
      }
      byDay.set(dayStr, dayMrr);
    }

    return res.json({ series: Array.from(byDay.entries()).map(([date, cents]) => ({ date, revenue_cents: cents })) });
  } catch (err: any) {
    console.error('[platform-admin/revenue-series]', err.message);
    return res.status(500).json({ error: 'Failed to load revenue series.' });
  }
});

// Growth series (orgs + users by month)
router.get('/platform-admin/growth-series', async (req, res) => {
  try {
    if (!await requirePlatformOwner(req, res)) return;
    const admin = getServiceClient();
    const [orgsR, membR] = await Promise.all([
      admin.from('orgs').select('created_at').order('created_at', { ascending: true }),
      admin.from('memberships').select('created_at').order('created_at', { ascending: true }),
    ]);
    const group = (rows: any[]) => {
      const m = new Map<string, number>();
      for (const r of rows || []) { if (r.created_at) { const k = new Date(r.created_at).toISOString().slice(0, 7); m.set(k, (m.get(k) || 0) + 1); } }
      return m;
    };
    const orgM = group(orgsR.data || []), userM = group(membR.data || []);
    const all = new Set([...orgM.keys(), ...userM.keys()]);
    return res.json({ series: Array.from(all).sort().map(m => ({ month: m, new_orgs: orgM.get(m) || 0, new_users: userM.get(m) || 0 })) });
  } catch (err: any) {
    console.error('[platform-admin/growth-series]', err.message);
    return res.status(500).json({ error: 'Failed to load growth series.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// TAB: OPERATIONS — alerts, failed payments, inactive workspaces
// ═══════════════════════════════════════════════════════════════

router.get('/platform-admin/operations', async (req, res) => {
  try {
    if (!await requirePlatformOwner(req, res)) return;
    const admin = getServiceClient();

    const now = new Date();
    const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sevenDaysFromNow = new Date(now); sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const [
      failedPaymentsResult,
      pastDueSubsResult,
      trialEndingSoonResult,
      webhookErrorsResult,
      allOrgsResult,
    ] = await Promise.all([
      // Failed payments (last 30d)
      admin.from('payments').select('id, org_id, amount_cents, currency, failure_reason, created_at')
        .is('deleted_at', null).eq('status', 'failed').gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: false }).limit(20),
      // Past due subscriptions
      admin.from('subscriptions').select('id, org_id, amount_cents, interval, status, current_period_end, plans(slug, name)')
        .eq('status', 'past_due'),
      // Trials ending in next 7 days
      admin.from('subscriptions').select('id, org_id, amount_cents, trial_end, status, plans(slug, name)')
        .eq('status', 'trialing').lte('trial_end', sevenDaysFromNow.toISOString()).gte('trial_end', now.toISOString()),
      // Webhook errors (7d)
      admin.from('webhook_events').select('id, provider, event_type, error_message, created_at')
        .eq('status', 'failed').gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false }).limit(10),
      // All orgs for inactive check
      admin.from('orgs').select('id, name, created_at, updated_at'),
    ]);

    // Inactive orgs: no jobs or logins in 30 days
    const orgIds = (allOrgsResult.data || []).map((o: any) => o.id);
    let inactiveOrgs: any[] = [];
    if (orgIds.length > 0) {
      const { data: recentJobs } = await admin.from('jobs').select('org_id')
        .is('deleted_at', null).gte('created_at', thirtyDaysAgo.toISOString()).in('org_id', orgIds);
      const activeOrgIds = new Set((recentJobs || []).map((j: any) => j.org_id));
      inactiveOrgs = (allOrgsResult.data || [])
        .filter((o: any) => !activeOrgIds.has(o.id))
        .map((o: any) => ({ id: o.id, name: o.name, created_at: o.created_at }));
    }

    // Enrich failed payments and subscriptions with org names
    const orgNameMap = new Map<string, string>();
    for (const o of allOrgsResult.data || []) orgNameMap.set(o.id, o.name);

    const enrichOrg = (item: any) => ({ ...item, org_name: orgNameMap.get(item.org_id) || 'Unknown' });

    // Calculate health status
    const failedCount = (failedPaymentsResult.data || []).length;
    const pastDueCount = (pastDueSubsResult.data || []).length;
    const webhookCount = (webhookErrorsResult.data || []).length;
    let healthStatus: 'healthy' | 'attention' | 'critical' = 'healthy';
    if (failedCount > 0 || pastDueCount > 0 || webhookCount > 3) healthStatus = 'attention';
    if (failedCount > 5 || pastDueCount > 3) healthStatus = 'critical';

    return res.json({
      healthStatus,
      failedPayments: (failedPaymentsResult.data || []).map(enrichOrg),
      pastDueSubscriptions: (pastDueSubsResult.data || []).map(enrichOrg),
      trialsEndingSoon: (trialEndingSoonResult.data || []).map(enrichOrg),
      webhookErrors: webhookErrorsResult.data || [],
      inactiveOrgs,
      counts: {
        failed_payments: failedCount,
        past_due: pastDueCount,
        trials_ending: (trialEndingSoonResult.data || []).length,
        inactive_orgs: inactiveOrgs.length,
        webhook_errors: webhookCount,
      },
    });
  } catch (err: any) {
    console.error('[platform-admin/operations]', err.message);
    return res.status(500).json({ error: 'Failed to load operations.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// TAB: USERS — workspace engagement, active/inactive, activity
// ═══════════════════════════════════════════════════════════════

router.get('/platform-admin/users', async (req, res) => {
  try {
    if (!await requirePlatformOwner(req, res)) return;
    const admin = getServiceClient();

    const now = new Date();
    const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalUsersResult,
      totalOrgsResult,
      membershipsResult,
      recentJobsResult,
      recentLoginsResult,
    ] = await Promise.all([
      admin.from('memberships').select('user_id', { count: 'exact', head: true }),
      admin.from('orgs').select('id, name, created_at'),
      admin.from('memberships').select('org_id'),
      // Recent activity by org (jobs created in last 30d)
      admin.from('jobs').select('org_id, created_at').is('deleted_at', null).gte('created_at', thirtyDaysAgo.toISOString()),
      // Recent logins by org (last 30d)
      admin.from('login_history').select('org_id, created_at').gte('created_at', thirtyDaysAgo.toISOString()),
    ]);

    const orgs = totalOrgsResult.data || [];
    const orgNameMap = new Map<string, string>();
    const orgCreatedMap = new Map<string, string>();
    for (const o of orgs) { orgNameMap.set(o.id, o.name); orgCreatedMap.set(o.id, o.created_at); }

    // Member count per org
    const membersByOrg = new Map<string, number>();
    for (const m of membershipsResult.data || []) {
      membersByOrg.set(m.org_id, (membersByOrg.get(m.org_id) || 0) + 1);
    }

    // Activity score per org (jobs in 30d + logins in 30d)
    const jobsByOrg = new Map<string, number>();
    let lastJobByOrg = new Map<string, string>();
    for (const j of recentJobsResult.data || []) {
      jobsByOrg.set(j.org_id, (jobsByOrg.get(j.org_id) || 0) + 1);
      const prev = lastJobByOrg.get(j.org_id);
      if (!prev || j.created_at > prev) lastJobByOrg.set(j.org_id, j.created_at);
    }

    const loginsByOrg = new Map<string, number>();
    let lastLoginByOrg = new Map<string, string>();
    for (const l of recentLoginsResult.data || []) {
      if (!l.org_id) continue;
      loginsByOrg.set(l.org_id, (loginsByOrg.get(l.org_id) || 0) + 1);
      const prev = lastLoginByOrg.get(l.org_id);
      if (!prev || l.created_at > prev) lastLoginByOrg.set(l.org_id, l.created_at);
    }

    // Build workspace list with engagement
    const workspaces = orgs.map((o: any) => {
      const jobs30d = jobsByOrg.get(o.id) || 0;
      const logins30d = loginsByOrg.get(o.id) || 0;
      const lastActivity = lastLoginByOrg.get(o.id) || lastJobByOrg.get(o.id) || o.created_at;
      const daysSinceActivity = Math.floor((now.getTime() - new Date(lastActivity).getTime()) / 86400000);

      let engagement: 'high' | 'medium' | 'low' | 'inactive' = 'inactive';
      if (daysSinceActivity <= 1) engagement = 'high';
      else if (daysSinceActivity <= 7) engagement = 'medium';
      else if (daysSinceActivity <= 30) engagement = 'low';

      return {
        id: o.id,
        name: o.name,
        created_at: o.created_at,
        member_count: membersByOrg.get(o.id) || 0,
        jobs_30d: jobs30d,
        logins_30d: logins30d,
        last_activity: lastActivity,
        days_since_activity: daysSinceActivity,
        engagement,
      };
    });

    // Sort by engagement (most active first)
    workspaces.sort((a: any, b: any) => a.days_since_activity - b.days_since_activity);

    // Aggregate counts
    const avgUsersPerOrg = orgs.length > 0 ? Math.round((totalUsersResult.count || 0) / orgs.length * 10) / 10 : 0;
    const activeOrgs7d = workspaces.filter((w: any) => w.days_since_activity <= 7).length;
    const activeOrgs30d = workspaces.filter((w: any) => w.days_since_activity <= 30).length;
    const inactive30d = workspaces.filter((w: any) => w.days_since_activity > 30).length;

    return res.json({
      totalUsers: totalUsersResult.count || 0,
      totalOrgs: orgs.length,
      avgUsersPerOrg,
      activeOrgs7d,
      activeOrgs30d,
      inactive30d,
      workspaces,
    });
  } catch (err: any) {
    console.error('[platform-admin/users]', err.message);
    return res.status(500).json({ error: 'Failed to load user metrics.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// TAB: BILLING — subscription table with filters
// ═══════════════════════════════════════════════════════════════

router.get('/platform-admin/billing', async (req, res) => {
  try {
    if (!await requirePlatformOwner(req, res)) return;
    const admin = getServiceClient();

    const statusFilter = (req.query.status as string || '').trim();
    const intervalFilter = (req.query.interval as string || '').trim();
    const search = (req.query.search as string || '').trim();

    // Get all subscriptions with plan info
    let subsQuery = admin.from('subscriptions')
      .select('*, plans(slug, name, monthly_price_cad, yearly_price_cad)')
      .order('created_at', { ascending: false });

    if (statusFilter) subsQuery = subsQuery.eq('status', statusFilter);
    if (intervalFilter) subsQuery = subsQuery.eq('interval', intervalFilter);

    const { data: subs, error: subsError } = await subsQuery;
    if (subsError) throw subsError;

    // Get org names
    const orgIds = [...new Set((subs || []).map((s: any) => s.org_id))];
    let orgMap = new Map<string, string>();
    if (orgIds.length > 0) {
      const { data: orgs } = await admin.from('orgs').select('id, name').in('id', orgIds);
      for (const o of orgs || []) orgMap.set(o.id, o.name);
    }

    // Get recent payment status per org
    const { data: recentPayments } = await admin.from('payments')
      .select('org_id, status, created_at')
      .is('deleted_at', null)
      .in('org_id', orgIds)
      .order('created_at', { ascending: false });

    const lastPaymentStatus = new Map<string, { status: string; date: string }>();
    for (const p of recentPayments || []) {
      if (!lastPaymentStatus.has(p.org_id)) {
        lastPaymentStatus.set(p.org_id, { status: p.status, date: p.created_at });
      }
    }

    let rows = (subs || []).map((s: any) => {
      const plan = s.plans;
      const lastPay = lastPaymentStatus.get(s.org_id);
      return {
        id: s.id,
        org_id: s.org_id,
        org_name: orgMap.get(s.org_id) || 'Unknown',
        plan_name: plan?.name || 'Unknown',
        plan_slug: plan?.slug || 'unknown',
        status: s.status,
        interval: s.interval,
        amount_cents: s.amount_cents,
        currency: s.currency || 'CAD',
        current_period_end: s.current_period_end,
        trial_end: s.trial_end,
        cancel_at_period_end: s.cancel_at_period_end,
        canceled_at: s.canceled_at,
        created_at: s.created_at,
        last_payment_status: lastPay?.status || null,
        last_payment_date: lastPay?.date || null,
      };
    });

    // Search filter (client-side after enrichment)
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r: any) => r.org_name.toLowerCase().includes(q) || r.plan_name.toLowerCase().includes(q));
    }

    return res.json({ subscriptions: rows, total: rows.length });
  } catch (err: any) {
    console.error('[platform-admin/billing]', err.message);
    return res.status(500).json({ error: 'Failed to load billing data.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// SHARED: Org detail (used by org detail modal across all tabs)
// ═══════════════════════════════════════════════════════════════

router.get('/platform-admin/org/:orgId', async (req, res) => {
  try {
    if (!await requirePlatformOwner(req, res)) return;
    const admin = getServiceClient();
    const { orgId } = req.params;

    const [orgResult, membersResult, subResult, allSubsResult, jobsResult, clientsResult] = await Promise.all([
      admin.from('orgs').select('*').eq('id', orgId).single(),
      admin.from('memberships').select('user_id, role, full_name, avatar_url, created_at').eq('org_id', orgId),
      admin.from('subscriptions').select('*, plans(slug, name)').eq('org_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      // All subscriptions for this org (to calculate total subscription revenue)
      admin.from('subscriptions').select('amount_cents, interval, status, created_at, current_period_start, canceled_at').eq('org_id', orgId),
      admin.from('jobs').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('org_id', orgId),
      admin.from('clients').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('org_id', orgId),
    ]);

    if (orgResult.error) throw orgResult.error;

    const members = (membersResult.data || []).map((m: any) => ({
      user_id: m.user_id, role: m.role, created_at: m.created_at,
      full_name: m.full_name || 'Unknown', avatar_url: m.avatar_url || null,
    }));

    // Calculate subscription revenue for this org
    const activeSub = (allSubsResult.data || []).find((s: any) => s.status === 'active' || s.status === 'trialing');
    const currentMrr = activeSub
      ? (activeSub.interval === 'yearly' ? Math.round((activeSub.amount_cents || 0) / 12) : (activeSub.amount_cents || 0))
      : 0;

    // Estimate all-time revenue: count months since first subscription × average monthly rate
    const allSubs = allSubsResult.data || [];
    let allTimeRevenue = 0;
    for (const s of allSubs) {
      const monthly = s.interval === 'yearly' ? Math.round((s.amount_cents || 0) / 12) : (s.amount_cents || 0);
      const start = new Date(s.created_at);
      const end = s.status === 'canceled' && s.canceled_at ? new Date(s.canceled_at) : new Date();
      const monthsDiff = Math.max(1, Math.round((end.getTime() - start.getTime()) / (30 * 24 * 60 * 60 * 1000)));
      allTimeRevenue += monthly * monthsDiff;
    }

    return res.json({
      org: orgResult.data,
      members,
      subscription: subResult.data ? {
        plan_name: (subResult.data as any).plans?.name || 'Free',
        plan_slug: (subResult.data as any).plans?.slug || 'starter',
        status: subResult.data.status,
        interval: subResult.data.interval,
        amount_cents: subResult.data.amount_cents,
        current_period_end: subResult.data.current_period_end,
        trial_end: subResult.data.trial_end,
      } : null,
      stats: {
        total_jobs: jobsResult.count || 0,
        total_clients: clientsResult.count || 0,
        revenue_all_time_cents: allTimeRevenue,
        revenue_30d_cents: currentMrr,
      },
    });
  } catch (err: any) {
    console.error('[platform-admin/org]', err.message);
    return res.status(500).json({ error: 'Failed to load org details.' });
  }
});

export default router;
