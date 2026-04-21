/**
 * Team management compliance endpoints (Bloc 5)
 *
 * - POST /api/team/:memberId/request-delete    — schedule hard delete (30d grace)
 * - POST /api/team/:memberId/cancel-delete     — cancel scheduled hard delete
 * - POST /api/team/:memberId/mfa-required      — toggle MFA requirement
 * - POST /api/team/:memberId/force-logout      — revoke all sessions of a member
 * - GET  /api/team/:userId/audit               — per-user audit trail
 */

import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';

const router = Router();

const UUID_RE = /^[0-9a-f-]{36}$/i;

// ────────────────────────────────────────────────────────────────────
// POST /api/team/:memberId/request-delete
// Body: { reassign_to: uuid, confirm: "DELETE" }
// ────────────────────────────────────────────────────────────────────
router.post('/team/:memberId/request-delete', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const memberId = String(req.params.memberId);
  const { reassign_to, confirm } = req.body || {};
  if (!UUID_RE.test(memberId)) return res.status(400).json({ error: 'Invalid member id' });
  if (!reassign_to || !UUID_RE.test(String(reassign_to))) return res.status(400).json({ error: 'reassign_to must be a valid user id' });
  if (confirm !== 'DELETE') return res.status(400).json({ error: 'confirm must equal "DELETE"' });

  const svc = getServiceClient();
  const { error } = await svc.rpc('request_hard_delete_member', {
    p_member_id: memberId,
    p_reassign_to: reassign_to,
  });
  if (error) return res.status(403).json({ error: error.message });

  return res.status(200).json({ ok: true, scheduled_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString() });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/team/:memberId/cancel-delete
// ────────────────────────────────────────────────────────────────────
router.post('/team/:memberId/cancel-delete', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const memberId = String(req.params.memberId);
  if (!UUID_RE.test(memberId)) return res.status(400).json({ error: 'Invalid member id' });

  const svc = getServiceClient();
  const { error } = await svc.rpc('cancel_hard_delete_member', { p_member_id: memberId });
  if (error) return res.status(403).json({ error: error.message });
  return res.status(200).json({ ok: true });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/team/:memberId/mfa-required
// Body: { required: boolean }
// ────────────────────────────────────────────────────────────────────
router.post('/team/:memberId/mfa-required', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const memberId = String(req.params.memberId);
  const { required } = req.body || {};
  if (!UUID_RE.test(memberId)) return res.status(400).json({ error: 'Invalid member id' });
  if (typeof required !== 'boolean') return res.status(400).json({ error: 'required must be boolean' });

  const svc = getServiceClient();
  const { error } = await svc.rpc('set_member_mfa_required', {
    p_member_id: memberId,
    p_required: required,
  });
  if (error) return res.status(403).json({ error: error.message });
  return res.status(200).json({ ok: true, mfa_required: required });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/team/:memberId/force-logout
// Admin revokes all sessions of a target user (Supabase Admin API).
// ────────────────────────────────────────────────────────────────────
router.post('/team/:memberId/force-logout', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const memberId = String(req.params.memberId);
  if (!UUID_RE.test(memberId)) return res.status(400).json({ error: 'Invalid member id' });

  const svc = getServiceClient();

  // Resolve target user_id + ensure same org
  const { data: member, error: mErr } = await svc
    .from('team_members')
    .select('user_id, org_id')
    .eq('id', memberId)
    .maybeSingle();
  if (mErr || !member) return res.status(404).json({ error: 'Member not found' });
  if (member.org_id !== auth.orgId) return res.status(403).json({ error: 'Cross-org operation not allowed' });

  // Caller must be admin/owner
  const { data: isAdmin, error: rErr } = await svc.rpc('has_org_admin_role', {
    p_user: auth.user.id,
    p_org: auth.orgId,
  });
  if (rErr || !isAdmin) return res.status(403).json({ error: 'Admin/Owner role required' });

  try {
    // Supabase Admin API — signs out the user everywhere
    await (svc.auth as any).admin.signOut(member.user_id, 'global');
  } catch (e: any) {
    console.warn('[force-logout] admin.signOut failed:', e?.message);
    // Fallback DB-level RPC if present (swallow errors silently)
    try { await svc.rpc('invalidate_user_sessions', { p_user_id: member.user_id }); } catch { /* no-op */ }
  }

  await svc.from('audit_events').insert({
    org_id: auth.orgId,
    actor_id: auth.user.id,
    action: 'force_logout',
    entity_type: 'team_member',
    entity_id: memberId,
    metadata: { target_user: member.user_id },
  });

  return res.status(200).json({ ok: true });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/team/:userId/audit?limit=200
// ────────────────────────────────────────────────────────────────────
router.get('/team/:userId/audit', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const userId = String(req.params.userId);
  if (!UUID_RE.test(userId)) return res.status(400).json({ error: 'Invalid user id' });

  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));

  const svc = getServiceClient();
  const { data, error } = await svc.rpc('list_member_audit_events', {
    p_user_id: userId,
    p_limit: limit,
  });
  if (error) return res.status(403).json({ error: error.message });
  return res.status(200).json({ events: data ?? [] });
});

export default router;
