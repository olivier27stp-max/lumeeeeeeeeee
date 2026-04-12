import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FileText, Send, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import {
  formatMoneyFromCents,
  getCompanySettings,
  getInvoiceById,
  getOrgBillingSettings,
  saveInvoiceDraft,
  sendInvoice,
} from '../lib/invoicesApi';
import InvoiceRenderer from './invoice/InvoiceRenderer';
import { buildRenderData } from './invoice/buildRenderData';

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
  const [billingSettings, setBillingSettings] = useState<any>(null);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [emailTo, setEmailTo] = useState('');
  const [phoneTo, setPhoneTo] = useState('');
  const [company, setCompany] = useState<any>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (!isOpen || !invoiceId) return;
    setLoading(true);
    Promise.all([getInvoiceById(invoiceId), getOrgBillingSettings(), getCompanySettings()])
      .then(([invoiceDetail, settings, companyInfo]) => {
        setDetail(invoiceDetail);
        setBillingSettings(settings || null);
        setCompany(companyInfo || null);
        setEmailTo(invoiceDetail?.client?.email || '');
        setPhoneTo(invoiceDetail?.client?.phone || '');
        setEmailEnabled(Boolean(invoiceDetail?.client?.email));
        setSmsEnabled(Boolean(invoiceDetail?.client?.phone));
      })
      .catch((error: any) => {
        toast.error(error?.message || t.modals.failedLoadPreview);
      })
      .finally(() => setLoading(false));
  }, [invoiceId, isOpen]);

  const renderData = useMemo(() => {
    if (!detail) return null;
    return buildRenderData(detail, company);
  }, [detail, company]);

  async function handleSend() {
    if (!detail || !invoiceId) return;
    const channels: ('email' | 'sms')[] = [];
    if (emailEnabled && emailTo) channels.push('email');
    if (smsEnabled && phoneTo) channels.push('sms');
    if (channels.length === 0) {
      toast.error('Please select at least one channel');
      return;
    }
    setSending(true);
    try {
      await sendInvoice({ invoiceId, channels, toEmail: emailTo || undefined, toPhone: phoneTo || undefined });
      toast.success(t.modals.invoiceSent);
      onSent?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send invoice');
    } finally {
      setSending(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        className="modal-content max-w-5xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-surface border-b border-outline px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText size={18} className="text-primary" />
            <h3 className="text-2xl font-semibold tracking-tight">{t.modals.invoicePreview}</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-surface-secondary"><X size={16} /></button>
        </div>

        {loading ? <p className="mt-4 text-sm text-text-secondary px-6">{t.modals.loadingPreview}</p> : null}

        {!loading && detail && renderData ? (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3 px-6 pb-6">
            {/* Visual Invoice Preview */}
            <div className="lg:col-span-2">
              <div className="rounded-xl bg-gray-100 p-4">
                <div className="mx-auto max-w-[540px] rounded-lg bg-white p-6 shadow-md">
                  <InvoiceRenderer data={renderData} />
                </div>
              </div>
            </div>

            {/* Sidebar controls */}
            <div className="space-y-4">
              {/* Send options */}
              <div className="space-y-3 rounded-xl border border-border bg-surface/70 p-4">
                <p className="text-sm font-semibold">Send Options</p>

                {/* Email toggle */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={emailEnabled} onChange={(e) => setEmailEnabled(e.target.checked)} className="rounded accent-primary" />
                  <span className="text-sm">Email</span>
                </label>
                {emailEnabled && (
                  <input value={emailTo} onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="Email" className="glass-input w-full text-sm" />
                )}

                {/* SMS toggle */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={smsEnabled} onChange={(e) => setSmsEnabled(e.target.checked)} className="rounded accent-primary" />
                  <span className="text-sm">SMS</span>
                </label>
                {smsEnabled && (
                  <input value={phoneTo} onChange={(e) => setPhoneTo(e.target.value)}
                    placeholder="Phone" className="glass-input w-full text-sm" />
                )}

                <button
                  onClick={handleSend}
                  disabled={sending || (!emailEnabled && !smsEnabled)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
                >
                  <Send size={14} />
                  {sending ? 'Sending...' : 'Send Invoice'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}
