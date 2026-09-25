// Bureau actif de bout en bout : le navigateur l'envoie (x-lume-org), la base le lit
// dans current_org_id(). Sans ça, un compte à deux bureaux travaillait dans la plus
// ancienne adhésion côté base (Vision Lavage, 2026-09-24 : 15 factures au lieu de 645).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lu = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('en-tête x-lume-org', () => {
  it('le client Supabase du navigateur pose l\'en-tête depuis lume-active-org (même clé que CompanyContext)', () => {
    const s = lu('src/lib/supabase.ts');
    expect(s).toContain("const CLE_BUREAU_ACTIF = 'lume-active-org';");
    expect(lu('src/contexts/CompanyContext.tsx')).toContain("const STORAGE_KEY = 'lume-active-org';");
    expect(lu('src/lib/orgApi.ts')).toContain("const STORAGE_KEY = 'lume-active-org';");
    expect(s).toContain("headers.set('x-lume-org', org);");
    expect(s).toContain('global: { fetch: fetchAvecBureauActif },');
  });

  it('la migration redéfinit current_org_id() en lisant l\'en-tête AVANT le repli sur la plus ancienne adhésion', () => {
    const sql = lu('supabase/migrations/20260926120000_current_org_id_bureau_actif.sql');
    expect(sql).toContain('create or replace function public.current_org_id()');
    const iHeader = sql.indexOf("->> 'x-lume-org'");
    const iMembership = sql.indexOf("has_org_membership(v_user, v_org)");
    const iRepli = sql.indexOf('order by m.created_at asc, m.org_id asc');
    expect(iHeader).toBeGreaterThan(-1);
    expect(iMembership).toBeGreaterThan(iHeader); // l'adhésion est vérifiée juste après la lecture
    expect(iRepli).toBeGreaterThan(iHeader);
    // un en-tête forgé (pas un uuid, ou bureau étranger) ne fait jamais planter : bloc exception
    expect(sql).toContain('exception when others then');
    expect(sql).toMatch(/v_header_org ~\* '\^\[0-9a-f\]\{8\}/);
  });
});
