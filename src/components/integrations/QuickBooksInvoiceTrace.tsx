/* Fiche facture : la facture et ses paiements sont-ils dans QuickBooks ?
   Visible seulement pour le propriétaire / admin d'un bureau connecté. */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from 'lucide-react';
import {
  getQboInvoiceTrace,
  resendQboInvoice,
  QboSyncForbidden,
  QboSyncUnavailable,
  type QboEntityTrace,
} from '../../lib/quickbooksSyncApi';
import { formatMoneyFromCents } from '../../lib/invoicesApi';
import { formatDate } from '../../lib/utils';

type Tone = 'good' | 'wait' | 'bad' | 'muted';

function stateOf(e: QboEntityTrace, fr: boolean): { tone: Tone; label: string } {
  if (e.queue_status === 'error') return { tone: 'bad', label: fr ? 'Erreur' : 'Error' };
  if (e.queue_status === 'pending' || e.queue_status === 'processing') {
    return { tone: 'wait', label: fr ? 'En attente' : 'Pending' };
  }
  if (e.qbo_state === 'voided') return { tone: 'muted', label: fr ? 'Annulé dans QuickBooks' : 'Voided in QuickBooks' };
  if (e.qbo_state === 'deleted') return { tone: 'muted', label: fr ? 'Retiré de QuickBooks' : 'Removed from QuickBooks' };
  if (e.qbo_id) return { tone: 'good', label: fr ? 'Dans QuickBooks' : 'In QuickBooks' };
  if (e.queue_status === 'skipped') return { tone: 'muted', label: fr ? 'Pas envoyé' : 'Not sent' };
  return { tone: 'muted', label: fr ? 'Jamais envoyé' : 'Never sent' };
}

const toneCls: Record<Tone, string> = {
  good: 'bg-green-500/10 text-green-700 dark:text-green-400',
  wait: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  bad: 'bg-red-500/10 text-red-700 dark:text-red-400',
  muted: 'bg-surface-secondary text-text-secondary',
};

function Pill({ e, fr }: { e: QboEntityTrace; fr: boolean }) {
  const s = stateOf(e, fr);
  return <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${toneCls[s.tone]}`}>{s.label}</span>;
}

function Detail({ e, fr }: { e: QboEntityTrace; fr: boolean }) {
  const parts: string[] = [];
  if (e.qbo_id) parts.push(`ID QuickBooks ${e.qbo_id}${e.qbo_doc_number ? ` · #${e.qbo_doc_number}` : ''}`);
  if (e.last_synced_at) parts.push(`${fr ? 'envoyé le' : 'sent'} ${formatDate(e.last_synced_at)}`);
  return (
    <>
      {parts.length > 0 && <p className="text-[12px] text-text-tertiary">{parts.join(' · ')}</p>}
      {e.message && (
        <p className={`text-[12px] ${e.queue_status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-text-tertiary'}`}>
          {e.message}
        </p>
      )}
    </>
  );
}

const methodFr: Record<string, string> = { card: 'Carte', 'e-transfer': 'Virement', cash: 'Comptant', check: 'Chèque' };

export default function QuickBooksInvoiceTrace({ invoiceId, currency, fr }: { invoiceId: string; currency: string; fr: boolean }) {
  const queryClient = useQueryClient();
  const key = ['qboInvoiceTrace', invoiceId];
  const trace = useQuery({
    queryKey: key,
    queryFn: () => getQboInvoiceTrace(invoiceId),
    retry: false,
    staleTime: 15_000,
    // Tant qu'un envoi est en file, on revient voir.
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      const waiting = [d.invoice, ...d.payments].some((e) => e.queue_status === 'pending' || e.queue_status === 'processing');
      return waiting ? 20_000 : false;
    },
  });

  const resend = useMutation({
    mutationFn: () => resendQboInvoice(invoiceId),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      toast.success(fr ? 'Envoyée à QuickBooks' : 'Sent to QuickBooks');
    },
    onError: (err: any) => toast.error(err?.message || (fr ? 'Échec de l\'envoi' : 'Send failed')),
  });

  // Non-admin, synchro pas installée ou bureau non connecté : rien à montrer.
  if (trace.error instanceof QboSyncForbidden || trace.error instanceof QboSyncUnavailable) return null;
  if (trace.isLoading || !trace.data?.connected) return null;
  const d = trace.data;
  const hasError = [d.invoice, ...d.payments].some((e) => e.queue_status === 'error');

  return (
    <section className="section-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">QuickBooks</h3>
          {d.company && <p className="text-[12px] text-text-tertiary">{d.company}</p>}
        </div>
        <button
          type="button"
          onClick={() => resend.mutate()}
          disabled={resend.isPending}
          className={`glass-button inline-flex items-center gap-2 text-xs ${hasError ? 'text-red-600' : ''}`}
        >
          {resend.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {fr ? 'Renvoyer à QuickBooks' : 'Resend to QuickBooks'}
        </button>
      </div>

      <ul className="mt-4 divide-y divide-outline-subtle">
        <li className="flex items-start justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="text-sm text-text-primary">{fr ? 'Facture' : 'Invoice'}</p>
            <Detail e={d.invoice} fr={fr} />
          </div>
          <Pill e={d.invoice} fr={fr} />
        </li>
        {d.payments.map((p) => (
          <li key={p.id} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-sm text-text-primary">
                {fr ? 'Paiement' : 'Payment'} {formatMoneyFromCents(p.amount_cents, currency)}
                <span className="text-text-tertiary">
                  {' · '}
                  {p.provider === 'stripe' ? 'Stripe' : p.provider === 'paypal' ? 'PayPal' : (fr ? 'manuel' : 'manual')}
                  {p.method ? ` · ${fr ? methodFr[p.method] || p.method : p.method}` : ''}
                  {p.payment_date ? ` · ${formatDate(p.payment_date)}` : ''}
                  {p.status !== 'succeeded' ? ` · ${p.status}` : ''}
                </span>
              </p>
              <Detail e={p} fr={fr} />
            </div>
            <Pill e={p} fr={fr} />
          </li>
        ))}
      </ul>
    </section>
  );
}
