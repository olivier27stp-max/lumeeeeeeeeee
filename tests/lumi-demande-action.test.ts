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

describe('questions sur le contenu du compte : jamais une FAQ', () => {
  it('« c’est quoi mes… », « what … do I have », « show me my… » vont au modèle ; « comment… » garde l’aide', async () => {
    const { reponseFaqPour } = await import('../server/lib/support/faq');
    expect(reponseFaqPour('C’est quoi mes préréglages de soumission ?', 'fr')).toBeNull();
    expect(reponseFaqPour('What checklist templates do I have set up?', 'en')).toBeNull();
    expect(reponseFaqPour('What taxes do I have set up, and which tax group is the default?', 'en')).toBeNull();
    expect(reponseFaqPour('How do I set up taxes for Quebec?', 'en')).not.toBeNull();
  });
});

describe('verbes ajoutés après l’éval finale', () => {
  it('sors-la, tick, take … off, draft sont des ordres', () => {
    for (const q of [
      'La job 46 c’est un brouillon mort : sors-la de mes listes.',
      'On job 24’s checklist, tick "photos before".',
      'Take job 37 off the calendar entirely.',
      'Draft a contract for job 30.',
    ]) expect(estDemandeDAction(q), q).toBe(true);
  });
  it('la fiche du job par le routeur : seulement pour le job lui-même', () => {
    const r = readFileSync(resolve(__dirname, '..', 'server', 'routes', 'lumi.ts'), 'utf8');
    // Généralisé le 2026-10-01 : TOUT raccourci choisi par le routeur doit être reconnu aussi par
    // le détecteur strict — la fiche du job reste donc réservée aux questions sur le job lui-même.
    expect(r).toContain("const raccourciStrict = detecterRaccourci(message)?.id ?? null;");
    expect(r).toContain('raccourciStrict === routeur.verdict.action');
  });
});

describe('trouvé en prod le 2026-10-01 : un événement rapporté n’est pas une question d’aide', () => {
  it('« le client m’a payé la facture n° 1 » va au modèle, pas à la FAQ', async () => {
    const { porteSurLesDonnees, reponseFaqPour } = await import('../server/lib/support/faq');
    const q = 'Le client m’a payé la facture n° 1 au complet en argent comptant.';
    expect(estDemandeDAction(q)).toBe(true);
    expect(porteSurLesDonnees(q)).toBe(true); // « n° 1 » : un seul chiffre, avec « n° »
    expect(reponseFaqPour(q, 'fr')).toBeNull();
    for (const e of ['Sophie a accepté la soumission.', 'Marc Gagnon a dit non pour le devis.', 'The client paid me in cash.', 'She accepted the quote this morning.'])
      expect(estDemandeDAction(e), e).toBe(true);
  });
  it('une question sur le même sujet garde l’aide', () => {
    for (const q of ['Comment je sais si un client a payé sa facture ?', 'How do I see who paid their invoice?'])
      expect(estDemandeDAction(q), q).toBe(false);
  });
});
