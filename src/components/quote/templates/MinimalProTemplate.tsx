import React from 'react';
import type { QuoteRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';
import { useTranslation } from '../../../i18n';

/* ── Minimal Pro — Quote Template ───────────────────────────────
   Ultra-clean, black/white/gray, Stripe-like sobriety.
   Focus: readability, trust, conversion.
   ────────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null | undefined, locale: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

const STATUS_MAP: Record<string, { label: string; labelFr: string; bg: string; fg: string }> = {
  draft:             { label: 'Draft',            labelFr: 'Brouillon',               bg: '#f1f5f9', fg: '#475569' },
  sent:              { label: 'Sent',             labelFr: 'Envoyée',                 bg: '#f0f9ff', fg: '#0369a1' },
  awaiting_response: { label: 'Pending',          labelFr: 'En attente',              bg: '#fffbeb', fg: '#a16207' },
  changes_requested: { label: 'Changes Requested', labelFr: 'Modifications demandées', bg: '#fef2f2', fg: '#b91c1c' },
  archived:          { label: 'Archived',  labelFr: 'Archivée',  bg: '#f1f5f9', fg: '#64748b' },
  approved:          { label: 'Approved',         labelFr: 'Approuvée',               bg: '#f0fdf4', fg: '#15803d' },
  declined:          { label: 'Declined',         labelFr: 'Refusée',                 bg: '#fef2f2', fg: '#b91c1c' },
  expired:           { label: 'Expired',          labelFr: 'Expirée',                 bg: '#f1f5f9', fg: '#64748b' },
  converted:         { label: 'Converted',        labelFr: 'Convertie',               bg: '#f0fdf4', fg: '#15803d' },
};

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LABELS_FR = ['Jan', 'Fév', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

export default function MinimalProTemplate({ data }: { data: QuoteRenderData }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const locale = fr ? 'fr-CA' : 'en-CA';
  const fmt = (c: number) => formatMoneyFromCents(c, data.currency, locale);
  const st = STATUS_MAP[data.status] || STATUS_MAP.draft;
  const stLabel = fr ? st.labelFr : st.label;
  const monthLabels = fr ? MONTH_LABELS_FR : MONTH_LABELS;
  const L = fr ? {
    quote: 'Soumission',
    from: 'De',
    preparedFor: 'Préparé pour',
    quoteNo: 'Soumission nº',
    date: 'Date',
    validUntil: 'Valide jusqu\'au',
    quoteTotal: 'Total de la soumission',
    servicePlan: 'Plan de service',
    visit: 'visite',
    planPricing: 'Les prix ci-dessous couvrent toutes les visites prévues du plan de service.',
    description: 'Description',
    qty: 'Qté',
    rate: 'Prix',
    amount: 'Montant',
    noItems: 'Aucun élément',
    optional: 'Optionnel',
    subtotal: 'Sous-total',
    discount: 'Rabais',
    tax: 'Taxes',
    total: 'Total',
    deposit: 'Dépôt requis',
    depositDue: 'Payable à l\'acceptation pour confirmer cette soumission',
    notes: 'Notes',
    terms: 'Termes et conditions',
  } : {
    quote: 'Quote',
    from: 'From',
    preparedFor: 'Prepared for',
    quoteNo: 'Quote #',
    date: 'Date',
    validUntil: 'Valid until',
    quoteTotal: 'Quote Total',
    servicePlan: 'Service Plan',
    visit: 'visit',
    planPricing: 'Pricing below covers all planned visits of the service plan.',
    description: 'Description',
    qty: 'Qty',
    rate: 'Rate',
    amount: 'Amount',
    noItems: 'No items',
    optional: 'Optional',
    subtotal: 'Subtotal',
    discount: 'Discount',
    tax: 'Tax',
    total: 'Total',
    deposit: 'Deposit Required',
    depositDue: 'Due upon acceptance to confirm this quote',
    notes: 'Notes',
    terms: 'Terms & Conditions',
  };
  const images = data.images || [];
  const plan = data.service_plan && data.service_plan.visits?.length > 0 ? data.service_plan : null;
  const planByMonth: Record<number, string> = {};
  if (plan) for (const v of plan.visits) planByMonth[v.month] = v.date;

  return (
    <div className="bg-white text-[#111]" style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",sans-serif', fontSize: '13px', lineHeight: 1.55 }}>
      <div className="px-10 py-10">

        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          <div>
            {data.company_logo_url
              ? <img src={data.company_logo_url} alt={data.company_name} className="h-28 max-w-[400px] object-contain" />
              : <p className="text-[20px] font-semibold tracking-tight">{data.company_name}</p>}
          </div>
          <p className="text-[28px] font-semibold tracking-tight text-[#111]">{L.quote}</p>
        </div>

        {/* ── Photos (top of the quote) ── */}
        {images.length > 0 && (
          <div className={`mt-6 grid gap-2 ${images.length === 1 ? 'grid-cols-1' : images.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {images.slice(0, 6).map((url) => (
              <div key={url} className="overflow-hidden rounded-lg border border-[#e5e7eb]" style={{ aspectRatio: '16 / 10' }}>
                <img src={url} alt="" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        )}

        {/* ── Meta ── */}
        <div className="mt-8 flex justify-between">
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-[#9ca3af]">{L.from}</p>
              <div className="mt-1.5 text-[12px] text-[#4b5563] space-y-0.5">
                <p className="font-medium text-[#111]">{data.company_name}</p>
                {data.company_address && <p>{data.company_address}</p>}
                {data.company_email && <p>{data.company_email}</p>}
                {data.company_phone && <p>{data.company_phone}</p>}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-[#9ca3af]">{L.preparedFor}</p>
              <div className="mt-1.5 text-[12px] text-[#4b5563] space-y-0.5">
                <p className="font-medium text-[#111]">{data.contact_name}</p>
                {data.contact_company && <p>{data.contact_company}</p>}
                {data.contact_address && <p>{data.contact_address}</p>}
                {data.contact_email && <p>{data.contact_email}</p>}
                {data.contact_phone && <p>{data.contact_phone}</p>}
              </div>
            </div>
          </div>
          <div className="text-right space-y-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ backgroundColor: st.bg, color: st.fg }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: st.fg }} />{stLabel}
            </span>
            <div className="text-[12px] text-[#6b7280] space-y-1">
              <div><span className="text-[10px] uppercase tracking-wider font-medium text-[#9ca3af] block">{L.quoteNo}</span>{data.quote_number}</div>
              <div><span className="text-[10px] uppercase tracking-wider font-medium text-[#9ca3af] block">{L.date}</span>{fmtDate(data.created_at, locale)}</div>
              {data.valid_until && <div><span className="text-[10px] uppercase tracking-wider font-medium text-[#9ca3af] block">{L.validUntil}</span>{fmtDate(data.valid_until, locale)}</div>}
            </div>
          </div>
        </div>

        {/* ── Title + Amount ── */}
        <div className="mt-8 flex items-center justify-between rounded-lg border border-[#e5e7eb] bg-[#fafafa] px-6 py-4">
          <p className="text-[13px] font-medium text-[#6b7280]">{data.title || L.quoteTotal}</p>
          <p className="text-[24px] font-semibold tracking-tight">{fmt(data.total_cents)}</p>
        </div>

        {/* ── Service plan schedule (quote_type = 'service_plan') ── */}
        {plan && (
          <div className="mt-6">
            <p className="text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] mb-2">
              {L.servicePlan} — {plan.year} · {plan.visits.length} {L.visit}{plan.visits.length > 1 ? 's' : ''}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {monthLabels.map((label, i) => {
                const month = i + 1;
                const date = planByMonth[month];
                return (
                  <div
                    key={month}
                    className={`rounded-lg px-2.5 py-2 border ${date ? 'border-[#111] bg-[#fafafa]' : 'border-[#e5e7eb]'}`}
                  >
                    <p className={`text-[9px] font-semibold uppercase tracking-wider ${date ? 'text-[#111]' : 'text-[#d1d5db]'}`}>{label}</p>
                    <p className={`text-[11px] mt-0.5 font-medium tabular-nums ${date ? 'text-[#111]' : 'text-[#e5e7eb]'}`}>
                      {date ? fmtDate(date, locale) : '—'}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[10.5px] text-[#9ca3af]">{L.planPricing}</p>
          </div>
        )}

        {/* ── Introduction ── */}
        {data.introduction && (
          <p className="mt-6 text-[12px] leading-relaxed text-[#6b7280] whitespace-pre-wrap">{data.introduction}</p>
        )}

        {/* ── Items ── */}
        <div className="mt-8">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5e7eb]">
                <th className="pb-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-[#9ca3af]">{L.description}</th>
                <th className="pb-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] w-14">{L.qty}</th>
                <th className="pb-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] w-24">{L.rate}</th>
                <th className="pb-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] w-24">{L.amount}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(item => (
                <tr key={item.id} className="border-b border-[#f3f4f6]">
                  <td className="py-3 pr-4 text-[12px]">
                    <p className="font-medium text-[#111]">{item.name}</p>
                    {item.description && <p className="text-[11px] text-[#9ca3af] mt-0.5">{item.description}</p>}
                  </td>
                  <td className="py-3 text-right text-[12px] text-[#6b7280] tabular-nums">{item.qty}</td>
                  <td className="py-3 text-right text-[12px] text-[#6b7280] tabular-nums">{fmt(item.unit_price_cents)}</td>
                  <td className="py-3 text-right text-[12px] font-medium tabular-nums">{fmt(item.total_cents)}</td>
                </tr>
              ))}
              {data.items.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-[12px] text-[#d1d5db]">{L.noItems}</td></tr>}
            </tbody>
          </table>
        </div>

        {/* ── Optional items ── */}
        {data.optional_items.length > 0 && (
          <div className="mt-5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] mb-2">{L.optional}</p>
            {data.optional_items.map(item => (
              <div key={item.id} className="flex justify-between py-2 border-b border-dashed border-[#e5e7eb] text-[12px] text-[#9ca3af] italic">
                <span>{item.name}</span><span className="tabular-nums">{fmt(item.total_cents)}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Totals ── */}
        <div className="mt-3 flex justify-end">
          <div className="w-64 text-[12px]">
            <div className="flex justify-between py-1.5"><span className="text-[#9ca3af]">{L.subtotal}</span><span className="tabular-nums">{fmt(data.subtotal_cents)}</span></div>
            {data.discount_cents > 0 && <div className="flex justify-between py-1.5 text-[#dc2626]"><span>{L.discount}</span><span className="tabular-nums">-{fmt(data.discount_cents)}</span></div>}
            <div className="flex justify-between py-1.5"><span className="text-[#9ca3af]">{data.tax_rate_label || L.tax}</span><span className="tabular-nums">{fmt(data.tax_cents)}</span></div>
            <div className="flex justify-between pt-2.5 mt-1 border-t border-[#e5e7eb] text-[14px] font-semibold"><span>{L.total}</span><span className="tabular-nums">{fmt(data.total_cents)}</span></div>
          </div>
        </div>

        {/* ── Deposit ── */}
        {data.deposit_required && data.deposit_cents > 0 && (
          <div className="mt-6 rounded-lg border border-[#111] bg-[#fafafa] px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-semibold">{L.deposit}</p>
              <p className="text-[11px] text-[#6b7280] mt-0.5">{L.depositDue}</p>
            </div>
            <p className="text-[20px] font-bold">{fmt(data.deposit_cents)}</p>
          </div>
        )}

        {/* ── Notes & Terms ── */}
        {data.notes && (
          <div className="mt-8 border-t border-[#f3f4f6] pt-5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] mb-1.5">{L.notes}</p>
            <p className="text-[11px] text-[#6b7280] whitespace-pre-wrap leading-relaxed">{data.notes}</p>
          </div>
        )}
        {data.contract_disclaimer && (
          <div className="mt-5 border-t border-[#f3f4f6] pt-5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] mb-1.5">{L.terms}</p>
            <p className="text-[11px] text-[#9ca3af] whitespace-pre-wrap leading-relaxed">{data.contract_disclaimer}</p>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="mt-10 border-t border-[#f3f4f6] pt-5 text-center">
          <p className="text-[10px] text-[#d1d5db]">{data.company_name}</p>
        </div>
      </div>
    </div>
  );
}
