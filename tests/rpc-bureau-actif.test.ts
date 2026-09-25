// Les RPC de liste/KPI qui acceptent p_org doivent TOUJOURS recevoir le bureau actif du
// navigateur. Avec p_org null, current_org_id() en base retombe sur la plus ancienne
// adhésion de l'utilisateur : un propriétaire de deux bureaux voyait la page Factures de
// l'autre bureau (Vision Lavage, 2026-09-24 : 15 factures affichées au lieu de 645) alors
// que la page Clients, qui passe l'org explicitement, montrait le bon bureau.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function fichiers(dossier: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dossier)) {
    const p = join(dossier, n);
    if (statSync(p).isDirectory()) out.push(...fichiers(p));
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

describe('bureau actif sur les RPC', () => {
  const racine = resolve(process.cwd(), 'src');
  const sources = fichiers(racine).map((f) => [f.replace(`${process.cwd()}/`, ''), readFileSync(f, 'utf8')] as const);

  it("aucun appel ne passe p_org: null (la base choisirait le mauvais bureau)", () => {
    const fautifs = sources.filter(([, s]) => /p_org:\s*null\b/.test(s)).map(([f]) => f);
    expect(fautifs).toEqual([]);
  });

  it('les listes et KPI factures/paiements passent le bureau actif', () => {
    const inv = readFileSync(resolve(process.cwd(), 'src/lib/invoicesApi.ts'), 'utf8');
    const pay = readFileSync(resolve(process.cwd(), 'src/lib/paymentsApi.ts'), 'utf8');
    const page = readFileSync(resolve(process.cwd(), 'src/pages/Invoices.tsx'), 'utf8');
    expect(inv).toContain("supabase.rpc('rpc_invoices_kpis_30d', { p_org: await getCurrentOrgIdOrThrow() })");
    expect(inv.match(/p_org: await getCurrentOrgIdOrThrow\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(pay).toContain("import { getCurrentOrgIdOrThrow } from './orgApi';");
    expect(pay.match(/p_org: await getCurrentOrgIdOrThrow\(\)/g)?.length ?? 0).toBe(2);
    expect(page).toContain('p_org: await getCurrentOrgIdOrThrow()');
  });
});
