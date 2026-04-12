import React from 'react';
import type { InvoiceRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Executive Template — elegant serif typography, warm gold accents, premium feel.
 * Suited for law firms, consulting, architecture, luxury services.
 */
export default function ExecutiveTemplate({ data }: { data: InvoiceRenderData }) {
  const fmt = (cents: number) => formatMoneyFromCents(cents, data.currency);
  const gold = '#92713a';
  const dark = '#1c1917';

  return (
    <div className="bg-white text-stone-800" style={{ fontFamily: '"Georgia", "Times New Roman", serif' }}>
      {/* Top gold border */}
      <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${gold}, #c9a96e, ${gold})` }} />

      <div className="px-10 py-8">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            {data.company_logo_url ? (
              <img src={data.company_logo_url} alt={data.company_name} className="h-12 max-w-[200px] object-contain" />
            ) : (
              <h1 className="text-2xl font-normal tracking-wide" style={{ color: dark }}>
                {data.company_name}
              </h1>
            )}
            <div className="mt-2 space-y-0.5 text-[11px] text-stone-400" style={{ fontFamily: '"Inter", sans-serif' }}>
              {data.company_address && <p>{data.company_address}</p>}
              {data.company_email && <p>{data.company_email}</p>}
              {data.company_phone && <p>{data.company_phone}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-normal tracking-[0.15em]" style={{ color: gold }}>
              INVOICE
            </p>
            <p className="mt-1 text-sm" style={{ fontFamily: '"Inter", sans-serif', color: dark }}>
              {data.invoice_number}
            </p>
          </div>
        </div>

        {/* Gold divider */}
        <div className="my-6 flex items-center gap-4">
          <div className="h-px flex-1" style={{ backgroundColor: gold, opacity: 0.3 }} />
          <div className="h-1.5 w-1.5 rotate-45" style={{ backgroundColor: gold }} />
          <div className="h-px flex-1" style={{ backgroundColor: gold, opacity: 0.3 }} />
        </div>

        {/* Three-column meta */}
        <div className="grid grid-cols-3 gap-6" style={{ fontFamily: '"Inter", sans-serif' }}>
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.2em]" style={{ color: gold }}>Billed To</p>
            <p className="mt-2 text-sm font-semibold" style={{ color: dark }}>{data.client_name}</p>
            {data.client_company && <p className="text-[11px] text-stone-500">{data.client_company}</p>}
            <div className="mt-1 space-y-0.5 text-[11px] text-stone-400">
              {data.client_address && <p>{data.client_address}</p>}
              {data.client_email && <p>{data.client_email}</p>}
              {data.client_phone && <p>{data.client_phone}</p>}
            </div>
          </div>
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.2em]" style={{ color: gold }}>Invoice Date</p>
            <p className="mt-2 text-sm text-stone-600">{fmtDate(data.issued_at || data.created_at)}</p>
            <p className="mt-3 text-[9px] font-semibold uppercase tracking-[0.2em]" style={{ color: gold }}>Due Date</p>
            <p className="mt-2 text-sm text-stone-600">{fmtDate(data.due_date)}</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-semibold uppercase tracking-[0.2em]" style={{ color: gold }}>Amount Due</p>
            <p className="mt-2 text-2xl font-bold" style={{ color: dark }}>
              {fmt(data.balance_cents || data.total_cents)}
            </p>
            <span
              className="mt-2 inline-block rounded px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                fontFamily: '"Inter", sans-serif',
                backgroundColor: data.status === 'paid' ? '#f0fdf4' : data.status === 'void' ? '#fef2f2' : '#fefce8',
                color: data.status === 'paid' ? '#166534' : data.status === 'void' ? '#991b1b' : gold,
                border: `1px solid ${data.status === 'paid' ? '#bbf7d0' : data.status === 'void' ? '#fecaca' : '#fde68a'}`,
              }}
            >
              {data.status}
            </span>
          </div>
        </div>

        {/* Subject */}
        {data.subject && (
          <div className="mt-6 border-l-2 pl-4" style={{ borderColor: gold }}>
            <p className="text-sm italic text-stone-600">{data.subject}</p>
          </div>
        )}

        {/* Line Items */}
        <div className="mt-8" style={{ fontFamily: '"Inter", sans-serif' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: `${gold}40` }}>
                <th className="pb-3 text-left text-[10px] font-semibold uppercase tracking-[0.15em]" style={{ color: gold }}>Description</th>
                <th className="pb-3 text-right text-[10px] font-semibold uppercase tracking-[0.15em]" style={{ color: gold }}>Qty</th>
                <th className="pb-3 text-right text-[10px] font-semibold uppercase tracking-[0.15em]" style={{ color: gold }}>Rate</th>
                <th className="pb-3 text-right text-[10px] font-semibold uppercase tracking-[0.15em]" style={{ color: gold }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={item.id} className="border-b border-stone-100">
                  <td className="py-3.5 pr-4 text-stone-700">
                    {item.title && <p className="font-medium text-stone-900">{item.title}</p>}
                    <p className={item.title ? 'text-xs text-stone-500' : ''}>{item.description}</p>
                  </td>
                  <td className="py-3.5 text-right text-stone-500">{item.qty}</td>
                  <td className="py-3.5 text-right text-stone-500">{fmt(item.unit_price_cents)}</td>
                  <td className="py-3.5 text-right font-semibold text-stone-800">{fmt(item.line_total_cents)}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr><td colSpan={4} className="py-8 text-center text-stone-400">No items</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="mt-4 flex justify-end" style={{ fontFamily: '"Inter", sans-serif' }}>
          <div className="w-72 space-y-2 text-sm">
            <div className="flex justify-between text-stone-500">
              <span>Subtotal</span>
              <span className="text-stone-700">{fmt(data.subtotal_cents)}</span>
            </div>
            {data.discount_cents > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Discount</span>
                <span>-{fmt(data.discount_cents)}</span>
              </div>
            )}
            <div className="flex justify-between text-stone-500">
              <span>Tax</span>
              <span className="text-stone-700">{fmt(data.tax_cents)}</span>
            </div>
            <div className="h-px" style={{ background: `linear-gradient(90deg, transparent, ${gold}, transparent)` }} />
            <div className="flex justify-between pt-1 text-lg font-bold" style={{ color: dark }}>
              <span>Total</span>
              <span>{fmt(data.total_cents)}</span>
            </div>
            {data.paid_cents > 0 && (
              <div className="flex justify-between text-green-700">
                <span>Paid</span>
                <span>{fmt(data.paid_cents)}</span>
              </div>
            )}
            {data.balance_cents > 0 && data.balance_cents !== data.total_cents && (
              <div className="flex justify-between font-bold" style={{ color: gold }}>
                <span>Balance Due</span>
                <span>{fmt(data.balance_cents)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        {data.notes && (
          <div className="mt-8 border-t border-stone-200 pt-5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.2em]" style={{ color: gold, fontFamily: '"Inter", sans-serif' }}>
              Terms & Conditions
            </p>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-stone-500" style={{ fontFamily: '"Inter", sans-serif' }}>
              {data.notes}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-10 flex items-center gap-4">
          <div className="h-px flex-1" style={{ backgroundColor: gold, opacity: 0.2 }} />
          <p className="text-[10px] tracking-wider text-stone-400">{data.company_name}</p>
          <div className="h-px flex-1" style={{ backgroundColor: gold, opacity: 0.2 }} />
        </div>
      </div>
    </div>
  );
}
