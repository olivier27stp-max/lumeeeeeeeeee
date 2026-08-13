import React from 'react';
import { resolveBrand } from '../../lib/brandColor';
import { formatCents } from '../../lib/jobCalc';

// ── Lume fallback logo (panda) ──
const LUME_LOGO_URL = '/lume-logo.png';

/**
 * Resolved, render-ready data for a job agreement document. Built either
 * client-side (authenticated preview in JobDetails) or from the public
 * server endpoint (/api/agreements/public/:token). When the agreement is
 * signed this always comes from the frozen `snapshot`.
 */
/**
 * Service-plan calendar (jobs.job_type = 'recurring') mirrored on the contract.
 * A plan can span several years: each visit may carry its own `year` (legacy
 * plans have none — all their visits belong to the plan's `year`).
 */
export interface AgreementServicePlan {
  year: number;
  visits: Array<{ month: number; date: string; year?: number }>;
}

export interface AgreementDocData {
  agreementNumber: string;
  createdAt: string | null;
  requireSignature: boolean;
  terms: string;
  logoUrl: string | null;
  company: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    taxLines: string[];
    /** Accent choisi par l'entreprise. Absent = encre noire. */
    brandColor?: string | null;
  };
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  propertyAddress: string | null;
  items: Array<{ name: string; qty: number; unit_price_cents: number; total_cents: number }>;
  subtotalCents: number;
  /** Quote discount (jobs have none) — shown between subtotal and taxes so the lines add up to the total. */
  discount?: { amount_cents: number; percent?: number | null } | null;
  taxLines: Array<{ label: string; rate: number; amount_cents: number }>;
  totalCents: number;
  signature: { signerName: string; signatureData: string; signedAt: string | null } | null;
  servicePlan?: AgreementServicePlan | null;
  /** Deposit + payment-method-on-file requirements of the job — shown under the totals. */
  paymentTerms?: {
    deposit_required: boolean;
    deposit_type: 'percentage' | 'fixed' | null;
    deposit_value: number;
    deposit_cents: number;
    require_payment_method: boolean;
  } | null;
}

function fmtDate(iso: string | null | undefined, language: 'en' | 'fr'): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

const MONTH_ABBR: Record<'en' | 'fr', string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fr: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'],
};

const MONTH_FULL: Record<'en' | 'fr', string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'],
};

/** "YYYY-MM-DD" → "mercredi 12 août 2026" (local date parts, no timezone drift). */
function fmtVisitFullDate(date: string, language: 'en' | 'fr'): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return date;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/** "YYYY-MM-DD" → "15 avr" / "Apr 15", parsed from the parts (no timezone drift). */
function fmtVisitDate(date: string, language: 'en' | 'fr'): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return date;
  const abbr = MONTH_ABBR[language][Number(m[2]) - 1] || '';
  const day = Number(m[3]);
  return language === 'fr' ? `${day} ${abbr.toLowerCase()}` : `${abbr} ${day}`;
}

/**
 * The contract paper itself — shared by the authenticated preview modal and
 * the public /contract/:token signature page (same layout as the quote doc).
 */
