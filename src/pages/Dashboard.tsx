import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Briefcase,
  Calendar,
  DollarSign,
  FileText,
  TrendingUp,
  Users,
  Target,
  UserPlus,
  MapPin,
  Clock,
  AlertTriangle,
  Navigation,
  Phone,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { CRMMapCard } from '../components/map';
import { DashboardData, getDashboardData } from '../lib/dashboardApi';
import { formatCurrency } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { StatCard, IconTile } from '../components/ui';
import { CardSkeleton } from '../components/ui/Skeleton';
import { useOfflineCache } from '../hooks/useOfflineCache';
import { useQuery } from '@tanstack/react-query';
import { fetchQuoteKpis, formatQuoteMoney } from '../lib/quotesApi';

export default function Dashboard() {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Offline-cached dashboard data
  const { data, loading, isOffline, refresh: refreshData } = useOfflineCache<DashboardData>(
    'dashboard',
    getDashboardData,
    [refreshTick],
  );

  function getGreeting(date = new Date()) {
    const hour = date.getHours();
    if (hour < 12) return t.dashboard.goodMorning;
    if (hour < 18) return t.dashboard.goodAfternoon;
    return t.dashboard.goodEvening;
  }

  function formatLongDate(date = new Date()) {
    const locale = language === 'fr' ? 'fr-CA' : 'en-US';
    return date.toLocaleDateString(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Realtime refresh
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pipeline_deals' }, () => refreshData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => refreshData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_events' }, () => refreshData())
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [refreshData]);

  const greeting = useMemo(() => getGreeting(now), [now, t]);
  const longDate = useMemo(() => formatLongDate(now), [now, language]);

  const { data: quoteKpis } = useQuery({
    queryKey: ['dashboard-quote-kpis'],
    queryFn: fetchQuoteKpis,
    staleTime: 30_000,
  });

  function handleOpenJob(jobId: string) {
    navigate(`/jobs/${jobId}`);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 skeleton w-64 mb-2" />
        <div className="h-5 skeleton w-40" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div className="h-80 skeleton" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="section-card p-6 text-center space-y-3">
        <p className="text-sm font-medium text-danger">{error || t.dashboard.couldNotLoad}</p>
        <button
          onClick={() => setRefreshTick((n) => n + 1)}
          className="glass-button-primary text-[13px] px-4 py-2"
        >
          {language === 'fr' ? 'Reessayer' : 'Retry'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Offline indicator */}
      {isOffline && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 px-4 py-2 text-[12px] text-amber-700 dark:text-amber-400 font-medium flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          {language === 'fr' ? 'Mode hors-ligne — donnees en cache' : 'Offline mode — showing cached data'}
        </div>
      )}

      {/* Greeting */}
      <div>
        <p className="text-[13px] text-text-tertiary font-medium">{longDate}</p>
        <h1 className="text-2xl font-bold tracking-tight text-text-primary mt-0.5">
          {greeting}
        </h1>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard
          label={t.dashboard.totalRevenue}
          value={formatCurrency(data.performance?.revenue?.today ?? 0)}
          subtitle={t.dashboard.today}
          icon={DollarSign}
          iconColor="blue"
          onClick={() => navigate('/insights')}
        />
        <StatCard
          label={t.dashboard.outstanding}
          value={formatCurrency((data.performance?.outstanding?.totalCents ?? 0) / 100)}
          subtitle={`${data.performance?.receivables?.clientsOwing ?? 0} ${t.dashboard.clients}`}
          icon={FileText}
          iconColor="blue"
          onClick={() => navigate('/invoices')}
        />
        <StatCard
          label={t.dashboard.activeJobs}
          value={data.performance?.todayJobs ?? 0}
          subtitle={`${data.workflow?.jobs?.actionRequired ?? 0} ${t.dashboard.needAction}`}
          icon={Briefcase}
          iconColor="blue"
          onClick={() => navigate('/jobs')}
        />
        <StatCard
          label={t.dashboard.newLeads}
          value={data.performance?.newLeadsToday ?? 0}
          subtitle={t.dashboard.today}
          icon={UserPlus}
          iconColor="blue"
          onClick={() => navigate('/pipeline')}
        />
        <StatCard
          label={t.dashboard.conversionRate}
          value={`${data.performance?.conversionRate ?? 0}%`}
          subtitle={t.dashboard.leadsConverted}
          icon={Target}
          iconColor="blue"
          onClick={() => navigate('/pipeline')}
        />
        <StatCard
          label={t.dashboard.upcomingAppointments}
          value={data.appointments?.total ?? 0}
          subtitle={t.dashboard.today}
          icon={Calendar}
          iconColor="blue"
          onClick={() => navigate('/calendar')}
        />
      </div>

      {/* Today's Jobs + Urgent Actions */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
        {/* Today's schedule — the main actionable view */}
        <div className="section-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
            <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
              <IconTile icon={Calendar} color="blue" size="sm" />
              {language === 'fr' ? 'Jobs du jour' : 'Today\'s Jobs'}
            </h2>
            <button onClick={() => navigate('/calendar')} className="glass-button !text-[12px] !px-2.5 !py-1">
              {language === 'fr' ? 'Voir le calendrier' : 'View calendar'}
            </button>
          </div>
          <div className="divide-y divide-outline-subtle">
            {(data.appointments?.items || []).length === 0 ? (
              <div className="p-8 text-center">
                <Calendar size={24} className="mx-auto text-text-tertiary mb-2" />
                <p className="text-[13px] text-text-tertiary">
                  {language === 'fr' ? 'Aucune job planifiee aujourd\'hui' : 'No jobs scheduled today'}
                </p>
              </div>
            ) : (
              (data.appointments?.items || []).map((apt) => (
                <button
                  key={apt.id}
                  onClick={() => handleOpenJob(apt.jobId)}
                  className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-surface-secondary transition-colors group"
                >
                  {/* Time */}
                  <div className="text-center shrink-0 w-14">
                    <p className="text-[14px] font-bold text-text-primary tabular-nums">
                      {new Date(apt.startAt).toLocaleTimeString(language === 'fr' ? 'fr-CA' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-[10px] text-text-tertiary">
                      {new Date(apt.endAt).toLocaleTimeString(language === 'fr' ? 'fr-CA' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {/* Color bar */}
                  <div className="w-1 h-10 rounded-full shrink-0" style={{ backgroundColor: apt.teamColor || '#6b7280' }} />
                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary truncate">{apt.title}</p>
                    <p className="text-[12px] text-text-secondary truncate">{apt.clientName || ''}</p>
                    {apt.propertyAddress && (
                      <p className="text-[11px] text-text-tertiary truncate flex items-center gap-1 mt-0.5">
                        <MapPin size={10} /> {apt.propertyAddress}
                      </p>
                    )}
                  </div>
                  {/* Navigate button */}
                  {apt.propertyAddress && (
                    <a
                      href={apt.latitude && apt.longitude
                        ? `https://www.google.com/maps/dir/?api=1&destination=${apt.latitude},${apt.longitude}`
                        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(apt.propertyAddress)}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 p-2 rounded-lg text-text-tertiary hover:text-primary hover:bg-primary/10 transition-colors"
                      title={language === 'fr' ? 'Naviguer' : 'Navigate'}
                    >
                      <Navigation size={15} />
                    </a>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right column — Urgent actions + top balances */}
        <div className="space-y-3">
          {/* Urgent actions */}
          <div className="section-card p-4 space-y-2.5">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
              <AlertTriangle size={11} />
              {language === 'fr' ? 'Actions urgentes' : 'Urgent Actions'}
            </h2>

            {(data.performance?.outstanding?.totalCents ?? 0) > 0 && (
              <button
                onClick={() => navigate('/invoices?status=past_due')}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800/30 text-left hover:border-red-300 transition-colors"
              >
                <div className="p-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 shrink-0">
                  <DollarSign size={14} />
                </div>
                <div className="flex-1">
                  <p className="text-[12px] font-semibold text-red-700 dark:text-red-400">
                    {language === 'fr' ? 'Factures en retard' : 'Overdue invoices'}
                  </p>
                  <p className="text-[11px] text-red-600/70 dark:text-red-400/70">
                    {formatCurrency((data.performance?.outstanding?.totalCents ?? 0) / 100)} {language === 'fr' ? 'a collecter' : 'to collect'}
                  </p>
                </div>
                <ArrowUpRight size={13} className="text-red-400 shrink-0" />
              </button>
            )}

            {(data.workflow?.jobs?.actionRequired ?? 0) > 0 && (
              <button
                onClick={() => navigate('/jobs')}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800/30 text-left hover:border-amber-300 transition-colors"
              >
                <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 shrink-0">
                  <Briefcase size={14} />
                </div>
                <div className="flex-1">
                  <p className="text-[12px] font-semibold text-amber-700 dark:text-amber-400">
                    {data.workflow?.jobs?.actionRequired} {language === 'fr' ? 'jobs a traiter' : 'jobs need action'}
                  </p>
                </div>
                <ArrowUpRight size={13} className="text-amber-400 shrink-0" />
              </button>
            )}

            {(data.performance?.newLeadsToday ?? 0) > 0 && (
              <button
                onClick={() => navigate('/leads')}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-neutral-200 bg-neutral-50 dark:bg-neutral-800/10 dark:border-neutral-700/30 text-left hover:border-neutral-300 transition-colors"
              >
                <div className="p-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800/30 text-text-primary shrink-0">
                  <UserPlus size={14} />
                </div>
                <div className="flex-1">
                  <p className="text-[12px] font-semibold text-text-primary dark:text-neutral-400">
                    {data.performance?.newLeadsToday} {language === 'fr' ? 'nouveaux leads' : 'new leads today'}
                  </p>
                </div>
                <ArrowUpRight size={13} className="text-neutral-400 shrink-0" />
              </button>
            )}

            {(quoteKpis?.pending_count ?? 0) > 0 && (
              <button
                onClick={() => navigate('/leads?tab=pending_quotes')}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-neutral-200 bg-neutral-50 dark:bg-neutral-800/10 dark:border-neutral-700/30 text-left hover:border-neutral-300 transition-colors"
              >
                <div className="p-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800/30 text-text-secondary shrink-0">
                  <FileText size={14} />
                </div>
                <div className="flex-1">
                  <p className="text-[12px] font-semibold text-text-primary dark:text-neutral-400">
                    {quoteKpis.pending_count} {language === 'fr' ? 'devis en attente' : 'pending quotes'}
                  </p>
                  <p className="text-[11px] text-text-secondary dark:text-neutral-400/70">
                    {formatQuoteMoney(quoteKpis.pending_value_cents)} {language === 'fr' ? 'en valeur' : 'total value'}
                  </p>
                </div>
                <ArrowUpRight size={13} className="text-neutral-400 shrink-0" />
              </button>
            )}

            {/* Quick stats */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button onClick={() => navigate('/calendar')} className="rounded-xl border border-outline-subtle p-3 text-left hover:border-outline transition-colors">
                <p className="text-xl font-bold text-text-primary">{data.performance?.upcomingJobs?.next7Days ?? 0}</p>
                <p className="text-[10px] text-text-tertiary font-medium">{language === 'fr' ? 'Jobs 7 prochains jours' : 'Jobs next 7 days'}</p>
              </button>
              <button onClick={() => navigate('/insights')} className="rounded-xl border border-outline-subtle p-3 text-left hover:border-outline transition-colors">
                <p className="text-xl font-bold text-text-primary">{formatCurrency(data.performance?.revenue?.today ?? 0)}</p>
                <p className="text-[10px] text-text-tertiary font-medium">{language === 'fr' ? 'Revenu aujourd\'hui' : 'Revenue today'}</p>
              </button>
            </div>
          </div>

          {/* Top balances */}
          {data.performance?.receivables?.topClients?.length > 0 && (
            <div className="section-card p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-2">{t.dashboard.topBalances}</p>
              <div className="space-y-1.5">
                {data.performance.receivables.topClients.slice(0, 4).map((client) => (
                  <div key={client.clientName} className="flex items-center justify-between text-[13px]">
                    <span className="text-text-secondary truncate mr-2 font-medium">{client.clientName}</span>
                    <span className="font-bold text-text-primary tabular-nums shrink-0">
                      {formatCurrency(client.balance)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Map — collapsed below */}
      <CRMMapCard
        defaultRange="today"
        heightClassName="h-[350px]"
        onOpenJob={handleOpenJob}
      />
    </div>
  );
}
