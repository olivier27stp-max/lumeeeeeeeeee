import express from 'express';
import { requireAuthedClient, getServiceClient, isOrgMember } from '../lib/supabase';
import { validate, assignJobToTeamSchema } from '../lib/validation';
import { sendSafeError } from '../lib/error-handler';

const router = express.Router();

/**
 * POST /api/jobs/assign-team
 * Assigns a job to a team. Uses service_role to bypass RLS (jobs UPDATE requires admin role).
 * Verifies the caller is an org member of the job's organization.
 */
router.post('/jobs/assign-team', validate(assignJobToTeamSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { jobId, teamId } = req.body as { jobId: string; teamId: string };
    const admin = getServiceClient();

    // Fetch job and team in parallel — both are independent lookups
    const [jobRes, teamRes] = await Promise.all([
      admin
        .from('jobs')
        .select('id, org_id, team_id')
        .eq('id', jobId)
        .is('deleted_at', null)
        .maybeSingle(),
      admin
        .from('teams')
        .select('id, org_id')
        .eq('id', teamId)
        .is('deleted_at', null)
        .maybeSingle(),
    ]);

    if (jobRes.error) throw jobRes.error;
    if (!jobRes.data) return res.status(404).json({ error: 'Job not found.' });
    if (teamRes.error) throw teamRes.error;
    if (!teamRes.data) return res.status(404).json({ error: 'Team not found.' });

    const jobRow = jobRes.data;
    const teamRow = teamRes.data;

    // Verify user is a member of the job's org
    const member = await isOrgMember(auth.client, auth.user.id, String(jobRow.org_id));
    if (!member) return res.status(403).json({ error: 'Forbidden: not a member of this organization.' });

    if (String(teamRow.org_id) !== String(jobRow.org_id)) {
      return res.status(400).json({ error: 'Team does not belong to the same organization.' });
    }

    const now = new Date().toISOString();

    // Update job + schedule events in parallel — independent writes
    const [jobUpdateRes, eventUpdateRes] = await Promise.all([
      admin.from('jobs').update({ team_id: teamId, updated_at: now }).eq('id', jobId),
      admin
        .from('schedule_events')
        .update({ team_id: teamId })
        .eq('job_id', jobId)
        .is('team_id', null)
        .is('deleted_at', null),
    ]);
    if (jobUpdateRes.error) throw jobUpdateRes.error;
    if (eventUpdateRes.error) throw eventUpdateRes.error;

    return res.status(200).json({ ok: true, jobId, teamId });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to assign job to team.', '[jobs/assign-team]');
  }
});

/**
 * GET /api/jobs/search-for-invoice
 * Returns jobs eligible for invoicing. Uses service_role to avoid RLS ambiguity.
 */
router.get('/jobs/search-for-invoice', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const q = (req.query.q as string || '').trim();
    const admin = getServiceClient();

    let query = admin
      .from('jobs')
      .select('id, title, status, total_cents, client_id, client_name, property_address, scheduled_at, created_at')
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .in('status', ['completed', 'in_progress', 'scheduled'])
      .order('created_at', { ascending: false })
      .limit(30);

    if (q) {
      query = query.or(`title.ilike.%${q}%,client_name.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ jobs: data || [] });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to search jobs.', '[jobs/search-for-invoice]');
  }
});

/**
 * GET /api/clients/search
 * Search active clients. Uses service_role to avoid RLS "id ambiguous" on views.
 */
router.get('/clients/search', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const q = (req.query.q as string || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 30));
    const from = (page - 1) * pageSize;

    const admin = getServiceClient();
    let query = admin
      .from('clients')
      .select('id, first_name, last_name, company, email, status', { count: 'exact' })
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true })
      .range(from, from + pageSize - 1);

    if (q) {
      const safe = q.replace(/%/g, '\\%').replace(/_/g, '\\_');
      query = query.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,company.ilike.%${safe}%,email.ilike.%${safe}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const items = (data || []).map((c: any) => ({
      id: c.id,
      name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company || '',
      email: c.email || null,
      status: c.status || 'active',
    }));

    return res.json({ items, total: count || 0 });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to search clients.', '[clients/search]');
  }
});

/**
 * POST /api/clients/by-ids
 * Fetch clients by array of IDs. Uses service_role to avoid RLS ambiguity.
 */
router.post('/clients/by-ids', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const ids: string[] = req.body?.ids || [];
    if (!Array.isArray(ids) || ids.length === 0) return res.json({ clients: [] });

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('clients')
      .select('id, first_name, last_name, email, company, phone')
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .in('id', ids);

    if (error) throw error;
    return res.json({ clients: data || [] });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to fetch clients.', '[clients/by-ids]');
  }
});

export default router;
