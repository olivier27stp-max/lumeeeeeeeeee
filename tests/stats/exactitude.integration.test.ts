/**
 * EXACTITUDE de la page Statistiques (/insights) : chaque carte, appelée par SON module client
 * (src/lib/statistiquesApi.ts) à travers PostgREST avec la RLS du propriétaire, contre l'oracle SQL —
 * sans filtre sur 7 périodes, avec chaque filtre et des combinaisons, et « la somme du détail = le chiffre ».
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

import * as S from '../../src/lib/statistiquesApi';
import { periodRange } from '../../src/lib/insightsPeriod';
import { plagePrecedente, variation, type Filtres } from '../../src/lib/statsFiltres';

let db: pg.Client;
const PERIODES = { aout: P.aout, sept: P.sept, mars: P.mars, nov2025: P.nov2025, dec2025: P.dec2025, ytd: P.ytd, douzeMois: P.douzeMois };
const pl = (p: { du: string; au: string }) => ({ from: p.du, to: p.au, granularity: 'month' as const });
/** Les filtres éprouvés (identifiants du jeu seed.sql). */
const FILTRES: Record<string, Filtres> = {
  'aucun': {},
  'équipe A': { equipe: 'a1000000-0000-4000-8000-00000000077a' },
  'technicienne Tina (équipe B + pointage J-1)': { technicien: U.tina },
  'vendeur Rémi': { vendeur: U.remi },
  'client Alice': { client: 'a1000000-0000-4000-8000-0000000c0001' },
  'service Lavage de vitres': { service: 'a1000000-0000-4000-8000-000000005001' },
  'équipe A + service vitres': { equipe: 'a1000000-0000-4000-8000-00000000077a', service: 'a1000000-0000-4000-8000-000000005001' },
  'vendeur Rémi + client Chantal': { vendeur: U.remi, client: 'a1000000-0000-4000-8000-0000000c0003' },
};
const PERIODES_FILTRES = { aout: P.aout, sept: P.sept, douzeMois: P.douzeMois };

