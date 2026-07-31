import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { useTranslation } from '../../i18n';

function fmtMoney(cents: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format((cents || 0) / 100);
}

async function fetchData(from: string, to: string) {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data } = await supabase
    .from('jobs')
    .select('total_cents,job_type')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('created_at', from)
    .lte('created_at', `${to}T23:59:59.999Z`)
    .limit(10000);
  let recurring = 0;
  let oneoff = 0;
  for (const j of data || []) {
    const c = Number((j as any).total_cents || 0);
    if ((j as any).job_type === 'recurring') recurring += c;
    else oneoff += c;
  }
  return { recurring, oneoff };
}

/** Jobber-style "Recurring vs One-off" donut — real data, Lume colours. */
export default function RecurringVsOneOffCard({ from, to }: { from: string; to: string }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const locale = fr ? 'fr-CA' : 'en-CA';
  const { data, isLoading } = useQuery({
    queryKey: ['recurring-vs-oneoff', from, to],
    queryFn: () => fetchData(from, to),
    staleTime: 60_000,
  });

  const recurring = data?.recurring || 0;
  const oneoff = data?.oneoff || 0;
  const total = recurring + oneoff;
  const oneoffPct = total > 0 ? Math.round((oneoff / total) * 100) : 0;
  const recPct = total > 0 ? 100 - oneoffPct : 0;

  return (
    <div className="rounded-xl border border-border bg-surface-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
        <h3 className="text-[14.5px] font-bold text-text-primary">{fr ? 'Récurrent vs ponctuel' : 'Recurring vs one-off'}</h3>
      </div>
      {isLoading ? (
        <div className="p-5"><div className="h-[150px] bg-surface-tertiary/50 rounded-lg animate-pulse" /></div>
      ) : total === 0 ? (
        <div className="py-12 text-center text-[12.5px] text-text-tertiary">{fr ? 'Aucune donnée' : 'No data'}</div>
      ) : (
        <div className="p-5 flex items-center gap-6">
          <div className="relative w-[130px] h-[130px] shrink-0">
            <svg width="130" height="130" viewBox="0 0 42 42" aria-label={fr ? 'Récurrent vs ponctuel' : 'Recurring vs one-off'}>
              <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--color-surface-tertiary)" strokeWidth="5" />
              <circle
                cx="21" cy="21" r="15.9" fill="none" stroke="var(--color-chart-primary)" strokeWidth="5"
                strokeDasharray={`${oneoffPct} ${100 - oneoffPct}`} strokeDashoffset="25"
              />
              <circle
                cx="21" cy="21" r="15.9" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="5"
                strokeDasharray={`${recPct} ${100 - recPct}`} strokeDashoffset={`${25 - oneoffPct}`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[19px] font-extrabold text-text-primary tabular-nums tracking-tight leading-none">{fmtMoney(total, locale)}</span>
              <span className="text-[11px] text-text-muted font-semibold mt-1">Total</span>
            </div>
          </div>
          <div className="flex-1 flex flex-col gap-3">
            <div className="flex items-center gap-2.5 text-[13px] font-medium text-text-secondary">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-text-tertiary)' }} />
              {fr ? 'Récurrent' : 'Recurring'}
              <span className="ml-auto font-bold text-text-primary tabular-nums">{fmtMoney(recurring, locale)}</span>
              <span className="text-text-muted tabular-nums w-9 text-right">{recPct}%</span>
            </div>
            <div className="flex items-center gap-2.5 text-[13px] font-medium text-text-secondary">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-chart-primary)' }} />
              {fr ? 'Ponctuel' : 'One-off'}
              <span className="ml-auto font-bold text-text-primary tabular-nums">{fmtMoney(oneoff, locale)}</span>
              <span className="text-text-muted tabular-nums w-9 text-right">{oneoffPct}%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
