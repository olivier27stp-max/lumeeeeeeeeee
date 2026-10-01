/**
 * Garde contre l'ESCALADE DE DROITS (audit des outils de Lumi, 2026-09-30).
 * ─────────────────────────────────────────────────────────────────────────
 * Les routes des rôles et des invitations écrivent avec le client service :
 * le trigger « personne ne modifie ses propres droits » ne s'y applique pas.
 * Un admin pouvait donc, par l'écran ou par Lumi :
 *   - se redonner des permissions que le propriétaire lui avait retirées ;
 *   - modifier le rôle « Admin » (lui compris) ou les droits d'un autre admin ;
 *   - donner à un employé une permission qu'il n'a pas lui-même ;
 *   - nommer un admin (invitation, promotion) ou réactiver un admin suspendu.
 *
 * Règle : le PROPRIÉTAIRE peut tout. Tout autre appelant ne touche ni à ses
 * propres droits, ni à un admin, ni au rôle Admin, et ne peut activer que des
 * permissions qu'il a déjà. Seules les clés qui PASSENT à « oui » comptent :
 * sauvegarder un modèle qui contient déjà une clé que l'appelant n'a pas ne
 * le bloque pas.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getUserContext, hasPermission } from './rbac';
import type { PermissionKey } from '../../src/lib/permissions';

export interface DemandeDroits {
  /** Membre visé (changement de rôle, permissions, réactivation). */
  cibleUserId?: string | null;
  /** Rôle ACTUEL du membre visé. */
  cibleRoleActuel?: string | null;
  /** Rôle donné (invitation, changement de rôle). */
  cibleRoleNouveau?: string | null;
  /** Modèle de rôle modifié (page Rôles). */
  presetRole?: string | null;
  permissionsNouvelles?: Record<string, boolean> | null;
  permissionsActuelles?: Record<string, boolean> | null;
}

/** null = autorisé ; sinon la phrase à renvoyer (403). */
export async function refusEscalade(admin: SupabaseClient, appelantId: string, orgId: string, d: DemandeDroits): Promise<string | null> {
  const ctx = await getUserContext(admin, appelantId, orgId);
  if (!ctx) return 'Accès refusé.';
  if (ctx.role === 'owner') return null;

  if (d.cibleUserId && d.cibleUserId === appelantId) {
    return 'Tu ne peux pas modifier tes propres droits : demande au propriétaire de l’entreprise.';
  }
  if (d.cibleRoleActuel === 'admin' || d.cibleRoleActuel === 'owner') {
    return 'Seul le propriétaire de l’entreprise peut modifier les droits d’un admin.';
  }
  if (d.cibleRoleNouveau === 'admin' || d.cibleRoleNouveau === 'owner') {
    return 'Seul le propriétaire de l’entreprise peut nommer un admin.';
  }
  if (d.presetRole === 'admin') {
    return 'Seul le propriétaire de l’entreprise peut modifier le rôle Admin.';
  }
  const nouvelles = d.permissionsNouvelles ?? {};
  const actuelles = d.permissionsActuelles ?? {};
  const interdites = Object.entries(nouvelles)
    .filter(([cle, oui]) => oui === true && actuelles[cle] !== true)
    .filter(([cle]) => cle === 'users.delete' || !hasPermission(ctx, cle as PermissionKey))
    .map(([cle]) => cle);
  if (interdites.length) {
    return `Tu ne peux pas donner une permission que tu n’as pas toi-même (${interdites.slice(0, 5).join(', ')}${interdites.length > 5 ? '…' : ''}). Demande au propriétaire.`;
  }
  return null;
}

/** Permissions du modèle d'un rôle pour cette org (Rôles), sinon les préréglages Lume. */
export async function permissionsDuRole(admin: SupabaseClient, orgId: string, role: string): Promise<Record<string, boolean> | null> {
  const { data } = await admin.from('role_templates').select('permissions').eq('org_id', orgId).eq('slug', role).maybeSingle();
  if (data?.permissions && typeof data.permissions === 'object') return data.permissions as Record<string, boolean>;
  const { ROLE_PRESETS } = await import('../../src/lib/permissions');
  return (ROLE_PRESETS as Record<string, Record<string, boolean>>)[role] ?? null;
}
