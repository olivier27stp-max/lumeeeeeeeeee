import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { useTranslation } from '../../i18n';

const COLORS = ['#1961ED', '#10B981', '#F59E0B', '#8B5CF6', '#94A3B8'];

function fmtMoney(cents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format((cents || 0) / 100);
}

function normalizeMethod(method: string | null | undefined, provider: string | null | undefined): string {
  const m = String(method || '').toLowerCase();
  const p = String(provider || '').toLowerCase();
  if (m.includes('card') || m === 'cc' || p === 'stripe') return 'Card';
  if (m.includes('ach') || m.includes('bank') || m.includes('transfer')) return 'ACH';
  if (m.includes('cash')) return 'Cash';
  if (p === 'paypal') return 'PayPal';
  return 'Other';
}

async function fetchData() {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data } = await supabase
    .from('payments')
    .select('amount_cents,method,provider,status')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .eq('status', 'succeeded')
    .limit(5000);
  const totals = new Map<string, number>();
  for (const p of data || []) {
    const key = normalizeMethod((p as any).method, (p as any).provider);
    totals.set(key, (totals.get(key) || 0) + Number((p as any).amount_cents || 0));
  }
  return Array.from(totals.entries()).map(([name, value]) => ({ name, value }));
}

export default function PaymentMethodMixCard() {
  const { t } = useTranslation();
  const ti = (t.insights as any).reports || {};
  const { data = [], isLoading } = useQuery({ queryKey: ['report-payment-method-mix'], queryFn: fetchData, staleTime: 60_000 });
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col h-full">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{ti.paymentMethodMix || 'Payment Method Mix'}</h3>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{ti.byProvider || 'By provider / method'}</p>
      </div>
      {isLoading ? (
        <div className="flex-1 min-h-[200px] animate-pulse bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
      ) : total === 0 ? (
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-sm text-zinc-400">{ti.noData || 'No data'}</div>
      ) : (
        <div className="flex-1 grid grid-cols-2 gap-3 min-h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmtMoney(v)} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="space-y-1.5 text-sm self-center">
            {data.map((d, i) => (
              <li key={d.name} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />{d.name}</span>
                <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{((d.value / total) * 100).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
