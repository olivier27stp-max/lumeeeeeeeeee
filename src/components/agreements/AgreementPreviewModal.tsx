import React, { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, Link as LinkIcon, Loader2, Mail, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import type { Job } from '../../types';
import type { JobLineItem } from '../../lib/jobsApi';
import type { JobAgreement } from '../../lib/jobAgreementsApi';
import { sendAgreementEmail } from '../../lib/jobAgreementsApi';
import { buildAgreementDocData, getAgreementCompanyBranding, type AgreementCompanyBranding } from '../../lib/agreementDoc';
import { downloadAgreementPdf } from '../../lib/generateAgreementPdf';
import AgreementDocument from './AgreementDocument';

interface AgreementPreviewModalProps {
  open: boolean;
  onClose: () => void;
  agreement: JobAgreement;
  job: Job;
  lineItems: JobLineItem[];
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  /** Called after a successful email send (status moves to `sent`). */
  onSent?: () => void;
}

/** Preview & send modal for the job contract (same spirit as InvoicePreviewModal). */
export default function AgreementPreviewModal({
  open,
  onClose,
  agreement,
  job,
  lineItems,
  clientName,
  clientEmail,
  clientPhone,
  onSent,
}: AgreementPreviewModalProps) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [company, setCompany] = useState<AgreementCompanyBranding | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    getAgreementCompanyBranding().then(setCompany).catch(() => {
      setCompany({ company_name: 'Business', logo_url: null, phone: null, email: null, website: null, address: null, taxLines: [] });
    });
  }, [open]);

  const docData = useMemo(() => {
    if (!company) return null;
    return buildAgreementDocData({ agreement, job, lineItems, company, clientName, clientEmail, clientPhone });
  }, [company, agreement, job, lineItems, clientName, clientEmail, clientPhone]);

  if (!open) return null;

  const handleSend = async () => {
    setSending(true);
    try {
      await sendAgreementEmail(agreement.id);
      toast.success(fr ? 'Contrat envoyé par courriel.' : 'Contract sent by email.');
      onSent?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || (fr ? "Échec de l'envoi du contrat." : 'Failed to send the contract.'));
    } finally {
      setSending(false);
    }
  };

  const copySignatureLink = () => {
    const url = `${window.location.origin}/contract/${agreement.view_token}`;
    navigator.clipboard.writeText(url)
      .then(() => toast.success(fr ? 'Lien de signature copié.' : 'Signature link copied.'))
      .catch(() => toast.error(fr ? 'Impossible de copier le lien.' : 'Could not copy the link.'));
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-surface-card rounded-2xl border border-outline shadow-xl w-full max-w-[720px] max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-outline-subtle flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-bold tracking-tight text-text-primary">
              {(fr ? 'Contrat' : 'Contract') + (clientName ? ` — ${clientName}` : '')}
            </h3>
            <p className="text-[12.5px] text-text-tertiary mt-0.5">
              {fr ? 'Prévisualisez et envoyez le contrat PDF.' : 'Preview and send the contract PDF.'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Document */}
        <div className="flex-1 overflow-y-auto bg-surface-secondary p-5">
          {docData ? (
            <AgreementDocument data={docData} language={language} />
          ) : (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-outline-subtle flex flex-wrap gap-2">
          <button
            onClick={() => window.open(`/contract/${agreement.view_token}`, '_blank')}
            className="glass-button !py-2.5 !px-4 inline-flex items-center gap-2 text-[13px]"
          >
            <ExternalLink size={14} />
            {fr ? 'Ouvrir la vue client' : 'Open client view'}
          </button>
          <button
            onClick={() => docData && downloadAgreementPdf(docData)}
            disabled={!docData}
            className="glass-button !py-2.5 !px-4 inline-flex items-center gap-2 text-[13px] disabled:opacity-50"
          >
            <Download size={14} />
            {fr ? 'Télécharger' : 'Download'}
          </button>
          {agreement.require_signature && agreement.status !== 'signed' && (
            <button
              onClick={copySignatureLink}
              className="glass-button !py-2.5 !px-4 inline-flex items-center gap-2 text-[13px]"
            >
              <LinkIcon size={14} />
              {fr ? 'Copier le lien de signature' : 'Copy signature link'}
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={sending}
            className="ml-auto bg-primary text-white rounded-lg py-2.5 px-5 text-[13px] font-semibold inline-flex items-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            {fr ? 'Envoyer par courriel' : 'Send by email'}
          </button>
        </div>
      </div>
    </div>
  );
}
