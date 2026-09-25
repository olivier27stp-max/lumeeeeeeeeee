// Compteurs de staging : GROUP BY côté base, repli paginé exact quand la
// fonction SQL n'est pas encore posée. Le bug d'origine : lire toutes les lignes
// plafonnait à 1 000 (PostgREST) → compteurs faux dès 1 001 lignes, sans erreur.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compterStaging, compterParPages, totauxParEntite, fonctionSqlAbsente, reinitialiserCompteurs } from '../../server/lib/migration/compteurs';

function fauxAdmin(opts: { rpc?: { data?: unknown; error?: { code?: string; message: string } | null }; pages?: Array<{ entity_type: string; status: string }>[] }) {
  const appels: { rpc: string[]; ranges: Array<[number, number]> } = { rpc: [], ranges: [] };
  let page = 0;
  const chaine: any = {
    select: () => chaine,
    eq: () => chaine,
    order: () => chaine,
    range: (a: number, b: number) => {
      appels.ranges.push([a, b]);
      const data = (opts.pages ?? [])[page] ?? [];
      page += 1;
      return Promise.resolve({ data, error: null });
    },
  };
  const admin: any = {
    rpc: (nom: string) => { appels.rpc.push(nom); return Promise.resolve(opts.rpc ?? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }); },
    from: () => chaine,
  };
  return { admin, appels };
}

beforeEach(() => reinitialiserCompteurs());

describe('compterStaging', () => {
  it('lit le GROUP BY de la fonction SQL et le remet en forme entité → statut → n', async () => {
    const { admin, appels } = fauxAdmin({
      rpc: { data: [
        { entity_type: 'client', status: 'ready', n: '853' },
        { entity_type: 'client', status: 'error', n: 2 },
        { entity_type: 'visit', status: 'orphan', n: '40' },
      ], error: null },
    });
    const c = await compterStaging(admin, 'm1');
    expect(c).toEqual({ client: { ready: 853, error: 2 }, visit: { orphan: 40 } });
    expect(appels.rpc).toEqual(['migration_staging_counts']);
    expect(appels.ranges).toHaveLength(0); // pas de lecture ligne à ligne
  });

  it('fonction SQL absente → repli paginé, exact au-delà de 1 000 lignes, un seul avertissement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page1 = Array.from({ length: 1000 }, () => ({ entity_type: 'client', status: 'ready' }));
    const page2 = [
      ...Array.from({ length: 300 }, () => ({ entity_type: 'job', status: 'ready' })),
      { entity_type: 'job', status: 'orphan' },
    ];
    const { admin, appels } = fauxAdmin({ pages: [page1, page2] });
    const c = await compterStaging(admin, 'm1');
    expect(c).toEqual({ client: { ready: 1000 }, job: { ready: 300, orphan: 1 } });
    expect(appels.ranges).toEqual([[0, 999], [1000, 1999]]);
    await compterStaging(admin, 'm1');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('20260926110000');
    warn.mockRestore();
  });

  it("une page pleine exactement (1 000) déclenche une page suivante vide sans s'emballer", async () => {
    const page1 = Array.from({ length: 1000 }, () => ({ entity_type: 'client', status: 'ready' }));
    const { admin, appels } = fauxAdmin({ pages: [page1, []] });
    expect(await compterParPages(admin, 'm1')).toEqual({ client: { ready: 1000 } });
    expect(appels.ranges).toHaveLength(2);
  });
});

describe('totauxParEntite', () => {
  it('somme les statuts par entité (forme detected_counts du portail)', () => {
    expect(totauxParEntite({ client: { ready: 850, error: 3 }, visit: { orphan: 40, ready: 10 } })).toEqual({ client: 853, visit: 50 });
    expect(totauxParEntite({})).toEqual({});
  });
});

describe('fonctionSqlAbsente', () => {
  it('reconnaît PGRST202, 42883 et le message PostgREST', () => {
    expect(fonctionSqlAbsente({ code: 'PGRST202', message: 'x' })).toBe(true);
    expect(fonctionSqlAbsente({ code: '42883', message: 'x' })).toBe(true);
    expect(fonctionSqlAbsente({ message: 'Could not find the function public.migration_staging_counts' })).toBe(true);
    expect(fonctionSqlAbsente({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false);
    expect(fonctionSqlAbsente(null)).toBe(false);
  });
});
