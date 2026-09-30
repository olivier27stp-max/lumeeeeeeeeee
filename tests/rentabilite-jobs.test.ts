/**
 * RENTABILITÉ DES JOBS — une seule définition, en base.
 *
 * Avant (catalogue de tâches Lumi, 2026-09-29) :
 *  - rpc_insights_job_profitability lisait jobs.cost_cents (colonne
 *    inexistante) → marge toujours 100 %, et un technicien pouvait la lire ;
 *  - la fiche de job affichait main-d'œuvre et dépenses « 0,00 $ » en dur ;
 *  - la carte des Statistiques comptait les taxes dans le revenu.
 * Le comportement SQL a été éprouvé sur staging (voir la PR) ; ici on garde
 * le contrat : ce que la migration promet et ce que le client en fait.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const racine = resolve(__dirname, '..');
const MIG = readFileSync(resolve(racine, 'supabase/migrations/20261002750000_rentabilite_jobs.sql'), 'utf8');
const corps = (fn: string) => {
  const debut = MIG.indexOf(`create or replace function public.${fn}(`);
  return MIG.slice(debut, MIG.indexOf('$function$;', debut));
};

describe('migration rentabilite_jobs', () => {
  it('le résumé des Statistiques ne lit plus la colonne fantôme jobs.cost_cents', () => {
    expect(corps('rpc_insights_job_profitability')).not.toMatch(/[.(]cost_cents/);
    expect(corps('rpc_insights_job_profitability')).toContain('from public.rentabilite_jobs(');
  });

  it('revenu AVANT taxes, main-d’œuvre pointée sur le job × taux de la paie, dépenses du job', () => {
    const f = corps('rentabilite_jobs');
    expect(f).toContain('coalesce(j.subtotal_cents, 0)');
    expect(f).not.toMatch(/j\.total_cents/);
    expect(f).toContain('te.job_id in (select js.id from js)');
    expect(f).toContain('tm.hourly_rate_cents');
    expect(f).toContain('coalesce(j.expenses_cents, 0)');
  });

  it('les deux fonctions exigent la permission des marges (page Rôles)', () => {
    for (const fn of ['rentabilite_jobs', 'rpc_insights_job_profitability']) {
      expect(corps(fn)).toContain("'financial.view_margins'");
    }
  });

  it('fermées à anon : avec auth.uid() nul, la garde serait sautée', () => {
    expect(MIG).toContain('revoke execute on function public.rentabilite_jobs(uuid, date, date, uuid) from public, anon;');
    expect(MIG).toContain('revoke execute on function public.rpc_insights_job_profitability(uuid, date, date) from public, anon;');
  });
});

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../src/lib/orgApi', () => ({ getCurrentOrgIdOrThrow: async () => 'org-1' }));

describe('client : fetchJobPnL et la fiche de job lisent la fonction en base', () => {
  it('les totaux viennent des lignes de rentabilite_jobs', async () => {
    rpc.mockResolvedValueOnce({ data: [
      { job_id: 'a', job_number: '106', client_nom: 'Marie Tremblay', revenu_cents: 40000, heures: 14, main_oeuvre_cents: 32900, depenses_cents: 8000, profit_cents: -900, marge_pct: -2.3 },
      { job_id: 'b', job_number: '101', client_nom: 'Isabelle Morin', revenu_cents: 24000, heures: 2, main_oeuvre_cents: 5000, depenses_cents: 1500, profit_cents: 17500, marge_pct: 72.9 },
    ], error: null });
    const { fetchJobPnL } = await import('../src/lib/profitabilityApi');
    const r = await fetchJobPnL({ from: '2026-09-01', to: '2026-09-30' });
    expect(rpc).toHaveBeenCalledWith('rentabilite_jobs', { p_org: 'org-1', p_from: '2026-09-01', p_to: '2026-09-30' });
    expect(r.total_revenue_cents).toBe(64000);
    expect(r.total_labour_cents).toBe(37900);
    expect(r.total_expenses_cents).toBe(9500);
    expect(r.total_profit_cents).toBe(16600);
    expect(r.rows.find((x) => x.job_number === '106')!.profit_cents).toBe(-900);
  });

  it('fiche de job sans la permission des marges → null (pas d’erreur affichée)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Permission refusée' } });
    const { fetchJobPnLForJob } = await import('../src/lib/profitabilityApi');
    expect(await fetchJobPnLForJob('a')).toBeNull();
  });

  it('la fiche de job n’affiche plus de main-d’œuvre ni de dépenses écrites en dur', () => {
    const src = readFileSync(resolve(racine, 'src/pages/JobDetails.tsx'), 'utf8');
    expect(src).not.toMatch(/Labour'\} value="\$0\.00"/);
    expect(src).not.toMatch(/Expenses'\} value="\$0\.00"/);
    expect(src).toContain('fetchJobPnLForJob(id)');
  });
});
