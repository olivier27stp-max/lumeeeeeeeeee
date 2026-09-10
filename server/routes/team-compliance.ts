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

/**
 * Resolve the target team_member, then enforce (a) same-org and (b) the caller
 * is admin/owner — explicitly, via auth.user.id. The underlying RPCs also check
 * has_org_admin_role(auth.uid()), but auth.uid() is NULL under the service-role
 * client, so that internal check can't be relied on for authorization. Doing it
 * here makes these routes secure independently of the RPC internals.
 * Returns the member (org_id + user_id) or null after having sent the response.
 */
async function guardMemberAdmin(
  svc: ReturnType<typeof getServiceClient>,
  auth: { user: { id: string }; orgId: string },
  res: import('express').Response,
  memberId: string,
): Promise<{ orgId: string; userId: string } | null> {
  const { data: member } = await svc
    .from('team_members').select('user_id, org_id').eq('id', memberId).maybeSingle();
  if (!member) { res.status(404).json({ error: 'Member not found' }); return null; }
  if (member.org_id !== auth.orgId) { res.status(403).json({ error: 'Cross-org operation not allowed' }); return null; }
  const { data: isAdmin } = await svc.rpc('has_org_admin_role', { p_user: auth.user.id, p_org: auth.orgId });
  if (!isAdmin) { res.status(403).json({ error: 'Admin/Owner role required' }); return null; }
  return { orgId: member.org_id, userId: member.user_id };
}

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
  if (!await guardMemberAdmin(svc, auth, res, memberId)) return;
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
  if (!await guardMemberAdmin(svc, auth, res, memberId)) return;
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
  if (!await guardMemberAdmin(svc, auth, res, memberId)) return;
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

  // Révocation en base : invalidate_user_sessions() supprime auth.sessions
  // (les jetons de rafraîchissement suivent). Avant : `admin.signOut(userId)`
  // — l'API admin GoTrue attend un JWT, pas un identifiant — échouait TOUJOURS,
  // puis retombait sur cette RPC qui n'existait pas. Un membre retiré gardait
  // ses sessions, et la route répondait 200. Ici, un échec est un 500.
  const { data: revoquees, error: invErr } = await svc.rpc('invalidate_user_sessions', { p_user_id: member.user_id });
  if (invErr) {
    console.error('[team-compliance] sessions non révoquées:', member.user_id, invErr.message);
    return res.status(500).json({ error: 'Session revocation failed.' });
  }

  await svc.from('audit_events').insert({
    org_id: auth.orgId,
    actor_id: auth.user.id,
    action: 'force_logout',
    entity_type: 'team_member',
    entity_id: memberId,
    metadata: { target_user: member.user_id, sessions_revoked: Number(revoquees ?? 0) },
  });

  return res.status(200).json({ ok: true, sessions_revoked: Number(revoquees ?? 0) });
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
  // Target user must be a member of the caller's org, and the caller must be
  // admin/owner (explicit — the RPC's auth.uid() check is NULL under service role).
  const { data: sharedMembership } = await svc
    .from('memberships').select('user_id').eq('user_id', userId).eq('org_id', auth.orgId).maybeSingle();
  if (!sharedMembership) return res.status(403).json({ error: 'User is not a member of your organization' });
  const { data: isAdmin } = await svc.rpc('has_org_admin_role', { p_user: auth.user.id, p_org: auth.orgId });
  if (!isAdmin) return res.status(403).json({ error: 'Admin/Owner role required' });
  const { data, error } = await svc.rpc('list_member_audit_events', {
    p_user_id: userId,
    p_limit: limit,
  });
  if (error) return res.status(403).json({ error: error.message });
  return res.status(200).json({ events: data ?? [] });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/team/:memberId/purge-now  (P1-D — vrai effacement)
// L'effacement programmé (request-delete + grâce 30 j) ne faisait que RÉVOQUER
// l'accès : le cron SQL supprime les lignes memberships/team_members, mais le
// compte auth.users restait (avec sessions, MFA, push tokens, subscriptions…).
// La promesse « suppression définitive » était donc fausse (enjeu Loi 25).
// Le SQL ne peut pas supprimer dans le schéma `auth` — seul l'Admin API le peut.
// Cette route, réservée admin/owner, supprime définitivement le compte quand la
// grâce est expirée ; grâce aux FK ON DELETE CASCADE/SET NULL posées par
// 20260910170000, deleteUser nettoie proprement toutes les données rattachées.
// ────────────────────────────────────────────────────────────────────
router.post('/team/:memberId/purge-now', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const memberId = String(req.params.memberId);
  if (!UUID_RE.test(memberId)) return res.status(400).json({ error: 'Invalid member id' });

  const svc = getServiceClient();

  // Le membre doit exister dans l'org de l'appelant, avec une suppression
  // programmée dont la grâce est ÉCHUE. On lit deletion_scheduled_at pour ne
  // jamais supprimer un compte hors de la fenêtre prévue.
  const { data: member } = await svc
    .from('team_members')
    .select('user_id, org_id, deletion_scheduled_at')
    .eq('id', memberId)
    .maybeSingle();
  if (!member) return res.status(404).json({ error: 'Member not found' });
  if (member.org_id !== auth.orgId) return res.status(403).json({ error: 'Cross-org operation not allowed' });

  const { data: isAdmin } = await svc.rpc('has_org_admin_role', { p_user: auth.user.id, p_org: auth.orgId });
  if (!isAdmin) return res.status(403).json({ error: 'Admin/Owner role required' });

  if (!member.deletion_scheduled_at) {
    return res.status(409).json({ error: 'Aucune suppression programmée pour ce membre.' });
  }
  if (new Date(member.deletion_scheduled_at).getTime() > Date.now()) {
    return res.status(409).json({ error: 'La période de grâce n’est pas terminée.', scheduled_at: member.deletion_scheduled_at });
  }

  // Empêcher un admin de se supprimer lui-même par cette voie.
  if (member.user_id === auth.user.id) {
    return res.status(400).json({ error: 'Impossible de supprimer votre propre compte par cette route.' });
  }

  // Suppression définitive du compte auth. Les FK CASCADE/SET NULL font le reste.
  const { error: delErr } = await (svc.auth.admin as any).deleteUser(member.user_id);
  if (delErr) {
    console.error('[team-compliance] deleteUser échoué:', member.user_id, delErr.message);
    return res.status(500).json({ error: 'Suppression du compte échouée.' });
  }

  await svc.from('audit_events').insert({
    org_id: auth.orgId,
    actor_id: auth.user.id,
    action: 'hard_delete_purged',
    entity_type: 'team_member',
    entity_id: memberId,
    metadata: { target_user: member.user_id, scheduled_at: member.deletion_scheduled_at, at: new Date().toISOString() },
  });

  return res.status(200).json({ ok: true, purged_user: member.user_id });
});

export default router;
