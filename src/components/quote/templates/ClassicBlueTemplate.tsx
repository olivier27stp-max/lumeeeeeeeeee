import React from 'react';
import type { QuoteRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';

/* ── Classic Blue Quote Template ────────────────────────────────
   Navy blue header, corporate layout adapted for quotes.
   ────────────────────────────────────────────────────────────── */

const NAVY = '#1a2b5e';
const BORDER = '#d1d5db';
const TEXT_SEC = '#6b7280';
const BG_LIGHT = '#f0f4ff';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    draft:              { bg: '#f1f5f9', text: '#475569' },
    sent:               { bg: '#eff6ff', text: '#1d4ed8' },
    awaiting_response:  { bg: '#fefce8', text: '#a16207' },
    approved:           { bg: '#f0fdf4', text: '#15803d' },
    declined:           { bg: '#fef2f2', text: '#b91c1c' },
    expired:            { bg: '#f1f5f9', text: '#64748b' },
    converted:          { bg: '#f0fdf4', text: '#15803d' },
  };
  const c = colors[status] || colors.draft;
  const label = status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ backgroundColor: c.bg, color: c.text }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.text }} />
      {label}
    </span>
  );
}

export default function ClassicBlueTemplate({ data }: { data: QuoteRenderData }) {
  const fmt = (cents: number) => formatMoneyFromCents(cents, data.currency);

  return (
    <div className="bg-white text-[#262626]" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif', fontSize: '13px', lineHeight: '1.5' }}>

      {/* ── Navy Top Bar ── */}
      <div style={{ backgroundColor: NAVY }} className="px-10 py-6 flex items-start justify-between">
        <div className="text-white">
          {data.company_logo_url ? (
            <img src={data.company_logo_url} alt={data.company_name} className="h-10 max-w-[180px] object-contain brightness-0 invert" />
          ) : (
            <p className="text-[20px] font-bold tracking-tight">{data.company_name}</p>
          )}
          <div className="mt-2 text-[11px] text-white/70 space-y-0.5">
            {data.company_address && <p>{data.company_address}</p>}
            {data.company_phone && <p>{data.company_phone}</p>}
            {data.company_email && <p>{data.company_email}</p>}
          </div>
        </div>
        <div className="text-right text-white">
          <p className="text-[28px] font-bold tracking-tight">QUOTE</p>
          <div className="mt-1 text-[11px] text-white/70 space-y-0.5">
            <p>Quote # <span className="text-white font-medium">{data.quote_number}</span></p>
            <p>Date: <span className="text-white font-medium">{fmtDate(data.created_at)}</span></p>
            {data.valid_until && <p>Valid Until: <span className="text-white font-medium">{fmtDate(data.valid_until)}</span></p>}
          </div>
        </div>
      </div>

      <div className="px-10 py-8">

        {/* ── Prepared For + Total ── */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: NAVY }}>Prepared For</p>
            <div className="mt-2 text-[13px] space-y-0.5">
              <p className="font-semibold text-[#111]">{data.contact_name}</p>
              {data.contact_company && <p style={{ color: TEXT_SEC }}>{data.contact_company}</p>}
              {data.contact_address && <p style={{ color: TEXT_SEC }}>{data.contact_address}</p>}
              {data.contact_phone && <p style={{ color: TEXT_SEC }}>{data.contact_phone}</p>}
              {data.contact_email && <p style={{ color: TEXT_SEC }}>{data.contact_email}</p>}
            </div>
          </div>
          <div className="text-right">
            <StatusPill status={data.status} />
            <p className="text-[10px] font-bold uppercase tracking-widest mt-3" style={{ color: NAVY }}>Quote Total</p>
            <p className="text-[28px] font-bold mt-1" style={{ color: NAVY }}>{fmt(data.total_cents)}</p>
          </div>
        </div>

        {/* ── Title ── */}
        {data.title && (
          <div className="mt-5 px-4 py-2.5 rounded" style={{ backgroundColor: BG_LIGHT }}>
            <p className="text-[13px] font-semibold" style={{ color: NAVY }}>{data.title}</p>
          </div>
        )}

        {/* ── Introduction ── */}
        {data.introduction && (
          <div className="mt-5">
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed" style={{ color: TEXT_SEC }}>{data.introduction}</p>
          </div>
        )}

        {/* ── Line Items Table ── */}
        <div className="mt-6">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ backgroundColor: NAVY }}>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-white">Description</th>
                <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-white w-16">Qty</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-white w-28">Rate</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-white w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={item.id} style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#f9fafb', borderBottom: `1px solid ${BORDER}` }}>
                  <td className="px-4 py-3 text-[12px]">
                    <p className="font-medium text-[#111]">{item.name}</p>
                    {item.description && <p className="text-[11px] mt-0.5" style={{ color: TEXT_SEC }}>{item.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-center text-[12px] tabular-nums" style={{ color: TEXT_SEC }}>{item.qty}</td>
                  <td className="px-4 py-3 text-right text-[12px] tabular-nums" style={{ color: TEXT_SEC }}>{fmt(item.unit_price_cents)}</td>
                  <td className="px-4 py-3 text-right text-[12px] font-medium tabular-nums text-[#111]">{fmt(item.total_cents)}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr><td colSpan={4} className="py-10 text-center text-[12px] text-[#9ca3af]">No line items</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Optional Items ── */}
        {data.optional_items.length > 0 && (
          <div className="mt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: NAVY }}>Optional Add-ons</p>
            <table className="w-full border-collapse">
              <tbody>
                {data.optional_items.map((item) => (
                  <tr key={item.id} className="border-b border-dashed" style={{ borderColor: BORDER }}>
                    <td className="px-4 py-2 text-[12px] italic text-[#666]">
                      {item.name}
                      {item.description && <span className="ml-2 text-[11px]" style={{ color: TEXT_SEC }}>- {item.description}</span>}
                    </td>
                    <td className="px-4 py-2 text-center text-[12px] tabular-nums w-16" style={{ color: TEXT_SEC }}>{item.qty}</td>
                    <td className="px-4 py-2 text-right text-[12px] tabular-nums w-28" style={{ color: TEXT_SEC }}>{fmt(item.unit_price_cents)}</td>
                    <td className="px-4 py-2 text-right text-[12px] tabular-nums font-medium w-28 text-[#666]">{fmt(item.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Totals ── */}
        <div className="mt-1 flex justify-end">
          <div className="w-72 text-[12px]">
            <div className="flex justify-between py-2 border-b" style={{ borderColor: BORDER }}>
              <span style={{ color: TEXT_SEC }}>Subtotal</span>
              <span className="tabular-nums font-medium">{fmt(data.subtotal_cents)}</span>
            </div>
            {data.discount_cents > 0 && (
              <div className="flex justify-between py-2 border-b text-[#dc2626]" style={{ borderColor: BORDER }}>
                <span>Discount</span>
                <span className="tabular-nums">-{fmt(data.discount_cents)}</span>
              </div>
            )}
            <div className="flex justify-between py-2 border-b" style={{ borderColor: BORDER }}>
              <span style={{ color: TEXT_SEC }}>{data.tax_rate_label || 'Tax'}</span>
              <span className="tabular-nums">{fmt(data.tax_cents)}</span>
            </div>
            <div className="flex justify-between py-3 font-bold text-[14px] text-white" style={{ backgroundColor: NAVY, margin: '0 -16px', padding: '10px 16px' }}>
              <span>TOTAL</span>
              <span className="tabular-nums">{fmt(data.total_cents)}</span>
            </div>
            {data.deposit_required && data.deposit_cents > 0 && (
              <div className="flex justify-between py-2 mt-1">
                <span className="font-semibold" style={{ color: TEXT_SEC }}>Deposit Required</span>
                <span className="tabular-nums font-semibold">{fmt(data.deposit_cents)}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Notes ── */}
        {data.notes && (
          <div className="mt-8 border-t pt-5" style={{ borderColor: BORDER }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: NAVY }}>Notes</p>
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed" style={{ color: TEXT_SEC }}>{data.notes}</p>
          </div>
        )}

        {/* ── Terms ── */}
        {data.contract_disclaimer && (
          <div className="mt-5 border-t pt-5" style={{ borderColor: BORDER }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: NAVY }}>Terms & Conditions</p>
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed" style={{ color: TEXT_SEC }}>{data.contract_disclaimer}</p>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="mt-10 pt-5 border-t text-center" style={{ borderColor: BORDER }}>
          <p className="text-[11px]" style={{ color: TEXT_SEC }}>
            If you have any questions about this quote, please contact
          </p>
          <p className="text-[11px] font-medium" style={{ color: NAVY }}>
            {data.company_email || data.company_name}
          </p>
          <p className="text-[13px] font-semibold mt-3" style={{ color: NAVY }}>Thank You For Your Business!</p>
        </div>
      </div>
    </div>
  );
}
