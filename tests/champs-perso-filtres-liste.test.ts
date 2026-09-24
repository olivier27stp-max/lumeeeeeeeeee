/**
 * Filtres de champs personnalisés des LISTES (clients, jobs, devis) :
 * conditions → jointures + filtres PostgREST. src/lib/champs/filtresListe.ts
 * La parité avec le moteur SQL se prouve contre staging :
 * scripts/qa/verifier-filtres-liste.mts (38/38).
 * Ici : la forme de la requête, sans base.
 */
import { describe, it, expect } from 'vitest';
import { compilerFiltresListe, instantDepuisMur, FILTRE_VIDE, type Filtrable } from '../src/lib/champs/filtresListe';
import { valeurDepuisTexte } from '../src/lib/champs/valeurs';
import type { ChampPerso, TypeChamp, ConfigChamp } from '../src/lib/champs/types';

const opts = [
  { id: 'o1', label: 'Résidentiel', color: null, position: 0, archived_at: null },
  { id: 'o2', label: 'Commercial', color: null, position: 1, archived_at: null },
];
const champ = (id: string, field_type: TypeChamp, config: ConfigChamp = {}) =>
  ({ id, field_type, config, options: opts, label: id, key: id, object_type: 'client' }) as unknown as ChampPerso;

/** Enregistre chaque appel du constructeur. */
class Enregistreur implements Filtrable<Enregistreur> {
  appels: string[] = [];
  private noter(f: string, col: string, v: unknown) { this.appels.push(`${f} ${col} ${JSON.stringify(v)}`); return this; }
  eq(c: string, v: unknown) { return this.noter('eq', c, v); }
  in(c: string, v: readonly unknown[]) { return this.noter('in', c, v); }
  gt(c: string, v: unknown) { return this.noter('gt', c, v); }
  gte(c: string, v: unknown) { return this.noter('gte', c, v); }
  lt(c: string, v: unknown) { return this.noter('lt', c, v); }
  lte(c: string, v: unknown) { return this.noter('lte', c, v); }
  like(c: string, v: string) { return this.noter('like', c, v); }
  is(c: string, v: null) { return this.noter('is', c, v); }
}
const TZ = 'America/Toronto';
const MAINTENANT = new Date('2026-09-24T16:00:00Z'); // 12 h à Toronto

describe('compilerFiltresListe', () => {
  it('sans condition : filtre vide, requête intacte', () => {
    expect(compilerFiltresListe([], [], TZ)).toBe(FILTRE_VIDE);
  });

  it('présence → jointure !inner ; absence → jointure gauche + anti-jointure', () => {
    const nb = champ('n', 'number');
    const f = compilerFiltresListe([
      { field_id: 'n', op: 'gt', value: 5 },
      { field_id: 'n', op: 'neq', value: 10 },
    ], [nb], TZ, MAINTENANT);
    expect(f.select).toBe(', cf0:custom_field_values!inner(id), cf1:custom_field_values(id)');
    const q = f.appliquer(new Enregistreur());
    expect(q.appels).toEqual([
      'eq cf0.field_id "n"', 'gt cf0.value_number 5',
      'eq cf1.field_id "n"', 'eq cf1.value_number 10', 'is cf1 null',
    ]);
  });

  it('texte « contient » : normalisé, % et _ échappés', () => {
    const f = compilerFiltresListe([{ field_id: 't', op: 'contains', value: '  100%  Bio_x ' }], [champ('t', 'single_line')], TZ, MAINTENANT);
    expect(f.appliquer(new Enregistreur()).appels[1]).toBe('like cf0.value_normalized "%100\\\\% bio\\\\_x%"');
  });

  it('liste multiple : jointure sur les options', () => {
    const f = compilerFiltresListe([{ field_id: 'm', op: 'any_of', value: ['o1'] }], [champ('m', 'dropdown_multi')], TZ, MAINTENANT);
    expect(f.select).toContain('cf0:custom_field_values!inner(id,o:custom_field_value_options!inner(option_id))');
    expect(f.appliquer(new Enregistreur()).appels).toContain('in cf0.o.option_id ["o1"]');
  });

  it('date + heure « aujourd’hui » : bornes à minuit HEURE LOCALE, pas UTC', () => {
    const f = compilerFiltresListe([{ field_id: 'd', op: 'today' }], [champ('d', 'date', { include_time: true })], TZ, MAINTENANT);
    const a = f.appliquer(new Enregistreur()).appels;
    expect(a).toContain('gte cf0.value_timestamp "2026-09-24T04:00:00.000Z"');
    expect(a).toContain('lt cf0.value_timestamp "2026-09-25T04:00:00.000Z"');
  });

  it('un champ disparu ou un opérateur invalide lève (jamais de filtre ignoré en silence)', () => {
    expect(() => compilerFiltresListe([{ field_id: 'x', op: 'is_empty' }], [], TZ)).toThrow();
    expect(() => compilerFiltresListe([{ field_id: 'n', op: 'contains', value: 'a' }], [champ('n', 'number')], TZ)).toThrow();
  });
});

describe('instantDepuisMur', () => {
  it('heure murale → instant, y compris l’hiver', () => {
    expect(instantDepuisMur('2026-09-24T00:00:00', TZ)).toBe('2026-09-24T04:00:00.000Z');
    expect(instantDepuisMur('2026-01-15T00:00:00', TZ)).toBe('2026-01-15T05:00:00.000Z');
  });
});

describe('valeurDepuisTexte (import CSV)', () => {
  it('argent en dollars → cents, nombre à virgule, date JJ/MM/AAAA', () => {
    expect(valeurDepuisTexte(champ('a', 'monetary'), '1 250,50 $')).toBe(125050);
    expect(valeurDepuisTexte(champ('n', 'number'), '12,5')).toBe(12.5);
    expect(valeurDepuisTexte(champ('d', 'date'), '3/9/2026')).toBe('2026-09-03');
  });
  it('listes : par libellé, sans casse ; multiple séparé par | ou ;', () => {
    expect(valeurDepuisTexte(champ('l', 'dropdown_single'), 'commercial')).toBe('o2');
    expect(valeurDepuisTexte(champ('m', 'dropdown_multi'), 'Résidentiel | Commercial')).toEqual(['o1', 'o2']);
  });
  it('cellule vide → rien', () => {
    expect(valeurDepuisTexte(champ('t', 'single_line'), '   ')).toBeNull();
  });
});
