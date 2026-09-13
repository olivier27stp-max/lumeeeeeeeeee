// Invitations d'équipe lancées depuis un formulaire de création (workspace
// à l'onboarding, nouveau workspace en cours d'app). Insère une invitation
// en attente + déclenche le courriel Supabase. Idempotent : une invitation
// déjà en attente pour le même courriel est sautée.
//
// Le flux complet vit dans /api/invitations/send ; on duplique le cœur ici
// pour éviter un aller-retour HTTP interne pendant la création.

import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBaseUrl } from './config';

export type InviteRole = 'admin' | 'technician' | 'sales_rep';

export interface InviteInput {
  email: string;
  role: InviteRole;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function processInvites(
  admin: SupabaseClient,
  orgId: string,
  invitedBy: string,
  invites: InviteInput[],
  logPrefix = '[invites]',
): Promise<Array<{ email: string; role: string }>> {
  const sent: Array<{ email: string; role: string }> = [];
  for (const invite of invites) {
    try {
      const email = invite.email.toLowerCase();
      const { data: existing } = await admin
        .from('invitations')
        .select('id')
        .eq('org_id', orgId)
        .eq('email', email)
        .eq('status', 'pending')
        .maybeSingle();
      if (existing) continue;

      const token = crypto.randomBytes(32).toString('hex');
      const token_hash = hashToken(token);
      const { error: insErr } = await admin.from('invitations').insert({
        org_id: orgId,
        email,
        role: invite.role,
        token: null,
        token_hash,
        invited_by: invitedBy,
        status: 'pending',
        expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      });
      if (insErr) {
        console.warn(`${logPrefix} invitation insert failed:`, insErr.message);
        continue;
      }

      // Best-effort : le courriel d'invitation Supabase permet de réclamer le compte.
      try {
        const redirectTo = `${getBaseUrl()}/invite/${token}`;
        await (admin.auth.admin as any).inviteUserByEmail(email, {
          data: { invited_to_org: orgId, role: invite.role },
          redirectTo,
        });
      } catch (mailErr: any) {
        console.warn(`${logPrefix} inviteUserByEmail failed:`, mailErr?.message);
      }
      sent.push({ email, role: invite.role });
    } catch (err: any) {
      console.warn(`${logPrefix} invite loop error:`, err?.message);
    }
  }
  return sent;
}
