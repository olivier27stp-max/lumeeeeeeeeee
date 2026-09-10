/**
 * InvoiceView — la facture telle que le client la voit, depuis le lien
 * copié sur la fiche (« Link ») ou reçu par courriel / texto. Sans session.
 *
 * Audit QA prod du 2026-09-09, n°1 : ce lien aboutissait sur la page de
 * DEVIS, qui répondait « Soumission introuvable » pour toutes les factures.
 * Même document que QuoteView, sans les gestes de devis (accepter, refuser,
 * signer) : ici on lit, on télécharge, et on paie si un lien de paiement
 * a été créé.
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, CreditCard, FileText, Printer } from 'lucide-react';
import { captureClientException } from '../lib/sentry';
import { versDate } from '../lib/dateSeule';
import { fetchPublicInvoice, type PublicInvoiceData, type PublicInvoiceCompany } from '../lib/invoicesPublicApi';

const LUME_LOGO_URL = '/lume-logo.png';
const isFr = (typeof navigator !== 'undefined' && navigator.language || 'fr').toLowerCase().startsWith('fr');

function fmtMoney(cents: number, currency = 'CAD'): string {
  return new Intl.NumberFormat(isFr ? 'fr-CA' : 'en-CA', { style: 'currency', currency }).format((cents || 0) / 100);
}

function fmtDate(iso: string | null | undefined, dateSeule = false): string {
  if (!iso) return '';
  const d = dateSeule ? versDate(iso) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(isFr ? 'fr-CA' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function buildCompanyAddress(c: PublicInvoiceCompany | null): string | null {
  if (!c) return null;
  const parts = [c.street1, c.city, c.province, c.postal_code].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

function libelleStatut(status: string, balance: number): string {
  if (status === 'paid' || balance <= 0) return isFr ? 'Payée' : 'Paid';
  if (status === 'overdue') return isFr ? 'En retard' : 'Overdue';
  if (status === 'partial') return isFr ? 'Partiellement payée' : 'Partially paid';
  if (status === 'draft') return isFr ? 'Brouillon' : 'Draft';
  return isFr ? 'En attente de paiement' : 'Awaiting payment';
}

export default function InvoiceView() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicInvoiceData | null>(null);
  const [etat, setEtat] = useState<'loading' | 'view' | 'error'>('loading');

  useEffect(() => {
    if (!token) { setEtat('error'); return; }
    let annule = false;
    (async () => {
      try {
        const d = await fetchPublicInvoice(token);
        if (annule) return;
        setData(d);
        setEtat('view');
        document.title = `${isFr ? 'Facture' : 'Invoice'} #${d.invoice.invoice_number}${d.company?.company_name ? ` — ${d.company.company_name}` : ''}`;
      } catch (err) {
        if (annule) return;
        const status = (err as { status?: number })?.status;
        if (status !== 404) captureClientException(err, { operation: 'invoice.publicView' });
        setEtat('error');
      }
    })();
    return () => { annule = true; };
  }, [token]);

  if (etat === 'loading') {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#e5e5e5] border-t-[#111] rounded-full animate-spin" />
      </div>
    );
  }

  if (etat === 'error' || !data) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <FileText size={36} className="text-[#d4d4d4] mx-auto mb-3" />
          <h1 className="text-[16px] font-semibold text-[#111]">{isFr ? 'Facture introuvable' : 'Invoice Not Found'}</h1>
          <p className="text-[13px] text-[#888] mt-1">{isFr ? 'Ce lien est peut-être expiré ou invalide.' : 'This link may have expired or is invalid.'}</p>
        </div>
      </div>
    );
  }

  const { invoice, items, client, company, pay_token } = data;
  const cur = invoice.currency || 'CAD';
  const payee = invoice.status === 'paid' || invoice.balance_cents <= 0;
  const companyAddress = buildCompanyAddress(company);
  const logoUrl = company?.logo_url || LUME_LOGO_URL;
  const nomCompagnie = company?.company_name || 'Lume';

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .invoice-doc { box-shadow: none !important; border: none !important; margin: 0 !important; padding: 32px !important; max-width: 100% !important; }
        }
      `}</style>

      <div className="max-w-[680px] mx-auto py-8 px-4 sm:py-12">
        {payee && (
          <div className="bg-[#f8f8f8] border border-[#e0e0e0] rounded-lg p-4 mb-5 flex items-center gap-3 no-print">
            <CheckCircle className="text-[#333] shrink-0" size={18} />
            <div>
              <p className="font-semibold text-[#111] text-[14px]">{isFr ? 'Facture payée' : 'Invoice paid'}</p>
              <p className="text-[13px] text-[#666]">
                {invoice.paid_at
                  ? (isFr ? `Merci ! Paiement reçu le ${fmtDate(invoice.paid_at)}.` : `Thank you! Payment received on ${fmtDate(invoice.paid_at)}.`)
                  : (isFr ? 'Merci ! Cette facture est réglée.' : 'Thank you! This invoice is settled.')}
              </p>
            </div>
          </div>
        )}

        <div className="invoice-doc bg-surface rounded-lg border border-[#e5e5e5] shadow-sm overflow-hidden">
          {/* ── En-tête ── */}
          <div className="px-8 pt-8 pb-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <img
                  src={logoUrl}
                  alt={nomCompagnie}
                  className="h-10 max-w-[180px] object-contain mb-3"
                  onError={(e) => { (e.target as HTMLImageElement).src = LUME_LOGO_URL; }}
                />
                <h2 className="text-[14px] font-semibold text-[#111]">{nomCompagnie}</h2>
                {companyAddress && <p className="text-[12px] text-[#888] mt-0.5">{companyAddress}</p>}
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                  {company?.phone && <span className="text-[12px] text-[#888]">{company.phone}</span>}
                  {company?.email && <span className="text-[12px] text-[#888]">{company.email}</span>}
                  {company?.website && <span className="text-[12px] text-[#888]">{company.website}</span>}
                </div>
              </div>
              <div className="text-right ml-6">
                <h1 className="text-[28px] font-bold text-[#111] tracking-tight leading-none">{isFr ? 'FACTURE' : 'INVOICE'}</h1>
                <p className="text-[13px] text-[#888] mt-1 font-medium">#{invoice.invoice_number}</p>
              </div>
            </div>
          </div>

          <div className="border-t border-[#eee]" />

          {/* ── Client + détails ── */}
          <div className="px-8 py-5 grid grid-cols-2 gap-6">
            <div>
              <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">{isFr ? 'Facturé à' : 'Billed To'}</p>
              {client ? (
                <>
                  <p className="text-[14px] font-semibold text-[#111]">{client.first_name} {client.last_name}</p>
                  {client.company && <p className="text-[12px] text-[#666] mt-0.5">{client.company}</p>}
                  {client.email && <p className="text-[12px] text-[#888] mt-0.5">{client.email}</p>}
                  {client.phone && <p className="text-[12px] text-[#888] mt-0.5">{client.phone}</p>}
                </>
              ) : (
                <p className="text-[13px] text-[#aaa]">--</p>
              )}
            </div>
            <div className="text-right space-y-1.5">
              <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">{isFr ? 'Détails' : 'Details'}</p>
              {(invoice.issued_at || invoice.sent_at) && (
                <div className="flex justify-end gap-2 text-[12px]">
                  <span className="text-[#888]">Date</span>
                  <span className="text-[#333] font-medium">{fmtDate(invoice.issued_at || invoice.sent_at)}</span>
                </div>
              )}
              {invoice.due_date && !payee && (
                <div className="flex justify-end gap-2 text-[12px]">
                  <span className="text-[#888]">{isFr ? 'Échéance' : 'Due'}</span>
                  <span className="text-[#333] font-medium">{fmtDate(invoice.due_date, true)}</span>
                </div>
              )}
              <div className="flex justify-end gap-2 text-[12px]">
                <span className="text-[#888]">{isFr ? 'Statut' : 'Status'}</span>
                <span className="font-medium text-[#333]">{libelleStatut(invoice.status, invoice.balance_cents)}</span>
              </div>
            </div>
          </div>

          {invoice.subject && (
            <div className="px-8 pb-4">
              <p className="text-[13px] font-medium text-[#333]">{invoice.subject}</p>
            </div>
          )}

          <div className="border-t border-[#eee]" />

          {/* ── Lignes ── */}
          <div className="px-8 py-5">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em]">
                  <th className="text-left pb-2 font-semibold">{isFr ? 'Description' : 'Description'}</th>
                  <th className="text-right pb-2 font-semibold w-14">{isFr ? 'Qté' : 'Qty'}</th>
                  <th className="text-right pb-2 font-semibold w-24">{isFr ? 'Prix' : 'Price'}</th>
                  <th className="text-right pb-2 font-semibold w-24">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={4} className="py-3 text-[#aaa]">--</td></tr>
                )}
                {items.map((it) => (
                  <tr key={it.id} className="border-t border-[#f0f0f0] align-top">
                    <td className="py-2.5 pr-3">
                      <p className="text-[#111] font-medium">{it.title || it.description || '—'}</p>
                      {it.title && it.description && <p className="text-[12px] text-[#888] mt-0.5 whitespace-pre-line">{it.description}</p>}
                    </td>
                    <td className="py-2.5 text-right text-[#666]">{it.qty}</td>
                    <td className="py-2.5 text-right text-[#666]">{fmtMoney(it.unit_price_cents, cur)}</td>
                    <td className="py-2.5 text-right text-[#111] font-medium">{fmtMoney(it.line_total_cents, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-[#eee]" />

          {/* ── Totaux ── */}
          <div className="px-8 py-5">
            <div className="ml-auto max-w-[280px] space-y-1.5 text-[13px]">
              <div className="flex justify-between"><span className="text-[#888]">{isFr ? 'Sous-total' : 'Subtotal'}</span><span className="text-[#333]">{fmtMoney(invoice.subtotal_cents, cur)}</span></div>
              {!!invoice.discount_cents && invoice.discount_cents > 0 && (
                <div className="flex justify-between"><span className="text-[#888]">{isFr ? 'Rabais' : 'Discount'}</span><span className="text-[#333]">−{fmtMoney(invoice.discount_cents, cur)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-[#888]">{isFr ? 'Taxes' : 'Tax'}</span><span className="text-[#333]">{fmtMoney(invoice.tax_cents, cur)}</span></div>
              <div className="flex justify-between border-t border-[#eee] pt-2 mt-2 text-[15px]"><span className="font-semibold text-[#111]">Total</span><span className="font-bold text-[#111]">{fmtMoney(invoice.total_cents, cur)}</span></div>
              {invoice.paid_cents > 0 && (
                <>
                  <div className="flex justify-between"><span className="text-[#888]">{isFr ? 'Payé' : 'Paid'}</span><span className="text-[#333]">−{fmtMoney(invoice.paid_cents, cur)}</span></div>
                  <div className="flex justify-between text-[15px]"><span className="font-semibold text-[#111]">{isFr ? 'Solde dû' : 'Balance due'}</span><span className="font-bold text-[#111]">{fmtMoney(invoice.balance_cents, cur)}</span></div>
                </>
              )}
            </div>
          </div>

          {invoice.notes && (
            <>
              <div className="border-t border-[#eee]" />
              <div className="px-8 py-5">
                <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">{isFr ? 'Notes' : 'Notes'}</p>
                <p className="text-[13px] text-[#555] whitespace-pre-line">{invoice.notes}</p>
              </div>
            </>
          )}
        </div>

        {/* ── Actions ── */}
        <div className="mt-5 flex flex-wrap items-center gap-3 no-print">
          {!payee && pay_token && (
            <a
              href={`/pay/${pay_token}`}
              className="inline-flex items-center gap-2 rounded-lg bg-[#111] px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-[#333] transition-colors"
            >
              <CreditCard size={16} />
              {isFr ? `Payer ${fmtMoney(invoice.balance_cents, cur)}` : `Pay ${fmtMoney(invoice.balance_cents, cur)}`}
            </a>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-[#e0e0e0] bg-surface px-4 py-2.5 text-[13px] font-medium text-[#333] hover:bg-[#f5f5f5] transition-colors"
          >
            <Printer size={15} />
            {isFr ? 'Imprimer / PDF' : 'Print / PDF'}
          </button>
          {!payee && !pay_token && company?.email && (
            <p className="text-[12px] text-[#888]">
              {isFr ? 'Pour payer, contactez' : 'To pay, contact'} <a className="underline" href={`mailto:${company.email}`}>{company.email}</a>
            </p>
          )}
        </div>

        <p className="mt-8 text-center text-[11px] text-[#bbb] no-print">
          {isFr ? 'Facture générée avec Lume' : 'Invoice generated with Lume'}
        </p>
      </div>
    </div>
  );
}
