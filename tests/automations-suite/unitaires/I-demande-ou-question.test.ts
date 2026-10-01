/**
 * I-002 — « Crée un rappel automatique… » est une DEMANDE (Lumi doit créer
 * l'automatisation), « Comment configurer… » est une QUESTION (l'aide répond).
 * Les deux gardes se sont déjà marché dessus : la première version du garde
 * « créer / set up » retirait sa réponse d'aide à « How do I set up taxes? ».
 */
import { describe, it, expect } from 'vitest';
import { reponseFaqPour } from '../../../server/lib/support/faq';

describe('[I-002] demande d’automatisation ou question d’aide', () => {
  it.each([
    ['Crée un rappel automatique par texto la veille de chaque rendez-vous.', 'fr'],
    ['Create an automation that texts my client the day before each appointment.', 'en'],
    ['Mets en place une relance de devis après 3 jours.', 'fr'],
    ['Automatise l’envoi d’un texto quand un job est terminé.', 'fr'],
  ] as const)('[I-002] « %s » → jamais une réponse toute faite', (message, langue) => {
    expect(reponseFaqPour(message, langue)).toBeNull();
  });

  it('[I-002] une question « comment / how do I » garde sa réponse d’aide', () => {
    expect(reponseFaqPour('How do I set up taxes for Quebec?', 'en')).not.toBeNull();
  });
});
