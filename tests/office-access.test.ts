// Règles de Réglages → Bureaux → Accès (decideAccessChange).
import { describe, expect, it } from 'vitest';
import { decideAccessChange, type AccessMembershipRow } from '../server/lib/office-access';

const OWNER = 'owner-1';
const REP = 'rep-1';
const A = 'org-a';
const B = 'org-b';
const HORS = 'org-autre-entreprise';

const ligne = (org_id: string, role: string, status = 'active', user_id = REP, created_at = '2026-01-01'): AccessMembershipRow =>
  ({ user_id, org_id, role, status, created_at });

const decider = (rows: AccessMembershipRow[], targetOrgId: string, role: 'admin' | 'sales_rep' | 'technician' | null, targetUserId = REP) =>
  decideAccessChange({ callerId: OWNER, targetUserId, targetOrgId, groupOrgIds: [A, B], rows, role });

describe('decideAccessChange', () => {
  it('donne un bureau : insertion avec le profil de la plus ancienne adhésion', () => {
    const d = decider([ligne(A, 'sales_rep')], B, 'sales_rep');
    expect(d).toMatchObject({ kind: 'insert', role: 'sales_rep', source: { org_id: A } });
  });

  it('change le rôle dans un bureau existant', () => {
    expect(decider([ligne(A, 'sales_rep'), ligne(B, 'sales_rep')], B, 'admin')).toEqual({ kind: 'update', role: 'admin' });
  });

  it('même rôle = rien à faire', () => {
    expect(decider([ligne(A, 'sales_rep')], A, 'sales_rep')).toEqual({ kind: 'noop' });
  });

  it('retire un bureau quand il en reste un autre', () => {
    expect(decider([ligne(A, 'sales_rep'), ligne(B, 'technician')], B, null)).toEqual({ kind: 'delete' });
  });

  it('refuse de retirer le dernier bureau (= retirer de l\'entreprise, passe par Membres)', () => {
    expect(decider([ligne(A, 'sales_rep')], A, null)).toMatchObject({ kind: 'error', code: 'last_office' });
  });

  it('retirer un bureau où la personne n\'est pas = rien à faire', () => {
    expect(decider([ligne(A, 'sales_rep')], B, null)).toEqual({ kind: 'noop' });
  });

  it('ne touche jamais un propriétaire', () => {
    const rows = [ligne(A, 'owner', 'active', 'owner-2')];
    expect(decider(rows, B, null, 'owner-2')).toMatchObject({ kind: 'error', code: 'owner_all_offices' });
    expect(decider(rows, B, 'admin', 'owner-2')).toMatchObject({ kind: 'error', code: 'owner_all_offices' });
  });

  it('refuse un bureau d\'une autre entreprise', () => {
    expect(decider([ligne(A, 'sales_rep')], HORS, 'admin')).toMatchObject({ kind: 'error', status: 404, code: 'office_not_found' });
  });

  it('refuse une personne étrangère à l\'entreprise ou retirée partout', () => {
    expect(decider([], B, 'admin')).toMatchObject({ kind: 'error', code: 'not_a_member' });
    expect(decider([ligne(A, 'sales_rep', 'suspended')], B, 'admin')).toMatchObject({ kind: 'error', code: 'not_a_member' });
    // Une ligne d'une autre entreprise ne compte pas.
    expect(decider([ligne(HORS, 'admin')], B, 'admin')).toMatchObject({ kind: 'error', code: 'not_a_member' });
  });

  it('une adhésion suspendue se réactive par Membres, pas par la grille', () => {
    expect(decider([ligne(A, 'sales_rep'), ligne(B, 'sales_rep', 'suspended')], B, 'admin'))
      .toMatchObject({ kind: 'error', code: 'suspended' });
  });

  it('on ne modifie pas ses propres accès', () => {
    expect(decider([ligne(A, 'admin', 'active', OWNER)], B, 'admin', OWNER)).toMatchObject({ kind: 'error', code: 'self' });
  });

  it('refuse le rôle propriétaire (promotion = autre chemin)', () => {
    const d = decideAccessChange({
      callerId: OWNER, targetUserId: REP, targetOrgId: B, groupOrgIds: [A, B],
      rows: [ligne(A, 'sales_rep')], role: 'owner' as never,
    });
    expect(d).toMatchObject({ kind: 'error', code: 'invalid_role' });
  });
});
