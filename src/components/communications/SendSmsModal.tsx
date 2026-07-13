import React, { useEffect, useState } from 'react';
import { CheckCircle2, MessageSquare, Send, X } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { sendSms } from '../../lib/communicationsApi';
import { useTranslation } from '../../i18n';

/** Public client-approval document of the job (converted quote or agreement). */
export interface ApprovalLink {
  url: string;
  kind: 'agreement' | 'quote';
}

interface SendSmsModalProps {
  /** Pre-filled phone number */
  phone?: string | null;
  /** Pre-filled message body */
  defaultBody?: string;
  /** Link to client */
  clientId?: string | null;
  /** Link to job */
  jobId?: string | null;
  /** Client display name */
  clientName?: string;
  /** Company / org name */
  companyName?: string;
  /** Property address */
  propertyAddress?: string | null;
  /** Scheduled date (formatted) */
  scheduledDate?: string | null;
  /** When set, offers a checkbox to append the client-approval link */
  approvalLink?: ApprovalLink | null;
  /** Close handler */
  onClose: () => void;
  /** Callback after successful send */
  onSent?: () => void;
}

export default function SendSmsModal({
  phone,
  defaultBody = '',
  clientId,
  jobId,
  clientName,
  companyName,
  propertyAddress,
  scheduledDate,
  approvalLink,
  onClose,
  onSent,
}: SendSmsModalProps) {
  const { language } = useTranslation();
  const [to, setTo] = useState(phone || '');
  const [body, setBody] = useState(defaultBody);
  const [includeApproval, setIncludeApproval] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Client-approval link (converted quote or agreement) appended on demand.
  const approvalDocLabel = approvalLink?.kind === 'quote'
    ? (language === 'fr' ? 'soumission' : 'quote')
    : (language === 'fr' ? 'contrat' : 'agreement');
  const approvalText = approvalLink
    ? (language === 'fr'
        ? `Consultez et approuvez votre ${approvalDocLabel} ici : ${approvalLink.url}`
        : `View and approve your ${approvalDocLabel} here: ${approvalLink.url}`)
    : '';

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const isPhoneValid = to.trim().length >= 7;
  const canSend = isPhoneValid && body.trim().length > 0 && !sending && !sent;

  const handleSend = async () => {
    if (!to.trim() || !body.trim()) {
      toast.error('Phone number and message are required.');
      return;
    }
    setSending(true);
    try {
      const finalBody = includeApproval && approvalLink
        ? `${body.trim()}\n\n${approvalText}`
        : body.trim();
      await sendSms({
        to: to.trim(),
        body: finalBody,
        client_id: clientId || null,
        job_id: jobId || null,
      });
      setSent(true);
      toast.success('SMS sent');
      onSent?.();
      setTimeout(() => onClose(), 1500);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send SMS');
    } finally {
      setSending(false);
    }
  };

  // Build preview lines from body text
  const previewLines = body.trim().split('\n').filter(Boolean);

  return (
    <div className="flex flex-col max-h-[85vh]">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
        <h3 className="text-[16px] font-bold text-text-primary">
          Text booking confirmation{clientName ? ` to ${clientName}` : ''}
        </h3>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg border border-transparent text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary hover:border-outline-subtle transition-all"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* To field */}
        <div>
          <label className="text-[12px] font-semibold text-text-secondary mb-1.5 block">To</label>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Type a mobile number"
            className="glass-input w-full"
            disabled={sent}
            autoFocus
          />
          {to.trim().length > 0 && !isPhoneValid && (
            <p className="text-[11px] text-danger mt-1">Enter a valid phone number</p>
          )}
        </div>

        {/* Two-column layout on desktop */}
        <div className="flex flex-col lg:flex-row gap-5">
          {/* Left: Message editor */}
          <div className="flex-1 min-w-0">
            <label className="text-[12px] font-semibold text-text-secondary mb-1.5 block">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              className="glass-input w-full resize-none leading-relaxed"
              disabled={sent}
              placeholder="Type your message..."
            />
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[11px] text-text-tertiary">
                {body.length} / 1,600
              </span>
            </div>

            {/* Client approval link (converted quote or agreement) */}
            {approvalLink && (
              <label className="flex items-start gap-2 cursor-pointer select-none mt-3">
                <input
                  type="checkbox"
                  checked={includeApproval}
                  onChange={(e) => setIncludeApproval(e.target.checked)}
                  className="w-3.5 h-3.5 mt-0.5 rounded border-outline text-primary accent-primary"
                  disabled={sent}
                />
                <span className="min-w-0">
                  <span className="text-[12px] text-text-secondary block">
                    {language === 'fr'
                      ? `Inclure le lien d’approbation client (${approvalDocLabel})`
                      : `Include the client approval link (${approvalDocLabel})`}
                  </span>
                  <span className="text-[11px] text-text-tertiary block truncate">{approvalLink.url}</span>
                </span>
              </label>
            )}
          </div>

          {/* Right: Preview card */}
          <div className="flex-1 min-w-0">
            <label className="text-[12px] font-semibold text-text-secondary mb-1.5 block">Preview</label>
            <div className="rounded-lg border border-outline bg-primary-lighter p-4 space-y-2 min-h-[160px]">
              {previewLines.length > 0 ? (
                <div className="text-[13px] text-text-primary leading-relaxed whitespace-pre-line">
                  {body.trim()}
                </div>
              ) : (
                <p className="text-[12px] text-text-tertiary italic">Your message preview will appear here</p>
              )}

              {/* Injected job details */}
              {(propertyAddress || scheduledDate || (includeApproval && approvalLink)) && previewLines.length > 0 && (
                <div className="pt-2 mt-2 border-t border-outline-subtle space-y-1">
                  {propertyAddress && (
                    <p className="text-[12px] text-text-secondary flex items-start gap-1.5">
                      <span className="text-text-tertiary mt-px shrink-0">📍</span>
                      {propertyAddress}
                    </p>
                  )}
                  {scheduledDate && (
                    <p className="text-[12px] text-text-secondary flex items-start gap-1.5">
                      <span className="text-text-tertiary mt-px shrink-0">📅</span>
                      {scheduledDate}
                    </p>
                  )}
                  {includeApproval && approvalLink && (
                    <p className="text-[12px] text-text-secondary flex items-start gap-1.5 min-w-0">
                      <span className="text-text-tertiary mt-px shrink-0">✍️</span>
                      <span className="min-w-0 break-all">{approvalText}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
            <p className="text-[11px] text-text-tertiary mt-1.5">
              Your client can view the schedule and location of their upcoming appointments in their client hub.
            </p>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-outline bg-surface">
        <button onClick={onClose} className="glass-button">
          Cancel
        </button>
        {sent ? (
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-flex items-center gap-1.5 text-[13px] text-success font-semibold px-3 py-1.5"
          >
            <CheckCircle2 size={15} /> Sent
          </motion.span>
        ) : (
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="glass-button-primary inline-flex items-center gap-2"
          >
            {sending ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-surface/30 border-t-surface rounded-full animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send size={14} />
                Send
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
