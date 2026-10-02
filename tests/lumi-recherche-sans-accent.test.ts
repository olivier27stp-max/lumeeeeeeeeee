/**
 * Un nom se trouve aux accents près (server/lib/agent/sans-accent.ts).
 *
 * Éval en prod du 2026-10-01 : « texte à nathalie coté qu'on arrive dans dix minutes » — la fiche
 * s'appelle « Nathalie Côté », la recherche ne la trouvait pas et Lumi demandait l'orthographe.
 */
import { describe, it, expect } from 'vitest';
import { sansAccent, motifSansAccent, contientSansAccent, egalSansAccent } from '../server/lib/agent/sans-accent';
import { TOOLS_BY_NAME } from '../server/lib/agent/tools';

describe('sans-accent', () => {
  it('retire les accents et la cédille, garde le reste', () => {
    expect(sansAccent('Nathalie Côté')).toBe('nathalie cote');
    expect(sansAccent('François Lévesque-Noël')).toBe('francois levesque-noel');
  });

  it('le motif laisse passer toute lettre accentuable, et neutralise les jokers d’origine', () => {
    expect(motifSansAccent('Coté')).toBe('__t_');
    expect(motifSansAccent('Tremblay')).toBe('Tr_mbl__');
    expect(motifSansAccent('50%_x')).toBe('50  x');
  });

  it('le second filtre décide : aux accents près, pas à une lettre près', () => {
    expect(contientSansAccent(['Nathalie', 'Côté'], 'coté')).toBe(true);
    expect(contientSansAccent(['Nathalie', 'Côté'], 'COTE')).toBe(true);
    expect(contientSansAccent(['Nathalia', 'Cuta'], 'coté')).toBe(false);
    expect(egalSansAccent('Côté', 'cote')).toBe(true);
    expect(egalSansAccent('Côté-Roy', 'cote')).toBe(false);
  });
});

/** Un client Supabase qui rend une réponse par requête, dans l'ordre, et garde les filtres `or` reçus. */
function clientParReponses(reponses: Array<Record<string, unknown>[]>) {
  const filtres: string[][] = [];
  let n = -1;
  const requete = () => {
    const mesFiltres: string[] = [];
    const rang = ++n;
    filtres.push(mesFiltres);
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'limit', 'ilike', 'order']) q[m] = () => q;
    q.or = (f: string) => { mesFiltres.push(f); return q; };
    q.then = (ok: (r: unknown) => unknown) => ok({ data: reponses[rang] ?? [], count: (reponses[rang] ?? []).length, error: null });
    return q;
  };
  return { client: { from: () => requete() } as never, filtres };
}

describe('search_clients : second passage sans accent', () => {
  const cote = { id: 'c1', first_name: 'Nathalie', last_name: 'Côté', company: null, email: null, phone: '514-555-0101', address: null, city: 'Laval', status: 'active' };
  const cuta = { id: 'c2', first_name: 'Nathalia', last_name: 'Cuta', company: null, email: null, phone: null, address: null, city: null, status: 'active' };
  const chercher = (query: string, reponses: Array<Record<string, unknown>[]>) => {
    const { client, filtres } = clientParReponses(reponses);
    return TOOLS_BY_NAME.search_clients.handler!({ query }, { client, orgId: 'o', userId: 'u' } as never).then((r) => ({ r: r as any, filtres }));
  };

  it('« nathalie coté » trouve « Nathalie Côté », et seulement elle', async () => {
    const { r, filtres } = await chercher('nathalie coté', [[], [cote, cuta]]);
    expect(r.clients.map((c: any) => c.name)).toEqual(['Nathalie Côté']);
    expect(r.note).toBeUndefined();
    // Le second passage demande le motif large, sur le nom et l'entreprise.
    expect(filtres[1].join(' ')).toContain('last_name.ilike.%__t_%');
    expect(filtres[1].join(' ')).not.toContain('email.ilike');
  });

  it('une recherche qui trouve du premier coup ne fait pas de second passage', async () => {
    const { r, filtres } = await chercher('Côté', [[cote]]);
    expect(r.clients).toHaveLength(1);
    expect(filtres).toHaveLength(1);
  });

  it('rien non plus sans accent : la note « aucun client » reste', async () => {
    const { r } = await chercher('zzz inconnu', [[], [cuta]]);
    expect(r.clients).toEqual([]);
    expect(String(r.note)).toMatch(/Aucun client ne correspond/);
  });
});

