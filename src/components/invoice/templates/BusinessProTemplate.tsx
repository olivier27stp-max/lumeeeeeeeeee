import React from 'react';
import type { InvoiceRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';

/* ── Business Pro — Invoice Template ────────────────────────────
   Premium, strong branding, executive feel.
   Focus: trust, professionalism, detailed payment info.
   ────────────────────────────────────────────────────────────── */

const DARK = '#171717';

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  draft:        { label: 'Draft',   bg: '#f1f5f9', fg: '#475569' },
  sent:         { label: 'Open',    bg: '#dbeafe', fg: '#1d4ed8' },
  sent_not_due: { label: 'Open',    bg: '#dbeafe', fg: '#1d4ed8' },
  partial:      { label: 'Partial', bg: '#fef3c7', fg: '#a16207' },
  paid:         { label: 'Paid',    bg: '#dcfce7', fg: '#15803d' },
  void:         { label: 'Void',    bg: '#fecaca', fg: '#b91c1c' },
  overdue:      { label: 'Overdue', bg: '#fecaca', fg: '#b91c1c' },
};

export default function BusinessProTemplate({ data }: { data: InvoiceRenderData }) {
  const fmt = (c: number) => formatMoneyFromCents(c, data.currency);
  const st = STATUS[data.status] || STATUS.sent;

  return (
    <div className="bg-white text-[#262626]" style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",sans-serif', fontSize: '13px', lineHeight: 1.6 }}>

      {/* ── Header ── */}
      <div className="px-10 pt-8 pb-6" style={{ backgroundColor: DARK }}>
        <div className="flex items-start justify-between">
          <div>
            {data.company_logo_url
              ? <img src={data.company_logo_url} alt={data.company_name} className="h-10 max-w-[180px] object-contain brightness-0 invert" />
              : <p className="text-[22px] font-bold text-white tracking-tight">{data.company_name}</p>}
            <div className="mt-2 text-[11px] text-white/60 space-y-0.5">
              {data.company_address && <p>{data.company_address}</p>}
              {data.company_email && <p>{data.company_email}</p>}
              {data.company_phone && <p>{data.company_phone}</p>}
            </div>
          </div>
          <div className="text-right text-white">
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/50">Invoice</p>
            <p className="text-[24px] font-bold tracking-tight mt-0.5">#{data.invoice_number}</p>
          </div>
        </div>
      </div>

      <div className="px-10 py-8">

        {/* ── Meta ── */}
        <div className="flex justify-between items-start pb-6 border-b border-[#e2e8f0]">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#94a3b8]">Bill to</p>
            <p className="text-[16px] font-bold mt-1.5" style={{ color: DARK }}>{data.client_name}</p>
            <div className="text-[11px] text-[#64748b] mt-1 space-y-0.5">
              {data.client_company && <p>{data.client_company}</p>}
              {data.client_address && <p>{data.client_address}</p>}
              {data.client_email && <p>{data.client_email}</p>}
              {data.client_phone && <p>{data.client_phone}</p>}
            </div>
          </div>
          <div className="text-right">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ backgroundColor: st.bg, color: st.fg }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: st.fg }} />{st.label}
            </span>
            <div className="text-[11px] text-[#94a3b8] mt-2 space-y-0.5">
              <p>Issued: <span className="text-[#475569]">{fmtDate(data.issued_at || data.created_at)}</span></p>
              <p>Due: <span className="text-[#475569]">{fmtDate(data.due_date)}</span></p>
            </div>
          </div>
        </div>

        {/* ── Subject ── */}
        {data.subject && (
          <div className="py-4 border-b border-[#e2e8f0]">
            <p className="text-[14px] font-bold" style={{ color: DARK }}>{data.subject}</p>
          </div>
        )}

        {/* ── Items ── */}
        <div className="py-5">
          <table className="w-full">
            <thead>
              <tr style={{ backgroundColor: DARK }}>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-white">Description</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-white w-14">Qty</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-white w-24">Rate</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-white w-24">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={item.id} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f8fafc' }} className="border-b border-[#f1f5f9]">
                  <td className="px-4 py-3 text-[12px]">
                    {item.title && <p className="font-semibold text-[#111]">{item.title}</p>}
                    <p className={item.title ? 'text-[11px] text-[#94a3b8]' : 'text-[#475569]'}>{item.description}</p>
                  </td>
                  <td className="px-3 py-3 text-center text-[12px] text-[#64748b] tabular-nums">{item.qty}</td>
                  <td className="px-3 py-3 text-right text-[12px] text-[#64748b] tabular-nums">{fmt(item.unit_price_cents)}</td>
                  <td className="px-4 py-3 text-right text-[12px] font-semibold tabular-nums">{fmt(item.line_total_cents)}</td>
                </tr>
              ))}
              {data.items.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-[12px] text-[#d1d5db]">No items</td></tr>}
            </tbody>
          </table>
        </div>

        {/* ── Totals ── */}
        <div className="flex justify-end pb-6 border-b border-[#e2e8f0]">
          <div className="w-72 text-[12px]">
            <div className="flex justify-between py-2 border-b border-[#f1f5f9]"><span className="text-[#94a3b8]">Subtotal</span><span className="tabular-nums">{fmt(data.subtotal_cents)}</span></div>
            {data.discount_cents > 0 && <div className="flex justify-between py-2 border-b border-[#f1f5f9] text-[#dc2626]"><span>Discount</span><span className="tabular-nums">-{fmt(data.discount_cents)}</span></div>}
            <div className="flex justify-between py-2 border-b border-[#f1f5f9]"><span className="text-[#94a3b8]">Tax</span><span className="tabular-nums">{fmt(data.tax_cents)}</span></div>
            <div className="flex justify-between py-3 text-[16px] font-bold" style={{ color: DARK }}><span>Total</span><span className="tabular-nums">{fmt(data.total_cents)}</span></div>
            {data.paid_cents > 0 && (
              <div className="flex justify-between py-2 border-t border-[#f1f5f9] text-[#15803d]"><span>Paid</span><span className="tabular-nums font-medium">{fmt(data.paid_cents)}</span></div>
            )}
            {data.balance_cents > 0 && data.balance_cents !== data.total_cents && (
              <div className="flex justify-between py-2 border-t border-[#e2e8f0] font-bold text-[14px]" style={{ color: DARK }}><span>Balance due</span><span className="tabular-nums">{fmt(data.balance_cents)}</span></div>
            )}
          </div>
        </div>

        {/* ── Notes & Terms ── */}
        {data.notes && (
          <div className="py-5 border-b border-[#e2e8f0]">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#94a3b8] mb-2">Notes</p>
            <p className="text-[12px] text-[#64748b] whitespace-pre-wrap leading-relaxed">{data.notes}</p>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="mt-8 pt-4 border-t border-[#e2e8f0] text-center">
          <p className="text-[10px] text-[#cbd5e1]">{data.company_name} {data.company_email ? `\u00b7 ${data.company_email}` : ''} {data.company_phone ? `\u00b7 ${data.company_phone}` : ''}</p>
        </div>
      </div>
    </div>
  );
}
