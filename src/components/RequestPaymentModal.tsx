import React, { useState } from 'react';
import { toast } from 'sonner';
import { Copy, Check, Send, Loader2, Mail, MessageSquare, Link2 } from 'lucide-react';
import Modal from './ui/Modal';
import { createPaymentRequest } from '../lib/connectApi';
import { formatMoneyFromCents } from '../lib/invoicesApi';
import { useTranslation } from '../i18n';

type SendVia = 'link_only' | 'email' | 'sms' | 'both';

interface RequestPaymentModalProps {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  invoiceNumber: string;
  balanceCents: number;
  currency: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  onSuccess?: () => void;
}

export default function RequestPaymentModal({
  open, onClose, invoiceId, invoiceNumber, balanceCents, currency, clientEmail, clientPhone, onSuccess,
}: RequestPaymentModalProps) {
  const { t } = useTranslation();
  const m = t.requestPaymentModal;
  const [loading, setLoading] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [sendVia, setSendVia] = useState<SendVia>(clientEmail ? 'email' : 'link_only');
  const [notifications, setNotifications] = useState<any>(null);

  async function handleCreateRequest() {
    setLoading(true);
    try {
      const result = await createPaymentRequest(invoiceId, sendVia);
      const url = result.payment_request.payment_url;
      setPaymentUrl(url || null);
      setNotifications(result.notifications || null);

      if (sendVia === 'email' || sendVia === 'both') {
        toast.success(result.notifications?.email?.sent ? m.sentByEmail : m.linkCreatedEmailFailed);
      } else if (sendVia === 'sms') {
        toast.success(result.notifications?.sms?.sent ? m.sentBySms : m.linkCreatedSmsFailed);
      } else {
        toast.success(m.linkCreated);
      }
      onSuccess?.();
    } catch (err: any) {
      toast.error(err?.message || m.failed);
    } finally {
      setLoading(false);
    }
  }

  function handleCopyLink() {
    if (!paymentUrl) return;
    navigator.clipboard.writeText(paymentUrl).then(() => {
      setLinkCopied(true);
      toast.success(m.linkCopied);
    }).catch(() => toast.error('Failed to copy link'));
    setTimeout(() => setLinkCopied(false), 2000);
  }

  function handleClose() {
    setPaymentUrl(null);
    setLinkCopied(false);
    setNotifications(null);
    setSendVia(clientEmail ? 'email' : 'link_only');
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title={m.title} size="md">
      <div className="space-y-4">
        {/* Invoice summary */}
        <div className="rounded-lg border border-border-primary bg-surface-secondary p-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-secondary">{m.invoice}</span>
            <span className="text-[13px] font-medium text-text-primary">{invoiceNumber}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[13px] text-text-secondary">{m.amountDue}</span>
            <span className="text-[15px] font-bold text-text-primary">
              {formatMoneyFromCents(balanceCents, currency)}
            </span>
          </div>
        </div>

        {!paymentUrl ? (
          <>
            {/* Send method selection */}
            <div>
              <p className="text-[13px] font-medium text-text-primary mb-2">{m.howToSend}</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSendVia('link_only')}
                  className={`rounded-lg border p-3 text-left text-[12px] transition-colors ${
                    sendVia === 'link_only'
                      ? 'border-text-primary bg-surface-tertiary dark:bg-neutral-800/30 text-text-primary'
                      : 'border-border-primary hover:border-text-tertiary'
                  }`}
                >
                  <Link2 size={14} className="mb-1" />
                  <div className="font-medium">{m.copyLink}</div>
                  <div className="text-text-tertiary">{m.copyLinkDesc}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setSendVia('email')}
                  disabled={!clientEmail}
                  className={`rounded-lg border p-3 text-left text-[12px] transition-colors ${
                    sendVia === 'email'
                      ? 'border-text-primary bg-surface-tertiary dark:bg-neutral-800/30 text-text-primary'
                      : !clientEmail
                        ? 'border-border-primary opacity-40 cursor-not-allowed'
                        : 'border-border-primary hover:border-text-tertiary'
                  }`}
                >
                  <Mail size={14} className="mb-1" />
                  <div className="font-medium">{m.email}</div>
                  <div className="text-text-tertiary truncate">{clientEmail || m.noEmail}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setSendVia('sms')}
                  disabled={!clientPhone}
                  className={`rounded-lg border p-3 text-left text-[12px] transition-colors ${
                    sendVia === 'sms'
                      ? 'border-text-primary bg-surface-tertiary dark:bg-neutral-800/30 text-text-primary'
                      : !clientPhone
                        ? 'border-border-primary opacity-40 cursor-not-allowed'
                        : 'border-border-primary hover:border-text-tertiary'
                  }`}
                >
                  <MessageSquare size={14} className="mb-1" />
                  <div className="font-medium">{m.sms}</div>
                  <div className="text-text-tertiary truncate">{clientPhone || m.noPhone}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setSendVia('both')}
                  disabled={!clientEmail || !clientPhone}
                  className={`rounded-lg border p-3 text-left text-[12px] transition-colors ${
                    sendVia === 'both'
                      ? 'border-text-primary bg-surface-tertiary dark:bg-neutral-800/30 text-text-primary'
                      : !clientEmail || !clientPhone
                        ? 'border-border-primary opacity-40 cursor-not-allowed'
                        : 'border-border-primary hover:border-text-tertiary'
                  }`}
                >
                  <Send size={14} className="mb-1" />
                  <div className="font-medium">{m.emailAndSms}</div>
                  <div className="text-text-tertiary">{m.sendViaBoth}</div>
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className="glass-button" onClick={handleClose}>{m.cancel}</button>
              <button
                type="button"
                className="glass-button bg-primary text-white hover:bg-neutral-800 inline-flex items-center gap-2"
                onClick={handleCreateRequest}
                disabled={loading}
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {loading ? m.sending : sendVia === 'link_only' ? m.createLink : m.sendRequest}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Success state */}
            <div className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/30 p-4">
              <p className="text-[13px] font-medium text-neutral-800 dark:text-neutral-200">
                {m.requestCreated}
              </p>

              {notifications?.email?.sent && (
                <p className="mt-1 text-[12px] text-neutral-600 dark:text-neutral-400 flex items-center gap-1">
                  <Mail size={11} /> {m.emailSent}
                </p>
              )}
              {notifications?.sms?.sent && (
                <p className="mt-1 text-[12px] text-neutral-600 dark:text-neutral-400 flex items-center gap-1">
                  <MessageSquare size={11} /> {m.smsSent}
                </p>
              )}
              {notifications?.email && !notifications.email.sent && (
                <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
                  {m.emailFailed}: {notifications.email.reason}
                </p>
              )}
              {notifications?.sms && !notifications.sms.sent && (
                <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
                  {m.smsFailed}: {notifications.sms.reason}
                </p>
              )}

              <div className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={paymentUrl}
                  className="glass-input flex-1 text-[12px] font-mono"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  className="glass-button inline-flex items-center gap-1.5 shrink-0"
                  onClick={handleCopyLink}
                >
                  {linkCopied ? <Check size={14} /> : <Copy size={14} />}
                  {linkCopied ? m.copied : m.copy}
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className="glass-button" onClick={handleClose}>{m.done}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
