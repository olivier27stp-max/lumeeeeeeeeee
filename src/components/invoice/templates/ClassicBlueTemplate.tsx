import React from 'react';
import type { InvoiceRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';

/* ── Classic Blue Template ──────────────────────────────────────
   Navy blue header bar, traditional corporate layout.
   Matches the "Company Name / INVOICE" design with dark blue table header.
   ────────────────────────────────────────────────────────────── */

const NAVY = '#1a2b5e';
const NAVY_LIGHT = '#2a3d7a';
const BORDER = '#d1d5db';
const TEXT = '#262626';
const TEXT_SEC = '#6b7280';
const BG_LIGHT = '#f0f4ff';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ClassicBlueTemplate({ data }: { data: InvoiceRenderData }) {
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
          <p className="text-[28px] font-bold tracking-tight">INVOICE</p>
          <div className="mt-1 text-[11px] text-white/70 space-y-0.5">
            <p>Invoice # <span className="text-white font-medium">{data.invoice_number}</span></p>
            <p>Date: <span className="text-white font-medium">{fmtDate(data.issued_at || data.created_at)}</span></p>
            {data.due_date && <p>Due: <span className="text-white font-medium">{fmtDate(data.due_date)}</span></p>}
          </div>
        </div>
      </div>

      <div className="px-10 py-8">

        {/* ── Bill To ── */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: NAVY }}>Bill To</p>
            <div className="mt-2 text-[13px] space-y-0.5">
              <p className="font-semibold text-[#111]">{data.client_name}</p>
              {data.client_company && <p style={{ color: TEXT_SEC }}>{data.client_company}</p>}
              {data.client_address && <p style={{ color: TEXT_SEC }}>{data.client_address}</p>}
              {data.client_phone && <p style={{ color: TEXT_SEC }}>{data.client_phone}</p>}
              {data.client_email && <p style={{ color: TEXT_SEC }}>{data.client_email}</p>}
            </div>
          </div>
          {/* Amount highlight */}
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: NAVY }}>Amount Due</p>
            <p className="text-[28px] font-bold mt-1" style={{ color: NAVY }}>{fmt(data.balance_cents || data.total_cents)}</p>
          </div>
        </div>

        {/* ── Subject ── */}
        {data.subject && (
          <div className="mt-5 px-4 py-2.5 rounded" style={{ backgroundColor: BG_LIGHT }}>
            <p className="text-[12px]"><span className="font-semibold" style={{ color: NAVY }}>Re: </span><span style={{ color: TEXT }}>{data.subject}</span></p>
          </div>
        )}

        {/* ── Line Items Table ── */}
        <div className="mt-8">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ backgroundColor: NAVY }}>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-white">Description</th>
                <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-white w-20">Qty</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-white w-28">Unit Price</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-white w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={item.id} style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#f9fafb', borderBottom: `1px solid ${BORDER}` }}>
                  <td className="px-4 py-3 text-[12px]">
                    {item.title && <p className="font-medium text-[#111]">{item.title}</p>}
                    <p className={item.title ? 'text-[11px] text-[#6b7280]' : 'text-[#374151]'}>{item.description}</p>
                  </td>
                  <td className="px-4 py-3 text-center text-[12px] tabular-nums" style={{ color: TEXT_SEC }}>{item.qty}</td>
                  <td className="px-4 py-3 text-right text-[12px] tabular-nums" style={{ color: TEXT_SEC }}>{fmt(item.unit_price_cents)}</td>
                  <td className="px-4 py-3 text-right text-[12px] font-medium tabular-nums text-[#111]">{fmt(item.line_total_cents)}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr><td colSpan={4} className="py-10 text-center text-[12px] text-[#9ca3af]">No line items</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Totals ── */}
        <div className="mt-1 flex justify-end">
          <div className="w-72">
            <div className="text-[12px]">
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
                <span style={{ color: TEXT_SEC }}>Tax</span>
                <span className="tabular-nums">{fmt(data.tax_cents)}</span>
              </div>
              <div className="flex justify-between py-3 font-bold text-[14px]" style={{ backgroundColor: NAVY, color: 'white', margin: '0 -16px', padding: '10px 16px' }}>
                <span>TOTAL</span>
                <span className="tabular-nums">{fmt(data.total_cents)}</span>
              </div>
              {data.paid_cents > 0 && (
                <div className="flex justify-between py-2 text-[#15803d]">
                  <span>Paid</span>
                  <span className="tabular-nums">{fmt(data.paid_cents)}</span>
                </div>
              )}
              {data.balance_cents > 0 && data.balance_cents !== data.total_cents && (
                <div className="flex justify-between py-2 font-semibold text-[13px]">
                  <span>Balance Due</span>
                  <span className="tabular-nums">{fmt(data.balance_cents)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Notes ── */}
        {data.notes && (
          <div className="mt-8 border-t pt-5" style={{ borderColor: BORDER }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: NAVY }}>Notes</p>
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed" style={{ color: TEXT_SEC }}>{data.notes}</p>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="mt-10 pt-5 border-t text-center" style={{ borderColor: BORDER }}>
          <p className="text-[11px]" style={{ color: TEXT_SEC }}>
            If you have any questions about this invoice, please contact
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
