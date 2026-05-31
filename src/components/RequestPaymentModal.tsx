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
        if (result.notifications?.email?.sent) {
          toast.success(t.requestPayment.toastSentByEmail);
        } else {
          toast.success(t.requestPayment.toastLinkCreatedEmailFailed);
        }
      } else if (sendVia === 'sms') {
        if (result.notifications?.sms?.sent) {
          toast.success(t.requestPayment.toastSentBySms);
        } else {
          toast.success(t.requestPayment.toastLinkCreatedSmsFailed);
        }
      } else {
        toast.success(t.requestPayment.toastLinkCreated);
      }
      onSuccess?.();
    } catch (err: any) {
      toast.error(err?.message || t.requestPayment.toastCreateFailed);
    } finally {
      setLoading(false);
    }
  }

  function handleCopyLink() {
    if (!paymentUrl) return;
    navigator.clipboard.writeText(paymentUrl);
    setLinkCopied(true);
    toast.success(t.requestPayment.toastLinkCopied);
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
    <Modal open={open} onClose={handleClose} title={t.requestPayment.title} size="md">
      <div className="space-y-4">
        {/* Invoice summary */}
        <div className="rounded-lg border border-border-primary bg-surface-secondary p-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-secondary">{t.requestPayment.invoice}</span>
            <span className="text-[13px] font-medium text-text-primary">{invoiceNumber}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[13px] text-text-secondary">{t.requestPayment.amountDue}</span>
            <span className="text-[15px] font-bold text-text-primary">
              {formatMoneyFromCents(balanceCents, currency)}
            </span>
          </div>
        </div>

        {!paymentUrl ? (
          <>
            {/* Send method selection */}
            <div>
              <p className="text-[13px] font-medium text-text-primary mb-2">{t.requestPayment.howToSend}</p>
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
                  <div className="font-medium">{t.requestPayment.copyLink}</div>
                  <div className="text-text-tertiary">{t.requestPayment.copyLinkDesc}</div>
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
                  <div className="font-medium">{t.requestPayment.email}</div>
                  <div className="text-text-tertiary truncate">{clientEmail || t.requestPayment.noEmail}</div>
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
                  <div className="font-medium">{t.requestPayment.sms}</div>
                  <div className="text-text-tertiary truncate">{clientPhone || t.requestPayment.noPhone}</div>
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
                  <div className="font-medium">{t.requestPayment.emailAndSms}</div>
                  <div className="text-text-tertiary">{t.requestPayment.emailAndSmsDesc}</div>
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className="glass-button" onClick={handleClose}>{t.requestPayment.cancel}</button>
              <button
                type="button"
                className="glass-button bg-text-primary text-surface hover:bg-neutral-800 inline-flex items-center gap-2"
                onClick={handleCreateRequest}
                disabled={loading}
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {loading ? t.requestPayment.sending : sendVia === 'link_only' ? t.requestPayment.createPaymentLink : t.requestPayment.sendPaymentRequest}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Success state */}
            <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-4">
              <p className="text-[13px] font-medium text-green-800 dark:text-green-300">
                {t.requestPayment.requestCreated}
              </p>

              {/* Notification results */}
              {notifications?.email?.sent && (
                <p className="mt-1 text-[12px] text-green-700 dark:text-green-400 flex items-center gap-1">
                  <Mail size={11} /> {t.requestPayment.emailSentToClient}
                </p>
              )}
              {notifications?.sms?.sent && (
                <p className="mt-1 text-[12px] text-green-700 dark:text-green-400 flex items-center gap-1">
                  <MessageSquare size={11} /> {t.requestPayment.smsSentToClient}
                </p>
              )}
              {notifications?.email && !notifications.email.sent && (
                <p className="mt-1 text-[12px] text-amber-600 dark:text-amber-400">
                  {t.requestPayment.emailNotSent}: {notifications.email.reason}
                </p>
              )}
              {notifications?.sms && !notifications.sms.sent && (
                <p className="mt-1 text-[12px] text-amber-600 dark:text-amber-400">
                  {t.requestPayment.smsNotSent}: {notifications.sms.reason}
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
                  {linkCopied ? t.requestPayment.copied : t.requestPayment.copy}
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className="glass-button" onClick={handleClose}>{t.requestPayment.done}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
