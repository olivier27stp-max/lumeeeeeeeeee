import express from 'express';
import { requireAuthedClient, getServiceClient, isOrgMember } from '../lib/supabase';
import { validate, assignJobToTeamSchema } from '../lib/validation';

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

    // Fetch the job to verify it exists and get its org
    const { data: jobRow, error: jobFetchErr } = await admin
      .from('jobs')
      .select('id, org_id, team_id')
      .eq('id', jobId)
      .is('deleted_at', null)
      .maybeSingle();
    if (jobFetchErr) throw jobFetchErr;
    if (!jobRow) return res.status(404).json({ error: 'Job not found.' });

    // Verify user is a member of the job's org
    const member = await isOrgMember(auth.client, auth.user.id, String(jobRow.org_id));
    if (!member) return res.status(403).json({ error: 'Forbidden: not a member of this organization.' });

    // Verify team exists and belongs to the same org
    const { data: teamRow, error: teamFetchErr } = await admin
      .from('teams')
      .select('id, org_id')
      .eq('id', teamId)
      .is('deleted_at', null)
      .maybeSingle();
    if (teamFetchErr) throw teamFetchErr;
    if (!teamRow) return res.status(404).json({ error: 'Team not found.' });
    if (String(teamRow.org_id) !== String(jobRow.org_id)) {
      return res.status(400).json({ error: 'Team does not belong to the same organization.' });
    }

    const now = new Date().toISOString();

    // Update job's team_id
    const { error: jobUpdateErr } = await admin
      .from('jobs')
      .update({ team_id: teamId, updated_at: now })
      .eq('id', jobId);
    if (jobUpdateErr) throw jobUpdateErr;

    // Update future schedule events for this job that have no team assigned
    const { error: eventUpdateErr } = await admin
      .from('schedule_events')
      .update({ team_id: teamId })
      .eq('job_id', jobId)
      .is('team_id', null)
      .is('deleted_at', null);
    if (eventUpdateErr) throw eventUpdateErr;

    return res.status(200).json({ ok: true, jobId, teamId });
  } catch (error: any) {
    console.error('job_assign_team_failed', {
      code: String(error?.code || ''),
      message: String(error?.message || 'unknown'),
    });
    return res.status(500).json({ error: error?.message || 'Unable to assign job to team.' });
  }
});

export default router;
