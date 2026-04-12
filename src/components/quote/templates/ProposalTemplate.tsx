import React from 'react';
import type { QuoteRenderData, QuoteRenderItem } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';

/* ── HoneyBook / Buildertrend-inspired Proposal Template ─────────
   Magazine-style, multi-section, brand-heavy.
   Cover section, scope of work narrative, service cards,
   payment schedule, terms — feels like a landing page.
   ─────────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function ServiceCard({ item, fmt }: { item: QuoteRenderItem; fmt: (c: number) => string }) {
  return (
    <div className="rounded-xl border border-[#e5e7eb] bg-white p-5 flex items-start gap-4">
      {/* Icon circle */}
      <div className="w-10 h-10 rounded-full bg-[#f1f5f9] flex items-center justify-center shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[14px] font-semibold text-[#111]">{item.name}</p>
            {item.description && (
              <p className="text-[12px] text-[#6b7280] mt-1 leading-relaxed">{item.description}</p>
            )}
          </div>
          <p className="text-[14px] font-bold text-[#111] tabular-nums shrink-0">{fmt(item.total_cents)}</p>
        </div>
        {item.qty > 1 && (
          <p className="text-[11px] text-[#9ca3af] mt-1">{item.qty} × {fmt(item.unit_price_cents)}</p>
        )}
      </div>
    </div>
  );
}

