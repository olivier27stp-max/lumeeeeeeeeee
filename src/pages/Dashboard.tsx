import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Briefcase,
  Calendar,
  DollarSign,
  FileText,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CRMMapCard } from '../components/map';
import { DashboardData, getDashboardData } from '../lib/dashboardApi';
import { formatCurrency } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { StatCard, IconTile } from '../components/ui';
import { CardSkeleton } from '../components/ui/Skeleton';

function getGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatLongDate(date = new Date()) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const payload = await getDashboardData();
        if (mounted) setData(payload);
      } catch (err: any) {
        if (mounted) setError(err?.message || 'Failed to load dashboard data.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void load();

    const channel = supabase
      .channel('dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pipeline_deals' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_events' }, () => void load())
      .subscribe();

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, [refreshTick]);

  const greeting = useMemo(() => getGreeting(now), [now]);
  const longDate = useMemo(() => formatLongDate(now), [now]);

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
      <div className="section-card p-6">
        <p className="text-sm font-medium text-danger">{error || 'Could not load dashboard.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <p className="text-[13px] text-text-tertiary font-medium">{longDate}</p>
        <h1 className="text-2xl font-bold tracking-tight text-text-primary mt-0.5">
          {greeting}, {data.user.fullName}
        </h1>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Active Quotes"
          value={data.workflow.quotes.activeLeads}
          subtitle={`${formatCurrency(data.workflow.quotes.approvedAmount)} approved`}
          icon={Users}
          iconColor="pink"
          onClick={() => navigate('/pipeline')}
        />
        <StatCard
          label="Active Jobs"
          value={data.workflow.jobs.active}
          subtitle={`${data.workflow.jobs.actionRequired} need action`}
          icon={Briefcase}
          iconColor="amber"
          onClick={() => navigate('/jobs')}
        />
        <StatCard
          label="Revenue"
          value={formatCurrency(data.performance.revenue.currentMonth)}
          subtitle="This month"
          icon={DollarSign}
          iconColor="green"
          onClick={() => navigate('/insights')}
        />
        <StatCard
          label="Receivables"
          value={formatCurrency(data.performance.receivables.totalDue)}
          subtitle={`${data.performance.receivables.clientsOwing} clients`}
          icon={FileText}
          iconColor="cyan"
          onClick={() => navigate('/invoices')}
        />
      </div>

      {/* Map + Performance */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
        <CRMMapCard
          defaultRange="this_week"
          heightClassName="h-[420px]"
          onOpenJob={handleOpenJob}
        />

        <div className="section-card p-4 space-y-3">
          <h2 className="text-sm font-bold text-text-primary">Quick Overview</h2>

          <button
            type="button"
            onClick={() => navigate('/calendar')}
            className="w-full rounded-xl border-[1.5px] border-outline-subtle bg-surface p-3.5 text-left transition-all hover:border-outline group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <IconTile icon={Calendar} color="cyan" size="sm" />
                <span className="text-[13px] font-semibold text-text-primary">Upcoming Jobs</span>
              </div>
              <ArrowUpRight size={14} className="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-2xl font-bold text-text-primary mt-2">{data.performance.upcomingJobs.next7Days}</p>
            <p className="text-xs text-text-tertiary font-medium">Next 7 days</p>
          </button>

          <button
            type="button"
            onClick={() => navigate('/insights')}
            className="w-full rounded-xl border-[1.5px] border-outline-subtle bg-surface p-3.5 text-left transition-all hover:border-outline group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <IconTile icon={TrendingUp} color="green" size="sm" />
                <span className="text-[13px] font-semibold text-text-primary">Payouts</span>
              </div>
              <ArrowUpRight size={14} className="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-2xl font-bold text-text-primary mt-2">{data.performance.upcomingPayouts.total}</p>
            <p className="text-xs text-text-tertiary font-medium">{data.performance.upcomingPayouts.processing} processing</p>
          </button>

          {data.performance.receivables.topClients.length > 0 && (
            <div className="rounded-xl border-[1.5px] border-outline-subtle bg-surface p-3.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-2">Top Balances</p>
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
    </div>
  );
}
