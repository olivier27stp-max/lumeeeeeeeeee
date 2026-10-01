/**
 * Les totaux calculés EN SQL (commissions_totaux_periode, migration
 * 20261005600400) doivent être identiques au cent à ceux du code
 * (totauxCommissions, lecture paginée) : même entrée, deux chemins.
 * Pile locale + migration requises.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { API, SERVICE_KEY, brancherServeurSurLocal, pileLocaleDisponible } from './env-local';
import { ORG, U } from './fixture';

const disponible = await pileLocaleDisponible();

/** Même client, mais la fonction SQL « n'existe pas » : force la lecture paginée. */
const sansFonction = (sc: SupabaseClient): SupabaseClient => new Proxy(sc, {
  get: (cible, cle) => cle === 'rpc'
    ? async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.commissions_totaux_periode' } })
    : Reflect.get(cible, cle),
});

const PERIODES: Array<[string, string]> = [
  ['2026-01-01', '2026-12-31'], ['2026-09-01', '2026-09-30'], ['2026-07-01', '2026-07-31'],
  ['2026-09-10', '2026-09-10'], ['2025-01-01', '2025-12-31'],
];

describe.skipIf(!disponible)('totaux SQL = totaux du code', () => {
  let sc: SupabaseClient;
  let moteur: typeof import('../../server/lib/field-sales/commission-engine');
  beforeAll(async () => {
    brancherServeurSurLocal();
    sc = createClient(API, SERVICE_KEY, { auth: { persistSession: false } });
    moteur = await import('../../server/lib/field-sales/commission-engine');
  });

  const tri = <T extends { user_id: string }>(l: T[]) => [...l].sort((a, b) => a.user_id.localeCompare(b.user_id));

  for (const org of [ORG.A, ORG.B, ORG.C]) {
    for (const [from, to] of PERIODES) {
      for (const userId of [null, U.sam, U.bob]) {
        it(`org ${org.slice(-2)} ${from}→${to} ${userId ? 'un rep' : 'tous'}`, async () => {
          const sql = await moteur.totauxPeriode(sc, org, { userId, from, to });
          const js = await moteur.totauxPeriode(sansFonction(sc), org, { userId, from, to });
          expect(sql.source).toBe('sql');
          expect(js.source).toBe('js');
          expect(sql.count).toBe(js.count);
          expect(sql.totaux).toEqual(js.totaux);
          expect(tri(sql.par_rep)).toEqual(tri(js.par_rep));
          expect(sql.par_jour).toEqual(js.par_jour);
          expect([...sql.flagged_ids].sort()).toEqual([...js.flagged_ids].sort());
        });
      }
    }
  }

  it('le jeu A n’est pas vide sur l’année (sinon le test ne prouve rien)', async () => {
    const a = await moteur.totauxPeriode(sc, ORG.A, { from: '2026-01-01', to: '2026-12-31' });
    expect(a.count).toBeGreaterThan(20);
    expect(a.totaux.repris_cents).not.toBe(0);
    expect(a.totaux.estime_cents).not.toBe(0);
  });

  it('une autre erreur que « fonction absente » n’est jamais masquée', async () => {
    const enPanne = new Proxy(sc, {
      get: (c, k) => k === 'rpc' ? async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) : Reflect.get(c, k),
    });
    await expect(moteur.totauxPeriode(enPanne, ORG.A, { from: '2026-01-01', to: '2026-12-31' })).rejects.toThrow(/timeout/);
  });
});
