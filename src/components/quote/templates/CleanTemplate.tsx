import React from 'react';
import type { QuoteRenderData, QuoteRenderItem } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';
import { useTranslation } from '../../../i18n';

/* ── Stripe-inspired Clean Quote Template ────────────────────────
   Exact same design language as the Stripe invoice template.
   Whitespace-heavy, subtle borders, clean typography.
   ─────────────────────────────────────────────────────────────── */

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
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: c.bg, color: c.text }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.text }} />
      {label}
    </span>
  );
}

function ItemRow({ item, fmt }: { item: QuoteRenderItem; fmt: (c: number) => string }) {
  if (item.item_type === 'heading') {
    return (
      <tr className="border-b border-[#e5e7eb]">
        <td colSpan={4} className="py-3 text-[12px] font-bold uppercase tracking-wider text-[#374151]">{item.name}</td>
      </tr>
    );
  }
  return (
    <tr className="border-b border-[#f3f4f6]">
      <td className="py-3.5 pr-4 text-[13px]">
        <p className="text-[#374151] font-medium">{item.name}</p>
        {item.description && <p className="text-[12px] text-[#9ca3af] mt-0.5">{item.description}</p>}
      </td>
      <td className="py-3.5 text-right text-[13px] text-[#6b7280] tabular-nums">{item.qty}</td>
      <td className="py-3.5 text-right text-[13px] text-[#6b7280] tabular-nums">{fmt(item.unit_price_cents)}</td>
      <td className="py-3.5 text-right text-[13px] font-medium text-[#111] tabular-nums">{fmt(item.total_cents)}</td>
    </tr>
  );
}

