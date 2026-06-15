/* ═══════════════════════════════════════════════════════════════
   PaymentDetailDrawer — read-only payment detail (card brand/last4,
   method, amount, status, receipt). Opened from the per-row link
   icon in the Facturation tab. Slide-in panel modeled on the payout
   detail drawer in Payments.tsx.
   ═══════════════════════════════════════════════════════════════ */

import { AnimatePresence, motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, ExternalLink, X } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { fetchPaymentDetail, formatMoneyFromCents } from '../../lib/paymentsApi';
import { formatDate } from '../../lib/utils';
import StatusBadge from '../ui/StatusBadge';

function methodLabel(method: string | null | undefined, fr: boolean): string {
  switch (method) {
    case 'card': return fr ? 'Carte' : 'Card';
    case 'e-transfer': return fr ? 'Virement' : 'E-transfer';
    case 'cash': return fr ? 'Comptant' : 'Cash';
    case 'check': return fr ? 'Chèque' : 'Check';
    default: return '—';
  }
}

export default function PaymentDetailDrawer({
  orgId,
  paymentId,
  onClose,
}: {
  orgId: string | null;
  paymentId: string | null;
  onClose: () => void;
}) {
  const { t, language } = useTranslation();
  const fr = language === 'fr';

  const detail = useQuery({
    queryKey: ['paymentDetail', paymentId],
    queryFn: () => fetchPaymentDetail({ orgId: orgId as string, id: paymentId as string }),
    enabled: Boolean(orgId) && Boolean(paymentId),
  });

  const d = detail.data;

  return (
    <AnimatePresence>
      {paymentId && (
        <>
          <motion.div
            className="fixed inset-0 z-[80] bg-black/20 backdrop-blur-[2px]"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            className="fixed right-0 top-0 z-[90] h-screen w-full max-w-md bg-surface-card border-l border-outline p-6 overflow-y-auto"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl font-bold text-text-primary">
                {fr ? 'Détail du paiement' : 'Payment detail'}
              </h3>
              <button
                className="p-2 rounded-xl hover:bg-surface-secondary text-text-tertiary transition-colors"
                onClick={onClose}
              >
                <X size={14} />
              </button>
            </div>

            {detail.isLoading && (
              <div className="space-y-3 mt-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex justify-between">
                    <div className="h-4 w-20 bg-surface-tertiary rounded animate-pulse" />
                    <div className="h-4 w-24 bg-surface-tertiary rounded animate-pulse" />
                  </div>
                ))}
              </div>
            )}

            {detail.error && (
              <p className="mt-4 text-[13px] text-danger">{(detail.error as Error).message}</p>
            )}

            {!detail.isLoading && d && (
              <div className="mt-4 space-y-3">
                {/* Card visual */}
                {(d.card_last4 || d.method === 'card') && (
                  <div className="flex items-center gap-3 rounded-xl border border-outline bg-surface-secondary px-4 py-3 mb-2">
                    <CreditCard size={20} className="text-text-tertiary" />
                    <div>
                      <div className="text-[14px] font-semibold text-text-primary capitalize">
                        {d.card_brand || (fr ? 'Carte' : 'Card')}
                      </div>
                      <div className="text-[12px] text-text-muted tabular-nums">
                        {d.card_last4 ? `•••• ${d.card_last4}` : '—'}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">{fr ? 'Montant' : 'Amount'}</span>
                  <span className="font-semibold text-text-primary">
                    {formatMoneyFromCents(d.amount_cents, d.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">{fr ? 'Statut' : 'Status'}</span>
                  <StatusBadge status={d.status} />
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">{fr ? 'Méthode' : 'Method'}</span>
                  <span className="text-text-primary">{methodLabel(d.method, fr)}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">{fr ? 'Fournisseur' : 'Provider'}</span>
                  <span className="text-text-primary capitalize">{d.provider || '—'}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">{t.payments?.created || (fr ? 'Date' : 'Date')}</span>
                  <span className="text-text-primary">{d.payment_date ? formatDate(d.payment_date) : '—'}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">ID</span>
                  <span className="text-text-tertiary font-mono text-[11px]">{d.id}</span>
                </div>

                {d.receipt_url && (
                  <a
                    href={d.receipt_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-2 h-9 px-4 bg-primary text-white rounded-md text-[13px] font-medium hover:bg-primary-hover transition-colors"
                  >
                    <ExternalLink size={14} /> {fr ? 'Voir le reçu' : 'View receipt'}
                  </a>
                )}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
