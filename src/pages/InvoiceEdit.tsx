import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, GripVertical, Plus, Save, Send, Trash2, Eye, X,
} from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import {
  createInvoiceDraft,
  formatMoneyFromCents,
  getCompanySettings,
  getInvoiceById,
  getJobLineItems,
  listVisualTemplates,
  saveInvoiceDraft,
  searchActiveClients,
  sendInvoice,
  type InvoiceDetail,
  type InvoiceItemInput,
} from '../lib/invoicesApi';
import { calculateInvoiceTotals, lineTotal } from '../lib/invoiceCalc';
import InvoiceRenderer from '../components/invoice/InvoiceRenderer';
import InvoiceTemplatePicker from '../components/invoice/InvoiceTemplatePicker';
import { buildRenderData } from '../components/invoice/buildRenderData';
import type { InvoiceLayoutType } from '../components/invoice/types';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';

// ── Line item form ──
interface LineForm {
  id: string;
  description: string;
  title: string;
  qty: number;
  unitPrice: number; // dollars
  source_type: string | null;
  source_id: string | null;
  included: boolean;
}

function emptyLine(): LineForm {
  return {
    id: crypto.randomUUID(),
    description: '',
    title: '',
    qty: 1,
    unitPrice: 0,
    source_type: null,
    source_id: null,
    included: true,
  };
}

