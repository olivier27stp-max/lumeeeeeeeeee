/**
 * « ARRÊTER QUAND LE CLIENT RÉPOND » — le réglage qui ne servait à rien.
 *
 * L'interrupteur existait dans l'onglet Réglages, s'enregistrait en base
 * (`automation_rules.settings.arret_sur_reponse`)… et le moteur ne le lisait
 * JAMAIS. Un client qui répondait recevait quand même les trois relances
 * suivantes. C'est le pire effet possible d'une automatisation : elle
 * continue de parler à quelqu'un qui a déjà répondu.
 *
 * Ce fichier tient la garde sur les quatre décisions qui comptent :
 *   1. le moteur LIT le réglage ;
 *   2. il ne regarde que les messages reçus APRÈS la planification ;
 *   3. une lecture impossible n'annule RIEN (on ne supprime pas un envoi
 *      sur une information qu'on n'a pas pu vérifier) ;
 *   4. seules les actions qui PARLENT au client sont concernées.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const moteur = readFileSync(resolve(RACINE, 'server/lib/automationEngine.ts'), 'utf8');

describe('le réglage « arrêter sur réponse » est vraiment branché', () => {
  it('le moteur LIT `arret_sur_reponse` (il ne l’ignorait plus)', () => {
    // La garde principale : ce réglage était déclaré dans `ReglagesRegle` et
    // dans le schéma Zod, mais le mot n'apparaissait nulle part dans la
    // logique du worker. Un réglage qu'on affiche sans le lire est un
    // mensonge à l'écran.
    const logique = moteur.slice(moteur.indexOf('async function processScheduledTasks'));
    expect(
      logique.includes('arret_sur_reponse'),
      'le worker doit lire `reglagesRegle.arret_sur_reponse`',
    ).toBe(true);

    /*
     * Et il doit le lire POUR DE VRAI.
     *
     * Vérifié en sabotant le code : remplacer la condition par
     * `if (false && reglagesRegle?.arret_sur_reponse …)` laissait ce test
     * au vert — le mot était encore là, la garde était morte. On exige donc
     * que la condition commence par la NÉGATION de `shouldStop`, la seule
     * forme qui exécute vraiment la vérification.
     */
    expect(
      logique,
      'la garde doit être atteignable : `if (!shouldStop && reglagesRegle?.arret_sur_reponse`',
    ).toMatch(/if \(!shouldStop && reglagesRegle\?\.arret_sur_reponse/);

    // Et le résultat doit servir à ANNULER, pas dormir dans une variable.
    expect(logique, '`stopReponse` doit décider de l’annulation')
      .toMatch(/if \(shouldStop \|\| stopReponse\)/);
  });

  it('ne compte que les messages ENTRANTS reçus APRÈS la planification', () => {
    const fn = moteur.slice(
      moteur.indexOf('async function clientARepondu'),
      moteur.indexOf('async function checkStopConditions'),
    );
    expect(fn, 'sans `direction = inbound`, un message SORTANT de la relance elle-même compterait comme une réponse')
      .toMatch(/direction['"]?\s*,\s*['"]inbound/);
    // `gte('created_at', depuis)` : une conversation ANCIENNE ne doit pas
    // empêcher une nouvelle relance de partir.
    expect(fn, 'sans borne de date, une vieille conversation annulerait toute relance future')
      .toMatch(/gte\(\s*['"]created_at['"]/);
    expect(fn).toMatch(/limit\(\s*1\s*\)/);
  });

  it('une lecture impossible n’annule RIEN', () => {
    const fn = moteur.slice(
      moteur.indexOf('async function clientARepondu'),
      moteur.indexOf('async function checkStopConditions'),
    );
    // Le bloc d'erreur doit retourner `false` — donc « je ne sais pas, donc
    // je n'annule pas ». La même prudence que `checkStopConditions`.
    const blocErreur = fn.slice(fn.indexOf('if (error)'));
    expect(blocErreur.slice(0, 220), 'une erreur de lecture ne doit jamais supprimer un envoi')
      .toMatch(/return false/);
  });

  it('un client sans identifiant ne fait jamais annuler', () => {
    const fn = moteur.slice(
      moteur.indexOf('async function clientARepondu'),
      moteur.indexOf('async function checkStopConditions'),
    );
    expect(fn).toMatch(/if \(!clientId\) return false/);
  });

  it('seules les actions qui parlent au CLIENT sont concernées', () => {
    // Annuler « ajouter une note » ou « créer une tâche » parce que le client
    // a écrit n'aurait aucun sens : ces actions sont internes.
    const zone = moteur.slice(moteur.indexOf('let stopReponse = false;'));
    const garde = zone.slice(0, 400);
    for (const action of ['send_sms', 'send_email']) {
      expect(garde, `« ${action} » doit être concernée par l’arrêt sur réponse`).toContain(action);
    }
    expect(garde, 'la garde doit filtrer par type d’action').toMatch(/taskType ===/);
  });

  it('la tâche annulée dit POURQUOI', () => {
    // « Annulée » sans explication est la plainte n°1 sur ce genre d'écran :
    // l'onglet Journaux affiche `last_error` en clair.
    const zone = moteur.slice(moteur.indexOf('if (shouldStop || stopReponse) {'));
    expect(zone.slice(0, 900)).toMatch(/last_error/);
    expect(zone.slice(0, 900)).toMatch(/le client a répondu/);
  });

  it('le client est résolu par les VRAIS liens du schéma', () => {
    const fn = moteur.slice(
      moteur.indexOf('async function clientDeLaTache'),
      moteur.indexOf('async function clientARepondu'),
    );
    // Les trois pièges vérifiés en base le 2026-09-24 :
    expect(fn, 'un `lead` EST une fiche clients').toMatch(/entityType === 'lead'/);
    expect(fn, 'une visite n’a pas de client_id : elle passe par son job').toMatch(/schedule_events/);
    expect(fn, 'un devis porte DEUX liens vers clients').toMatch(/lead_id/);
  });
});
