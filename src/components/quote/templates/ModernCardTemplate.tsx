import React from 'react';
import type { QuoteRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';

/* ── Modern Card — Quote Template ───────────────────────────────
   Card-based sections, rounded corners, modern SaaS feel.
   Focus: visual hierarchy, clear sections, professionalism.
   ────────────────────────────────────────────────────────────── */

const ACCENT = '#2563eb';

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const STATUS_MAP: Record<string, { label: string; bg: string; fg: string }> = {
  draft:             { label: 'Draft',     bg: '#f1f5f9', fg: '#475569' },
  sent:              { label: 'Sent',      bg: '#dbeafe', fg: '#1d4ed8' },
  awaiting_response: { label: 'Pending',   bg: '#fef3c7', fg: '#a16207' },
  approved:          { label: 'Approved',  bg: '#dcfce7', fg: '#15803d' },
  declined:          { label: 'Declined',  bg: '#fecaca', fg: '#b91c1c' },
  expired:           { label: 'Expired',   bg: '#f1f5f9', fg: '#64748b' },
  converted:         { label: 'Converted', bg: '#dcfce7', fg: '#15803d' },
};

export default function ModernCardTemplate({ data }: { data: QuoteRenderData }) {
  const fmt = (c: number) => formatMoneyFromCents(c, data.currency);
  const st = STATUS_MAP[data.status] || STATUS_MAP.draft;

  return (
    <div className="bg-[#f8fafc] text-[#111]" style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",sans-serif', fontSize: '13px', lineHeight: 1.55 }}>

      {/* ── Accent bar ── */}
      <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT}99)` }} />

      <div className="px-8 py-8 space-y-5">

        {/* ── Header card ── */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
          <div className="flex items-start justify-between">
            <div>
              {data.company_logo_url
                ? <img src={data.company_logo_url} alt={data.company_name} className="h-9 max-w-[160px] object-contain" />
                : <p className="text-[18px] font-bold tracking-tight">{data.company_name}</p>}
              <p className="text-[11px] text-[#9ca3af] mt-1">{[data.company_address, data.company_phone, data.company_email].filter(Boolean).join(' \u00b7 ')}</p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2 justify-end">
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ backgroundColor: st.bg, color: st.fg }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: st.fg }} />{st.label}
                </span>
              </div>
              <p className="text-[11px] text-[#9ca3af] mt-2">#{data.quote_number}</p>
              <p className="text-[11px] text-[#9ca3af]">{fmtDate(data.created_at)}</p>
            </div>
          </div>
        </div>

        {/* ── Client + Details cards ── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: ACCENT }}>Client</p>
            <p className="text-[14px] font-semibold">{data.contact_name}</p>
            <div className="text-[11px] text-[#6b7280] mt-1 space-y-0.5">
              {data.contact_company && <p>{data.contact_company}</p>}
              {data.contact_address && <p>{data.contact_address}</p>}
              {data.contact_email && <p>{data.contact_email}</p>}
              {data.contact_phone && <p>{data.contact_phone}</p>}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: ACCENT }}>Details</p>
            <div className="text-[12px] space-y-1.5">
              {data.title && <div className="flex justify-between"><span className="text-[#9ca3af]">Subject</span><span className="font-medium">{data.title}</span></div>}
              <div className="flex justify-between"><span className="text-[#9ca3af]">Date</span><span>{fmtDate(data.created_at)}</span></div>
              {data.valid_until && <div className="flex justify-between"><span className="text-[#9ca3af]">Valid until</span><span>{fmtDate(data.valid_until)}</span></div>}
              <div className="flex justify-between pt-1.5 mt-1.5 border-t border-[#f3f4f6]"><span className="font-semibold">Total</span><span className="font-bold text-[14px]">{fmt(data.total_cents)}</span></div>
            </div>
          </div>
        </div>

        {/* ── Introduction ── */}
        {data.introduction && (
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-5">
            <p className="text-[12px] text-[#6b7280] leading-relaxed whitespace-pre-wrap">{data.introduction}</p>
          </div>
        )}

        {/* ── Line items card ── */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
          <div className="px-5 py-3 border-b border-[#f3f4f6]">
            <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: ACCENT }}>Services</p>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#f3f4f6] bg-[#fafafa]">
                <th className="px-5 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-[#9ca3af]">Description</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] w-14">Qty</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] w-24">Price</th>
                <th className="px-5 py-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] w-24">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(item => (
                <tr key={item.id} className="border-b border-[#f3f4f6]">
                  <td className="px-5 py-3 text-[12px]">
                    <p className="font-medium">{item.name}</p>
                    {item.description && <p className="text-[11px] text-[#9ca3af] mt-0.5">{item.description}</p>}
                  </td>
                  <td className="px-3 py-3 text-right text-[12px] text-[#6b7280] tabular-nums">{item.qty}</td>
                  <td className="px-3 py-3 text-right text-[12px] text-[#6b7280] tabular-nums">{fmt(item.unit_price_cents)}</td>
                  <td className="px-5 py-3 text-right text-[12px] font-medium tabular-nums">{fmt(item.total_cents)}</td>
                </tr>
              ))}
              {data.items.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-[12px] text-[#d1d5db]">No items</td></tr>}
            </tbody>
          </table>

          {/* Optional */}
          {data.optional_items.length > 0 && (
            <>
              <div className="px-5 py-2 bg-[#fafafa] border-t border-b border-[#f3f4f6]">
                <p className="text-[10px] font-medium uppercase tracking-widest text-[#9ca3af]">Optional add-ons</p>
              </div>
              {data.optional_items.map(item => (
                <div key={item.id} className="px-5 py-2.5 flex justify-between border-b border-dashed border-[#f3f4f6] text-[12px] text-[#9ca3af] italic">
                  <span>{item.name}</span><span className="tabular-nums">{fmt(item.total_cents)}</span>
                </div>
              ))}
            </>
          )}

          {/* Totals */}
          <div className="px-5 py-4 bg-[#fafafa]">
            <div className="flex justify-end">
              <div className="w-56 text-[12px] space-y-1.5">
                <div className="flex justify-between"><span className="text-[#9ca3af]">Subtotal</span><span className="tabular-nums">{fmt(data.subtotal_cents)}</span></div>
                {data.discount_cents > 0 && <div className="flex justify-between text-[#dc2626]"><span>Discount</span><span className="tabular-nums">-{fmt(data.discount_cents)}</span></div>}
                <div className="flex justify-between"><span className="text-[#9ca3af]">{data.tax_rate_label || 'Tax'}</span><span className="tabular-nums">{fmt(data.tax_cents)}</span></div>
                <div className="flex justify-between pt-2 mt-1 border-t border-[#e5e7eb] text-[15px] font-bold"><span>Total</span><span className="tabular-nums">{fmt(data.total_cents)}</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Deposit card ── */}
        {data.deposit_required && data.deposit_cents > 0 && (
          <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: ACCENT }}>
            <div className="px-5 py-3 text-white text-[11px] font-semibold uppercase tracking-widest" style={{ backgroundColor: ACCENT }}>Deposit Required</div>
            <div className="bg-white px-5 py-4 flex items-center justify-between">
              <p className="text-[12px] text-[#6b7280]">Due upon acceptance to secure scheduling</p>
              <p className="text-[22px] font-bold" style={{ color: ACCENT }}>{fmt(data.deposit_cents)}</p>
            </div>
          </div>
        )}

        {/* ── Notes & Terms ── */}
        {(data.notes || data.contract_disclaimer) && (
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-5 space-y-4">
            {data.notes && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9ca3af] mb-1.5">Notes</p>
                <p className="text-[11px] text-[#6b7280] whitespace-pre-wrap leading-relaxed">{data.notes}</p>
              </div>
            )}
            {data.contract_disclaimer && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9ca3af] mb-1.5">Terms & Conditions</p>
                <p className="text-[11px] text-[#9ca3af] whitespace-pre-wrap leading-relaxed">{data.contract_disclaimer}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="text-center pt-2">
          <p className="text-[10px] text-[#d1d5db]">{data.company_name}</p>
        </div>
      </div>
    </div>
  );
}
