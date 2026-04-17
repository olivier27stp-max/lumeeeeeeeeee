import React, { useState } from 'react';
import {
  Shield, Building2, Users, DollarSign, TrendingUp, Search,
  ChevronLeft, ChevronRight, AlertTriangle, Crown, X, Activity,
  CreditCard, AlertCircle, Clock, CheckCircle, XCircle,
  BarChart3, UserCheck, UserX, Zap,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Line, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { cn } from '../lib/utils';
import {
  fetchBusinessMetrics, fetchRevenueSeries, fetchGrowthSeries,
  fetchOperations, fetchUsersData, fetchBillingData, fetchOrgDetail,
  type BusinessMetrics, type OperationsData, type UsersData, type BillingRow, type OrgDetail,
} from '../lib/platformAdminApi';

// ─── Design tokens ──────────────────────────────────────────────

const panel = 'rounded-2xl bg-surface-card border border-border shadow-card';
const PLAN_COLORS: Record<string, string> = { starter: '#71717a', pro: '#3b82f6', enterprise: '#8b5cf6', unknown: '#a1a1aa' };
const ENGAGEMENT_COLORS: Record<string, string> = { high: '#10b981', medium: '#3b82f6', low: '#f59e0b', inactive: '#ef4444' };

type Tab = 'business' | 'operations' | 'users' | 'billing';

// ─── Helpers ────────────────────────────────────────────────────

function fmtMoney(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format((cents || 0) / 100);
}
function fmtCompact(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);
}
function fmtNum(n: number) { return new Intl.NumberFormat('en-US').format(n); }
function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtShortDate(iso: string) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function timeAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
function daysUntil(iso: string | null) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

// ─── Main ───────────────────────────────────────────────────────

