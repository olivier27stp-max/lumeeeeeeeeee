/* Lume Agent — confirmation card for a proposed write action.
   The action is executed only when the user clicks Confirm. */

import React from 'react';
import { Check, X, FileText, Receipt, Briefcase, MessageSquare, Loader2 } from 'lucide-react';
import type { ProposedAction } from '../lib/agentApi';

const money = (cents: number, fr: boolean) => {
  const v = (Number(cents) || 0) / 100;
  return fr
    ? `${v.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`
    : `$${v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const ICONS: Record<ProposedAction['type'], React.ReactNode> = {
  create_quote: <FileText size={15} />,
  create_invoice: <Receipt size={15} />,
  create_job: <Briefcase size={15} />,
  send_sms: <MessageSquare size={15} />,
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex gap-2 text-[12.5px]">
      <span className="text-text-tertiary min-w-[90px]">{label}</span>
      <span className="text-text-primary font-medium break-words">{value}</span>
    </div>
  );
}

function Preview({ action, fr }: { action: ProposedAction; fr: boolean }) {
  const p = action.payload || {};

  if (action.type === 'send_sms') {
    return (
      <div className="space-y-1.5">
        <Row label={fr ? 'Destinataire' : 'Recipient'} value={p.client_name || p.phone_number} />
        {p.client_name && <Row label={fr ? 'Téléphone' : 'Phone'} value={p.phone_number} />}
        <div className="mt-2 rounded-lg bg-surface-secondary border border-outline p-2.5 text-[12.5px] text-text-primary whitespace-pre-wrap">
          {p.message_text}
        </div>
      </div>
    );
  }

  const items: any[] = action.type === 'create_invoice' ? p.items || [] : p.line_items || [];
  const total = items.reduce((sum, it) => {
    const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
    return sum + qty * (Number(it.unit_price_cents) || 0);
  }, 0);

  return (
    <div className="space-y-1.5">
      <Row label={fr ? 'Titre' : 'Title'} value={p.title || p.subject} />
      <Row label="Client" value={p.client_name || p.client_id || p.lead_id || (fr ? '—' : '—')} />
      {action.type === 'create_job' && <Row label={fr ? 'Adresse' : 'Address'} value={p.property_address} />}
      {action.type === 'create_job' && <Row label={fr ? 'Planifié' : 'Scheduled'} value={p.scheduled_at} />}
      {action.type === 'create_invoice' && <Row label={fr ? 'Échéance' : 'Due date'} value={p.due_date} />}
      {items.length > 0 && (
        <div className="mt-2 rounded-lg bg-surface-secondary border border-outline divide-y divide-outline">
          {items.map((it, i) => {
            const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
            const line = qty * (Number(it.unit_price_cents) || 0);
            return (
              <div key={i} className="flex items-center justify-between px-2.5 py-1.5 text-[12.5px]">
                <span className="text-text-primary">
                  {qty > 1 ? `${qty}× ` : ''}
                  {it.name || it.description}
                </span>
                <span className="text-text-secondary tabular-nums">{money(line, fr)}</span>
              </div>
            );
          })}
          <div className="flex items-center justify-between px-2.5 py-1.5 text-[12.5px] font-semibold">
            <span>{fr ? 'Sous-total' : 'Subtotal'}</span>
            <span className="tabular-nums">{money(total, fr)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ActionConfirmCard({
  action,
  fr,
  busy,
  onConfirm,
  onCancel,
}: {
  action: ProposedAction;
  fr: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titles: Record<ProposedAction['type'], string> = {
    create_quote: fr ? 'Créer une soumission' : 'Create a quote',
    create_invoice: fr ? 'Créer une facture' : 'Create an invoice',
    create_job: fr ? 'Créer une job' : 'Create a job',
    send_sms: fr ? 'Envoyer un SMS' : 'Send an SMS',
  };

  return (
    <div className="mt-2 rounded-xl border border-primary/30 bg-primary/5 p-3.5 max-w-[520px]">
      <div className="flex items-center gap-2 mb-2.5 text-[13px] font-semibold text-text-primary">
        <span className="text-primary">{ICONS[action.type]}</span>
        {titles[action.type]}
        <span className="ml-auto text-[10.5px] font-medium uppercase tracking-wider text-text-tertiary">
          {fr ? 'À confirmer' : 'Needs confirmation'}
        </span>
      </div>

      <Preview action={action} fr={fr} />

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-[12.5px] font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {fr ? 'Confirmer' : 'Confirm'}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline text-text-secondary text-[12.5px] hover:bg-surface-secondary disabled:opacity-50"
        >
          <X size={13} />
          {fr ? 'Annuler' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
