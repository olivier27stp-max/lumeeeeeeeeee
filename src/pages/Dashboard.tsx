import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Plus, Navigation, TrendingUp, DollarSign, Briefcase, Target, Users, Calendar as CalIcon, ArrowUpRight, Trophy, Radio } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { CRMMapCard } from '../components/map';
import { DashboardData, getDashboardData } from '../lib/dashboardApi';
import { formatCurrency, cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { useOfflineCache } from '../hooks/useOfflineCache';
import { useQuery } from '@tanstack/react-query';
import { fetchQuoteKpis, formatQuoteMoney } from '../lib/quotesApi';
import { useJobModalController } from '../contexts/JobModalController';
import { getLeaderboard } from '../lib/leaderboardApi';
import { getAllActiveSessions } from '../lib/fieldSessionsApi';
import { usePermissions } from '../hooks/usePermissions';
import { hasPermission } from '../lib/permissions';

/* ═══ Shared dark panel ═══ */
const darkPanel = 'rounded-2xl bg-surface-card border border-border shadow-card';

export default function Dashboard() {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const [now, setNow] = useState(() => new Date());
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { openJobModal } = useJobModalController();
  const permsCtx = usePermissions();
  const canSeeFinancials = permsCtx.role === 'owner' || permsCtx.role === 'admin' ||
    hasPermission(permsCtx.permissions, 'financial.view_analytics', permsCtx.role ?? undefined);
  const canSeePricing = permsCtx.role === 'owner' || permsCtx.role === 'admin' ||
    hasPermission(permsCtx.permissions, 'financial.view_pricing', permsCtx.role ?? undefined);

  const { data, loading, isOffline, refresh: refreshData } = useOfflineCache<DashboardData>(
    'dashboard', getDashboardData, [refreshTick],
  );

  const greeting = useMemo(() => {
    const h = now.getHours();
    return h < 12 ? t.dashboard.goodMorning : h < 18 ? t.dashboard.goodAfternoon : t.dashboard.goodEvening;
  }, [now, t]);

  const longDate = useMemo(() =>
    now.toLocaleDateString(t.dashboard.enus, { weekday: 'long', month: 'long', day: 'numeric' }),
  [now, language]);

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(id); }, []);

  useEffect(() => {
    let tmr: ReturnType<typeof setTimeout> | null = null;
    const bounce = () => { if (tmr) clearTimeout(tmr); tmr = setTimeout(() => refreshData(), 500); };
    const ch = supabase.channel('dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pipeline_deals', filter: 'deleted_at=is.null' }, bounce)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: 'deleted_at=is.null' }, bounce)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_events' }, bounce)
      .subscribe();
    return () => { if (tmr) clearTimeout(tmr); void supabase.removeChannel(ch); };
  }, [refreshData]);

  const { data: quoteKpis } = useQuery({ queryKey: ['dashboard-quote-kpis'], queryFn: fetchQuoteKpis, staleTime: 30_000 });

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="space-y-6">
        <div><div className="h-8 skeleton w-56 mb-2 rounded-lg" /><div className="h-4 skeleton w-36 rounded-lg" /></div>
        <div className="grid grid-cols-3 gap-4">
          {[0,1,2].map(i => <div key={i} className="h-[140px] rounded-2xl skeleton" />)}
        </div>
        <div className="h-64 skeleton rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={cn(darkPanel, 'py-16 text-center space-y-3')}>
        <p className="text-sm text-text-secondary">{error || t.dashboard.couldNotLoad}</p>
        <button onClick={() => setRefreshTick(n => n + 1)} className="text-sm font-medium text-primary hover:underline">{t.dashboard.retry}</button>
      </div>
    );
  }

  const overdueAmt = (data.performance?.outstanding?.totalCents ?? 0) / 100;
  const hasOverdue = overdueAmt > 0;
  const jobsAction = data.workflow?.jobs?.actionRequired ?? 0;
  const appts = data.appointments?.items || [];
  const topClients = data.performance?.receivables?.topClients || [];
  const pendingQuotes = quoteKpis?.pending_count ?? 0;

  return (
    <div className="space-y-6">
      {/* Offline */}
      {isOffline && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[13px] text-amber-400 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
          {t.dashboard.offlineModeShowingCachedData}
        </div>
      )}

      {/* ═══ HEADER ═══ */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[12px] font-medium text-text-muted uppercase tracking-wider">{longDate}</p>
          <h1 className="text-[24px] font-bold tracking-tight text-text-primary mt-1">{greeting}</h1>
        </div>
        <button
          onClick={() => openJobModal()}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl bg-primary text-white text-[13px] font-semibold shadow-primary hover:brightness-110 active:scale-[0.97] transition-all"
        >
          <Plus size={15} strokeWidth={2.5} />
          {fr ? 'Nouvelle job' : 'New job'}
        </button>
      </div>

      {/* ═══ HERO KPI CARDS — Colorful gradient cards ═══ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {canSeeFinancials ? (
          <ColorKpiCard
            gradient="from-emerald-500 to-teal-600"
            glow="shadow-[0_8px_30px_rgba(16,185,129,0.25)]"
            label={t.dashboard.totalRevenue}
            value={formatCurrency(data.performance?.revenue?.today ?? 0)}
            sub={t.dashboard.today}
            icon={DollarSign}
            onClick={() => navigate('/insights')}
          />
        ) : (
          <ColorKpiCard
            gradient="from-emerald-500 to-teal-600"
            glow="shadow-[0_8px_30px_rgba(16,185,129,0.25)]"
            label={fr ? 'Jobs terminés' : 'Completed Jobs'}
            value={String(data.performance?.todayJobs ?? 0)}
            sub={t.dashboard.today}
            icon={Briefcase}
            onClick={() => navigate('/jobs')}
          />
        )}
        <ColorKpiCard
          gradient="from-gray-700 to-gray-800"
          glow="shadow-[0_8px_30px_rgba(100,116,139,0.25)]"
          label={t.dashboard.activeJobs}
          value={String(data.performance?.todayJobs ?? 0)}
          sub={`${data.performance?.upcomingJobs?.next7Days ?? 0} ${fr ? 'cette semaine' : 'this week'}`}
          icon={Briefcase}
          onClick={() => navigate('/jobs')}
        />
        <ColorKpiCard
          gradient="from-amber-400 to-orange-500"
          glow="shadow-[0_8px_30px_rgba(245,158,11,0.2)]"
          label={t.dashboard.conversionRate}
          value={`${data.performance?.conversionRate ?? 0}%`}
          sub={t.dashboard.leadsConverted}
          icon={Target}
          onClick={() => navigate('/quotes')}
        />
      </div>

      {/* ═══ SECONDARY ROW — compact stat cards ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {canSeeFinancials && <MiniStat label={t.dashboard.outstanding} value={formatCurrency(overdueAmt)} warn={hasOverdue} onClick={() => navigate('/invoices')} />}
        <MiniStat label={t.dashboard.newLeads} value={String(data.performance?.newLeadsToday ?? 0)} onClick={() => navigate('/quotes')} />
        <MiniStat label={t.dashboard.upcomingAppointments} value={String(data.appointments?.total ?? 0)} onClick={() => navigate('/calendar')} />
        {pendingQuotes > 0 && <MiniStat label={t.dashboard.pendingQuotes} value={String(pendingQuotes)} onClick={() => navigate('/quotes')} />}
      </div>

      {/* ═══ ALERTS ═══ */}
      {(hasOverdue || jobsAction > 0) && (
        <div className={cn(darkPanel, 'overflow-hidden divide-y divide-border-light')}>
          {hasOverdue && (
            <button onClick={() => navigate('/invoices?status=past_due')} className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-red-500/[0.06] transition-colors group">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
              <span className="flex-1 text-[13px]">
                <span className="font-semibold text-red-400">{t.dashboard.overdueInvoices}</span>
                <span className="text-text-muted mx-1.5">&middot;</span>
                <span className="font-bold text-text-primary tabular-nums">{formatCurrency(overdueAmt)}</span>
              </span>
              <ArrowRight size={14} className="text-text-muted group-hover:text-red-400 group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>
          )}
          {jobsAction > 0 && (
            <button onClick={() => navigate('/jobs')} className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-amber-500/[0.06] transition-colors group">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0 shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
              <span className="flex-1 text-[13px] font-semibold text-amber-400">{jobsAction} {t.dashboard.jobsNeedAction}</span>
              <ArrowRight size={14} className="text-text-muted group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>
          )}
        </div>
      )}

      {/* ═══ MAIN CONTENT — Jobs + Revenue side by side ═══ */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
        {/* Today's jobs */}
        <div className={cn(darkPanel, 'overflow-hidden')}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-light">
            <h2 className="text-[13px] font-semibold text-text-primary">{t.dashboard.todaysJobs}</h2>
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/calendar')} className="text-[12px] font-medium text-text-muted hover:text-text-primary transition-colors">
                {t.dashboard.viewCalendar}
              </button>
            </div>
          </div>

          {appts.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-gray-500/20 to-gray-400/10 flex items-center justify-center mx-auto mb-4">
                <CalIcon size={20} className="text-gray-400" />
              </div>
              <p className="text-[14px] font-semibold text-text-primary">{fr ? 'Aucune job aujourd\'hui' : 'No jobs today'}</p>
              <p className="text-[12px] text-text-muted mt-1 mb-5">{fr ? 'Planifiez votre journee.' : 'Plan your day ahead.'}</p>
              <div className="flex items-center justify-center gap-2">
                <button onClick={() => openJobModal()} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl bg-primary text-white text-[12px] font-semibold hover:brightness-110 active:scale-[0.97] transition-all shadow-primary">
                  <Plus size={14} strokeWidth={2.5} /> {fr ? 'Creer une job' : 'Create job'}
                </button>
                <button onClick={() => navigate('/calendar')} className="h-9 px-4 rounded-xl border border-border text-[12px] font-medium text-text-secondary hover:bg-surface-tertiary active:scale-[0.97] transition-all">
                  {fr ? 'Calendrier' : 'Calendar'}
                </button>
              </div>
            </div>
          ) : (
            <div>
              {appts.map((apt, idx) => (
                <button
                  key={apt.id}
                  onClick={() => navigate(`/jobs/${apt.jobId}`)}
                  className={cn(
                    'w-full flex items-center gap-3.5 px-5 py-3.5 text-left transition-all duration-150 group',
                    'hover:bg-surface-tertiary/40 active:bg-surface-tertiary/60',
                    idx > 0 && 'border-t border-border-light'
                  )}
                >
                  <div className="shrink-0 w-12 text-right">
                    <p className="text-[13px] font-semibold text-text-primary tabular-nums leading-none">
                      {new Date(apt.startAt).toLocaleTimeString(t.dashboard.enus, { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-[10px] text-text-muted tabular-nums leading-none mt-1">
                      {new Date(apt.endAt).toLocaleTimeString(t.dashboard.enus, { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="w-[3px] self-stretch rounded-full shrink-0" style={{ backgroundColor: apt.teamColor || '#6b7280' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-text-primary truncate group-hover:text-primary transition-colors">{apt.title}</p>
                    <p className="text-[12px] text-text-muted truncate mt-0.5">
                      {[apt.clientName, apt.propertyAddress].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {apt.propertyAddress && (
                    <a href={apt.latitude && apt.longitude ? `https://www.google.com/maps/dir/?api=1&destination=${apt.latitude},${apt.longitude}` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(apt.propertyAddress)}`}
                      target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                      className="shrink-0 p-1.5 rounded-lg text-text-muted opacity-0 group-hover:opacity-100 hover:!text-primary hover:bg-primary/10 transition-all" title={t.dashboard.navigate}>
                      <Navigation size={14} />
                    </a>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right column — Revenue chart + Top balances */}
        <div className="space-y-4">
          {/* Revenue */}
          <div className={cn(darkPanel, 'overflow-hidden')}>
            <div className="px-5 py-3.5 border-b border-border-light">
              <h3 className="text-[13px] font-semibold text-text-primary">{fr ? 'Revenus' : 'Revenue'}</h3>
            </div>
            <div className="p-5">
              <RevenueChart data={data} fr={fr} />
            </div>
          </div>

          {/* Top balances */}
          {topClients.length > 0 && (
            <div className={cn(darkPanel, 'overflow-hidden')}>
              <div className="px-5 py-3.5 border-b border-border-light">
                <h3 className="text-[13px] font-semibold text-text-primary">{t.dashboard.topBalances}</h3>
              </div>
              <div>
                {topClients.slice(0, 5).map((c, idx) => (
                  <div key={c.clientName} className={cn('flex items-center justify-between px-5 py-3', idx > 0 && 'border-t border-border-light')}>
                    <span className="text-[13px] text-text-secondary truncate mr-3">{c.clientName}</span>
                    <span className="text-[13px] font-bold text-text-primary tabular-nums shrink-0">{formatCurrency(c.balance)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Map */}
      <CRMMapCard defaultRange="today" heightClassName="h-[320px]" onOpenJob={id => navigate(`/jobs/${id}`)} />

      {/* ═══ D2D WIDGETS — Leaderboard + Active Sessions ═══ */}
      <LeaderboardWidget navigate={navigate} fr={fr} />
    </div>
  );
}

/* ═══════════════════════════════════════
   LEADERBOARD + ACTIVE SESSIONS WIDGET
   ═══════════════════════════════════════ */
function LeaderboardWidget({ navigate, fr }: { navigate: any; fr: boolean }) {
  const { data: leaders = [] } = useQuery({
    queryKey: ['dashboard-leaderboard'],
    queryFn: () => getLeaderboard('daily'),
    staleTime: 60_000,
  });
  const { data: activeSessions = [] } = useQuery({
    queryKey: ['dashboard-active-sessions'],
    queryFn: getAllActiveSessions,
    staleTime: 30_000,
  });

  const top3 = leaders.slice(0, 3);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {/* Leaderboard mini */}
      <div className={cn(darkPanel, 'overflow-hidden')}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-light">
          <h3 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
            <Trophy size={14} className="text-yellow-500" />
            {fr ? 'Classement du jour' : 'Today\'s Leaders'}
          </h3>
          <button onClick={() => navigate('/leaderboard')} className="text-[12px] font-medium text-text-muted hover:text-text-primary transition-colors flex items-center gap-1">
            {fr ? 'Voir tout' : 'View all'} <ArrowRight size={12} />
          </button>
        </div>
        {top3.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-text-muted">
            {fr ? 'Aucune donnée de classement' : 'No leaderboard data yet'}
          </div>
        ) : (
          <div>
            {top3.map((entry, idx) => (
              <button
                key={entry.user_id}
                onClick={() => navigate(`/reps/${entry.user_id}`)}
                className={cn('w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-surface-tertiary/40 transition-colors', idx > 0 && 'border-t border-border-light')}
              >
                <span className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold',
                  idx === 0 ? 'bg-yellow-500/20 text-yellow-500' : idx === 1 ? 'bg-gray-400/20 text-gray-400' : 'bg-amber-600/20 text-amber-600'
                )}>{idx + 1}</span>
                <div className="w-7 h-7 rounded-full bg-surface-tertiary flex items-center justify-center text-[10px] font-bold text-text-primary shrink-0">
                  {entry.avatar_url
                    ? <img src={entry.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                    : entry.full_name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-text-primary truncate">{entry.full_name}</p>
                </div>
                <span className="text-[12px] font-bold text-emerald-400 tabular-nums">${entry.revenue.toLocaleString()}</span>
                <span className="text-[11px] text-text-muted tabular-nums ml-1">{entry.closes}v</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active field sessions */}
      <div className={cn(darkPanel, 'overflow-hidden')}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-light">
          <h3 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
            <Radio size={14} className="text-emerald-500 animate-pulse" />
            {fr ? 'Sessions terrain actives' : 'Active Field Sessions'}
            {activeSessions.length > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-500 text-[10px] font-bold">
                {activeSessions.length}
              </span>
            )}
          </h3>
          <button onClick={() => navigate('/field-sales')} className="text-[12px] font-medium text-text-muted hover:text-text-primary transition-colors flex items-center gap-1">
            {fr ? 'Carte' : 'Map'} <ArrowRight size={12} />
          </button>
        </div>
        {activeSessions.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-text-muted">
            {fr ? 'Aucune session active' : 'No active sessions'}
          </div>
        ) : (
          <div>
            {activeSessions.slice(0, 5).map((session, idx) => (
              <div key={session.id} className={cn('flex items-center gap-3 px-5 py-3', idx > 0 && 'border-t border-border-light')}>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-text-primary truncate">{session.rep_name || 'Rep'}</p>
                  {session.territory_name && (
                    <p className="text-[11px] text-text-muted truncate">{session.territory_name}</p>
                  )}
                </div>
                <span className="text-[11px] text-text-muted tabular-nums">
                  {Math.round((Date.now() - new Date(session.started_at).getTime()) / 60000)}m
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════
   COLOR KPI CARD — vibrant gradient
   ═══════════════════════════════════════ */
function ColorKpiCard({ gradient, glow, label, value, sub, icon: Icon, onClick }: {
  gradient: string; glow: string; label: string; value: string; sub?: string; icon: any; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative overflow-hidden rounded-2xl p-6 text-left transition-all duration-200 group',
        'bg-gradient-to-br', gradient, glow,
        'hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]'
      )}
    >
      {/* Decorative circle — abstract shape, not illustration */}
      <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full bg-surface-card/[0.08]" />
      <div className="absolute -bottom-4 -right-10 w-20 h-20 rounded-full bg-surface-card/[0.05]" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[12px] font-semibold text-white/70 uppercase tracking-wider">{label}</p>
          <div className="w-9 h-9 rounded-xl bg-surface-card/15 flex items-center justify-center backdrop-blur-sm">
            <Icon size={18} strokeWidth={2} className="text-white/90" />
          </div>
        </div>
        <p className="text-[30px] font-bold text-white tabular-nums tracking-tight leading-none">{value}</p>
        {sub && <p className="text-[12px] text-white/60 mt-2 font-medium">{sub}</p>}
      </div>
    </button>
  );
}

/* ═══ Mini stat card ═══ */
function MiniStat({ label, value, warn, onClick }: { label: string; value: string; warn?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={cn(darkPanel, 'text-left px-4 py-3.5 transition-all duration-150 hover:bg-surface-tertiary/50 hover:border-outline-strong active:scale-[0.98] group')}>
      <p className="text-[11px] text-text-muted font-medium">{label}</p>
      <p className={cn('text-[20px] font-bold tabular-nums tracking-tight mt-1 leading-none transition-colors', warn ? 'text-red-400' : 'text-text-primary group-hover:text-primary')}>
        {value}
      </p>
    </button>
  );
}

/* ═══ Revenue chart ═══ */
function RevenueChart({ data, fr }: { data: DashboardData; fr: boolean }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const revenue = data.performance?.revenue?.today ?? 0;

  const { data: revenueHistory = [] } = useQuery({
    queryKey: ['dashboard-revenue-7d'],
    queryFn: async () => {
      const { supabase } = await import('../lib/supabase');
      const { getCurrentOrgIdOrThrow } = await import('../lib/orgApi');
      const orgId = await getCurrentOrgIdOrThrow();
      const since = new Date(); since.setDate(since.getDate() - 6);
      const { data } = await supabase.from('invoices').select('total_cents, paid_at')
        .eq('org_id', orgId).eq('status', 'paid').gte('paid_at', since.toISOString()).order('paid_at');
      const byDay = new Map<string, number>();
      for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        byDay.set(d.toISOString().slice(0, 10), 0);
      }
      for (const inv of data || []) {
        const day = inv.paid_at?.slice(0, 10);
        if (day && byDay.has(day)) byDay.set(day, (byDay.get(day) || 0) + Number(inv.total_cents || 0) / 100);
      }
      return Array.from(byDay.entries()).map(([date, value]) => ({
        day: new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
        value: Math.round(value),
      }));
    },
    staleTime: 60_000,
  });

  const days = revenueHistory.length > 0 ? revenueHistory : Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return { day: d.toLocaleDateString('en-US', { weekday: 'short' }), value: 0 };
  });

  const maxVal = Math.max(...days.map(d => d.value), 1);
  const di = hovered ?? 6;

  if (revenue === 0) {
    return (
      <div className="h-[120px] flex flex-col items-center justify-center">
        <p className="text-[18px] font-bold text-text-primary tabular-nums">{formatCurrency(0)}</p>
        <p className="text-[12px] text-text-muted mt-1">{fr ? 'Aucun revenu' : 'No revenue yet'}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-[20px] font-bold text-text-primary tabular-nums tracking-tight">{formatCurrency(days[di].value)}</span>
        <span className="text-[11px] text-text-muted">{hovered !== null ? days[hovered].day : (fr ? "aujourd'hui" : 'today')}</span>
      </div>
      <div className="flex items-end gap-2 h-[90px]">
        {days.map((d, i) => {
          const pct = Math.max((d.value / maxVal) * 100, 5);
          const active = i === 6 || hovered === i;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-2" onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
              <div className="w-full relative flex-1 flex items-end cursor-pointer">
                <div
                  className={cn(
                    'w-full rounded-md transition-all duration-150',
                    active
                      ? 'bg-gradient-to-t from-emerald-500 to-teal-400 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                      : 'bg-surface-tertiary hover:bg-surface-secondary'
                  )}
                  style={{ height: `${pct}%` }}
                />
              </div>
              <span className={cn('text-[10px] tabular-nums transition-colors', active ? 'text-emerald-400 font-semibold' : 'text-text-muted')}>{d.day}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
