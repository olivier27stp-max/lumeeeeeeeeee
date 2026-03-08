import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FileText, Send, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  formatMoneyFromCents,
  getInvoiceById,
  getOrgBillingSettings,
  listInvoiceTemplates,
  saveInvoiceDraft,
  sendInvoice,
} from '../lib/invoicesApi';

interface InvoicePreviewModalProps {
  isOpen: boolean;
  invoiceId: string | null;
  onClose: () => void;
  onSent?: () => void | Promise<void>;
}

export default function InvoicePreviewModal({ isOpen, invoiceId, onClose, onSent }: InvoicePreviewModalProps) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getInvoiceById>>>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [billingSettings, setBillingSettings] = useState<any>(null);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [emailTo, setEmailTo] = useState('');
  const [phoneTo, setPhoneTo] = useState('');

  useEffect(() => {
    if (!isOpen || !invoiceId) return;
    setLoading(true);
    Promise.all([getInvoiceById(invoiceId), listInvoiceTemplates(), getOrgBillingSettings()])
      .then(([invoiceDetail, templateRows, settings]) => {
        setDetail(invoiceDetail);
        setTemplates(templateRows || []);
        setBillingSettings(settings || null);
        setEmailTo(invoiceDetail?.client?.email || '');
        setPhoneTo(invoiceDetail?.client?.phone || '');
        setEmailEnabled(Boolean(invoiceDetail?.client?.email));
        setSmsEnabled(Boolean(invoiceDetail?.client?.phone));
      })
      .catch((error: any) => {
        toast.error(error?.message || 'Failed to load invoice preview.');
      })
      .finally(() => setLoading(false));
  }, [invoiceId, isOpen]);

  const taxCents = detail?.invoice?.tax_cents || 0;
  const subtotalCents = detail?.invoice?.subtotal_cents || 0;
  const totalCents = detail?.invoice?.total_cents || 0;
  const companyName = String(billingSettings?.company_name || 'Lume').trim() || 'Lume';

  const channels = useMemo(() => {
    const next: string[] = [];
    if (emailEnabled && emailTo.trim()) next.push('email');
    if (smsEnabled && phoneTo.trim()) next.push('sms');
    return next;
  }, [emailEnabled, emailTo, phoneTo, smsEnabled]);

  async function handleTemplateApply(templateId: string) {
    setSelectedTemplateId(templateId);
    const selected = templates.find((template) => template.id === templateId);
    if (!selected || !detail?.invoice?.id) return;
    const content = selected.content || {};
    const items = Array.isArray(content.items) ? content.items : [];
    const tax = Number(content.tax_cents || content.tax || taxCents || 0);
    try {
      await saveInvoiceDraft({
        invoiceId: detail.invoice.id,
        subject: content.subject || detail.invoice.subject || null,
        dueDate: detail.invoice.due_date || null,
        taxCents: tax,
        items: items.map((item: any) => ({
          description: String(item.description || ''),
          qty: Number(item.qty || 1),
          unit_price_cents: Number(item.unit_price_cents || 0),
        })),
      });
      const refreshed = await getInvoiceById(detail.invoice.id);
      setDetail(refreshed);
      toast.success('Template applied to invoice draft.');
    } catch (error: any) {
      toast.error(error?.message || 'Unable to apply template.');
    }
  }

  async function handleImportTemplate(file: File) {
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      if (!detail?.invoice?.id) return;
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      await saveInvoiceDraft({
        invoiceId: detail.invoice.id,
        subject: parsed.subject || detail.invoice.subject || null,
        dueDate: detail.invoice.due_date || null,
        taxCents: Number(parsed.tax_cents || parsed.tax || 0),
        items: items.map((item: any) => ({
          description: String(item.description || ''),
          qty: Number(item.qty || 1),
          unit_price_cents: Number(item.unit_price_cents || 0),
        })),
      });
      const refreshed = await getInvoiceById(detail.invoice.id);
      setDetail(refreshed);
      toast.success('Template imported.');
    } catch (error: any) {
      toast.error(error?.message || 'Invalid template file.');
    }
  }

  async function handleSend() {
    if (!detail?.invoice?.id || sending) return;
    if (channels.length === 0) {
      toast.info('No email/phone available. Copy payment link fallback.');
    }
    setSending(true);
    try {
      const result = await sendInvoice({
        invoiceId: detail.invoice.id,
        channels,
        toEmail: emailTo,
        toPhone: phoneTo,
      });
      toast.success('Invoice sent.');
      if (result.payment_link && channels.length === 0) {
        await navigator.clipboard.writeText(result.payment_link);
        toast.info('Payment link copied.');
      }
      await onSent?.();
      onClose();
    } catch (error: any) {
      toast.error(error?.message || 'Unable to send invoice.');
    } finally {
      setSending(false);
    }
  }

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="modal-content max-h-[92vh] w-full max-w-5xl overflow-y-auto" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}>
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-2">
                <FileText size={18} />
                <h3 className="text-2xl font-semibold tracking-tight">Invoice Preview</h3>
              </div>
              <button onClick={onClose} className="rounded-lg p-2 hover:bg-surface-secondary"><X size={16} /></button>
            </div>

            {loading ? <p className="mt-4 text-sm text-text-secondary">Loading preview...</p> : null}

            {!loading && detail ? (
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="space-y-4 lg:col-span-2">
                  <div className="rounded-2xl border border-border bg-gradient-to-br from-surface to-surface-secondary p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-text-tertiary">From</p>
                        <p className="text-xl font-semibold text-text-primary">{companyName}</p>
                        <p className="text-sm text-text-secondary">{billingSettings?.address || 'No company address set'}</p>
                      </div>
                      <span className="rounded-full border border-success bg-success-light px-2.5 py-1 text-xs font-medium text-success">
                        {String(detail.invoice.status || 'draft').toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-surface/70 p-4">
                    <p className="text-xs uppercase tracking-widest text-text-tertiary">To</p>
                    <p className="font-semibold">{detail.invoice.client_name}</p>
                    <p className="text-sm text-text-secondary">{detail.client?.email || 'No email'} | {detail.client?.phone || 'No phone'}</p>
                  </div>

                  <div className="rounded-xl border border-border bg-surface/70 p-4">
                    <p className="text-sm font-semibold">Items</p>
                    <div className="mt-2 space-y-2">
                      {detail.items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between text-sm">
                          <span>{item.description} ({item.qty} x {formatMoneyFromCents(item.unit_price_cents)})</span>
                          <span className="font-medium">{formatMoneyFromCents(item.line_total_cents)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 space-y-1 border-t border-black/10 pt-2 text-sm">
                      <p className="flex items-center justify-between"><span>Subtotal</span><span>{formatMoneyFromCents(subtotalCents)}</span></p>
                      <p className="flex items-center justify-between"><span>Taxes</span><span>{formatMoneyFromCents(taxCents)}</span></p>
                      <p className="flex items-center justify-between text-base font-semibold"><span>Total</span><span>{formatMoneyFromCents(totalCents)}</span></p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2 rounded-xl border border-border bg-surface/70 p-4">
                    <p className="text-sm font-semibold">Template</p>
                    <select value={selectedTemplateId} onChange={(event) => void handleTemplateApply(event.target.value)} className="glass-input w-full">
                      <option value="">Select template</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>{template.name}</option>
                      ))}
                    </select>
                    <label className="glass-button inline-flex cursor-pointer items-center gap-2">
                      <Upload size={14} />
                      Import template
                      <input
                        type="file"
                        accept="application/json"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void handleImportTemplate(file);
                        }}
                      />
                    </label>
                  </div>

                  <div className="space-y-3 rounded-xl border border-border bg-surface/70 p-4">
                    <p className="text-sm font-semibold">Send channels</p>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={emailEnabled} onChange={(event) => setEmailEnabled(event.target.checked)} />
                      Email
                    </label>
                    <input value={emailTo} onChange={(event) => setEmailTo(event.target.value)} className="glass-input w-full" placeholder="Client email" />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={smsEnabled} onChange={(event) => setSmsEnabled(event.target.checked)} />
                      SMS
                    </label>
                    <input value={phoneTo} onChange={(event) => setPhoneTo(event.target.value)} className="glass-input w-full" placeholder="Client phone" />
                    <button onClick={() => void handleSend()} className="glass-button-primary inline-flex w-full items-center justify-center gap-2" disabled={sending}>
                      <Send size={14} />
                      {sending ? 'Sending...' : 'Send invoice'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
