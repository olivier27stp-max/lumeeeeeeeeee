/**
 * Part d'un paiement rendue au client, bornée à son montant.
 *
 * `payments.amount_cents` est la part FACTURE d'un paiement Stripe (le
 * pourboire vit à part, dans tip_cents), alors que `charge.amount_refunded`
 * compte toute la charge. Un remboursement s'impute d'abord sur la facture :
 * la facture se rouvre de ce montant, jamais de plus que ce qu'elle a reçu.
 */
export function montantRembourse(rembourseCharge: number | null | undefined, montantPaiement: number): number {
  const r = Math.round(Number(rembourseCharge) || 0);
  return Math.max(0, Math.min(r, Math.max(0, Math.round(Number(montantPaiement) || 0))));
}
