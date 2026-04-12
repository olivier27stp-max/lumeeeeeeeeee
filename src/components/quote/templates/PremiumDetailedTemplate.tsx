import React from 'react';
import type { QuoteRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';

/* ── Premium Detailed — Quote Template ──────────────────────────
   Structured, detailed, executive feel.
   Focus: full breakdown, scope, conditions, signature-ready.
   ────────────────────────────────────────────────────────────── */

const DARK = '#171717';
const ACCENT = '#334155';

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

const STATUS_MAP: Record<string, { label: string; bg: string; fg: string }> = {
  draft:             { label: 'Draft',     bg: '#f1f5f9', fg: '#475569' },
  sent:              { label: 'Sent',      bg: '#dbeafe', fg: '#1d4ed8' },
  awaiting_response: { label: 'Pending',   bg: '#fef3c7', fg: '#a16207' },
  approved:          { label: 'Approved',  bg: '#dcfce7', fg: '#15803d' },
  declined:          { label: 'Declined',  bg: '#fecaca', fg: '#b91c1c' },
  expired:           { label: 'Expired',   bg: '#f1f5f9', fg: '#64748b' },
  converted:         { label: 'Converted', bg: '#dcfce7', fg: '#15803d' },
};

export default function PremiumDetailedTemplate({ data }: { data: QuoteRenderData }) {
  const fmt = (c: number) => formatMoneyFromCents(c, data.currency);
  const st = STATUS_MAP[data.status] || STATUS_MAP.draft;

  return (
    <div className="bg-white text-[#262626]" style={{ fontFamily: '"Georgia","Times New Roman",serif', fontSize: '13px', lineHeight: 1.6 }}>

      {/* ── Header ── */}
      <div className="px-10 pt-8 pb-6" style={{ backgroundColor: DARK }}>
        <div className="flex items-start justify-between">
          <div>
            {data.company_logo_url
              ? <img src={data.company_logo_url} alt={data.company_name} className="h-10 max-w-[180px] object-contain brightness-0 invert" />
              : <p className="text-[22px] font-bold text-white tracking-tight" style={{ fontFamily: '-apple-system,sans-serif' }}>{data.company_name}</p>}
            <div className="mt-2 text-[11px] text-white/60 space-y-0.5" style={{ fontFamily: '-apple-system,sans-serif' }}>
              {data.company_address && <p>{data.company_address}</p>}
              {data.company_email && <p>{data.company_email}</p>}
              {data.company_phone && <p>{data.company_phone}</p>}
            </div>
          </div>
          <div className="text-right text-white">
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/50" style={{ fontFamily: '-apple-system,sans-serif' }}>Proposal</p>
            <p className="text-[24px] font-bold tracking-tight mt-0.5">#{data.quote_number}</p>
          </div>
        </div>
      </div>

      <div className="px-10 py-8">

        {/* ── Meta row ── */}
        <div className="flex justify-between items-start pb-6 border-b border-[#e2e8f0]">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#94a3b8]" style={{ fontFamily: '-apple-system,sans-serif' }}>Prepared for</p>
            <p className="text-[16px] font-bold mt-1.5" style={{ color: DARK }}>{data.contact_name}</p>
            <div className="text-[11px] text-[#64748b] mt-1 space-y-0.5" style={{ fontFamily: '-apple-system,sans-serif' }}>
              {data.contact_company && <p>{data.contact_company}</p>}
              {data.contact_address && <p>{data.contact_address}</p>}
              {data.contact_email && <p>{data.contact_email}</p>}
              {data.contact_phone && <p>{data.contact_phone}</p>}
            </div>
          </div>
          <div className="text-right" style={{ fontFamily: '-apple-system,sans-serif' }}>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ backgroundColor: st.bg, color: st.fg }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: st.fg }} />{st.label}
            </span>
            <div className="text-[11px] text-[#94a3b8] mt-2 space-y-0.5">
              <p>Date: <span className="text-[#475569]">{fmtDate(data.created_at)}</span></p>
              {data.valid_until && <p>Valid until: <span className="text-[#475569]">{fmtDate(data.valid_until)}</span></p>}
            </div>
          </div>
        </div>

        {/* ── Title ── */}
        {data.title && (
          <div className="py-5 border-b border-[#e2e8f0]">
            <p className="text-[18px] font-bold" style={{ color: DARK }}>{data.title}</p>
          </div>
        )}

        {/* ── Introduction / Scope ── */}
        {data.introduction && (
          <div className="py-5 border-b border-[#e2e8f0]">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#94a3b8] mb-2" style={{ fontFamily: '-apple-system,sans-serif' }}>Scope of Work</p>
            <p className="text-[12px] text-[#475569] leading-relaxed whitespace-pre-wrap">{data.introduction}</p>
          </div>
        )}

        {/* ── Line Items ── */}
        <div className="py-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#94a3b8] mb-3" style={{ fontFamily: '-apple-system,sans-serif' }}>Services & Deliverables</p>
          <table className="w-full" style={{ fontFamily: '-apple-system,sans-serif' }}>
            <thead>
              <tr style={{ backgroundColor: DARK }}>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-white">Item</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-white w-14">Qty</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-white w-24">Rate</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-white w-24">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={item.id} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f8fafc' }} className="border-b border-[#f1f5f9]">
                  <td className="px-4 py-3 text-[12px]">
                    <p className="font-semibold text-[#111]">{item.name}</p>
                    {item.description && <p className="text-[11px] text-[#94a3b8] mt-0.5">{item.description}</p>}
                  </td>
                  <td className="px-3 py-3 text-center text-[12px] text-[#64748b] tabular-nums">{item.qty}</td>
                  <td className="px-3 py-3 text-right text-[12px] text-[#64748b] tabular-nums">{fmt(item.unit_price_cents)}</td>
                  <td className="px-4 py-3 text-right text-[12px] font-semibold tabular-nums">{fmt(item.total_cents)}</td>
                </tr>
              ))}
              {data.items.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-[12px] text-[#d1d5db]">No items</td></tr>}
            </tbody>
          </table>

          {/* Optional */}
          {data.optional_items.length > 0 && (
            <div className="mt-4" style={{ fontFamily: '-apple-system,sans-serif' }}>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#94a3b8] mb-2">Optional Enhancements</p>
              {data.optional_items.map(item => (
                <div key={item.id} className="flex justify-between py-2 border-b border-dashed border-[#e2e8f0] text-[12px] text-[#94a3b8]">
                  <span className="italic">{item.name}{item.description ? ` — ${item.description}` : ''}</span>
                  <span className="tabular-nums">{fmt(item.total_cents)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Totals ── */}
        <div className="flex justify-end pb-5 border-b border-[#e2e8f0]" style={{ fontFamily: '-apple-system,sans-serif' }}>
          <div className="w-72 text-[12px]">
            <div className="flex justify-between py-2 border-b border-[#f1f5f9]"><span className="text-[#94a3b8]">Subtotal</span><span className="tabular-nums">{fmt(data.subtotal_cents)}</span></div>
            {data.discount_cents > 0 && <div className="flex justify-between py-2 border-b border-[#f1f5f9] text-[#dc2626]"><span>Discount</span><span className="tabular-nums">-{fmt(data.discount_cents)}</span></div>}
            <div className="flex justify-between py-2 border-b border-[#f1f5f9]"><span className="text-[#94a3b8]">{data.tax_rate_label || 'Tax'}</span><span className="tabular-nums">{fmt(data.tax_cents)}</span></div>
            <div className="flex justify-between py-3 text-[16px] font-bold" style={{ color: DARK }}><span>Total</span><span className="tabular-nums">{fmt(data.total_cents)}</span></div>
          </div>
        </div>

        {/* ── Deposit ── */}
        {data.deposit_required && data.deposit_cents > 0 && (
          <div className="mt-5 mb-5 rounded-lg overflow-hidden border-2" style={{ borderColor: DARK }}>
            <div className="px-5 py-3 text-white text-[11px] font-bold uppercase tracking-[0.15em]" style={{ backgroundColor: DARK, fontFamily: '-apple-system,sans-serif' }}>
              Deposit Required Upon Acceptance
            </div>
            <div className="px-5 py-4 flex items-center justify-between bg-[#f8fafc]" style={{ fontFamily: '-apple-system,sans-serif' }}>
              <div>
                <p className="text-[13px] font-semibold" style={{ color: DARK }}>Required deposit</p>
                <p className="text-[11px] text-[#64748b]">Payment required to confirm and begin work</p>
              </div>
              <p className="text-[24px] font-bold" style={{ color: DARK }}>{fmt(data.deposit_cents)}</p>
            </div>
          </div>
        )}

        {/* ── Notes ── */}
        {data.notes && (
          <div className="py-5 border-b border-[#e2e8f0]">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#94a3b8] mb-2" style={{ fontFamily: '-apple-system,sans-serif' }}>Notes</p>
            <p className="text-[12px] text-[#64748b] whitespace-pre-wrap leading-relaxed">{data.notes}</p>
          </div>
        )}

        {/* ── Terms ── */}
        {data.contract_disclaimer && (
          <div className="py-5 border-b border-[#e2e8f0]">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#94a3b8] mb-2" style={{ fontFamily: '-apple-system,sans-serif' }}>Terms & Conditions</p>
            <p className="text-[11px] text-[#94a3b8] whitespace-pre-wrap leading-relaxed">{data.contract_disclaimer}</p>
          </div>
        )}

        {/* ── Signature ── */}
        <div className="pt-8 flex justify-between" style={{ fontFamily: '-apple-system,sans-serif' }}>
          <div>
            <p className="text-[11px] text-[#94a3b8]">Client Signature</p>
            <div className="w-52 border-b border-[#cbd5e1] mt-10" />
            <p className="text-[10px] text-[#cbd5e1] mt-1">Date: _______________</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-[#94a3b8]">Authorized by</p>
            <div className="w-52 border-b border-[#cbd5e1] mt-10" />
            <p className="text-[10px] text-[#cbd5e1] mt-1">{data.company_name}</p>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="mt-8 pt-4 border-t border-[#e2e8f0] text-center" style={{ fontFamily: '-apple-system,sans-serif' }}>
          <p className="text-[10px] text-[#cbd5e1]">{data.company_name} {data.company_email ? `\u00b7 ${data.company_email}` : ''} {data.company_phone ? `\u00b7 ${data.company_phone}` : ''}</p>
        </div>
      </div>
    </div>
  );
}
