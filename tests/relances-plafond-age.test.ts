/**
 * Plafond d'âge des relances de factures.
 *
 * La sélection n'avait qu'une borne HAUTE : une facture échue depuis six mois
 * restait éligible à TOUS les paliers du calendrier, pour toujours. Mesuré en
 * production le 2026-09-25 sur la seule organisation ayant activé les
 * relances : 4 factures (138 à 173 jours de retard) × 4 paliers = 16 messages
 * qui seraient partis la même nuit au premier déclenchement du cron.
 *
 * Ce test rejoue ce cas réel.
 */
import { describe, it, expect } from 'vitest';
import {
  fenetreRelance,
  plafondRelanceJours,
  PLAFOND_RELANCE_JOURS_DEFAUT,
} from '../server/routes/reminders-cron';

const AUJOURDHUI = new Date('2026-09-25T00:00:00Z');

/** Les 4 paliers configurés en production. */
const PALIERS = [1, 7, 14, 30];

/** Les 4 factures réelles, par leur date d'échéance. */
const FACTURES = ['2026-04-05', '2026-04-24', '2026-04-25', '2026-05-10'];

/** Compte les envois qui partiraient, tous paliers confondus. */
function envois(plafond: number): number {
  let n = 0;
  for (const palier of PALIERS) {
    const f = fenetreRelance(AUJOURDHUI, palier, plafond);
    for (const due of FACTURES) {
      if (due <= f.max && (!f.min || due >= f.min)) n++;
    }
  }
  return n;
}

describe('la salve de rattrapage mesurée en production', () => {
  it('sans plafond, les 4 factures partent à chacun des 4 paliers — 16 messages', () => {
    // C'est le comportement d'AVANT le correctif : on le fige pour que la
    // régression soit visible si quelqu'un retire la borne basse.
    expect(envois(0)).toBe(16);
  });

  it('avec le plafond par défaut, plus rien ne part : elles ont toutes plus de 90 jours', () => {
    expect(envois(PLAFOND_RELANCE_JOURS_DEFAUT)).toBe(0);
  });
});

describe('fenetreRelance', () => {
  it('pose la borne haute au palier demandé', () => {
    expect(fenetreRelance(AUJOURDHUI, 7, 90).max).toBe('2026-09-18');
  });

  it('pose la borne basse au plafond', () => {
    expect(fenetreRelance(AUJOURDHUI, 7, 90).min).toBe('2026-06-27');
  });

  it('un plafond nul ou négatif retire la borne basse', () => {
    expect(fenetreRelance(AUJOURDHUI, 7, 0).min).toBeNull();
    expect(fenetreRelance(AUJOURDHUI, 7, -5).min).toBeNull();
  });

  it('une facture due aujourd’hui reste relançable au palier 0', () => {
    const f = fenetreRelance(AUJOURDHUI, 0, 90);
    expect(f.max).toBe('2026-09-25');
    expect('2026-09-25' <= f.max).toBe(true);
  });

  it('les bornes sont inclusives des deux côtés', () => {
    const f = fenetreRelance(AUJOURDHUI, 7, 90);
    expect(f.min! <= '2026-06-27' && '2026-06-27' <= f.max).toBe(true);
    expect('2026-06-26' >= f.min!).toBe(false);
  });
});

describe('plafondRelanceJours', () => {
  it('vaut 90 jours par défaut', () => {
    expect(plafondRelanceJours({} as NodeJS.ProcessEnv)).toBe(90);
  });

  it('se règle par REMINDER_MAX_AGE_DAYS', () => {
    expect(plafondRelanceJours({ REMINDER_MAX_AGE_DAYS: '30' } as NodeJS.ProcessEnv)).toBe(30);
  });

  it('0 désactive le plafond explicitement', () => {
    expect(plafondRelanceJours({ REMINDER_MAX_AGE_DAYS: '0' } as NodeJS.ProcessEnv)).toBe(0);
  });

  it('une valeur illisible ne supprime pas le garde-fou en silence', () => {
    // Le risque : une faute de frappe dans Railway rouvre la vanne sans bruit.
    for (const v of ['abc', '-1', 'NaN', ' ']) {
      expect(plafondRelanceJours({ REMINDER_MAX_AGE_DAYS: v } as NodeJS.ProcessEnv), v).toBe(90);
    }
  });
});
