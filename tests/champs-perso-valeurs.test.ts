/**
 * Valeurs des champs personnalisés : validation avant écriture et
 * formatage (affichage, variables de modèles). src/lib/champs/valeurs.ts
 */
import { describe, it, expect } from 'vitest';
import { preparerValeur, formaterValeur, lireValeur, ErreurValeur } from '../src/lib/champs/valeurs';
import type { ChampPerso, TypeChamp, ConfigChamp } from '../src/lib/champs/types';

const opts = [
  { id: 'o1', label: 'Asphalte', color: '#334455', position: 0, archived_at: null },
  { id: 'o2', label: 'Pavé', color: null, position: 1, archived_at: null },
  { id: 'o3', label: 'Gravier', color: null, position: 2, archived_at: '2026-09-01T00:00:00Z' },
];
const champ = (field_type: TypeChamp, config: ConfigChamp = {}): Pick<ChampPerso, 'label' | 'field_type' | 'config' | 'options'> =>
  ({ label: 'Test', field_type, config, options: opts });

describe('preparerValeur', () => {
  it('vide → suppression de la ligne', () => {
    expect(preparerValeur(champ('single_line'), '  ').colonnes).toBeNull();
    expect(preparerValeur(champ('dropdown_multi'), []).colonnes).toBeNull();
  });
  it('une seule colonne typée remplie', () => {
    const c = preparerValeur(champ('number'), '12,5').colonnes!;
    expect(c.value_number).toBe(12.5);
    expect(c.value_text).toBeNull();
  });
  it('nombre : décimales et bornes du champ', () => {
    expect(preparerValeur(champ('number', { decimals: 0 }), 12.6).colonnes!.value_number).toBe(13);
    expect(() => preparerValeur(champ('number', { max: 10 }), 11)).toThrow(ErreurValeur);
  });
  it('montant : des cents entiers, jamais des dollars flottants', () => {
    const c = preparerValeur(champ('monetary', { currency: 'cad' }), 125050).colonnes!;
    expect(c).toMatchObject({ value_money_cents: 125050, value_currency: 'CAD' });
    expect(() => preparerValeur(champ('monetary'), 12.5)).toThrow(/cents/);
  });
  it('téléphone normalisé, courriel validé', () => {
    expect(preparerValeur(champ('phone'), '(819) 555-1234').colonnes!.value_text).toBe('+18195551234');
    expect(() => preparerValeur(champ('phone'), '12')).toThrow(/téléphone/);
    expect(() => preparerValeur(champ('email'), 'pas@ok')).toThrow(/courriel/);
  });
  it('une ligne refuse le saut de ligne', () => {
    expect(() => preparerValeur(champ('single_line'), 'a\nb')).toThrow(/une ligne/);
  });
  it('date seule vs date + heure', () => {
    expect(preparerValeur(champ('date'), '2026-09-24').colonnes!.value_date).toBe('2026-09-24');
    expect(() => preparerValeur(champ('date'), '24/09/2026')).toThrow(/AAAA-MM-JJ/);
    expect(preparerValeur(champ('date', { include_time: true }), '2026-09-24T14:30:00-04:00').colonnes!.value_timestamp).toBe('2026-09-24T18:30:00.000Z');
  });
  it('listes : ids d’options ACTIVES du champ seulement', () => {
    expect(preparerValeur(champ('dropdown_single'), 'o1').colonnes!.value_option_id).toBe('o1');
    expect(() => preparerValeur(champ('dropdown_single'), 'o3')).toThrow(/retirée/);   // archivée
    expect(() => preparerValeur(champ('dropdown_single'), 'autre')).toThrow(/option/);  // d'un autre champ
    expect(preparerValeur(champ('dropdown_multi'), ['o2', 'o1', 'o2']).options).toEqual(['o2', 'o1']);
  });
});

describe('formaterValeur', () => {
  it('montant selon la langue', () => {
    expect(formaterValeur(champ('monetary'), 125000, 'fr').replace(/\s/g, ' ')).toBe('1 250,00 $');
    expect(formaterValeur(champ('monetary'), 125000, 'en')).toBe('$1,250.00');
  });
  it('date seule : jamais décalée par un fuseau', () => {
    expect(formaterValeur(champ('date'), '2026-09-24', 'fr')).toBe('24 septembre 2026');
    expect(formaterValeur(champ('date'), '2026-09-24', 'en')).toBe('September 24, 2026');
  });
  it('listes → libellés (une option archivée reste lisible)', () => {
    expect(formaterValeur(champ('dropdown_multi'), ['o1', 'o3'], 'fr')).toBe('Asphalte, Gravier');
  });
  it('téléphone lisible, vide → chaîne vide', () => {
    expect(formaterValeur(champ('phone'), '+18195551234')).toBe('(819) 555-1234');
    expect(formaterValeur(champ('single_line'), null)).toBe('');
  });
});

describe('lireValeur', () => {
  it('prend la colonne du type', () => {
    expect(lireValeur('monetary', { value_money_cents: 500, value_text: 'x' })).toBe(500);
    expect(lireValeur('dropdown_multi', {}, ['o1'])).toEqual(['o1']);
    expect(lireValeur('date', { value_date: '2026-01-01' })).toBe('2026-01-01');
  });
});
