import React from 'react';
import type { InvoiceRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Bold Template — dark sidebar with company branding, clean right-side content.
 * Professional, high-impact look suitable for agencies, contractors, and creative businesses.
 */
export default function BoldTemplate({ data }: { data: InvoiceRenderData }) {
  const fmt = (cents: number) => formatMoneyFromCents(cents, data.currency);
  const accent = data.accent_color || '#374151';
  const dark = '#171717';

  return (
    <div className="bg-white text-gray-900" style={{ fontFamily: '"Inter", -apple-system, sans-serif' }}>
      <div className="flex min-h-[400px]">
        {/* ── Left sidebar ── */}
        <div className="w-[38%] shrink-0 px-6 py-8 text-white" style={{ backgroundColor: dark }}>
          {/* Company */}
          <div>
            {data.company_logo_url ? (
              <img src={data.company_logo_url} alt={data.company_name} className="h-10 max-w-[140px] object-contain brightness-0 invert" />
            ) : (
              <h1 className="text-lg font-bold tracking-tight">{data.company_name}</h1>
            )}
            <div className="mt-3 space-y-0.5 text-[11px] text-gray-400">
              {data.company_address && <p>{data.company_address}</p>}
              {data.company_email && <p>{data.company_email}</p>}
              {data.company_phone && <p>{data.company_phone}</p>}
            </div>
          </div>

          {/* Divider */}
          <div className="my-6 h-px bg-gray-700" />

          {/* Bill To */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: accent }}>Bill To</p>
            <p className="mt-2 text-sm font-semibold">{data.client_name}</p>
            {data.client_company && <p className="text-[11px] text-gray-400">{data.client_company}</p>}
            <div className="mt-1 space-y-0.5 text-[11px] text-gray-400">
              {data.client_address && <p>{data.client_address}</p>}
              {data.client_email && <p>{data.client_email}</p>}
              {data.client_phone && <p>{data.client_phone}</p>}
            </div>
          </div>

          {/* Divider */}
          <div className="my-6 h-px bg-gray-700" />

          {/* Meta */}
          <div className="space-y-3 text-[11px]">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-500">Invoice #</p>
              <p className="mt-0.5 font-semibold">{data.invoice_number}</p>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-500">Issued</p>
              <p className="mt-0.5">{fmtDate(data.issued_at || data.created_at)}</p>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-500">Due Date</p>
              <p className="mt-0.5">{fmtDate(data.due_date)}</p>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-500">Status</p>
              <span
                className="mt-1 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase"
                style={{
                  backgroundColor: data.status === 'paid' ? '#059669' : data.status === 'void' ? '#dc2626' : accent,
                  color: '#fff',
                }}
              >
                {data.status}
              </span>
            </div>
          </div>

          {/* Total highlight */}
          <div className="mt-8 rounded-lg p-4" style={{ backgroundColor: accent }}>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/70">Amount Due</p>
            <p className="mt-1 text-2xl font-extrabold text-white">{fmt(data.balance_cents || data.total_cents)}</p>
          </div>
        </div>

        {/* ── Right content ── */}
        <div className="flex-1 px-8 py-8">
          {/* Title */}
          <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: dark }}>INVOICE</h2>

          {/* Subject */}
          {data.subject && (
            <p className="mt-2 text-sm text-gray-500">
              <span className="font-semibold text-gray-700">Re:</span> {data.subject}
            </p>
          )}

          {/* Line Items */}
          <div className="mt-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2" style={{ borderColor: dark }}>
                  <th className="pb-2 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400">Description</th>
                  <th className="pb-2 text-right text-[10px] font-bold uppercase tracking-wider text-gray-400">Qty</th>
                  <th className="pb-2 text-right text-[10px] font-bold uppercase tracking-wider text-gray-400">Rate</th>
                  <th className="pb-2 text-right text-[10px] font-bold uppercase tracking-wider text-gray-400">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-3 pr-4 text-gray-800">
                      {item.title && <p className="font-medium">{item.title}</p>}
                      <p className={item.title ? 'text-xs text-gray-500' : ''}>{item.description}</p>
                    </td>
                    <td className="py-3 text-right text-gray-500">{item.qty}</td>
                    <td className="py-3 text-right text-gray-500">{fmt(item.unit_price_cents)}</td>
                    <td className="py-3 text-right font-semibold">{fmt(item.line_total_cents)}</td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr><td colSpan={4} className="py-8 text-center text-gray-400">No items</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-4 flex justify-end">
            <div className="w-64 space-y-1.5 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal</span>
                <span className="font-medium text-gray-700">{fmt(data.subtotal_cents)}</span>
              </div>
              {data.discount_cents > 0 && (
                <div className="flex justify-between text-red-500">
                  <span>Discount</span>
                  <span>-{fmt(data.discount_cents)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-500">
                <span>Tax</span>
                <span className="font-medium text-gray-700">{fmt(data.tax_cents)}</span>
              </div>
              <div className="flex justify-between border-t-2 pt-2 text-base font-bold" style={{ borderColor: dark, color: dark }}>
                <span>Total</span>
                <span>{fmt(data.total_cents)}</span>
              </div>
              {data.paid_cents > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Paid</span>
                  <span>{fmt(data.paid_cents)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          {data.notes && (
            <div className="mt-8 rounded-lg border border-gray-100 bg-gray-50 p-4">
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-400">Notes & Terms</p>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-gray-600">{data.notes}</p>
            </div>
          )}

          {/* Footer */}
          <div className="mt-8 text-center text-[10px] text-gray-300">
            Thank you for your business &middot; {data.company_name}
          </div>
        </div>
      </div>
    </div>
  );
}
