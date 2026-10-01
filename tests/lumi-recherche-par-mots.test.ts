/**
 * Recherche par mots, nom du client compris (server/lib/agent/tools.ts).
 *
 * Trouvé par la passe de référence en prod (2026-10-01) : « Duplique la soumission de
 * Girard » → « je ne trouve aucune soumission » (elle existait) ; « la job de la clinique
 * Leblanc » → rien ; « Marie Roy Brossard » → rien. Et deux affirmations fausses tirées de
 * get_job : « aucune dépense » (77,00 $), « 2 h pointées » (4 h).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { motsDeRecherche, filtresParMots } from '../server/lib/agent/tools';
import { outilsDuSousAgent, OUTILS_VOISINS } from '../server/lib/lumi/sous-agents';

const GIRARD = '11111111-1111-4111-8111-111111111111';
const LEBLANC = '22222222-2222-4222-8222-222222222222';

/** Client factice : `clients` répond selon le mot cherché dans le filtre `or`. */
function ctxFactice(clients: Record<string, string[]>) {
  const vus: string[] = [];
  const client = {
    from() {
      let mot = '';
      const q: any = {
        select: () => q, eq: () => q, is: () => q, limit: () => q,
        or: (f: string) => { mot = /first_name\.ilike\.%([^%]+)%/.exec(f)?.[1] ?? ''; vus.push(mot); return q; },
        then: (ok: (r: { data: Array<{ id: string }> }) => unknown) => Promise.resolve({ data: (clients[mot.toLowerCase()] ?? []).map((id) => ({ id })) }).then(ok),
      };
      return q;
    },
  };
  return { ctx: { client, orgId: 'org', userId: 'u' } as any, vus };
}

describe('motsDeRecherche', () => {
  it('découpe en mots, sans articles ni possessif anglais, cinq au plus', () => {
    expect(motsDeRecherche('la soumission de Girard')).toEqual(['soumission', 'Girard']);
    expect(motsDeRecherche("Chantal Lévesque's quote")).toEqual(['Chantal', 'Lévesque', 'quote']);
    expect(motsDeRecherche('Marie Roy Brossard')).toEqual(['Marie', 'Roy', 'Brossard']);
    expect(motsDeRecherche('a b c')).toEqual([]);
    expect(motsDeRecherche('un deux trois quatre cinq six sept')).toHaveLength(5);
  });
  it('retire ce qui casserait un filtre PostgREST', () => {
    expect(motsDeRecherche('Gagnon), (id.eq.1')).toEqual(['Gagnon', 'id.eq.1']);
    expect(motsDeRecherche('100%')).toEqual(['100']);
  });
});

describe('filtresParMots', () => {
  it('un filtre par mot : les colonnes de la fiche OU le client de la fiche', async () => {
    const { ctx } = ctxFactice({ girard: [GIRARD] });
    const f = await filtresParMots(ctx, 'Girard', ['quote_number', 'title'], ['client_id', 'lead_id']);
    expect(f).toEqual([`quote_number.ilike.%Girard%,title.ilike.%Girard%,client_id.in.(${GIRARD}),lead_id.in.(${GIRARD})`]);
  });
  it('« clinique Leblanc » : le nom d’entreprise passe par le client, chaque mot a son filtre', async () => {
    const { ctx, vus } = ctxFactice({ clinique: [LEBLANC], leblanc: [LEBLANC] });
    const f = await filtresParMots(ctx, 'clinique Leblanc', ['job_number', 'title', 'property_address', 'client_name'], ['client_id']);
    expect(f).toHaveLength(2);
    for (const filtre of f) expect(filtre).toContain(`client_id.in.(${LEBLANC})`);
    expect(vus.sort()).toEqual(['Leblanc', 'clinique']);
  });
  it('un mot qui n’est le nom d’aucun client ne cherche que dans les colonnes de la fiche', async () => {
    const { ctx } = ctxFactice({});
    expect(await filtresParMots(ctx, 'Brossard', ['title', 'property_address'], ['client_id'])).toEqual(['title.ilike.%Brossard%,property_address.ilike.%Brossard%']);
  });
});

describe('les outils de liste s’en servent', () => {
  const src = readFileSync(resolve(__dirname, '..', 'server/lib/agent/tools.ts'), 'utf8');
  it('list_jobs et list_quotes cherchent par mots, client compris', () => {
    expect(src).toContain("await filtresParMots(ctx, term, ['job_number', 'title', 'property_address', 'client_name'], ['client_id'])");
    expect(src).toContain("await filtresParMots(ctx, term, ['quote_number', 'title'], ['client_id', 'lead_id'])");
  });
  it('get_job dit ce qu’il ne contient pas, et la rentabilité est chargée avec la planification', () => {
    expect(src).toContain('non_inclus:');
    expect(src).toContain('never conclude there are none from this result');
    expect(OUTILS_VOISINS.planification).toContain('analyze_profitability');
    expect(outilsDuSousAgent('planification')).toContain('analyze_profitability');
    expect(outilsDuSousAgent('devis')).not.toContain('analyze_profitability');
  });
});