export default function InvoiceEdit() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const invoiceId = params.id || '';
  const isNew = invoiceId === 'new';
  const prefillJobId = searchParams.get('jobId');
  const prefillClientId = searchParams.get('clientId');

  // ── State ──
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [draftId, setDraftId] = useState<string | null>(isNew ? null : invoiceId);

  // Form state
  const [clientId, setClientId] = useState(prefillClientId || '');
  const [clientSearch, setClientSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [subject, setSubject] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [taxDollars, setTaxDollars] = useState(0);
  const [discountDollars, setDiscountDollars] = useState(0);
  const [lines, setLines] = useState<LineForm[]>([emptyLine()]);
  const [layout, setLayout] = useState<InvoiceLayoutType>('classic');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');

  // ── Queries ──
  const detailQuery = useQuery({
    queryKey: ['invoiceEdit', invoiceId],
    queryFn: () => getInvoiceById(invoiceId),
    enabled: !isNew && !!invoiceId,
  });

  const companyQuery = useQuery({
    queryKey: ['companySettings'],
    queryFn: getCompanySettings,
  });

  const templatesQuery = useQuery({
    queryKey: ['visualTemplates'],
    queryFn: listVisualTemplates,
  });

  // Client search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(clientSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [clientSearch]);

  const clientsQuery = useQuery({
    queryKey: ['invoiceClients', debouncedSearch],
    queryFn: () => searchActiveClients({ q: debouncedSearch, page: 1, pageSize: 20 }),
    enabled: isNew && !clientId,
  });

  // Job line items prefill
  const jobItemsQuery = useQuery({
    queryKey: ['jobLineItems', prefillJobId],
    queryFn: () => getJobLineItems(prefillJobId!),
    enabled: !!prefillJobId,
  });

  // ── Hydrate form from existing invoice ──
  useEffect(() => {
    if (!detailQuery.data) return;
    const { invoice, client, items } = detailQuery.data;
    setClientId(invoice.client_id);
    setSubject(invoice.subject || '');
    setDueDate(invoice.due_date || '');
    setNotes((invoice as any).notes || '');
    setInternalNotes((invoice as any).internal_notes || '');
    setTaxDollars(invoice.tax_cents / 100);
    setDiscountDollars(((invoice as any).discount_cents || 0) / 100);
    setClientName(client ? `${client.first_name || ''} ${client.last_name || ''}`.trim() : invoice.client_name);
    setClientEmail(client?.email || '');
    setClientPhone(client?.phone || '');
    setLines(
      items.length > 0
        ? items.map((item) => ({
            id: item.id,
            description: item.description,
            title: (item as any).title || '',
            qty: item.qty,
            unitPrice: item.unit_price_cents / 100,
            source_type: (item as any).source_type || null,
            source_id: (item as any).source_id || null,
            included: true,
          }))
        : [emptyLine()],
    );
    // Template
    const tplId = (invoice as any).template_id;
    if (tplId) {
      setTemplateId(tplId);
      const tpl = templatesQuery.data?.find((t) => t.id === tplId);
      if (tpl?.layout_type) setLayout(tpl.layout_type as InvoiceLayoutType);
    }
  }, [detailQuery.data]);

  // ── Prefill from job ──
  useEffect(() => {
    if (!jobItemsQuery.data || jobItemsQuery.data.length === 0) return;
    setLines(
      jobItemsQuery.data.map((item) => ({
        id: crypto.randomUUID(),
        description: item.description,
        title: '',
        qty: item.qty,
        unitPrice: item.unit_price_cents / 100,
        source_type: item.source_type,
        source_id: item.source_id,
        included: true,
      })),
    );
  }, [jobItemsQuery.data]);

  // ── Calculations ──
  const normalizedItems = useMemo<InvoiceItemInput[]>(
    () =>
      lines
        .filter((l) => l.included)
        .map((l) => ({
          description: l.description.trim(),
          qty: Number.isFinite(l.qty) ? l.qty : 0,
          unit_price_cents: Math.round((Number.isFinite(l.unitPrice) ? l.unitPrice : 0) * 100),
        }))
        .filter((l) => l.description && l.qty > 0),
    [lines],
  );

  const taxCents = Math.max(0, Math.round(taxDollars * 100));
  const discountCents = Math.max(0, Math.round(discountDollars * 100));
  const totals = useMemo(
    () =>
      calculateInvoiceTotals(
        normalizedItems.map((i) => ({ ...i, description: i.description })),
        taxCents,
        discountCents,
        detailQuery.data?.invoice?.paid_cents || 0,
      ),
    [normalizedItems, taxCents, discountCents, detailQuery.data?.invoice?.paid_cents],
  );

  // ── Line item helpers ──
  const updateLine = (id: string, patch: Partial<LineForm>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const removeLine = (id: string) =>
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.id !== id)));

  // ── Save ──
  async function handleSave() {
    if (!clientId) {
      toast.error(t.invoiceEdit.pleaseSelectAClient);
      return;
    }
    setSaving(true);
    try {
      let id = draftId;
      if (!id) {
        const draft = await createInvoiceDraft({
          clientId,
          subject: subject.trim() || null,
          dueDate: dueDate || null,
        });
        id = draft.id;
        setDraftId(id);
      }

      await saveInvoiceDraft({
        invoiceId: id!,
        subject: subject.trim() || null,
        dueDate: dueDate || null,
        taxCents,
        items: lines
          .filter((l) => l.included && l.description.trim())
          .map((l, i) => ({
            description: l.description.trim(),
            qty: Number.isFinite(l.qty) ? l.qty : 0,
            unit_price_cents: Math.round((Number.isFinite(l.unitPrice) ? l.unitPrice : 0) * 100),
            title: l.title.trim() || undefined,
            sort_order: i + 1,
            source_type: l.source_type || undefined,
            source_id: l.source_id || undefined,
          } as any)),
      });

      // Update extra fields that rpc_save_invoice_draft handles
      // (notes, internal_notes, discount_cents, template_id are in the enhanced RPC)

      queryClient.invalidateQueries({ queryKey: ['invoicesTable'] });
      queryClient.invalidateQueries({ queryKey: ['invoicesKpis30d'] });
      queryClient.invalidateQueries({ queryKey: ['invoiceDetails', id] });
      queryClient.invalidateQueries({ queryKey: ['invoiceEdit', id] });

      toast.success(t.invoiceEdit.invoiceSaved);

      if (isNew && id) {
        navigate(`/invoices/${id}/edit`, { replace: true });
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // ── Send ──
  async function handleSend() {
    if (!draftId) {
      toast.error('Please save the invoice first');
      return;
    }
    if (!clientEmail) {
      toast.error('Client has no email address');
      return;
    }
    setSending(true);
    try {
      await handleSave();
      await sendInvoice({
        invoiceId: draftId,
        channels: ['email'],
        toEmail: clientEmail,
      });
      queryClient.invalidateQueries({ queryKey: ['invoicesTable'] });
      queryClient.invalidateQueries({ queryKey: ['invoicesKpis30d'] });
      toast.success(t.invoiceDetails.invoiceSent);
      navigate(`/invoices/${draftId}`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  // ── Build preview data ──
  const previewData = useMemo(() => {
    const company = companyQuery.data;
    const tpl = templatesQuery.data?.find((t) => t.layout_type === layout);
    return buildRenderData(
      {
        invoice: {
          id: draftId || '',
          client_id: clientId,
          client_name: clientName || 'Client Name',
          invoice_number: detailQuery.data?.invoice?.invoice_number || 'INV-XXXXXX',
          status: detailQuery.data?.invoice?.status || 'draft',
          currency: 'CAD',
          subject: subject || null,
          issued_at: detailQuery.data?.invoice?.issued_at || null,
          due_date: dueDate || null,
          total_cents: totals.total_cents,
          balance_cents: totals.balance_cents,
          paid_cents: detailQuery.data?.invoice?.paid_cents || 0,
          subtotal_cents: totals.subtotal_cents,
          tax_cents: totals.tax_cents,
          paid_at: detailQuery.data?.invoice?.paid_at || null,
          created_at: detailQuery.data?.invoice?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
          notes,
          discount_cents: totals.discount_cents,
        } as any,
        client: {
          id: clientId,
          first_name: clientName.split(' ')[0] || '',
          last_name: clientName.split(' ').slice(1).join(' ') || '',
          company: null,
          email: clientEmail || null,
          phone: clientPhone || null,
        },
        items: lines
          .filter((l) => l.description.trim())
          .map((l) => ({
            id: l.id,
            description: l.description,
            title: l.title || undefined,
            qty: l.qty,
            unit_price_cents: Math.round(l.unitPrice * 100),
            line_total_cents: lineTotal(l.qty, Math.round(l.unitPrice * 100)),
            created_at: new Date().toISOString(),
          })),
      },
      company,
      tpl?.branding,
    );
  }, [
    clientId, clientName, clientEmail, clientPhone, subject, dueDate, notes,
    lines, totals, layout, companyQuery.data, templatesQuery.data, detailQuery.data,
  ]);

  const fmt = (cents: number) => formatMoneyFromCents(cents, 'CAD');

  // ── Client select (for new invoices) ──
  if (isNew && !clientId) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-6">
        <button type="button" onClick={() => navigate('/invoices')} className="glass-button inline-flex items-center gap-2">
          <ArrowLeft size={14} />
          {t.companySettings.back}
        </button>
        <div className="section-card p-6">
          <h2 className="text-xl font-bold text-text-primary">
            {t.invoiceEdit.newInvoiceSelectClient}
          </h2>
          <div className="relative mt-4">
            <input
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder={t.invoiceEdit.searchClients}
              className="glass-input w-full"
              autoFocus
            />
          </div>
          <div className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto">
            {clientsQuery.isLoading && <p className="text-sm text-text-secondary">Loading...</p>}
            {(clientsQuery.data?.items || []).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setClientId(c.id);
                  setClientName(c.name);
                  setClientEmail(c.email || '');
                }}
                className="w-full rounded-xl border border-outline-subtle bg-surface px-4 py-3 text-left transition hover:bg-surface-secondary"
              >
                <p className="text-sm font-semibold text-text-primary">{c.name}</p>
                <p className="text-xs text-text-secondary">{c.email || 'No email'}</p>
              </button>
            ))}
            {!clientsQuery.isLoading && (clientsQuery.data?.items || []).length === 0 && (
              <p className="py-4 text-center text-sm text-text-tertiary">No clients found</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main editor ──
  return (
    <div className="flex h-[calc(100vh-64px)] flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate(draftId ? `/invoices/${draftId}` : '/invoices')} className="glass-button !p-2">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-sm font-bold text-text-primary">
              {isNew ? (t.invoiceEdit.newInvoice) : detailQuery.data?.invoice?.invoice_number || 'Edit Invoice'}
            </h1>
            <p className="text-xs text-text-secondary">{clientName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className={`glass-button inline-flex items-center gap-1.5 !text-xs ${showPreview ? 'bg-primary/10 text-primary' : ''}`}
          >
            <Eye size={13} />
            {t.invoiceDetails.preview}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="glass-button inline-flex items-center gap-1.5 !text-xs"
          >
            <Save size={13} />
            {saving ? (t.invoiceEdit.saving) : (t.invoiceEdit.saveDraft)}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !clientEmail}
            className="glass-button-primary inline-flex items-center gap-1.5 !text-xs"
          >
            <Send size={13} />
            {sending ? (t.invoiceDetails.sending) : (t.invoiceDetails.sendInvoice)}
          </button>
        </div>
      </div>

      {/* Editor + Preview split */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: Editor */}
        <div className={`flex-1 overflow-y-auto p-5 ${showPreview ? 'max-w-[55%]' : ''}`}>
          <div className="mx-auto max-w-2xl space-y-6">
            {/* Subject & Due Date */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="space-y-1.5 lg:col-span-2">
                <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                  {t.invoiceEdit.subject}
                </label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={t.invoiceEdit.invoiceSubject}
                  className="glass-input w-full"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                  {language === 'fr' ? 'Date d\'échéance' : 'Due Date'}
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="glass-input w-full"
                />
              </div>
            </div>

            {/* Line Items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-text-primary">
                  {t.invoiceEdit.lineItems}
                </h3>
                <button
                  type="button"
                  onClick={() => setLines((prev) => [...prev, emptyLine()])}
                  className="glass-button inline-flex items-center gap-1.5 !px-2.5 !py-1.5 !text-xs"
                >
                  <Plus size={12} />
                  {t.invoiceEdit.addItem}
                </button>
              </div>

              {lines.map((line, idx) => (
                <div
                  key={line.id}
                  className={cn(
                    'grid grid-cols-12 gap-2 rounded-xl border p-2 transition-all',
                    line.included
                      ? 'border-outline-subtle bg-surface/60'
                      : 'border-outline-subtle/30 bg-surface/30 opacity-50'
                  )}
                >
                  <div className="col-span-5 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={line.included}
                      onChange={() => updateLine(line.id, { included: !line.included })}
                      className="h-4 w-4 shrink-0 rounded cursor-pointer accent-primary"
                      title={line.included ? 'Exclude from invoice' : 'Include in invoice'}
                    />
                    <input
                      value={line.description}
                      onChange={(e) => updateLine(line.id, { description: e.target.value })}
                      placeholder={t.automations.description}
                      className={cn('glass-input w-full text-sm', !line.included && 'line-through')}
                    />
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={line.qty}
                    onChange={(e) => updateLine(line.id, { qty: Number(e.target.value) || 0 })}
                    placeholder="Qty"
                    className="glass-input col-span-2 text-sm"
                  />
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={line.unitPrice}
                    onChange={(e) => updateLine(line.id, { unitPrice: Number(e.target.value) || 0 })}
                    placeholder="Price"
                    className="glass-input col-span-2 text-sm"
                  />
                  <div className={cn('col-span-2 flex items-center justify-end text-sm font-medium', line.included ? 'text-text-primary' : 'text-text-tertiary line-through')}>
                    {fmt(lineTotal(line.qty, Math.round(line.unitPrice * 100)))}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    disabled={lines.length === 1}
                    className="col-span-1 flex items-center justify-center text-text-tertiary hover:text-danger disabled:opacity-30"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Totals & Tax/Discount */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                    {t.invoiceEdit.discount}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={discountDollars}
                    onChange={(e) => setDiscountDollars(Number(e.target.value) || 0)}
                    className="glass-input w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                    {t.invoiceEdit.tax}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={taxDollars}
                    onChange={(e) => setTaxDollars(Number(e.target.value) || 0)}
                    className="glass-input w-full"
                  />
                </div>
              </div>
              <div className="rounded-xl border border-outline-subtle bg-surface-secondary p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-secondary">{t.invoiceEdit.subtotal}</span>
                  <span className="font-semibold">{fmt(totals.subtotal_cents)}</span>
                </div>
                {totals.discount_cents > 0 && (
                  <div className="mt-1 flex justify-between text-red-500">
                    <span>{t.invoiceEdit.discount2}</span>
                    <span>-{fmt(totals.discount_cents)}</span>
                  </div>
                )}
                <div className="mt-1 flex justify-between">
                  <span className="text-text-secondary">{t.invoiceEdit.tax2}</span>
                  <span className="font-semibold">{fmt(totals.tax_cents)}</span>
                </div>
                <div className="mt-2 flex justify-between border-t border-outline-subtle pt-2 text-base font-bold text-text-primary">
                  <span>Total</span>
                  <span>{fmt(totals.total_cents)}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                  {t.invoiceEdit.notesVisibleToClient}
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder={t.invoiceEdit.notesForTheClient}
                  className="glass-input w-full resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                  {t.invoiceEdit.internalNotes}
                </label>
                <textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  rows={3}
                  placeholder={t.invoiceEdit.internalNotesNotOnInvoice}
                  className="glass-input w-full resize-none"
                />
              </div>
            </div>

            {/* Template Picker */}
            <InvoiceTemplatePicker
              selectedLayout={layout}
              onSelect={(l, id) => {
                setLayout(l);
                if (id) setTemplateId(id);
              }}
              templates={templatesQuery.data}
            />
          </div>
        </div>

        {/* RIGHT: Live Preview */}
        {showPreview && (
          <div className="w-[45%] overflow-y-auto border-l border-border bg-gray-100 p-6">
            <div className="mx-auto max-w-[600px] rounded-xl bg-white p-8 shadow-lg">
              <InvoiceRenderer data={previewData} layout={layout} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
