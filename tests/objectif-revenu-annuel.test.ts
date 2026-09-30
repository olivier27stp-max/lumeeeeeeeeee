/**
 * L'objectif de revenu est ANNUEL (création d'espace : « Objectif de revenu
 * annuel », Réglages → Entreprise). Lumi le comparait tel quel au revenu du
 * MOIS : une entreprise à 10 000 $ / mois pour 120 000 $ / an se voyait
 * annoncer 8 % d'atteinte. L'objectif est maintenant ramené à la période.
 */
import { describe, it, expect } from 'vitest';
import { TOOLS_BY_NAME } from '../server/lib/agent/tools';

function ctx(revenuCents: number, objectifAnnuelCents: number) {
  const requete: any = { select: () => requete, eq: () => requete, maybeSingle: async () => ({ data: { revenue_goal_cents: objectifAnnuelCents }, error: null }) };
  return {
    orgId: 'org', userId: 'u',
    client: { rpc: async () => ({ data: [{ revenue_cents: revenuCents, invoiced_cents: revenuCents }], error: null }), from: () => requete },
  } as any;
}

describe('get_revenue_summary : objectif annuel ramené à la période', () => {
  const outil = TOOLS_BY_NAME.get_revenue_summary;

  it('ce mois-ci : objectif annuel / 12 (120 000 $ → 10 000 $), 10 000 $ faits = 100 %', async () => {
    const r: any = await outil.handler!({ period: 'this_month' }, ctx(1_000_000, 12_000_000));
    expect(r.goal_annual_cents).toBe(12_000_000);
    expect(r.goal_cents).toBe(1_000_000);
    expect(r.goal_progress_pct).toBe(100);
  });

  it('cette année : l objectif annuel tel quel', async () => {
    const r: any = await outil.handler!({ period: 'this_year' }, ctx(6_000_000, 12_000_000));
    expect(r.goal_cents).toBe(12_000_000);
    expect(r.goal_progress_pct).toBe(50);
  });

  it('30 derniers jours : 30/365 de l objectif annuel', async () => {
    const r: any = await outil.handler!({ period: 'last_30_days' }, ctx(0, 36_500_000));
    expect(r.goal_cents).toBe(3_000_000);
  });

  it('sans objectif : pas de pourcentage inventé', async () => {
    const r: any = await outil.handler!({}, ctx(500_000, 0));
    expect(r.goal_cents).toBe(0);
    expect(r.goal_progress_pct).toBeNull();
  });
});
