/**
 * I — Aiguillage d'une demande d'automatisation dans /api/lumi/chat, avant le
 * modèle (déterministe, aucun réseau).
 *
 * Constatés sur le vrai chemin (40-iklm-lumi-demandes, 2026-09-30) :
 *  · « Crée un rappel automatique par texto la veille de chaque rendez-vous »
 *    recevait la réponse toute faite de la FAQ « SMS » (0 ¢, aucun outil) :
 *    le garde « verbe d'action » ne reconnaissait pas « Crée » accentué ;
 *  · « Crée un parcours pour les nouveaux prospects… » : l'indice d'outils ne
 *    proposait pas create_automation_from_text (« parcours » inconnu) et le
 *    modèle répondait « je n'ai pas d'outil pour ça ».
 */
import { describe, it, expect } from 'vitest';
import { reponseFaqPour } from '../../../server/lib/support/faq';
import { outilsSuggeres } from '../../../server/lib/lumi/indices-outils';

describe('I — une demande de CRÉATION ne reçoit jamais une réponse toute faite', () => {
  const demandes = [
    'Crée un rappel automatique par texto la veille de chaque rendez-vous.',
    'Créer un rappel par texto la veille des rendez-vous',
    'Create a text reminder the day before each appointment.',
  ];
  for (const d of demandes) {
    it(`[I-040] « ${d} » → pas de FAQ`, () => {
      expect(reponseFaqPour(d, 'fr')?.id ?? null).toBeNull();
    });
  }
  it('[I-041] une vraie question produit garde sa réponse de FAQ', () => {
    expect(reponseFaqPour('Comment envoyer des SMS à mes clients ?', 'fr')?.id).toBe('sms');
  });
});

describe('I — l’indice d’outils désigne create_automation_from_text', () => {
  const demandes = [
    'Crée un parcours pour les nouveaux prospects : texto de bienvenue tout de suite, puis un courriel 2 jours plus tard.',
    'Crée un parcours : après l’envoi d’une facture, attends 3 jours puis envoie un texto.',
    'Automatise la relance de mes soumissions après 3 jours.',
    'Set up a workflow that texts new leads right away.',
  ];
  for (const d of demandes) {
    it(`[I-042] « ${d.slice(0, 60)}… »`, () => {
      expect(outilsSuggeres(d)).toContain('create_automation_from_text');
    });
  }
});
