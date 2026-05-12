import React from 'react';
import type { InvoiceRenderData } from '../types';
import { formatMoneyFromCents } from '../../../lib/invoicesApi';
import { useTranslation } from '../../../i18n';

/* ── Clean Billing — Invoice Template ───────────────────────────
   Ultra-readable, direct, professional.
   Focus: clarity, fast scanning, confidence.
   ────────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null | undefined, locale: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function CleanBillingTemplate({ data }: { data: InvoiceRenderData }) {
  const { t, language } = useTranslation();
  const tpl = (t as any).invoice.template;
  const st_ = (t as any).status;
  const locale = language === 'fr' ? 'fr-CA' : 'en-CA';
  const fmt = (c: number) => formatMoneyFromCents(c, data.currency);

  const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
    draft:        { label: st_.draft,           bg: '#f1f5f9', fg: '#475569' },
    sent:         { label: st_.open,            bg: '#dbeafe', fg: '#1d4ed8' },
    sent_not_due: { label: st_.open,            bg: '#dbeafe', fg: '#1d4ed8' },
    partial:      { label: st_.partial,         bg: '#fef3c7', fg: '#a16207' },
    paid:         { label: st_.paid,            bg: '#dcfce7', fg: '#15803d' },
    void:         { label: st_.void,            bg: '#fecaca', fg: '#b91c1c' },
    overdue:      { label: st_.overdue,         bg: '#fecaca', fg: '#b91c1c' },
  };
  const st = STATUS[data.status] || STATUS.sent;

  return (
    <div className="bg-white text-[#111]" style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",sans-serif', fontSize: '13px', lineHeight: 1.55 }}>
      <div className="px-10 py-10">

        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          <div>
            {data.company_logo_url
              ? <img src={data.company_logo_url} alt={data.company_name} className="h-9 max-w-[160px] object-contain" />
              : <p className="text-[20px] font-semibold tracking-tight">{data.company_name}</p>}
          </div>
          <p className="text-[28px] font-semibold tracking-tight">{tpl.invoice}</p>
        </div>

        {/* ── Meta ── */}
        <div className="mt-8 flex justify-between">
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-[#9ca3af]">{tpl.from}</p>
              <div className="mt-1.5 text-[12px] text-[#4b5563] space-y-0.5">
                <p className="font-medium text-[#111]">{data.company_name}</p>
                {data.company_address && <p>{data.company_address}</p>}
                {data.company_email && <p>{data.company_email}</p>}
                {data.company_phone && <p>{data.company_phone}</p>}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-[#9ca3af]">{tpl.billTo}</p>
              <div className="mt-1.5 text-[12px] text-[#4b5563] space-y-0.5">
                <p className="font-medium text-[#111]">{data.client_name}</p>
                {data.client_company && <p>{data.client_company}</p>}
                {data.client_address && <p>{data.client_address}</p>}
                {data.client_email && <p>{data.client_email}</p>}
                {data.client_phone && <p>{data.client_phone}</p>}
              </div>
            </div>
          </div>
          <div className="text-right space-y-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ backgroundColor: st.bg, color: st.fg }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: st.fg }} />{st.label}
            </span>
            <div className="text-[12px] text-[#6b7280] space-y-1">
              <div><span className="text-[10px] uppercase tracking-wider font-medium text-[#9ca3af] block">{tpl.invoiceNumber}</span>{data.invoice_number}</div>
              <div><span className="text-[10px] uppercase tracking-wider font-medium text-[#9ca3af] block">{tpl.issued}</span>{fmtDate(data.issued_at || data.created_at, locale)}</div>
              <div><span className="text-[10px] uppercase tracking-wider font-medium text-[#9ca3af] block">{tpl.due}</span>{fmtDate(data.due_date, locale)}</div>
            </div>
          </div>
        </div>

        {/* ── Amount due ── */}
        <div className="mt-8 flex items-center justify-between rounded-lg border border-[#e5e7eb] bg-[#fafafa] px-6 py-4">
          <p className="text-[13px] font-medium text-[#6b7280]">{tpl.amountDue}</p>
          <p className="text-[24px] font-semibold tracking-tight">{fmt(data.balance_cents || data.total_cents)}</p>
        </div>

        {/* ── Subject ── */}
        {data.subject && <p className="mt-5 text-[12px] text-[#4b5563]"><span className="font-medium text-[#111]">{tpl.re}</span>{data.subject}</p>}

        {/* ── Items ── */}
        <div className="mt-8">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5e7eb]">
                <th className="pb-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-[#9ca3af]">{tpl.description}</th>
                <th className="pb-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] w-14">{tpl.qty}</th>
                <th className="pb-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] w-24">{tpl.price}</th>
                <th className="pb-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] w-24">{tpl.amount}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(item => (
                <tr key={item.id} className="border-b border-[#f3f4f6]">
                  <td className="py-3 pr-4 text-[12px]">
                    {item.title && <p className="font-medium">{item.title}</p>}
                    <p className={item.title ? 'text-[11px] text-[#9ca3af]' : 'text-[#4b5563]'}>{item.description}</p>
                  </td>
                  <td className="py-3 text-right text-[12px] text-[#6b7280] tabular-nums">{item.qty}</td>
                  <td className="py-3 text-right text-[12px] text-[#6b7280] tabular-nums">{fmt(item.unit_price_cents)}</td>
                  <td className="py-3 text-right text-[12px] font-medium tabular-nums">{fmt(item.line_total_cents)}</td>
                </tr>
              ))}
              {data.items.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-[12px] text-[#d1d5db]">{tpl.noItems}</td></tr>}
            </tbody>
          </table>
        </div>

        {/* ── Totals ── */}
        <div className="mt-3 flex justify-end">
          <div className="w-64 text-[12px]">
            <div className="flex justify-between py-1.5"><span className="text-[#9ca3af]">{tpl.subtotal}</span><span className="tabular-nums">{fmt(data.subtotal_cents)}</span></div>
            {data.discount_cents > 0 && <div className="flex justify-between py-1.5 text-[#dc2626]"><span>{tpl.discount}</span><span className="tabular-nums">-{fmt(data.discount_cents)}</span></div>}
            {data.tax_breakdown && data.tax_breakdown.length > 0 ? (
              data.tax_breakdown.map((tax, i) => (
                <div key={i} className="flex justify-between py-1">
                  <span className="text-[#9ca3af]">{tax.name} ({tax.rate}%)</span>
                  <span className="tabular-nums">{fmt(tax.amount_cents)}</span>
                </div>
              ))
            ) : (
              <div className="flex justify-between py-1.5"><span className="text-[#9ca3af]">{tpl.tax}</span><span className="tabular-nums">{fmt(data.tax_cents)}</span></div>
            )}
            <div className="flex justify-between pt-2.5 mt-1 border-t border-[#e5e7eb] text-[14px] font-semibold"><span>{tpl.total}</span><span className="tabular-nums">{fmt(data.total_cents)}</span></div>
            {data.paid_cents > 0 && <div className="flex justify-between py-1.5 text-[#15803d]"><span>{tpl.paid}</span><span className="tabular-nums">{fmt(data.paid_cents)}</span></div>}
            {data.balance_cents > 0 && data.balance_cents !== data.total_cents && (
              <div className="flex justify-between pt-2 mt-1 border-t border-[#e5e7eb] font-semibold"><span>{tpl.balanceDue}</span><span className="tabular-nums">{fmt(data.balance_cents)}</span></div>
            )}
          </div>
        </div>

        {/* ── Notes ── */}
        {data.notes && (
          <div className="mt-8 border-t border-[#f3f4f6] pt-5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-[#9ca3af] mb-1.5">{tpl.notes}</p>
            <p className="text-[11px] text-[#6b7280] whitespace-pre-wrap leading-relaxed">{data.notes}</p>
          </div>
        )}

        {/* ── Tax Registration Numbers ── */}
        {data.tax_breakdown && data.tax_breakdown.some(t => t.registration_number) && (
          <div className="mt-6 border-t border-[#f3f4f6] pt-4">
            <div className="text-[10px] text-[#9ca3af] space-y-0.5">
              {data.tax_breakdown.filter(t => t.registration_number).map((tax, i) => (
                <p key={i}>{tax.name} {tpl.no}: {tax.registration_number}</p>
              ))}
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="mt-6 border-t border-[#f3f4f6] pt-5 text-center">
          <p className="text-[10px] text-[#d1d5db]">{data.company_name}</p>
        </div>
      </div>
    </div>
  );
}
