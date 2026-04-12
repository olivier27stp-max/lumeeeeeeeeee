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
 * Contractor Template — high-contrast, large totals, prominent payment info.
 * Designed for construction, trades, field services. Clear, scannable, no-nonsense.
 */
export default function ContractorTemplate({ data }: { data: InvoiceRenderData }) {
  const fmt = (cents: number) => formatMoneyFromCents(cents, data.currency);
  const primary = '#171717';
  const accent = data.accent_color || '#2563eb';

  return (
    <div className="bg-white text-gray-900" style={{ fontFamily: '"Inter", -apple-system, sans-serif' }}>
      {/* Top stripe */}
      <div className="h-2" style={{ backgroundColor: primary }} />

      <div className="px-8 py-6">
        {/* Header — two columns */}
        <div className="flex items-start justify-between">
          <div>
            {data.company_logo_url ? (
              <img src={data.company_logo_url} alt={data.company_name} className="h-12 max-w-[200px] object-contain" />
            ) : (
              <h1 className="text-xl font-extrabold uppercase tracking-wide" style={{ color: primary }}>
                {data.company_name}
              </h1>
            )}
            <div className="mt-2 space-y-0.5 text-[11px] text-gray-500">
              {data.company_address && <p>{data.company_address}</p>}
              {data.company_phone && <p>{data.company_phone}</p>}
              {data.company_email && <p>{data.company_email}</p>}
            </div>
          </div>

          {/* Invoice badge */}
          <div className="text-right">
            <div className="inline-block rounded-lg px-5 py-3" style={{ backgroundColor: primary }}>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Invoice</p>
              <p className="mt-0.5 text-lg font-extrabold text-white">{data.invoice_number}</p>
            </div>
          </div>
        </div>

        {/* Info bar */}
        <div className="mt-6 grid grid-cols-4 gap-4 rounded-lg bg-gray-50 p-4">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Issue Date</p>
            <p className="mt-0.5 text-sm font-semibold">{fmtDate(data.issued_at || data.created_at)}</p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Due Date</p>
            <p className="mt-0.5 text-sm font-semibold">{fmtDate(data.due_date)}</p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Status</p>
            <span
              className="mt-0.5 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase"
              style={{
                backgroundColor: data.status === 'paid' ? '#dcfce7' : data.status === 'void' ? '#fee2e2' : '#dbeafe',
                color: data.status === 'paid' ? '#166534' : data.status === 'void' ? '#991b1b' : '#1e40af',
              }}
            >
              {data.status}
            </span>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Total Due</p>
            <p className="mt-0.5 text-lg font-extrabold" style={{ color: accent }}>
              {fmt(data.balance_cents || data.total_cents)}
            </p>
          </div>
        </div>

        {/* Client */}
        <div className="mt-6 rounded-lg border border-gray-200 p-4">
          <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Client</p>
          <div className="mt-2 flex items-start justify-between">
            <div>
              <p className="text-sm font-bold" style={{ color: primary }}>{data.client_name}</p>
              {data.client_company && <p className="text-xs text-gray-600">{data.client_company}</p>}
              {data.client_address && <p className="text-xs text-gray-500">{data.client_address}</p>}
            </div>
            <div className="text-right text-xs text-gray-500">
              {data.client_phone && <p>{data.client_phone}</p>}
              {data.client_email && <p>{data.client_email}</p>}
            </div>
          </div>
        </div>

        {/* Subject */}
        {data.subject && (
          <div className="mt-4 rounded-lg border-l-4 bg-gray-50 px-4 py-3" style={{ borderColor: accent }}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Project / Description</p>
            <p className="mt-1 text-sm font-medium">{data.subject}</p>
          </div>
        )}

        {/* Line Items */}
        <div className="mt-6 overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: primary }}>
                <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-white">Description</th>
                <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-wider text-white w-16">Qty</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-white w-24">Unit Price</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-white w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={item.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-3 text-gray-800">
                    {item.title && <p className="font-semibold">{item.title}</p>}
                    <p className={item.title ? 'text-xs text-gray-500' : 'font-medium'}>{item.description}</p>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600 font-medium">{item.qty}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{fmt(item.unit_price_cents)}</td>
                  <td className="px-4 py-3 text-right font-bold">{fmt(item.line_total_cents)}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No items</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals — large and prominent */}
        <div className="mt-4 flex justify-end">
          <div className="w-80 overflow-hidden rounded-lg border border-gray-200">
            <div className="space-y-0 text-sm">
              <div className="flex justify-between px-5 py-2.5 bg-white">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-semibold">{fmt(data.subtotal_cents)}</span>
              </div>
              {data.discount_cents > 0 && (
                <div className="flex justify-between px-5 py-2.5 bg-white text-red-600">
                  <span>Discount</span>
                  <span className="font-semibold">-{fmt(data.discount_cents)}</span>
                </div>
              )}
              <div className="flex justify-between px-5 py-2.5 bg-gray-50">
                <span className="text-gray-500">Tax</span>
                <span className="font-semibold">{fmt(data.tax_cents)}</span>
              </div>
              <div className="flex justify-between px-5 py-4 text-lg font-extrabold text-white" style={{ backgroundColor: primary }}>
                <span>TOTAL</span>
                <span>{fmt(data.total_cents)}</span>
              </div>
            </div>
            {data.paid_cents > 0 && (
              <div className="flex justify-between px-5 py-2.5 bg-green-50 text-green-700 text-sm font-semibold">
                <span>Paid</span>
                <span>{fmt(data.paid_cents)}</span>
              </div>
            )}
            {data.balance_cents > 0 && data.balance_cents !== data.total_cents && (
              <div className="flex justify-between px-5 py-2.5 text-sm font-bold" style={{ color: accent, backgroundColor: '#eff6ff' }}>
                <span>Balance Due</span>
                <span>{fmt(data.balance_cents)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        {data.notes && (
          <div className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-5">
            <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Payment Terms & Notes</p>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-gray-600">{data.notes}</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 border-t border-gray-200 pt-4 text-center text-[10px] text-gray-400">
          <p className="font-semibold">{data.company_name}</p>
          {data.company_phone && <p>{data.company_phone} &middot; {data.company_email}</p>}
        </div>
      </div>
    </div>
  );
}
