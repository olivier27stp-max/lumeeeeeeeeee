import React, { useMemo, useState } from 'react';
import {
  ArrowLeft, Eye, EyeOff, Copy, Link2, Check, Download, RefreshCw, Send,
  Pencil, Ban, CopyPlus, CheckCircle2, MoreHorizontal,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { formatDate } from '../lib/utils';
import { cn } from '../lib/utils';
import {
  duplicateInvoice, formatMoneyFromCents, getCompanySettings, getInvoiceById,
  getInvoiceRowUiStatus, getInvoiceAppliedTaxes, markInvoicePaidManually,
  sendInvoice, toClientDisplayName, voidInvoice,
} from '../lib/invoicesApi';
import InvoicePaymentModal from '../components/InvoicePaymentModal';
import { downloadInvoicePdf } from '../lib/generateInvoicePdf';
import StatusBadge from '../components/ui/StatusBadge';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
import ActivityTimeline from '../components/ActivityTimeline';
import RequestPaymentModal from '../components/RequestPaymentModal';
import InvoiceRenderer from '../components/invoice/InvoiceRenderer';
import { buildRenderData } from '../components/invoice/buildRenderData';
import { displayEmail, displayPhone } from '../lib/piiSanitizer';

export default function InvoiceDetails() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const invoiceId = params.id || '';
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [recurringLoading, setRecurringLoading] = useState(false);
  const [isRequestPaymentOpen, setIsRequestPaymentOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [showVisualPreview, setShowVisualPreview] = useState(false);

  const companyQuery = useQuery({ queryKey: ['companySettings'], queryFn: getCompanySettings });
  // Visual templates removed — single fixed invoice layout

  const detailsQuery = useQuery({
    queryKey: ['invoiceDetails', invoiceId],
    queryFn: () => getInvoiceById(invoiceId),
    enabled: !!invoiceId,
  });

  const appliedTaxesQuery = useQuery({
    queryKey: ['invoiceAppliedTaxes', invoiceId],
    queryFn: () => getInvoiceAppliedTaxes(invoiceId),
    enabled: !!invoiceId,
  });

  // Build render data for visual preview — MUST be declared before any conditional return
  // so hook order stays stable (React error #310 guard).
  const renderData = useMemo(
    () => detailsQuery.data
      ? buildRenderData(detailsQuery.data, companyQuery.data, null, appliedTaxesQuery.data || null)
      : null,
    [detailsQuery.data, companyQuery.data, appliedTaxesQuery.data],
  );

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
        <p className="text-lg font-bold text-danger">{t.invoiceDetails.invoiceNotFound}</p>
        <button type="button" onClick={() => navigate('/invoices')} className="glass-button mt-3">
          {t.invoiceDetails.backToInvoices}
        </button>
      </div>
    );
  }

  const { invoice, client, items } = detailsQuery.data;
  const uiStatus = getInvoiceRowUiStatus(invoice);
  const isDraft = invoice.status === 'draft';
  const isVoid = invoice.status === 'void';
  const isPaid = invoice.status === 'paid';
  const canPayNow =
    invoice.balance_cents > 0 &&
    !isVoid &&
    !isPaid &&
    ['sent', 'partial', 'sent_not_due', 'past_due'].includes(invoice.status);

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['invoiceDetails', invoiceId] });
    queryClient.invalidateQueries({ queryKey: ['invoicesKpis30d'] });
    queryClient.invalidateQueries({ queryKey: ['invoicesTable'] });
  }

  async function handleSendInvoice() {
    if (!client?.email) {
      toast.error(language === 'fr' ? 'Le client n\'a pas d\'email' : 'Client has no email');
      return;
    }
    setSendLoading(true);
    try {
      await sendInvoice({ invoiceId: invoice.id, channels: ['email'], toEmail: client.email });
      invalidateAll();
      toast.success(t.invoiceDetails.invoiceSent);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send');
    } finally {
      setSendLoading(false);
    }
  }

  async function handleVoid() {
    if (!window.confirm(t.invoiceDetails.voidThisInvoice)) return;
    try {
      await voidInvoice(invoice.id);
      invalidateAll();
      toast.success(t.invoiceDetails.invoiceVoided);
    } catch (err: any) {
      toast.error(err?.message || 'Failed');
    }
    setActionsOpen(false);
  }

  async function handleDuplicate() {
    try {
      const newId = await duplicateInvoice(invoice.id);
      queryClient.invalidateQueries({ queryKey: ['invoicesTable'] });
      toast.success(t.invoiceDetails.invoiceDuplicated);
      navigate(`/invoices/${newId}/edit`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed');
    }
    setActionsOpen(false);
  }

  const [markingPaid, setMarkingPaid] = useState(false);
  async function handleMarkPaid() {
    if (markingPaid) return; // prevent double-click race
    if (!window.confirm(t.invoiceDetails.markAsPaid)) return;
    setMarkingPaid(true);
    try {
      await markInvoicePaidManually(invoice.id);
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ['paymentsOverview'] });
      toast.success(t.invoiceDetails.invoiceMarkedAsPaid);
    } catch (err: any) {
      toast.error(err?.message || 'Failed');
    } finally {
      setMarkingPaid(false);
    }
    setActionsOpen(false);
  }

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => navigate('/invoices')} className="glass-button inline-flex items-center gap-2">
        <ArrowLeft size={14} />
        {t.invoiceDetails.backToInvoices}
      </button>

      <section className="section-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[15px] font-bold text-text-primary">{invoice.invoice_number}</h1>
            <p className="mt-1 text-[13px] text-text-secondary">{invoice.subject || t.invoiceDetails.noSubject}</p>
          </div>

          <div className="flex items-center gap-2">
            {/* Edit */}
            {(isDraft || !isPaid) && (
              <button
                type="button"
                onClick={() => navigate(`/invoices/${invoice.id}/edit`)}
                className="glass-button inline-flex items-center gap-1.5 text-[12px]"
              >
                <Pencil size={12} />
                {t.advancedNotes.edit}
              </button>
            )}

            {/* Send / Resend */}
            {!isPaid && !isVoid && (
              <button
                type="button"
                onClick={handleSendInvoice}
                disabled={sendLoading}
                className="glass-button inline-flex items-center gap-1.5 text-[12px]"
              >
                <Send size={12} />
                {sendLoading
                  ? (t.invoiceDetails.sending)
                  : isDraft
                    ? (t.invoiceDetails.sendInvoice)
                    : (t.invoiceDetails.resend)}
              </button>
            )}

            {/* PDF */}
            <button
              type="button"
              className="glass-button inline-flex items-center gap-1.5 text-[12px]"
              onClick={() => {
                try {
                  downloadInvoicePdf(detailsQuery.data!, companyQuery.data, appliedTaxesQuery.data || null);
                  toast.success(t.invoiceDetails.pdfDownloaded);
                } catch {
                  toast.error(t.invoiceDetails.failedToGeneratePdf);
                }
              }}
            >
              <Download size={12} />
              PDF
            </button>

            {/* Preview Toggle */}
            <button
              type="button"
              onClick={() => setShowVisualPreview(!showVisualPreview)}
              className={cn(
                'glass-button inline-flex items-center gap-1.5 text-[12px]',
                showVisualPreview && 'bg-primary/10 text-primary',
              )}
            >
              <Eye size={12} />
              {t.invoiceDetails.preview}
            </button>

            {/* Copy Link */}
            {invoice.view_token && (
              <button
                type="button"
                className="glass-button inline-flex items-center gap-1.5 text-[12px]"
                onClick={() => {
                  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';
                  const link = `${API_BASE}/q/${invoice.view_token}`;
                  navigator.clipboard.writeText(link);
                  setLinkCopied(true);
                  toast.success(t.invoiceDetails.linkCopied);
                  setTimeout(() => setLinkCopied(false), 2000);
                }}
              >
                {linkCopied ? <Check size={12} /> : <Link2 size={12} />}
                {linkCopied ? (t.invoiceDetails.copied) : (t.invoiceDetails.link)}
              </button>
            )}

            {/* Payment actions */}
            {canPayNow && (
              <>
                <button
                  type="button"
                  onClick={() => setIsRequestPaymentOpen(true)}
                  className="glass-button inline-flex items-center gap-1.5 text-[12px] bg-neutral-900 text-white hover:bg-neutral-800"
                >
                  <Send size={12} />
                  {t.invoiceDetails.requestPayment}
                </button>
                <button type="button" onClick={() => setIsPaymentModalOpen(true)} className="glass-button-primary">
                  {t.invoiceDetails.payNow}
                </button>
              </>
            )}

            {/* More actions dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setActionsOpen(!actionsOpen)}
                className="glass-button !p-2"
              >
                <MoreHorizontal size={14} />
              </button>
              <AnimatePresence>
                {actionsOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setActionsOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="absolute right-0 top-full z-20 mt-1 min-w-[180px] rounded-xl border border-outline bg-surface py-1 shadow-xl"
                    >
                      <button
                        type="button"
                        onClick={handleDuplicate}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-surface-secondary"
                      >
                        <CopyPlus size={12} />
                        {t.invoiceDetails.duplicate}
                      </button>
                      {!isPaid && !isVoid && invoice.balance_cents > 0 && (
                        <button
                          type="button"
                          onClick={handleMarkPaid}
                          disabled={markingPaid}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-green-600 hover:bg-surface-secondary disabled:opacity-40"
                        >
                          <CheckCircle2 size={12} />
                          {t.invoiceDetails.markAsPaid2}
                        </button>
                      )}
                      {!isPaid && !isVoid && (
                        <button
                          type="button"
                          onClick={handleVoid}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-danger hover:bg-surface-secondary"
                        >
                          <Ban size={12} />
                          {t.invoiceDetails.voidInvoice}
                        </button>
                      )}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <StatusBadge status={uiStatus} />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">{t.invoiceDetails.client}</p>
            <p className="text-[13px] font-bold text-text-primary">
              {client ? toClientDisplayName(client) : invoice.client_name}
            </p>
            <p className="text-[13px] text-text-secondary">{displayEmail(client?.email) !== '—' ? displayEmail(client?.email) : t.common.noEmail}</p>
            <p className="text-[13px] text-text-secondary">{displayPhone(client?.phone) !== '—' ? displayPhone(client?.phone) : t.common.noPhone}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">{t.invoiceDetails.dates}</p>
            <p className="text-[13px] text-text-secondary">{`${t.invoiceDetails.created}:`} {formatDate(invoice.created_at)}</p>
            <p className="text-[13px] text-text-secondary">{`${t.invoiceDetails.due}:`} {invoice.due_date ? formatDate(invoice.due_date) : '-'}</p>
            <p className="text-[13px] text-text-secondary">{`${t.invoiceDetails.issued}:`} {invoice.issued_at ? formatDate(invoice.issued_at) : '-'}</p>
            <p className="text-[13px] text-text-secondary">{`${t.invoiceDetails.paid}:`} {invoice.paid_at ? formatDate(invoice.paid_at) : '-'}</p>
            {invoice.job_id ? (
              <button
                type="button"
                className="glass-button mt-2"
                onClick={() => navigate(`/jobs/${invoice.job_id}`)}
              >
                {`${t.invoiceDetails.linkedJob} #${String(invoice.job_id).slice(0, 8)}`}
              </button>
            ) : null}
          </div>
        </div>

        {/* View Tracking */}
        {invoice.status !== 'draft' && (
          <div className="mt-5 flex items-center gap-3 p-3 rounded-xl border border-outline-subtle bg-surface-secondary">
            <div className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center",
              invoice.is_viewed ? "bg-success/10 text-success" : "bg-surface-tertiary text-text-tertiary"
            )}>
              {invoice.is_viewed ? <Eye size={16} /> : <EyeOff size={16} />}
            </div>
            <div className="flex-1">
              <p className={cn(
                "text-[13px] font-semibold",
                invoice.is_viewed ? "text-success" : "text-text-tertiary"
              )}>
                {invoice.is_viewed
                  ? (t.invoiceDetails.openedByClient)
                  : (t.invoiceDetails.notOpenedYet)}
              </p>
              {invoice.is_viewed && (
                <p className="text-[11px] text-text-tertiary">
                  {t.invoiceDetails.firstOpened}: {formatDate(invoice.viewed_at || '')}
                  {(invoice.view_count || 0) > 1 && (
                    <> · {invoice.view_count} {t.invoiceDetails.views}</>
                  )}
                  {invoice.last_viewed_at && invoice.last_viewed_at !== invoice.viewed_at && (
                    <> · {t.invoiceDetails.last}: {formatDate(invoice.last_viewed_at)}</>
                  )}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Recurring Invoice */}
        <div className="mt-5 flex items-center gap-3 p-3 rounded-xl border border-outline-subtle bg-surface-secondary">
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center",
            (invoice as any).is_recurring ? "bg-primary/10 text-primary" : "bg-surface-tertiary text-text-tertiary"
          )}>
            <RefreshCw size={16} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-text-primary">
                {t.invoiceDetails.recurringInvoice}
              </p>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!(invoice as any).is_recurring}
                  disabled={recurringLoading}
                  onChange={async (e) => {
                    const checked = e.target.checked;
                    setRecurringLoading(true);
                    try {
                      const updateData: any = { is_recurring: checked };
                      if (!checked) {
                        updateData.recurrence_interval = null;
                        updateData.next_recurrence_date = null;
                      } else {
                        // Default to monthly, set next recurrence to 1 month from today
                        updateData.recurrence_interval = 'monthly';
                        const next = new Date();
                        next.setMonth(next.getMonth() + 1);
                        updateData.next_recurrence_date = next.toISOString().slice(0, 10);
                      }
                      const { updateInvoiceRecurrence } = await import('../lib/invoicesApi');
                      await updateInvoiceRecurrence(invoice.id, updateData);
                      queryClient.invalidateQueries({ queryKey: ['invoiceDetails', invoiceId] });
                      toast.success(checked
                        ? (t.invoiceDetails.recurringEnabled)
                        : (t.invoiceDetails.recurringDisabled));
                    } catch (err: any) {
                      toast.error(err.message || 'Failed to update');
                    } finally {
                      setRecurringLoading(false);
                    }
                  }}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-surface-tertiary rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-surface-card after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
              </label>
            </div>

            {(invoice as any).is_recurring && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={(invoice as any).recurrence_interval || 'monthly'}
                  disabled={recurringLoading}
                  onChange={async (e) => {
                    const interval = e.target.value;
                    setRecurringLoading(true);
                    try {
                      // Compute next date based on interval from today
                      const next = new Date();
                      switch (interval) {
                        case 'weekly': next.setDate(next.getDate() + 7); break;
                        case 'biweekly': next.setDate(next.getDate() + 14); break;
                        case 'monthly': next.setMonth(next.getMonth() + 1); break;
                        case 'quarterly': next.setMonth(next.getMonth() + 3); break;
                        case 'yearly': next.setFullYear(next.getFullYear() + 1); break;
                      }
                      const { error } = await supabase
                        .from('invoices')
                        .update({
                          recurrence_interval: interval,
                          next_recurrence_date: next.toISOString().slice(0, 10),
                        })
                        .eq('id', invoice.id);
                      if (error) throw error;
                      queryClient.invalidateQueries({ queryKey: ['invoiceDetails', invoiceId] });
                      toast.success(t.invoiceDetails.intervalUpdated);
                    } catch (err: any) {
                      toast.error(err.message || 'Failed to update');
                    } finally {
                      setRecurringLoading(false);
                    }
                  }}
                  className="glass-input !py-1 text-xs"
                >
                  <option value="weekly">{t.invoiceDetails.weekly}</option>
                  <option value="biweekly">{t.invoiceDetails.biweekly}</option>
                  <option value="monthly">{t.billing.monthly}</option>
                  <option value="quarterly">{t.invoiceDetails.quarterly}</option>
                  <option value="yearly">{t.billing.yearly}</option>
                </select>
                {(invoice as any).next_recurrence_date && (
                  <span className="text-[11px] text-text-tertiary">
                    {t.invoiceDetails.next} {formatDate((invoice as any).next_recurrence_date)}
                  </span>
                )}
              </div>
            )}

            {(invoice as any).parent_invoice_id && (
              <p className="mt-1 text-[11px] text-text-tertiary">
                {t.invoiceDetails.generatedFromARecurringInvoice}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="section-card p-6">
        <h2 className="text-[15px] font-bold text-text-primary">{t.invoiceDetails.lineItems}</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-border">
              <tr>
                <th className="px-2 py-2 text-sm font-bold">{t.invoiceDetails.description}</th>
                <th className="px-2 py-2 text-sm font-bold">{t.invoiceDetails.qty}</th>
                <th className="px-2 py-2 text-right text-sm font-bold">{t.invoiceDetails.unit}</th>
                <th className="px-2 py-2 text-right text-sm font-bold">{t.invoiceDetails.lineTotal}</th>
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
                    {t.invoiceDetails.noItems}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-4 ml-auto w-full max-w-xs space-y-1 rounded-xl border border-outline-subtle bg-surface-secondary p-3">
          <p className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">{t.invoiceDetails.subtotal}</span>
            <span className="font-semibold">{formatMoneyFromCents(invoice.subtotal_cents, invoice.currency || 'CAD')}</span>
          </p>
          <p className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">{t.invoiceDetails.tax}</span>
            <span className="font-semibold">{formatMoneyFromCents(invoice.tax_cents, invoice.currency || 'CAD')}</span>
          </p>
          <p className="flex items-center justify-between border-t border-outline-subtle pt-2 text-base">
            <span className="font-semibold text-text-primary">{t.common.total}</span>
            <span className="font-semibold text-text-primary">{formatMoneyFromCents(invoice.total_cents, invoice.currency || 'CAD')}</span>
          </p>
          <p className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">{t.invoiceDetails.paid}</span>
            <span className="font-semibold">{formatMoneyFromCents(invoice.paid_cents, invoice.currency || 'CAD')}</span>
          </p>
          <p className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">{t.invoiceDetails.balance}</span>
            <span className="font-semibold">{formatMoneyFromCents(invoice.balance_cents, invoice.currency || 'CAD')}</span>
          </p>
        </div>
      </section>

      {/* Visual Invoice Preview */}
      {showVisualPreview && renderData && (
        <section className="section-card overflow-hidden">
          <div className="bg-gray-100 p-6">
            <div className="mx-auto max-w-[600px] rounded-xl bg-surface-card p-8 shadow-lg">
              <InvoiceRenderer data={renderData} />
            </div>
          </div>
        </section>
      )}

      <ActivityTimeline entityType="invoice" entityId={invoiceId} />

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

      <RequestPaymentModal
        open={isRequestPaymentOpen}
        onClose={() => setIsRequestPaymentOpen(false)}
        invoiceId={invoice.id}
        invoiceNumber={invoice.invoice_number}
        balanceCents={invoice.balance_cents}
        currency={invoice.currency || 'CAD'}
        clientEmail={client?.email}
        clientPhone={client?.phone}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['invoiceDetails', invoiceId] });
        }}
      />
    </div>
  );
}
