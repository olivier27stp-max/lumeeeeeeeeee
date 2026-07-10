import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '../../i18n';

/**
 * Draft contract preview for /quotes/new — shows the client-facing agreement
 * BEFORE the job/agreement exists, from the in-progress quote data. Self-
 * contained: everything it renders is passed in via `data` (no fetch), so it
 * works while the quote is still being drafted.
 */
export interface AgreementDraftPreviewData {
  numberLabel: string;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  propertyAddress: string | null;
  items: Array<{ name: string; qty: number; unit_price_cents: number; total_cents: number }>;
  taxLines: Array<{ label: string; rate: number }>;
  subtotalCents: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  requireSignature: boolean;
  terms: string;
  logoUrl: string | null;
  data: AgreementDraftPreviewData;
}

const money = (cents: number) =>
  `${(cents / 100).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

export default function AgreementDraftPreviewModal({ open, onClose, requireSignature, terms, logoUrl, data }: Props) {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const { taxAmounts, totalCents } = useMemo(() => {
    const amounts = data.taxLines.map((t) => ({
      label: t.label,
      rate: t.rate,
      cents: Math.round(data.subtotalCents * (t.rate / 100)),
    }));
    const tax = amounts.reduce((s, a) => s + a.cents, 0);
    return { taxAmounts: amounts, totalCents: data.subtotalCents + tax };
  }, [data.subtotalCents, data.taxLines]);

  if (!open) return null;

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
              {(fr ? 'Aperçu du contrat' : 'Contract preview') + (data.clientName ? ` — ${data.clientName}` : '')}
            </h3>
            <p className="text-[12.5px] text-text-tertiary mt-0.5">
              {fr ? 'Vue client (brouillon) — ce que le client verra pour signer.' : 'Client view (draft) — what the client will see to sign.'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5">
          <div className="rounded-xl border border-outline-subtle bg-white text-[#1a1a1a] p-6">
            {/* Top */}
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                {logoUrl ? (
                  <img src={logoUrl} alt="" className="h-10 w-auto object-contain mb-2" />
                ) : null}
                <div className="text-[13px] font-bold">{fr ? 'Contrat de service' : 'Service Agreement'}</div>
                <div className="text-[12px] text-gray-500">{data.numberLabel}</div>
              </div>
              <div className="text-right text-[12px] text-gray-600">
                {data.clientName && <div className="font-semibold text-[#1a1a1a]">{data.clientName}</div>}
                {data.clientEmail && <div>{data.clientEmail}</div>}
                {data.clientPhone && <div>{data.clientPhone}</div>}
                {data.propertyAddress && <div className="max-w-[220px]">{data.propertyAddress}</div>}
              </div>
            </div>

            {/* Items */}
            <table className="w-full text-[12.5px] border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 text-left">
                  <th className="py-1.5 font-medium">{fr ? 'Service' : 'Service'}</th>
                  <th className="py-1.5 font-medium text-right w-14">{fr ? 'Qté' : 'Qty'}</th>
                  <th className="py-1.5 font-medium text-right w-24">{fr ? 'Prix' : 'Price'}</th>
                  <th className="py-1.5 font-medium text-right w-24">{fr ? 'Total' : 'Total'}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr><td colSpan={4} className="py-3 text-gray-400 italic">{fr ? 'Aucun service ajouté.' : 'No services added.'}</td></tr>
                ) : data.items.map((it, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-1.5 pr-2">{it.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{it.qty}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(it.unit_price_cents)}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(it.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div className="mt-3 ml-auto w-[240px] text-[12.5px]">
              <div className="flex justify-between py-1 text-gray-600">
                <span>{fr ? 'Sous-total' : 'Subtotal'}</span>
                <span className="tabular-nums">{money(data.subtotalCents)}</span>
              </div>
              {taxAmounts.map((t, i) => (
                <div key={i} className="flex justify-between py-1 text-gray-600">
                  <span>{t.label} ({t.rate}%)</span>
                  <span className="tabular-nums">{money(t.cents)}</span>
                </div>
              ))}
              <div className="flex justify-between py-1.5 mt-1 border-t border-gray-200 font-bold text-[#1a1a1a]">
                <span>{fr ? 'Total' : 'Total'}</span>
                <span className="tabular-nums">{money(totalCents)}</span>
              </div>
            </div>

            {/* Terms */}
            {terms.trim() && (
              <div className="mt-5 pt-4 border-t border-gray-200">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                  {fr ? 'Termes et conditions' : 'Terms & Conditions'}
                </div>
                <div className="text-[11.5px] text-gray-600 whitespace-pre-wrap leading-relaxed">{terms}</div>
              </div>
            )}

            {/* Signature */}
            {requireSignature && (
              <div className="mt-6 pt-4 border-t border-gray-200">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-3">
                  {fr ? 'Signature du client' : 'Client signature'}
                </div>
                <div className="h-12 border-b border-gray-300 w-2/3" />
                <div className="text-[11px] text-gray-400 mt-1">{fr ? 'Signé le ______________' : 'Signed on ______________'}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
