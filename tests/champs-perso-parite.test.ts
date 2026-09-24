/**
 * Champs personnalisés v2 — le code et la base parlent la même langue.
 *
 * Les listes vivent à deux endroits (TypeScript pour l'UI et le serveur,
 * SQL pour les contraintes) ; une divergence donnerait un champ que l'écran
 * propose et que la base refuse, ou pire, une clé standard non réservée.
 * On lit la migration et on compare.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OBJETS, TYPES_CHAMP, TYPES_UNIQUES, CONVERSIONS_SURES } from '../src/lib/champs/types';
import { CHAMPS_STANDARD } from '../src/lib/champs/standard';
import { OPERATEURS_PAR_FAMILLE } from '../src/lib/champs/filtres';
import { slugCle } from '../src/lib/champs/valeurs';

const MIG = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20260926100000_champs_personnalises_v2.sql'), 'utf8');
const liste = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

describe('parité SQL ↔ TypeScript', () => {
  it('objets', () => {
    const m = /create type public\.cf_object_type as enum \(([^)]*)\)/.exec(MIG);
    expect(liste(m![1])).toEqual([...OBJETS]);
  });
  it('types de champ', () => {
    const m = /create type public\.cf_field_type as enum \(([^)]*)\)/s.exec(MIG);
    expect(liste(m![1])).toEqual([...TYPES_CHAMP]);
  });
  it('types uniques (CHECK custom_fields_unique_types)', () => {
    const m = /not is_unique or field_type in \(([^)]*)\)/.exec(MIG);
    expect(liste(m![1]).sort()).toEqual([...TYPES_UNIQUES].sort());
  });
  it('clés standard réservées (cf_cles_standard) = registre CHAMPS_STANDARD', () => {
    for (const objet of OBJETS) {
      const m = new RegExp(`when '${objet}'\\s+then array\\[([^\\]]*)\\]`).exec(MIG);
      expect(m, objet).not.toBeNull();
      expect(liste(m![1]), objet).toEqual(CHAMPS_STANDARD[objet].map((c) => c.key));
    }
  });
  it('conversions permises (trigger) = CONVERSIONS_SURES', () => {
    const paires = [...MIG.matchAll(/\('([a-z_]+)'::public\.cf_field_type, '([a-z_]+)'::public\.cf_field_type\)/g)].map((m) => `${m[1]}>${m[2]}`);
    expect(paires.sort()).toEqual(CONVERSIONS_SURES.map(([a, b]) => `${a}>${b}`).sort());
  });
  it('opérateurs par famille (cf_condition_sql) = OPERATEURS_PAR_FAMILLE', () => {
    const bloc = MIG.slice(MIG.indexOf('-- Opérateurs permis par type'), MIG.indexOf("if op = 'is_empty'"));
    const tableaux = [...bloc.matchAll(/array\[([^\]]*)\]/g)].map((m) => liste(m[1]));
    expect(tableaux).toEqual([
      OPERATEURS_PAR_FAMILLE.texte, OPERATEURS_PAR_FAMILLE.nombre, OPERATEURS_PAR_FAMILLE.liste, OPERATEURS_PAR_FAMILLE.date,
    ]);
  });
});

describe('garanties écrites dans la migration', () => {
  it('les FK composites en SET NULL nomment leur colonne (sinon org_id passe à NULL)', () => {
    const sansCommentaires = MIG.replace(/--[^\n]*/g, '');
    const setNull = [...sansCommentaires.matchAll(/on delete set null(\s*\([a-z_]+\))?/g)];
    expect(setNull.length).toBeGreaterThan(0);
    for (const m of setNull) expect(m[1], 'set null sans colonne').toBeTruthy();
  });
  it('une valeur ne se supprime pas avec son champ (RESTRICT) mais suit son entité (CASCADE)', () => {
    expect(MIG).toMatch(/custom_field_values_field_fk foreign key \(org_id, object_type, field_id\)\s+references public\.custom_fields \(org_id, object_type, id\) on delete restrict/);
    for (const e of ['client', 'deal', 'job', 'quote', 'invoice']) {
      expect(MIG).toMatch(new RegExp(`custom_field_values_${e}_fk\\s+foreign key \\(org_id, ${e}_id\\)\\s+references public\\.\\w+\\s+\\(org_id, id\\) on delete cascade`));
    }
  });
  it('RLS activée sur les six tables', () => {
    for (const t of ['custom_field_folders', 'custom_fields', 'custom_field_options', 'custom_field_values', 'custom_field_value_options', 'custom_field_pipeline_cards']) {
      expect(MIG).toContain(`alter table public.${t} enable row level security;`);
    }
  });
  it('les fonctions internes sont fermées à anon ET authenticated', () => {
    for (const f of ['cf_champ_avant_ecriture()', 'cf_valeur_avant_ecriture()', 'cf_deal_job_lie()', 'cf_valeurs_lisibles(uuid)']) {
      expect(MIG).toMatch(new RegExp(`revoke all on function public\\.${f.replace(/[()]/g, '\\$&')} from public, anon, authenticated`));
    }
  });
  it('Loi 25 : l’export et l’effacement couvrent les valeurs', () => {
    expect(MIG).toContain("'custom_fields', public.cf_valeurs_lisibles(p_client_id)");
    expect(MIG).toMatch(/delete from public\.custom_field_values\s+where client_id = p_client_id/);
  });
});

describe('slug de clé (miroir de cf_slug)', () => {
  it.each([
    ['Superficie du terrain', 'superficie_du_terrain'],
    ['Émail  (secondaire)', 'email_secondaire'],
    ['2e étage', 'e_etage'],
    ['!!!', 'champ'],
    ['Nombre de fenêtres', 'nombre_de_fenetres'],
  ])('%s → %s', (libelle, cle) => {
    expect(slugCle(libelle)).toBe(cle);
  });
});
