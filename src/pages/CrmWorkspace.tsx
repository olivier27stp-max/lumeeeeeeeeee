/**
 * CRM Workspace — exact reproduction of the shadcn CRM reference dashboard.
 * Layout, spacing, card proportions, colors, and section hierarchy must match.
 */
import React, { useMemo, useState } from 'react';
import {
  Search, Download, ChevronLeft, ChevronRight, ChevronDown,
  MoreHorizontal, Filter, Plus, Calendar, Users, Briefcase,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import { DashboardData, getDashboardData } from '../lib/dashboardApi';
import { useOfflineCache } from '../hooks/useOfflineCache';
import { useQuery } from '@tanstack/react-query';
import { fetchQuoteKpis, listAllQuotes, type Quote } from '../lib/quotesApi';
import { listClients } from '../lib/clientsApi';
import { getJobsKpis, type JobsKpis } from '../lib/jobsApi';

function getQuoteName(q: any): string {
  const c = q.clients;
  const l = q.leads;
  if (c && !c.deleted_at) return `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company || '—';
  if (l && !l.deleted_at) return `${l.first_name || ''} ${l.last_name || ''}`.trim() || l.company || '—';
  return q.title || '—';
}

export default function CrmWorkspace() {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [search, setSearch] = useState('');
  const [leadPage, setLeadPage] = useState(1);

  // Data
  const { data: dash, loading } = useOfflineCache<DashboardData>('dashboard', getDashboardData, []);
  const { data: quoteKpis } = useQuery({ queryKey: ['crm-kpi-q'], queryFn: fetchQuoteKpis, staleTime: 30_000 });
  const { data: clientsRes } = useQuery({ queryKey: ['crm-clients-count'], queryFn: () => listClients({ page: 1, pageSize: 1 }), staleTime: 60_000 });
  const { data: jobKpis } = useQuery({ queryKey: ['crm-jobs-kpi'], queryFn: () => getJobsKpis({}), staleTime: 30_000 });
  const { data: leadsRes, isLoading: leadsLoading } = useQuery({
    queryKey: ['crm-leads', leadPage, search],
    queryFn: () => listAllQuotes({ page: leadPage, pageSize: 10, search: search || undefined }),
    staleTime: 15_000,
  });

  const clientCount = clientsRes?.total ?? 0;
  const jobCount = dash?.workflow?.jobs?.active ?? 0;
  const quoteCount = quoteKpis?.total_count ?? 0;
  const totalRevenue = dash?.performance?.revenue?.today ?? 0;
  const leads = leadsRes?.data ?? [];
  const leadsTotal = leadsRes?.total ?? 0;
  const leadsPages = Math.ceil(leadsTotal / 10);
  const appts = dash?.appointments?.items || [];

  // Pipeline: black=clients, dark gray=jobs, light gray=quotes (as specified)
  const pipelineTotal = Math.max(clientCount + jobCount + quoteCount, 1);
  const pipelineSegments = [
    { label: fr ? 'Clients' : 'Clients', count: clientCount, pct: Math.round((clientCount / pipelineTotal) * 100), color: 'var(--color-primary)' },
    { label: 'Jobs', count: jobCount, pct: Math.round((jobCount / pipelineTotal) * 100), color: '#6b7280' },
    { label: fr ? 'Devis' : 'Quotes', count: quoteCount, pct: Math.round((quoteCount / pipelineTotal) * 100), color: '#d1d5db' },
  ];

  // Target progress (percentage of clients who have at least one quote)
  const targetPct = quoteCount > 0 && clientCount > 0 ? Math.min(Math.round((quoteCount / clientCount) * 100), 100) : 0;

  if (loading) {
    return (
      <div className="bg-surface min-h-screen -m-6 lg:-m-10 -mt-8 p-6 lg:p-8 space-y-5">
        <div className="h-7 w-44 bg-gray-200 rounded animate-pulse" />
        <div className="grid grid-cols-4 gap-4">{[0,1,2,3].map(i => <div key={i} className="h-[120px] bg-surface-card border border-border rounded-xl animate-pulse" />)}</div>
        <div className="grid grid-cols-3 gap-4">{[0,1,2].map(i => <div key={i} className="h-[260px] bg-surface-card border border-border rounded-xl animate-pulse" />)}</div>
      </div>
    );
  }

  return (
    <div className="bg-surface min-h-screen -m-6 lg:-m-10 -mt-8 p-6 lg:p-8">

      {/* ══════════════════════════════════════════
          TOP BAR — matches reference exactly:
          left: "CRM Dashboard"
          right: date range + Download button
          ══════════════════════════════════════════ */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-[18px] font-bold text-text-primary">CRM Dashboard</h1>
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-2 h-9 px-3 bg-surface-card border border-border rounded-lg text-[13px] text-text-primary font-medium hover:bg-surface-secondary transition-colors">
            <Calendar size={14} className="text-text-secondary" />
            {new Date().toLocaleDateString(fr ? 'fr-CA' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
            <ChevronDown size={14} className="text-text-muted" />
          </button>
          <button
            onClick={() => {
              const csvRows = leads.map(q => [q.quote_number, getQuoteName(q), q.status, q.total_cents / 100, q.created_at?.slice(0, 10)].join(','));
              const csv = ['Quote #,Client,Status,Amount,Date', ...csvRows].join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = 'crm-dashboard.csv'; a.click();
              URL.revokeObjectURL(url);
            }}
            className="inline-flex items-center gap-2 h-9 px-4 bg-primary text-white rounded-lg text-[13px] font-medium hover:bg-primary-hover active:scale-[0.97] transition-all">
            <Download size={14} />
            Download
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          ROW 1 — 4 stat cards matching reference:
          [progress/target] [Total Customers] [Total Deals] [Total Revenue]
          ══════════════════════════════════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">

        {/* Card 1: Progress/target (matches reference left card with circular visual) */}
        <div className="bg-surface-card border border-border rounded-xl p-5 flex items-center gap-4">
          {/* Circular progress ring — matches the reference x48 circle */}
          <div className="relative w-14 h-14 shrink-0">
            <svg viewBox="0 0 56 56" className="w-14 h-14 -rotate-90">
              <circle cx="28" cy="28" r="24" fill="none" stroke="#f3f4f6" strokeWidth="4" />
              <circle cx="28" cy="28" r="24" fill="none" stroke="var(--color-primary)" strokeWidth="4"
                strokeDasharray={`${(targetPct / 100) * 150.8} 150.8`}
                strokeLinecap="round" className="transition-all duration-500" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold text-text-primary">{targetPct}%</span>
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-text-primary leading-tight">{fr ? 'Objectif en cours' : 'Your target is incomplete'}</p>
            <p className="text-[12px] text-text-secondary mt-1 leading-snug">
              {fr
                ? `${targetPct}% de votre objectif atteint.`
                : `You have completed ${targetPct}% of the given target, you can also check your status.`}
            </p>
          </div>
        </div>

        {/* Card 2: Total Customers — icon top-right like reference */}
        <div className="bg-surface-card border border-border rounded-xl p-5 cursor-pointer hover:shadow-sm transition-shadow" onClick={() => navigate('/clients')}>
          <div className="flex items-start justify-between">
            <p className="text-[13px] text-text-secondary">{fr ? 'Total clients' : 'Total Customers'}</p>
            <div className="w-9 h-9 rounded-lg bg-surface-tertiary flex items-center justify-center">
              <Users size={16} className="text-text-secondary" />
            </div>
          </div>
          <p className="text-[28px] font-bold text-text-primary tabular-nums tracking-tight mt-1 leading-none">{clientCount.toLocaleString()}</p>
        </div>

        {/* Card 3: Total Deals/Jobs */}
        <div className="bg-surface-card border border-border rounded-xl p-5 cursor-pointer hover:shadow-sm transition-shadow" onClick={() => navigate('/jobs')}>
          <div className="flex items-start justify-between">
            <p className="text-[13px] text-text-secondary">{fr ? 'Total jobs' : 'Total Deals'}</p>
            <div className="w-9 h-9 rounded-lg bg-surface-tertiary flex items-center justify-center">
              <Briefcase size={16} className="text-text-secondary" />
            </div>
          </div>
          <p className="text-[28px] font-bold text-text-primary tabular-nums tracking-tight mt-1 leading-none">{(jobCount + quoteCount).toLocaleString()}</p>
          {dash?.performance?.conversionRate != null && dash.performance.conversionRate !== 0 && (
            <p className={cn('text-[12px] font-medium mt-2', dash.performance.conversionRate > 0 ? 'text-red-500' : 'text-text-muted')}>
              -{Math.abs(100 - dash.performance.conversionRate).toFixed(1)}% <span className="text-text-muted">from last month</span>
            </p>
          )}
        </div>

        {/* Card 4: Total Revenue */}
        <div className="bg-surface-card border border-border rounded-xl p-5 cursor-pointer hover:shadow-sm transition-shadow" onClick={() => navigate('/insights')}>
          <div className="flex items-start justify-between">
            <p className="text-[13px] text-text-secondary">{fr ? 'Revenu total' : 'Total Revenue'}</p>
            <div className="w-9 h-9 rounded-lg bg-surface-tertiary flex items-center justify-center">
              <span className="text-[14px] font-bold text-text-secondary">$</span>
            </div>
          </div>
          <p className="text-[28px] font-bold text-text-primary tabular-nums tracking-tight mt-1 leading-none">{formatCurrency(totalRevenue)}</p>
          {dash?.performance?.conversionRate != null && dash.performance.conversionRate > 0 && (
            <p className="text-[12px] font-medium mt-2 text-emerald-600">
              +{dash.performance.conversionRate}% <span className="text-text-muted">from last month</span>
            </p>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════
          ROW 2 — 3 panels matching reference exactly:
          [Leads by Source / donut] [Tasks] [Sales Pipeline]
          ══════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">

        {/* Panel 1: Leads by Source — donut chart (like reference) */}
        <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-[15px] font-semibold text-text-primary">{fr ? 'Sources de leads' : 'Leads by Source'}</h3>
            <button className="inline-flex items-center gap-1.5 h-7 px-2.5 bg-surface-card border border-border rounded-md text-[11px] text-text-secondary font-medium hover:bg-surface-secondary transition-colors">
              <Download size={12} /> Export
            </button>
          </div>
          <div className="p-5 flex flex-col items-center">
            {/* Donut */}
            <div className="relative w-[160px] h-[160px] mb-5">
              <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
                <circle cx="80" cy="80" r="60" fill="none" stroke="#f3f4f6" strokeWidth="24" />
                {/* Clients segment */}
                <circle cx="80" cy="80" r="60" fill="none" stroke="var(--color-primary)" strokeWidth="24"
                  strokeDasharray={`${(clientCount / pipelineTotal) * 377} 377`} strokeDashoffset="0" />
                {/* Jobs segment */}
                <circle cx="80" cy="80" r="60" fill="none" stroke="#6b7280" strokeWidth="24"
                  strokeDasharray={`${(jobCount / pipelineTotal) * 377} 377`}
                  strokeDashoffset={`${-((clientCount / pipelineTotal) * 377)}`} />
                {/* Quotes segment */}
                <circle cx="80" cy="80" r="60" fill="none" stroke="#d1d5db" strokeWidth="24"
                  strokeDasharray={`${(quoteCount / pipelineTotal) * 377} 377`}
                  strokeDashoffset={`${-(((clientCount + jobCount) / pipelineTotal) * 377)}`} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[24px] font-bold text-text-primary tabular-nums">{pipelineTotal}</span>
                <span className="text-[11px] text-text-muted">{fr ? 'Total' : 'Total'}</span>
              </div>
            </div>
            {/* Legend — matches reference horizontal layout */}
            <div className="flex items-center justify-center gap-6 w-full">
              {pipelineSegments.map((s, i) => (
                <div key={i} className="text-center">
                  <div className="flex items-center gap-1.5 justify-center mb-0.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-[11px] text-text-secondary uppercase tracking-wide">{s.label}</span>
                  </div>
                  <p className="text-[15px] font-bold text-text-primary tabular-nums">{s.count}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Panel 2: Tasks — exact reference structure */}
        <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h3 className="text-[15px] font-semibold text-text-primary">{fr ? 'Tâches' : 'Tasks'}</h3>
              <p className="text-[12px] text-text-muted mt-0.5">{fr ? 'Gérez vos tâches à venir.' : 'Track and manage your upcoming tasks.'}</p>
            </div>
            <button onClick={() => navigate('/calendar')} className="inline-flex items-center gap-1.5 h-8 px-3 bg-surface-card border border-border rounded-lg text-[12px] text-text-primary font-medium hover:bg-surface-secondary transition-colors">
              <Plus size={13} /> {fr ? 'Ajouter' : 'Add Task'}
            </button>
          </div>
          {/* Table grid — aligned columns */}
          <div className="grid" style={{ gridTemplateColumns: '1fr 120px 100px 80px' }}>
            {/* Header */}
            <div className="px-5 py-2.5 border-b border-border text-[11px] font-medium text-text-muted uppercase tracking-wide">{fr ? 'Tâche' : 'Task'}</div>
            <div className="px-4 py-2.5 border-b border-border text-[11px] font-medium text-text-muted uppercase tracking-wide">Client</div>
            <div className="px-4 py-2.5 border-b border-border text-[11px] font-medium text-text-muted uppercase tracking-wide">{fr ? 'Statut' : 'Status'}</div>
            <div className="px-4 py-2.5 border-b border-border text-[11px] font-medium text-text-muted uppercase tracking-wide text-right">{fr ? 'Heure' : 'Time'}</div>

            {appts.length === 0 && (
              <div className="col-span-4 py-10 text-center text-[13px] text-text-muted">{fr ? 'Aucune tâche aujourd\'hui' : 'No tasks today'}</div>
            )}

            {appts.slice(0, 5).map((apt) => {
              const rowCls = 'border-b border-border-light cursor-pointer hover:bg-surface-secondary transition-colors';
              return (
                <React.Fragment key={apt.id}>
                  <div className={`px-5 py-3 flex items-center min-w-0 ${rowCls}`} onClick={() => navigate(`/jobs/${apt.jobId}`)}>
                    <span className="text-[13px] font-medium text-text-primary truncate">{apt.title}</span>
                  </div>
                  <div className={`px-4 py-3 flex items-center min-w-0 ${rowCls}`} onClick={() => navigate(`/jobs/${apt.jobId}`)}>
                    <span className="text-[13px] text-text-secondary truncate">{apt.clientName || '—'}</span>
                  </div>
                  <div className={`px-4 py-3 flex items-center ${rowCls}`} onClick={() => navigate(`/jobs/${apt.jobId}`)}>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      apt.status === 'completed' ? 'bg-neutral-100 text-neutral-600' : 'bg-neutral-100 text-neutral-500'
                    )}>
                      {apt.status === 'completed' ? (fr ? 'Terminé' : 'Done') : (fr ? 'À faire' : 'Pending')}
                    </span>
                  </div>
                  <div className={`px-4 py-3 flex items-center justify-end ${rowCls}`} onClick={() => navigate(`/jobs/${apt.jobId}`)}>
                    <span className="text-[12px] text-text-secondary tabular-nums">
                      {new Date(apt.startAt).toLocaleTimeString(fr ? 'fr-CA' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Panel 3: Sales Pipeline — exact reference: bar + legend rows */}
        <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-[15px] font-semibold text-text-primary">{fr ? 'Pipeline' : 'Sales Pipeline'}</h3>
            <p className="text-[12px] text-text-muted mt-0.5">{fr ? 'Deals en cours dans votre pipeline.' : 'Current deals in your sales pipeline.'}</p>
          </div>
          <div className="px-5 py-4">
            {/* Segmented bar — exact reference */}
            <div className="flex h-2.5 rounded-full overflow-hidden mb-5">
              {pipelineSegments.map((s, i) => (
                <div key={i} style={{ width: `${Math.max(s.pct, 3)}%`, backgroundColor: s.color }}
                  className={cn(i === 0 && 'rounded-l-full', i === pipelineSegments.length - 1 && 'rounded-r-full')} />
              ))}
            </div>
            {/* Legend rows — exact reference with dot + label + count + bar + pct */}
            <div className="space-y-4">
              {pipelineSegments.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-[13px] text-text-primary font-medium w-20">{s.label}</span>
                  <span className="text-[12px] text-text-secondary w-24">{s.count} {s.count === 1 ? 'deal' : 'deals'}</span>
                  {/* Mini bar */}
                  <div className="flex-1 h-2 bg-surface-tertiary rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${s.pct}%`, backgroundColor: s.color }} />
                  </div>
                  <span className="text-[12px] font-medium text-text-primary tabular-nums w-10 text-right">{s.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          ROW 3 — BOTTOM TABLE: Leads / Quotes
          Connected to real Quotes data. Exact reference structure.
          ══════════════════════════════════════════ */}
      <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
        {/* Table header — matches reference */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-[15px] font-semibold text-text-primary">{fr ? 'Devis' : 'Leads'}</h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setLeadPage(1); }}
                placeholder={fr ? 'Filtrer...' : 'Filter...'}
                className="h-8 w-52 pl-9 pr-3 text-[13px] bg-surface-card border border-border rounded-lg text-text-primary placeholder:text-text-muted outline-none focus:border-primary transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Table — CSS Grid for perfect column alignment */}
        <div className="grid" style={{ gridTemplateColumns: '40px 140px 1fr 100px 40px' }}>
          {/* Header */}
          <div className="pl-4 py-3 border-b border-border flex items-center">
            <input type="checkbox" className="rounded border-gray-300 w-3.5 h-3.5 accent-primary" />
          </div>
          <div className="px-4 py-3 border-b border-border flex items-center text-[12px] font-medium text-text-secondary">{fr ? 'Statut' : 'Status'}</div>
          <div className="px-4 py-3 border-b border-border flex items-center text-[12px] font-medium text-text-secondary">Client</div>
          <div className="px-4 py-3 border-b border-border flex items-center justify-end text-[12px] font-medium text-text-secondary">{fr ? 'Montant' : 'Amount'}</div>
          <div className="py-3 border-b border-border" />

          {/* Loading skeleton */}
          {leadsLoading && Array.from({ length: 5 }).map((_, i) => (
            <React.Fragment key={`sk-${i}`}>
              <div className="pl-4 py-3 border-b border-border-light"><div className="h-3.5 w-3.5 bg-gray-100 animate-pulse rounded" /></div>
              <div className="px-4 py-3 border-b border-border-light"><div className="h-3.5 w-16 bg-gray-100 animate-pulse rounded-full" /></div>
              <div className="px-4 py-3 border-b border-border-light"><div className="h-3.5 w-28 bg-gray-100 animate-pulse rounded" /></div>
              <div className="px-4 py-3 border-b border-border-light"><div className="h-3.5 w-12 bg-gray-100 animate-pulse rounded ml-auto" /></div>
              <div className="py-3 border-b border-border-light" />
            </React.Fragment>
          ))}

          {/* Empty */}
          {!leadsLoading && leads.length === 0 && (
            <div className="col-span-5 py-12 text-center text-[13px] text-text-muted">{fr ? 'Aucun résultat' : 'No leads found'}</div>
          )}

          {/* Rows */}
          {!leadsLoading && leads.map((q) => {
            const st = (q.status || 'draft').toLowerCase();
            const badgeCls = st === 'approved' || st === 'converted'
              ? 'bg-neutral-100 text-neutral-700'
              : st === 'sent' || st === 'awaiting_response' || st === 'action_required'
              ? 'bg-neutral-100 text-neutral-600'
              : st === 'rejected' || st === 'expired'
              ? 'bg-neutral-200 text-neutral-500'
              : 'bg-neutral-100 text-neutral-500';
            const rowCls = 'border-b border-border-light cursor-pointer hover:bg-surface-secondary transition-colors';
            const click = () => navigate(`/quotes/${q.id}`);

            return (
              <React.Fragment key={q.id}>
                <div className={`pl-4 py-3 flex items-center ${rowCls}`} onClick={e => e.stopPropagation()}>
                  <input type="checkbox" className="rounded border-gray-300 w-3.5 h-3.5 accent-primary" />
                </div>
                <div className={`px-4 py-3 flex items-center ${rowCls}`} onClick={click}>
                  <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', badgeCls)}>
                    {st.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                </div>
                <div className={`px-4 py-3 flex items-center min-w-0 ${rowCls}`} onClick={click}>
                  <span className="text-[13px] text-text-primary font-medium truncate">{getQuoteName(q)}</span>
                </div>
                <div className={`px-4 py-3 flex items-center justify-end ${rowCls}`} onClick={click}>
                  <span className="text-[13px] text-text-primary font-semibold tabular-nums">{formatCurrency((q.total_cents || 0) / 100)}</span>
                </div>
                <div className={`py-3 flex items-center justify-center ${rowCls}`}>
                  <button className="p-1 rounded-md text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-primary hover:bg-gray-100 transition-all" onClick={e => e.stopPropagation()}>
                    <MoreHorizontal size={15} />
                  </button>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Pagination */}
        {leadsPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border">
            <span className="text-[12px] text-text-muted tabular-nums">{leadsTotal} {fr ? 'résultats' : 'results'}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] text-text-muted tabular-nums mr-2">{leadPage}/{leadsPages}</span>
              <button disabled={leadPage <= 1} onClick={() => setLeadPage(p => p - 1)}
                className="p-1.5 rounded-md text-text-secondary hover:bg-gray-100 disabled:opacity-30 transition-colors"><ChevronLeft size={15} /></button>
              <button disabled={leadPage >= leadsPages} onClick={() => setLeadPage(p => p + 1)}
                className="p-1.5 rounded-md text-text-secondary hover:bg-gray-100 disabled:opacity-30 transition-colors"><ChevronRight size={15} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
