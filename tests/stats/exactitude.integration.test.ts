/**
 * EXACTITUDE de la page Statistiques (/insights) : chaque carte, appelée par SON module
 * client réel (src/lib/*Api.ts) à travers PostgREST avec la RLS du propriétaire, contre l'oracle SQL.
 *
 *   bash scripts/qa/stats-stack.sh && node scripts/qa/stats-fixture.mjs
 *   STATS_DB_URL=postgres://supabase_admin:lumestats-local-pw@localhost:47432/postgres npx vitest run tests/stats
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type pg from 'pg';
import { ACTIF, AUJOURDHUI, P, T1, T3, U, base, clientComme, somme } from './harnais';
import * as O from './oracle';

const etat = vi.hoisted(() => ({ client: null as unknown as SupabaseClient, org: '' }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() { return etat.client; },
  bureauActifPourEntete: () => null,
  fetchAvecBureauActif: (i: RequestInfo | URL, init?: RequestInit) => fetch(i, init),
}));
vi.mock('../../src/lib/orgApi', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/orgApi')>()),
  getCurrentOrgIdOrThrow: async () => etat.org,
  getCurrentOrgId: async () => etat.org,
}));

import * as insights from '../../src/lib/insightsApi';
import * as extra from '../../src/lib/statsExtraApi';
import { fetchQuoteKpis } from '../../src/lib/quotesApi';
import { periodRange } from '../../src/lib/insightsPeriod';

let db: pg.Client;
const PERIODES = { aout: P.aout, sept: P.sept, mars: P.mars, nov2025: P.nov2025, dec2025: P.dec2025, ytd: P.ytd, douzeMois: P.douzeMois };

describe.skipIf(!ACTIF)('Statistiques — exactitude contre l’oracle (T1)', () => {
  beforeAll(async () => {
    db = base();
    await db.connect();
    etat.client = clientComme(U.proprio);
    etat.org = T1;
    // Le navigateur de l'entrepreneur est à Toronto : les bornes « locales » du code client le supposent.
    process.env.TZ = 'America/Toronto';
  });
  afterAll(async () => { await db?.end(); });

  describe('l’oracle lui-même, vérifié à la main (seed.sql)', () => {
    it('encaissé août 2026 = F-1 1 149,75 $ + F-3 229,95 $ (payée le 31 à 23 h 50)', async () => {
      const m = await O.encaisseParMois(db, T1, P.aout);
      expect(m).toEqual([{ mois: '2026-08', cents: 137970 }]);
    });
    it('encaissé septembre = 200,00 + 229,95 + 574,88 (pourboire exclu, paiements supprimé/en attente/échoué exclus)', async () => {
      expect((await O.encaisseParMois(db, T1, P.sept))[0].cents).toBe(100483);
    });
    it('encaissé mars 2026 = 1 149,75 − 300,00 remboursés ; novembre 2025 = 0 (remboursement total)', async () => {
      expect((await O.encaisseParMois(db, T1, P.mars))[0].cents).toBe(84975);
      expect((await O.encaisseParMois(db, T1, P.nov2025))[0].cents).toBe(0);
    });
    it('encaissé sur 12 mois = 438 404 ¢ (dont la facture importée de juin)', async () => {
      expect(somme((await O.encaisseParMois(db, T1, P.douzeMois)).map((x) => x.cents))).toBe(438404);
    });
    it('facturé décembre 2025 = F-5 émise le 31 à 23 h 30 ; janvier 2026 = 0', async () => {
      expect((await O.factureParMois(db, T1, P.dec2025))[0].cents).toBe(57488);
      expect((await O.factureParMois(db, T1, { du: '2026-01-01', au: '2026-01-31' }))[0].cents).toBe(0);
    });
    it('à recevoir = F-2 374,88 + F-4 1 149,75 + F-7 300,00 + F-8 574,88 ; 3 en retard', async () => {
      expect(await O.aRecevoir(db, T1, AUJOURDHUI)).toEqual({ solde: 239951, enRetard: 3 });
    });
    it('pipeline de septembre sans les deals du classement : 0 gagné, 1 perdu', async () => {
      expect((await O.pipeline(db, T1, P.sept))).toMatchObject({ gagnes: 0, perdus: 1, tauxPct: 0 });
    });
  });

  describe('carte Revenu (fetchInsightsRevenueSeries → rpc_insights_revenue_series)', () => {
    for (const [nom, p] of Object.entries(PERIODES)) {
      it(`${nom} : encaissé par mois = oracle`, async () => {
        const serie = await insights.fetchInsightsRevenueSeries({ from: p.du, to: p.au, granularity: 'month' });
        const attendu = await O.encaisseParMois(db, T1, p);
        expect(serie.map((x) => [x.bucket_start.slice(0, 7), x.revenue_cents])).toEqual(attendu.map((x) => [x.mois, x.cents]));
      });
      it(`${nom} : facturé par mois = oracle`, async () => {
        const serie = await insights.fetchInsightsRevenueSeries({ from: p.du, to: p.au, granularity: 'month' });
        const attendu = await O.factureParMois(db, T1, p);
        expect(serie.map((x) => [x.bucket_start.slice(0, 7), x.invoiced_cents])).toEqual(attendu.map((x) => [x.mois, x.cents]));
      });
    }
    it('« 12 derniers mois » calculé le 30 septembre à 21 h (Toronto) finit bien le 30 septembre', () => {
      const r = periodRange('12m', new Date('2026-10-01T01:00:00Z'));
      expect(r).toMatchObject({ from: '2025-09-30', to: '2026-09-30' });
    });
    it('« Cette année » le 1er janvier à 00 h 30 (Toronto) commence le 1er janvier', () => {
      const r = periodRange('ytd', new Date('2026-01-01T05:30:00Z'));
      expect(r).toMatchObject({ from: '2026-01-01', to: '2026-01-01' });
    });
  });

  describe('carte Revenu par service (fetchTopServices)', () => {
    for (const [nom, p] of Object.entries(PERIODES)) {
      it(`${nom} : top 3 + Autre = oracle`, async () => {
        const vue = await insights.fetchTopServices({ from: p.du, to: p.au });
        const o = await O.valeurParTitreDeJob(db, T1, p);
        const attendu = o.length <= 3 ? o.map((x) => ({ name: x.titre, value: x.cents }))
          : [...o.slice(0, 3).map((x) => ({ name: x.titre, value: x.cents })), { name: 'Other', value: somme(o.slice(3).map((x) => x.cents)) }];
        expect(vue).toEqual(attendu);
      });
    }
  });

  describe('carte Modes de paiement (fetchPaymentMix)', () => {
    for (const [nom, p] of Object.entries(PERIODES)) {
      it(`${nom} : par mode, nets des remboursements, bornes locales = oracle`, async () => {
        const vue = await extra.fetchPaymentMix({ from: p.du, to: p.au });
        const o = await O.encaissePaiementsParMode(db, T1, p);
        // La fonction rend les CLÉS de mode (card, e-transfer…) ; la carte les traduit.
        expect(vue.map((x) => [x.name, x.value])).toEqual(o.map((x) => [x.mode, x.cents]));
      });
    }
  });

  describe('carte Valeur moyenne d’un job (fetchAvgJobValueSeries)', () => {
    for (const [nom, p] of Object.entries(PERIODES)) {
      it(`${nom} : moyenne mensuelle des jobs complétés (mois local de complétion) = oracle`, async () => {
        const vue = await extra.fetchAvgJobValueSeries({ from: p.du, to: p.au, fr: true });
        const o = await O.valeurMoyenneJob(db, T1, p);
        expect(vue.vals).toEqual(o.mois.map((x) => x.moyenne));
        expect((vue as { moyenne?: number }).moyenne).toBe(o.moyenne);
      });
    }
  });

  describe('cartes Équipes (fetchTeamPerformance)', () => {
    for (const [nom, p] of Object.entries(PERIODES)) {
      it(`${nom} : revenu, jobs, complétés par équipe = oracle`, async () => {
        const vue = await insights.fetchTeamPerformance({ from: p.du, to: p.au });
        const o = await O.equipes(db, T1, p);
        expect(vue.map((t) => [t.team_name, t.jobs_count, t.jobs_completed, t.revenue_cents]).sort())
          .toEqual(o.map((t) => [t.nom, t.nb, t.faits, t.revenu]).sort());
      });
    }
  });

  describe('carte Top clients par revenu', () => {
    it('les 5 premiers = les 5 clients qui ont le plus rapporté (pas les 6 meilleurs « scores CLV »)', async () => {
      // Ce que fait la page : fetchTopClientsParRevenu(5) (tri par revenu fait par la base).
      const vue = await insights.fetchTopClientsParRevenu(5);
      expect((await insights.fetchValeurTousClients()).slice(0, 5).map((c) => c.client_name)).toEqual(vue.map((c) => c.client_name));
      const o = (await O.valeurClients(db, T1)).slice(0, 5);
      expect(vue.map((c) => [c.client_name, c.total_revenue_cents])).toEqual(o.map((c) => [c.nom, c.revenu]));
    });
  });

  describe('carte Fidélité & valeur client (fetchLoyalty)', () => {
    for (const [nom, p] of Object.entries(PERIODES)) {
      it(`${nom} : part récurrente = oracle`, async () => {
        expect((await extra.fetchLoyalty({ from: p.du, to: p.au })).recurringPct).toBe(await O.partRecurrente(db, T1, p));
      });
    }
    it('valeur vie moyenne = moyenne sur TOUS les clients qui ont eu un job', async () => {
      // Ce que fait la page : fetchValeurVieMoyenne() (agrégat en base, sinon lecture complète).
      const o = await O.valeurClients(db, T1);
      expect(await insights.fetchValeurVieMoyenne())
        .toBe(Math.round(somme(o.map((c) => c.revenu)) / o.length));
    });
  });

  describe('Conversion des leads', () => {
    for (const [nom, p] of Object.entries(PERIODES)) {
      it(`${nom} : leads créés / convertis / taux = oracle`, async () => {
        const vue = await insights.fetchInsightsLeadConversion({ from: p.du, to: p.au });
        const o = await O.conversionLeads(db, T1, p);
        expect([vue.leads_created, vue.leads_closed, vue.conversion_rate]).toEqual([o.crees, o.convertis, o.taux]);
      });
      it(`${nom} : soumissions (valeur totale, approuvées) = oracle`, async () => {
        const vue = await fetchQuoteKpis({ from: p.du, to: p.au });
        const o = await O.soumissions(db, T1, p);
        expect([vue.total_count, vue.total_value_cents, vue.approved_count, vue.approved_value_cents]).toEqual([o.nb, o.valeur, o.approuvees, o.valeurApprouvee]);
      });
      it(`${nom} : taux de réussite et délai (sans les deals du classement) = oracle`, async () => {
        const vue = await insights.fetchPipelineVelocity({ from: p.du, to: p.au });
        const o = await O.pipeline(db, T1, p);
        expect(vue.win_rate).toBe(o.tauxPct ?? 0);
        if (o.delaiJours != null) expect(vue.avg_days_to_close).toBeCloseTo(o.delaiJours, 1);
      });
    }
  });

  describe('Trésorerie (fetchInsightsInvoicesSummary)', () => {
    for (const [nom, p] of Object.entries(PERIODES)) {
      it(`${nom} : à recevoir, en retard, délai de paiement = oracle`, async () => {
        const vue = await insights.fetchInsightsInvoicesSummary({ from: p.du, to: p.au });
        const o = await O.aRecevoir(db, T1, AUJOURDHUI);
        expect([vue.total_outstanding_cents, vue.count_past_due]).toEqual([o.solde, o.enRetard]);
        const d = await O.delaiPaiement(db, T1, p);
        if (d == null) expect(vue.avg_payment_time_days).toBeNull();
        else expect(vue.avg_payment_time_days).toBeCloseTo(d, 3);
      });
    }
  });

  describe('carte Revenu par ville (fetchZonesParAdresse, ce que lit la carte)', () => {
    for (const [nom, p] of Object.entries(PERIODES)) {
      it(`${nom} : revenu réalisé et jobs = oracle`, async () => {
        const lignes = await insights.fetchZonesParAdresse({ from: p.du, to: p.au });
        expect([lignes.reduce((s, z) => s + z.revenu_cents, 0), lignes.reduce((s, z) => s + z.jobs, 0)]).toEqual(Object.values(await O.zones(db, T1, p)));
      });
    }
  });

  // Rentabilité par job : depuis la PR #781, la carte lit /api/profitability → server/lib/rentabilite
  // (analyserRentabilite), la même fonction que Lumi — parité vérifiée dans lumi-parite.integration.test.ts,
  // calcul couvert par tests/rentabilite*.test.ts.

  describe('tenant vide (T3)', () => {
    it('toutes les cartes répondent à zéro, sans erreur ni NaN', async () => {
      etat.client = clientComme(U.proprioT3); etat.org = T3;
      try {
        const [serie, svc, mix, ajv, eq, clv, loy, conv, quotes, velo, inv] = await Promise.all([
          insights.fetchInsightsRevenueSeries({ from: P.douzeMois.du, to: P.douzeMois.au, granularity: 'month' }),
          insights.fetchTopServices({ from: P.douzeMois.du, to: P.douzeMois.au }),
          extra.fetchPaymentMix({ from: P.douzeMois.du, to: P.douzeMois.au }),
          extra.fetchAvgJobValueSeries({ from: P.douzeMois.du, to: P.douzeMois.au, fr: true }),
          insights.fetchTeamPerformance({ from: P.douzeMois.du, to: P.douzeMois.au }),
          insights.fetchTopClientsParRevenu(5),
          extra.fetchLoyalty({ from: P.douzeMois.du, to: P.douzeMois.au }),
          insights.fetchInsightsLeadConversion({ from: P.douzeMois.du, to: P.douzeMois.au }),
          fetchQuoteKpis({ from: P.douzeMois.du, to: P.douzeMois.au }),
          insights.fetchPipelineVelocity({ from: P.douzeMois.du, to: P.douzeMois.au }),
          insights.fetchInsightsInvoicesSummary({ from: P.douzeMois.du, to: P.douzeMois.au }),
        ]);
        expect(somme(serie.map((x) => x.revenue_cents))).toBe(0);
        expect(serie).toHaveLength(13);
        expect([svc, mix, eq, clv]).toEqual([[], [], [], []]);
        expect(ajv.vals.every((v) => v === 0)).toBe(true);
        expect(loy).toEqual({ recurringPct: 0, retentionPct: 0 });
        expect([conv.leads_created, conv.conversion_rate, quotes.total_count, velo.win_rate, inv.total_outstanding_cents]).toEqual([0, 0, 0, 0, 0]);
        for (const v of [conv.conversion_rate, velo.win_rate, velo.avg_days_to_close]) expect(Number.isFinite(v)).toBe(true);
      } finally {
        etat.client = clientComme(U.proprio); etat.org = T1;
      }
    });
  });
});
