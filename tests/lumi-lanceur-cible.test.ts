/**
 * Le lanceur (evals/lumi-tools/run.mts) lit la cible d'une carte avec ses variantes.
 *
 * Le jeu evals/lumi écrit « Girard|5 » : la carte doit porter l'UNE des formes. Le lanceur
 * cherchait la chaîne « Girard|5 » telle quelle et notait « carte incomplète » une carte qui
 * disait « #5 · Patrick Girard » (passe du 2026-10-01, fact-03 et fact-09).
 */
import { describe, it, expect } from 'vitest';
import { juger } from '../evals/lumi-tools/run.mts';

const carte = { genre: 'action', cibles: [{ libelle: { fr: 'Facture', en: 'Invoice' }, valeur: '#5 · Patrick Girard · total 919,80 $' }], details: [] };
const observe = { proposition: 'mark_invoice_paid', groupe: [], lectures: [], executes: 0, args: { invoice_id: 'x' }, apercu: carte, reponse: '' };
const cas = (cible: string[]) => ({ id: 't', section: 'facturation', outil: 'mark_invoice_paid', langue: 'fr', type: 'action', q: 'q', cible } as never);

describe('lanceur : cible de la carte', () => {
  it('une des variantes suffit', () => {
    expect(juger(cas(['Girard|5']), observe).params_manquants).toEqual([]);
    expect(juger(cas(['Tremblay|Girard']), observe).params_manquants).toEqual([]);
  });

  it('aucune variante sur la carte : la cible manque', () => {
    expect(juger(cas(['Tremblay|Bergeron']), observe).params_manquants).toEqual(['carte:Tremblay|Bergeron']);
  });

  it('une cible simple se lit comme avant', () => {
    expect(juger(cas(['Girard']), observe).params_manquants).toEqual([]);
    expect(juger(cas(['Fournier']), observe).params_manquants).toEqual(['carte:Fournier']);
  });
});
