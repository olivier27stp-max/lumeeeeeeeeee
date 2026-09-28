// Étape 1 du plan « Étiquettes et champs dans la pipeline » (2026-09-28).
//
// · une étiquette posée par une AUTOMATISATION annonce « Étiquette ajoutée »
//   (avant : seulement à la main, depuis la fiche) ;
// · une étiquette déjà présente n'est jamais ré-annoncée ;
// · le retrait annonce « Étiquette retirée » ;
// · anti-boucle : une règle ne se relance pas par sa propre chaîne ;
// · la condition « Le client a l'étiquette » lit les VRAIES étiquettes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const emis: Array<{ type: string; payload: any }> = [];
vi.mock('../server/lib/eventBus', () => ({
  eventBus: { emit: vi.fn(async (type: string, payload: any) => { emis.push({ type, payload }); }) },
}));

import { executeAjouterEtiquette, executeRetirerEtiquette, type ActionContext } from '../server/lib/actions';
import { regleDansLaChaine, CHAINE_MAX } from '../server/lib/etiquettes';

/** Faux client Supabase : `client_tags` en mémoire, `deals`→client, `clients` pour le nom. */
function base(etiquettesInitiales: string[]) {
  const tags = new Set(etiquettesInitiales);
  const from = (table: string) => {
    let op: 'select' | 'upsert' | 'delete' = 'select';
    let ligne: { tag?: string } = {};
    const filtre: Record<string, string> = {};
    const q: any = {
      select: () => q,
      eq: (c: string, v: string) => { filtre[c] = v; return q; },
      is: () => q,
      upsert: (l: { tag: string }) => { op = 'upsert'; ligne = l; return q; },
      delete: () => { op = 'delete'; return q; },
      maybeSingle: async () => {
        if (table === 'deals') return { data: { client_id: 'c1' } };
        if (table === 'clients') return { data: { first_name: 'Jean', last_name: 'T', email: 'j@x.test', phone: '' } };
        return { data: null };
      },
      then: (r: (v: unknown) => unknown) => {
        let res: { data: unknown; error: null } = { data: null, error: null };
        if (table === 'client_tags' && op === 'upsert') {
          const neuve = !tags.has(ligne.tag!);
          tags.add(ligne.tag!);
          res = { data: neuve ? [{ tag: ligne.tag }] : [], error: null };
        } else if (table === 'client_tags' && op === 'delete') {
          const cibles = filtre.tag ? [...tags].filter((t) => t === filtre.tag) : [...tags];
          cibles.forEach((t) => tags.delete(t));
          res = { data: cibles.map((tag) => ({ tag })), error: null };
        }
        return Promise.resolve(res).then(r);
      },
    };
    return q;
  };
  return { supabase: { from } as any, tags };
}

const ctx = (supabase: any, extra: Partial<ActionContext> = {}): ActionContext =>
  ({ supabase, orgId: 'o', entityType: 'deal', entityId: 'd1', twilio: null, baseUrl: '', ruleId: 'regleA', ...extra }) as ActionContext;

beforeEach(() => { emis.length = 0; });

describe('annonce des étiquettes par les automatisations', () => {
  it('une étiquette NOUVELLE annonce « Étiquette ajoutée », avec la chaîne', async () => {
    const { supabase } = base([]);
    const r = await executeAjouterEtiquette({ etiquette: 'VIP' }, {}, ctx(supabase));
    expect(r.success).toBe(true);
    expect(emis).toHaveLength(1);
    expect(emis[0].type).toBe('client.tagged');
    expect(emis[0].payload.entityId).toBe('c1');
    expect(emis[0].payload.metadata.tag).toBe('VIP');
    expect(emis[0].payload.metadata.chaine).toEqual(['regleA']);
  });

  it('une étiquette DÉJÀ posée ne ré-annonce rien', async () => {
    const { supabase } = base(['VIP']);
    await executeAjouterEtiquette({ etiquette: 'VIP' }, {}, ctx(supabase));
    expect(emis).toHaveLength(0);
  });

  it('le retrait annonce « Étiquette retirée » pour chaque étiquette réellement retirée', async () => {
    const { supabase } = base(['VIP', 'Printemps']);
    await executeRetirerEtiquette({ toutes: 'true' }, {}, ctx(supabase, { chaine: ['regleZ'] }));
    expect(emis.map((e) => e.type)).toEqual(['client.untagged', 'client.untagged']);
    expect(emis.map((e) => e.payload.metadata.tag).sort()).toEqual(['Printemps', 'VIP']);
    expect(emis[0].payload.metadata.chaine).toEqual(['regleZ', 'regleA']);
  });

  it('retirer une étiquette absente n’annonce rien', async () => {
    const { supabase } = base([]);
    await executeRetirerEtiquette({ etiquette: 'VIP' }, {}, ctx(supabase));
    expect(emis).toHaveLength(0);
  });
});

describe('anti-boucle', () => {
  it('une règle déjà dans la chaîne est ignorée ; les autres passent', () => {
    expect(regleDansLaChaine({ chaine: ['A', 'B'] }, 'A')).toBe(true);
    expect(regleDansLaChaine({ chaine: ['A', 'B'] }, 'C')).toBe(false);
    expect(regleDansLaChaine({}, 'A')).toBe(false);
    expect(regleDansLaChaine(undefined, 'A')).toBe(false);
  });

  it(`au-delà de ${CHAINE_MAX} maillons, plus rien ne part`, () => {
    expect(regleDansLaChaine({ chaine: Array.from({ length: CHAINE_MAX }, (_, i) => `r${i}`) }, 'nouvelle')).toBe(true);
  });

  it('le moteur consulte la chaîne avant chaque règle, et la transmet aux actions', () => {
    const moteur = readFileSync(resolve(__dirname, '../server/lib/automationEngine.ts'), 'utf8');
    expect(moteur).toMatch(/regleDansLaChaine\(event\.metadata, rule\.id\)/);
    expect(moteur).toMatch(/chaine: Array\.isArray\(event\.metadata\?\.chaine\)/);
  });
});

describe('les vraies étiquettes, pas la colonne morte', () => {
  it('« Le client a l’étiquette » (Devis ouvert) lit client_tags', () => {
    const src = readFileSync(resolve(__dirname, '../server/lib/vuesSoumission.ts'), 'utf8');
    expect(src).toMatch(/from\('client_tags'\)\.select\('tag'\)/);
    expect(src).not.toMatch(/from\('clients'\)\.select\('tags'\)/);
  });

  it('le rapport Clients lit client_tags', () => {
    const src = readFileSync(resolve(__dirname, '../server/lib/reports/definitions/clients.ts'), 'utf8');
    expect(src).toMatch(/client_tags\(tag\)/);
  });

  it('le transfert entre bureaux copie client_tags', () => {
    const sql = readFileSync(resolve(__dirname, '../supabase/migrations/20261001130000_transfert_client_etiquettes.sql'), 'utf8');
    expect(sql).toMatch(/insert into public\.client_tags \(client_id, tag\)/);
    expect(sql).toMatch(/revoke all on function public\._client_dans_bureau\(uuid, uuid, uuid\) from public, anon, authenticated/);
  });
});
