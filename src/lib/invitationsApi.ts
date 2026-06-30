import { supabase } from './supabase';

const API_BASE = '/api';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  // Office actif sélectionné dans le header — le serveur scope dessus quand
  // l'utilisateur en est membre (cf. requireAuthedClient).
  let activeOrg = '';
  try { activeOrg = localStorage.getItem('lume-active-org') || ''; } catch {}
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
    'x-org-id': activeOrg,
  };
}

// ── Types ────────────────────────────────────────────────────────

export type MemberRole = 'owner' | 'admin' | 'sales_rep' | 'technician';
export type MemberStatus = 'active' | 'pending' | 'suspended';
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface OrgMember {
  user_id: string;
  org_id: string;
  role: MemberRole;
  status: MemberStatus;
  permissions: Record<string, boolean> | null;
  created_at: string;
  full_name: string;
  avatar_url: string | null;
  email?: string;
}

export interface Invitation {
  id: string;
  org_id: string;
  email: string;
  role: MemberRole;
  token: string;
  invited_by: string;
  status: InvitationStatus;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface InvitationVerifyResult {
  invitation: {
    id: string;
    email: string;
    role: string;
    org_name: string;
  };
}

// ── API functions ────────────────────────────────────────────────

export async function fetchTeamList(): Promise<{ members: OrgMember[]; invitations: Invitation[] }> {
  const res = await fetch(`${API_BASE}/invitations/list`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to load team.');
  return res.json();
}

export type InviteScope = 'self' | 'assigned' | 'team' | 'company';

export async function sendInvitation(
  email: string,
  role: MemberRole,
  options?: { scope?: InviteScope; team_id?: string | null; org_id?: string },
): Promise<{ invitation: Invitation; invite_link: string; email_sent: boolean; email_skipped_reason?: string | null }> {
  const res = await fetch(`${API_BASE}/invitations/send`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      email,
      role,
      scope: options?.scope,
      team_id: options?.team_id ?? null,
      ...(options?.org_id ? { org_id: options.org_id } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || 'Failed to send invitation.') as Error & {
      code?: string;
      factorId?: string;
    };
    // Preserve the server's machine-readable code so the UI can react
    // (e.g. show the 2FA setup flow instead of a raw error toast).
    if (body.code) err.code = body.code;
    if (body.factor_id) err.factorId = body.factor_id;
    throw err;
  }
  return res.json();
}

export async function verifyInvitation(token: string): Promise<InvitationVerifyResult> {
  const res = await fetch(`${API_BASE}/invitations/verify/${token}`);
  if (!res.ok) throw new Error((await res.json()).error || 'Invalid invitation.');
  return res.json();
}

export async function acceptInvitation(token: string, password: string, full_name: string): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/invitations/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password, full_name }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to accept invitation.');
  return res.json();
}

export async function resendInvitation(invitationId: string): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/invitations/resend`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ invitationId }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to resend invitation.');
  return res.json();
}

export async function revokeInvitation(invitationId: string): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/invitations/revoke`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ invitationId }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to revoke invitation.');
  return res.json();
}

export async function updateMemberRole(memberId: string, role: MemberRole): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/invitations/update-role`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ memberId, role }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to update role.');
  return res.json();
}

export async function removeMember(userId: string): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/invitations/remove-member`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to remove member.');
  return res.json();
}
