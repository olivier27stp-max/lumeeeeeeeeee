/**
 * Reçu d'abonnement Lume — « Paiement reçu — ton abonnement Lume {forfait} ».
 *
 * Rendu par le gabarit commun (server/lib/courriels/gabarit.ts, voix Lume) :
 * montant en carte, lignes de détail, un seul bouton vers les factures.
 * Pur : aucune base, aucun envoi — billing-email.ts prépare les données et
 * envoie. Aperçu : scripts/qa/courriels-exemples/abonnement.mts.
 */
import { rendreCourrielLume, type LigneDetail } from '../courriels/gabarit';

export interface ReceiptTemplateData {
  companyName: string;
  planName: string;
  billingPeriod: string; // « Mensuel » / « Annuel »
  amountPaid: string; // formaté, avant taxes, ex. « 29,00 $ »
  currency: string;
  taxes: string | null; // ex. « 4,35 $ », null sans taxe
  total: string; // ex. « 33,35 $ »
  paymentDate: string; // ex. « 17 septembre 2026 »
  billingEmail: string;
  transactionId: string; // Stripe payment intent ou checkout session
  dashboardUrl: string;
  billingUrl: string;
  supportEmail?: string;
}

/** Sujet du reçu, à côté du HTML pour qu'ils ne divergent jamais. */
export function sujetRecuAbonnement(planName: string): string {
  return `Paiement reçu — ton abonnement Lume ${planName}`;
}

export function renderPaymentReceiptEmail(data: ReceiptTemplateData): string {
  const lignes: LigneDetail[] = [
    { libelle: 'Forfait', valeur: data.planName },
    { libelle: 'Période', valeur: data.billingPeriod },
  ];
  if (data.taxes) {
    lignes.push({ libelle: 'Sous-total', valeur: data.amountPaid });
    lignes.push({ libelle: 'Taxes', valeur: data.taxes });
  }
  lignes.push({ libelle: 'Total', valeur: data.total, fort: true });
  lignes.push({ libelle: 'Date', valeur: data.paymentDate });
  lignes.push({ libelle: 'Transaction', valeur: data.transactionId });

  return rendreCourrielLume({
    langue: 'fr',
    preheader: `${data.total} — forfait ${data.planName}, ${data.billingPeriod.toLowerCase()}`,
    titre: 'Paiement reçu',
    salutation: 'Bonjour,',
    intro: `Merci ! Ton paiement pour ${data.companyName} est passé. Ton abonnement Lume ${data.planName} est actif.`,
    montant: { libelle: 'Montant payé', valeur: data.total, sous: `${data.billingPeriod} · ${data.currency}` },
    lignes,
    bouton: { texte: 'Voir mes factures', url: data.billingUrl },
    note: `Ce reçu a été envoyé à ${data.billingEmail}. Garde-le pour ta comptabilité.`,
    supportEmail: data.supportEmail || null,
  });
}
