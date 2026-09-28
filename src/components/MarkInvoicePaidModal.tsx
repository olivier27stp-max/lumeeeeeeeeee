import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import Modal from './ui/Modal';
import {
  formatMoneyFromCents,
  markInvoicePaidManually,
  type ManualPaymentMethod,
} from '../lib/invoicesApi';
import { useTranslation } from '../i18n';

interface MarkInvoicePaidModalProps {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  invoiceNumber: string;
  balanceCents: number;
  currency?: string;
  onPaid?: () => void | Promise<void>;
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function MarkInvoicePaidModal({
  open, onClose, invoiceId, invoiceNumber, balanceCents, currency = 'CAD', onPaid,
}: MarkInvoicePaidModalProps) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const defaultNotes = fr
    ? `Paiement appliqué à la facture #${invoiceNumber}`
    : `Payment applied to invoice #${invoiceNumber}`;

  const [paymentDate, setPaymentDate] = useState(todayLocal);
  const [method, setMethod] = useState<ManualPaymentMethod>('e-transfer');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState(defaultNotes);
  const [saving, setSaving] = useState(false);

  // Chaque ouverture repart des valeurs par défaut (date du jour, détails pré-remplis).
  useEffect(() => {
    if (!open) return;
    setPaymentDate(todayLocal());
    setMethod('e-transfer');
    setReference('');
    setNotes(defaultNotes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId]);

  const methods: { value: ManualPaymentMethod; label: string }[] = [
    { value: 'e-transfer', label: fr ? 'Virement Interac' : 'E-transfer' },
    { value: 'cash', label: fr ? 'Comptant' : 'Cash' },
    { value: 'check', label: fr ? 'Chèque' : 'Check' },
    { value: 'card', label: fr ? 'Carte de crédit' : 'Credit card' },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await markInvoicePaidManually(invoiceId, { paymentDate, method, reference, notes });
      await onPaid?.();
      toast.success(fr ? 'Facture marquée payée' : 'Invoice marked as paid');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Échec de l\'opération' : 'Failed'));
    } finally {
      setSaving(false);
    }
  }

  const labelCls = 'block text-[13px] font-medium text-text-primary mb-1';
  const optionalCls = 'ml-1 text-[12px] font-normal text-text-tertiary';

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={fr ? 'Marquer la facture payée' : 'Mark invoice as paid'}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg border border-border-primary bg-surface-secondary p-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-secondary">{fr ? 'Facture' : 'Invoice'}</span>
            <span className="text-[13px] font-medium text-text-primary">#{invoiceNumber}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[13px] text-text-secondary">{fr ? 'Montant payé' : 'Amount paid'}</span>
            <span className="text-[15px] font-bold text-text-primary">
              {formatMoneyFromCents(balanceCents, currency)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="mip-date" className={labelCls}>
              {fr ? 'Date de transaction' : 'Transaction date'}
            </label>
            <input
              id="mip-date"
              type="date"
              required
              value={paymentDate}
              max={todayLocal()}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="glass-input w-full"
            />
          </div>
          <div>
            <label htmlFor="mip-method" className={labelCls}>
              {fr ? 'Méthode de paiement' : 'Payment method'}
            </label>
            <select
              id="mip-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as ManualPaymentMethod)}
              className="glass-input w-full"
            >
              {methods.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="mip-ref" className={labelCls}>
            {fr ? 'Numéro de référence' : 'Reference #'}
            <span className={optionalCls}>{fr ? '(facultatif)' : '(optional)'}</span>
          </label>
          <input
            id="mip-ref"
            type="text"
            value={reference}
            maxLength={120}
            onChange={(e) => setReference(e.target.value)}
            placeholder={fr ? 'Ex. : # de chèque, # de confirmation Interac' : 'e.g. check #, e-transfer confirmation #'}
            className="glass-input w-full"
          />
        </div>

        <div>
          <label htmlFor="mip-notes" className={labelCls}>
            {fr ? 'Détails' : 'Details'}
            <span className={optionalCls}>{fr ? '(facultatif)' : '(optional)'}</span>
          </label>
          <textarea
            id="mip-notes"
            rows={3}
            value={notes}
            maxLength={1000}
            onChange={(e) => setNotes(e.target.value)}
            className="glass-input w-full resize-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={saving} className="glass-button">
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button type="submit" disabled={saving || !paymentDate} className="glass-button-primary inline-flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {fr ? 'Marquer payée' : 'Mark as paid'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
