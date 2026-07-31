import React from 'react';
import type { QuoteRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';
import { useTranslation } from '../../../i18n';

/* ── Modern Bold Quote Template ─────────────────────────────────
   Vibrant orange theme with organic wave shapes (SVG).
   Bold, contemporary design adapted for quotes.
   ────────────────────────────────────────────────────────────── */

const ORANGE = '#e67e22';
const ORANGE_DARK = '#d35400';
const BG_DARK = '#1a1a1a';
const TEXT_SEC = '#6b7280';

function fmtDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

const STATUS_FR: Record<string, string> = {
  draft: 'Brouillon',
  sent: 'Envoyée',
  awaiting_response: 'En attente',
  changes_requested: 'Modifications demandées',
  archived: 'Archivée',
  approved: 'Approuvée',
  declined: 'Refusée',
  expired: 'Expirée',
  converted: 'Convertie',
};

function WaveTop() {
  return (
    <svg viewBox="0 0 800 120" className="absolute top-0 right-0 w-[55%] h-auto" preserveAspectRatio="none">
      <path d="M400,0 L800,0 L800,120 C700,100 600,60 500,80 C420,95 400,50 400,0 Z" fill={ORANGE} />
      <circle cx="680" cy="55" r="42" fill={ORANGE_DARK} opacity="0.35" />
    </svg>
  );
}

function WaveBottom() {
  return (
    <svg viewBox="0 0 800 140" className="w-full h-auto" preserveAspectRatio="none">
      <path d="M0,60 C80,10 180,100 300,70 C400,45 450,90 520,80 C620,65 700,30 800,60 L800,140 L0,140 Z" fill={BG_DARK} />
      <path d="M0,80 C100,50 200,120 340,85 C440,60 500,100 600,90 C700,78 750,50 800,70 L800,140 L0,140 Z" fill={ORANGE} opacity="0.7" />
    </svg>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    draft:              { bg: '#f1f5f9', text: '#475569' },
    sent:               { bg: '#eff6ff', text: '#1d4ed8' },
    awaiting_response:  { bg: '#fefce8', text: '#a16207' },
    changes_requested: { bg: '#fef2f2', text: '#b91c1c' },
    archived:           { bg: '#f1f5f9', text: '#64748b' },
    approved:           { bg: '#f0fdf4', text: '#15803d' },
    declined:           { bg: '#fef2f2', text: '#b91c1c' },
    expired:            { bg: '#f1f5f9', text: '#64748b' },
    converted:          { bg: '#f0fdf4', text: '#15803d' },
  };
  const { language } = useTranslation();
  const c = colors[status] || colors.draft;
  const label = language === 'fr'
    ? (STATUS_FR[status] || STATUS_FR.draft)
    : status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ backgroundColor: c.bg, color: c.text }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.text }} />
      {label}
    </span>
  );
}

