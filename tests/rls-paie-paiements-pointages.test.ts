/**
 * La base suit la page Rôles pour les paiements, la paie et les pointages.
 *
 * Mesuré par rôle via PostgREST sur staging avant la migration
 * 20261002800000 : un technicien lisait les 7 paiements clients, tout membre
 * lisait la paie de chaque employé, et n'importe quel membre pouvait modifier,
 * supprimer ou approuver les heures de n'importe qui. Après : voir la PR
 * (technicien 0 paiement, sa seule paie ; écritures d'autrui refusées).
 *
 * Ici on garde le CONTRAT de la migration : si quelqu'un réécrit une de ces
 * policies en « has_org_membership » seul, le test le voit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG = readFileSync(resolve(__dirname, '../supabase/migrations/20261002800000_rls_paie_paiements_pointages.sql'), 'utf8');
const policy = (nom: string) => {
  const i = MIG.indexOf(`create policy ${nom} `);
  expect(i, `policy ${nom} absente`).toBeGreaterThan(-1);
  return MIG.slice(i, MIG.indexOf(';', i));
};

describe('paiements : même règle que les factures', () => {
  it('lecture = membre ET voit les montants (technicien refusé par défaut)', () => {
    expect(policy('payments_select_org')).toContain('membre_voit_les_montants((select auth.uid()), org_id)');
  });
});

describe('paie : la sienne, ou tout pour propriétaire/admin', () => {
  for (const nom of ['payroll_payments_select', 'payroll_adjustments_select']) {
    it(nom, () => {
      const p = policy(nom);
      expect(p).toContain('user_id = (select auth.uid())');
      expect(p).toContain('has_org_admin_role((select auth.uid()), org_id)');
    });
  }
});

describe('pointages : écrire le sien ; supprimer et approuver = propriétaire/admin', () => {
  it('créer et modifier : son propre pointage, ou propriétaire/admin', () => {
    for (const nom of ['time_entries_insert_org', 'time_entries_update_org']) {
      expect(policy(nom)).toContain('employee_id = (select auth.uid()) or has_org_admin_role((select auth.uid()), org_id)');
    }
  });
  it('supprimer : propriétaire/admin seulement', () => {
    const p = policy('time_entries_delete_org');
    expect(p).toContain('has_org_admin_role((select auth.uid()), org_id)');
    expect(p).not.toContain('employee_id');
  });
  it('approuver ses propres heures est refusé par un déclencheur, heures approuvées gelées', () => {
    expect(MIG).toContain('before insert or update on public.time_entries');
    expect(MIG).toContain('new.approved_at is distinct from old.approved_at');
    expect(MIG).toContain('old.approved_at is not null');
    expect(MIG).toContain('revoke execute on function public.pointage_garde_approbation() from public, anon, authenticated;');
  });
});
