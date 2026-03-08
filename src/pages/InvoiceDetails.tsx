import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { formatDate } from '../lib/utils';
import { formatMoneyFromCents, getInvoiceById, getInvoiceRowUiStatus, toClientDisplayName } from '../lib/invoicesApi';
import InvoicePaymentModal from '../components/InvoicePaymentModal';
import StatusBadge from '../components/ui/StatusBadge';

export default function InvoiceDetails() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const invoiceId = params.id || '';
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  const detailsQuery = useQuery({
    queryKey: ['invoiceDetails', invoiceId],
    queryFn: () => getInvoiceById(invoiceId),
    enabled: !!invoiceId,
  });

  if (detailsQuery.isLoading) {
    return (
      <div className="section-card p-6">
        <div className="h-8 w-52 rounded bg-surface-secondary" />
        <div className="mt-3 h-6 w-72 rounded bg-surface-secondary" />
        <div className="mt-6 h-40 w-full rounded bg-surface-secondary" />
      </div>
    );
  }

  if (detailsQuery.isError || !detailsQuery.data) {
    return (
      <div className="section-card border-danger-light p-6">
        <p className="text-lg font-bold text-danger">Invoice not found.</p>
        <button type="button" onClick={() => navigate('/invoices')} className="glass-button mt-3">
          Back to invoices
        </button>
      </div>
    );
  }

  const { invoice, client, items } = detailsQuery.data;
  const uiStatus = getInvoiceRowUiStatus(invoice);
  const canPayNow = invoice.balance_cents > 0 && (invoice.status === 'sent' || invoice.status === 'partial');

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => navigate('/invoices')} className="glass-button inline-flex items-center gap-2">
        <ArrowLeft size={14} />
        Back to invoices
      </button>

      <section className="section-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[15px] font-bold text-text-primary">{invoice.invoice_number}</h1>
            <p className="mt-1 text-[13px] text-text-secondary">{invoice.subject || 'No subject'}</p>
          </div>

          <div className="flex items-center gap-2">
            {canPayNow ? (
              <button type="button" onClick={() => setIsPaymentModalOpen(true)} className="glass-button-primary">
                Pay now
              </button>
            ) : null}
            <StatusBadge status={uiStatus} />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Client</p>
            <p className="text-[13px] font-bold text-text-primary">
              {client ? toClientDisplayName(client) : invoice.client_name}
            </p>
            <p className="text-[13px] text-text-secondary">{client?.email || 'No email'}</p>
            <p className="text-[13px] text-text-secondary">{client?.phone || 'No phone'}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Dates</p>
            <p className="text-[13px] text-text-secondary">Created: {formatDate(invoice.created_at)}</p>
            <p className="text-[13px] text-text-secondary">Due: {invoice.due_date ? formatDate(invoice.due_date) : '-'}</p>
            <p className="text-[13px] text-text-secondary">Issued: {invoice.issued_at ? formatDate(invoice.issued_at) : '-'}</p>
            <p className="text-[13px] text-text-secondary">Paid: {invoice.paid_at ? formatDate(invoice.paid_at) : '-'}</p>
            {invoice.job_id ? (
              <button
                type="button"
                className="glass-button mt-2"
                onClick={() => navigate(`/jobs/${invoice.job_id}`)}
              >
                Linked job: open #{String(invoice.job_id).slice(0, 8)}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="section-card p-6">
        <h2 className="text-[15px] font-bold text-text-primary">Line items</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-border">
              <tr>
                <th className="px-2 py-2 text-sm font-bold">Description</th>
                <th className="px-2 py-2 text-sm font-bold">Qty</th>
                <th className="px-2 py-2 text-right text-sm font-bold">Unit</th>
                <th className="px-2 py-2 text-right text-sm font-bold">Line total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border">
                  <td className="px-2 py-2 text-sm text-text-primary">{item.description}</td>
                  <td className="px-2 py-2 text-sm text-text-secondary">{item.qty}</td>
                  <td className="px-2 py-2 text-right text-sm text-text-secondary">{formatMoneyFromCents(item.unit_price_cents, invoice.currency || 'CAD')}</td>
                  <td className="px-2 py-2 text-right text-sm font-semibold text-text-primary">
                    {formatMoneyFromCents(item.line_total_cents, invoice.currency || 'CAD')}
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-6 text-center text-sm text-text-secondary">
                    No items on this invoice.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-4 ml-auto w-full max-w-xs space-y-1 rounded-xl border-[1.5px] border-outline-subtle bg-surface-secondary p-3">
          <p className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Subtotal</span>
            <span className="font-semibold">{formatMoneyFromCents(invoice.subtotal_cents, invoice.currency || 'CAD')}</span>
          </p>
          <p className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Tax</span>
            <span className="font-semibold">{formatMoneyFromCents(invoice.tax_cents, invoice.currency || 'CAD')}</span>
          </p>
          <p className="flex items-center justify-between border-t border-outline-subtle pt-2 text-base">
            <span className="font-semibold text-text-primary">Total</span>
            <span className="font-semibold text-text-primary">{formatMoneyFromCents(invoice.total_cents, invoice.currency || 'CAD')}</span>
          </p>
          <p className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Paid</span>
            <span className="font-semibold">{formatMoneyFromCents(invoice.paid_cents, invoice.currency || 'CAD')}</span>
          </p>
          <p className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Balance</span>
            <span className="font-semibold">{formatMoneyFromCents(invoice.balance_cents, invoice.currency || 'CAD')}</span>
          </p>
        </div>
      </section>

      <InvoicePaymentModal
        open={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        invoiceId={invoice.id}
        invoiceNumber={invoice.invoice_number}
        balanceCents={invoice.balance_cents}
        currency={invoice.currency || 'CAD'}
        onPaid={() => {
          queryClient.invalidateQueries({ queryKey: ['invoiceDetails', invoiceId] });
          queryClient.invalidateQueries({ queryKey: ['invoicesKpis30d'] });
          queryClient.invalidateQueries({ queryKey: ['invoicesTable'] });
          queryClient.invalidateQueries({ queryKey: ['paymentsOverview'] });
          queryClient.invalidateQueries({ queryKey: ['paymentsTable'] });
          queryClient.invalidateQueries({ queryKey: ['insightsOverview'] });
          queryClient.invalidateQueries({ queryKey: ['insightsRevenueSeries'] });
          queryClient.invalidateQueries({ queryKey: ['insightsInvoicesSummary'] });
        }}
      />
    </div>
  );
}
