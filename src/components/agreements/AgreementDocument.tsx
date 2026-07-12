import React from 'react';
import { formatCents } from '../../lib/jobCalc';

// ── Lume fallback logo (panda) ──
const LUME_LOGO_URL = '/lume-logo.png';

/**
 * Resolved, render-ready data for a job agreement document. Built either
 * client-side (authenticated preview in JobDetails) or from the public
 * server endpoint (/api/agreements/public/:token). When the agreement is
 * signed this always comes from the frozen `snapshot`.
 */
export interface AgreementDocData {
  agreementNumber: string;
  createdAt: string | null;
  requireSignature: boolean;
  terms: string;
  logoUrl: string | null;
  company: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    taxLines: string[];
  };
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  propertyAddress: string | null;
  items: Array<{ name: string; qty: number; unit_price_cents: number; total_cents: number }>;
  subtotalCents: number;
  /** Quote discount (jobs have none) — shown between subtotal and taxes so the lines add up to the total. */
  discount?: { amount_cents: number; percent?: number | null } | null;
  taxLines: Array<{ label: string; rate: number; amount_cents: number }>;
  totalCents: number;
  signature: { signerName: string; signatureData: string; signedAt: string | null } | null;
}

function fmtDate(iso: string | null | undefined, language: 'en' | 'fr'): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * The contract paper itself — shared by the authenticated preview modal and
 * the public /contract/:token signature page (same layout as the quote doc).
 */
