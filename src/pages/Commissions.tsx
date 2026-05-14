import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { StatCard } from '../components/d2d/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '../components/d2d/card';
import { Button } from '../components/d2d/button';
import { Avatar } from '../components/d2d/avatar';
import { getRepAvatar } from '../lib/constants/avatars';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import {
  getCommissionEntries,
  getPayrollPreview,
  approveCommission,
  reverseCommission,
  getCommissionRules,
  createCommissionRule,
  updateCommissionRule,
} from '../lib/commissionsApi';
import { fetchTeamList, type OrgMember } from '../lib/invitationsApi';
import type { FsCommissionRule } from '../types';
import type { FsCommissionEntry, CommissionPayrollPreview } from '../types';
import {
  DollarSign,
  Percent,
  TrendingUp,
  CalendarClock,
  FileText,
  Wrench,
  CreditCard,
  Filter,
  Download,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react';

type Tab = 'commissions' | 'payout' | 'rates';

// No fallback data — empty state shown when API returns no results

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const statusStyles: Record<string, string> = {
  pending: 'bg-warning text-white',
  approved: 'bg-info text-white',
  paid: 'bg-success text-white',
  reversed: 'bg-error text-white',
};

const payoutStatusStyles: Record<string, string> = {
  future: 'bg-info text-white',
  invoiced: 'bg-warning text-white',
  serviced: 'bg-brand text-white',
  paid: 'bg-success text-white',
};

function fmtCurrency(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getCurrentMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function D2DCommissions() {
  const [activeTab, setActiveTab] = useState<Tab>('commissions');

  // API state
  const [entries, setEntries] = useState<FsCommissionEntry[] | null>(null);
  const [payroll, setPayroll] = useState<CommissionPayrollPreview | null>(null);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Resolve role on mount so the UI hides admin-only controls for reps.
  useEffect(() => {
    (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        if (!token) return;
        const res = await fetch('/api/commissions/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const body = await res.json();
          setIsAdmin(Boolean(body?.is_admin));
        }
      } catch { /* silent — default to rep view */ }
    })();
  }, []);

  // Fetch profile names for a set of user_ids
  const fetchProfiles = useCallback(async (userIds: string[]) => {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return;
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', unique);
    if (profiles) {
      const map: Record<string, string> = {};
      for (const p of profiles) {
        map[p.id] = p.full_name ?? p.id;
      }
      setProfileMap((prev) => ({ ...prev, ...map }));
    }
  }, []);

  // Main data fetch
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const { from, to } = getCurrentMonthRange();
      const [entriesData, payrollData] = await Promise.all([
        getCommissionEntries(),
        getPayrollPreview(from, to),
      ]);
      setEntries(entriesData);
      setPayroll(payrollData);

      // Resolve user names
      const allUserIds = entriesData.map((e) => e.user_id);
      await fetchProfiles(allUserIds);
    } catch (err) {
      console.error('Failed to load commission data:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [fetchProfiles]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Approve / Reverse actions ---
  const handleApprove = async (entryId: string) => {
    setActionLoading(entryId);
    try {
      const updated = await approveCommission(entryId);
      setEntries((prev) => prev?.map((e) => (e.id === entryId ? updated : e)) ?? null);
    } catch (err) {
      console.error('Approve failed:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReverse = async (entryId: string) => {
    setActionLoading(entryId);
    try {
      const updated = await reverseCommission(entryId);
      setEntries((prev) => prev?.map((e) => (e.id === entryId ? updated : e)) ?? null);
    } catch (err) {
      console.error('Reverse failed:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // --- Derive display data ---
  // Commission summary cards (computed from real data)
  const commissionCards = (() => {
    if (!entries || entries.length === 0) {
      return [
        { label: 'Total Revenue', value: '$0', subtitle: 'This period' },
        { label: 'Total Earned', value: '$0', subtitle: 'Commission earned' },
        { label: 'Commission %', value: '0%', subtitle: 'Current rate' },
      ];
    }
    const totalRevenue = entries.reduce((sum, e) => sum + e.base_amount, 0);
    const totalEarned = entries.reduce((sum, e) => sum + e.amount, 0);
    const avgPercent = totalRevenue > 0 ? Math.round((totalEarned / totalRevenue) * 100) : 0;
    return [
      { label: 'Total Revenue', value: fmtCurrency(totalRevenue), subtitle: 'This period' },
      { label: 'Total Earned', value: fmtCurrency(totalEarned), subtitle: 'Commission earned' },
      { label: 'Commission %', value: `${avgPercent}%`, subtitle: 'Current rate' },
    ];
  })();

  // Payout summary cards (computed from payroll preview)
  const payoutCards = (() => {
    if (!payroll) return [
      { label: 'Pending', value: '$0', subtitle: 'No data' },
      { label: 'Approved', value: '$0', subtitle: 'No data' },
      { label: 'Paid', value: '$0', subtitle: 'No data' },
      { label: 'Total', value: '$0', subtitle: 'No data' },
    ];
    return [
      { label: 'Pending', value: fmtCurrency(payroll.pending), subtitle: `Part of ${payroll.count} entries` },
      { label: 'Approved', value: fmtCurrency(payroll.approved), subtitle: 'Awaiting payout' },
      { label: 'Paid', value: fmtCurrency(payroll.paid), subtitle: 'This month' },
      { label: 'Total', value: fmtCurrency(payroll.total), subtitle: `${payroll.count} entries total` },
    ];
  })();

  // Table rows for commissions
  const commissionRows = (() => {
    if (!entries) return [];
    return entries.map((e) => ({
      id: e.id,
      userId: e.user_id,
      lead: e.description ?? e.lead_id ?? '—',
      rep: profileMap[e.user_id] ?? e.user_id,
      rule: e.rule_id ?? '—',
      base: e.base_amount,
      amount: e.amount,
      status: e.status,
      date: fmtDate(e.created_at),
      _raw: e,
    }));
  })();

  // Table rows for payout (from payroll preview entries)
  const payoutRows = (() => {
    if (!payroll) return [];
    return payroll.entries.map((e) => ({
      id: e.id,
      service: e.description ?? e.lead_id ?? '—',
      status: e.status === 'pending' ? 'invoiced' : e.status === 'approved' ? 'serviced' : e.status,
      date: fmtDate(e.created_at),
      amount: e.amount,
    }));
  })();

  // Show action buttons when we have real data
  // Approve/Reverse actions are admin-only. Reps see read-only commission rows.
  const showActions = !error && entries !== null && isAdmin;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Commissions</h2>
          <p className="text-xs text-text-tertiary">
            Track earnings, approvals, and payouts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Download className="h-3 w-3" />
            Export
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Filter className="h-3 w-3" />
            Filters
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-3">
        {([
          { key: 'commissions' as Tab, label: 'Commissions' },
          { key: 'payout' as Tab, label: 'Payout' },
          ...(isAdmin ? [{ key: 'rates' as Tab, label: 'Taux par rep' }] : []),
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'rounded-lg border px-5 py-2.5 text-sm font-semibold transition-all duration-200',
              activeTab === tab.key
                ? 'bg-white text-text-primary border-border shadow-md scale-105'
                : 'bg-transparent text-text-muted border-transparent hover:text-text-secondary hover:bg-white/50'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
          <span className="ml-2 text-sm text-text-muted">Loading commissions...</span>
        </div>
      )}

      {/* === COMMISSIONS TAB === */}
      {!loading && activeTab === 'commissions' && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {commissionCards.map((card) => (
              <StatCard key={card.label} {...card} />
            ))}
          </div>

          {/* Commission entries table */}
          <Card>
            <CardHeader>
              <CardTitle>Commission Entries</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border-subtle">
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Lead</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Rep</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Rule</th>
                      <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Base</th>
                      <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Commission</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Status</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commissionRows.map((entry) => (
                      <tr key={entry.id} className="border-b border-border-subtle last:border-b-0 table-row-hover">
                        <td className="px-5 py-2.5 text-sm font-medium text-text-primary">{entry.lead}</td>
                        <td className="px-5 py-2.5">
                          <Link to={`/reps/${entry.userId}`} className="flex items-center gap-2 hover:underline">
                            <Avatar name={entry.rep} src={getRepAvatar(entry.rep)} size="sm" className="!h-5 !w-5 !text-[8px]" />
                            <span className="text-sm text-text-secondary">{entry.rep}</span>
                          </Link>
                        </td>
                        <td className="px-5 py-2.5 text-sm text-text-muted">{entry.rule}</td>
                        <td className="px-5 py-2.5 text-right text-sm text-text-secondary">${entry.base.toLocaleString('en-US')}</td>
                        <td className="px-5 py-2.5 text-right text-sm font-medium text-text-primary">${entry.amount.toLocaleString('en-US')}</td>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize', statusStyles[entry.status] ?? 'bg-surface-elevated text-text-muted')}>
                              {entry.status}
                            </span>
                            {showActions && entry.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => handleApprove(entry.id)}
                                  disabled={actionLoading === entry.id}
                                  className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium text-success hover:bg-success/10 transition-colors disabled:opacity-50"
                                  title="Approve"
                                >
                                  {actionLoading === entry.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <CheckCircle className="h-3 w-3" />
                                  )}
                                </button>
                                <button
                                  onClick={() => handleReverse(entry.id)}
                                  disabled={actionLoading === entry.id}
                                  className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium text-error hover:bg-error/10 transition-colors disabled:opacity-50"
                                  title="Reverse"
                                >
                                  <XCircle className="h-3 w-3" />
                                </button>
                              </>
                            )}
                            {showActions && entry.status === 'approved' && (
                              <button
                                onClick={() => handleReverse(entry.id)}
                                disabled={actionLoading === entry.id}
                                className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium text-error hover:bg-error/10 transition-colors disabled:opacity-50"
                                title="Reverse"
                              >
                                {actionLoading === entry.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <XCircle className="h-3 w-3" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-2.5 text-sm text-text-muted">{entry.date}</td>
                      </tr>
                    ))}
                    {commissionRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-sm text-text-muted">
                          No commission entries found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* === PAYOUT TAB === */}
      {!loading && activeTab === 'payout' && (
        <>
          {/* Payout summary cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {payoutCards.map((card) => (
              <StatCard key={card.label} {...card} />
            ))}
          </div>

          {/* Payout entries table */}
          <Card>
            <CardHeader>
              <CardTitle>Payout Details</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border-subtle">
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Service</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Status</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Date</th>
                      <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutRows.map((entry) => (
                      <tr key={entry.id} className="border-b border-border-subtle last:border-b-0 table-row-hover">
                        <td className="px-5 py-2.5 text-sm font-medium text-text-primary">{entry.service}</td>
                        <td className="px-5 py-2.5">
                          <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize', payoutStatusStyles[entry.status] ?? 'bg-surface-elevated text-text-muted')}>
                            {entry.status}
                          </span>
                        </td>
                        <td className="px-5 py-2.5 text-sm text-text-muted">{entry.date}</td>
                        <td className="px-5 py-2.5 text-right text-sm font-medium text-text-primary">${entry.amount.toLocaleString('en-US')}</td>
                      </tr>
                    ))}
                    {payoutRows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-5 py-8 text-center text-sm text-text-muted">
                          No payout entries found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* === RATES TAB (admin only) === */}
      {!loading && activeTab === 'rates' && isAdmin && (
        <RatesPanel />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// RatesPanel — admin-only editor for per-rep commission %
// ──────────────────────────────────────────────────────────────
function RatesPanel() {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [rules, setRules] = useState<FsCommissionRule[]>([]);
  const [busy, setBusy] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftPct, setDraftPct] = useState<string>('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const [team, rulesData] = await Promise.all([
        fetchTeamList(),
        getCommissionRules(),
      ]);
      // Reps only (no owner/admin in commission targets — but allow them too)
      setMembers(team.members.filter((m) => m.status === 'active'));
      setRules(rulesData);
    } catch (err) {
      console.error('Failed to load rates:', err);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  function rateForUser(userId: string): FsCommissionRule | undefined {
    return rules.find((r) => r.applies_to_user_id === userId && r.type === 'percentage');
  }

  async function handleSave(userId: string) {
    const pct = parseFloat(draftPct);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      alert('Pourcentage invalide (0-100)');
      return;
    }
    setSavingId(userId);
    try {
      const existing = rateForUser(userId);
      if (existing) {
        await updateCommissionRule(existing.id, { percentage: pct });
      } else {
        await createCommissionRule({
          name: `Rate for ${userId.slice(0, 8)}`,
          type: 'percentage',
          percentage: pct,
          applies_to_user_id: userId,
          priority: 10,
        } as any);
      }
      setEditingId(null);
      setDraftPct('');
      await reload();
    } catch (err: any) {
      alert(err.message || 'Erreur de sauvegarde');
    } finally {
      setSavingId(null);
    }
  }

  if (busy) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Taux de commission par membre</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Membre</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Rôle</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Taux actuel</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Action</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const rule = rateForUser(m.user_id);
                const pct = rule?.percentage ?? null;
                const isEditing = editingId === m.user_id;
                const isSaving = savingId === m.user_id;
                return (
                  <tr key={m.user_id} className="border-b border-border-subtle last:border-b-0">
                    <td className="px-5 py-2.5 text-sm font-medium">
                      <Link to={`/reps/${m.user_id}`} className="text-text-primary hover:underline">
                        {m.full_name || m.email}
                      </Link>
                    </td>
                    <td className="px-5 py-2.5 text-sm text-text-muted capitalize">{m.role}</td>
                    <td className="px-5 py-2.5 text-right text-sm">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          value={draftPct}
                          onChange={(e) => setDraftPct(e.target.value)}
                          className="w-20 rounded border border-border bg-surface px-2 py-1 text-right text-sm"
                          autoFocus
                        />
                      ) : (
                        <span className="font-semibold text-text-primary">{pct != null ? `${pct}%` : '—'}</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" disabled={isSaving} onClick={() => handleSave(m.user_id)}>
                            {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Sauver'}
                          </Button>
                          <Button size="sm" variant="outline" disabled={isSaving} onClick={() => { setEditingId(null); setDraftPct(''); }}>
                            Annuler
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => { setEditingId(m.user_id); setDraftPct(pct != null ? String(pct) : ''); }}>
                          Modifier
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {members.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-text-muted">Aucun membre.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
