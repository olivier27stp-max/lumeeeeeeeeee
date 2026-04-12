import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { validate } from '../lib/validation';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';

const router = Router();

// ─── Validation schemas ──────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().trim().email('Valid email is required.'),
  role: z.enum(['admin', 'manager', 'sales_rep', 'technician', 'support', 'viewer'], {
    error: 'Role must be admin, manager, sales_rep, technician, support, or viewer.',
  }),
  scope: z.enum(['self', 'assigned', 'team', 'department', 'company'], { error: 'Invalid scope.' }).optional(),
  team_id: z.string().uuid().nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  custom_permissions: z.record(z.string(), z.boolean()).optional(),
});

const acceptInviteSchema = z.object({
  token: z.string().trim().min(1, 'Token is required.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
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
  role: z.enum(['admin', 'manager', 'sales_rep', 'technician', 'support', 'viewer'], {
    error: 'Role must be admin, manager, sales_rep, technician, support, or viewer.',
  }),
  scope: z.enum(['self', 'assigned', 'team', 'department', 'company'], { error: 'Invalid scope.' }).optional(),
  team_id: z.string().uuid().nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
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

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');

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
        token,
        invited_by: auth.user.id,
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (createError) {
      console.error('[invitations/send] create error:', createError.message);
      return res.status(500).json({ error: 'Failed to create invitation.' });
    }

    // Get org name for the email
    const { data: org } = await admin
      .from('orgs')
      .select('name')
      .eq('id', auth.orgId)
      .maybeSingle();

    const orgName = org?.name || 'Your organization';
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const inviteLink = `${baseUrl}/invite/${token}`;

    // Send invitation email via Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(resendApiKey);
        await resend.emails.send({
          from: 'Lume CRM <noreply@lume.crm>',
          to: email,
          subject: `You've been invited to join ${orgName} on Lume CRM`,
          html: `
            <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
              <h1 style="font-size: 20px; font-weight: 700; margin-bottom: 16px;">You're invited!</h1>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                You've been invited to join <strong>${orgName}</strong> as a <strong>${role}</strong> on Lume CRM.
              </p>
              <a href="${inviteLink}" style="display: inline-block; margin-top: 24px; padding: 12px 28px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
                Accept Invitation
              </a>
              <p style="font-size: 12px; color: #999; margin-top: 24px;">
                This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.
              </p>
            </div>
          `,
        });
      } catch (emailErr: any) {
        console.error('[invitations/send] email error:', emailErr.message);
        // Don't fail the invitation if email fails
      }
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

router.post('/invitations/accept', validate(acceptInviteSchema), async (req, res) => {
  try {
    const { token, password, full_name } = req.body;
    const admin = getServiceClient();

    // Find invitation by token
    const { data: invitation, error: findError } = await admin
      .from('invitations')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .maybeSingle();

    if (findError || !invitation) {
      return res.status(404).json({ error: 'Invitation not found or already used.' });
    }

    // Check expiration
    if (new Date(invitation.expires_at) < new Date()) {
      await admin
        .from('invitations')
        .update({ status: 'expired' })
        .eq('id', invitation.id);
      return res.status(410).json({ error: 'This invitation has expired.' });
    }

    // Create the user via Supabase Auth admin API
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: invitation.email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });

    if (authError) {
      // If user already exists, try to get their ID
      if (authError.message?.includes('already been registered') || authError.message?.includes('already exists')) {
        // User exists — check if they're already a member
        const { data: existingUsers } = await admin.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find(
          (u: any) => u.email?.toLowerCase() === invitation.email.toLowerCase()
        );

        if (!existingUser) {
          return res.status(400).json({ error: 'User account issue. Please contact support.' });
        }

        // Check if already a member of this org
        const { data: existingMem } = await admin
          .from('memberships')
          .select('user_id')
          .eq('user_id', existingUser.id)
          .eq('org_id', invitation.org_id)
          .maybeSingle();

        if (existingMem) {
          // Already a member — mark invitation as accepted
          await admin
            .from('invitations')
            .update({ status: 'accepted', accepted_at: new Date().toISOString() })
            .eq('id', invitation.id);
          return res.json({ message: 'You are already a member of this organization.' });
        }

        // Add them as a member
        const { error: memError } = await admin
          .from('memberships')
          .insert({
            user_id: existingUser.id,
            org_id: invitation.org_id,
            role: invitation.role,
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

router.get('/invitations/verify/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const admin = getServiceClient();

    const { data: invitation, error } = await admin
      .from('invitations')
      .select('id, email, role, org_id, status, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (error || !invitation) {
      return res.status(404).json({ error: 'Invitation not found.' });
    }

    if (invitation.status !== 'pending') {
      return res.status(410).json({ error: 'This invitation has already been used.', status: invitation.status });
    }

    if (new Date(invitation.expires_at) < new Date()) {
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

    // Generate new token and extend expiry
    const newToken = crypto.randomBytes(32).toString('hex');
    const { error: updateError } = await admin
      .from('invitations')
      .update({
        token: newToken,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'pending',
      })
      .eq('id', invitationId);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to resend invitation.' });
    }

    // Re-send email (same logic as send)
    const { data: org } = await admin
      .from('orgs')
      .select('name')
      .eq('id', auth.orgId)
      .maybeSingle();

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const inviteLink = `${baseUrl}/invite/${newToken}`;
    const resendApiKey = process.env.RESEND_API_KEY;

    if (resendApiKey) {
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(resendApiKey);
        await resend.emails.send({
          from: 'Lume CRM <noreply@lume.crm>',
          to: invitation.email,
          subject: `Reminder: You've been invited to ${org?.name || 'an organization'} on Lume CRM`,
          html: `
            <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
              <h1 style="font-size: 20px; font-weight: 700;">Reminder: You're invited!</h1>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                You've been invited to join <strong>${org?.name || 'an organization'}</strong> on Lume CRM.
              </p>
              <a href="${inviteLink}" style="display: inline-block; margin-top: 24px; padding: 12px 28px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
                Accept Invitation
              </a>
              <p style="font-size: 12px; color: #999; margin-top: 24px;">This invitation expires in 7 days.</p>
            </div>
          `,
        });
      } catch {}
    }

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

    // Set status to suspended instead of deleting
    const { error } = await admin
      .from('memberships')
      .update({ status: 'suspended' })
      .eq('user_id', userId)
      .eq('org_id', auth.orgId);

    if (error) {
      return res.status(500).json({ error: 'Failed to remove member.' });
    }

    return res.json({ message: 'Member removed from organization.' });
  } catch (err: any) {
    console.error('[invitations/remove-member]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
