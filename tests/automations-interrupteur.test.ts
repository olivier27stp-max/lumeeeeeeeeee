/**
 * L'interrupteur d'arrêt des automatisations — F6 (2026-09-23).
 *
 * Deux propriétés comptent, et une seule est évidente :
 *   1. « false » arrête tout ;
 *   2. TOUT LE RESTE laisse passer. Une variable absente, vide ou mal
 *      orthographiée ne doit jamais couper la production en silence — c'est
 *      le mode de panne qu'on chercherait pendant des heures.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  automatisationsActives,
  automatisationsActivesAvecTrace,
  reinitialiserTraceInterrupteur,
} from '../server/lib/automations-interrupteur';
import { logger } from '../server/lib/logger';

const env = (v?: string) => (v === undefined ? {} : { AUTOMATIONS_ENABLED: v }) as NodeJS.ProcessEnv;

describe('ce qui ARRÊTE le moteur', () => {
  it('les formes explicitement négatives', () => {
    for (const v of ['false', 'FALSE', 'False', '0', 'off', 'no', '  false  ']) {
      expect(automatisationsActives(env(v)), `« ${v} » aurait dû arrêter`).toBe(false);
    }
  });
});

describe('ce qui LAISSE PASSER — le défaut sûr', () => {
  it('une variable absente : un oubli de configuration ne doit pas couper les automatisations', () => {
    expect(automatisationsActives(env())).toBe(true);
  });

  it('une valeur vide', () => {
    expect(automatisationsActives(env(''))).toBe(true);
  });

  it('les formes positives', () => {
    for (const v of ['true', 'TRUE', '1', 'on', 'yes']) {
      expect(automatisationsActives(env(v)), `« ${v} » aurait dû laisser passer`).toBe(true);
    }
  });

  it('une faute de frappe laisse passer plutôt que de couper', () => {
    // « flase » ne doit pas arrêter la production d'un client.
    for (const v of ['flase', 'disabled', 'nope', 'null', 'undefined']) {
      expect(automatisationsActives(env(v)), `« ${v} » ne devait pas arrêter`).toBe(true);
    }
  });
});

describe('la trace', () => {
  beforeEach(() => reinitialiserTraceInterrupteur());

  it('rend le même verdict que la version sans trace', () => {
    expect(automatisationsActivesAvecTrace(env('false'))).toBe(false);
    expect(automatisationsActivesAvecTrace(env('true'))).toBe(true);
    expect(automatisationsActivesAvecTrace(env())).toBe(true);
  });

  it('un arrêt journalise une seule fois, pas à chaque événement', () => {
    const lignes: string[] = [];
    const avant = logger.warn;
    logger.warn = (m: string) => { lignes.push(m); };
    try {
      for (let i = 0; i < 5; i++) automatisationsActivesAvecTrace(env('false'));
      expect(lignes).toHaveLength(1);
      expect(lignes[0]).toContain('ARRÊT GLOBAL');
      // Remise en marche puis nouvel arrêt : on le redit, c'est un changement d'état.
      automatisationsActivesAvecTrace(env('true'));
      automatisationsActivesAvecTrace(env('false'));
      expect(lignes).toHaveLength(2);
    } finally {
      logger.warn = avant;
    }
  });
});
