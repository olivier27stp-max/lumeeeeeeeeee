import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { useTranslation } from '../../i18n';

function fmtMoney(cents: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format((cents || 0) / 100);
}

async function fetchData() {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data } = await supabase
    .from('invoices')
    .select('balance_cents,due_date,status')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .neq('status', 'paid')
    .neq('status', 'draft')
    .limit(5000);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const inv of data || []) {
    const bal = Number((inv as any).balance_cents || 0);
    if (bal <= 0) continue;
    const due = (inv as any).due_date ? new Date((inv as any).due_date) : null;
    if (!due) {
      buckets.current += bal;
      continue;
    }
    const days = Math.floor((today.getTime() - due.getTime()) / 86400000);
    if (days <= 0) buckets.current += bal;
    else if (days <= 30) buckets['1-30'] += bal;
    else if (days <= 60) buckets['31-60'] += bal;
    else if (days <= 90) buckets['61-90'] += bal;
    else buckets['90+'] += bal;
  }
  return Object.entries(buckets).map(([label, value]) => ({ label, value }));
}

export default function InvoiceAgingCard() {
  const { t, language } = useTranslation();
  const locale = language === 'fr' ? 'fr-CA' : 'en-CA';
  const ti = (t.insights as any).reports || {};
  const { data = [], isLoading } = useQuery({ queryKey: ['report-invoice-aging'], queryFn: fetchData, staleTime: 60_000 });
  const hasData = data.some((d) => d.value > 0);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col h-full">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{ti.invoiceAging || 'Invoice Aging'}</h3>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{ti.accountsReceivable || 'Accounts receivable by age'}</p>
      </div>
      {isLoading ? (
        <div className="flex-1 min-h-[200px] animate-pulse bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
      ) : !hasData ? (
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-sm text-zinc-400">{ti.noData || 'No data'}</div>
      ) : (
        <div className="flex-1 min-h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid vertical={false} stroke="#e4e4e7" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 100).toFixed(0)}`} />
              <Tooltip formatter={(v: number) => fmtMoney(v, locale)} />
              <Bar dataKey="value" fill="var(--color-primary)" radius={[6, 6, 0, 0]} maxBarSize={50} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
