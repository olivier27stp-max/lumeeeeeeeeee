/**
 * `payment_type` — la métadonnée que porte TOUT événement `invoice.paid`.
 *
 * Trois émetteurs, et un seul la posait : « Marquer payée » disait `full`, le
 * dépôt d'une soumission disait `deposit`, mais un paiement en ligne (Stripe,
 * PayPal) ne disait RIEN. Une règle filtrée sur `payment_type = full` ne
 * partait donc jamais pour un paiement par carte — précisément celui qu'une
 * entreprise veut remercier.
 *
 *   · `deposit` : le dépôt d'une soumission (aucune facture n'est soldée) ;
 *   · `full`    : la facture est soldée par ce paiement ;
 *   · `partial` : un paiement de facture qui ne la solde pas.
 *
 * Les préréglages s'appuient dessus : `payment_confirmation` = « pas un
 * dépôt » (`neq deposit`), `deposit_received` = `deposit`. Le vocabulaire vit
 * ici pour que les émetteurs ne puissent plus diverger.
 *
 * Aucune logique d'encaissement : une étiquette sur l'événement, rien d'autre.
 */
export type TypePaiement = 'full' | 'partial' | 'deposit';

export function typePaiement(p: { depot?: boolean; soldee: boolean }): TypePaiement {
  if (p.depot) return 'deposit';
  return p.soldee ? 'full' : 'partial';
}
