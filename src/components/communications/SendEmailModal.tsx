import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Mail, Paperclip, Send, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { sendEmail } from '../../lib/communicationsApi';

interface SendEmailModalProps {
  /** Pre-filled recipient email */
  email?: string | null;
  /** Pre-filled subject */
  defaultSubject?: string;
  /** Pre-filled body */
  defaultBody?: string;
  /** Reply-to address (user's email) */
  replyTo?: string;
  /** Link to client */
  clientId?: string | null;
  /** Link to job */
  jobId?: string | null;
  /** Client display name */
  clientName?: string;
  /** Close handler */
  onClose: () => void;
  /** Callback after successful send */
  onSent?: () => void;
}

export default function SendEmailModal({
  email,
  defaultSubject = '',
  defaultBody = '',
  replyTo,
  clientId,
  jobId,
  clientName,
  onClose,
  onSent,
}: SendEmailModalProps) {
  const [to, setTo] = useState(email || '');
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [sendCopy, setSendCopy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Attachment sections (UI-ready, not wired to backend yet)
  const [jobAttOpen, setJobAttOpen] = useState(false);
  const [clientAttOpen, setClientAttOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const totalSizeMB = attachedFiles.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
  const canSend = isEmailValid && subject.trim().length > 0 && body.trim().length > 0 && !sending && !sent;

  const handleSend = async () => {
    if (!to.trim() || !subject.trim() || !body.trim()) {
      toast.error('All fields are required.');
      return;
    }
    setSending(true);
    try {
      await sendEmail({
        to: to.trim(),
        subject: subject.trim(),
        body: body.trim(),
        client_id: clientId || null,
        job_id: jobId || null,
        reply_to: replyTo,
      });
      setSent(true);
      toast.success('Email sent');
      onSent?.();
      setTimeout(() => onClose(), 1500);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files);
    setAttachedFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const removeFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Drag & drop handlers
  const [dragOver, setDragOver] = useState(false);
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  };

  return (
    <div className="flex flex-col max-h-[85vh]">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
        <h3 className="text-[16px] font-bold text-text-primary">
          Email booking confirmation{clientName ? ` to ${clientName}` : ''}
        </h3>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg border border-transparent text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary hover:border-outline-subtle transition-all"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Body: two-column on desktop ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col lg:flex-row">
          {/* Left column: email form (wider) */}
          <div className="flex-[3] px-6 py-5 space-y-4 border-b lg:border-b-0 lg:border-r border-outline min-w-0">
            {/* To */}
            <div>
              <label className="text-[12px] font-semibold text-text-secondary mb-1.5 block">To</label>
              <div className="glass-input w-full flex items-center gap-2 flex-wrap min-h-[34px]">
                {to.trim() && isEmailValid ? (
                  <span className="inline-flex items-center gap-1 bg-surface-tertiary text-text-primary text-[12px] font-medium rounded px-2 py-0.5">
                    {to.trim()}
                    <button
                      onClick={() => setTo('')}
                      className="text-text-tertiary hover:text-text-primary ml-0.5"
                      disabled={sent}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ) : (
                  <input
                    type="email"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="client@example.com"
                    className="flex-1 bg-transparent outline-none text-[13px] text-text-primary placeholder:text-text-tertiary min-w-[120px]"
                    disabled={sent}
                    autoFocus
                  />
                )}
              </div>
              {to.trim().length > 0 && !isEmailValid && (
                <p className="text-[11px] text-danger mt-1">Enter a valid email address</p>
              )}
            </div>

            {/* Subject */}
            <div>
              <label className="text-[12px] font-semibold text-text-secondary mb-1.5 block">Subject</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="glass-input w-full"
                disabled={sent}
                placeholder="Email subject"
              />
            </div>

            {/* Body */}
            <div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                className="glass-input w-full resize-none leading-relaxed"
                disabled={sent}
                placeholder="Write your message..."
              />
            </div>

            {/* Send me a copy */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={sendCopy}
                onChange={(e) => setSendCopy(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-outline text-primary accent-primary"
                disabled={sent}
              />
              <span className="text-[12px] text-text-secondary">Send me a copy</span>
            </label>

            {/* Helper text */}
            <p className="text-[11px] text-text-tertiary">
              Your client will see a button to view the schedule and location of their upcoming appointments in their client hub.
            </p>
          </div>

          {/* Right column: attachments */}
          <div className="flex-[2] px-6 py-5 space-y-4 min-w-0">
            <h4 className="text-[13px] font-semibold text-text-primary">Attachments</h4>

            {/* Drop zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`rounded-lg border-2 border-dashed transition-colors p-4 text-center ${
                dragOver
                  ? 'border-primary bg-primary-lighter'
                  : 'border-outline hover:border-text-tertiary'
              }`}
            >
              <Upload size={18} className="mx-auto mb-2 text-text-tertiary" />
              <p className="text-[12px] text-text-tertiary mb-2">Drag your files here or</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="glass-button text-[12px] inline-flex items-center gap-1.5"
                disabled={sent}
              >
                <Paperclip size={12} />
                Select a File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files)}
              />
            </div>

            {/* Attached files list */}
            {attachedFiles.length > 0 && (
              <div className="space-y-1.5">
                {attachedFiles.map((file, i) => (
                  <div key={i} className="flex items-center justify-between px-2.5 py-1.5 bg-surface-secondary rounded border border-outline-subtle text-[12px]">
                    <span className="text-text-primary truncate mr-2">{file.name}</span>
                    <button onClick={() => removeFile(i)} className="text-text-tertiary hover:text-danger shrink-0">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Job attachments */}
            <button
              onClick={() => setJobAttOpen(!jobAttOpen)}
              className="w-full flex items-center justify-between py-2 px-3 rounded-lg border border-outline hover:bg-surface-secondary transition-colors text-[13px]"
            >
              <span className="text-text-primary font-medium">Job attachments</span>
              <span className="flex items-center gap-1.5 text-text-tertiary">
                <span className="bg-surface-tertiary text-text-secondary text-xs font-medium rounded-full w-5 h-5 inline-flex items-center justify-center">0</span>
                {jobAttOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </span>
            </button>
            {jobAttOpen && (
              <p className="text-[11px] text-text-tertiary px-3">No job attachments available.</p>
            )}

            {/* Client attachments */}
            <button
              onClick={() => setClientAttOpen(!clientAttOpen)}
              className="w-full flex items-center justify-between py-2 px-3 rounded-lg border border-outline hover:bg-surface-secondary transition-colors text-[13px]"
            >
              <span className="text-text-primary font-medium">Client attachments</span>
              <span className="flex items-center gap-1.5 text-text-tertiary">
                <span className="bg-surface-tertiary text-text-secondary text-xs font-medium rounded-full w-5 h-5 inline-flex items-center justify-center">0</span>
                {clientAttOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </span>
            </button>
            {clientAttOpen && (
              <p className="text-[11px] text-text-tertiary px-3">No client attachments available.</p>
            )}

            {/* Size indicator */}
            <p className="text-[11px] text-text-tertiary">
              You've attached {totalSizeMB.toFixed(2)} MB out of the 10 MB limit
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
          <span className="inline-flex items-center gap-1.5 text-[13px] text-success font-semibold px-3 py-1.5">
            <CheckCircle2 size={15} /> Sent
          </span>
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
                Send Email
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