export default function ProposalTemplate({ data }: { data: QuoteRenderData }) {
  const fmt = (cents: number) => formatMoneyFromCents(cents, data.currency);
  const accent = '#374151';

  return (
    <div className="bg-white text-[#1a1a1a]" style={{ fontFamily: '"Inter", -apple-system, sans-serif', fontSize: '14px', lineHeight: '1.6' }}>

      {/* ═══════════════════════════════════════════════════════════
          SECTION 1 — COVER
          ═══════════════════════════════════════════════════════════ */}
      <div className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #171717 0%, #262626 50%, #404040 100%)' }}>
        <div className="px-10 py-14 relative z-10">
          {/* Company */}
          <div className="flex items-start justify-between">
            {data.company_logo_url ? (
              <img src={data.company_logo_url} alt={data.company_name} className="h-8 max-w-[160px] object-contain brightness-0 invert" />
            ) : (
              <p className="text-[16px] font-semibold text-white/90 tracking-wide">{data.company_name}</p>
            )}
            <div className="text-right text-[11px] text-white/50 space-y-0.5">
              {data.company_email && <p>{data.company_email}</p>}
              {data.company_phone && <p>{data.company_phone}</p>}
            </div>
          </div>

          {/* Title */}
          <div className="mt-12">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em]" style={{ color: accent }}>Proposal</p>
            <h1 className="mt-2 text-[28px] font-bold text-white leading-tight">{data.title}</h1>
            <p className="mt-3 text-[13px] text-white/60">
              Prepared for <span className="text-white font-medium">{data.contact_name || '—'}</span>
              {data.contact_company && <> · {data.contact_company}</>}
            </p>
          </div>

          {/* Meta pills */}
          <div className="mt-8 flex gap-3">
            <div className="rounded-lg bg-white/10 backdrop-blur px-4 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-white/40">Date</p>
              <p className="mt-0.5 text-[13px] font-medium text-white">{fmtDate(data.created_at)}</p>
            </div>
            {data.valid_until && (
              <div className="rounded-lg bg-white/10 backdrop-blur px-4 py-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-white/40">Valid until</p>
                <p className="mt-0.5 text-[13px] font-medium text-white">{fmtDate(data.valid_until)}</p>
              </div>
            )}
            <div className="rounded-lg bg-white/10 backdrop-blur px-4 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-white/40">Ref</p>
              <p className="mt-0.5 text-[13px] font-medium text-white">{data.quote_number}</p>
            </div>
            <div className="rounded-lg px-4 py-2.5 ml-auto" style={{ backgroundColor: accent }}>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-white/60">Total</p>
              <p className="mt-0.5 text-[16px] font-bold text-white tabular-nums">{fmt(data.total_cents)}</p>
            </div>
          </div>
        </div>
        {/* Decorative circles */}
        <div className="absolute -right-20 -top-20 w-60 h-60 rounded-full" style={{ background: `${accent}15` }} />
        <div className="absolute -left-10 -bottom-16 w-40 h-40 rounded-full" style={{ background: `${accent}10` }} />
      </div>

      {/* ═══════════════════════════════════════════════════════════
          SECTION 2 — CLIENT & INTRODUCTION
          ═══════════════════════════════════════════════════════════ */}
      <div className="px-10 py-8">
        {/* Client info card */}
        <div className="rounded-xl bg-[#f8fafc] border border-[#e2e8f0] p-6 flex gap-8">
          <div className="flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9ca3af]">Client</p>
            <p className="mt-2 text-[15px] font-semibold text-[#111]">{data.contact_name || '—'}</p>
            {data.contact_company && <p className="text-[13px] text-[#6b7280]">{data.contact_company}</p>}
            <div className="mt-1.5 text-[12px] text-[#9ca3af] space-y-0.5">
              {data.contact_address && <p>{data.contact_address}</p>}
              {data.contact_email && <p>{data.contact_email}</p>}
              {data.contact_phone && <p>{data.contact_phone}</p>}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9ca3af]">From</p>
            <p className="mt-2 text-[14px] font-semibold text-[#111]">{data.company_name}</p>
            <div className="mt-1.5 text-[12px] text-[#9ca3af] space-y-0.5">
              {data.company_address && <p>{data.company_address}</p>}
              {data.company_email && <p>{data.company_email}</p>}
              {data.company_phone && <p>{data.company_phone}</p>}
            </div>
          </div>
        </div>

        {/* Introduction / scope */}
        {data.introduction && (
          <div className="mt-8">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: accent }}>Scope of Work</h2>
            <div className="mt-3 text-[13px] text-[#4b5563] leading-relaxed whitespace-pre-wrap">
              {data.introduction}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          SECTION 3 — SERVICES (as cards, not table)
          ═══════════════════════════════════════════════════════════ */}
      <div className="px-10 py-6 bg-[#f9fafb]">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest mb-4" style={{ color: accent }}>
          What's Included
        </h2>
        <div className="space-y-3">
          {data.items.map((item) => (
            item.item_type === 'heading' ? (
              <p key={item.id} className="text-[12px] font-bold uppercase tracking-wider text-[#374151] pt-3 pb-1 border-b border-[#e5e7eb]">
                {item.name}
              </p>
            ) : (
              <ServiceCard key={item.id} item={item} fmt={fmt} />
            )
          ))}
          {data.items.length === 0 && (
            <p className="text-center text-[13px] text-[#9ca3af] py-8">No services listed</p>
          )}
        </div>

        {/* Optional add-ons */}
        {data.optional_items.length > 0 && (
          <>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#9ca3af] mt-8 mb-3">
              Optional Add-ons
            </h3>
            <div className="space-y-3">
              {data.optional_items.map((item) => (
                <div key={item.id} className="rounded-xl border border-dashed border-[#d1d5db] bg-white p-5 flex items-start gap-4 opacity-80">
                  <div className="w-10 h-10 rounded-full bg-[#fefce8] flex items-center justify-center shrink-0">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a16207" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[13px] font-medium text-[#374151]">{item.name}</p>
                        {item.description && <p className="text-[12px] text-[#9ca3af] mt-0.5">{item.description}</p>}
                      </div>
                      <p className="text-[13px] font-semibold text-[#374151] tabular-nums shrink-0">{fmt(item.total_cents)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          SECTION 4 — INVESTMENT SUMMARY
          ═══════════════════════════════════════════════════════════ */}
      <div className="px-10 py-8">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest mb-5" style={{ color: accent }}>Your Investment</h2>

        <div className="rounded-xl border border-[#e5e7eb] overflow-hidden">
          <div className="px-6 py-4 space-y-3 text-[14px]">
            <div className="flex justify-between">
              <span className="text-[#6b7280]">Subtotal</span>
              <span className="tabular-nums text-[#374151]">{fmt(data.subtotal_cents)}</span>
            </div>
            {data.discount_cents > 0 && (
              <div className="flex justify-between text-[#059669]">
                <span>Discount</span>
                <span className="tabular-nums">−{fmt(data.discount_cents)}</span>
              </div>
            )}
            {data.tax_cents > 0 && (
              <div className="flex justify-between">
                <span className="text-[#6b7280]">{data.tax_rate_label || 'Tax'} ({data.tax_rate}%)</span>
                <span className="tabular-nums text-[#374151]">{fmt(data.tax_cents)}</span>
              </div>
            )}
          </div>
          <div className="flex justify-between px-6 py-5 text-[18px] font-bold text-white" style={{ backgroundColor: accent }}>
            <span>Total Investment</span>
            <span className="tabular-nums">{fmt(data.total_cents)}</span>
          </div>
          {/* Payment schedule */}
          {data.deposit_required && data.deposit_cents > 0 && (
            <div className="px-6 py-4 bg-[#f8fafc] border-t border-[#e5e7eb]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9ca3af] mb-3">Payment Schedule</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#111] text-white text-[10px] font-bold flex items-center justify-center">1</span>
                    <span className="text-[#374151]">Deposit — due upon acceptance</span>
                  </div>
                  <span className="font-semibold text-[#111] tabular-nums">{fmt(data.deposit_cents)}</span>
                </div>
                <div className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#e5e7eb] text-[#6b7280] text-[10px] font-bold flex items-center justify-center">2</span>
                    <span className="text-[#6b7280]">Balance — due upon completion</span>
                  </div>
                  <span className="text-[#6b7280] tabular-nums">{fmt(data.total_cents - data.deposit_cents)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          SECTION 5 — NOTES & TERMS
          ═══════════════════════════════════════════════════════════ */}
      {(data.notes || data.contract_disclaimer) && (
        <div className="px-10 py-6 bg-[#f9fafb] border-t border-[#e5e7eb]">
          {data.notes && (
            <div className="mb-6">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[#9ca3af]">Additional Notes</h2>
              <p className="mt-2 whitespace-pre-wrap text-[13px] text-[#4b5563] leading-relaxed">{data.notes}</p>
            </div>
          )}
          {data.contract_disclaimer && (
            <div>
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[#9ca3af]">Terms & Conditions</h2>
              <p className="mt-2 whitespace-pre-wrap text-[11px] text-[#9ca3af] leading-relaxed">{data.contract_disclaimer}</p>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          FOOTER
          ═══════════════════════════════════════════════════════════ */}
      <div className="px-10 py-6 text-center border-t border-[#e5e7eb]">
        <p className="text-[12px] text-[#9ca3af]">We look forward to working with you.</p>
        <p className="text-[11px] text-[#d1d5db] mt-1">{data.company_name}</p>
      </div>
    </div>
  );
}
