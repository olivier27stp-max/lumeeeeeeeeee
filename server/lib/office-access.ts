// Règles pures de Réglages → Bureaux → Accès (PUT /orgs/offices/access).
// Un bureau = un org du company_group ; avoir accès = une ligne memberships
// dans ce bureau. Les propriétaires ont tous les bureaux d'office (trigger
// propager_proprietaires_bureaux) : ils ne passent jamais par ici.

export const OFFICE_ROLES = ['admin', 'sales_rep', 'technician'] as const;
export type OfficeRole = (typeof OFFICE_ROLES)[number];

export interface AccessMembershipRow {
  user_id: string;
  org_id: string;
  role: string;
  status: string | null;
  created_at?: string | null;
}

export type AccessDecision =
  | { kind: 'noop' }
  | { kind: 'insert'; role: OfficeRole; source: AccessMembershipRow }
  | { kind: 'update'; role: OfficeRole }
  | { kind: 'delete' }
  | { kind: 'error'; status: number; code: string; error: string };

const actif = (m: AccessMembershipRow) => (m.status ?? 'active') === 'active';

/**
 * Décide l'effet d'un changement de case (personne × bureau).
 * `rows` = toutes les adhésions de la personne dans les bureaux du groupe.
 */
export function decideAccessChange(input: {
  callerId: string;
  targetUserId: string;
  targetOrgId: string;
  groupOrgIds: string[];
  rows: AccessMembershipRow[];
  role: OfficeRole | null;
}): AccessDecision {
  const { callerId, targetUserId, targetOrgId, groupOrgIds, role } = input;
  const rows = input.rows.filter((r) => r.user_id === targetUserId && groupOrgIds.includes(r.org_id));

  if (!groupOrgIds.includes(targetOrgId)) {
    return { kind: 'error', status: 404, code: 'office_not_found', error: 'Office not found in this company.' };
  }
  if (targetUserId === callerId) {
    return { kind: 'error', status: 400, code: 'self', error: 'You cannot change your own office access.' };
  }
  const actives = rows.filter(actif);
  if (actives.length === 0) {
    // Ni inconnu ni membre retiré : on n'ajoute ici que des gens déjà dans
    // l'entreprise (une nouvelle personne passe par une invitation).
    return { kind: 'error', status: 404, code: 'not_a_member', error: 'This person is not an active member of the company.' };
  }
  if (actives.some((r) => r.role === 'owner')) {
    return { kind: 'error', status: 409, code: 'owner_all_offices', error: 'Owners always have access to every office.' };
  }

  const existing = rows.find((r) => r.org_id === targetOrgId) || null;

  if (role === null) {
    if (!existing) return { kind: 'noop' };
    const autresActifs = actives.filter((r) => r.org_id !== targetOrgId);
    if (actif(existing) && autresActifs.length === 0) {
      return {
        kind: 'error',
        status: 409,
        code: 'last_office',
        error: 'This is their only office. Remove them from the team instead.',
      };
    }
    return { kind: 'delete' };
  }

  if (!(OFFICE_ROLES as readonly string[]).includes(role)) {
    return { kind: 'error', status: 400, code: 'invalid_role', error: 'Invalid role.' };
  }
  if (existing) {
    if (existing.role === role && actif(existing)) return { kind: 'noop' };
    // Une adhésion suspendue a été retirée via Équipe : la réactiver passe
    // par « Réactiver l'accès » (gate de sièges), pas par cette grille.
    if (!actif(existing)) {
      return { kind: 'error', status: 409, code: 'suspended', error: 'This member was removed from this office. Reactivate them from the team page.' };
    }
    return { kind: 'update', role };
  }
  // Source = plus ancienne adhésion active : on en recopie le profil
  // (nom, paie, horaire) pour que la paie et l'horaire suivent la personne.
  const source = [...actives].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))[0];
  return { kind: 'insert', role, source };
}

/** Colonnes du profil d'un membre recopiées vers un nouveau bureau. */
export const PROFIL_COPIE = [
  'full_name',
  'avatar_url',
  'language',
  'experience_level',
  'show_on_leaderboard',
  'hourly_rate_cents',
  'labour_cost_hourly',
  'compensation_mode',
  'working_hours',
  'communication_preferences',
] as const;
