/* Client Portal — public page where clients view their invoices, quotes, and pay
   Accessed via /portal/:token — no auth required, token-based access.
*/

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, DollarSign, CheckCircle2, Clock, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTranslation } from '../i18n';

interface PortalData {
  client: { id: string; first_name: string; last_name: string; company: string | null; email: string | null };
  company: { company_name: string; company_logo_url: string | null; company_phone: string | null };
  invoices: Array<{
    id: string;
    invoice_number: string;
    status: string;
    total_cents: number;
    balance_cents: number;
    due_date: string | null;
    subject: string | null;
    view_token: string | null;
  }>;
  quotes: Array<{
    id: string;
    quote_number: string;
    title: string;
    status: string;
    total_cents: number;
    currency: string;
    valid_until: string | null;
    view_token: string | null;
  }>;
  jobs: Array<{
    id: string;
    title: string;
    status: string;
    scheduled_at: string | null;
  }>;
}

function formatMoney(cents: number, locale = 'en-CA'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(cents / 100);
}

function formatDate(d: string | null, locale = 'en-CA'): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

const statusColors: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  sent: 'bg-neutral-100 text-neutral-700',
  draft: 'bg-gray-100 text-gray-600',
  past_due: 'bg-red-100 text-red-700',
  completed: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-neutral-100 text-neutral-700',
  scheduled: 'bg-purple-100 text-purple-700',
  approved: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-500',
  action_required: 'bg-amber-100 text-amber-700',
  awaiting_response: 'bg-purple-100 text-purple-700',
  converted: 'bg-green-100 text-green-700',
};

export default function ClientPortal() {
  const { token } = useParams<{ token: string }>();
  const { t, language } = useTranslation();
  const locale = language === 'fr' ? 'fr-CA' : 'en-CA';
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`/api/portal/${token}`);
        if (!res.ok) throw new Error(res.status === 404 ? t.clientPortal.portalNotFound : t.clientPortal.failedToLoad);
        const json = await res.json();
        setData(json);
      } catch (err: any) {
        setError(err?.message || t.clientPortal.failedToLoad);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-gray-800 rounded-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-800 mb-2">{t.clientPortal.somethingWentWrong}</p>
          <p className="text-sm text-gray-500">{error || t.clientPortal.failedToLoad}</p>
        </div>
      </div>
    );
  }

  const clientName = `${data.client.first_name} ${data.client.last_name}`.trim();
  const totalOwed = data.invoices.reduce((sum, inv) => sum + (inv.balance_cents || 0), 0);
  const paidInvoices = data.invoices.filter((inv) => inv.status === 'paid').length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {data.company.company_logo_url ? (
                <img src={data.company.company_logo_url} alt="" className="h-8 max-w-[120px] object-contain" />
              ) : (
                <span className="text-lg font-bold text-gray-900">{data.company.company_name}</span>
              )}
            </div>
            {data.company.company_phone && (
              <a href={`tel:${data.company.company_phone}`} className="text-sm text-gray-500 hover:text-gray-700">
                {data.company.company_phone}
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Welcome */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t.clientPortal.welcomeBack.replace('${name}', clientName)}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {t.clientPortal.yourDocumentsAndPayments}
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase mb-2">
              <DollarSign size={13} /> {t.clientPortal.balance}
            </div>
            <p className="text-2xl font-bold text-gray-900">{formatMoney(totalOwed, locale)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase mb-2">
              <FileText size={13} /> {t.clientPortal.invoices}
            </div>
            <p className="text-2xl font-bold text-gray-900">{data.invoices.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase mb-2">
              <CheckCircle2 size={13} /> {t.invoices.paid}
            </div>
            <p className="text-2xl font-bold text-gray-900">{paidInvoices}</p>
          </div>
        </div>

        {/* Invoices */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">{t.clientPortal.invoices}</h2>
          </div>
          {data.invoices.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-400">{t.clientPortal.noInvoices}</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {data.invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <FileText size={16} className="text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        #{inv.invoice_number} — {inv.subject || t.clientPortal.invoices}
                      </p>
                      <p className="text-xs text-gray-400">
                        {inv.due_date ? `${t.clientPortal.due} ${formatDate(inv.due_date, locale)}` : '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[inv.status] || 'bg-gray-100 text-gray-600'}`}>
                      {inv.status}
                    </span>
                    <span className="text-sm font-bold text-gray-900 tabular-nums">{formatMoney(inv.total_cents, locale)}</span>
                    {inv.view_token && inv.balance_cents > 0 && (
                      <a
                        href={`/quote/${inv.view_token}`}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                      >
                        {t.payments.pay} <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quotes */}
        {data.quotes && data.quotes.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">{t.clientPortal.quotes}</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {data.quotes.map((q) => (
                <div key={q.id} className="flex items-center justify-between px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <FileText size={16} className="text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        #{q.quote_number} — {q.title || t.clientPortal.quotes}
                      </p>
                      <p className="text-xs text-gray-400">
                        {q.valid_until ? `${t.clientPortal.validUntil} ${formatDate(q.valid_until, locale)}` : '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[q.status] || 'bg-gray-100 text-gray-600'}`}>
                      {q.status.replace('_', ' ')}
                    </span>
                    <span className="text-sm font-bold text-gray-900 tabular-nums">{formatMoney(q.total_cents, locale)}</span>
                    {q.view_token && ['sent', 'awaiting_response', 'action_required'].includes(q.status) && (
                      <a
                        href={`/quote/${q.view_token}`}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                      >
                        {t.clientPortal.view} <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active jobs */}
        {data.jobs.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">{t.clientPortal.jobs}</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {data.jobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <Clock size={16} className="text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{job.title}</p>
                      {job.scheduled_at && (
                        <p className="text-xs text-gray-400">{formatDate(job.scheduled_at, locale)}</p>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[job.status] || 'bg-gray-100 text-gray-600'}`}>
                    {job.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-4">
          <p className="text-xs text-gray-400">
            {t.publicPayment.poweredByLume} — {data.company.company_name}
          </p>
        </div>
      </main>
    </div>
  );
}