export default function AgreementDocument({ data, language }: { data: AgreementDocData; language: 'en' | 'fr' }) {
  const fr = language === 'fr';
  const logoUrl = data.logoUrl || LUME_LOGO_URL;

  return (
    <div className="agreement-doc bg-white rounded-lg border border-[#e5e5e5] shadow-sm overflow-hidden text-left">
      {/* ── HEADER: logo + company left, CONTRAT right ── */}
      <div className="px-8 pt-8 pb-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <img
              src={logoUrl}
              alt={data.company.name}
              className="h-24 max-w-[360px] object-contain mb-3"
              onError={(e) => { (e.target as HTMLImageElement).src = LUME_LOGO_URL; }}
            />
            <h2 className="text-[14px] font-semibold text-[#111]">{data.company.name}</h2>
            {data.company.address && (
              <p className="text-[12px] text-[#888] mt-0.5">{data.company.address}</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
              {data.company.phone && <span className="text-[12px] text-[#888]">{data.company.phone}</span>}
              {data.company.email && <span className="text-[12px] text-[#888]">{data.company.email}</span>}
              {data.company.website && <span className="text-[12px] text-[#888]">{data.company.website}</span>}
            </div>
            {data.company.taxLines.length > 0 && (
              <p className="text-[11px] text-[#999] mt-1">{data.company.taxLines.join(' · ')}</p>
            )}
          </div>
          <div className="text-right ml-6">
            <h1 className="text-[28px] font-bold text-[#111] tracking-tight leading-none">
              {fr ? 'CONTRAT' : 'CONTRACT'}
            </h1>
            <p className="text-[13px] text-[#888] mt-1 font-medium">{data.agreementNumber}</p>
            <p className="text-[12px] text-[#aaa] mt-0.5">
              {(fr ? 'Créé le ' : 'Created ') + fmtDate(data.createdAt, language)}
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-[#eee]" />

      {/* ── PARTIES: client + work address ── */}
      <div className="px-8 py-5 grid grid-cols-2 gap-6">
        <div>
          <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">Client</p>
          {data.clientName ? (
            <>
              <p className="text-[14px] font-semibold text-[#111]">{data.clientName}</p>
              {data.clientEmail && <p className="text-[12px] text-[#888] mt-0.5">{data.clientEmail}</p>}
              {data.clientPhone && <p className="text-[12px] text-[#888] mt-0.5">{data.clientPhone}</p>}
            </>
          ) : (
            <p className="text-[13px] text-[#aaa]">--</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">
            {fr ? 'Adresse des travaux' : 'Work address'}
          </p>
          <p className="text-[13px] text-[#333]">{data.propertyAddress || '--'}</p>
        </div>
      </div>

      <div className="border-t border-[#eee]" />

      {/* ── SERVICES TABLE ── */}
      <div className="px-8 py-6">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#e5e5e5]">
              <th className="text-left py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em]">
                {fr ? 'Service(s)' : 'Service(s)'}
              </th>
              <th className="text-center py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em] w-16">
                {fr ? 'Qté' : 'Qty'}
              </th>
              <th className="text-right py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em] w-28">
                {fr ? 'Prix unitaire' : 'Unit price'}
              </th>
              <th className="text-right py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em] w-24">
                {fr ? 'Montant' : 'Amount'}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, i) => (
              <tr key={i} className="border-b border-[#f0f0f0]">
                <td className="py-3 text-[#222] font-medium">{item.name}</td>
                <td className="py-3 text-center text-[#666]">{item.qty}</td>
                <td className="py-3 text-right text-[#666]">{formatCents(item.unit_price_cents)}</td>
                <td className="py-3 text-right font-medium text-[#111]">{formatCents(item.total_cents)}</td>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-[#ccc] text-[13px]">
                  {fr ? 'Aucun service' : 'No services'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── TOTALS ── */}
      <div className="px-8 pb-6">
        <div className="ml-auto w-full max-w-[280px] space-y-2 text-[13px]">
          <div className="flex justify-between">
            <span className="text-[#888]">{fr ? 'Sous-total' : 'Subtotal'}</span>
            <span className="text-[#333] font-medium">{formatCents(data.subtotalCents)}</span>
          </div>
          {data.discount && data.discount.amount_cents > 0 && (
            <div className="flex justify-between">
              <span className="text-[#888]">
                {(fr ? 'Rabais' : 'Discount') + (data.discount.percent ? ` (${data.discount.percent}%)` : '')}
              </span>
              <span className="text-[#333] font-medium">-{formatCents(data.discount.amount_cents)}</span>
            </div>
          )}
          {data.taxLines.map((tax, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-[#888]">{tax.label} ({tax.rate}%)</span>
              <span className="text-[#333] font-medium">{formatCents(tax.amount_cents)}</span>
            </div>
          ))}
          <div className="border-t border-[#e5e5e5] pt-2 mt-2 flex justify-between text-[15px]">
            <span className="font-bold text-[#111]">Total</span>
            <span className="font-bold text-[#111]">{formatCents(data.totalCents)}</span>
          </div>
        </div>
      </div>

      {/* ── TERMS & CONDITIONS ── */}
      {data.terms && (
        <>
          <div className="border-t border-[#eee]" />
          <div className="px-8 py-5">
            <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">
              {fr ? 'Termes et conditions' : 'Terms & conditions'}
            </p>
            <p className="text-[12px] text-[#888] whitespace-pre-wrap leading-relaxed">{data.terms}</p>
          </div>
        </>
      )}

      {/* ── SIGNATURE ── */}
      <div className="border-t border-[#eee]" />
      <div className="px-8 py-6">
        {data.requireSignature ? (
          <>
            <p className="text-[12px] font-semibold text-[#333] mb-4">
              {fr ? "J'ai lu et j'accepte les termes et conditions." : 'I have read and accept the terms and conditions.'}
            </p>
            {data.signature ? (
              <div className="flex items-end justify-between gap-6">
                <div>
                  <div className="border border-[#eee] rounded-md bg-[#fafafa] p-2 inline-block">
                    <img src={data.signature.signatureData} alt="Signature" className="h-14 max-w-[220px] object-contain" />
                  </div>
                  <p className="text-[11px] text-[#999] mt-2 pt-1 border-t border-dotted border-[#ccc] w-[220px]">
                    {fr ? 'Signature du client' : 'Client signature'} — {data.signature.signerName}
                  </p>
                </div>
                <p className="text-[11px] text-[#999]">
                  {(fr ? 'Signé le ' : 'Signed on ') + fmtDate(data.signature.signedAt, language)}
                </p>
              </div>
            ) : (
              <div className="flex items-end justify-between gap-6 pt-8">
                <p className="text-[11px] text-[#999] pt-1 border-t border-dotted border-[#ccc] w-[220px]">
                  {fr ? 'Signature du client' : 'Client signature'}
                </p>
                <p className="text-[11px] text-[#999] pt-1 border-t border-dotted border-[#ccc] w-[120px]">Date</p>
              </div>
            )}
          </>
        ) : (
          <p className="text-[12px] text-[#999]">
            {(fr ? 'Contrat émis le ' : 'Contract issued on ') + fmtDate(data.createdAt, language)}
          </p>
        )}
      </div>
    </div>
  );
}
