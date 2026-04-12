import React from 'react';
import type { InvoiceRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';

/* ── FreshBooks / Wave-inspired Modern Template ──────────────────
   Warm, approachable but professional. Rounded cards, soft shadows,
   accent colour used sparingly. Friendly for service businesses.
   ─────────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function ModernTemplate({ data }: { data: InvoiceRenderData }) {
  const fmt = (cents: number) => formatMoneyFromCents(cents, data.currency);
  const accent = data.accent_color || '#374151'; // Stripe purple

  return (
    <div className="bg-[#f7f8fa] text-[#1a1a1a]" style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif', fontSize: '14px' }}>

      {/* ── Top accent bar ── */}
      <div className="h-1" style={{ backgroundColor: accent }} />

      <div className="px-8 py-8">

        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          <div>
            {data.company_logo_url ? (
              <img src={data.company_logo_url} alt={data.company_name} className="h-10 max-w-[180px] object-contain" />
            ) : (
              <p className="text-[20px] font-bold tracking-tight text-[#0a0a0a]">{data.company_name}</p>
            )}
            <div className="mt-2 text-[12px] text-[#6b7280] space-y-0.5">
              {data.company_address && <p>{data.company_address}</p>}
              {data.company_email && <p>{data.company_email}</p>}
              {data.company_phone && <p>{data.company_phone}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: accent }}>Invoice</p>
            <p className="mt-0.5 text-[16px] font-bold text-[#0a0a0a]">{data.invoice_number}</p>
            <div className="mt-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold"
                style={{
                  backgroundColor: data.status === 'paid' ? '#ecfdf5' : data.status === 'void' ? '#fef2f2' : `${accent}10`,
                  color: data.status === 'paid' ? '#059669' : data.status === 'void' ? '#dc2626' : accent,
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{
                  backgroundColor: data.status === 'paid' ? '#059669' : data.status === 'void' ? '#dc2626' : accent,
                }} />
                {data.status === 'sent_not_due' ? 'Open' : data.status.charAt(0).toUpperCase() + data.status.slice(1).replace(/_/g, ' ')}
              </span>
            </div>
          </div>
        </div>

        {/* ── Info cards ── */}
        <div className="mt-8 grid grid-cols-2 gap-4">
          <div className="rounded-xl bg-white border border-[#e5e7eb] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9ca3af]">Bill to</p>
            <p className="mt-2 text-[14px] font-semibold text-[#111]">{data.client_name}</p>
            {data.client_company && <p className="text-[12px] text-[#6b7280]">{data.client_company}</p>}
            <div className="mt-1.5 text-[12px] text-[#9ca3af] space-y-0.5">
              {data.client_address && <p>{data.client_address}</p>}
              {data.client_email && <p>{data.client_email}</p>}
              {data.client_phone && <p>{data.client_phone}</p>}
            </div>
          </div>
          <div className="rounded-xl bg-white border border-[#e5e7eb] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9ca3af]">Details</p>
            <div className="mt-2 space-y-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-[#9ca3af]">Issued</span>
                <span className="text-[#374151]">{fmtDate(data.issued_at || data.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9ca3af]">Due</span>
                <span className="text-[#374151]">{fmtDate(data.due_date)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-[#f3f4f6]">
                <span className="text-[#9ca3af]">Amount due</span>
                <span className="text-[16px] font-bold text-[#111]">{fmt(data.balance_cents || data.total_cents)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Subject ── */}
        {data.subject && (
          <div className="mt-4 text-[13px] text-[#6b7280]">
            <span className="font-medium text-[#374151]">Re: </span>{data.subject}
          </div>
        )}

        {/* ── Line Items ── */}
        <div className="mt-6 rounded-xl bg-white border border-[#e5e7eb] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-[#f9fafb] border-b border-[#e5e7eb]">
                <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#6b7280]">Item</th>
                <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] w-16">Qty</th>
                <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] w-24">Rate</th>
                <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={item.id} className={i < data.items.length - 1 ? 'border-b border-[#f3f4f6]' : ''}>
                  <td className="px-5 py-4 text-[13px]">
                    {item.title && <p className="font-medium text-[#111]">{item.title}</p>}
                    <p className={item.title ? 'text-[#6b7280] text-[12px]' : 'text-[#374151]'}>{item.description}</p>
                  </td>
                  <td className="px-5 py-4 text-right text-[13px] text-[#6b7280] tabular-nums">{item.qty}</td>
                  <td className="px-5 py-4 text-right text-[13px] text-[#6b7280] tabular-nums">{fmt(item.unit_price_cents)}</td>
                  <td className="px-5 py-4 text-right text-[13px] font-medium text-[#111] tabular-nums">{fmt(item.line_total_cents)}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-[13px] text-[#9ca3af]">No items</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Totals ── */}
        <div className="mt-4 flex justify-end">
          <div className="w-72 rounded-xl bg-white border border-[#e5e7eb] overflow-hidden">
            <div className="px-5 py-3 space-y-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-[#6b7280]">Subtotal</span>
                <span className="tabular-nums text-[#374151]">{fmt(data.subtotal_cents)}</span>
              </div>
              {data.discount_cents > 0 && (
                <div className="flex justify-between text-[#dc2626]">
                  <span>Discount</span>
                  <span className="tabular-nums">−{fmt(data.discount_cents)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[#6b7280]">Tax</span>
                <span className="tabular-nums text-[#374151]">{fmt(data.tax_cents)}</span>
              </div>
            </div>
            <div className="flex justify-between px-5 py-3.5 text-[15px] font-bold text-white" style={{ backgroundColor: accent }}>
              <span>Total</span>
              <span className="tabular-nums">{fmt(data.total_cents)}</span>
            </div>
            {data.paid_cents > 0 && (
              <div className="flex justify-between px-5 py-2.5 text-[13px] text-[#059669] bg-[#f0fdf4]">
                <span className="font-medium">Paid</span>
                <span className="tabular-nums font-medium">{fmt(data.paid_cents)}</span>
              </div>
            )}
            {data.balance_cents > 0 && data.balance_cents !== data.total_cents && (
              <div className="flex justify-between px-5 py-2.5 text-[13px] font-bold bg-[#f9fafb]" style={{ color: accent }}>
                <span>Balance due</span>
                <span className="tabular-nums">{fmt(data.balance_cents)}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Notes ── */}
        {data.notes && (
          <div className="mt-8 rounded-xl bg-white border border-[#e5e7eb] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9ca3af]">Notes</p>
            <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-[#6b7280]">{data.notes}</p>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="mt-10 text-center text-[11px] text-[#d1d5db]">
          <p>Thank you for your business</p>
          <p className="mt-0.5">{data.company_name}</p>
        </div>
      </div>
    </div>
  );
}
