import React, { useEffect, useState } from 'react';
import { Eye, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import FileUpload from '../FileUpload';
import { STORAGE_BUCKETS } from '../../lib/storage';
import {
  createJobAgreement,
  DEFAULT_AGREEMENT_TERMS,
  type JobAgreement,
} from '../../lib/jobAgreementsApi';
import AgreementDraftPreviewModal, { type AgreementDraftPreviewData } from './AgreementDraftPreviewModal';

interface AgreementCreateModalProps {
  open: boolean;
  onClose: () => void;
  /** Exactly one of jobId / quoteId — the agreement feature is shared by jobs and quotes. */
  jobId?: string;
  quoteId?: string;
  clientId: string | null;
  onCreated: (agreement: JobAgreement) => void;
  /** Items/client/taxes of the parent job or quote — enables the client-view preview before creating. */
  preview?: AgreementDraftPreviewData;
}

/**
 * Create a written agreement for an EXISTING job or quote from its hub — same
 * fields as the "Contrat" box of the New Job form (signature required,
 * company logo default with override, prefilled editable T&C).
 */
export default function AgreementCreateModal({ open, onClose, jobId, quoteId, clientId, onCreated, preview }: AgreementCreateModalProps) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [requireSignature, setRequireSignature] = useState(true);
  const [terms, setTerms] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTerms((prev) => prev || DEFAULT_AGREEMENT_TERMS[fr ? 'fr' : 'en']);
    if (companyLogoUrl === null) {
      getCurrentOrgIdOrThrow()
        .then((orgId) => supabase
          .from('company_settings')
          .select('logo_url')
          .eq('org_id', orgId)
          .limit(1)
          .maybeSingle())
        .then(({ data }) => setCompanyLogoUrl(data?.logo_url || ''))
        .then(undefined, () => setCompanyLogoUrl(''));
    }
  }, [open, fr, companyLogoUrl]);

  if (!open) return null;

  const handleCreate = async () => {
    setSaving(true);
    try {
      const created = await createJobAgreement({
        job_id: jobId || null,
        quote_id: quoteId || null,
        client_id: clientId,
        require_signature: requireSignature,
        terms: terms.trim(),
        logo_url: logoUrl || null,
      });
      if (!created) {
        toast.error(fr
          ? 'La table des contrats n’existe pas encore — applique la migration SQL dans Supabase.'
          : 'The agreements table does not exist yet — apply the SQL migration in Supabase.');
        return;
      }
      toast.success(fr ? 'Contrat créé.' : 'Agreement created.');
      onCreated(created);
      onClose();
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Le contrat n’a pas pu être créé.' : 'The agreement could not be created.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-surface-card rounded-2xl border border-outline shadow-xl w-full max-w-[560px] max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-outline-subtle flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-bold tracking-tight text-text-primary">
              {fr ? 'Créer un contrat' : 'Create agreement'}
            </h3>
            <p className="text-[12.5px] text-text-tertiary mt-0.5">
              {fr ? 'Contrat écrit lié à ce job' : 'Written contract attached to this job'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-outline-subtle bg-surface-secondary/40 p-3">
            <input
              type="checkbox"
              checked={requireSignature}
              onChange={(e) => setRequireSignature(e.target.checked)}
              className="h-4 w-4 rounded mt-0.5 accent-primary"
            />
            <span>
              <span className="block text-[13px] font-semibold text-text-primary">
                {fr ? 'Signature du client obligatoire' : 'Client signature required'}
              </span>
              <span className="block text-[12px] text-text-tertiary mt-0.5">
                {fr
                  ? 'Le client devra signer le contrat via un lien public (même pad de signature que les soumissions).'
                  : 'The client will sign the contract via a public link (same signature pad as quotes).'}
              </span>
            </span>
          </label>

          <div>
            <span className="text-xs font-medium text-text-tertiary block mb-1.5">
              {fr ? 'Logo sur le contrat' : 'Logo on the contract'}
            </span>
            <div className="flex items-center gap-3 rounded-lg border border-outline-subtle p-3">
              {(logoUrl || companyLogoUrl) ? (
                <img
                  src={logoUrl || companyLogoUrl || ''}
                  alt="Logo"
                  className="h-11 w-11 rounded-lg object-contain border border-outline-subtle bg-surface-secondary shrink-0"
                />
              ) : (
                <div className="h-11 w-11 rounded-lg bg-surface-secondary border border-outline-subtle shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-text-primary">
                  {logoUrl
                    ? (fr ? 'Logo personnalisé' : 'Custom logo')
                    : (fr ? 'Logo de l’entreprise' : 'Company logo')}
                </p>
                <p className="text-[12px] text-text-tertiary">
                  {fr ? 'Par défaut : Réglages → Détails de l’entreprise' : 'Default: Settings → Company details'}
                </p>
              </div>
              {logoUrl && (
                <button
                  type="button"
                  onClick={() => setLogoUrl(null)}
                  className="text-[12px] font-medium text-text-tertiary hover:text-danger shrink-0"
                >
                  {fr ? 'Retirer' : 'Remove'}
                </button>
              )}
            </div>
            <div className="mt-2">
              <FileUpload
                bucket={STORAGE_BUCKETS.COMPANY_LOGOS}
                path="agreements"
                accept="image/*"
                maxSizeMb={5}
                normalizeImageMaxDim={1024}
                onUpload={(url) => setLogoUrl(url)}
              />
            </div>
          </div>

          <div>
            <span className="text-xs font-medium text-text-tertiary block mb-1.5">
              {fr ? 'Termes et conditions' : 'Terms and conditions'}
            </span>
            <textarea
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              rows={7}
              className="glass-input w-full !h-auto text-[12.5px] leading-relaxed resize-y"
            />
            <p className="text-[11px] text-text-tertiary mt-1">
              {fr
                ? 'Pré-rempli avec les termes par défaut — modifiable pour ce contrat.'
                : 'Prefilled with the default terms — editable for this agreement.'}
            </p>
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-[12px] text-primary">
            {fr
              ? 'Les services, prix et taxes du job ainsi que la date de création et les infos de l’entreprise sont inclus automatiquement dans le contrat.'
              : 'The job’s services, prices and taxes plus the creation date and company info are automatically included in the contract.'}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-outline-subtle flex justify-end gap-2">
          {preview && (
            <button
              onClick={() => setPreviewOpen(true)}
              className="glass-button !py-2.5 !px-4 text-[13px] inline-flex items-center gap-2 mr-auto"
            >
              <Eye size={14} />
              {fr ? 'Prévisualiser (vue client)' : 'Preview (client view)'}
            </button>
          )}
          <button onClick={onClose} className="glass-button !py-2.5 !px-4 text-[13px]">
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="bg-primary text-primary-foreground rounded-lg py-2.5 px-5 text-[13px] font-semibold inline-flex items-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {fr ? 'Créer le contrat' : 'Create agreement'}
          </button>
        </div>
      </div>

      {/* Sibling of the card so its backdrop clicks don't bubble into onClose above */}
      {preview && (
        <AgreementDraftPreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          requireSignature={requireSignature}
          terms={terms}
          logoUrl={logoUrl || companyLogoUrl}
          data={preview}
        />
      )}
    </div>
  );
}
