import React from 'react';
import type { InvoiceRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';
import { useTranslation } from '../../../i18n';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ModernTemplate({ data }: { data: InvoiceRenderData }) {
  const { t } = useTranslation();
  const it = t.invoiceTemplates;
  const fmt = (cents: number) => formatMoneyFromCents(cents, data.currency);
  const accent = data.accent_color || '#6366f1';

  return (
    <div className="bg-white text-gray-900" style={{ fontFamily: '"Inter", -apple-system, sans-serif' }}>
      {/* Accent banner */}
      <div className="rounded-t-xl px-8 py-6" style={{ backgroundColor: accent }}>
        <div className="flex items-center justify-between">
          <div>
            {data.company_logo_url ? (
              <img src={data.company_logo_url} alt={data.company_name} className="h-10 max-w-[180px] object-contain brightness-0 invert" />
            ) : (
              <h1 className="text-xl font-bold text-white tracking-wide">{data.company_name}</h1>
            )}
          </div>
          <div className="text-right text-white">
            <p className="text-3xl font-extrabold tracking-tight">{it.invoice}</p>
            <p className="text-sm font-medium opacity-80">{data.invoice_number}</p>
          </div>
        </div>
      </div>

      <div className="px-8 py-6">
        {/* Status pill */}
        <div className="flex items-center justify-between">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase"
            style={{
              backgroundColor: data.status === 'paid' ? '#dcfce7' : data.status === 'void' ? '#fee2e2' : '#ede9fe',
              color: data.status === 'paid' ? '#166534' : data.status === 'void' ? '#991b1b' : accent,
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{
              backgroundColor: data.status === 'paid' ? '#166534' : data.status === 'void' ? '#991b1b' : accent,
            }} />
            {data.status === 'partial' ? it.statusPartiallyPaid : (it as Record<string, string>)[`status${data.status.charAt(0).toUpperCase()}${data.status.slice(1)}`] || data.status}
          </span>
          <p className="text-xs text-gray-400">
            {data.due_date ? `${it.duePrefix} ${fmtDate(data.due_date)}` : `${it.createdPrefix} ${fmtDate(data.created_at)}`}
          </p>
        </div>

        {/* Two-column: From / To */}
        <div className="mt-6 grid grid-cols-2 gap-6">
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>{it.from}</p>
            <p className="mt-1 text-sm font-bold">{data.company_name}</p>
            {data.company_address && <p className="text-xs text-gray-500">{data.company_address}</p>}
            {data.company_email && <p className="text-xs text-gray-500">{data.company_email}</p>}
            {data.company_phone && <p className="text-xs text-gray-500">{data.company_phone}</p>}
          </div>
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>{it.billTo}</p>
            <p className="mt-1 text-sm font-bold">{data.client_name}</p>
            {data.client_company && <p className="text-xs text-gray-500">{data.client_company}</p>}
            {data.client_email && <p className="text-xs text-gray-500">{data.client_email}</p>}
            {data.client_phone && <p className="text-xs text-gray-500">{data.client_phone}</p>}
          </div>
        </div>

        {/* Subject */}
        {data.subject && (
          <p className="mt-4 text-sm text-gray-600">
            <span className="font-semibold">Re:</span> {data.subject}
          </p>
        )}

        {/* Line Items */}
        <div className="mt-6 overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500">{it.item}</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-gray-500">{it.qty}</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-gray-500">{it.rate}</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-gray-500">{it.amount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    {item.title && <p className="font-medium text-gray-900">{item.title}</p>}
                    <p className={item.title ? 'text-xs text-gray-500' : 'text-gray-900'}>{item.description}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">{item.qty}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{fmt(item.unit_price_cents)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{fmt(item.line_total_cents)}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-400">{it.noItems}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <div className="w-72">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">{it.subtotal}</span>
                <span className="font-medium">{fmt(data.subtotal_cents)}</span>
              </div>
              {data.discount_cents > 0 && (
                <div className="flex justify-between text-red-500">
                  <span>{it.discount}</span>
                  <span>-{fmt(data.discount_cents)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">{it.tax}</span>
                <span className="font-medium">{fmt(data.tax_cents)}</span>
              </div>
            </div>
            <div
              className="mt-3 flex justify-between rounded-lg px-4 py-3 text-lg font-bold text-white"
              style={{ backgroundColor: accent }}
            >
              <span>{it.total}</span>
              <span>{fmt(data.total_cents)}</span>
            </div>
            {data.paid_cents > 0 && (
              <div className="mt-2 flex justify-between px-4 text-sm text-green-600">
                <span>{it.paid}</span>
                <span>{fmt(data.paid_cents)}</span>
              </div>
            )}
            {data.balance_cents > 0 && data.balance_cents !== data.total_cents && (
              <div className="mt-1 flex justify-between px-4 text-sm font-bold" style={{ color: accent }}>
                <span>{it.balanceDue}</span>
                <span>{fmt(data.balance_cents)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        {data.notes && (
          <div className="mt-6 rounded-lg bg-gray-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{it.notes}</p>
            <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600">{data.notes}</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-[10px] text-gray-400">
          <p>{it.thankYouChoosing} {data.company_name}</p>
        </div>
      </div>
    </div>
  );
}
