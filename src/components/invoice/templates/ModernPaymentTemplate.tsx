import React from 'react';
import type { InvoiceRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';

/* ── Modern Payment — Invoice Template ──────────────────────────
   Modern SaaS look, accent on total/status/payment zone.
   Focus: get paid fast, clear CTA, trust.
   ────────────────────────────────────────────────────────────── */

const ACCENT = '#2563eb';

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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

export default function ModernPaymentTemplate({ data }: { data: InvoiceRenderData }) {
  const fmt = (c: number) => formatMoneyFromCents(c, data.currency);
  const st = STATUS[data.status] || STATUS.sent;
  const isPaid = data.status === 'paid';
  const balance = data.balance_cents || data.total_cents;

  return (
    <div className="bg-[#f8fafc] text-[#111]" style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",sans-serif', fontSize: '13px', lineHeight: 1.55 }}>

      {/* ── Accent bar ── */}
      <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT}99)` }} />

      <div className="px-8 py-8 space-y-5">

        {/* ── Header ── */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
          <div className="flex items-start justify-between">
            <div>
              {data.company_logo_url
                ? <img src={data.company_logo_url} alt={data.company_name} className="h-9 max-w-[160px] object-contain" />
                : <p className="text-[18px] font-bold tracking-tight">{data.company_name}</p>}
              <p className="text-[11px] text-[#9ca3af] mt-1">{[data.company_address, data.company_phone, data.company_email].filter(Boolean).join(' \u00b7 ')}</p>
            </div>
            <div className="text-right">
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ backgroundColor: st.bg, color: st.fg }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: st.fg }} />{st.label}
              </span>
              <p className="text-[11px] text-[#9ca3af] mt-2">#{data.invoice_number}</p>
            </div>
          </div>
        </div>

        {/* ── Payment highlight ── */}
        <div className="rounded-xl overflow-hidden border-2" style={{ borderColor: isPaid ? '#22c55e' : ACCENT }}>
          <div className="px-6 py-5 text-white" style={{ backgroundColor: isPaid ? '#22c55e' : ACCENT }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-widest opacity-80">{isPaid ? 'Paid in full' : 'Amount due'}</p>
                <p className="text-[28px] font-bold tracking-tight mt-1">{fmt(isPaid ? data.total_cents : balance)}</p>
              </div>
              <div className="text-right text-[11px] opacity-80">
                <p>Due: {fmtDate(data.due_date)}</p>
                <p>Issued: {fmtDate(data.issued_at || data.created_at)}</p>
              </div>
            </div>
          </div>
          {data.paid_cents > 0 && !isPaid && (
            <div className="bg-white px-6 py-3 flex justify-between text-[12px]">
              <span className="text-[#6b7280]">Total: {fmt(data.total_cents)} \u00b7 Paid: <span className="text-[#15803d] font-medium">{fmt(data.paid_cents)}</span></span>
              <span className="font-semibold">Remaining: {fmt(balance)}</span>
            </div>
          )}
        </div>

        {/* ── Client card ── */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: ACCENT }}>Bill to</p>
          <p className="text-[14px] font-semibold">{data.client_name}</p>
          <div className="text-[11px] text-[#6b7280] mt-1 space-y-0.5">
            {data.client_company && <p>{data.client_company}</p>}
            {data.client_address && <p>{data.client_address}</p>}
            {data.client_email && <p>{data.client_email}</p>}
            {data.client_phone && <p>{data.client_phone}</p>}
          </div>
        </div>

        {/* ── Items ── */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
          <div className="px-5 py-3 border-b border-[#f3f4f6]">
            <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: ACCENT }}>Items</p>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#f3f4f6] bg-[#fafafa]">
                <th className="px-5 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-[#9ca3af]">Description</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] w-14">Qty</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] w-24">Price</th>
                <th className="px-5 py-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] w-24">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(item => (
                <tr key={item.id} className="border-b border-[#f3f4f6]">
                  <td className="px-5 py-3 text-[12px]">
                    {item.title && <p className="font-medium">{item.title}</p>}
                    <p className={item.title ? 'text-[11px] text-[#9ca3af]' : 'text-[#4b5563]'}>{item.description}</p>
                  </td>
                  <td className="px-3 py-3 text-right text-[12px] text-[#6b7280] tabular-nums">{item.qty}</td>
                  <td className="px-3 py-3 text-right text-[12px] text-[#6b7280] tabular-nums">{fmt(item.unit_price_cents)}</td>
                  <td className="px-5 py-3 text-right text-[12px] font-medium tabular-nums">{fmt(item.line_total_cents)}</td>
                </tr>
              ))}
              {data.items.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-[12px] text-[#d1d5db]">No items</td></tr>}
            </tbody>
          </table>
          <div className="px-5 py-4 bg-[#fafafa]">
            <div className="flex justify-end">
              <div className="w-56 text-[12px] space-y-1.5">
                <div className="flex justify-between"><span className="text-[#9ca3af]">Subtotal</span><span className="tabular-nums">{fmt(data.subtotal_cents)}</span></div>
                {data.discount_cents > 0 && <div className="flex justify-between text-[#dc2626]"><span>Discount</span><span className="tabular-nums">-{fmt(data.discount_cents)}</span></div>}
                <div className="flex justify-between"><span className="text-[#9ca3af]">Tax</span><span className="tabular-nums">{fmt(data.tax_cents)}</span></div>
                <div className="flex justify-between pt-2 mt-1 border-t border-[#e5e7eb] text-[15px] font-bold"><span>Total</span><span className="tabular-nums">{fmt(data.total_cents)}</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Notes ── */}
        {data.notes && (
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9ca3af] mb-1.5">Notes</p>
            <p className="text-[11px] text-[#6b7280] whitespace-pre-wrap leading-relaxed">{data.notes}</p>
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
