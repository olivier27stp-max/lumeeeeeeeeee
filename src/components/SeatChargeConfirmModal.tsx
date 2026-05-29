import React from 'react';
import { motion } from 'motion/react';
import { UserPlus, Receipt, AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslation } from '../i18n';

interface SeatChargeConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  email: string;
  /** How many extra seats this invite will add (typically 1) */
  newExtras: number;
  /** Price per extra seat per period, in cents */
  extraPriceCents: number;
  /** Billing interval (monthly | yearly) */
  interval: 'monthly' | 'yearly';
  busy?: boolean;
}

/**
 * Confirms an invite that exceeds the plan seat limit.
 * Shows the user what they'll be billed now (prorated) and going forward.
 */
export default function SeatChargeConfirmModal({
  open,
  onClose,
  onConfirm,
  email,
  newExtras,
  extraPriceCents,
  interval,
  busy = false,
}: SeatChargeConfirmModalProps) {
  const { language } = useTranslation();
  const isFr = language === 'fr';

  if (!open) return null;

  const pricePerSeat = extraPriceCents / 100;
  const periodLabel = interval === 'yearly' ? (isFr ? 'an' : 'yr') : (isFr ? 'mois' : 'mo');

  return (
    <div
      className="fixed inset-0 z-[65] bg-black/65 backdrop-blur-md flex items-center justify-center p-4"
      onClick={busy ? undefined : onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-card rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-outline-subtle"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 bg-gradient-to-br from-amber-500/10 via-transparent to-transparent border-b border-outline-subtle">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center">
              <AlertTriangle size={18} className="text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-extrabold text-text-primary">
                {isFr ? 'Siège supplémentaire requis' : 'Extra seat required'}
              </h2>
              <p className="text-[13px] text-text-secondary mt-1">
                {isFr
                  ? `L'invitation de ${email} dépasse votre limite de plan.`
                  : `Inviting ${email} will exceed your plan limit.`}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* What gets added */}
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center mt-0.5">
              <UserPlus size={13} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-text-primary">
                {isFr ? '+1 siège utilisateur' : '+1 user seat'}
              </p>
              <p className="text-[12px] text-text-secondary">
                {isFr
                  ? `Au tarif de votre plan : $${pricePerSeat}/${periodLabel}`
                  : `At your plan rate: $${pricePerSeat}/${periodLabel}`}
              </p>
            </div>
          </div>

          {/* Billing summary */}
          <div className="rounded-xl bg-surface-secondary/40 border border-outline-subtle p-4 space-y-2.5">
            <div className="flex items-center gap-2 mb-1">
              <Receipt size={13} className="text-text-tertiary" />
              <p className="text-[10px] uppercase tracking-wider font-bold text-text-tertiary">
                {isFr ? 'Récapitulatif' : 'Billing summary'}
              </p>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-text-secondary">
                {newExtras} × ${pricePerSeat}/{periodLabel}
              </span>
              <span className="font-bold text-text-primary tabular-nums">
                +${(pricePerSeat * newExtras).toFixed(0)}/{periodLabel}
              </span>
            </div>
            <div className="text-[11px] text-text-tertiary border-t border-outline-subtle pt-2">
              {isFr
                ? `Le prorata sera facturé immédiatement sur votre carte enregistrée. Le tarif récurrent commencera au prochain cycle.`
                : `Prorated amount is billed immediately to your card on file. Recurring rate kicks in next cycle.`}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-5 py-2.5 rounded-xl text-[13px] font-medium text-text-secondary hover:text-text-primary border border-outline-subtle hover:border-outline transition-colors disabled:opacity-50"
          >
            {isFr ? 'Annuler' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-extrabold bg-text-primary text-surface hover:bg-text-primary/90 active:scale-[0.98] transition-all shadow-md disabled:opacity-60"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {busy
              ? (isFr ? 'Traitement...' : 'Processing...')
              : (isFr ? 'Confirmer & inviter' : 'Confirm & invite')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