export default function AgreementDocument({ data, language }: { data: AgreementDocData; language: 'en' | 'fr' }) {
  const fr = language === 'fr';
  const logoUrl = data.logoUrl || LUME_LOGO_URL;
  // Tout hex invalide retombe sur l'encre noire — la valeur part dans du CSS.
  const brand = resolveBrand(data.company.brandColor);
  const plan = data.servicePlan && data.servicePlan.visits.length > 0 ? data.servicePlan : null;
  // One 12-month grid per planned year (legacy visits without a year all fall
  // in the plan's own year). A month can hold several visit dates.
  const planYears: Array<{ year: number; datesByMonth: Record<number, string[]>; count: number }> = [];
  const allPlanVisits = plan ? [...plan.visits].sort((a, b) => a.date.localeCompare(b.date)) : [];
  if (plan) {
    const byYear = new Map<number, Record<number, string[]>>();
    for (const v of plan.visits) {
      const y = v.year ?? plan.year;
      if (!byYear.has(y)) byYear.set(y, {});
      const months = byYear.get(y)!;
      (months[v.month] = months[v.month] || []).push(v.date);
    }
    for (const y of [...byYear.keys()].sort((a, b) => a - b)) {
      const datesByMonth = byYear.get(y)!;
      for (const m of Object.keys(datesByMonth)) datesByMonth[Number(m)].sort();
      planYears.push({
        year: y,
        datesByMonth,
        count: Object.values(datesByMonth).reduce((sum, list) => sum + list.length, 0),
      });
    }
  }
  const multiYearPlan = planYears.length > 1;

  return (
    <div className="agreement-doc bg-white rounded-lg border border-[#e5e5e5] shadow-sm overflow-hidden text-left">
      {/* ── HEADER: logo + company left, CONTRAT right ── */}
      <div className="px-8 pt-8 pb-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <img
              src={logoUrl}
              alt={data.company.name}
              className="h-32 max-w-[440px] object-contain mb-3"
              onError={(e) => { (e.target as HTMLImageElement).src = LUME_LOGO_URL; }}
            />
            <h2 className="text-[14px] font-semibold text-[#111]">{data.company.name}</h2>
            {data.company.address && (
              <p className="text-[12px] text-[#888] mt-0.5">{data.company.address}</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
              {data.company.phone && <span className="text-[12px] text-[#888]">{data.company.phone}</span>}
              {data.company.email && <span className="text-[12px] text-[#888]">{data.company.email}</span>}
              {data.company.website && <span className="text-[12px] text-[#888]">{data.company.website}</span>}
            </div>
            {data.company.taxLines.length > 0 && (
              <p className="text-[11px] text-[#999] mt-1">{data.company.taxLines.join(' · ')}</p>
            )}
          </div>
          <div className="text-right ml-6">
            <h1
              style={{ color: brand }}
              className="text-[28px] font-bold tracking-tight leading-none"
            >
              {fr ? 'CONTRAT' : 'CONTRACT'}
            </h1>
            <p className="text-[13px] text-[#888] mt-1 font-medium">{data.agreementNumber}</p>
            <p className="text-[12px] text-[#aaa] mt-0.5">
              {(fr ? 'Créé le ' : 'Created ') + fmtDate(data.createdAt, language)}
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-[#eee]" />

      {/* ── PARTIES: client + work address ── */}
      <div className="px-8 py-5 grid grid-cols-2 gap-6">
        <div>
          <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">Client</p>
          {data.clientName ? (
            <>
              <p className="text-[14px] font-semibold text-[#111]">{data.clientName}</p>
              {data.clientEmail && <p className="text-[12px] text-[#888] mt-0.5">{data.clientEmail}</p>}
              {data.clientPhone && <p className="text-[12px] text-[#888] mt-0.5">{data.clientPhone}</p>}
            </>
          ) : (
            <p className="text-[13px] text-[#aaa]">--</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">
            {fr ? 'Adresse des travaux' : 'Work address'}
          </p>
          <p className="text-[13px] text-[#333]">{data.propertyAddress || '--'}</p>
        </div>
      </div>

      <div className="border-t border-[#eee]" />

      {/* ── SERVICE PLAN: one 12-month calendar per planned year ── */}
      {plan && (
        <>
          <div className="px-8 py-5 space-y-5">
            {planYears.map((py) => (
              <div key={py.year}>
                <div className="flex items-baseline justify-between mb-2.5">
                  <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em]">
                    {(fr ? 'Plan de service — ' : 'Service plan — ') + py.year}
                  </p>
                  <p className="text-[11px] font-medium text-[#999]">
                    {py.count} {fr ? (py.count > 1 ? 'visites' : 'visite') : (py.count > 1 ? 'visits' : 'visit')}
                  </p>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {MONTH_ABBR[language].map((label, i) => {
                    const dates = py.datesByMonth[i + 1] || [];
                    const selected = dates.length > 0;
                    return (
                      <div
                        key={label}
                        className={`rounded-lg px-2.5 py-2 border ${selected ? 'border-[#111] bg-[#fafafa]' : 'border-[#e5e7eb]'}`}
                      >
                        <p className={`text-[9px] font-semibold uppercase tracking-wider ${selected ? 'text-[#111]' : 'text-[#d1d5db]'}`}>{label}</p>
                        {selected ? (
                          dates.map((date, di) => (
                            <p key={di} className="text-[11px] mt-0.5 font-medium tabular-nums text-[#111]">
                              {fmtVisitDate(date, language)}
                            </p>
                          ))
                        ) : (
                          <p className="text-[11px] mt-0.5 font-medium tabular-nums text-[#e5e7eb]">—</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div>
              {allPlanVisits.map((v, idx) => (
                <div
                  key={`${v.month}-${v.date}-${idx}`}
                  className="flex items-center justify-between gap-3 py-2 text-[12px] border-b border-[#f0f0f0] last:border-b-0"
                >
                  <span className="font-medium text-[#222]">
                    {(fr ? 'Visite' : 'Visit') + ' ' + (idx + 1)}
                    <span className="text-[#bbb]"> · </span>
                    {(MONTH_FULL[language][v.month - 1] || '') + (multiYearPlan ? ` ${v.year ?? plan.year}` : '')}
                  </span>
                  <span className="text-[#555] tabular-nums">{fmtVisitFullDate(v.date, language)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-[#eee]" />
        </>
      )}

      {/* ── SERVICES TABLE ── */}
      <div className="px-8 py-6">
        {/* Service plan: state explicitly that prices are the plan total, not per visit */}
        {plan && allPlanVisits.length > 1 && (
          <div className="mb-4 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3.5 py-2.5">
            <p className="text-[12px] font-semibold text-[#333]">
              {fr ? 'Prix du plan de service' : 'Service plan pricing'}
            </p>
            <p className="text-[11.5px] text-[#777] mt-0.5 leading-relaxed">
              {fr
                ? `Les prix ci-dessous couvrent la totalité des ${allPlanVisits.length} visites prévues au plan — il ne s'agit pas d'un prix facturé à chaque visite.`
                : `The prices below cover all ${allPlanVisits.length} planned visits of the plan — this is not a price charged per visit.`}
            </p>
          </div>
        )}
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#e5e5e5]">
              <th className="text-left py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em]">
                {fr ? 'Service(s)' : 'Service(s)'}
              </th>
              <th className="text-center py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em] w-16">
                {fr ? 'Qté' : 'Qty'}
              </th>
              <th className="text-right py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em] w-28">
                {fr ? 'Prix unitaire' : 'Unit price'}
              </th>
              <th className="text-right py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em] w-24">
                {fr ? 'Montant' : 'Amount'}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, i) => (
              <tr key={i} className="border-b border-[#f0f0f0]">
                <td className="py-3 text-[#222] font-medium">{item.name}</td>
                <td className="py-3 text-center text-[#666]">{item.qty}</td>
                <td className="py-3 text-right text-[#666]">{formatCents(item.unit_price_cents)}</td>
                <td className="py-3 text-right font-medium text-[#111]">{formatCents(item.total_cents)}</td>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-[#ccc] text-[13px]">
                  {fr ? 'Aucun service' : 'No services'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── TOTALS ── */}
      <div className="px-8 pb-6">
        <div className="ml-auto w-full max-w-[280px] space-y-2 text-[13px]">
          <div className="flex justify-between">
            <span className="text-[#888]">{fr ? 'Sous-total' : 'Subtotal'}</span>
            <span className="text-[#333] font-medium">{formatCents(data.subtotalCents)}</span>
          </div>
          {data.discount && data.discount.amount_cents > 0 && (
            <div className="flex justify-between">
              <span className="text-[#888]">
                {(fr ? 'Rabais' : 'Discount') + (data.discount.percent ? ` (${data.discount.percent}%)` : '')}
              </span>
              <span className="text-[#333] font-medium">-{formatCents(data.discount.amount_cents)}</span>
            </div>
          )}
          {data.taxLines.map((tax, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-[#888]">{tax.label} ({tax.rate}%)</span>
              <span className="text-[#333] font-medium">{formatCents(tax.amount_cents)}</span>
            </div>
          ))}
          <div className="border-t border-[#e5e5e5] pt-2 mt-2 flex justify-between text-[15px]">
            <span className="font-bold text-[#111]">Total</span>
            <span style={{ color: brand }} className="font-bold">{formatCents(data.totalCents)}</span>
          </div>
        </div>
      </div>

      {/* ── PAYMENT TERMS ── */}
      {data.paymentTerms && (data.paymentTerms.deposit_required || data.paymentTerms.require_payment_method) && (
        <>
          <div className="border-t border-[#eee]" />
          <div className="px-8 py-5">
            <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">
              {fr ? 'Modalités de paiement' : 'Payment terms'}
            </p>
            <div className="space-y-1">
              {data.paymentTerms.deposit_required && (
                <p className="text-[12px] text-[#555] leading-relaxed">
                  {fr
                    ? `Un dépôt de ${formatCents(data.paymentTerms.deposit_cents)}${data.paymentTerms.deposit_type === 'percentage' ? ` (${data.paymentTerms.deposit_value} % du total)` : ''} est requis pour confirmer ce contrat.`
                    : `A deposit of ${formatCents(data.paymentTerms.deposit_cents)}${data.paymentTerms.deposit_type === 'percentage' ? ` (${data.paymentTerms.deposit_value}% of the total)` : ''} is required to confirm this contract.`}
                </p>
              )}
              {data.paymentTerms.require_payment_method && (
                <p className="text-[12px] text-[#555] leading-relaxed">
                  {fr
                    ? 'Une méthode de paiement au dossier est requise.'
                    : 'A payment method on file is required.'}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── TERMS & CONDITIONS ── */}
      {data.terms && (
        <>
          <div className="border-t border-[#eee]" />
          <div className="px-8 py-5">
            <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">
              {fr ? 'Termes et conditions' : 'Terms & conditions'}
            </p>
            <p className="text-[12px] text-[#888] whitespace-pre-wrap leading-relaxed">{data.terms}</p>
          </div>
        </>
      )}

      {/* ── SIGNATURE ── */}
      <div className="border-t border-[#eee]" />
      <div className="px-8 py-6">
        {data.requireSignature ? (
          <>
            <p className="text-[12px] font-semibold text-[#333] mb-4">
              {fr ? "J'ai lu et j'accepte les termes et conditions." : 'I have read and accept the terms and conditions.'}
            </p>
            {data.signature ? (
              <div className="flex items-end justify-between gap-6">
                <div>
                  <div className="border border-[#eee] rounded-md bg-[#fafafa] p-2 inline-block">
                    <img src={data.signature.signatureData} alt="Signature" className="h-14 max-w-[220px] object-contain" />
                  </div>
                  <p className="text-[11px] text-[#999] mt-2 pt-1 border-t border-dotted border-[#ccc] w-[220px]">
                    {fr ? 'Signature du client' : 'Client signature'} — {data.signature.signerName}
                  </p>
                </div>
                <p className="text-[11px] text-[#999]">
                  {(fr ? 'Signé le ' : 'Signed on ') + fmtDate(data.signature.signedAt, language)}
                </p>
              </div>
            ) : (
              <div className="flex items-end justify-between gap-6 pt-8">
                <p className="text-[11px] text-[#999] pt-1 border-t border-dotted border-[#ccc] w-[220px]">
                  {fr ? 'Signature du client' : 'Client signature'}
                </p>
                <p className="text-[11px] text-[#999] pt-1 border-t border-dotted border-[#ccc] w-[120px]">Date</p>
              </div>
            )}
          </>
        ) : (
          <p className="text-[12px] text-[#999]">
            {(fr ? 'Contrat émis le ' : 'Contract issued on ') + fmtDate(data.createdAt, language)}
          </p>
        )}
      </div>
    </div>
  );
}
