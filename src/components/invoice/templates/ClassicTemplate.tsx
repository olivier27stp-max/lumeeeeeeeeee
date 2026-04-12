import React from 'react';
import type { InvoiceRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';

/* ── Stripe-inspired Classic Template ────────────────────────────
   Clean, professional, lots of whitespace.
   Inspired by Stripe Invoicing / Billing portal.
   ─────────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    draft:        { bg: '#f1f5f9', text: '#475569' },
    sent:         { bg: '#eff6ff', text: '#1d4ed8' },
    sent_not_due: { bg: '#eff6ff', text: '#1d4ed8' },
    partial:      { bg: '#fefce8', text: '#a16207' },
    paid:         { bg: '#f0fdf4', text: '#15803d' },
    void:         { bg: '#fef2f2', text: '#b91c1c' },
  };
  const c = colors[status] || colors.draft;
  const label = status === 'sent_not_due' ? 'Open' : status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: c.bg, color: c.text }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.text }} />
      {label}
    </span>
  );
}

export default function ClassicTemplate({ data }: { data: InvoiceRenderData }) {
  const fmt = (cents: number) => formatMoneyFromCents(cents, data.currency);

  return (
    <div className="bg-white text-[#1a1a1a]" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif', fontSize: '14px', lineHeight: '1.5' }}>
      <div className="px-10 py-10">

        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          <div>
            {data.company_logo_url ? (
              <img src={data.company_logo_url} alt={data.company_name} className="h-10 max-w-[180px] object-contain" />
            ) : (
              <p className="text-[18px] font-semibold tracking-tight text-[#0a0a0a]">{data.company_name}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[28px] font-semibold tracking-tight text-[#0a0a0a]">Invoice</p>
          </div>
        </div>

        {/* ── Invoice meta ── */}
        <div className="mt-8 flex items-start justify-between">
          <div className="space-y-4">
            {/* From */}
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">From</p>
              <div className="mt-1 text-[13px] text-[#374151] space-y-0.5">
                <p className="font-medium text-[#111]">{data.company_name}</p>
                {data.company_address && <p>{data.company_address}</p>}
                {data.company_email && <p>{data.company_email}</p>}
                {data.company_phone && <p>{data.company_phone}</p>}
              </div>
            </div>
            {/* Bill To */}
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Bill to</p>
              <div className="mt-1 text-[13px] text-[#374151] space-y-0.5">
                <p className="font-medium text-[#111]">{data.client_name}</p>
                {data.client_company && <p>{data.client_company}</p>}
                {data.client_address && <p>{data.client_address}</p>}
                {data.client_email && <p>{data.client_email}</p>}
                {data.client_phone && <p>{data.client_phone}</p>}
              </div>
            </div>
          </div>

          {/* Right side meta */}
          <div className="text-right space-y-3">
            <StatusPill status={data.status} />
            <div className="space-y-2 text-[13px]">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Invoice number</p>
                <p className="mt-0.5 font-medium text-[#111]">{data.invoice_number}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Date issued</p>
                <p className="mt-0.5 text-[#374151]">{fmtDate(data.issued_at || data.created_at)}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Date due</p>
                <p className="mt-0.5 text-[#374151]">{fmtDate(data.due_date)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Subject ── */}
        {data.subject && (
          <div className="mt-6 text-[13px] text-[#374151]">
            <span className="font-medium text-[#111]">Subject: </span>{data.subject}
          </div>
        )}

        {/* ── Amount due highlight ── */}
        <div className="mt-8 flex items-center justify-between rounded-lg bg-[#f8fafc] border border-[#e2e8f0] px-6 py-4">
          <p className="text-[13px] font-medium text-[#6b7280]">Amount due</p>
          <p className="text-[24px] font-semibold tracking-tight text-[#0a0a0a]">{fmt(data.balance_cents || data.total_cents)}</p>
        </div>

        {/* ── Line Items ── */}
        <div className="mt-8">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5e7eb]">
                <th className="pb-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Description</th>
                <th className="pb-3 text-right text-[11px] font-medium uppercase tracking-wider text-[#6b7280] w-16">Qty</th>
                <th className="pb-3 text-right text-[11px] font-medium uppercase tracking-wider text-[#6b7280] w-28">Unit price</th>
                <th className="pb-3 text-right text-[11px] font-medium uppercase tracking-wider text-[#6b7280] w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id} className="border-b border-[#f3f4f6]">
                  <td className="py-3.5 pr-4 text-[13px]">
                    {item.title && <p className="font-medium text-[#111]">{item.title}</p>}
                    <p className={item.title ? 'text-[#6b7280] text-[12px]' : 'text-[#374151]'}>{item.description}</p>
                  </td>
                  <td className="py-3.5 text-right text-[13px] text-[#6b7280] tabular-nums">{item.qty}</td>
                  <td className="py-3.5 text-right text-[13px] text-[#6b7280] tabular-nums">{fmt(item.unit_price_cents)}</td>
                  <td className="py-3.5 text-right text-[13px] font-medium text-[#111] tabular-nums">{fmt(item.line_total_cents)}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr><td colSpan={4} className="py-10 text-center text-[13px] text-[#9ca3af]">No line items</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Totals ── */}
        <div className="mt-2 flex justify-end">
          <div className="w-72">
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between py-1">
                <span className="text-[#6b7280]">Subtotal</span>
                <span className="tabular-nums text-[#374151]">{fmt(data.subtotal_cents)}</span>
              </div>
              {data.discount_cents > 0 && (
                <div className="flex justify-between py-1 text-[#dc2626]">
                  <span>Discount</span>
                  <span className="tabular-nums">−{fmt(data.discount_cents)}</span>
                </div>
              )}
              <div className="flex justify-between py-1">
                <span className="text-[#6b7280]">Tax</span>
                <span className="tabular-nums text-[#374151]">{fmt(data.tax_cents)}</span>
              </div>
              <div className="flex justify-between border-t border-[#e5e7eb] pt-3 pb-1">
                <span className="font-semibold text-[#111]">Total</span>
                <span className="font-semibold tabular-nums text-[#111]">{fmt(data.total_cents)}</span>
              </div>
              {data.paid_cents > 0 && (
                <div className="flex justify-between py-1 text-[#15803d]">
                  <span>Paid</span>
                  <span className="tabular-nums">{fmt(data.paid_cents)}</span>
                </div>
              )}
              {data.balance_cents > 0 && data.balance_cents !== data.total_cents && (
                <div className="flex justify-between border-t border-[#e5e7eb] pt-3 font-semibold text-[#111]">
                  <span>Amount due</span>
                  <span className="tabular-nums">{fmt(data.balance_cents)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Notes ── */}
        {data.notes && (
          <div className="mt-10 border-t border-[#f3f4f6] pt-6">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Notes</p>
            <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-[#6b7280]">{data.notes}</p>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="mt-12 pt-6 border-t border-[#f3f4f6] text-center">
          <p className="text-[11px] text-[#9ca3af]">{data.company_name}</p>
        </div>
      </div>
    </div>
  );
}