describe('motProche : une lettre d’écart, comme après une dictée', () => {
  it('reconnaît les noms dictés de travers', async () => {
    const { motProche } = await import('../server/lib/agent/sans-accent');
    expect(motProche('Roi', 'Roy')).toBe(true);
    expect(motProche('Trembley', 'Tremblay')).toBe(true);
    expect(motProche('Gagnion', 'Gagnon')).toBe(true);
    expect(motProche('Cote', 'Côté')).toBe(true);
    expect(motProche('Lévesque', 'Levesqe')).toBe(true);
  });

  it('ne confond pas deux noms différents, ni deux mots trop courts', async () => {
    const { motProche } = await import('../server/lib/agent/sans-accent');
    expect(motProche('Roy', 'Ray')).toBe(true); // une lettre : c'est le troisième passage, marqué « approchant », qui le tolère
    expect(motProche('Roy', 'Rioux')).toBe(false);
    expect(motProche('Gagnon', 'Gagné')).toBe(false);
    expect(motProche('Marie', 'Marc')).toBe(false);
    expect(motProche('Li', 'La')).toBe(false);
    expect(motProche('', '')).toBe(false);
  });
});

describe('search_clients : troisième passage, nom approchant', () => {
  const roy1 = { id: 'r1', first_name: 'Marie', last_name: 'Roy', company: null, email: null, phone: '450-555-0101', address: '12 rue des Pins', city: 'Longueuil', status: 'active' };
  const roy2 = { id: 'r2', first_name: 'Marie', last_name: 'Roy', company: null, email: null, phone: '450-555-0102', address: '4 rue du Parc', city: 'Brossard', status: 'active' };
  const rioux = { id: 'r3', first_name: 'Mario', last_name: 'Rioux', company: null, email: null, phone: null, address: null, city: 'Longueuil', status: 'active' };
  const chercher = (query: string, reponses: Array<Record<string, unknown>[]>) => {
    const { client, filtres } = clientParReponses(reponses);
    return TOOLS_BY_NAME.search_clients.handler!({ query }, { client, orgId: 'o', userId: 'u' } as never).then((r) => ({ r: r as any, filtres }));
  };

  it('« Marie Roi » trouve les Marie Roy, et le dit approchant', async () => {
    const { r } = await chercher('Marie Roi', [[], [], [roy1, roy2, rioux]]);
    expect(r.clients.map((c: any) => `${c.name} ${c.city}`)).toEqual(['Marie Roy Longueuil', 'Marie Roy Brossard']);
    expect(r.approchant).toBe(true);
    expect(String(r.note)).toMatch(/noms PROCHES/);
  });

  it('avec la ville dictée, seule la bonne fiche revient', async () => {
    const { r } = await chercher('marie roi longueuil', [[], [], [roy1, roy2, rioux]]);
    expect(r.clients.map((c: any) => c.city)).toEqual(['Longueuil']);
  });

  it('une ville seule ne nomme personne ; rien de proche : la note « aucun client » reste', async () => {
    expect((await chercher('longueuil xyz', [[], [], [roy1, rioux]])).r.clients).toEqual([]);
    const { r } = await chercher('Zzyzx Qwerty', [[], [], [roy1, roy2]]);
    expect(r.clients).toEqual([]);
    expect(r.approchant).toBeUndefined();
    expect(String(r.note)).toMatch(/Aucun client ne correspond/);
  });

  it('une recherche qui trouve du premier coup n’est jamais « approchante »', async () => {
    const { r, filtres } = await chercher('Marie Roy', [[roy1, roy2]]);
    expect(r.approchant).toBeUndefined();
    expect(filtres).toHaveLength(1);
  });
});
