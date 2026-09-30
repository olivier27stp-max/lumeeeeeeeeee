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
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc, auth: { getSession: async () => ({ data: { session: { access_token: 'jeton' } } }) } } }));
vi.mock('../src/lib/orgApi', () => ({ getCurrentOrgIdOrThrow: async () => 'org-1', getCurrentOrgId: async () => 'org-1' }));

// Depuis analyze_profitability, l'écran lit la route serveur (même calcul que Lumi), plus la fonction SQL.
describe('client : fetchJobPnL et la fiche de job lisent l’action serveur', () => {
  const reponse = (statut: number, corps: unknown) => ({ status: statut, ok: statut < 400, json: async () => corps });

  it('les lignes et totaux viennent de GET /api/profitability', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reponse(200, {
      completude: 'partielle', marge_est_un_maximum: true, resume_fr: 'phrase', resume_en: 'sentence',
      totaux: { revenus_cents: 64000, main_oeuvre_cents: 37900, commissions_cents: 0, depenses_cents: 9500, profit_cents: 16600, marge_pct: 25.9 },
      groupes: [
        { cle: 'a', numero: '106', client: 'Marie Tremblay', revenus_cents: 40000, heures: 14, main_oeuvre_cents: 32900, commissions_cents: 0, depenses_cents: 8000, profit_cents: -900, marge_pct: -2.3, completude: 'complete', marge_est_un_maximum: false, depenses_saisie_libre: true },
        { cle: 'b', numero: '101', client: 'Isabelle Morin', revenus_cents: 24000, heures: 2, main_oeuvre_cents: 5000, commissions_cents: 0, depenses_cents: 1500, profit_cents: 17500, marge_pct: 72.9, completude: 'partielle', marge_est_un_maximum: true, depenses_saisie_libre: false },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchJobPnL } = await import('../src/lib/profitabilityApi');
    const r = await fetchJobPnL({ from: '2026-09-01', to: '2026-09-30' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/^\/api\/profitability\?/);
    expect(String(url)).toContain('date_from=2026-09-01');
    expect(String(url)).toContain('date_to=2026-09-30');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jeton', 'x-org-id': 'org-1' });
    expect(rpc).not.toHaveBeenCalled();
    expect(r.total_revenue_cents).toBe(64000);
    expect(r.total_profit_cents).toBe(16600);
    expect(r.margin_is_maximum).toBe(true);
    expect(r.rows.find((x) => x.job_number === '106')!.profit_cents).toBe(-900);
    expect(r.rows.find((x) => x.job_number === '101')!.expenses_editable).toBe(false);
    vi.unstubAllGlobals();
  });

  it('fiche de job sans la permission des marges → null (pas d’erreur affichée)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reponse(403, { error: 'refus', code: 'permission' })));
    const { fetchJobPnLForJob } = await import('../src/lib/profitabilityApi');
    expect(await fetchJobPnLForJob('a')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('la fiche de job n’affiche plus de main-d’œuvre ni de dépenses écrites en dur', () => {
    const src = readFileSync(resolve(racine, 'src/pages/JobDetails.tsx'), 'utf8');
    expect(src).not.toMatch(/Labour'\} value="\$0\.00"/);
    expect(src).not.toMatch(/Expenses'\} value="\$0\.00"/);
    expect(src).toContain('fetchJobPnLForJob(id)');
  });
});
