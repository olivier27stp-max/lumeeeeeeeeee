/**
 * Champs personnalisés de base : la migration (cf_champs_base) et le code
 * (CHAMPS_DE_BASE) disent la même chose, et chaque champ est bien rangé.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHAMPS_DE_BASE } from '../src/lib/champs/base';
import { SECTIONS_SYSTEME, clesStandard } from '../src/lib/champs/standard';
import { MODELES_CHAMPS } from '../src/lib/champs/modeles';
import { TYPES_CHAMP } from '../src/lib/champs/types';

// Le trigger des nouvelles entreprises vit dans la migration d'origine ; le ménage (31 → 8 champs,
// 2026-09-30) archive les champs retirés.
const MIG = readFileSync(resolve(__dirname, '../supabase/migrations/20261003520000_champs_de_base.sql'), 'utf8');
const MENAGE = readFileSync(resolve(__dirname, '../supabase/migrations/20261005400000_menage_champs_de_base.sql'), 'utf8');
// Le catalogue COURANT : celui du ménage + noreview (avis clients, 2026-09-30).
const NOREVIEW = readFileSync(resolve(__dirname, '../supabase/migrations/20261005500000_champ_noreview.sql'), 'utf8');
const sqlTexte = (s: string) => s.replace(/''/g, "'");

// Une ligne du VALUES : ('objet', 'dossier', 'cle', 'fr', 'en', 'type', 'config', options|null, position)
const LIGNE = /\('(\w+)', '(\w+)', '(\w+)', '((?:[^']|'')*)', '((?:[^']|'')*)', '(\w+)', '([^']*)',\s*(null|'((?:[^']|'')*)'), (\d+)\)/g;
const lignesSql = [...NOREVIEW.matchAll(LIGNE)].map((m) => ({
  objet: m[1], dossier: m[2], cle: m[3], fr: sqlTexte(m[4]), en: sqlTexte(m[5]), type: m[6],
  config: JSON.parse(m[7]), options: m[8] === 'null' ? undefined : JSON.parse(sqlTexte(m[9])), position: Number(m[10]),
}));

describe('champs de base', () => {
  it('migration = code (mêmes champs, libellés, types, config, options, ordre)', () => {
    expect(lignesSql).toHaveLength(CHAMPS_DE_BASE.length);
    const code = CHAMPS_DE_BASE.map((c) => ({ objet: c.objet, dossier: c.dossier, cle: c.cle, fr: c.fr, en: c.en, type: c.type, config: c.config ?? {}, options: c.options }));
    expect(lignesSql.map(({ position: _p, ...x }) => x)).toEqual(code);
  });

  it('positions : 0, 1, 2… dans chaque dossier, dans l’ordre du catalogue', () => {
    const vus = new Map<string, number>();
    for (const l of lignesSql) {
      const k = `${l.objet}:${l.dossier}`;
      expect(l.position).toBe(vus.get(k) ?? 0);
      vus.set(k, l.position + 1);
    }
  });

  it('chaque champ est rangé dans une section qui existe pour son objet', () => {
    for (const c of CHAMPS_DE_BASE) expect(SECTIONS_SYSTEME[c.objet].map((s) => s.cle), c.cle).toContain(c.dossier);
  });

  it('clés valides, uniques par objet, jamais réservées par le formulaire', () => {
    const vues = new Set<string>();
    for (const c of CHAMPS_DE_BASE) {
      expect(c.cle).toMatch(/^[a-z][a-z0-9_]{0,49}$/);
      expect(vues.has(`${c.objet}:${c.cle}`), c.cle).toBe(false);
      vues.add(`${c.objet}:${c.cle}`);
      expect(clesStandard(c.objet), c.cle).not.toContain(c.cle);
    }
  });

  it('liste courte, types valides (ménage du 2026-09-30 : un champ vide encombre chaque formulaire)', () => {
    expect(CHAMPS_DE_BASE.length).toBeLessThanOrEqual(12);
    for (const c of CHAMPS_DE_BASE) expect(TYPES_CHAMP, c.cle).toContain(c.type);
  });

  it('ménage : aucun champ gardé n’est archivé, et Lumi garde depense_autres', () => {
    const archives = [...MENAGE.slice(MENAGE.indexOf('update public.custom_fields')).matchAll(/\('(\w+)', '(\w+)'\)/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(archives.length).toBe(30);
    for (const c of CHAMPS_DE_BASE) expect(archives, c.cle).not.toContain(`${c.objet}:${c.cle}`);
    const depenses = [...MENAGE.slice(MENAGE.indexOf('create or replace function public.cf_depenses_champs_base'), MENAGE.indexOf('update public.custom_fields')).matchAll(/\('(depense_\w+)'/g)].map((m) => m[1]);
    expect(depenses).toEqual(['depense_carburant', 'depense_sous_traitance', 'depense_autres']);
    for (const d of depenses) expect(archives).not.toContain(`job:${d}`);
    // L'archivage ne touche que les champs d'origine et sans valeur.
    expect(MENAGE).toContain('and f.created_by is null');
    expect(MENAGE).toContain('not exists (select 1 from public.custom_field_values v where v.field_id = f.id)');
  });

  it('une clé partagée garde le même type partout (sinon la valeur ne suit pas devis → job → facture)', () => {
    const types = new Map<string, string>();
    for (const c of CHAMPS_DE_BASE) {
      if (types.has(c.cle)) expect(c.type, c.cle).toBe(types.get(c.cle));
      types.set(c.cle, c.type);
    }
    for (const modele of Object.values(MODELES_CHAMPS).flat()) {
      if (types.has(modele.key)) expect(modele.field_type, modele.key).toBe(types.get(modele.key));
    }
  });

  it('listes à choix : des options fr ET en ; les autres types : aucune', () => {
    for (const c of CHAMPS_DE_BASE) {
      const aChoix = c.type === 'dropdown_single' || c.type === 'dropdown_multi';
      expect(Boolean(c.options?.length), c.cle).toBe(aChoix);
      for (const o of c.options ?? []) { expect(o.fr.trim()).not.toBe(''); expect(o.en.trim()).not.toBe(''); }
    }
  });

  it('le trigger des nouvelles entreprises garde les dossiers système et le dossier Dépenses', () => {
    const corps = MIG.slice(MIG.indexOf('create or replace function public.cf_orgs_dossiers_systeme()'));
    expect(corps).toContain('perform public.cf_assurer_dossiers_systeme(new.id);');
    expect(corps).toContain('perform public.cf_assurer_dossier_depenses(new.id);');
    expect(corps).toContain('perform public.cf_assurer_champs_base(new.id);');
    expect(MIG).toContain('revoke all on function public.cf_assurer_champs_base(uuid) from public, anon, authenticated;');
  });
});
