/**
 * Exemples — famille 1 : ce qu'une ENTREPRISE envoie à SES clients (gabarit client).
 * Données inventées (« Vision Lavage » → « Rafba »), aucune base.
 */
import { rendreCourrielClient, rendreCourrielLume, montant, dateLisible, MOTS, type Marque } from '../../../server/lib/courriels/gabarit';
export interface Exemple { nom: string; sujet: string; html: string; de?: string }

export const MARQUE_VISION: Marque = {
  nom: 'Vision Lavage', logoUrl: null, couleur: '#0f766e', email: 'info@visionlavage.ca', telephone: '514 555-0199',
  adresse: '12 rue Principale, Laval (Québec) H7L 1A1', siteWeb: 'visionlavage.ca',
  liensSociaux: { facebook: 'https://facebook.com/visionlavage', instagram: 'https://instagram.com/visionlavage' },
  lignesTaxes: ['TPS No : 123456789 RT0001', 'TVQ No : 1234567890 TQ0001'],
};
const fr = MOTS.fr;
const lien = 'https://lumecrm.net/invoice/exemple';
const m = (c: number) => montant(c, 'CAD', 'fr');

/** Les mêmes exemples, aux couleurs d'une VRAIE entreprise (scripts/qa/apercu-courriel-reel.mts). */
export function exemplesPour(marque: Marque): Exemple[] {
  return [
  { nom: 'facture', sujet: `Facture 40 — ${m(48750)} — Vision Lavage`, html: rendreCourrielClient({
    langue: 'fr', marque, preheader: `Facture 40 — ${m(48750)} — Échéance ${dateLisible('2026-10-01', 'fr')}`,
    titre: 'Votre facture 40', salutation: fr.bonjour('Rafba'), intro: 'Voici votre facture. Vous pouvez la consulter et la payer en ligne en un clic.',
    montant: { libelle: fr.montantDu, valeur: m(48750), sous: `${fr.echeance} : ${dateLisible('2026-10-01', 'fr')}` },
    lignes: [{ libelle: fr.numero, valeur: '40' }, { libelle: fr.echeance, valeur: dateLisible('2026-10-01', 'fr') }],
    bouton: { texte: fr.voirFacture, url: lien }, note: fr.question,
  }) },
  { nom: 'soumission', sujet: `Soumission Q-2026-018 — ${m(215000)} — Vision Lavage`, html: rendreCourrielClient({
    langue: 'fr', marque, preheader: `Soumission Q-2026-018 — ${m(215000)}`,
    titre: 'Votre soumission Q-2026-018', salutation: fr.bonjour('Rafba'), intro: 'Voici votre soumission. Vous pouvez la consulter et l’approuver en ligne.',
    montant: { libelle: fr.montantTotal, valeur: m(215000), sous: `${fr.valideJusquau} ${dateLisible('2026-10-17', 'fr')}` },
    lignes: [{ libelle: fr.numero, valeur: 'Q-2026-018' }, { libelle: fr.valideJusquau, valeur: dateLisible('2026-10-17', 'fr') }],
    bouton: { texte: fr.voirSoumission, url: lien }, note: fr.question,
  }) },
  { nom: 'paiement-demande', sujet: `Paiement demandé — ${m(48750)} — facture 40`, html: rendreCourrielClient({
    langue: 'fr', marque, preheader: `${m(48750)} à payer — facture 40`, titre: 'Paiement demandé', salutation: fr.bonjour('Rafba'),
    intro: `Un paiement de ${m(48750)} est demandé pour la facture 40. Vous pouvez payer en ligne, par carte, en moins d’une minute.`,
    montant: { libelle: fr.montantDu, valeur: m(48750), sous: 'Facture 40' }, bouton: { texte: fr.payer(m(48750)), url: lien },
    note: 'Paiement sécurisé par Stripe. Une question ? Répondez simplement à ce courriel.',
  }) },
  { nom: 'rappel', sujet: 'Rappel de paiement — facture 40', html: rendreCourrielClient({
    langue: 'fr', marque, preheader: `${m(48750)} — facture 40`, titre: 'Rappel de paiement',
    corpsHtml: 'Bonjour Rafba,<br/><br/>Petit rappel amical : la facture 40 de 487,50 $ était due le 1 octobre 2026.<br/><br/>Merci,<br/>Vision Lavage',
    montant: { libelle: fr.montantDu, valeur: m(48750), sous: `${fr.echeance} : ${dateLisible('2026-10-01', 'fr')}` },
    bouton: { texte: fr.payer(m(48750)), url: lien }, note: fr.question, signature: null,
  }) },
  { nom: 'contrat', sujet: 'Contrat CTR-2026-007 — Vision Lavage', html: rendreCourrielClient({
    langue: 'fr', marque, preheader: 'Contrat CTR-2026-007 — à signer', titre: 'Votre contrat CTR-2026-007', salutation: fr.bonjour('Rafba'),
    intro: 'Voici votre contrat. Vous pouvez le consulter et le signer en ligne, sur votre téléphone ou votre ordinateur.',
    lignes: [{ libelle: fr.numero, valeur: 'CTR-2026-007' }, { libelle: 'Objet', valeur: 'Entretien saisonnier des vitres' }, { libelle: 'Prochaine visite', valeur: '24 septembre 2026', fort: true }],
    bouton: { texte: fr.voirContrat, url: lien }, note: fr.question,
  }) },
  { nom: 'formulaire-recu', sujet: 'Nous avons bien reçu votre demande — Vision Lavage', html: rendreCourrielClient({
    langue: 'fr', marque, corpsHtml: '<p style="margin:0 0 16px;font-size:15px;">Bonjour Rafba,</p><p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Merci pour votre demande. Nous l’avons bien reçue et nous vous reviendrons dans les plus brefs délais.</p><p style="margin:0 0 8px;font-size:14px;color:#666;">Récapitulatif :</p><p style="margin:0 0 16px;font-size:14px;color:#333;">Rafba Test<br/>beatsafterimage@gmail.com · 514 555-0100</p>', signature: null,
  }) },
  { nom: 'paiement-recu-entreprise', sujet: `Paiement reçu — ${m(48750)} — facture 40`, html: rendreCourrielLume({
    langue: 'fr', preheader: `Paiement reçu — ${m(48750)}`, titre: 'Paiement reçu', intro: 'Rafba Test vient de payer en ligne la facture 40.',
    montant: { libelle: 'Montant reçu', valeur: m(48750), sous: `Pourboire : ${m(2500)}` },
    lignes: [{ libelle: 'Client', valeur: 'Rafba Test' }, { libelle: 'Facture', valeur: '40' }],
    bouton: { texte: 'Voir la facture', url: 'https://lumecrm.net/invoices/1' },
    note: 'Vous recevez ce courriel parce que « Être avisé de chaque paiement par courriel » est activé dans Paramètres → Lume Payments.',
  }) },
  ];
}

export const EXEMPLES: Exemple[] = exemplesPour(MARQUE_VISION);
