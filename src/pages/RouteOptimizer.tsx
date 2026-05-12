import { useMemo, useState } from 'react';
import { format, startOfDay, addDays } from 'date-fns';
import { MapPin, Play, Calendar as CalendarIcon, Users, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '../i18n';
import { listTeams } from '../lib/teamsApi';
import { listScheduleEventsRange, invalidateScheduleCache } from '../lib/scheduleApi';
import {
  optimizeRoute,
  applyOptimizedSchedule,
  type OptimizeResponse,
} from '../lib/routeOptimizationApi';
import OptimizedRouteMap from '../components/route-optimization/OptimizedRouteMap';
import { cn } from '../lib/utils';

export default function RouteOptimizer() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [date, setDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [teamId, setTeamId] = useState<string>('');
  const [result, setResult] = useState<OptimizeResponse | null>(null);

  const teamsQ = useQuery({ queryKey: ['teams'], queryFn: listTeams });

  const dayStart = useMemo(() => startOfDay(new Date(`${date}T00:00:00`)), [date]);
  const dayEnd = useMemo(() => addDays(dayStart, 1), [dayStart]);

  const jobsQ = useQuery({
    queryKey: ['route-optimizer-events', date, teamId],
    enabled: Boolean(teamId),
    queryFn: async () => {
      const rows = await listScheduleEventsRange({
        startAt: dayStart.toISOString(),
        endAt: dayEnd.toISOString(),
        teamIds: teamId ? [teamId] : [],
      });
      return rows.filter((r) => Boolean(r.job));
    },
  });

  const optimizeMut = useMutation({
    mutationFn: async () => {
      const ids = (jobsQ.data || []).map((r) => r.job!.id).filter(Boolean);
      if (ids.length === 0) throw new Error('No jobs to optimize for this day.');
      return optimizeRoute({ job_ids: ids, depart_at: dayStart.toISOString() });
    },
    onSuccess: (r) => {
      setResult(r);
      if (r.skipped.length) {
        toast.warning(`${r.skipped.length} job(s) skipped (missing coordinates).`);
      } else {
        toast.success('Route optimized.');
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Optimization failed.'),
  });

  const applyMut = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error('Optimize first.');
      return applyOptimizedSchedule(result.ordered_jobs, dayStart);
    },
    onSuccess: ({ updated }) => {
      toast.success(`Rescheduled ${updated} job(s).`);
      invalidateScheduleCache();
      qc.invalidateQueries({ queryKey: ['route-optimizer-events'] });
      setResult(null);
    },
    onError: (e: any) => toast.error(e?.message || 'Reschedule failed.'),
  });

  const originalOrder = useMemo(() => {
    return (jobsQ.data || [])
      .slice()
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  }, [jobsQ.data]);

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8 lg:px-10">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          <MapPin size={13} /> {t.routing?.title || 'Route Optimization'}
        </div>
        <h1 className="mt-1 text-2xl font-bold text-text-primary">{t.routing?.subtitle || "Optimize a team member's day"}</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-secondary">
          {t.routing?.description ||
            'Pick a date and a team. We use a nearest-neighbor heuristic on straight-line distance to suggest a shorter driving order. Real road distances require a Maps API key.'}
        </p>
      </header>

      {/* Controls */}
      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-surface p-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
            <CalendarIcon size={11} className="mr-1 inline" />
            {t.routing?.date || 'Date'}
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => { setDate(e.target.value); setResult(null); }}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-primary"
          />
        </label>
        <label className="flex min-w-[220px] flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
            <Users size={11} className="mr-1 inline" />
            {t.routing?.team || 'Team'}
          </span>
          <select
            value={teamId}
            onChange={(e) => { setTeamId(e.target.value); setResult(null); }}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-primary"
          >
            <option value="">{t.routing?.selectTeam || 'Select a team…'}</option>
            {teamsQ.data?.map((tm) => (
              <option key={tm.id} value={tm.id}>{tm.name}</option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-text-secondary">
            {jobsQ.data ? `${jobsQ.data.length} ${t.routing?.jobsThatDay || 'jobs that day'}` : ''}
          </span>
          <button
            type="button"
            disabled={!teamId || !jobsQ.data?.length || optimizeMut.isPending}
            onClick={() => optimizeMut.mutate()}
            className="flex items-center gap-1.5 rounded-lg bg-text-primary px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {optimizeMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {t.routing?.optimize || 'Optimize route'}
          </button>
        </div>
      </div>

      {/* Map + side-by-side comparison */}
      {result && (
        <div className="grid gap-5 lg:grid-cols-[1fr,460px]">
          <div className="h-[560px]">
            <OptimizedRouteMap
              stops={result.ordered_jobs}
              totalDistanceKm={result.total_distance_km}
              totalDriveMinutes={result.total_drive_minutes}
            />
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                  {t.routing?.beforeAfter || 'Before vs after'}
                </div>
                <div className="text-sm font-semibold text-text-primary">
                  {result.total_distance_km.toFixed(1)} km · ~{result.total_drive_minutes} min
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const proceed = window.confirm(
                    (t.routing?.confirmApply || 'This will reschedule {n} jobs. Proceed?').replace(
                      '{n}',
                      String(result.ordered_jobs.length),
                    ),
                  );
                  if (proceed) applyMut.mutate();
                }}
                disabled={applyMut.isPending}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
              >
                {applyMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                {t.routing?.applyOptimization || 'Apply optimization'}
              </button>
            </div>

            {result.skipped.length > 0 && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>{result.skipped.length} {t.routing?.skipped || 'skipped — missing coordinates'}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <div className="mb-1.5 font-semibold text-text-secondary">{t.routing?.originalOrder || 'Original'}</div>
                <ol className="space-y-1">
                  {originalOrder.map((e, i) => (
                    <li key={e.id} className="truncate rounded-md bg-surface-secondary px-2 py-1 text-text-primary">
                      {i + 1}. {e.job?.title || '—'}
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <div className="mb-1.5 font-semibold text-primary">{t.routing?.optimizedOrder || 'Optimized'}</div>
                <ol className="space-y-1">
                  {result.ordered_jobs.map((s, i) => (
                    <li key={s.job_id} className="rounded-md bg-primary/5 px-2 py-1 text-text-primary">
                      <div className="truncate font-medium">{i + 1}. {s.title || '—'}</div>
                      <div className="text-[10px] text-text-tertiary">
                        +{s.distance_km_from_prev.toFixed(1)} km · {s.eta_minutes_from_prev} min
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <p className="mt-3 text-[10px] leading-snug text-text-tertiary">
              {t.routing?.disclaimer ||
                'Nearest-neighbor is a heuristic, not a true optimum. Distances are straight-line.'}
            </p>
          </div>
        </div>
      )}

      {!result && teamId && jobsQ.data && jobsQ.data.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-surface-secondary/40 p-10 text-center text-sm text-text-secondary">
          {t.routing?.noJobsThatDay || 'No scheduled jobs for this team on this day.'}
        </div>
      )}
    </div>
  );
}
