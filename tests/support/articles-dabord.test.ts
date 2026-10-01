/**
 * Étage 5 : le centre d'aide répond AVANT le modèle (patron de tous les CRM).
 *
 * Les seuils (SCORE_FRANC, FACTEUR_ECART) ont été calibrés le 2026-09-18 sur
 * les questions réellement posées en production, pas choisis à vue : les cas
 * ci-dessous sont ceux qui ont servi au calibrage, avec leurs scores mesurés.
 * Les faire passer en baissant un seuil ferait répondre à côté — c'est
 * exactement ce qu'on veut empêcher.
 */
import { describe, it, expect } from 'vitest';
import { reponseAideDirecte, estQuestionComment, SCORE_FRANC, FACTEUR_ECART } from '../../server/lib/support/articles-dabord';

const direct = (q: string) => reponseAideDirecte(q, 'fr', { premierMessage: true });

/**
 * « est ce que je peux modifier mon preset jusqu ou » a quitté cette liste le
 * 2026-09-22 : elle est désormais servie par la FAQ (`quote-preset-edit`),
 * une réponse écrite à la main, donc meilleure que l'extrait d'article. Elle
 * reste gratuite — simplement par un chemin plus court.
 */
describe('répond sans modèle quand la recherche est franche', () => {
  const cas = [
    'comment activer la double authentification',
    'comment lume calcule la tps et la tvq sur mes factures',
    'qu est ce qui marche sans reseau et comment ca se synchronise',
  ];
  for (const q of cas) {
    it(`« ${q.slice(0, 48)} » → 0 token`, () => {
      const r = direct(q);
      expect(r).not.toBeNull();
      expect(r!.score).toBeGreaterThanOrEqual(SCORE_FRANC);
      expect(r!.texte.length).toBeGreaterThan(30);
      // La réponse cite toujours une page de l'app, comme le ferait le modèle.
      expect(r!.pages.length).toBeGreaterThan(0);
    });
  }
});

describe('laisse le modèle répondre quand ce n\'est pas franc', () => {
  it('deux pages également plausibles → modèle (mesuré : score 12 contre 12)', () => {
    expect(direct('comment je transforme un job termine en facture client')).toBeNull();
    expect(direct('comment je cree une soumission pour un client')).toBeNull();
  });

  it('question hors doc produit → modèle (mesuré : score 3)', () => {
    expect(direct('pourquoi choisir lume plutot que jobber')).toBeNull();
    expect(direct('est ce que lume est conforme a la loi 25')).toBeNull();
  });

  it('question trop longue : c\'est un cas particulier', () => {
    expect(direct('comment je fais pour que mon employé qui travaille le samedi voie seulement ses jobs à lui et pas ceux des autres quand il est sur la route')).toBeNull();
  });

  it('au milieu d\'une conversation, jamais (le contexte prime)', () => {
    expect(reponseAideDirecte('comment activer la double authentification', 'fr', { premierMessage: false })).toBeNull();
  });
});

describe('sécurité : jamais un article pour une action ou une donnée', () => {
  const dangereuses = [
    'supprime la facture INV-0004',
    'annule le job 33',
    'combien j ai de clients',
    'att non pas celui la',
    'envoie un texto a Réjean',
  ];
  for (const q of dangereuses) {
    it(`refuse « ${q} »`, () => expect(direct(q)).toBeNull());
  }
});

describe('forme de la question', () => {
  it('reconnaît les tournures « comment faire »', () => {
    expect(estQuestionComment('comment je fais')).toBe(true);
    expect(estQuestionComment('où est le bouton')).toBe(true);
    expect(estQuestionComment('c est quoi un préréglage')).toBe(true);
    expect(estQuestionComment('puis-je changer le prix')).toBe(true);
  });

  it('une phrase sans marque de question ne déclenche rien', () => {
    expect(estQuestionComment('mes factures sont en retard')).toBe(false);
    expect(direct('mes factures sont en retard')).toBeNull();
  });

  it('les seuils restent stricts (garde-fou contre un assouplissement)', () => {
    expect(SCORE_FRANC).toBeGreaterThanOrEqual(6);
    expect(FACTEUR_ECART).toBeGreaterThanOrEqual(1.5);
  });
});

// Batterie du support, prod, 2026-10-01 (langue.anglais-prix) : « How much is the Scale
// plan per month, and how much does one extra user cost? » recevait le paragraphe
// FRANÇAIS du centre d'aide, suivi d'une relance en anglais.
describe('une question en anglais ne reçoit jamais un paragraphe français', () => {
  it('une Q/R de la FAQ est servie dans sa version anglaise, titre compris', async () => {
    const { reponseAideDirecte } = await import('../../server/lib/support/articles-dabord');
    const r = reponseAideDirecte('How much is the Scale plan per month, and how much does one extra user cost?', 'en', { premierMessage: true });
    expect(r).not.toBeNull();
    expect(r!.texte).toContain('Three plans, in Canadian dollars');
    expect(r!.texte).toContain('$347');
    expect(r!.texte).toContain('How much do the Lume plans cost?');
    expect(r!.texte).not.toMatch(/Trois forfaits|Combien coûtent|par mois|utilisateur/);
  });

  it('un passage du centre d’aide sans version anglaise n’est pas servi : la main passe au modèle', async () => {
    const { reponseAideDirecte } = await import('../../server/lib/support/articles-dabord');
    for (const q of ['How do I embed the request form on my website?', 'How do I change my plan?', 'How do I reset my password?']) {
      expect(reponseAideDirecte(q, 'en', { premierMessage: true }), q).toBeNull();
    }
  });

  it('aucune réponse d’aide directe en anglais ne contient de texte français', async () => {
    const { reponseAideDirecte } = await import('../../server/lib/support/articles-dabord');
    const questions = [
      'How do I add a team member?', 'How do I set up taxes for Quebec?', 'How do I change my plan?', 'How can I get paid online?',
      'How do I schedule a job?', 'How do I create a recurring job?', 'How do I reset my password?', 'How do I turn on two-factor authentication?',
      'How do I embed the request form on my website?', 'How do I approve timesheets?', 'How do I export to QuickBooks?', 'How do I archive a client?',
    ];
    let servies = 0;
    for (const q of questions) {
      const r = reponseAideDirecte(q, 'en', { premierMessage: true });
      if (!r) continue; // pas de version anglaise : le modèle répond, en anglais
      servies += 1;
      expect(r.texte, q).not.toMatch(/ (vous|votre|vos|dans|puis|cliquez|paramètres) /i);
      expect(r.texte, q).toContain('If that doesn’t cover your case');
    }
    expect(servies).toBeGreaterThan(0);
  });
});
