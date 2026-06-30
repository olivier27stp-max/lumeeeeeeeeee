/**
 * HomeServiceMixCard — donut chart for the Home page, shown under the tasks box.
 * Compares revenue from service plans (recurring jobs) vs one-off jobs over the
 * last 12 months, using jobs.total_cents by job_type (same source as the
 * Insights "Recurring Revenue" report).
 */
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { formatCurrency } from '../lib/utils';

const PLANS_COLOR = 'var(--color-primary)';
const ONEOFF_COLOR = '#3b82f6';

async function fetchServiceMix() {
  const orgId = await getCurrentOrgIdOrThrow();
  const from = new Date();
  from.setFullYear(from.getFullYear() - 1);
  const { data } = await supabase
    .from('jobs')
    .select('total_cents, job_type')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('created_at', from.toISOString())
    .limit(10000);

  let plans = 0;
  let oneoff = 0;
  for (const j of data || []) {
    const cents = Number((j as { total_cents?: number }).total_cents || 0);
    if (((j as { job_type?: string }).job_type || 'one_off') === 'recurring') plans += cents;
    else oneoff += cents;
  }
  return { plans: plans / 100, oneoff: oneoff / 100 };
}

export default function HomeServiceMixCard() {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';

  const { data, isLoading } = useQuery({
    queryKey: ['home-service-mix-12m'],
    queryFn: fetchServiceMix,
    staleTime: 60_000,
  });

  const plans = data?.plans ?? 0;
  const oneoff = data?.oneoff ?? 0;
  const total = plans + oneoff;
  const plansPct = total > 0 ? Math.round((plans / total) * 100) : 0;

  const allSlices = [
    { key: 'plans', name: fr ? 'Forfaits service' : 'Service plans', value: plans, color: PLANS_COLOR },
    { key: 'oneoff', name: fr ? 'Jobs ponctuelles' : 'One-off jobs', value: oneoff, color: ONEOFF_COLOR },
  ];
  // Only render non-zero slices so a 100%-uniform ring stays a full solid circle.
  const slices = allSlices.filter((s) => s.value > 0);
  // Small gap between the two colors only when both are present.
  const gapAngle = slices.length > 1 ? 2 : 0;

  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 mb-5 flex flex-col">
      <div className="mb-1">
        <h3 className="text-[15px] font-semibold text-text-primary">
          {fr ? 'Revenus par type' : 'Revenue by type'}
        </h3>
        <p className="text-[12px] text-text-muted">
          {fr ? 'Forfaits vs ponctuel · 12 mois' : 'Plans vs one-off · 12 months'}
        </p>
      </div>

      {isLoading ? (
        <div className="h-[160px] w-full bg-surface-tertiary/50 rounded-lg animate-pulse mt-3" />
      ) : total === 0 ? (
        <div className="h-[160px] flex items-center justify-center text-[12px] text-text-muted">
          {fr ? 'Aucun revenu sur 12 mois' : 'No revenue in the last 12 months'}
        </div>
      ) : (
        <>
          {/* Donut with centered % of service plans */}
          <div className="relative h-[160px] w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={74}
                  paddingAngle={gapAngle}
                  stroke="none"
                >
                  {slices.map((s) => (
                    <Cell key={s.key} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number, name: string) => [formatCurrency(value), name]}
                  contentStyle={{
                    borderRadius: 12,
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface-card)',
                    color: 'var(--color-text-primary)',
                    fontSize: 13,
                  }}
                  itemStyle={{ color: 'var(--color-text-primary)' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[22px] font-bold text-text-primary tabular-nums leading-none">{plansPct}%</span>
              <span className="text-[10px] text-text-muted mt-1">{fr ? 'forfaits' : 'plans'}</span>
            </div>
          </div>

          {/* Legend with amounts */}
          <div className="mt-3 space-y-2">
            {allSlices.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-[12px] text-text-secondary flex-1 truncate">{s.name}</span>
                <span className="text-[13px] font-semibold text-text-primary tabular-nums">{formatCurrency(s.value)}</span>
              </div>
            ))}
          </div>

          <button
            onClick={() => navigate('/insights')}
            className="mt-3 pt-3 border-t border-border text-[12px] font-medium text-primary hover:underline self-end"
          >
            {fr ? 'Voir les analyses' : 'View insights'}
          </button>
        </>
      )}
    </div>
  );
}
