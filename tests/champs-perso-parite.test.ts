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
import { CHAMPS_STANDARD, SECTIONS_SYSTEME } from '../src/lib/champs/standard';
import { OPERATEURS_PAR_FAMILLE } from '../src/lib/champs/filtres';
import { slugCle } from '../src/lib/champs/valeurs';

const MIG = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20260926100000_champs_personnalises_v2.sql'), 'utf8');
const liste = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
// Types ajoutés ensuite (Case à cocher, URL) : la version en vigueur des fonctions est la plus récente.
const MIG_TYPES = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20260929170000_champs_types_case_url_fichier.sql'), 'utf8');
// Objet « Propriété » : cf_cles_standard en vigueur y est redéfinie.
const MIG_PROPRIETE = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20260929180000_champs_objet_propriete.sql'), 'utf8');
// Champs système (audit des formulaires) : cf_cles_standard en vigueur + cf_sections_systeme.
const MIG_SYSTEME = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20260930100000_champs_dossiers_systeme.sql'), 'utf8');
// Clés réservées en vigueur (champs manquants ajoutés, 2026-09-28).
const MIG_CLES = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20260930110000_champs_systeme_affichage.sql'), 'utf8');

describe('parité SQL ↔ TypeScript', () => {
  it('objets', () => {
    const m = /create type public\.cf_object_type as enum \(([^)]*)\)/.exec(MIG);
    const ajoutes = [...MIG_PROPRIETE.matchAll(/alter type public\.cf_object_type add value if not exists '([a-z_]+)'/g)].map((x) => x[1]);
    expect([...liste(m![1]), ...ajoutes]).toEqual([...OBJETS]);
  });
  it('types de champ', () => {
    const m = /create type public\.cf_field_type as enum \(([^)]*)\)/s.exec(MIG);
    const ajoutes = [...MIG_TYPES.matchAll(/alter type public\.cf_field_type add value if not exists '([a-z_]+)'/g)].map((x) => x[1]);
    expect([...liste(m![1]), ...ajoutes].sort()).toEqual([...TYPES_CHAMP].sort());
  });
  it('types uniques (CHECK custom_fields_unique_types)', () => {
    const m = /not is_unique or field_type in \(([^)]*)\)/.exec(MIG);
    expect(liste(m![1]).sort()).toEqual([...TYPES_UNIQUES].sort());
  });
  it('clés standard réservées (cf_cles_standard) = registre CHAMPS_STANDARD', () => {
    for (const objet of OBJETS) {
      const m = new RegExp(`when '${objet}'\\s+then array\\[([^\\]]*)\\]`).exec(MIG_CLES);
      expect(m, objet).not.toBeNull();
      expect(liste(m![1]), objet).toEqual(CHAMPS_STANDARD[objet].map((c) => c.key));
    }
  });
  it('sections des formulaires (cf_sections_systeme) = SECTIONS_SYSTEME, chaque champ vise une section existante', () => {
    const sql = [...MIG_SYSTEME.matchAll(/\('([a-z_]+)', '([a-z_]+)', '([^']+)', (\d+)\)/g)].map((m) => `${m[1]}:${m[2]}:${m[3]}:${m[4]}`);
    const ts = OBJETS.flatMap((o) => SECTIONS_SYSTEME[o].map((sec, i) => `${o}:${sec.cle}:${sec.nom.fr}:${i}`));
    expect(sql).toEqual(ts);
    for (const o of OBJETS) {
      const cles = new Set(SECTIONS_SYSTEME[o].map((x) => x.cle));
      for (const c of CHAMPS_STANDARD[o]) if (c.section) expect(cles.has(c.section), `${o}.${c.key} → ${c.section}`).toBe(true);
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
  it('opérateurs par famille — version en vigueur (20260929170000, case à cocher et fichier)', () => {
    const bloc = MIG_TYPES.slice(MIG_TYPES.indexOf('-- Opérateurs permis par type'), MIG_TYPES.indexOf("if op = 'is_empty'"));
    const tableaux = [...bloc.matchAll(/array\[([^\]]*)\]/g)].map((m) => liste(m[1]));
    expect(tableaux).toEqual([
      OPERATEURS_PAR_FAMILLE.texte, OPERATEURS_PAR_FAMILLE.nombre, OPERATEURS_PAR_FAMILLE.liste, OPERATEURS_PAR_FAMILLE.case,
      OPERATEURS_PAR_FAMILLE.fichier, OPERATEURS_PAR_FAMILLE.date,
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
  it('RLS FORCÉE sur les six tables (invariant check_rls_coverage, cron quotidien)', () => {
    const force = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20260926100300_champs_perso_force_rls.sql'), 'utf8');
    for (const t of ['custom_field_folders', 'custom_fields', 'custom_field_options', 'custom_field_values', 'custom_field_value_options', 'custom_field_pipeline_cards']) {
      expect(force).toContain(`alter table public.${t} force row level security;`);
    }
  });
  it('le retrait de l’ancien registre ne casse pas le cron des invariants', () => {
    const retrait = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20260926100200_retirer_custom_columns.sql'), 'utf8');
    // check_all_invariants est redéfinie AVANT de retirer check_custom_field_orphans…
    expect(retrait.indexOf('CREATE OR REPLACE FUNCTION public.check_all_invariants()'))
      .toBeLessThan(retrait.indexOf('drop function if exists public.check_custom_field_orphans()'));
    // …et ne l'appelle plus.
    const corps = retrait.slice(retrait.indexOf('CREATE OR REPLACE FUNCTION public.check_all_invariants()'), retrait.indexOf('end $function$'));
    expect(corps).not.toContain('check_custom_field_orphans');
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
