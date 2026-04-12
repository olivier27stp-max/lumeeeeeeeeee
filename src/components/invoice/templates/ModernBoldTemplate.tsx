import React from 'react';
import type { InvoiceRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';

/* ── Modern Bold Template ───────────────────────────────────────
   Vibrant orange theme with organic wave shapes (SVG).
   Bold, contemporary design for creative businesses.
   ────────────────────────────────────────────────────────────── */

const ORANGE = '#e67e22';
const ORANGE_DARK = '#d35400';
const BG_DARK = '#1a1a1a';
const TEXT = '#262626';
const TEXT_SEC = '#6b7280';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function WaveTop() {
  return (
    <svg viewBox="0 0 800 120" className="absolute top-0 right-0 w-[55%] h-auto" preserveAspectRatio="none">
      <path d="M400,0 L800,0 L800,120 C700,100 600,60 500,80 C420,95 400,50 400,0 Z" fill={ORANGE} />
      <circle cx="680" cy="55" r="42" fill={ORANGE_DARK} opacity="0.35" />
    </svg>
  );
}

function WaveBottom() {
  return (
    <svg viewBox="0 0 800 140" className="w-full h-auto" preserveAspectRatio="none">
      <path d="M0,60 C80,10 180,100 300,70 C400,45 450,90 520,80 C620,65 700,30 800,60 L800,140 L0,140 Z" fill={BG_DARK} />
      <path d="M0,80 C100,50 200,120 340,85 C440,60 500,100 600,90 C700,78 750,50 800,70 L800,140 L0,140 Z" fill={ORANGE} opacity="0.7" />
    </svg>
  );
}

export default function ModernBoldTemplate({ data }: { data: InvoiceRenderData }) {
  const fmt = (cents: number) => formatMoneyFromCents(cents, data.currency);

  return (
    <div className="bg-white text-[#262626] relative overflow-hidden" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif', fontSize: '13px', lineHeight: '1.5' }}>

      {/* ── Header with Wave ── */}
      <div className="relative min-h-[180px]">
        <WaveTop />

        <div className="relative z-10 px-10 pt-8">
          {/* Top row: INVOICE title + meta */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[36px] font-extrabold tracking-tight text-white" style={{ WebkitTextStroke: '1px', color: ORANGE }}>INVOICE</p>
              <div className="mt-1">
                {data.company_logo_url ? (
                  <img src={data.company_logo_url} alt={data.company_name} className="h-8 max-w-[160px] object-contain" />
                ) : (
                  <p className="text-[14px] font-bold text-[#111]">{data.company_name}</p>
                )}
                {data.company_address && <p className="text-[10px] mt-0.5" style={{ color: TEXT_SEC }}>{data.company_address}</p>}
              </div>
            </div>

            <div className="text-right text-white z-10 pt-2">
              <div className="text-[11px] space-y-0.5">
                <p>Invoice No : <span className="font-semibold">{data.invoice_number}</span></p>
                <p>Date : <span className="font-semibold">{fmtDate(data.issued_at || data.created_at)}</span></p>
              </div>
            </div>
          </div>

          {/* Invoice To + Bank/Contact */}
          <div className="flex items-start justify-between mt-6">
            <div>
              {(data.company_phone || data.company_email) && (
                <div className="mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: ORANGE }}>Contact</p>
                  <div className="text-[11px] mt-1 space-y-0.5" style={{ color: TEXT_SEC }}>
                    {data.company_phone && <p>{data.company_phone}</p>}
                    {data.company_email && <p>{data.company_email}</p>}
                  </div>
                </div>
              )}
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: TEXT_SEC }}>Invoice to</p>
              <p className="text-[14px] font-bold mt-1" style={{ color: ORANGE }}>{data.client_name}</p>
              <div className="text-[11px] mt-0.5 space-y-0.5" style={{ color: TEXT_SEC }}>
                {data.client_address && <p>{data.client_address}</p>}
                {data.client_email && <p>{data.client_email}</p>}
                {data.client_phone && <p>{data.client_phone}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-10 pb-4">

        {/* ── Line Items Table ── */}
        <div className="mt-2">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-white rounded-l-lg" style={{ backgroundColor: ORANGE }}>Description</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-white" style={{ backgroundColor: ORANGE }}>Qty</th>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-white" style={{ backgroundColor: ORANGE }}>Price</th>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-white rounded-r-lg" style={{ backgroundColor: ORANGE }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id} className="border-b border-[#f3f4f6]">
                  <td className="px-4 py-3 text-[12px]">
                    {item.title && <p className="font-medium text-[#111]">{item.title}</p>}
                    <p className={item.title ? 'text-[11px] text-[#6b7280]' : 'text-[#374151]'}>{item.description}</p>
                  </td>
                  <td className="px-4 py-3 text-center text-[12px] tabular-nums" style={{ color: TEXT_SEC }}>{item.qty}</td>
                  <td className="px-4 py-3 text-right text-[12px] tabular-nums" style={{ color: TEXT_SEC }}>{fmt(item.unit_price_cents)}</td>
                  <td className="px-4 py-3 text-right text-[12px] font-semibold tabular-nums text-[#111]">{fmt(item.line_total_cents)}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr><td colSpan={4} className="py-10 text-center text-[12px] text-[#9ca3af]">No line items</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Totals ── */}
        <div className="mt-4 flex justify-end">
          <div className="w-64 text-[12px]">
            <div className="flex justify-between py-1.5">
              <span className="font-semibold" style={{ color: TEXT_SEC }}>SUBTOTAL</span>
              <span className="tabular-nums font-medium">{fmt(data.subtotal_cents)}</span>
            </div>
            {data.discount_cents > 0 && (
              <div className="flex justify-between py-1.5 text-[#dc2626]">
                <span className="font-semibold">DISCOUNT</span>
                <span className="tabular-nums">-{fmt(data.discount_cents)}</span>
              </div>
            )}
            <div className="flex justify-between py-1.5">
              <span className="font-semibold" style={{ color: TEXT_SEC }}>TAX</span>
              <span className="tabular-nums">{fmt(data.tax_cents)}</span>
            </div>
            {data.paid_cents > 0 && (
              <div className="flex justify-between py-1.5 text-[#15803d]">
                <span className="font-semibold">PAID</span>
                <span className="tabular-nums">{fmt(data.paid_cents)}</span>
              </div>
            )}
            <div className="flex justify-between py-2.5 mt-1 rounded-md px-3 -mx-3 text-[14px] font-bold text-white" style={{ backgroundColor: ORANGE }}>
              <span>TOTAL</span>
              <span className="tabular-nums">{fmt(data.balance_cents || data.total_cents)}</span>
            </div>
          </div>
        </div>

        {/* ── Notes / Terms & Conditions ── */}
        <div className="mt-8 flex items-start justify-between gap-8">
          {data.notes && (
            <div className="flex-1">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: ORANGE }}>Terms & Conditions</p>
              <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed" style={{ color: TEXT_SEC }}>{data.notes}</p>
            </div>
          )}
          <div className="flex-1 text-right">
            <p className="text-[18px] italic" style={{ color: TEXT_SEC }}>Signature</p>
            <div className="mt-4 border-b border-[#d1d5db] w-48 ml-auto" />
          </div>
        </div>

        {/* ── Thank You ── */}
        <div className="mt-8 text-center">
          <p className="text-[32px] font-extrabold tracking-wide" style={{ color: TEXT_SEC, opacity: 0.2 }}>THANKS</p>
        </div>
      </div>

      {/* ── Bottom Waves ── */}
      <div className="mt-2">
        <WaveBottom />
      </div>
    </div>
  );
}
