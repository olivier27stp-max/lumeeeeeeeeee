import React from 'react';
import type { QuoteRenderData, QuoteRenderItem } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';
import { useTranslation } from '../../../i18n';

/* ── Detailed Red Template ──────────────────────────────────────
   Red accent bars, logo placeholder, service information section,
   detailed table with Date/Description/Hours/Rate/Tax/Total,
   signature line, and full cost breakdown.
   Designed for detailed estimates and service quotes.
   ────────────────────────────────────────────────────────────── */

const RED = '#c0392b';
const RED_DARK = '#a93226';
const BORDER = '#d1d5db';
const TEXT = '#262626';
const TEXT_SEC = '#6b7280';
const TEXT_LIGHT = '#9ca3af';

function fmtDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
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

export default function DetailedRedTemplate({ data }: { data: QuoteRenderData }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const locale = fr ? 'fr-CA' : 'en-CA';
  const fmt = (cents: number) => formatMoneyFromCents(cents, data.currency, locale);
  const L = fr ? {
    billTo: 'Facturer à',
    date: 'Date',
    expiry: 'Date d\'expiration',
    estimateNo: 'Soumission nº',
    serviceInfo: 'Informations sur le service',
    currency: 'Devise',
    taxRate: 'Taux de taxe',
    depositRequired: 'Dépôt requis',
    description: 'Description',
    qty: 'Qté',
    rate: 'Prix',
    tax: 'Taxe',
    total: 'Total',
    noItems: 'Aucun élément',
    optional: 'Ajouts optionnels',
    specialNotes: 'Notes spéciales et conditions de vente',
    subtotal: 'SOUS-TOTAL',
    discount: 'RABAIS',
    taxRateCaps: 'TAUX DE TAXE',
    totalTax: 'TOTAL DES TAXES',
    deposit: 'DÉPÔT',
    quoteTotal: 'Total de la soumission',
    declaration: 'Je déclare que les renseignements ci-dessus sont exacts au meilleur de ma connaissance.',
    signature: 'Signature',
    terms: 'Termes et conditions',
  } : {
    billTo: 'Bill To',
    date: 'Date',
    expiry: 'Date of Expiry',
    estimateNo: 'Estimate No.',
    serviceInfo: 'Service Information',
    currency: 'Currency',
    taxRate: 'Tax Rate',
    depositRequired: 'Deposit Required',
    description: 'Description',
    qty: 'Qty',
    rate: 'Rate',
    tax: 'Tax',
    total: 'Total',
    noItems: 'No line items',
    optional: 'Optional Add-ons',
    specialNotes: 'Special Notes, Terms of Sale',
    subtotal: 'SUBTOTAL',
    discount: 'SUBTOTAL LESS DISCOUNT',
    taxRateCaps: 'TAX RATE',
    totalTax: 'TOTAL TAX',
    deposit: 'DEPOSIT',
    quoteTotal: 'Quote Total',
    declaration: 'I declare that the above information is true and correct to the best of my knowledge.',
    signature: 'Signature',
    terms: 'Terms & Conditions',
  };

  return (
    <div className="bg-white text-[#262626]" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif', fontSize: '13px', lineHeight: '1.5' }}>

      {/* ── Top Red Bar ── */}
      <div className="h-2" style={{ backgroundColor: RED }} />

      {/* ── Header: Company + Logo ── */}
      <div className="px-10 pt-6 pb-5 flex items-start justify-between">
        <div>
          {data.company_logo_url ? (
            <img src={data.company_logo_url} alt={data.company_name} className="h-32 max-w-[440px] object-contain" />
          ) : (
            <p className="text-[18px] font-bold text-[#111] tracking-tight">{data.company_name}</p>
          )}
          <div className="mt-2 text-[11px] space-y-0.5" style={{ color: TEXT_SEC }}>
            {data.company_address && <p>{data.company_address}</p>}
            {data.company_phone && <p>{data.company_phone}</p>}
            {data.company_email && <p>{data.company_email}</p>}
          </div>
        </div>
        {/* Logo circle / Branding mark */}
        <div className="w-28 h-28 rounded-full flex items-center justify-center" style={{ backgroundColor: TEXT_SEC }}>
          {data.company_logo_url ? (
            <img src={data.company_logo_url} alt="" className="w-24 h-24 object-contain rounded-full" />
          ) : (
            <span className="text-white text-[11px] font-bold uppercase tracking-wider">LOGO</span>
          )}
        </div>
      </div>

      <div className="px-10">

        {/* ── Bill To + Meta ── */}
        <div className="flex items-start justify-between pb-5 border-b" style={{ borderColor: BORDER }}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: RED }}>{L.billTo}</p>
            <div className="mt-2 text-[12px] space-y-0.5">
              <p className="font-semibold text-[#111]">{data.contact_name}</p>
              {data.contact_company && <p style={{ color: TEXT_SEC }}>{data.contact_company}</p>}
              {data.contact_address && <p style={{ color: TEXT_SEC }}>{data.contact_address}</p>}
              {data.contact_phone && <p style={{ color: TEXT_SEC }}>{data.contact_phone}</p>}
              {data.contact_email && <p style={{ color: TEXT_SEC }}>{data.contact_email}</p>}
            </div>
          </div>
          <div className="text-right text-[12px] space-y-1.5">
            <StatusPill status={data.status} />
            <div className="space-y-1 mt-2">
              <div className="flex justify-end gap-4">
                <span style={{ color: TEXT_SEC }}>{L.date}</span>
                <span className="font-medium text-[#111] w-28 text-right">{fmtDate(data.created_at, locale)}</span>
              </div>
              <div className="flex justify-end gap-4">
                <span style={{ color: TEXT_SEC }}>{L.expiry}</span>
                <span className="font-medium text-[#111] w-28 text-right">{fmtDate(data.valid_until, locale)}</span>
              </div>
              <div className="flex justify-end gap-4">
                <span style={{ color: TEXT_SEC }}>{L.estimateNo}</span>
                <span className="font-medium text-[#111] w-28 text-right">{data.quote_number}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Service Information ── */}
        <div className="py-4 border-b" style={{ borderColor: BORDER }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: RED }}>{L.serviceInfo}</p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-[11px]">
            <div className="flex gap-3">
              <span className="font-medium" style={{ color: TEXT_SEC }}>{L.currency}</span>
              <span className="text-[#111]">{data.currency}</span>
            </div>
            <div className="flex gap-3">
              <span className="font-medium" style={{ color: TEXT_SEC }}>{L.taxRate}</span>
              <span className="text-[#111]">{data.tax_rate_label || `${data.tax_rate}%`}</span>
            </div>
            {data.deposit_required && (
              <div className="flex gap-3">
                <span className="font-medium" style={{ color: TEXT_SEC }}>{L.depositRequired}</span>
                <span className="text-[#111]">{fmt(data.deposit_cents)}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Introduction / Scope ── */}
        {data.introduction && (
          <div className="py-4 border-b" style={{ borderColor: BORDER }}>
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed" style={{ color: TEXT_SEC }}>{data.introduction}</p>
          </div>
        )}

        {/* ── Line Items Table ── */}
        <div className="mt-5">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ backgroundColor: RED }}>
                <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-white">{L.description}</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-white w-16">{L.qty}</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-white w-24">{L.rate}</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-white w-24">{L.tax}</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-white w-24">{L.total}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const itemTax = data.tax_rate > 0 ? Math.round(item.total_cents * data.tax_rate / 100) : 0;
                return (
                  <tr key={item.id} className="border-b" style={{ borderColor: BORDER }}>
                    <td className="px-3 py-2.5 text-[11px]">
                      <p className="font-medium text-[#111]">{item.name}</p>
                      {item.description && <p className="text-[10px] mt-0.5" style={{ color: TEXT_SEC }}>{item.description}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-center text-[11px] tabular-nums" style={{ color: TEXT_SEC }}>{item.qty}</td>
                    <td className="px-3 py-2.5 text-right text-[11px] tabular-nums" style={{ color: TEXT_SEC }}>{fmt(item.unit_price_cents)}</td>
                    <td className="px-3 py-2.5 text-right text-[11px] tabular-nums" style={{ color: TEXT_SEC }}>{fmt(itemTax)}</td>
                    <td className="px-3 py-2.5 text-right text-[11px] font-medium tabular-nums text-[#111]">{fmt(item.total_cents)}</td>
                  </tr>
                );
              })}
              {data.items.length === 0 && (
                <tr><td colSpan={5} className="py-10 text-center text-[11px]" style={{ color: TEXT_LIGHT }}>{L.noItems}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Optional Items ── */}
        {data.optional_items.length > 0 && (
          <div className="mt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: RED }}>{L.optional}</p>
            <table className="w-full border-collapse">
              <tbody>
                {data.optional_items.map((item) => (
                  <tr key={item.id} className="border-b border-dashed" style={{ borderColor: BORDER }}>
                    <td className="px-3 py-2 text-[11px]">
                      <span className="text-[#111] italic">{item.name}</span>
                      {item.description && <span className="ml-2 text-[10px]" style={{ color: TEXT_SEC }}>- {item.description}</span>}
                    </td>
                    <td className="px-3 py-2 text-center text-[11px] tabular-nums w-16" style={{ color: TEXT_SEC }}>{item.qty}</td>
                    <td className="px-3 py-2 text-right text-[11px] tabular-nums w-24" style={{ color: TEXT_SEC }}>{fmt(item.unit_price_cents)}</td>
                    <td className="px-3 py-2 text-right text-[11px] tabular-nums font-medium w-24 text-[#111]">{fmt(item.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Special Notes + Totals ── */}
        <div className="mt-6 flex items-start gap-8">
          {/* Left: Notes */}
          <div className="flex-1">
            {data.notes && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: RED }}>{L.specialNotes}</p>
                <p className="mt-2 whitespace-pre-wrap text-[10px] leading-relaxed" style={{ color: TEXT_SEC }}>{data.notes}</p>
              </div>
            )}
          </div>

          {/* Right: Totals breakdown */}
          <div className="w-72 text-[11px]">
            <div className="flex justify-between py-1.5 border-b" style={{ borderColor: BORDER }}>
              <span className="font-semibold" style={{ color: TEXT_SEC }}>{L.subtotal}</span>
              <span className="tabular-nums font-medium">{fmt(data.subtotal_cents)}</span>
            </div>
            {data.discount_cents > 0 && (
              <div className="flex justify-between py-1.5 border-b text-[#dc2626]" style={{ borderColor: BORDER }}>
                <span className="font-semibold">{L.discount}</span>
                <span className="tabular-nums">-{fmt(data.discount_cents)}</span>
              </div>
            )}
            <div className="flex justify-between py-1.5 border-b" style={{ borderColor: BORDER }}>
              <span className="font-semibold" style={{ color: TEXT_SEC }}>{L.taxRateCaps}</span>
              <span className="tabular-nums">{data.tax_rate}%</span>
            </div>
            <div className="flex justify-between py-1.5 border-b" style={{ borderColor: BORDER }}>
              <span className="font-semibold" style={{ color: TEXT_SEC }}>{L.totalTax}</span>
              <span className="tabular-nums">{fmt(data.tax_cents)}</span>
            </div>
            {data.deposit_required && (
              <div className="flex justify-between py-1.5 border-b" style={{ borderColor: BORDER }}>
                <span className="font-semibold" style={{ color: TEXT_SEC }}>{L.deposit}</span>
                <span className="tabular-nums">{fmt(data.deposit_cents)}</span>
              </div>
            )}
            <div className="flex justify-between py-2.5 mt-1 px-3 -mx-3 text-[13px] font-bold" style={{ backgroundColor: '#fef9c3', color: '#111' }}>
              <span>{L.quoteTotal}</span>
              <span className="tabular-nums">{fmt(data.total_cents)}</span>
            </div>
          </div>
        </div>

        {/* ── Signature Line ── */}
        <div className="mt-10 pt-5 border-t" style={{ borderColor: BORDER }}>
          <p className="text-[10px] italic" style={{ color: TEXT_SEC }}>{L.declaration}</p>
          <div className="flex items-end justify-between mt-6 mb-2">
            <div>
              <p className="text-[11px] font-medium" style={{ color: TEXT }}>{L.signature}</p>
              <div className="w-48 border-b mt-8" style={{ borderColor: BORDER }} />
            </div>
            <div>
              <p className="text-[11px] font-medium" style={{ color: TEXT }}>{L.date}</p>
              <div className="w-36 border-b mt-8" style={{ borderColor: BORDER }} />
            </div>
          </div>
        </div>

        {/* ── Contract / Terms ── */}
        {data.contract_disclaimer && (
          <div className="mt-6 pt-4 border-t" style={{ borderColor: BORDER }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: RED }}>{L.terms}</p>
            <p className="whitespace-pre-wrap text-[10px] leading-relaxed" style={{ color: TEXT_SEC }}>{data.contract_disclaimer}</p>
          </div>
        )}
      </div>

      {/* ── Bottom Red Bar ── */}
      <div className="h-2 mt-6" style={{ backgroundColor: RED }} />
    </div>
  );
}
