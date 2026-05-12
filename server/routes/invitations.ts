import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { validate, passwordSchema } from '../lib/validation';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';
import { getBaseUrl } from '../lib/config';
import { redisRateLimit } from '../lib/rate-limiter';
import { extractIP } from '../lib/security';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function timingSafeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

async function randomSleep() {
  await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
}

/**
 * Look up an invitation by either token_hash (new path) or plaintext token
 * (legacy backfill window). Returns the row only if a constant-time compare
 * against the stored hash succeeds.
 */
async function findInvitationByToken(admin: ReturnType<typeof getServiceClient>, token: string) {
  const tokenHash = hashToken(token);
  let { data: invitation } = await admin
    .from('invitations')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!invitation) {
    // Legacy: rows that pre-date the hash column still have plaintext.
    const { data: legacy } = await admin
      .from('invitations')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    invitation = legacy || null;
  }

  if (!invitation) return null;

  const expected = invitation.token_hash || (invitation.token ? hashToken(invitation.token) : '');
  if (!timingSafeCompare(tokenHash, expected)) return null;
  return invitation;
}

// Per-IP rate limit for invitation accept/verify (defeats token brute-force)
const invitationLimiter = redisRateLimit({
  preset: 'auth',
  keyFn: (req) => `inv:${extractIP(req)}`,
});

// ─── Validation schemas ──────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().trim().email('Valid email is required.'),
  role: z.enum(['admin', 'sales_rep', 'technician'], {
    error: 'Role must be admin, sales_rep, or technician.',
  }),
  scope: z.enum(['self', 'assigned', 'team', 'company'], { error: 'Invalid scope.' }).optional(),
  team_id: z.string().uuid().nullable().optional(),
  custom_permissions: z.record(z.string(), z.boolean()).optional(),
});

const acceptInviteSchema = z.object({
  token: z.string().trim().regex(/^[a-f0-9]{64}$/, 'Invalid token format.'),
  password: passwordSchema,
  full_name: z.string().trim().min(1, 'Full name is required.'),
});

const resendInviteSchema = z.object({
  invitationId: z.string().uuid('Invalid invitation ID.'),
});

const revokeInviteSchema = z.object({
  invitationId: z.string().uuid('Invalid invitation ID.'),
});

const updateMemberRoleSchema = z.object({
  memberId: z.string().uuid('Invalid member ID.'),
  role: z.enum(['admin', 'sales_rep', 'technician'], {
    error: 'Role must be admin, sales_rep, or technician.',
  }),
  scope: z.enum(['self', 'assigned', 'team', 'company'], { error: 'Invalid scope.' }).optional(),
  team_id: z.string().uuid().nullable().optional(),
  custom_permissions: z.record(z.string(), z.boolean()).optional(),
});

const removeMemberSchema = z.object({
  userId: z.string().uuid('Invalid user ID.'),
});

// ─── GET /invitations/list — List org members + pending invitations ──

