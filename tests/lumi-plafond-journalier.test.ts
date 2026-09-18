/**
 * Plafond journalier DUR par source (incident 2026-09-18 : 39,39 $ brûlés en
 * sept jours sur staging par les batteries d'évaluation, pendant que la prod
 * coûtait 1,95 $).
 *
 * Ce que ces tests figent, c'est la leçon de l'incident : le budget mensuel
 * PAR ORG ne protège pas un environnement de test, parce qu'une org de test
 * porte un plan (Autopilot, 45 $) et que ce plafond devient un droit de
 * dépense. Il faut une borne en dollars, par jour, indépendante du plan, qui
 * REFUSE au lieu de dégrader.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  verifierPlafond, ajouterDepense, compterRefus, plafondJourCents,
  etatPlafonds, reinitialiserPlafonds, jourMontreal, SOURCES, PLAFOND_DEFAUT_CENTS,
} from '../server/lib/lumi/plafond-journalier';

beforeEach(() => reinitialiserPlafonds());

describe('un seul comportement, staging comme production', () => {
  it('même plafond par défaut partout : 5 $ par source', () => {
    expect(plafondJourCents('lumi', {} as NodeJS.ProcessEnv)).toBe(500);
    expect(plafondJourCents('eval', { NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(500);
    expect(PLAFOND_DEFAUT_CENTS).toBe(500);
  });

  it('NODE_ENV ne change RIEN : zéro delta entre les environnements', () => {
    const valeurs = ['production', 'staging', 'test', 'development', ''].map(
      (e) => plafondJourCents('lumi', { NODE_ENV: e } as NodeJS.ProcessEnv),
    );
    expect(new Set(valeurs).size).toBe(1);
    expect(valeurs[0]).toBe(500);
  });

  it('seule la valeur de la variable distingue les environnements', () => {
    expect(plafondJourCents('lumi', { NODE_ENV: 'production', LUMI_PLAFOND_JOUR_USD: '50' } as unknown as NodeJS.ProcessEnv)).toBe(5000);
    expect(plafondJourCents('lumi', { NODE_ENV: 'staging', LUMI_PLAFOND_JOUR_USD: '2' } as unknown as NodeJS.ProcessEnv)).toBe(200);
  });

  it('se règle globalement et par source, la source l\'emportant', () => {
    const env = { LUMI_PLAFOND_JOUR_USD: '10', LUMI_PLAFOND_JOUR_EVAL_USD: '2' } as unknown as NodeJS.ProcessEnv;
    expect(plafondJourCents('lumi', env)).toBe(1000);
    expect(plafondJourCents('eval', env)).toBe(200);
  });

  it('« cache-chaud » se lit depuis LUMI_PLAFOND_JOUR_CACHE_CHAUD_USD (tiret → souligné)', () => {
    expect(plafondJourCents('cache-chaud', { LUMI_PLAFOND_JOUR_CACHE_CHAUD_USD: '1' } as unknown as NodeJS.ProcessEnv)).toBe(100);
  });

  it('une valeur illisible ne vaut JAMAIS illimité : on retombe sur le défaut', () => {
    expect(plafondJourCents('lumi', { LUMI_PLAFOND_JOUR_USD: 'beaucoup' } as unknown as NodeJS.ProcessEnv)).toBe(500);
    expect(plafondJourCents('lumi', { LUMI_PLAFOND_JOUR_USD: '-3' } as unknown as NodeJS.ProcessEnv)).toBe(500);
  });

  it('0 explicite = illimité (échappatoire assumée)', () => {
    expect(plafondJourCents('lumi', { LUMI_PLAFOND_JOUR_USD: '0' } as unknown as NodeJS.ProcessEnv)).toBe(0);
  });
});

describe('le compteur refuse une fois le plafond atteint', () => {
  const env = { LUMI_PLAFOND_JOUR_USD: '1' } as unknown as NodeJS.ProcessEnv; // 100 cents

  it('autorise tant que la dépense est sous le plafond', () => {
    ajouterDepense('lumi', 99, env);
    expect(verifierPlafond('lumi', env).autorise).toBe(true);
  });

  it('refuse dès que la dépense atteint le plafond', () => {
    ajouterDepense('lumi', 100, env);
    const v = verifierPlafond('lumi', env);
    expect(v.autorise).toBe(false);
    expect(v.depense_cents).toBe(100);
    expect(v.plafond_cents).toBe(100);
  });

  it('le scénario de l\'incident : 45 $ ne passent plus, on s\'arrête à 5 $', () => {
    // 7 152 appels à 0,55 ¢ = 39,39 $ mesurés. Avec le plafond par défaut :
    let depense = 0;
    for (let i = 0; i < 10_000; i++) {
      if (!verifierPlafond('lumi', {} as NodeJS.ProcessEnv).autorise) break;
      ajouterDepense('lumi', 0.55, {} as NodeJS.ProcessEnv);
      depense += 0.55;
    }
    expect(depense).toBeLessThan(510); // 5 $ + un appel de dépassement
    expect(depense).toBeGreaterThan(490);
  });

  it('chaque source a son compteur : saturer les évals ne coupe pas le support', () => {
    ajouterDepense('eval', 1000, env);
    expect(verifierPlafond('eval', env).autorise).toBe(false);
    expect(verifierPlafond('support', env).autorise).toBe(true);
  });

  it('plafond explicitement levé (0) : tout passe et la dépense se compte quand même', () => {
    const illimite = { LUMI_PLAFOND_JOUR_USD: '0' } as unknown as NodeJS.ProcessEnv;
    ajouterDepense('lumi', 5000, illimite);
    const v = verifierPlafond('lumi', illimite);
    expect(v.autorise).toBe(true);
    expect(v.depense_cents).toBe(5000);
  });

  it('un coût absurde ou négatif ne corrompt pas le compteur', () => {
    ajouterDepense('lumi', Number.NaN, env);
    ajouterDepense('lumi', -10, env);
    expect(verifierPlafond('lumi', env).depense_cents).toBe(0);
  });
});

describe('état et remise à zéro', () => {
  it('etatPlafonds rend compte de chaque source et des refus', () => {
    const env = { LUMI_PLAFOND_JOUR_USD: '1' } as unknown as NodeJS.ProcessEnv;
    ajouterDepense('support', 150, env);
    compterRefus('support');
    const etat = etatPlafonds(env);
    expect(etat).toHaveLength(SOURCES.length);
    const s = etat.find((e) => e.source === 'support')!;
    expect(s.depense_cents).toBe(150);
    expect(s.refus).toBe(1);
  });

  it('le compteur repart à zéro au changement de jour (Montréal)', () => {
    const env = { LUMI_PLAFOND_JOUR_USD: '1' } as unknown as NodeJS.ProcessEnv;
    const hier = new Date('2026-09-17T15:00:00Z');
    const aujourdhui = new Date('2026-09-18T15:00:00Z');
    ajouterDepense('lumi', 500, env, hier);
    expect(verifierPlafond('lumi', env, hier).autorise).toBe(false);
    expect(verifierPlafond('lumi', env, aujourdhui).autorise).toBe(true);
  });

  it('jourMontreal rend une date civile stable', () => {
    expect(jourMontreal(new Date('2026-09-18T15:00:00Z'))).toBe('2026-09-18');
  });
});
