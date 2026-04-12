import React from 'react';
import type { QuoteRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';

/* ── Minimal Pro — Quote Template ───────────────────────────────
   Ultra-clean, black/white/gray, Stripe-like sobriety.
   Focus: readability, trust, conversion.
   ────────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const STATUS_MAP: Record<string, { label: string; bg: string; fg: string }> = {
  draft:             { label: 'Draft',            bg: '#f1f5f9', fg: '#475569' },
  sent:              { label: 'Sent',             bg: '#f0f9ff', fg: '#0369a1' },
  awaiting_response: { label: 'Pending',          bg: '#fffbeb', fg: '#a16207' },
  approved:          { label: 'Approved',         bg: '#f0fdf4', fg: '#15803d' },
  declined:          { label: 'Declined',         bg: '#fef2f2', fg: '#b91c1c' },
  expired:           { label: 'Expired',          bg: '#f1f5f9', fg: '#64748b' },
  converted:         { label: 'Converted',        bg: '#f0fdf4', fg: '#15803d' },
};

export default function MinimalProTemplate({ data }: { data: QuoteRenderData }) {
  const fmt = (c: number) => formatMoneyFromCents(c, data.currency);
  const st = STATUS_MAP[data.status] || STATUS_MAP.draft;

  return (
    <div className="bg-white text-[#111]" style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",sans-serif', fontSize: '13px', lineHeight: 1.55 }}>
      <div className="px-10 py-10">

        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          <div>
            {data.company_logo_url
              ? <img src={data.company_logo_url} alt={data.company_name} className="h-9 max-w-[160px] object-contain" />
              : <p className="text-[20px] font-semibold tracking-tight">{data.company_name}</p>}
          </div>
          <p className="text-[28px] font-semibold tracking-tight text-[#111]">Quote</p>
        </div>

        {/* ── Meta ── */}
        <div className="mt-8 flex justify-between">
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-[#9ca3af]">From</p>
              <div className="mt-1.5 text-[12px] text-[#4b5563] space-y-0.5">
                <p className="font-medium text-[#111]">{data.company_name}</p>
                {data.company_address && <p>{data.company_address}</p>}
                {data.company_email && <p>{data.company_email}</p>}
                {data.company_phone && <p>{data.company_phone}</p>}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-[#9ca3af]">Prepared for</p>
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
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: st.fg }} />{st.label}
            </span>
            <div className="text-[12px] text-[#6b7280] space-y-1">
              <div><span className="text-[10px] uppercase tracking-wider font-medium text-[#9ca3af] block">Quote #</span>{data.quote_number}</div>
              <div><span className="text-[10px] uppercase tracking-wider font-medium text-[#9ca3af] block">Date</span>{fmtDate(data.created_at)}</div>
              {data.valid_until && <div><span className="text-[10px] uppercase tracking-wider font-medium text-[#9ca3af] block">Valid until</span>{fmtDate(data.valid_until)}</div>}
            </div>
          </div>
        </div>

        {/* ── Title + Amount ── */}
        <div className="mt-8 flex items-center justify-between rounded-lg border border-[#e5e7eb] bg-[#fafafa] px-6 py-4">
          <p className="text-[13px] font-medium text-[#6b7280]">{data.title || 'Quote Total'}</p>
          <p className="text-[24px] font-semibold tracking-tight">{fmt(data.total_cents)}</p>
        </div>

        {/* ── Introduction ── */}
        {data.introduction && (
          <p className="mt-6 text-[12px] leading-relaxed text-[#6b7280] whitespace-pre-wrap">{data.introduction}</p>
        )}

        {/* ── Items ── */}
        <div className="mt-8">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5e7eb]">
                <th className="pb-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-[#9ca3af]">Description</th>
                <th className="pb-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] w-14">Qty</th>
                <th className="pb-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] w-24">Rate</th>
                <th className="pb-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] w-24">Amount</th>
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
              {data.items.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-[12px] text-[#d1d5db]">No items</td></tr>}
            </tbody>
          </table>
        </div>

        {/* ── Optional items ── */}
        {data.optional_items.length > 0 && (
          <div className="mt-5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] mb-2">Optional</p>
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
            <div className="flex justify-between py-1.5"><span className="text-[#9ca3af]">Subtotal</span><span className="tabular-nums">{fmt(data.subtotal_cents)}</span></div>
            {data.discount_cents > 0 && <div className="flex justify-between py-1.5 text-[#dc2626]"><span>Discount</span><span className="tabular-nums">-{fmt(data.discount_cents)}</span></div>}
            <div className="flex justify-between py-1.5"><span className="text-[#9ca3af]">{data.tax_rate_label || 'Tax'}</span><span className="tabular-nums">{fmt(data.tax_cents)}</span></div>
            <div className="flex justify-between pt-2.5 mt-1 border-t border-[#e5e7eb] text-[14px] font-semibold"><span>Total</span><span className="tabular-nums">{fmt(data.total_cents)}</span></div>
          </div>
        </div>

        {/* ── Deposit ── */}
        {data.deposit_required && data.deposit_cents > 0 && (
          <div className="mt-6 rounded-lg border border-[#111] bg-[#fafafa] px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-semibold">Deposit Required</p>
              <p className="text-[11px] text-[#6b7280] mt-0.5">Due upon acceptance to confirm this quote</p>
            </div>
            <p className="text-[20px] font-bold">{fmt(data.deposit_cents)}</p>
          </div>
        )}

        {/* ── Notes & Terms ── */}
        {data.notes && (
          <div className="mt-8 border-t border-[#f3f4f6] pt-5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] mb-1.5">Notes</p>
            <p className="text-[11px] text-[#6b7280] whitespace-pre-wrap leading-relaxed">{data.notes}</p>
          </div>
        )}
        {data.contract_disclaimer && (
          <div className="mt-5 border-t border-[#f3f4f6] pt-5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] mb-1.5">Terms & Conditions</p>
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
