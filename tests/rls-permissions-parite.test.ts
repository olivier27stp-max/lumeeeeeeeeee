/**
 * LA BASE ET L'INTERFACE PARLENT DE LA MÊME MATRICE DE PERMISSIONS.
 *
 * Audit bloc 3 (2026-09-10), C1/C2 : la RLS des tables d'argent ne
 * regardait que l'org — un technicien pouvait supprimer une facture par
 * PostgREST — et 50 des 66 permissions de la page Rôles n'étaient vérifiées
 * nulle part côté serveur. La migration 20260910120000 crée
 * member_has_permission() en base, qui reproduit hasPermission() du serveur,
 * avec une copie SQL de ROLE_PRESETS (role_permission_defaults).
 *
 * Deux copies d'une même vérité divergent un jour. Ce test compare le seed de
 * la migration à ROLE_PRESETS et la liste financière SQL à
 * FINANCIAL_PERMISSION_KEYS : changer l'un sans l'autre fait rougir la suite.
 * (La matrice réelle, par rôle, contre PostgREST : npm run qa:rls-roles.)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROLE_PRESETS, FINANCIAL_PERMISSION_KEYS, PERMISSION_KEYS } from '../src/lib/permissions';

const MIGRATION = resolve(__dirname, '../supabase/migrations/20260910120000_rls_permissions_par_role.sql');
const sql = readFileSync(MIGRATION, 'utf8');

function seedDeLaMigration(): Record<string, Set<string>> {
  const bloc = sql.slice(sql.indexOf('insert into public.role_permission_defaults'), sql.indexOf('on conflict do nothing'));
  const out: Record<string, Set<string>> = {};
  for (const m of bloc.matchAll(/\('([a-z_]+)', '([a-z_.]+)'\)/g)) {
    (out[m[1]] ??= new Set()).add(m[2]);
  }
  return out;
}

describe('role_permission_defaults ↔ ROLE_PRESETS', () => {
  const seed = seedDeLaMigration();

  for (const role of ['sales_rep', 'technician'] as const) {
    it(`${role} : mêmes clés accordées en SQL et en TypeScript`, () => {
      const preset = ROLE_PRESETS[role] as Record<string, boolean>;
      const attendu = new Set(Object.keys(preset).filter((k) => preset[k]));
      expect([...(seed[role] ?? [])].sort()).toEqual([...attendu].sort());
    });
  }

  it('owner et admin ne sont PAS dans le seed (résolus dans la fonction)', () => {
    expect(seed.owner).toBeUndefined();
    expect(seed.admin).toBeUndefined();
  });

  it('chaque clé du seed est une vraie clé de permission', () => {
    const connues = new Set(PERMISSION_KEYS as readonly string[]);
    for (const cles of Object.values(seed)) for (const k of cles) expect(connues.has(k), k).toBe(true);
  });
});

describe('la liste financière bloquée aux techniciens', () => {
  it('SQL et TypeScript listent les mêmes clés', () => {
    const m = sql.match(/financiere constant text\[\] := array\[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const enSql = [...m![1].matchAll(/'([a-z_.]+)'/g)].map((x) => x[1]).sort();
    expect(enSql).toEqual([...FINANCIAL_PERMISSION_KEYS].sort());
  });
});

describe('les policies d écriture portent la clé de la page Rôles', () => {
  const attendues: Array<[string, string]> = [
    ['invoices_insert_org', 'invoices.create'],
    ['invoices_update_org', 'invoices.update'],
    ['invoices_delete_org', 'invoices.delete'],
    ['quotes_insert', 'quotes.create'],
    ['quotes_update', 'quotes.update'],
    ['quotes_delete', 'quotes.delete'],
    ['payments_insert_org', 'payments.create'],
  ];
  for (const [policy, cle] of attendues) {
    it(`${policy} → ${cle}`, () => {
      const i = sql.indexOf(`create policy ${policy} `);
      expect(i, policy).toBeGreaterThan(-1);
      const corps = sql.slice(i, sql.indexOf(';', i));
      expect(corps).toContain(`member_has_permission((select auth.uid()), org_id, '${cle}')`);
    });
  }
  it('la suppression douce (PATCH deleted_at) exige la même clé que DELETE', () => {
    expect(sql).toContain("garde_suppression_douce('invoices.delete')");
    expect(sql).toContain("garde_suppression_douce('quotes.delete')");
  });
});
