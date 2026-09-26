/**
 * Types « Case à cocher », « URL » et « Fichier » (migration 20260929170000). Les trois
 * moteurs de filtre disent la même chose : « est non » = pas cochée, y compris
 * jamais remplie. Une URL n'est jamais autre chose que http(s). Vérifié aussi
 * contre la vraie base : scripts/qa/champs-types-case-url.mts (13/13 staging).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { preparerValeur, formaterValeur, lireBooleen, valeurDepuisTexte, ErreurValeur } from '../src/lib/champs/valeurs';
import { evaluerCondition, OPERATEURS_PAR_FAMILLE } from '../src/lib/champs/filtres';
import { compilerFiltresListe } from '../src/lib/champs/filtresListe';
import { TYPES_CHAMP, LIBELLES_TYPE, type ChampPerso } from '../src/lib/champs/types';

const champ = (field_type: ChampPerso['field_type'], id = 'f1'): ChampPerso => ({
  id, object_type: 'client', folder_id: null, key: 'k', label: 'Champ', placeholder: null, help_text: null,
  field_type, config: {}, is_required: false, is_searchable: false, is_unique: false, position: 0,
  options: [], created_at: '', updated_at: '', archived_at: null,
} as unknown as ChampPerso);

describe('les 12 types de la mission', () => {
  it('libellés « comme GoHighLevel »', () => {
    expect(TYPES_CHAMP.map((t) => LIBELLES_TYPE[t].fr)).toEqual([
      'Ligne simple', 'Paragraphe', 'Nombre', 'Monétaire', 'Date', 'Liste déroulante', 'Choix multiples',
      'Case à cocher', 'Téléphone', 'Courriel', 'URL', 'Fichier',
    ]);
  });
});

describe('case à cocher', () => {
  it('oui / non → value_boolean ; ce qui n’est ni oui ni non est refusé', () => {
    expect(preparerValeur(champ('checkbox'), true).colonnes?.value_boolean).toBe(true);
    expect(preparerValeur(champ('checkbox'), false).colonnes?.value_boolean).toBe(false);
    expect(preparerValeur(champ('checkbox'), 'oui').colonnes?.value_boolean).toBe(true);
    expect(() => preparerValeur(champ('checkbox'), 'peut-être')).toThrow(ErreurValeur);
  });
  it('lecture humaine et import', () => {
    expect(formaterValeur(champ('checkbox'), true, 'fr')).toBe('Oui');
    expect(formaterValeur(champ('checkbox'), false, 'en')).toBe('No');
    for (const t of ['x', 'Oui', 'TRUE', '1']) expect(lireBooleen(t)).toBe(true);
    for (const t of ['non', 'No', '0']) expect(lireBooleen(t)).toBe(false);
    expect(valeurDepuisTexte(champ('checkbox'), 'X')).toBe(true);
  });
  it('filtre en mémoire : « est non » vrai pour une case vide', () => {
    expect(OPERATEURS_PAR_FAMILLE.case).toEqual(['is']);
    expect(evaluerCondition('checkbox', true, { field_id: 'f1', op: 'is', value: true })).toBe(true);
    expect(evaluerCondition('checkbox', null, { field_id: 'f1', op: 'is', value: false })).toBe(true);
    expect(evaluerCondition('checkbox', false, { field_id: 'f1', op: 'is', value: false })).toBe(true);
    expect(evaluerCondition('checkbox', true, { field_id: 'f1', op: 'is', value: false })).toBe(false);
  });
  it('filtre de liste (PostgREST) : « non » = anti-jointure sur « cochée »', () => {
    const f = compilerFiltresListe([{ field_id: 'f1', op: 'is', value: false }], [champ('checkbox')], 'America/Toronto');
    expect(f.select).toBe(', cf0:custom_field_values(id)');
    const appels: string[] = [];
    const q = {
      eq: (c: string, v: unknown) => { appels.push(`eq ${c}=${String(v)}`); return q; },
      is: (c: string, v: null) => { appels.push(`is ${c}=${String(v)}`); return q; },
      in: () => q, gt: () => q, gte: () => q, lt: () => q, lte: () => q, like: () => q,
    };
    f.appliquer(q);
    expect(appels).toEqual(['eq cf0.field_id=f1', 'eq cf0.value_boolean=true', 'is cf0=null']);
    const oui = compilerFiltresListe([{ field_id: 'f1', op: 'is', value: true }], [champ('checkbox')], 'America/Toronto');
    expect(oui.select).toBe(', cf0:custom_field_values!inner(id)');
  });
});

describe('url', () => {
  it('http(s) seulement — ni javascript:, ni data:, ni domaine nu', () => {
    expect(preparerValeur(champ('url'), ' https://toiture.ca/devis ').colonnes?.value_text).toBe('https://toiture.ca/devis');
    for (const piege of ['javascript:alert(1)', 'data:text/html,x', 'toiture.ca', 'https://a b.ca']) {
      expect(() => preparerValeur(champ('url'), piege), piege).toThrow(ErreurValeur);
    }
  });
  it('filtre comme un texte', () => {
    expect(evaluerCondition('url', 'https://Toiture.ca', { field_id: 'f1', op: 'contains', value: 'toiture' })).toBe(true);
  });
  it('rendu : lien seulement si http(s), ouvert sans opener', () => {
    const s = readFileSync(join(__dirname, '..', 'src/components/champs/colonnes.tsx'), 'utf8');
    expect(s).toMatch(/champ\.field_type === 'url' && typeof v === 'string' && \/\^https\?:\\\/\\\/\/i\.test\(v\)/);
    expect(s).toContain('rel="noopener noreferrer"');
  });
});

describe('fichier', () => {
  const org = '11111111-1111-1111-1111-111111111111';
  const uuid = '22222222-2222-2222-2222-222222222222';
  it('la valeur est le chemin <org>/<uuid>/<nom> ; un autre texte est refusé', () => {
    expect(preparerValeur(champ('file'), `${org}/${uuid}/devis.pdf`).colonnes?.value_text).toBe(`${org}/${uuid}/devis.pdf`);
    for (const piege of ['devis.pdf', 'https://x.ca/devis.pdf', `${org}/../autre/devis.pdf`, `${org}/${uuid}/a/b.pdf`]) {
      expect(() => preparerValeur(champ('file'), piege), piege).toThrow(ErreurValeur);
    }
    expect(formaterValeur(champ('file'), `${org}/${uuid}/devis.pdf`)).toBe('devis.pdf');
  });
  it('filtres : présent ou absent seulement', () => {
    expect(OPERATEURS_PAR_FAMILLE.fichier).toEqual(['is_empty', 'is_not_empty']);
    expect(evaluerCondition('file', null, { field_id: 'f1', op: 'is_empty' })).toBe(true);
  });
  it('base : bucket privé, policies par entreprise, chemin limité au dossier de l’entreprise du champ', () => {
    const sql = readFileSync(join(__dirname, '..', 'supabase/migrations/20260929170000_champs_types_case_url_fichier.sql'), 'utf8');
    expect(sql).toMatch(/values \('custom-field-files', 'custom-field-files', false,/);
    for (const op of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toContain(`create policy "custom_field_files_${op}_own_org" on storage.objects for ${op} to authenticated`);
    }
    expect(sql).toContain("new.value_text !~ ('^' || f.org_id::text || '/[0-9a-f-]{36}/[^/]{1,200}$')");
    // Baseline (buckets et policies storage hors pg_dump) tenue à jour.
    const post = readFileSync(join(__dirname, '..', 'supabase/baseline/02_post_schema.sql'), 'utf8');
    expect(post).toContain("values ('custom-field-files', 'custom-field-files', false, 26214400,");
    expect(post).toContain('create policy "custom_field_files_select_own_org"');
  });
  it('pas proposé dans le formulaire public (pas de téléversement)', () => {
    const s = readFileSync(join(__dirname, '..', 'src/components/champs/AjouterChampsFormulaire.tsx'), 'utf8');
    expect(s).toContain("c.field_type !== 'file'");
  });
});

describe('base : la migration couvre toutes les fonctions qui lisent les valeurs', () => {
  const sql = readFileSync(join(__dirname, '..', 'supabase/migrations/20260929170000_champs_types_case_url_fichier.sql'), 'utf8');
  it('value_boolean écrit, relu, copié, trié, exporté', () => {
    for (const f of ['cf_valeur_avant_ecriture', 'cf_ecrire_valeur', 'cf_copier_valeurs', 'cf_copier_valeurs_deal_vers_job', 'cf_valeurs_lisibles', 'cf_ordre_ids', 'cf_condition_sql']) {
      expect(sql, f).toMatch(new RegExp(`create or replace function public\\.${f}\\(`));
    }
    expect(sql.match(/value_boolean/g)!.length).toBeGreaterThan(15);
  });
  it('url : même garde que le code (http(s), 2000 caractères)', () => {
    expect(sql).toContain("new.value_text !~* '^https?://[^\\s/$.?#][^\\s]*$' or length(new.value_text) > 2000");
  });
});