export default function CleanTemplate({ data }: { data: QuoteRenderData }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const locale = fr ? 'fr-CA' : 'en-CA';
  const fmt = (cents: number) => formatMoneyFromCents(cents, data.currency, locale);
  const L = fr ? {
    quote: 'Soumission',
    from: 'De',
    preparedFor: 'Préparé pour',
    quoteNumber: 'Numéro de soumission',
    date: 'Date',
    validUntil: 'Valide jusqu\'au',
    estimatedTotal: 'Total estimé',
    description: 'Description',
    qty: 'Qté',
    price: 'Prix',
    total: 'Total',
    noItems: 'Aucun élément',
    optional: 'Ajouts optionnels',
    subtotal: 'Sous-total',
    discount: 'Rabais',
    tax: 'Taxes',
    deposit: 'Dépôt requis',
    notes: 'Notes',
    terms: 'Termes et conditions',
  } : {
    quote: 'Quote',
    from: 'From',
    preparedFor: 'Prepared for',
    quoteNumber: 'Quote number',
    date: 'Date',
    validUntil: 'Valid until',
    estimatedTotal: 'Estimated total',
    description: 'Description',
    qty: 'Qty',
    price: 'Price',
    total: 'Total',
    noItems: 'No items',
    optional: 'Optional add-ons',
    subtotal: 'Subtotal',
    discount: 'Discount',
    tax: 'Tax',
    deposit: 'Deposit required',
    notes: 'Notes',
    terms: 'Terms & conditions',
  };

  return (
    <div className="bg-white text-[#1a1a1a]" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif', fontSize: '14px', lineHeight: '1.5' }}>
      <div className="px-10 py-10">

        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          <div>
            {data.company_logo_url ? (
              <img src={data.company_logo_url} alt={data.company_name} className="h-32 max-w-[440px] object-contain" />
            ) : (
              <p className="text-[18px] font-semibold tracking-tight text-[#0a0a0a]">{data.company_name}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[28px] font-semibold tracking-tight text-[#0a0a0a]">{L.quote}</p>
          </div>
        </div>

        {/* ── Meta ── */}
        <div className="mt-8 flex items-start justify-between">
          <div className="space-y-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">{L.from}</p>
              <div className="mt-1 text-[13px] text-[#374151] space-y-0.5">
                <p className="font-medium text-[#111]">{data.company_name}</p>
                {data.company_address && <p>{data.company_address}</p>}
                {data.company_email && <p>{data.company_email}</p>}
                {data.company_phone && <p>{data.company_phone}</p>}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">{L.preparedFor}</p>
              <div className="mt-1 text-[13px] text-[#374151] space-y-0.5">
                <p className="font-medium text-[#111]">{data.contact_name || '—'}</p>
                {data.contact_company && <p>{data.contact_company}</p>}
                {data.contact_address && <p>{data.contact_address}</p>}
                {data.contact_email && <p>{data.contact_email}</p>}
                {data.contact_phone && <p>{data.contact_phone}</p>}
              </div>
            </div>
          </div>
          <div className="text-right space-y-3">
            <StatusPill status={data.status} />
            <div className="space-y-2 text-[13px]">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">{L.quoteNumber}</p>
                <p className="mt-0.5 font-medium text-[#111]">{data.quote_number}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">{L.date}</p>
                <p className="mt-0.5 text-[#374151]">{fmtDate(data.created_at, locale)}</p>
              </div>
              {data.valid_until && (
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">{L.validUntil}</p>
                  <p className="mt-0.5 text-[#374151]">{fmtDate(data.valid_until, locale)}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Title + amount highlight ── */}
        <div className="mt-8 rounded-lg bg-[#f8fafc] border border-[#e2e8f0] px-6 py-5">
          <p className="text-[15px] font-semibold text-[#0a0a0a]">{data.title}</p>
          <div className="mt-2 flex items-center justify-between">
            <p className="text-[13px] text-[#6b7280]">{L.estimatedTotal}</p>
            <p className="text-[24px] font-semibold tracking-tight text-[#0a0a0a]">{fmt(data.total_cents)}</p>
          </div>
        </div>

        {/* ── Introduction ── */}
        {data.introduction && (
          <div className="mt-6 text-[13px] text-[#6b7280] leading-relaxed whitespace-pre-wrap">
            {data.introduction}
          </div>
        )}

        {/* ── Line Items ── */}
        <div className="mt-8">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5e7eb]">
                <th className="pb-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">{L.description}</th>
                <th className="pb-3 text-right text-[11px] font-medium uppercase tracking-wider text-[#6b7280] w-16">{L.qty}</th>
                <th className="pb-3 text-right text-[11px] font-medium uppercase tracking-wider text-[#6b7280] w-28">{L.price}</th>
                <th className="pb-3 text-right text-[11px] font-medium uppercase tracking-wider text-[#6b7280] w-28">{L.total}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => <ItemRow key={item.id} item={item} fmt={fmt} />)}
              {data.items.length === 0 && (
                <tr><td colSpan={4} className="py-10 text-center text-[13px] text-[#9ca3af]">{L.noItems}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Optional Items ── */}
        {data.optional_items.length > 0 && (
          <div className="mt-6">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280] mb-3">{L.optional}</p>
            <table className="w-full">
              <tbody>
                {data.optional_items.map((item) => <ItemRow key={item.id} item={item} fmt={fmt} />)}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Totals ── */}
        <div className="mt-4 flex justify-end">
          <div className="w-72 space-y-2 text-[13px]">
            <div className="flex justify-between py-1">
              <span className="text-[#6b7280]">{L.subtotal}</span>
              <span className="tabular-nums text-[#374151]">{fmt(data.subtotal_cents)}</span>
            </div>
            {data.discount_cents > 0 && (
              <div className="flex justify-between py-1 text-[#dc2626]">
                <span>{L.discount}</span>
                <span className="tabular-nums">−{fmt(data.discount_cents)}</span>
              </div>
            )}
            {data.tax_cents > 0 && (
              <div className="flex justify-between py-1">
                <span className="text-[#6b7280]">{data.tax_rate_label || L.tax} ({data.tax_rate}%)</span>
                <span className="tabular-nums text-[#374151]">{fmt(data.tax_cents)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-[#e5e7eb] pt-3 pb-1">
              <span className="font-semibold text-[#111]">{L.total}</span>
              <span className="font-semibold tabular-nums text-[#111]">{fmt(data.total_cents)}</span>
            </div>
            {data.deposit_required && data.deposit_cents > 0 && (
              <div className="flex justify-between py-1.5 px-3 rounded-lg bg-[#f8fafc] border border-[#e2e8f0] text-[12px]">
                <span className="text-[#6b7280]">{L.deposit}</span>
                <span className="font-semibold text-[#111] tabular-nums">{fmt(data.deposit_cents)}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Notes ── */}
        {data.notes && (
          <div className="mt-10 border-t border-[#f3f4f6] pt-6">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">{L.notes}</p>
            <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-[#6b7280]">{data.notes}</p>
          </div>
        )}

        {/* ── Terms ── */}
        {data.contract_disclaimer && (
          <div className="mt-6 border-t border-[#f3f4f6] pt-6">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">{L.terms}</p>
            <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[#9ca3af]">{data.contract_disclaimer}</p>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="mt-12 pt-6 border-t border-[#f3f4f6] text-center">
          <p className="text-[11px] text-[#9ca3af]">{data.company_name}</p>
        </div>
      </div>
    </div>
  );
}
