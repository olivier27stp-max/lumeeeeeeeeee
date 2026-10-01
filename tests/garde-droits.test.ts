/**
 * Escalade de droits (audit des outils de Lumi, 2026-09-30) : un admin ne se
 * redonne pas de droits, ne touche pas à un admin, ne nomme pas d'admin et
 * n'active pas une permission qu'il n'a pas. Le propriétaire peut tout.
 */
import { describe, it, expect, vi } from 'vitest';

const { contextes } = vi.hoisted(() => ({ contextes: new Map<string, any>() }));
vi.mock('../server/lib/rbac', () => ({
  getUserContext: async (_c: unknown, userId: string) => contextes.get(userId) ?? null,
  hasPermission: (ctx: any, k: string) => ctx.role === 'owner' || ctx.permissions?.[k] === true,
}));

import { refusEscalade } from '../server/lib/garde-droits';

const PROPRIO = 'u-proprio';
const ADMIN = 'u-admin';
const REP = 'u-rep';
contextes.set(PROPRIO, { role: 'owner', permissions: {} });
contextes.set(ADMIN, { role: 'admin', permissions: { 'invoices.read': true, 'quotes.update': true } });
const db = {} as any;

describe('refusEscalade', () => {
  it('le propriétaire peut tout', async () => {
    expect(await refusEscalade(db, PROPRIO, 'o', { cibleUserId: ADMIN, cibleRoleActuel: 'admin', permissionsNouvelles: { 'users.delete': true } })).toBeNull();
    expect(await refusEscalade(db, PROPRIO, 'o', { presetRole: 'admin', permissionsNouvelles: { 'financial.view_margins': true } })).toBeNull();
  });

  it('un admin ne modifie pas ses propres droits (ni remise à zéro)', async () => {
    expect(await refusEscalade(db, ADMIN, 'o', { cibleUserId: ADMIN, cibleRoleActuel: 'admin', permissionsNouvelles: {} })).toMatch(/propres droits/);
  });

  it('un admin ne touche pas à un autre admin, ne nomme pas d’admin, ne modifie pas le rôle Admin', async () => {
    expect(await refusEscalade(db, ADMIN, 'o', { cibleUserId: 'u-autre-admin', cibleRoleActuel: 'admin' })).toMatch(/admin/);
    expect(await refusEscalade(db, ADMIN, 'o', { cibleUserId: REP, cibleRoleActuel: 'sales_rep', cibleRoleNouveau: 'admin' })).toMatch(/nommer un admin/);
    expect(await refusEscalade(db, ADMIN, 'o', { cibleRoleNouveau: 'admin' })).toMatch(/nommer un admin/); // invitation
    expect(await refusEscalade(db, ADMIN, 'o', { presetRole: 'admin', permissionsNouvelles: {} })).toMatch(/rôle Admin/);
  });

  it('un admin n’active pas une permission qu’il n’a pas ; users.delete jamais', async () => {
    expect(await refusEscalade(db, ADMIN, 'o', { cibleUserId: REP, cibleRoleActuel: 'sales_rep', permissionsNouvelles: { 'financial.view_margins': true }, permissionsActuelles: {} }))
      .toMatch(/financial\.view_margins/);
    expect(await refusEscalade(db, ADMIN, 'o', { cibleUserId: REP, cibleRoleActuel: 'sales_rep', permissionsNouvelles: { 'users.delete': true }, permissionsActuelles: {} }))
      .toMatch(/users\.delete/);
  });

  it('ce que l’admin a lui-même, il peut le donner ; une clé déjà active ne bloque pas la sauvegarde', async () => {
    expect(await refusEscalade(db, ADMIN, 'o', { cibleUserId: REP, cibleRoleActuel: 'sales_rep', permissionsNouvelles: { 'quotes.update': true }, permissionsActuelles: {} })).toBeNull();
    // Le modèle Vendeur contient déjà financial.view_margins (mis par le propriétaire) : l'admin peut sauvegarder autre chose.
    expect(await refusEscalade(db, ADMIN, 'o', {
      presetRole: 'sales_rep',
      permissionsNouvelles: { 'financial.view_margins': true, 'quotes.update': true },
      permissionsActuelles: { 'financial.view_margins': true },
    })).toBeNull();
  });

  it('réactiver un technicien : permis ; réactiver un admin : propriétaire seulement', async () => {
    expect(await refusEscalade(db, ADMIN, 'o', { cibleUserId: 'u-tech', cibleRoleActuel: 'technician' })).toBeNull();
    expect(await refusEscalade(db, ADMIN, 'o', { cibleUserId: 'u-autre-admin', cibleRoleActuel: 'admin' })).not.toBeNull();
  });
});