describe.skipIf(!ACTIF)('Statistiques — exactitude contre l’oracle (T1)', () => {
  beforeAll(async () => {
    db = base(); await db.connect();
    etat.client = clientComme(U.proprio); etat.org = T1;
    process.env.TZ = 'America/Toronto'; // le navigateur de l'entrepreneur est à Toronto
  });
  afterAll(async () => { await db?.end(); });

  describe('l’oracle lui-même, vérifié à la main (seed.sql)', () => {
    it('encaissé août 2026 = F-1 1 149,75 $ + F-3 229,95 $ (payée le 31 à 23 h 50)', async () => {
      expect(await O.encaisseParMois(db, T1, P.aout)).toEqual([{ mois: '2026-08', cents: 137970 }]);
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
    it('revenu par service sur 12 mois : vitres 800 + 500 (« lavage de VITRES ») + 450 $ ; ligne non facturée exclue', async () => {
      const s = await O.revenuParService(db, T1, P.douzeMois);
      expect(s.find((x) => x.nom === 'Lavage de vitres')?.cents).toBe(175000);
      expect(s.find((x) => x.nom === 'Nettoyage de gouttières')?.cents).toBe(20000); // « gouttieres » sans accent
      expect(s.some((x) => x.nom === 'Produit anti-mousse')).toBe(false);
    });
    it('entonnoir août–septembre : 3 leads, 3 avec soumission, 1 converti', async () => {
      expect(await O.entonnoir(db, T1, { du: '2026-08-01', au: '2026-09-30' })).toMatchObject({ crees: 3, avecSoumission: 3, convertis: 1 });
    });
    it('pipeline de septembre sans les deals du classement : 0 gagné, 1 perdu', async () => {
      expect(await O.pipeline(db, T1, P.sept)).toMatchObject({ gagnes: 0, perdus: 1, tauxPct: 0 });
    });
  });

  for (const [nomFiltre, f] of Object.entries(FILTRES)) {
    const periodes = nomFiltre === 'aucun' ? PERIODES : PERIODES_FILTRES;
    describe(`filtre : ${nomFiltre}`, () => {
      for (const [nom, p] of Object.entries(periodes)) {
        it(`${nom} : revenu (encaissé et facturé par mois)`, async () => {
          const vue = await S.serieRevenus(pl(p), f);
          const enc = await O.encaisseParMois(db, T1, p, f);
          const fac = await O.factureParMois(db, T1, p, f);
          expect(vue.map((x) => [x.debut.slice(0, 7), x.encaisseCents, x.factureCents])).toEqual(enc.map((x, i) => [x.mois, x.cents, fac[i].cents]));
        });
        it(`${nom} : revenu par service, modes de paiement, top clients`, async () => {
          expect((await S.revenuParService(pl(p), f)).map((x) => [x.cle, x.valeur])).toEqual((await O.revenuParService(db, T1, p, f)).map((x) => [x.nom, x.cents]));
          expect((await S.modesPaiement(pl(p), f)).map((x) => [x.cle, x.valeur])).toEqual((await O.encaisseParMode(db, T1, p, f)).map((x) => [x.mode, x.cents]));
          expect((await S.topClients(pl(p), f)).map((x) => [x.nom, x.cents])).toEqual((await O.topClients(db, T1, p, f)).map((x) => [x.nom, x.cents]));
        });
        it(`${nom} : jobs complétés (valeur moyenne, mois, part récurrente) et équipes`, async () => {
          const vue = await S.jobsCompletes(pl(p), f);
          const o = await O.jobsCompletes(db, T1, p, f);
          expect([vue.nombre, vue.moyenneCents, vue.partRecurrentePct, vue.mois]).toEqual([o.nombre, o.moyenneCents, o.partRecurrentePct, o.mois]);
          expect((await S.equipes(pl(p), f)).map((e) => [e.nom, e.jobs, e.completes, e.revenuCents]).sort())
            .toEqual((await O.equipes(db, T1, p, f)).map((e) => [e.nom, e.jobs, e.completes, e.revenuCents]).sort());
        });
        it(`${nom} : entonnoir, pipeline, soumissions`, async () => {
          expect(await S.entonnoir(pl(p), f)).toEqual(await O.entonnoir(db, T1, p, f));
          const pip = await S.pipeline(pl(p), f); const op = await O.pipeline(db, T1, p, f);
          expect([pip.gagnes, pip.perdus, pip.tauxPct]).toEqual([op.gagnes, op.perdus, op.tauxPct]);
          const sou = await S.soumissions(pl(p), f);
          expect([sou.nombre, sou.valeurCents, sou.approuvees, sou.valeurApprouveeCents]).toEqual(Object.values(await O.soumissions(db, T1, p, f)));
        });
        it(`${nom} : trésorerie et zones`, async () => {
          const t = await S.tresorerie(pl(p), f);
          expect([t.aRecevoirCents, t.enRetard]).toEqual(Object.values(await O.aRecevoir(db, T1, AUJOURDHUI, f)));
          const d = await O.delaiPaiement(db, T1, p, f);
          if (d == null) expect(t.delaiJours).toBeNull(); else expect(t.delaiJours).toBeCloseTo(d, 3);
          const z = await S.zones(pl(p), f);
          const oz = await O.zones(db, T1, p, f);
          expect([somme(z.map((x) => x.revenuCents)), somme(z.map((x) => x.jobs))]).toEqual([oz.revenu, oz.nb]);
        });
      }
      it('valeur vie moyenne (à vie)', async () => {
        expect(await S.valeurVieMoyenne(f)).toEqual(await O.valeurVieMoyenne(db, T1, f));
      });
    });
  }

  describe('« Voir le détail » : la somme des lignes = le chiffre de la carte', () => {
    for (const [nomFiltre, f] of Object.entries({ aucun: FILTRES.aucun, 'équipe A + service vitres': FILTRES['équipe A + service vitres'], 'client Alice': FILTRES['client Alice'] })) {
      const p = pl(P.douzeMois);
      it(`${nomFiltre} : revenu (total et un mois), modes, clients`, async () => {
        const serie = await S.serieRevenus(p, f);
        expect(somme((await S.detail(p, f, 'revenu')).map((l) => l.cents))).toBe(somme(serie.map((x) => x.encaisseCents)));
        const mois = serie.find((x) => x.encaisseCents !== 0);
        if (mois) expect(somme((await S.detail(p, f, 'revenu', mois.debut.slice(0, 7))).map((l) => l.cents))).toBe(mois.encaisseCents);
        for (const m of await S.modesPaiement(p, f)) expect(somme((await S.detail(p, f, 'mode', m.cle)).map((l) => l.cents)), m.cle).toBe(m.valeur);
        for (const c of await S.topClients(p, f)) expect(somme((await S.detail(p, f, 'client', c.id)).map((l) => l.cents)), c.nom).toBe(c.cents);
      });
      it(`${nomFiltre} : services, valeur moyenne, équipes, zones`, async () => {
        for (const s of await S.revenuParService(p, f)) expect(somme((await S.detail(p, f, 'service', s.cle)).map((l) => l.cents)), s.cle).toBe(s.valeur);
        const jc = await S.jobsCompletes(p, f);
        const lignes = await S.detail(p, f, 'valeur_moyenne');
        expect([lignes.length, lignes.length ? Math.round(somme(lignes.map((l) => l.cents)) / lignes.length) : 0]).toEqual([jc.nombre, jc.moyenneCents]);
        for (const e of await S.equipes(p, f)) expect(somme((await S.detail(p, f, 'equipe', e.id)).map((l) => l.cents)), e.nom).toBe(e.revenuCents);
        const z = await S.zones(p, f);
        expect(somme((await S.detail(p, f, 'jobs', JSON.stringify(z.flatMap((x) => x.jobIds)))).map((l) => l.cents))).toBe(somme(z.map((x) => x.revenuCents)));
      });
      it(`${nomFiltre} : trésorerie, soumissions, entonnoir, deals`, async () => {
        const t = await S.tresorerie(p, f);
        expect(somme((await S.detail(p, f, 'a_recevoir')).map((l) => l.cents))).toBe(t.aRecevoirCents);
        expect((await S.detail(p, f, 'en_retard')).length).toBe(t.enRetard);
        const d = await S.detail(p, f, 'delai');
        if (t.delaiJours != null) expect(somme(d.map((l) => l.cents)) / d.length / 100).toBeCloseTo(t.delaiJours, 1);
        const s = await S.soumissions(p, f);
        expect(somme((await S.detail(p, f, 'soumissions')).map((l) => l.cents))).toBe(s.valeurCents);
        expect(somme((await S.detail(p, f, 'soumissions_approuvees')).map((l) => l.cents))).toBe(s.valeurApprouveeCents);
        const e = await S.entonnoir(p, f);
        expect([(await S.detail(p, f, 'leads')).length, (await S.detail(p, f, 'leads_soumission')).length, (await S.detail(p, f, 'leads_convertis')).length])
          .toEqual([e.crees, e.avecSoumission, e.convertis]);
        const pip = await S.pipeline(p, f);
        expect([(await S.detail(p, f, 'deals_gagnes')).length, (await S.detail(p, f, 'deals_perdus')).length]).toEqual([pip.gagnes, pip.perdus]);
      });
    }
  });

  describe('période personnalisée, précédente, variations', () => {
    it('granularité jour : le paiement de 23 h 50 est bien un 31 août', async () => {
      const jour = await S.serieRevenus({ from: '2026-08-25', to: '2026-09-05', granularity: 'day' }, {});
      expect(jour).toHaveLength(12);
      expect(jour.find((x) => x.debut === '2026-08-31')?.encaisseCents).toBe(22995);
    });
    it('période précédente de même durée, juste avant', () => {
      expect(plagePrecedente({ from: '2026-09-01', to: '2026-09-30', granularity: 'month' })).toMatchObject({ from: '2026-08-02', to: '2026-08-31' });
      expect(plagePrecedente({ from: '2026-01-01', to: '2026-01-01', granularity: 'day' })).toMatchObject({ from: '2025-12-31', to: '2025-12-31' });
    });
    it('variation : jamais ∞ ni NaN', () => {
      expect(variation(100, 0)?.texte).toBe('nouveau');
      expect(variation(0, 0)?.texte).toBe('= 0 %');
      expect(variation(150, 100)?.texte).toBe('↑ 50 %');
      expect(variation(null, 100)).toBeNull();
      expect(variation(40, 55, 'points')?.texte).toBe('↓ 15 pt');
    });
    it('« 12 derniers mois » calculé le 30 septembre à 21 h (Toronto) finit bien le 30', () => {
      expect(periodRange('12m', new Date('2026-10-01T01:00:00Z'))).toMatchObject({ from: '2025-09-30', to: '2026-09-30' });
    });
  });

  describe('tenant vide (T3)', () => {
    it('toutes les cartes répondent à zéro, sans erreur ni NaN', async () => {
      etat.client = clientComme(U.proprioT3); etat.org = T3;
      try {
        const p = pl(P.douzeMois);
        const [serie, svc, mix, jc, eq, cli, ltv, ent, pip, sou, tre, z] = await Promise.all([
          S.serieRevenus(p, {}), S.revenuParService(p, {}), S.modesPaiement(p, {}), S.jobsCompletes(p, {}), S.equipes(p, {}), S.topClients(p, {}),
          S.valeurVieMoyenne({}), S.entonnoir(p, {}), S.pipeline(p, {}), S.soumissions(p, {}), S.tresorerie(p, {}), S.zones(p, {}),
        ]);
        expect(serie).toHaveLength(13);
        expect(somme(serie.map((x) => x.encaisseCents))).toBe(0);
        expect([svc, mix, eq, cli, z]).toEqual([[], [], [], [], []]);
        expect([jc.nombre, jc.moyenneCents, jc.partRecurrentePct, ltv.moyenneCents, ent.crees, ent.tauxPct, sou.valeurCents, tre.aRecevoirCents]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect([pip.tauxPct, ent.joursMoyens, tre.delaiJours]).toEqual([null, null, null]);
      } finally {
        etat.client = clientComme(U.proprio); etat.org = T1;
      }
    });
  });
});
