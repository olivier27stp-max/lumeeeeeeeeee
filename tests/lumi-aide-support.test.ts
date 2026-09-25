/**
 * Lumi répond aussi aux questions de support (2026-09-22).
 *
 * Constat en prod : « comment je change de plan » posée à Lumi a coûté
 * 4,46 ¢ et est passée par le modèle, alors que la même question dans le
 * chat de support est gratuite depuis la PR #435. Un client ne sait pas
 * qu'il y a deux assistants : il pose sa question là où il se trouve.
 *
 * Ces tests vérifient que les DEUX surfaces partagent les mêmes réponses et
 * les mêmes garde-fous — c'est la même fonction, appelée des deux côtés.
 */
import { describe, it, expect } from 'vitest';
import { reponseFaqPour } from '../server/lib/support/faq';
import { reponseAideDirecte } from '../server/lib/support/articles-dabord';

/** Ce que la route Lumi évalue avant d'appeler le modèle (mêmes conditions). */
function repondSansModele(message: string, langue: 'fr' | 'en' = 'fr'): string | null {
  const faq = reponseFaqPour(message, langue);
  if (faq) return faq.reponse;
  const article = reponseAideDirecte(message, langue, { premierMessage: true });
  return article?.texte ?? null;
}

describe('les questions produit sont gratuites dans Lumi aussi', () => {
  const cas = [
    'comment je change de plan',
    'mon paiement a échoué je fais quoi',
    'comment je parle à un humain',
    'comment supprimer une tâche',
    'comment activer la double authentification',
    'comment lume calcule la tps et la tvq sur mes factures',
    // Le revers du resserrement de 2026-09-23 : élargir la garde des données
    // ne doit pas rendre payantes des questions produit qui ressemblent à une
    // demande de contenu. Les limites de forfait en sont l'exemple type — la
    // question tient les mêmes mots que « j'ai combien de clients ».
    'Combien de clients je peux avoir ?',
    'Comment changer mon adresse de facturation ?',
    'Comment importer mes clients depuis Excel ?',
  ];
  for (const q of cas) {
    it(`« ${q.slice(0, 46)} » → 0 token`, () => {
      const r = repondSansModele(q);
      expect(r, 'doit être servie sans modèle').not.toBeNull();
      expect(r!.length).toBeGreaterThan(20);
    });
  }
});

describe('les questions sur les DONNÉES vont toujours au modèle', () => {
  // C'est ce que Lumi sait faire et que le support ne peut pas : lire le CRM.
  const cas = [
    'quel est mon chiffre du mois',
    'quelles factures sont en retard',
    'combien j ai de clients',
    'prépare ma journée de demain',
    'qui sont mes meilleurs clients',
    'supprime la facture INV-0004',
    'crée un job chez Tremblay demain',
    // Les trois formulations qui PARTAIENT à un article d'aide, mesurées par
    // `qa:lumi` le 2026-09-23 (factuel tombé de 98 % à 86 %). Elles sont
    // écrites ici telles qu'un entrepreneur les tape — majuscules et accents
    // compris : les variantes normalisées plus haut passaient déjà, ce sont
    // l'accent de « numéro » et l'ordre « j'ai combien » qui manquaient.
    "J'ai combien de clients dans mon CRM ?",
    "C'est quoi le numéro de téléphone de Ginette Desrosiers-Lumi ?",
    "C'est quoi le courriel de mon entreprise dans Lume ?",
    'Quel est le courriel de Marie Tremblay ?',
    "J'ai combien de factures impayées ?",
  ];
  for (const q of cas) {
    it(`« ${q.slice(0, 46)} » → le modèle (ou un raccourci)`, () => {
      expect(repondSansModele(q), 'ne doit JAMAIS recevoir une réponse toute faite').toBeNull();
    });
  }
});

describe('garde-fous partagés avec le support', () => {
  it('une correction en cours de conversation n\'est pas une question produit', () => {
    expect(repondSansModele('att non pas celui la, l autre client')).toBeNull();
  });

  it('une question vague descend au modèle', () => {
    expect(repondSansModele('ca marche pas')).toBeNull();
    expect(repondSansModele('bonjour')).toBeNull();
  });

  it('fonctionne en anglais comme en français', () => {
    expect(repondSansModele('How do I change or cancel my plan?', 'en')).not.toBeNull();
  });
});
