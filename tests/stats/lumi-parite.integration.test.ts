/**
 * PARITÉ page ↔ Lumi : pour une même question, Lumi (outils MCP/Lumi réels) et la page
 * Statistiques doivent annoncer le même chiffre — et ce chiffre doit être celui de l'oracle.
 * « Aujourd'hui » est figé : mercredi 30 septembre 2026, en journée PUIS à 21 h (Toronto),
 * l'heure où un serveur en UTC est déjà le 1er octobre.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// analyserRentabilite lit les permissions avec getServiceClient() : dans vitest, il pointe vers une URL
// factice (vitest.setup.ts). On le branche sur la stack locale, en service_role.
vi.mock('../../server/lib/supabase', async (orig) => {
  const vrai = await orig<typeof import('../../server/lib/supabase')>();
  const { clientComme: comme } = await import('./harnais');
  const service = comme('service_role'); // signé à l'heure RÉELLE, avant toute horloge figée
  return { ...vrai, getServiceClient: () => service };
});

import type pg from 'pg';
import { ACTIF, P, T1, U, base, clientComme, somme } from './harnais';
import * as O from './oracle';
import { TOOLS_BY_NAME, type ToolContext } from '../../server/lib/agent/tools';
import { analyserRentabilite, viderCacheRentabilite } from '../../server/lib/rentabilite';

const MIDI = new Date('2026-09-30T16:00:00Z');
const SOIR = new Date('2026-10-01T01:00:00Z'); // 30 septembre, 21 h à Toronto

let db: pg.Client;
// Jeton signé à l'heure RÉELLE (avant de figer l'horloge) : un iat « dans le futur » serait refusé par PostgREST.
let client: ReturnType<typeof clientComme>;
const ctx = (): ToolContext => ({ client, orgId: T1, userId: U.proprio });
const lire = async (nom: string, args: Record<string, unknown> = {}) => {
  const outil = TOOLS_BY_NAME[nom];
  if (!outil) throw new Error(`outil ${nom} introuvable`);
  return outil.handler!(args, ctx()) as Promise<any>; // présent sur tout outil de lecture
};

describe.skipIf(!ACTIF)('Statistiques — parité avec Lumi', () => {
  beforeAll(async () => {
    process.env.TZ = 'UTC'; // le serveur (Railway) tourne en UTC
    db = base(); await db.connect(); client = clientComme(U.proprio);
  });
  afterAll(async () => { await db?.end(); });
  afterEach(() => { vi.useRealTimers(); });

  for (const [quand, instant] of [['midi', MIDI], ['21 h', SOIR]] as const) {
    describe(`le 30 septembre à ${quand}`, () => {
      it('get_revenue_summary « ce mois-ci » = encaissé de septembre (oracle)', async () => {
        vi.useFakeTimers({ now: instant, toFake: ['Date'] });
        const r = await lire('get_revenue_summary', { period: 'this_month' });
        expect([r.from, r.to]).toEqual([P.sept.du, P.sept.au]);
        expect(r.revenue_cents).toBe((await O.encaisseParMois(db, T1, P.sept))[0].cents);
      });
      it('get_revenue_summary « cette année » = encaissé depuis le 1er janvier (oracle)', async () => {
        vi.useFakeTimers({ now: instant, toFake: ['Date'] });
        const r = await lire('get_revenue_summary', { period: 'this_year' });
        expect(r.revenue_cents).toBe(somme((await O.encaisseParMois(db, T1, { du: '2026-01-01', au: '2026-12-31' })).map((x) => x.cents)));
      });
      it('get_financial_overview : encaissé du mois = oracle', async () => {
        vi.useFakeTimers({ now: instant, toFake: ['Date'] });
        const r = await lire('get_financial_overview');
        expect(r.revenue_this_month_cents).toBe((await O.encaisseParMois(db, T1, P.sept))[0].cents);
      });
    });
  }

  // Rentabilité (PR #781) : la carte (/api/profitability), analyze_profitability et la marge de
  // get_financial_overview passent TOUS par analyserRentabilite. On vérifie qu'ils disent la même chose.
  const carteRentabilite = async (du: string, au: string) => {
    viderCacheRentabilite();
    // Exactement la demande de src/lib/profitabilityApi.ts (fetchJobPnL).
    const r = await analyserRentabilite({ client, orgId: T1, userId: U.proprio, demande: { date_from: du, date_to: au, group_by: 'job', sort: 'revenus_desc', limit: 500 } });
    if (!r.ok) throw new Error('rentabilité refusée');
    return r.resultat;
  };

  it('analyze_profitability (août) = carte Rentabilité, mêmes totaux', async () => {
    const carte = await carteRentabilite(P.aout.du, P.aout.au);
    viderCacheRentabilite();
    const r = await lire('analyze_profitability', { date_from: P.aout.du, date_to: P.aout.au, detail: true });
    expect([r.totaux.revenus_cents, r.totaux.couts_cents, r.totaux.profit_cents]).toEqual([carte.totaux.revenus_cents, carte.totaux.couts_cents, carte.totaux.profit_cents]);
  });

  for (const [quand, instant] of [['midi', MIDI], ['21 h', SOIR]] as const) {
    it(`get_financial_overview à ${quand} : jobs du mois = carte Rentabilité sur septembre`, async () => {
      vi.useFakeTimers({ now: instant, toFake: ['Date'] });
      const r = await lire('get_financial_overview');
      vi.useRealTimers();
      const carte = await carteRentabilite(P.sept.du, P.sept.au);
      expect([r.jobs_this_month.count, r.jobs_this_month.revenue_cents, r.jobs_this_month.profit_cents]).toEqual([carte.nb_jobs, carte.totaux.revenus_cents, carte.totaux.profit_cents]);
    });
  }

  for (const [nom, p] of Object.entries({ aout: P.aout, sept: P.sept, dec2025: P.dec2025 })) {
    it(`compare_revenue (${nom}) : « valeur facturée » = facturé de l’oracle`, async () => {
      const r = await lire('compare_revenue', { from: p.du, to: p.au });
      const facture = r.comparaison.find((c: any) => c.mesure === 'valeur facturée');
      expect(facture?.valeur_cents).toBe(somme((await O.factureParMois(db, T1, p)).map((x) => x.cents)));
    });
    it(`get_top_services (${nom}) = carte « Revenu par service » (oracle)`, async () => {
      const r = await lire('get_top_services', { from: p.du, to: p.au });
      const o = await O.revenuParService(db, T1, p);
      expect(r.services.map((s: any) => s.total_cents)).toEqual(o.slice(0, 10).map((x) => x.cents));
      expect(r.services.map((s: any) => s.service)).toEqual(o.slice(0, 10).map((x) => (x.nom === '(sans détail)' ? 'Jobs sans lignes de service' : x.nom)));
    });
  }

  it('get_top_clients sur une période = carte « Top clients » (mêmes clients, même ordre)', async () => {
    const r = await lire('get_top_clients', { limit: 5, from: P.douzeMois.du, to: P.douzeMois.au });
    const o = await O.topClients(db, T1, P.douzeMois, {}, 5);
    expect(r.clients.map((c: any) => [c.nom, c.total_cents])).toEqual(o.map((c) => [c.nom, c.cents]));
  });

  it('rapport programmé (rpc_insights_overview) : « Revenus encaissés » = encaissé de l’oracle', async () => {
    const { data, error } = await clientComme('service_role').rpc('rpc_insights_overview', { p_org: T1, p_from: P.sept.du, p_to: P.sept.au });
    expect(error).toBeNull();
    expect(Number((data as any[])[0].revenue_cents)).toBe((await O.encaisseParMois(db, T1, P.sept))[0].cents);
  });
});
