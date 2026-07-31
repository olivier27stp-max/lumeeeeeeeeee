import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { useTranslation } from '../../i18n';

function fmtMoney(cents: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format((cents || 0) / 100);
}

function csvEscape(v: any): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function fetchData(unknownLabel: string) {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data: clients } = await supabase
    .from('clients')
    .select('id,first_name,last_name')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .limit(2000);
  const ids = (clients || []).map((c: any) => c.id);
  if (ids.length === 0) return [];
  const { data: invoices } = await supabase
    .from('invoices')
    .select('client_id,paid_cents')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .in('client_id', ids);
  const totals = new Map<string, number>();
  for (const inv of invoices || []) {
    const id = (inv as any).client_id;
    totals.set(id, (totals.get(id) || 0) + Number((inv as any).paid_cents || 0));
  }
  return (clients || [])
    .map((c: any) => ({
      id: c.id,
      name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || unknownLabel,
      total: totals.get(c.id) || 0,
    }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
}

export default function ClientLifetimeValueCard() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const locale = fr ? 'fr-CA' : 'en-CA';
  const ti = (t.insights as any).reports || {};
  const { data = [], isLoading } = useQuery({ queryKey: ['report-client-ltv', language], queryFn: () => fetchData(fr ? 'Inconnu' : 'Unknown'), staleTime: 60_000 });

  function exportCsv() {
    const rows = [['Client', fr ? 'Revenu à vie' : 'Lifetime Revenue'], ...data.map((d) => [d.name, ((d.total || 0) / 100).toFixed(2)])];
    const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'client-lifetime-value.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col h-full">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{ti.clientLifetimeValue || 'Client Lifetime Value'}</h3>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">{ti.top10Clients || 'Top 10 clients'}</p>
        </div>
        {data.length > 0 && (
          <button onClick={exportCsv} className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-[11px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
            <Download size={12} /> CSV
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="flex-1 min-h-[200px] animate-pulse bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
      ) : data.length === 0 ? (
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-sm text-zinc-400">{ti.noData || 'No data'}</div>
      ) : (
        <ul className="flex-1 space-y-2 text-sm">
          {data.map((c, i) => (
            <li key={c.id} className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-1.5 last:border-none">
              <span className="text-zinc-700 dark:text-zinc-300 truncate"><span className="text-zinc-400 mr-2">{i + 1}.</span>{c.name}</span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">{fmtMoney(c.total, locale)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
