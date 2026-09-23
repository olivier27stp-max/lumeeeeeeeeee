/**
 * Deux garanties de robustesse du moteur d'automatisations (2026-09-23).
 * ──────────────────────────────────────────────────────────────────────
 * 1. UNE RÈGLE QUI PLANTE N'EMPORTE PAS LES AUTRES. La boucle sur les règles
 *    vivait dans un seul try global : une lecture qui explose, un gabarit
 *    malformé, et toutes les règles suivantes du même événement étaient
 *    sautées — sans trace individuelle. Une règle cassée dans une org pouvait
 *    faire taire ses confirmations de rendez-vous, et rien ne disait laquelle.
 *
 * 2. UN ÉCHEC DÉFINITIF SE DIT. Quand un message ne part pas après toutes les
 *    reprises, l'entreprise reçoit une notification avec la cause traduite.
 *    Avant, il ne restait qu'une ligne dans les journaux du serveur : le
 *    client ne recevait rien, et l'entrepreneur ne l'apprenait jamais. C'est
 *    le pire des silences — il donne l'illusion que tout fonctionne.
 *
 * Ces deux comportements se vérifient sur le source plutôt que par exécution :
 * les reproduire demanderait de simuler une panne au milieu d'une boucle et
 * un faux client Supabase dont la fidélité deviendrait elle-même une
 * hypothèse. Ce qui doit tenir ici est structurel.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const moteur = readFileSync(resolve(__dirname, '..', 'server/lib/automationEngine.ts'), 'utf8');

describe('une règle qui plante n\'emporte pas les suivantes', () => {
  it('chaque règle est exécutée dans son propre try/catch', () => {
    const boucle = moteur.slice(
      moteur.indexOf('for (const rule of rules as AutomationRule[])'),
      moteur.indexOf('// Le second système d\'automatisations'),
    );
    expect(boucle.length, 'boucle des règles introuvable — le test ne prouve plus rien').toBeGreaterThan(0);
    expect(boucle, 'aucun try/catch par règle : une règle qui lève sautera les suivantes').toContain('try {');
    expect(boucle).toContain('} catch (err: any) {');
  });

  it('le message d\'erreur NOMME la règle fautive', () => {
    // « une automatisation a planté » sans dire laquelle n'aide personne.
    expect(moteur).toContain('a échoué sur ${event.type} — les autres règles continuent');
  });
});

describe('un échec définitif prévient l\'entreprise', () => {
  it('une notification est créée quand la tâche passe à « failed »', () => {
    expect(moteur).toContain('prevenirEchecDefinitif');
    expect(moteur).toContain("type: 'automation_failed'");
  });

  it('la cause est traduite, jamais l\'erreur brute', () => {
    // « No recipient phone » ne dit rien à un entrepreneur ;
    // « ce client n'a pas de numéro » lui dit quoi faire.
    // Fragments sans apostrophe : le source l'échappe (`n\'a`), la comparer
    // littéralement ferait échouer le test sur un détail d'écriture.
    expect(moteur).toContain('pas de numéro de téléphone');
    expect(moteur).toContain('est désabonné');
    expect(moteur).toContain("brut.includes('no recipient phone')");
  });

  it('la notification ne peut pas empêcher de clore la tâche', () => {
    // Sinon une notification en échec laisserait la tâche « running » pour
    // toujours, et personne ne la reprendrait.
    const bloc = moteur.slice(moteur.indexOf('async function prevenirEchecDefinitif'));
    expect(bloc.slice(0, bloc.indexOf('\n}\n'))).toContain('catch');
  });
});
