import React, { useEffect, useState } from 'react';
import { CreditCard, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getClientCardOnFile, removeClientCardOnFile, type ClientCardOnFile as CardOnFile } from '../lib/cardOnFileApi';

/**
 * Section « Paiement au dossier » du hub client : la carte sauvegardée avec
 * le consentement du client (page de paiement publique), retirable en tout
 * temps — droit de retrait Loi 25. Aucun numéro de carte n'est conservé
 * ici : seulement marque, 4 derniers chiffres et expiration (jetons Stripe).
 */
export default function ClientCardOnFile({ clientId, fr }: { clientId: string; fr: boolean }) {
  const [card, setCard] = useState<CardOnFile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    getClientCardOnFile(clientId)
      .then((c) => { if (!cancelled) setCard(c); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [clientId]);

  const handleRemove = async () => {
    if (removing) return;
    const msg = fr
      ? 'Retirer la carte au dossier de ce client ? Elle sera aussi détachée chez Stripe et les paiements automatiques cesseront.'
      : 'Remove this client’s card on file? It will also be detached at Stripe and automatic payments will stop.';
    if (typeof window !== 'undefined' && !window.confirm(msg)) return;
    setRemoving(true);
    try {
      await removeClientCardOnFile(clientId);
      setCard(null);
      toast.success(fr ? 'Carte au dossier retirée.' : 'Card on file removed.');
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Impossible de retirer la carte.' : 'Could not remove the card.'));
    } finally {
      setRemoving(false);
    }
  };

  const brandLabel = (brand: string | null) => {
    if (!brand) return fr ? 'Carte' : 'Card';
    const b = brand.toLowerCase();
    if (b === 'visa') return 'Visa';
    if (b === 'mastercard') return 'Mastercard';
    if (b === 'amex' || b === 'american_express') return 'Amex';
    return brand.charAt(0).toUpperCase() + brand.slice(1);
  };

  return (
    <div className="section-card">
      <div className="px-5 py-3.5 border-b border-outline">
        <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
          <CreditCard size={15} className="text-text-secondary" />
          {fr ? 'Paiement au dossier' : 'Payment on file'}
        </h2>
      </div>
      <div className="p-5">
        {!loaded ? (
          <p className="text-[13px] text-text-tertiary">{fr ? 'Chargement…' : 'Loading…'}</p>
        ) : card ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-outline-subtle bg-surface-secondary p-3.5">
              <div className="flex items-center gap-3 min-w-0">
                <span className="h-9 w-12 rounded-md bg-text-primary text-white flex items-center justify-center shrink-0">
                  <CreditCard size={16} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-text-primary tabular-nums">
                    {brandLabel(card.card_brand)} •••• {card.card_last4}
                  </p>
                  {card.card_exp_month && card.card_exp_year && (
                    <p className="text-[11px] text-text-tertiary tabular-nums">
                      {fr ? 'Expire' : 'Expires'} {String(card.card_exp_month).padStart(2, '0')}/{String(card.card_exp_year).slice(-2)}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleRemove()}
                disabled={removing}
                className="p-2 rounded-lg text-text-tertiary hover:text-danger hover:bg-danger-light transition-colors disabled:opacity-50"
                title={fr ? 'Retirer la carte (droit de retrait)' : 'Remove the card'}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <p className="text-[11px] text-text-tertiary leading-relaxed">
              {fr
                ? `Sauvegardée avec le consentement du client${card.consented_at ? ` le ${new Date(card.consented_at).toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' })}` : ''}. Conservée de façon sécurisée par Stripe — aucun numéro de carte n'est gardé ici. Utilisée pour les paiements automatiques des factures.`
                : `Saved with the client’s consent${card.consented_at ? ` on ${new Date(card.consented_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}` : ''}. Stored securely by Stripe — no card number is kept here. Used for automatic invoice payments.`}
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-text-tertiary leading-relaxed">
            {fr
              ? 'Aucune carte au dossier. Elle sera sauvegardée quand le client l’ajoutera depuis la page de son contrat, ou paiera une facture en ligne en cochant « Sauvegarder ma carte pour les paiements futurs ».'
              : 'No card on file. It gets saved when the client adds it from their contract page, or pays an invoice online and checks “Save my card for future payments”.'}
          </p>
        )}
      </div>
    </div>
  );
}