router.get('/invitations/list', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();

    // Fetch memberships with profile data
    const { data: memberships, error: memError } = await admin
      .from('memberships')
      .select('user_id, org_id, role, status, permissions, created_at')
      .eq('org_id', auth.orgId);

    if (memError) {
      console.error('[invitations/list] memberships error:', memError.message);
      return res.status(500).json({ error: 'Failed to load team members.' });
    }

    // Fetch profiles for all member user_ids
    const userIds = (memberships || []).map((m: any) => m.user_id);
    let profiles: any[] = [];
    if (userIds.length > 0) {
      const { data: profileData } = await admin
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', userIds);
      profiles = profileData || [];
    }

    // Fetch auth users for emails + last_sign_in
    const members = (memberships || []).map((m: any) => {
      const profile = profiles.find((p: any) => p.id === m.user_id);
      return {
        user_id: m.user_id,
        org_id: m.org_id,
        role: m.role,
        status: m.status,
        permissions: m.permissions,
        created_at: m.created_at,
        full_name: profile?.full_name || '',
        avatar_url: profile?.avatar_url || null,
      };
    });

    // Fetch pending invitations
    const { data: invitations, error: invError } = await admin
      .from('invitations')
      .select('*')
      .eq('org_id', auth.orgId)
      .in('status', ['pending'])
      .order('created_at', { ascending: false });

    if (invError) {
      console.error('[invitations/list] invitations error:', invError.message);
    }

    return res.json({
      members: members || [],
      invitations: invitations || [],
    });
  } catch (err: any) {
    console.error('[invitations/list]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /invitations/send — Send an invitation ────────────────

router.post('/invitations/send', validate(inviteSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    // Only admin or owner can invite
    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins or owners can send invitations.' });
    }

    const { email, role } = req.body;

    // Check if user is already a member
    const { data: existingMember } = await admin
      .from('memberships')
      .select('user_id')
      .eq('org_id', auth.orgId)
      .eq('user_id', (
        await admin.from('profiles').select('id').eq('id',
          (await admin.rpc('get_user_id_by_email', { p_email: email }))?.data
        ).maybeSingle()
      )?.data?.id || '00000000-0000-0000-0000-000000000000')
      .maybeSingle();

    // Simpler check: look for existing pending invitation
    const { data: existingInvite } = await admin
      .from('invitations')
      .select('id, status')
      .eq('org_id', auth.orgId)
      .eq('email', email.toLowerCase())
      .eq('status', 'pending')
      .maybeSingle();

    if (existingInvite) {
      return res.status(409).json({ error: 'An invitation is already pending for this email.' });
    }

    // Generate secure token — store ONLY the SHA-256 hash. Plaintext is sent
    // in the email link and never persisted server-side.
    const token = crypto.randomBytes(32).toString('hex');
    const token_hash = hashToken(token);

    // Create invitation
    const { data: invitation, error: createError } = await admin
      .from('invitations')
      .insert({
        org_id: auth.orgId,
        email: email.toLowerCase(),
        role,
        scope: req.body.scope || 'self',
        team_id: req.body.team_id || null,
        department_id: req.body.department_id || null,
        custom_permissions: req.body.custom_permissions || {},
        token: null,
        token_hash,
        invited_by: auth.user.id,
        status: 'pending',
        // Compliance: 48h expiry (Loi 25 — invitation tokens short-lived)
        expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (createError) {
      console.error('[invitations/send] create error:', createError.message);
      return res.status(500).json({ error: 'Failed to create invitation.' });
    }

    // Get org + branding + inviter info in parallel
    const [{ data: org }, { data: branding }, { data: inviter }] = await Promise.all([
      admin.from('orgs').select('name').eq('id', auth.orgId).maybeSingle(),
      admin.from('company_settings').select('company_name, logo_url, primary_color, website').eq('org_id', auth.orgId).maybeSingle(),
      admin.from('profiles').select('full_name').eq('id', auth.user.id).maybeSingle(),
    ]);

    const orgName = org?.name || 'Your organization';
    const baseUrl = getBaseUrl();
    const inviteLink = `${baseUrl}/invite/${token}`;

    // Send invitation email via SMTP, branded with the org's company_settings
    try {
      const { sendEmail, isMailerConfigured } = await import('../lib/mailer');
      if (isMailerConfigured()) {
        const { renderInvitationEmail } = await import('../lib/email-templates/invitation');
        const { subject, html, text } = renderInvitationEmail({
          orgName,
          role,
          inviteLink,
          inviterName: inviter?.full_name || null,
          branding,
        });
        await sendEmail({ to: email, subject, html, text });
      }
    } catch (emailErr: any) {
      console.error('[invitations/send] email error:', emailErr.message);
      // Don't fail the invitation if email fails
    }

    return res.json({
      invitation,
      invite_link: inviteLink,
    });
  } catch (err: any) {
    console.error('[invitations/send]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /invitations/accept — Accept an invitation ────────────

router.post('/invitations/accept', invitationLimiter, validate(acceptInviteSchema), async (req, res) => {
  try {
    const { token, password, full_name } = req.body;
    const admin = getServiceClient();

    // Look up by token_hash (constant-time compare inside helper)
    const invitation = await findInvitationByToken(admin, token);
    if (!invitation || invitation.status !== 'pending') {
      await randomSleep();
      return res.status(404).json({ error: 'Invitation not found or already used.' });
    }

    // Check expiration
    if (new Date(invitation.expires_at) < new Date()) {
      await admin
        .from('invitations')
        .update({ status: 'expired' })
        .eq('id', invitation.id);
      await randomSleep();
      return res.status(410).json({ error: 'This invitation has expired.' });
    }

    // Defense-in-depth: if a user with this email already exists, require
    // them to be authenticated AS THAT USER before we attach them to the org.
    // Otherwise an attacker who has the token + knows the victim's email can
    // silently join the victim's account to their org without any password
    // challenge.
    let existingUserId: string | null = null;
    try {
      const { data: rpcData } = await admin.rpc('get_user_id_by_email', {
        p_email: invitation.email,
      });
      if (rpcData) {
        existingUserId = typeof rpcData === 'string' ? rpcData : (rpcData as any)?.id || null;
      }
    } catch (err) {
      console.error('[invitations/accept] get_user_id_by_email rpc failed:', err);
    }

    if (existingUserId) {
      // The invitation is for an account that already exists. Require the
      // caller to be authenticated as that user — otherwise we'd be silently
      // attaching their identity to a new org with no password challenge.
      const authHeader = req.headers.authorization || '';
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      let callerUserId: string | null = null;
      if (bearer) {
        try {
          const { data: u } = await admin.auth.getUser(bearer);
          callerUserId = u?.user?.id || null;
        } catch (err) {
          console.error('[invitations/accept] getUser(bearer) failed:', err);
        }
      }

      if (!callerUserId || callerUserId !== existingUserId) {
        await randomSleep();
        return res.status(401).json({
          error: 'An account already exists for this email. Please sign in first, then re-open the invitation link.',
          requires_login: true,
          email: invitation.email,
        });
      }

      // Authenticated as the invited user — attach to org if not already there.
      const { data: existingMem } = await admin
        .from('memberships')
        .select('user_id, status')
        .eq('user_id', existingUserId)
        .eq('org_id', invitation.org_id)
        .maybeSingle();

      if (existingMem) {
        await admin
          .from('invitations')
          .update({ status: 'accepted', accepted_at: new Date().toISOString() })
          .eq('id', invitation.id);
        return res.json({ message: 'You are already a member of this organization.' });
      }

      const { error: memError } = await admin
        .from('memberships')
        .insert({
          user_id: existingUserId,
          org_id: invitation.org_id,
          role: invitation.role,
          scope: invitation.scope || 'self',
          team_id: invitation.team_id || null,
          department_id: invitation.department_id || null,
          permissions: invitation.custom_permissions || {},
          status: 'active',
        });

      if (memError) {
        console.error('[invitations/accept] membership error:', memError.message);
        return res.status(500).json({ error: 'Failed to add membership.' });
      }

      await admin
        .from('invitations')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invitation.id);

      return res.json({ message: 'Invitation accepted. You have been added to the organization.' });
    }

    // No existing user — create one with the provided password.
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: invitation.email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });

    if (authError) {
      console.error('[invitations/accept] auth error:', authError.message);
      return res.status(500).json({ error: 'Failed to create account.' });
    }

    const newUser = authData.user;

    // Create profile
    await admin.from('profiles').upsert({
      id: newUser.id,
      full_name,
    });

    // Create membership with scope, team, department, and custom permissions from invitation
    const { error: memError } = await admin
      .from('memberships')
      .insert({
        user_id: newUser.id,
        org_id: invitation.org_id,
        role: invitation.role,
        scope: invitation.scope || 'self',
        team_id: invitation.team_id || null,
        department_id: invitation.department_id || null,
        permissions: invitation.custom_permissions || {},
        full_name,
        status: 'active',
      });

    if (memError) {
      console.error('[invitations/accept] membership error:', memError.message);
      return res.status(500).json({ error: 'Failed to create membership.' });
    }

    // Mark invitation as accepted
    await admin
      .from('invitations')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);

    return res.json({
      message: 'Invitation accepted. Welcome to the team!',
      user_id: newUser.id,
    });
  } catch (err: any) {
    console.error('[invitations/accept]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /invitations/verify/:token — Verify invitation token ───

router.get('/invitations/verify/:token', invitationLimiter, async (req, res) => {
  try {
    const { token } = req.params;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      await randomSleep();
      return res.status(404).json({ error: 'Invitation not found.' });
    }
    const admin = getServiceClient();

    const invitation = await findInvitationByToken(admin, token);
    if (!invitation) {
      await randomSleep();
      return res.status(404).json({ error: 'Invitation not found.' });
    }

    if (invitation.status !== 'pending') {
      await randomSleep();
      return res.status(410).json({ error: 'This invitation has already been used.', status: invitation.status });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      await randomSleep();
      return res.status(410).json({ error: 'This invitation has expired.' });
    }

    // Get org name
    const { data: org } = await admin
      .from('orgs')
      .select('name')
      .eq('id', invitation.org_id)
      .maybeSingle();

    return res.json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        org_name: org?.name || 'Organization',
      },
    });
  } catch (err: any) {
    console.error('[invitations/verify]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /invitations/resend — Resend an invitation email ──────

router.post('/invitations/resend', validate(resendInviteSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins or owners can resend invitations.' });
    }

    const { invitationId } = req.body;

    // Get the invitation
    const { data: invitation, error } = await admin
      .from('invitations')
      .select('*')
      .eq('id', invitationId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (error || !invitation) {
      return res.status(404).json({ error: 'Invitation not found.' });
    }

    // Generate new token and extend expiry. Store only the hash.
    const newToken = crypto.randomBytes(32).toString('hex');
    const newTokenHash = hashToken(newToken);
    const { error: updateError } = await admin
      .from('invitations')
      .update({
        token: null,
        token_hash: newTokenHash,
        // Compliance: 48h expiry (Loi 25 — invitation tokens short-lived)
        expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        status: 'pending',
      })
      .eq('id', invitationId);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to resend invitation.' });
    }

    // Re-send branded email (same template as initial send)
    const [{ data: org }, { data: branding }, { data: inviter }] = await Promise.all([
      admin.from('orgs').select('name').eq('id', auth.orgId).maybeSingle(),
      admin.from('company_settings').select('company_name, logo_url, primary_color, website').eq('org_id', auth.orgId).maybeSingle(),
      admin.from('profiles').select('full_name').eq('id', auth.user.id).maybeSingle(),
    ]);

    const baseUrl = getBaseUrl();
    const inviteLink = `${baseUrl}/invite/${newToken}`;
    try {
      const { sendEmail, isMailerConfigured } = await import('../lib/mailer');
      if (isMailerConfigured()) {
        const { renderInvitationEmail } = await import('../lib/email-templates/invitation');
        const orgName = org?.name || 'an organization';
        const rendered = renderInvitationEmail({
          orgName,
          role: invitation.role,
          inviteLink,
          inviterName: inviter?.full_name || null,
          branding,
        });
        await sendEmail({
          to: invitation.email,
          subject: `Reminder: ${rendered.subject}`,
          html: rendered.html,
          text: rendered.text,
        });
      }
    } catch {}

    return res.json({ message: 'Invitation resent.', invite_link: inviteLink });
  } catch (err: any) {
    console.error('[invitations/resend]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /invitations/revoke — Revoke an invitation ────────────

router.post('/invitations/revoke', validate(revokeInviteSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins or owners can revoke invitations.' });
    }

    const { invitationId } = req.body;

    const { error } = await admin
      .from('invitations')
      .update({ status: 'revoked' })
      .eq('id', invitationId)
      .eq('org_id', auth.orgId);

    if (error) {
      return res.status(500).json({ error: 'Failed to revoke invitation.' });
    }

    return res.json({ message: 'Invitation revoked.' });
  } catch (err: any) {
    console.error('[invitations/revoke]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /invitations/update-role — Change member role ─────────

router.post('/invitations/update-role', validate(updateMemberRoleSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins or owners can change roles.' });
    }

    const { memberId, role } = req.body;

    // Prevent changing the owner's role
    const { data: membership } = await admin
      .from('memberships')
      .select('role, user_id')
      .eq('user_id', memberId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (!membership) {
      return res.status(404).json({ error: 'Member not found.' });
    }

    if (membership.role === 'owner') {
      return res.status(403).json({ error: 'Cannot change the owner\'s role.' });
    }

    // Only the org owner can demote another admin
    if (membership.role === 'admin' && role !== 'admin') {
      const { data: callerMembership } = await admin
        .from('memberships')
        .select('role')
        .eq('user_id', auth.user.id)
        .eq('org_id', auth.orgId)
        .maybeSingle();
      if (callerMembership?.role !== 'owner') {
        return res.status(403).json({ error: 'Only the organization owner can demote another admin.' });
      }
    }

    const updateData: Record<string, any> = { role };
    if (req.body.scope) updateData.scope = req.body.scope;
    if (req.body.team_id !== undefined) updateData.team_id = req.body.team_id || null;
    if (req.body.department_id !== undefined) updateData.department_id = req.body.department_id || null;
    if (req.body.custom_permissions) updateData.permissions = req.body.custom_permissions;

    const { error } = await admin
      .from('memberships')
      .update(updateData)
      .eq('user_id', memberId)
      .eq('org_id', auth.orgId);

    if (error) {
      return res.status(500).json({ error: 'Failed to update role.' });
    }

    return res.json({ message: 'Role updated.' });
  } catch (err: any) {
    console.error('[invitations/update-role]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /invitations/remove-member — Remove a member ──────────

router.post('/invitations/remove-member', validate(removeMemberSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(admin, auth.user.id, auth.orgId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins or owners can remove members.' });
    }

    const { userId } = req.body;

    // Prevent removing yourself or the owner
    if (userId === auth.user.id) {
      return res.status(400).json({ error: 'You cannot remove yourself.' });
    }

    const { data: membership } = await admin
      .from('memberships')
      .select('role')
      .eq('user_id', userId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (!membership) {
      return res.status(404).json({ error: 'Member not found.' });
    }

    if (membership.role === 'owner') {
      return res.status(403).json({ error: 'Cannot remove the organization owner.' });
    }

    // Only owner can remove another admin
    if (membership.role === 'admin') {
      const { data: callerMembership } = await admin
        .from('memberships')
        .select('role')
        .eq('user_id', auth.user.id)
        .eq('org_id', auth.orgId)
        .maybeSingle();
      if (callerMembership?.role !== 'owner') {
        return res.status(403).json({ error: 'Only the organization owner can remove another admin.' });
      }
    }

    // Set status to suspended instead of deleting
    const { error } = await admin
      .from('memberships')
      .update({ status: 'suspended' })
      .eq('user_id', userId)
      .eq('org_id', auth.orgId);

    if (error) {
      return res.status(500).json({ error: 'Failed to remove member.' });
    }

    // Force the removed member's session to end so they cannot continue using
    // their cached JWT until natural expiry.
    try {
      await admin.auth.admin.signOut(userId);
    } catch (signOutErr: any) {
      console.warn('[invitations/remove-member] signOut failed (non-fatal):', signOutErr?.message);
    }

    return res.json({ message: 'Member removed from organization.' });
  } catch (err: any) {
    console.error('[invitations/remove-member]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
