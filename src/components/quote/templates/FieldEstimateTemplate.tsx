import React from 'react';
import type { QuoteRenderData, QuoteRenderItem } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';

/* ── Housecall Pro / ServiceTitan-inspired Field Estimate Template ─
   Dense, utilitarian, grouped services, prominent totals.
   Designed for on-site presentation on a tablet or print.
   ─────────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function FieldEstimateTemplate({ data }: { data: QuoteRenderData }) {
  const fmt = (cents: number) => formatMoneyFromCents(cents, data.currency);
  const dark = '#171717';

  // Group items by heading — items before any heading go into "Services"
  const groups: Array<{ heading: string; items: QuoteRenderItem[] }> = [];
  let currentGroup: { heading: string; items: QuoteRenderItem[] } = { heading: 'Services', items: [] };

  for (const item of data.items) {
    if (item.item_type === 'heading') {
      if (currentGroup.items.length > 0) groups.push(currentGroup);
      currentGroup = { heading: item.name, items: [] };
    } else {
      currentGroup.items.push(item);
    }
  }
  if (currentGroup.items.length > 0) groups.push(currentGroup);

  return (
    <div className="bg-white text-[#1a1a1a]" style={{ fontFamily: '"Inter", -apple-system, sans-serif', fontSize: '14px' }}>

      {/* ── Top bar ── */}
      <div className="h-2" style={{ backgroundColor: dark }} />

      <div className="px-8 py-6">

        {/* ── Header: two columns ── */}
        <div className="flex items-start justify-between gap-8">
          {/* Left: company */}
          <div>
            {data.company_logo_url ? (
              <img src={data.company_logo_url} alt={data.company_name} className="h-10 max-w-[180px] object-contain" />
            ) : (
              <p className="text-[18px] font-extrabold uppercase tracking-wide" style={{ color: dark }}>{data.company_name}</p>
            )}
            <div className="mt-2 text-[11px] text-[#6b7280] space-y-0.5">
              {data.company_address && <p>{data.company_address}</p>}
              {data.company_phone && <p>{data.company_phone}</p>}
              {data.company_email && <p>{data.company_email}</p>}
            </div>
          </div>
          {/* Right: estimate badge */}
          <div className="text-right">
            <div className="inline-block rounded-lg px-5 py-3" style={{ backgroundColor: dark }}>
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-400">Estimate</p>
              <p className="mt-0.5 text-[16px] font-extrabold text-white">{data.quote_number}</p>
            </div>
          </div>
        </div>

        {/* ── Info bar ── */}
        <div className="mt-6 grid grid-cols-2 gap-4">
          {/* Customer info */}
          <div className="rounded-lg border border-[#e5e7eb] p-4">
            <p className="text-[9px] font-bold uppercase tracking-wider text-[#9ca3af]">Customer</p>
            <p className="mt-2 text-[14px] font-bold text-[#111]">{data.contact_name || '—'}</p>
            {data.contact_company && <p className="text-[12px] text-[#6b7280]">{data.contact_company}</p>}
            <div className="mt-1 text-[12px] text-[#9ca3af] space-y-0.5">
              {data.contact_address && <p>{data.contact_address}</p>}
              {data.contact_phone && <p>{data.contact_phone}</p>}
              {data.contact_email && <p>{data.contact_email}</p>}
            </div>
          </div>
          {/* Job details */}
          <div className="rounded-lg bg-[#f8fafc] border border-[#e2e8f0] p-4">
            <p className="text-[9px] font-bold uppercase tracking-wider text-[#9ca3af]">Job Details</p>
            <p className="mt-2 text-[14px] font-semibold text-[#111]">{data.title}</p>
            <div className="mt-2 grid grid-cols-2 gap-y-1.5 text-[12px]">
              <span className="text-[#9ca3af]">Date</span>
              <span className="text-[#374151] font-medium">{fmtDate(data.created_at)}</span>
              {data.valid_until && <>
                <span className="text-[#9ca3af]">Valid until</span>
                <span className="text-[#374151] font-medium">{fmtDate(data.valid_until)}</span>
              </>}
              <span className="text-[#9ca3af]">Status</span>
              <span className="font-semibold" style={{
                color: data.status === 'approved' ? '#059669' : data.status === 'declined' ? '#dc2626' : '#374151',
              }}>
                {data.status.charAt(0).toUpperCase() + data.status.slice(1).replace(/_/g, ' ')}
              </span>
            </div>
          </div>
        </div>

        {/* ── Introduction / scope ── */}
        {data.introduction && (
          <div className="mt-6 rounded-lg border-l-4 bg-[#f8fafc] px-5 py-4" style={{ borderColor: dark }}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#9ca3af]">Scope of Work</p>
            <p className="mt-2 text-[13px] text-[#4b5563] leading-relaxed whitespace-pre-wrap">{data.introduction}</p>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            GROUPED LINE ITEMS — each group in its own card
            ═══════════════════════════════════════════════════════════ */}
        <div className="mt-6 space-y-4">
          {groups.map((group, gi) => {
            const groupTotal = group.items.reduce((sum, item) => sum + item.total_cents, 0);
            return (
              <div key={gi} className="rounded-lg border border-[#e5e7eb] overflow-hidden">
                {/* Group header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#e5e7eb]" style={{ backgroundColor: dark }}>
                  <p className="text-[12px] font-bold text-white uppercase tracking-wider">{group.heading}</p>
                  <p className="text-[12px] font-bold text-white tabular-nums">{fmt(groupTotal)}</p>
                </div>
                {/* Items */}
                <table className="w-full">
                  <tbody>
                    {group.items.map((item, ii) => (
                      <tr key={item.id} className={ii < group.items.length - 1 ? 'border-b border-[#f3f4f6]' : ''}>
                        <td className="px-5 py-3.5 text-[13px]">
                          <p className="font-medium text-[#111]">{item.name}</p>
                          {item.description && <p className="text-[11px] text-[#9ca3af] mt-0.5">{item.description}</p>}
                        </td>
                        <td className="px-3 py-3.5 text-center text-[13px] text-[#6b7280] tabular-nums w-14">{item.qty}</td>
                        <td className="px-3 py-3.5 text-right text-[13px] text-[#6b7280] tabular-nums w-24">{fmt(item.unit_price_cents)}</td>
                        <td className="px-5 py-3.5 text-right text-[13px] font-bold text-[#111] tabular-nums w-24">{fmt(item.total_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}

          {data.items.length === 0 && (
            <div className="rounded-lg border border-[#e5e7eb] py-10 text-center text-[13px] text-[#9ca3af]">
              No services listed
            </div>
          )}
        </div>

        {/* ── Optional items ── */}
        {data.optional_items.length > 0 && (
          <div className="mt-4 rounded-lg border border-dashed border-[#d1d5db] overflow-hidden">
            <div className="px-5 py-2.5 bg-[#fefce8] border-b border-[#fde68a] flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#92400e]">Optional Services</p>
            </div>
            <table className="w-full">
              <tbody>
                {data.optional_items.map((item, i) => (
                  <tr key={item.id} className={i < data.optional_items.length - 1 ? 'border-b border-[#f3f4f6]' : ''}>
                    <td className="px-5 py-3 text-[13px]">
                      <p className="text-[#6b7280]">{item.name}</p>
                      {item.description && <p className="text-[11px] text-[#9ca3af] mt-0.5">{item.description}</p>}
                    </td>
                    <td className="px-3 py-3 text-center text-[13px] text-[#9ca3af] tabular-nums w-14">{item.qty}</td>
                    <td className="px-3 py-3 text-right text-[13px] text-[#9ca3af] tabular-nums w-24">{fmt(item.unit_price_cents)}</td>
                    <td className="px-5 py-3 text-right text-[13px] font-semibold text-[#6b7280] tabular-nums w-24">{fmt(item.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TOTALS — prominent box
            ═══════════════════════════════════════════════════════════ */}
        <div className="mt-6 flex justify-end">
          <div className="w-80 rounded-lg border border-[#e5e7eb] overflow-hidden">
            <div className="space-y-0 text-[13px]">
              <div className="flex justify-between px-5 py-2.5">
                <span className="text-[#6b7280]">Subtotal</span>
                <span className="font-medium tabular-nums">{fmt(data.subtotal_cents)}</span>
              </div>
              {data.discount_cents > 0 && (
                <div className="flex justify-between px-5 py-2.5 text-[#059669]">
                  <span>Discount</span>
                  <span className="font-medium tabular-nums">−{fmt(data.discount_cents)}</span>
                </div>
              )}
              {data.tax_cents > 0 && (
                <div className="flex justify-between px-5 py-2.5 bg-[#f9fafb]">
                  <span className="text-[#6b7280]">{data.tax_rate_label || 'Tax'} ({data.tax_rate}%)</span>
                  <span className="font-medium tabular-nums">{fmt(data.tax_cents)}</span>
                </div>
              )}
              <div className="flex justify-between px-5 py-4 text-[16px] font-extrabold text-white" style={{ backgroundColor: dark }}>
                <span>TOTAL</span>
                <span className="tabular-nums">{fmt(data.total_cents)}</span>
              </div>
            </div>
            {data.deposit_required && data.deposit_cents > 0 && (
              <div className="flex justify-between px-5 py-3 text-[12px] bg-[#eff6ff] border-t border-[#bfdbfe]">
                <span className="text-[#1d4ed8] font-medium">Deposit required</span>
                <span className="font-bold text-[#1d4ed8] tabular-nums">{fmt(data.deposit_cents)}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Notes ── */}
        {data.notes && (
          <div className="mt-8 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] p-5">
            <p className="text-[9px] font-bold uppercase tracking-wider text-[#9ca3af]">Notes</p>
            <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-[#4b5563]">{data.notes}</p>
          </div>
        )}

        {/* ── Terms ── */}
        {data.contract_disclaimer && (
          <div className="mt-4 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] p-5">
            <p className="text-[9px] font-bold uppercase tracking-wider text-[#9ca3af]">Work Authorization & Terms</p>
            <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[#9ca3af]">{data.contract_disclaimer}</p>
          </div>
        )}

        {/* ── Authorization line ── */}
        <div className="mt-8 border-t border-[#e5e7eb] pt-6">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] mb-6">Authorization</p>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <div className="h-px bg-[#d1d5db] mb-2" />
              <p className="text-[11px] text-[#9ca3af]">Customer signature</p>
            </div>
            <div>
              <div className="h-px bg-[#d1d5db] mb-2" />
              <p className="text-[11px] text-[#9ca3af]">Date</p>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="mt-8 border-t border-[#e5e7eb] pt-4 text-center text-[10px] text-[#d1d5db]">
          <p className="font-medium">{data.company_name}</p>
          {data.company_phone && <p>{data.company_phone} · {data.company_email}</p>}
        </div>
      </div>
    </div>
  );
}