export default function ModernBoldTemplate({ data }: { data: QuoteRenderData }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const locale = fr ? 'fr-CA' : 'en-CA';
  const fmt = (cents: number) => formatMoneyFromCents(cents, data.currency, locale);
  const L = fr ? {
    quote: 'SOUMISSION',
    quoteNo: 'Soumission nº :',
    date: 'Date :',
    validUntil: 'Valide jusqu\'au :',
    contact: 'Contact',
    preparedFor: 'Préparé pour',
    description: 'Description',
    qty: 'Qté',
    price: 'Prix',
    total: 'Total',
    noItems: 'Aucun élément',
    optional: 'Ajouts optionnels',
    subtotal: 'SOUS-TOTAL',
    discount: 'RABAIS',
    tax: 'TAXES',
    totalCaps: 'TOTAL',
    deposit: 'DÉPÔT',
    notes: 'Notes',
    terms: 'Termes et conditions',
    signature: 'Signature',
    thanks: 'MERCI',
  } : {
    quote: 'QUOTE',
    quoteNo: 'Quote No :',
    date: 'Date :',
    validUntil: 'Valid Until :',
    contact: 'Contact',
    preparedFor: 'Prepared For',
    description: 'Description',
    qty: 'Qty',
    price: 'Price',
    total: 'Total',
    noItems: 'No line items',
    optional: 'Optional Add-ons',
    subtotal: 'SUBTOTAL',
    discount: 'DISCOUNT',
    tax: 'TAX',
    totalCaps: 'TOTAL',
    deposit: 'DEPOSIT',
    notes: 'Notes',
    terms: 'Terms & Conditions',
    signature: 'Signature',
    thanks: 'THANKS',
  };

  return (
    <div className="bg-white text-[#262626] relative overflow-hidden" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif', fontSize: '13px', lineHeight: '1.5' }}>

      {/* ── Header with Wave ── */}
      <div className="relative min-h-[180px]">
        <WaveTop />

        <div className="relative z-10 px-10 pt-8">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[36px] font-extrabold tracking-tight" style={{ color: ORANGE }}>{L.quote}</p>
              <div className="mt-1">
                {data.company_logo_url ? (
                  <img src={data.company_logo_url} alt={data.company_name} className="h-20 max-w-[320px] object-contain" />
                ) : (
                  <p className="text-[14px] font-bold text-[#111]">{data.company_name}</p>
                )}
                {data.company_address && <p className="text-[10px] mt-0.5" style={{ color: TEXT_SEC }}>{data.company_address}</p>}
              </div>
            </div>

            <div className="text-right text-white z-10 pt-2">
              <div className="text-[11px] space-y-0.5">
                <p>{L.quoteNo} <span className="font-semibold">{data.quote_number}</span></p>
                <p>{L.date} <span className="font-semibold">{fmtDate(data.created_at, locale)}</span></p>
                {data.valid_until && <p>{L.validUntil} <span className="font-semibold">{fmtDate(data.valid_until, locale)}</span></p>}
              </div>
            </div>
          </div>

          {/* Prepared For + Contact */}
          <div className="flex items-start justify-between mt-6">
            <div>
              {(data.company_phone || data.company_email) && (
                <div className="mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: ORANGE }}>{L.contact}</p>
                  <div className="text-[11px] mt-1 space-y-0.5" style={{ color: TEXT_SEC }}>
                    {data.company_phone && <p>{data.company_phone}</p>}
                    {data.company_email && <p>{data.company_email}</p>}
                  </div>
                </div>
              )}
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: TEXT_SEC }}>{L.preparedFor}</p>
              <p className="text-[14px] font-bold mt-1" style={{ color: ORANGE }}>{data.contact_name}</p>
              <div className="text-[11px] mt-0.5 space-y-0.5" style={{ color: TEXT_SEC }}>
                {data.contact_company && <p>{data.contact_company}</p>}
                {data.contact_address && <p>{data.contact_address}</p>}
                {data.contact_email && <p>{data.contact_email}</p>}
                {data.contact_phone && <p>{data.contact_phone}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-10 pb-4">

        {/* ── Status + Title ── */}
        <div className="flex items-center justify-between mb-4">
          <StatusPill status={data.status} />
          {data.title && <p className="text-[13px] font-semibold text-[#111]">{data.title}</p>}
        </div>

        {/* ── Introduction ── */}
        {data.introduction && (
          <div className="mb-5 px-4 py-3 rounded-lg" style={{ backgroundColor: ORANGE + '08', borderLeft: `3px solid ${ORANGE}` }}>
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed" style={{ color: TEXT_SEC }}>{data.introduction}</p>
          </div>
        )}

        {/* ── Line Items Table ── */}
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-white rounded-l-lg" style={{ backgroundColor: ORANGE }}>{L.description}</th>
              <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-white" style={{ backgroundColor: ORANGE }}>{L.qty}</th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-white" style={{ backgroundColor: ORANGE }}>{L.price}</th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-white rounded-r-lg" style={{ backgroundColor: ORANGE }}>{L.total}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id} className="border-b border-[#f3f4f6]">
                <td className="px-4 py-3 text-[12px]">
                  <p className="font-medium text-[#111]">{item.name}</p>
                  {item.description && <p className="text-[11px] mt-0.5" style={{ color: TEXT_SEC }}>{item.description}</p>}
                </td>
                <td className="px-4 py-3 text-center text-[12px] tabular-nums" style={{ color: TEXT_SEC }}>{item.qty}</td>
                <td className="px-4 py-3 text-right text-[12px] tabular-nums" style={{ color: TEXT_SEC }}>{fmt(item.unit_price_cents)}</td>
                <td className="px-4 py-3 text-right text-[12px] font-semibold tabular-nums text-[#111]">{fmt(item.total_cents)}</td>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><td colSpan={4} className="py-10 text-center text-[12px] text-[#9ca3af]">{L.noItems}</td></tr>
            )}
          </tbody>
        </table>

        {/* ── Optional Items ── */}
        {data.optional_items.length > 0 && (
          <div className="mt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: ORANGE }}>{L.optional}</p>
            <table className="w-full border-collapse">
              <tbody>
                {data.optional_items.map((item) => (
                  <tr key={item.id} className="border-b border-dashed border-[#e5e7eb]">
                    <td className="px-4 py-2 text-[12px] italic text-[#666]">
                      {item.name}
                      {item.description && <span className="ml-2 text-[11px]" style={{ color: TEXT_SEC }}>- {item.description}</span>}
                    </td>
                    <td className="px-4 py-2 text-center text-[12px] tabular-nums w-16" style={{ color: TEXT_SEC }}>{item.qty}</td>
                    <td className="px-4 py-2 text-right text-[12px] tabular-nums w-24" style={{ color: TEXT_SEC }}>{fmt(item.unit_price_cents)}</td>
                    <td className="px-4 py-2 text-right text-[12px] tabular-nums font-medium w-24 text-[#666]">{fmt(item.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Totals ── */}
        <div className="mt-4 flex justify-end">
          <div className="w-64 text-[12px]">
            <div className="flex justify-between py-1.5">
              <span className="font-semibold" style={{ color: TEXT_SEC }}>{L.subtotal}</span>
              <span className="tabular-nums font-medium">{fmt(data.subtotal_cents)}</span>
            </div>
            {data.discount_cents > 0 && (
              <div className="flex justify-between py-1.5 text-[#dc2626]">
                <span className="font-semibold">{L.discount}</span>
                <span className="tabular-nums">-{fmt(data.discount_cents)}</span>
              </div>
            )}
            <div className="flex justify-between py-1.5">
              <span className="font-semibold" style={{ color: TEXT_SEC }}>{data.tax_rate_label || L.tax}</span>
              <span className="tabular-nums">{fmt(data.tax_cents)}</span>
            </div>
            <div className="flex justify-between py-2.5 mt-1 rounded-md px-3 -mx-3 text-[14px] font-bold text-white" style={{ backgroundColor: ORANGE }}>
              <span>{L.totalCaps}</span>
              <span className="tabular-nums">{fmt(data.total_cents)}</span>
            </div>
            {data.deposit_required && data.deposit_cents > 0 && (
              <div className="flex justify-between py-1.5 mt-1">
                <span className="font-semibold" style={{ color: TEXT_SEC }}>{L.deposit}</span>
                <span className="tabular-nums font-semibold">{fmt(data.deposit_cents)}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Notes / Terms ── */}
        <div className="mt-8 flex items-start justify-between gap-8">
          <div className="flex-1 space-y-4">
            {data.notes && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: ORANGE }}>{L.notes}</p>
                <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed" style={{ color: TEXT_SEC }}>{data.notes}</p>
              </div>
            )}
            {data.contract_disclaimer && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: ORANGE }}>{L.terms}</p>
                <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed" style={{ color: TEXT_SEC }}>{data.contract_disclaimer}</p>
              </div>
            )}
          </div>
          <div className="flex-1 text-right">
            <p className="text-[18px] italic" style={{ color: TEXT_SEC }}>{L.signature}</p>
            <div className="mt-4 border-b border-[#d1d5db] w-48 ml-auto" />
          </div>
        </div>

        {/* ── Thank You ── */}
        <div className="mt-8 text-center">
          <p className="text-[32px] font-extrabold tracking-wide" style={{ color: TEXT_SEC, opacity: 0.2 }}>{L.thanks}</p>
        </div>
      </div>

      {/* ── Bottom Waves ── */}
      <div className="mt-2">
        <WaveBottom />
      </div>
    </div>
  );
}
