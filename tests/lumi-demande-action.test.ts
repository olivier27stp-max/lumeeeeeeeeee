/**
 * Une demande d'action va au modèle, jamais à une réponse d'aide toute faite
 * (audit des outils de Lumi, 2026-09-30). Phrases réelles de l'éval des outils.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { estDemandeDAction } from '../server/lib/lumi/demande-action';

describe('estDemandeDAction', () => {
  it('les ordres (français, anglais, après une virgule, poliment) sont des actions', () => {
    for (const q of [
      'Configure mes taxes pour le Québec, TPS et TVQ.',
      'Reset Karim Bensaïd’s permissions back to the standard sales rep defaults.',
      'Robert Côté est en double dans mes clients, fusionne les deux fiches.',
      'Peux-tu archiver… non : archive le service « Plantation »',
      'Can you delete the “Vitres résidentiel” quote template?',
      'Pour la suite, garde en tête que je facture toujours 250 $.',
      'Keep in mind for later: Catherine always pays by cheque.',
    ]) expect(estDemandeDAction(q), q).toBe(true);
  });
  it('les questions sur le produit gardent la réponse d’aide gratuite', () => {
    for (const q of ['Comment je change mes taxes ?', 'How do I reset my password?', "C'est quoi un préréglage ?", 'Où je vois mes factures ?', 'Mon paiement a échoué'])
      expect(estDemandeDAction(q), q).toBe(false);
  });
  it('la route passe le filtre AVANT les réponses d’aide', () => {
    const r = readFileSync(resolve(__dirname, '..', 'server', 'routes', 'lumi.ts'), 'utf8');
    const garde = r.indexOf('!estDemandeDAction(message)');
    expect(garde).toBeGreaterThan(0);
    expect(garde).toBeLessThan(r.indexOf('reponseFaqPour(message, ctx.language)'));
  });
});

describe('ordres et caches', () => {
  it('un ordre n’est jamais servi ni écrit par le cache de réponses', async () => {
    const { enonceCachable } = await import('../server/lib/lumi/cache-reponses');
    expect(enonceCachable('Archive la job 44, c’est un vieux test.')).toBe(false);
    expect(enonceCachable('Combien de jobs j’ai demain ?')).toBe(true);
  });
});
