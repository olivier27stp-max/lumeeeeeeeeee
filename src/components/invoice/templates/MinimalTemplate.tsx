import React from 'react';
import type { InvoiceRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';

/* ── Apple / Linear-inspired Minimal Template ────────────────────
   Ultra-clean, typography-driven, generous whitespace.
   No boxes, no cards — just elegant hierarchy and thin lines.
   ─────────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function MinimalTemplate({ data }: { data: InvoiceRenderData }) {
  const fmt = (cents: number) => formatMoneyFromCents(cents, data.currency);

  return (
    <div className="bg-white text-[#1d1d1f]" style={{ fontFamily: '"SF Pro Display", "Inter", -apple-system, BlinkMacSystemFont, sans-serif', fontSize: '14px', lineHeight: '1.6' }}>
      <div className="px-10 py-12">

        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          {data.company_logo_url ? (
            <img src={data.company_logo_url} alt={data.company_name} className="h-8 max-w-[160px] object-contain" />
          ) : (
            <p className="text-[16px] font-medium text-[#1d1d1f]">{data.company_name}</p>
          )}
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-[#86868b]">Invoice</p>
        </div>

        {/* ── Thin line ── */}
        <div className="mt-8 h-px bg-[#e5e5e5]" />

        {/* ── Meta grid ── */}
        <div className="mt-8 grid grid-cols-4 gap-x-8 gap-y-6 text-[13px]">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#86868b]">Number</p>
            <p className="mt-1.5 font-medium">{data.invoice_number}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#86868b]">Issued</p>
            <p className="mt-1.5">{fmtDate(data.issued_at || data.created_at)}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#86868b]">Due</p>
            <p className="mt-1.5">{fmtDate(data.due_date)}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#86868b]">Status</p>
            <p className="mt-1.5 font-medium" style={{
              color: data.status === 'paid' ? '#34c759' : data.status === 'void' ? '#ff3b30' : '#1d1d1f',
            }}>
              {data.status === 'sent_not_due' ? 'Open' : data.status.charAt(0).toUpperCase() + data.status.slice(1).replace(/_/g, ' ')}
            </p>
          </div>
        </div>

        {/* ── Client ── */}
        <div className="mt-8 grid grid-cols-2 gap-8 text-[13px]">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#86868b]">From</p>
            <div className="mt-2 space-y-0.5 text-[#424245]">
              <p className="font-medium text-[#1d1d1f]">{data.company_name}</p>
              {data.company_address && <p>{data.company_address}</p>}
              {data.company_email && <p>{data.company_email}</p>}
              {data.company_phone && <p>{data.company_phone}</p>}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#86868b]">Billed to</p>
            <div className="mt-2 space-y-0.5 text-[#424245]">
              <p className="font-medium text-[#1d1d1f]">{data.client_name}</p>
              {data.client_company && <p>{data.client_company}</p>}
              {data.client_address && <p>{data.client_address}</p>}
              {data.client_email && <p>{data.client_email}</p>}
              {data.client_phone && <p>{data.client_phone}</p>}
            </div>
          </div>
        </div>

        {/* ── Subject ── */}
        {data.subject && (
          <p className="mt-6 text-[13px] italic text-[#86868b]">{data.subject}</p>
        )}

        {/* ── Line Items ── */}
        <div className="mt-10">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 pb-3 border-b border-[#e5e5e5] text-[10px] font-medium uppercase tracking-[0.2em] text-[#86868b]">
            <div className="col-span-6">Description</div>
            <div className="col-span-2 text-right">Qty</div>
            <div className="col-span-2 text-right">Price</div>
            <div className="col-span-2 text-right">Amount</div>
          </div>
          {/* Rows */}
          {data.items.map((item, i) => (
            <div key={item.id} className={`grid grid-cols-12 gap-2 py-4 text-[13px] ${i < data.items.length - 1 ? 'border-b border-[#f5f5f7]' : ''}`}>
              <div className="col-span-6">
                {item.title && <p className="font-medium text-[#1d1d1f]">{item.title}</p>}
                <p className={item.title ? 'text-[12px] text-[#86868b]' : 'text-[#424245]'}>{item.description}</p>
              </div>
              <div className="col-span-2 text-right text-[#86868b] tabular-nums">{item.qty}</div>
              <div className="col-span-2 text-right text-[#86868b] tabular-nums">{fmt(item.unit_price_cents)}</div>
              <div className="col-span-2 text-right font-medium text-[#1d1d1f] tabular-nums">{fmt(item.line_total_cents)}</div>
            </div>
          ))}
          {data.items.length === 0 && (
            <div className="py-12 text-center text-[13px] text-[#86868b]">No items</div>
          )}
        </div>

        {/* ── Totals ── */}
        <div className="mt-6 flex justify-end">
          <div className="w-60 space-y-2 text-[13px]">
            <div className="flex justify-between text-[#86868b]">
              <span>Subtotal</span>
              <span className="tabular-nums">{fmt(data.subtotal_cents)}</span>
            </div>
            {data.discount_cents > 0 && (
              <div className="flex justify-between text-[#ff3b30]">
                <span>Discount</span>
                <span className="tabular-nums">−{fmt(data.discount_cents)}</span>
              </div>
            )}
            <div className="flex justify-between text-[#86868b]">
              <span>Tax</span>
              <span className="tabular-nums">{fmt(data.tax_cents)}</span>
            </div>
            <div className="h-px bg-[#e5e5e5]" />
            <div className="flex justify-between pt-1 text-[18px] font-semibold text-[#1d1d1f]">
              <span>Total</span>
              <span className="tabular-nums">{fmt(data.total_cents)}</span>
            </div>
            {data.paid_cents > 0 && (
              <div className="flex justify-between text-[13px] text-[#34c759]">
                <span>Paid</span>
                <span className="tabular-nums">{fmt(data.paid_cents)}</span>
              </div>
            )}
            {data.balance_cents > 0 && data.balance_cents !== data.total_cents && (
              <div className="flex justify-between text-[13px] font-semibold text-[#1d1d1f]">
                <span>Balance</span>
                <span className="tabular-nums">{fmt(data.balance_cents)}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Notes ── */}
        {data.notes && (
          <div className="mt-12">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#86868b]">Notes</p>
            <p className="mt-3 whitespace-pre-wrap text-[12px] leading-relaxed text-[#86868b]">{data.notes}</p>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="mt-16 text-center text-[10px] text-[#d2d2d7]">
          {data.company_name}
        </div>
      </div>
    </div>
  );
}
