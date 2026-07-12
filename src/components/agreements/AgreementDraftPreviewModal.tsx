import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { getAgreementCompanyBranding, type AgreementCompanyBranding } from '../../lib/agreementDoc';
import AgreementDocument, { type AgreementDocData } from './AgreementDocument';

/**
 * Data the creation forms already hold to render a draft contract — the
 * agreement row does not exist yet (no view_token), so this is composed
 * client-side from the form state.
 */
export interface AgreementDraftPreviewData {
  /** e.g. `CTR-123`; falls back to `CTR-—` when the number is not known yet. */
  numberLabel: string;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  propertyAddress: string | null;
  items: Array<{ name: string; qty: number; unit_price_cents: number; total_cents: number }>;
  /** amount_cents: precomputed tax amount (compound taxes, stored quote totals); recomputed from the rate when absent. */
  taxLines: Array<{ label: string; rate: number; amount_cents?: number }>;
  /** Manual subtotal override (job form "total" input); defaults to the items sum. */
  subtotalCents?: number;
  /** Quote discount — taxes are computed on the discounted base, like the quote page. */
  discountCents?: number;
  discountPercent?: number | null;
}

interface AgreementDraftPreviewModalProps {
  open: boolean;
  onClose: () => void;
  requireSignature: boolean;
  terms: string;
  /** Custom logo override; falls back to the company logo like the real contract. */
  logoUrl: string | null;
  data: AgreementDraftPreviewData;
}

/**
 * Read-only preview of a NOT-YET-CREATED agreement, rendered with the exact
 * same AgreementDocument as the public /contract/:token page — what you see
 * here is what the client will see once the contract is created.
 */
export default function AgreementDraftPreviewModal({
  open,
  onClose,
  requireSignature,
  terms,
  logoUrl,
  data,
}: AgreementDraftPreviewModalProps) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [company, setCompany] = useState<AgreementCompanyBranding | null>(null);

  useEffect(() => {
    if (!open) return;
    getAgreementCompanyBranding().then(setCompany).catch(() => {
      setCompany({ company_name: 'Business', logo_url: null, phone: null, email: null, website: null, address: null, taxLines: [] });
    });
  }, [open]);

  const docData: AgreementDocData | null = useMemo(() => {
    if (!company) return null;
    const subtotalCents = data.subtotalCents ?? data.items.reduce((sum, it) => sum + it.total_cents, 0);
    const discountCents = Math.max(0, data.discountCents ?? 0);
    const taxBaseCents = Math.max(0, subtotalCents - discountCents);
    const taxLines = data.taxLines
      .filter((tx) => tx.rate > 0)
      .map((tx) => ({ label: tx.label, rate: tx.rate, amount_cents: tx.amount_cents ?? Math.round(taxBaseCents * (tx.rate / 100)) }));
    return {
      agreementNumber: data.numberLabel,
      createdAt: new Date().toISOString(),
      requireSignature,
      terms,
      logoUrl: logoUrl || company.logo_url,
      company: {
        name: company.company_name,
        address: company.address,
        phone: company.phone,
        email: company.email,
        website: company.website,
        taxLines: company.taxLines,
      },
      clientName: data.clientName,
      clientEmail: data.clientEmail,
      clientPhone: data.clientPhone,
      propertyAddress: data.propertyAddress,
      items: data.items,
      subtotalCents,
      discount: discountCents > 0 ? { amount_cents: discountCents, percent: data.discountPercent ?? null } : null,
      taxLines,
      totalCents: taxBaseCents + taxLines.reduce((sum, tx) => sum + tx.amount_cents, 0),
      signature: null,
    };
  }, [company, data, requireSignature, terms, logoUrl]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/40"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="bg-surface-card rounded-2xl border border-outline shadow-xl w-full max-w-[720px] max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-outline-subtle flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-bold tracking-tight text-text-primary">
              {(fr ? 'Aperçu du contrat' : 'Agreement preview') + (data.clientName ? ` — ${data.clientName}` : '')}
            </h3>
            <p className="text-[12.5px] text-text-tertiary mt-0.5">
              {fr
                ? 'Exactement ce que le client verra sur la page publique du contrat.'
                : 'Exactly what the client will see on the public contract page.'}
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
      </div>
    </div>
  );
}