export default function PlatformAdmin() {
  const [tab, setTab] = useState<Tab>('business');
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'business', label: 'Business', icon: BarChart3 },
    { id: 'operations', label: 'Operations', icon: Activity },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'billing', label: 'Billing', icon: CreditCard },
  ];

  // Operations for health badge
  const { data: ops } = useQuery({ queryKey: ['pa-ops'], queryFn: fetchOperations, staleTime: 60_000 });

  return (
    <div className="space-y-5">
      {selectedOrgId && <OrgModal orgId={selectedOrgId} onClose={() => setSelectedOrgId(null)} />}

      {/* Header + Health + Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
            <Shield size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-text-primary">Platform Admin</h1>
            <p className="text-[11px] text-text-muted">Founder control center</p>
          </div>
        </div>
        {ops && <HealthBadge status={ops.healthStatus} />}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-secondary/60 border border-border w-fit">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium transition-all',
              tab === t.id
                ? 'bg-surface-card text-text-primary shadow-sm border border-border'
                : 'text-text-muted hover:text-text-secondary'
            )}
          >
            <t.icon size={14} strokeWidth={tab === t.id ? 2.2 : 1.8} />
            {t.label}
            {t.id === 'operations' && ops && ops.counts.failed_payments + ops.counts.past_due > 0 && (
              <span className="ml-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'business' && <BusinessTab />}
      {tab === 'operations' && <OperationsTab onOpenOrg={setSelectedOrgId} />}
      {tab === 'users' && <UsersTab onOpenOrg={setSelectedOrgId} />}
      {tab === 'billing' && <BillingTab onOpenOrg={setSelectedOrgId} />}
    </div>
  );
}

// ─── Health Badge ───────────────────────────────────────────────

function HealthBadge({ status }: { status: 'healthy' | 'attention' | 'critical' }) {
  const cfg = {
    healthy:   { label: 'Healthy',   bg: 'bg-emerald-500/10', fg: 'text-emerald-500', icon: CheckCircle, dot: 'bg-emerald-500' },
    attention: { label: 'Attention', bg: 'bg-amber-500/10',   fg: 'text-amber-500',   icon: AlertCircle, dot: 'bg-amber-500' },
    critical:  { label: 'Critical',  bg: 'bg-red-500/10',     fg: 'text-red-500',     icon: XCircle,     dot: 'bg-red-500' },
  }[status];
  return (
    <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full', cfg.bg)}>
      <span className={cn('w-2 h-2 rounded-full animate-pulse', cfg.dot)} />
      <cfg.icon size={14} className={cfg.fg} />
      <span className={cn('text-[12px] font-semibold', cfg.fg)}>{cfg.label}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BUSINESS TAB
// ═══════════════════════════════════════════════════════════════

function BusinessTab() {
  const [revDays, setRevDays] = useState(30);
  const { data: biz, isLoading, isError } = useQuery({ queryKey: ['pa-biz'], queryFn: fetchBusinessMetrics, staleTime: 30_000 });
  const { data: revSeries } = useQuery({ queryKey: ['pa-rev', revDays], queryFn: () => fetchRevenueSeries(revDays), staleTime: 60_000 });
  const { data: growthSeries } = useQuery({ queryKey: ['pa-growth'], queryFn: fetchGrowthSeries, staleTime: 120_000 });

  if (isLoading) return <Skeleton />;
  if (isError || !biz) return <ErrorState msg="Failed to load business metrics. Make sure the server is running." />;
  const b = biz;

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard gradient="from-emerald-500 to-teal-600" label="MRR" value={fmtMoney(b.mrrCents)} sub={`${b.activeSubscriptions} active subs`} icon={DollarSign} />
        <KpiCard gradient="from-blue-500 to-indigo-600" label="Revenue (30d)" value={fmtCompact(b.revenue30dCents)}
          sub={b.revenueGrowthPct !== null ? `${b.revenueGrowthPct > 0 ? '+' : ''}${b.revenueGrowthPct}% vs prev` : 'No comparison'} icon={TrendingUp} />
        <KpiCard gradient="from-violet-500 to-purple-600" label="ARPU" value={fmtMoney(b.arpuCents)} sub="Per paying workspace" icon={Crown} />
        <KpiCard gradient="from-gray-700 to-gray-800" label="Workspaces" value={fmtNum(b.totalOrgs)}
          sub={`+${b.newOrgs30d} this month`} icon={Building2} />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="New Subscriptions (30d)" value={fmtNum(b.newSubscriptions30d)} />
        <MiniStat label="Cancellations (30d)" value={fmtNum(b.canceled30d)} warn={b.canceled30d > 0} />
        <MiniStat label="Active Subscriptions" value={fmtNum(b.activeSubscriptions)} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Revenue */}
        <div className={cn(panel, 'overflow-hidden')}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-light">
            <h2 className="text-[13px] font-semibold text-text-primary">Revenue</h2>
            <div className="flex gap-1">
              {[7, 30, 90].map(d => (
                <button key={d} onClick={() => setRevDays(d)}
                  className={cn('px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors',
                    revDays === d ? 'bg-primary/10 text-primary' : 'text-text-muted hover:text-text-secondary')}>
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <div className="px-5 py-4 h-[240px]">
            {revSeries?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={revSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border,#e5e7eb)" strokeOpacity={0.5} />
                  <XAxis dataKey="date" tickFormatter={fmtShortDate} tick={{ fontSize: 10, fill: 'var(--color-text-muted,#9ca3af)' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => fmtCompact(v)} tick={{ fontSize: 10, fill: 'var(--color-text-muted,#9ca3af)' }} axisLine={false} tickLine={false} width={55} />
                  <Tooltip content={({ active, payload, label }) => active && payload?.[0] ? (
                    <div className="rounded-lg border border-border bg-surface-card px-3 py-2 shadow-lg">
                      <p className="text-[11px] text-text-muted">{fmtShortDate(String(label))}</p>
                      <p className="text-[13px] font-bold text-text-primary tabular-nums">{fmtMoney(payload[0].value as number)}</p>
                    </div>
                  ) : null} />
                  <Bar dataKey="revenue_cents" fill="#3b82f6" radius={[4, 4, 0, 0]} opacity={0.7} />
                  <Line dataKey="revenue_cents" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <Empty msg="No revenue data" />}
          </div>
        </div>

        {/* Growth */}
        <div className={cn(panel, 'overflow-hidden')}>
          <div className="px-5 py-3.5 border-b border-border-light">
            <h2 className="text-[13px] font-semibold text-text-primary">Growth</h2>
          </div>
          <div className="px-5 py-4 h-[240px]">
            {growthSeries?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={growthSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border,#e5e7eb)" strokeOpacity={0.5} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-text-muted,#9ca3af)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-muted,#9ca3af)' }} axisLine={false} tickLine={false} width={25} />
                  <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                    <div className="rounded-lg border border-border bg-surface-card px-3 py-2 shadow-lg">
                      <p className="text-[11px] text-text-muted mb-1">{label}</p>
                      {payload.map((e: any) => <p key={e.dataKey} className="text-[12px] font-semibold text-text-primary">
                        <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: e.color }} />
                        {e.dataKey === 'new_orgs' ? 'Orgs' : 'Users'}: {e.value}
                      </p>)}
                    </div>
                  ) : null} />
                  <Bar dataKey="new_orgs" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="new_users" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty msg="No growth data" />}
          </div>
        </div>
      </div>

      {/* Plan breakdown */}
      {b.planBreakdown.length > 0 && (
        <div className={cn(panel, 'overflow-hidden')}>
          <div className="px-5 py-3.5 border-b border-border-light flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-text-primary">Plan Distribution</h2>
            <span className="text-[11px] font-bold text-primary tabular-nums">MRR {fmtMoney(b.mrrCents)}</span>
          </div>
          <div className="px-5 py-5 flex items-center gap-8">
            <div className="w-[140px] h-[140px] relative flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={b.planBreakdown} dataKey="active" nameKey="name" innerRadius="55%" outerRadius="85%" strokeWidth={2} stroke="var(--color-surface-card,#fff)">
                  {b.planBreakdown.map(e => <Cell key={e.slug} fill={PLAN_COLORS[e.slug] || PLAN_COLORS.unknown} />)}
                </Pie></PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[15px] font-bold text-text-primary tabular-nums">{b.activeSubscriptions}</span>
              </div>
            </div>
            <div className="flex-1 space-y-3">
              {b.planBreakdown.map(p => (
                <div key={p.slug} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PLAN_COLORS[p.slug] || PLAN_COLORS.unknown }} />
                    <div>
                      <p className="text-[13px] font-semibold text-text-primary">{p.name}</p>
                      <p className="text-[11px] text-text-muted">{p.active} active{p.trialing > 0 ? ` + ${p.trialing} trial` : ''}</p>
                    </div>
                  </div>
                  <span className="text-[12px] font-bold text-text-secondary tabular-nums">{fmtMoney(p.mrr_cents)}/mo</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OPERATIONS TAB
// ═══════════════════════════════════════════════════════════════

function OperationsTab({ onOpenOrg }: { onOpenOrg: (id: string) => void }) {
  const { data: ops, isLoading, isError } = useQuery({ queryKey: ['pa-ops'], queryFn: fetchOperations, staleTime: 30_000 });

  if (isLoading) return <Skeleton />;
  if (isError || !ops) return <ErrorState msg="Failed to load operations data." />;
  const o = ops;
  const totalAlerts = o.counts.failed_payments + o.counts.past_due + o.counts.trials_ending + o.counts.inactive_orgs;

  return (
    <div className="space-y-5">
      {/* Alert summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <AlertCard label="Failed Payments" count={o.counts.failed_payments} icon={XCircle} severity={o.counts.failed_payments > 0 ? 'red' : 'green'} />
        <AlertCard label="Past Due" count={o.counts.past_due} icon={AlertTriangle} severity={o.counts.past_due > 0 ? 'red' : 'green'} />
        <AlertCard label="Trials Ending" count={o.counts.trials_ending} icon={Clock} severity={o.counts.trials_ending > 0 ? 'amber' : 'green'} />
        <AlertCard label="Inactive (30d+)" count={o.counts.inactive_orgs} icon={UserX} severity={o.counts.inactive_orgs > 0 ? 'amber' : 'green'} />
        <AlertCard label="Webhook Errors" count={o.counts.webhook_errors} icon={Zap} severity={o.counts.webhook_errors > 0 ? 'amber' : 'green'} />
      </div>

      {totalAlerts === 0 ? (
        <div className={cn(panel, 'py-16 text-center')}>
          <CheckCircle size={32} className="text-emerald-500 mx-auto mb-3" />
          <p className="text-[15px] font-semibold text-text-primary">All systems healthy</p>
          <p className="text-[12px] text-text-muted mt-1">No issues requiring attention</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Failed payments */}
          {o.failedPayments.length > 0 && (
            <AlertSection title="Failed Payments" severity="red">
              {o.failedPayments.map(p => (
                <AlertRow key={p.id} onClick={() => onOpenOrg(p.org_id)}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary truncate">{p.org_name}</p>
                    <p className="text-[11px] text-text-muted">{p.failure_reason || 'Payment failed'} &middot; {fmtMoney(p.amount_cents)}</p>
                  </div>
                  <span className="text-[11px] text-text-muted flex-shrink-0">{timeAgo(p.created_at)}</span>
                </AlertRow>
              ))}
            </AlertSection>
          )}

          {/* Past due */}
          {o.pastDueSubscriptions.length > 0 && (
            <AlertSection title="Past Due Subscriptions" severity="red">
              {o.pastDueSubscriptions.map(s => (
                <AlertRow key={s.id} onClick={() => onOpenOrg(s.org_id)}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary truncate">{s.org_name}</p>
                    <p className="text-[11px] text-text-muted">{(s as any).plans?.name || 'Plan'} &middot; {fmtMoney(s.amount_cents)}/mo</p>
                  </div>
                  <span className="text-[11px] text-red-400 flex-shrink-0">Expired {fmtDate(s.current_period_end)}</span>
                </AlertRow>
              ))}
            </AlertSection>
          )}

          {/* Trials ending */}
          {o.trialsEndingSoon.length > 0 && (
            <AlertSection title="Trials Ending Soon" severity="amber">
              {o.trialsEndingSoon.map(t => {
                const days = daysUntil(t.trial_end);
                return (
                  <AlertRow key={t.id} onClick={() => onOpenOrg(t.org_id)}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-text-primary truncate">{t.org_name}</p>
                      <p className="text-[11px] text-text-muted">{(t as any).plans?.name || 'Trial'}</p>
                    </div>
                    <span className={cn('text-[11px] font-semibold flex-shrink-0', days !== null && days <= 2 ? 'text-red-400' : 'text-amber-500')}>
                      {days !== null ? `${days}d left` : '—'}
                    </span>
                  </AlertRow>
                );
              })}
            </AlertSection>
          )}

          {/* Inactive orgs */}
          {o.inactiveOrgs.length > 0 && (
            <AlertSection title={`Inactive Workspaces (${o.inactiveOrgs.length})`} severity="amber">
              {o.inactiveOrgs.slice(0, 8).map(org => (
                <AlertRow key={org.id} onClick={() => onOpenOrg(org.id)}>
                  <p className="text-[13px] font-medium text-text-primary flex-1 truncate">{org.name}</p>
                  <span className="text-[11px] text-text-muted flex-shrink-0">Created {timeAgo(org.created_at)}</span>
                </AlertRow>
              ))}
            </AlertSection>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// USERS TAB
// ═══════════════════════════════════════════════════════════════

function UsersTab({ onOpenOrg }: { onOpenOrg: (id: string) => void }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['pa-users'], queryFn: fetchUsersData, staleTime: 30_000 });
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low' | 'inactive'>('all');

  if (isLoading) return <Skeleton />;
  if (isError || !data) return <ErrorState msg="Failed to load user data." />;
  const u = data;
  const filtered = filter === 'all' ? u.workspaces : u.workspaces.filter(w => w.engagement === filter);

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Total Users" value={fmtNum(u.totalUsers)} icon={Users} />
        <MiniStat label="Active Orgs (7d)" value={fmtNum(u.activeOrgs7d)} icon={UserCheck} />
        <MiniStat label="Inactive (30d+)" value={fmtNum(u.inactive30d)} warn={u.inactive30d > 0} icon={UserX} />
        <MiniStat label="Avg Users/Org" value={String(u.avgUsersPerOrg)} icon={Building2} />
      </div>

      {/* Engagement filters */}
      <div className="flex items-center gap-2">
        {[
          { id: 'all' as const, label: 'All', count: u.workspaces.length },
          { id: 'high' as const, label: 'High', count: u.workspaces.filter(w => w.engagement === 'high').length },
          { id: 'medium' as const, label: 'Medium', count: u.workspaces.filter(w => w.engagement === 'medium').length },
          { id: 'low' as const, label: 'Low', count: u.workspaces.filter(w => w.engagement === 'low').length },
          { id: 'inactive' as const, label: 'Inactive', count: u.workspaces.filter(w => w.engagement === 'inactive').length },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={cn('px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors',
              filter === f.id ? 'bg-primary/10 text-primary' : 'text-text-muted hover:text-text-secondary hover:bg-surface-tertiary')}>
            {f.label} <span className="text-[10px] ml-0.5 opacity-60">({f.count})</span>
          </button>
        ))}
      </div>

      {/* Workspaces table */}
      <div className={cn(panel, 'overflow-hidden')}>
        <div className="grid grid-cols-[2fr_0.8fr_0.8fr_0.8fr_1fr_0.8fr] gap-2 px-5 py-2.5 border-b border-border-light">
          {['Workspace', 'Members', 'Jobs (30d)', 'Logins (30d)', 'Last Activity', 'Status'].map(h => (
            <p key={h} className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{h}</p>
          ))}
        </div>
        {filtered.length === 0 ? (
          <Empty msg="No workspaces match this filter" />
        ) : filtered.map(w => (
          <button key={w.id} onClick={() => onOpenOrg(w.id)}
            className="w-full grid grid-cols-[2fr_0.8fr_0.8fr_0.8fr_1fr_0.8fr] gap-2 px-5 py-3 border-b border-border-light hover:bg-surface-tertiary/50 transition-colors text-left group">
            <p className="text-[13px] font-semibold text-text-primary truncate group-hover:text-primary transition-colors">{w.name}</p>
            <p className="text-[13px] text-text-secondary tabular-nums self-center">{w.member_count}</p>
            <p className="text-[13px] text-text-secondary tabular-nums self-center">{w.jobs_30d}</p>
            <p className="text-[13px] text-text-secondary tabular-nums self-center">{w.logins_30d}</p>
            <p className="text-[11px] text-text-muted self-center">{timeAgo(w.last_activity)}</p>
            <div className="self-center">
              <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                w.engagement === 'high' && 'bg-emerald-500/10 text-emerald-500',
                w.engagement === 'medium' && 'bg-blue-500/10 text-blue-500',
                w.engagement === 'low' && 'bg-amber-500/10 text-amber-500',
                w.engagement === 'inactive' && 'bg-red-500/10 text-red-500',
              )}>{w.engagement}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BILLING TAB
// ═══════════════════════════════════════════════════════════════

function BillingTab({ onOpenOrg }: { onOpenOrg: (id: string) => void }) {
  const [statusFilter, setStatusFilter] = useState('');
  const [intervalFilter, setIntervalFilter] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['pa-billing', statusFilter, intervalFilter, search],
    queryFn: () => fetchBillingData({ status: statusFilter, interval: intervalFilter, search }),
    staleTime: 30_000,
  });

  const subs = data?.subscriptions || [];

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search workspace..."
            className="h-8 pl-8 pr-3 rounded-lg bg-surface-tertiary border border-border text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary w-48" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-8 px-3 rounded-lg bg-surface-tertiary border border-border text-[12px] text-text-primary focus:outline-none focus:ring-1 focus:ring-primary">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="past_due">Past Due</option>
          <option value="canceled">Canceled</option>
        </select>
        <select value={intervalFilter} onChange={e => setIntervalFilter(e.target.value)}
          className="h-8 px-3 rounded-lg bg-surface-tertiary border border-border text-[12px] text-text-primary focus:outline-none focus:ring-1 focus:ring-primary">
          <option value="">All intervals</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
        {data && <span className="text-[11px] text-text-muted ml-auto">{data.total} subscription{data.total !== 1 ? 's' : ''}</span>}
      </div>

      {/* Table */}
      <div className={cn(panel, 'overflow-hidden')}>
        <div className="grid grid-cols-[2fr_1fr_0.8fr_0.8fr_1fr_1fr_1fr_0.8fr] gap-2 px-5 py-2.5 border-b border-border-light">
          {['Workspace', 'Plan', 'Interval', 'Amount', 'Status', 'Renewal', 'Last Payment', 'Actions'].map(h => (
            <p key={h} className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{h}</p>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-0">{[0,1,2,3].map(i => <div key={i} className="h-12 border-b border-border-light"><div className="h-4 skeleton rounded mx-5 my-4" /></div>)}</div>
        ) : subs.length === 0 ? (
          <Empty msg="No subscriptions found" />
        ) : subs.map(s => (
          <div key={s.id} className="grid grid-cols-[2fr_1fr_0.8fr_0.8fr_1fr_1fr_1fr_0.8fr] gap-2 px-5 py-3 border-b border-border-light hover:bg-surface-tertiary/30 transition-colors">
            <p className="text-[13px] font-semibold text-text-primary truncate self-center">{s.org_name}</p>
            <div className="self-center">
              <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                s.plan_slug === 'enterprise' && 'bg-violet-500/10 text-violet-500',
                s.plan_slug === 'pro' && 'bg-blue-500/10 text-blue-500',
                (!['enterprise', 'pro'].includes(s.plan_slug)) && 'bg-gray-500/10 text-gray-500',
              )}>{s.plan_name}</span>
            </div>
            <p className="text-[12px] text-text-secondary self-center capitalize">{s.interval}</p>
            <p className="text-[13px] font-semibold text-text-primary tabular-nums self-center">{fmtMoney(s.amount_cents)}</p>
            <div className="self-center">
              <SubStatusBadge status={s.status} />
            </div>
            <p className="text-[11px] text-text-muted self-center">{fmtDate(s.current_period_end)}</p>
            <div className="self-center">
              {s.last_payment_status ? (
                <span className={cn('text-[11px] font-medium', s.last_payment_status === 'succeeded' ? 'text-emerald-500' : s.last_payment_status === 'failed' ? 'text-red-500' : 'text-text-muted')}>
                  {s.last_payment_status === 'succeeded' ? 'Paid' : s.last_payment_status === 'failed' ? 'Failed' : s.last_payment_status}
                </span>
              ) : <span className="text-[11px] text-text-muted">—</span>}
            </div>
            <button onClick={() => onOpenOrg(s.org_id)} className="text-[11px] text-primary hover:underline self-center">View</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SubStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; fg: string; label: string }> = {
    active: { bg: 'bg-emerald-500/10', fg: 'text-emerald-500', label: 'Active' },
    trialing: { bg: 'bg-blue-500/10', fg: 'text-blue-500', label: 'Trial' },
    past_due: { bg: 'bg-red-500/10', fg: 'text-red-500', label: 'Past Due' },
    canceled: { bg: 'bg-gray-500/10', fg: 'text-gray-500', label: 'Canceled' },
    incomplete: { bg: 'bg-amber-500/10', fg: 'text-amber-500', label: 'Incomplete' },
  };
  const c = cfg[status] || cfg.incomplete;
  return <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider', c.bg, c.fg)}>{c.label}</span>;
}

// ═══════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════

function KpiCard({ gradient, label, value, sub, icon: Icon }: { gradient: string; label: string; value: string; sub?: string; icon: any }) {
  return (
    <div className={cn('relative overflow-hidden rounded-2xl p-5 text-left bg-gradient-to-br', gradient)}>
      <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-surface-card/[0.08]" />
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold text-white/70 uppercase tracking-wider">{label}</p>
          <div className="w-8 h-8 rounded-lg bg-surface-card/15 flex items-center justify-center"><Icon size={16} className="text-white/90" /></div>
        </div>
        <p className="text-[26px] font-bold text-white tabular-nums tracking-tight leading-none">{value}</p>
        {sub && <p className="text-[11px] text-white/60 mt-1.5 font-medium">{sub}</p>}
      </div>
    </div>
  );
}

function MiniStat({ label, value, warn, icon: Icon }: { label: string; value: string; warn?: boolean; icon?: any }) {
  return (
    <div className={cn(panel, 'text-left px-4 py-3.5')}>
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon size={12} className="text-text-muted" />}
        <p className="text-[11px] text-text-muted font-medium">{label}</p>
      </div>
      <p className={cn('text-[18px] font-bold tabular-nums tracking-tight leading-none', warn ? 'text-red-400' : 'text-text-primary')}>{value}</p>
    </div>
  );
}

function AlertCard({ label, count, icon: Icon, severity }: { label: string; count: number; icon: any; severity: 'red' | 'amber' | 'green' }) {
  const colors = { red: 'text-red-500 bg-red-500/10', amber: 'text-amber-500 bg-amber-500/10', green: 'text-emerald-500 bg-emerald-500/10' };
  return (
    <div className={cn(panel, 'px-4 py-3.5 flex items-center gap-3')}>
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', colors[severity].split(' ')[1])}>
        <Icon size={15} className={colors[severity].split(' ')[0]} />
      </div>
      <div>
        <p className={cn('text-[18px] font-bold tabular-nums leading-none', count > 0 && severity !== 'green' ? colors[severity].split(' ')[0] : 'text-text-primary')}>{count}</p>
        <p className="text-[10px] text-text-muted mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function AlertSection({ title, severity, children }: { title: string; severity: 'red' | 'amber'; children: React.ReactNode }) {
  const border = severity === 'red' ? 'border-l-red-500' : 'border-l-amber-500';
  return (
    <div className={cn(panel, 'overflow-hidden border-l-[3px]', border)}>
      <div className="px-5 py-3 border-b border-border-light">
        <h3 className="text-[13px] font-semibold text-text-primary">{title}</h3>
      </div>
      <div className="divide-y divide-border-light">{children}</div>
    </div>
  );
}

function AlertRow({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-5 py-3 hover:bg-surface-tertiary/50 transition-colors text-left">
      {children}
    </button>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="py-14 text-center"><p className="text-[13px] text-text-muted">{msg}</p></div>;
}

function ErrorState({ msg }: { msg: string }) {
  return (
    <div className={cn(panel, 'py-16 text-center')}>
      <AlertCircle size={28} className="text-red-400 mx-auto mb-3" />
      <p className="text-[14px] font-semibold text-text-primary">Something went wrong</p>
      <p className="text-[12px] text-text-muted mt-1 max-w-sm mx-auto">{msg}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-4">{[0,1,2,3].map(i => <div key={i} className="h-[120px] rounded-2xl skeleton" />)}</div>
      <div className="h-72 skeleton rounded-2xl" />
    </div>
  );
}

// ─── Org Detail Modal ───────────────────────────────────────────

function OrgModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['pa-org', orgId], queryFn: () => fetchOrgDetail(orgId), staleTime: 30_000 });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface-card border border-border rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light sticky top-0 bg-surface-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Building2 size={16} className="text-white" />
            </div>
            <h2 className="text-[16px] font-bold text-text-primary">{data?.org?.name || 'Loading...'}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-tertiary transition-colors"><X size={16} className="text-text-muted" /></button>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-4">{[0,1,2].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>
        ) : data ? (
          <div className="p-6 space-y-5">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3">
              {[
                ['Jobs', fmtNum(data.stats.total_jobs)],
                ['Clients', fmtNum(data.stats.total_clients)],
                ['Revenue (30d)', fmtMoney(data.stats.revenue_30d_cents)],
                ['All-Time', fmtMoney(data.stats.revenue_all_time_cents)],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-xl bg-surface-tertiary p-3 text-center">
                  <p className="text-[10px] text-text-muted uppercase font-semibold tracking-wider">{l}</p>
                  <p className="text-[18px] font-bold text-text-primary tabular-nums">{v}</p>
                </div>
              ))}
            </div>

            {/* Subscription */}
            {data.subscription && (
              <div className="rounded-xl border border-border p-4">
                <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">Subscription</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Crown size={14} className="text-amber-400" />
                    <span className="text-[13px] font-bold text-text-primary">{data.subscription.plan_name}</span>
                    <SubStatusBadge status={data.subscription.status} />
                  </div>
                  <span className="text-[13px] font-bold text-text-primary tabular-nums">
                    {fmtMoney(data.subscription.amount_cents)}/{data.subscription.interval === 'yearly' ? 'yr' : 'mo'}
                  </span>
                </div>
                {data.subscription.current_period_end && (
                  <p className="text-[11px] text-text-muted mt-1">Renews: {fmtDate(data.subscription.current_period_end)}</p>
                )}
              </div>
            )}

            {/* Details */}
            <div className="rounded-xl border border-border p-4">
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">Details</p>
              <div className="grid grid-cols-2 gap-2">
                <div><p className="text-[10px] text-text-muted">Created</p><p className="text-[12px] font-medium text-text-primary">{fmtDate(data.org.created_at)}</p></div>
                <div><p className="text-[10px] text-text-muted">Members</p><p className="text-[12px] font-medium text-text-primary">{data.members.length}</p></div>
              </div>
            </div>

            {/* Members */}
            <div>
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">Members ({data.members.length})</p>
              <div className="space-y-1.5">
                {data.members.map(m => (
                  <div key={m.user_id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-surface-tertiary">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
                      {m.full_name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold text-text-primary truncate">{m.full_name}</p>
                    </div>
                    <span className={cn('text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full',
                      m.role === 'owner' && 'bg-amber-500/10 text-amber-500',
                      m.role === 'admin' && 'bg-violet-500/10 text-violet-500',
                      !['owner', 'admin'].includes(m.role) && 'bg-gray-500/10 text-gray-500',
                    )}>{m.role}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
