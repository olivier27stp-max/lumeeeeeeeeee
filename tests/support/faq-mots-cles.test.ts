/**
 * FAQ par mots-clés (étage 0, 0 token) — les questions SUR LE PRODUIT ont une
 * réponse écrite à la main, même reformulées.
 *
 * Les cas ci-dessous viennent des traces de PRODUCTION : ce sont des questions
 * réellement posées par des clients et payées au modèle à chaque fois
 * (« mon paiement a échoué je fais quoi » 8 fois, « comment je change de
 * plan » 3 fois). Le but du test n'est pas la couverture maximale : c'est de
 * prouver qu'on ne sert JAMAIS une réponse toute faite à une question qui
 * porte sur les données de l'org.
 */
import { describe, it, expect } from 'vitest';
import { reponseFaqPour, porteSurLesDonnees, SCORE_MINIMUM } from '../../server/lib/support/faq';

describe('correspondance exacte (comportement d\'origine)', () => {
  it('répond à la question de la FAQ mot pour mot', () => {
    const r = reponseFaqPour('Comment changer ou annuler mon forfait ?', 'fr');
    expect(r?.id).toBe('change-plan');
  });

  it('répond aussi en anglais', () => {
    const r = reponseFaqPour('How do I change or cancel my plan?', 'en');
    expect(r?.id).toBe('change-plan');
  });
});

describe('questions réelles de production, reformulées', () => {
  // Les trois premières sont les plus répétées des traces de prod du
  // 2026-09-18 : 8 + 3 + 2 = 13 appels payés pour des réponses déjà écrites.
  const cas: Array<[string, string]> = [
    ['mon paiement a échoué je fais quoi', 'billing-failed'],
    ['comment je change de plan', 'change-plan'],
    ['comment je parle à un humain', 'talk-to-human'],
    ['je veux annuler mon abonnement', 'change-plan'],
    ['comment importer mes clients depuis excel', 'import-clients'],
    ['est-ce que lume a une application mobile', 'mobile'],
    ['comment activer la double authentification', 'two-factor'],
    ['j\'ai oublié mon mot de passe', 'forgot-password'],
  ];
  for (const [question, attendu] of cas) {
    it(`« ${question} » → ${attendu} (0 token)`, () => {
      expect(reponseFaqPour(question, 'fr')?.id).toBe(attendu);
    });
  }
});

/**
 * Cas venu des traces : un client corrige une suppression en cours de
 * conversation. Servir l'article « archiver un client » ici serait un bug
 * grave — il répondrait à côté au pire moment. Ce test a attrapé une vraie
 * fuite le 2026-09-18.
 */
describe('refus : une conversation en cours n\'est pas une question produit', () => {
  const suites = [
    'att ta supprimer le tm8 pas le client moi je voulqasi le client',
    'non pas celui là, l\'autre client',
    'oui c lui supp',
  ];
  for (const q of suites) {
    it(`refuse « ${q.slice(0, 45)} »`, () => {
      expect(reponseFaqPour(q, 'fr')).toBeNull();
    });
  }
});

describe('refus : une question sur les DONNÉES ne reçoit jamais une réponse toute faite', () => {
  const dangereuses = [
    'annule la facture INV-0004',
    'supprime le client Liam',
    'marque la facture 33 comme payée',
    'envoie un texto à Réjean',
    'crée un job chez Tremblay demain',
    'facture la visite d\'hier du job 33',
    'combien j\'ai de factures en retard',
  ];
  for (const q of dangereuses) {
    it(`refuse « ${q} »`, () => {
      expect(reponseFaqPour(q, 'fr')).toBeNull();
    });
  }

  it('porteSurLesDonnees reconnaît un numéro de pièce et un verbe d\'action', () => {
    expect(porteSurLesDonnees('annule la facture INV-0004')).toBe(true);
    expect(porteSurLesDonnees('comment annuler une facture')).toBe(false);
  });
});

describe('refus : ambiguïté et signal trop faible', () => {
  it('un seul mot significatif ne suffit jamais', () => {
    expect(reponseFaqPour('facture', 'fr')).toBeNull();
    expect(reponseFaqPour('aide', 'fr')).toBeNull();
    expect(SCORE_MINIMUM).toBe(2);
  });

  it('une question vague descend au modèle', () => {
    expect(reponseFaqPour('ca marche pas', 'fr')).toBeNull();
    expect(reponseFaqPour('bonjour', 'fr')).toBeNull();
  });

  it('une longue phrase porte un cas particulier : pas de réponse toute faite', () => {
    const longue = 'bon écoute je sais pas trop par où commencer mais en gros ce matin j ai eu un souci avec un client qui voulait changer sa date';
    expect(reponseFaqPour(longue, 'fr')).toBeNull();
  });

  it('une question vide ou blanche ne plante pas', () => {
    expect(reponseFaqPour('', 'fr')).toBeNull();
    expect(reponseFaqPour('   ', 'fr')).toBeNull();
  });

  /**
   * Limite ASSUMÉE, pas un bug à corriger en baissant le seuil : « téléphone »
   * est le seul mot utile ici, et il appartient autant à l'article `mobile`
   * qu'à `sms`. Un seul mot commun ne doit jamais déclencher une réponse toute
   * faite — le modèle répond, pour 0,3 ¢, et il répond juste.
   */
  it('un mot utile partagé par deux articles descend au modèle', () => {
    expect(reponseFaqPour('est-ce que ça marche sur téléphone', 'fr')).toBeNull();
  });
});

/**
 * Fuite attrapée le 2026-09-22 en branchant la FAQ produit sur le centre
 * d'aide : « combien j'ai de clients » (une question sur les DONNÉES)
 * ressemblait à la Q/R « Combien de clients je peux avoir ? » (une question
 * sur le PRODUIT). Servir l'une pour l'autre serait une erreur grave —
 * l'utilisateur croirait avoir sa réponse.
 */
describe('possessif + entité = question sur les données', () => {
  const surLesDonnees = [
    'combien j ai de clients',
    'j ai combien de clients',
    'mes factures sont elles payees',
    'mon equipe a fait combien d heures',
    'combien de jobs j ai cette semaine',
  ];
  for (const q of surLesDonnees) {
    it(`« ${q} » porte sur les données`, () => {
      expect(porteSurLesDonnees(q)).toBe(true);
      expect(reponseFaqPour(q, 'fr')).toBeNull();
    });
  }

  it('la même question SANS possessif reste une question produit', () => {
    // « Combien de clients je peux avoir ? » = limite du forfait, pas le compte.
    expect(porteSurLesDonnees('combien de clients je peux avoir')).toBe(false);
  });
});
