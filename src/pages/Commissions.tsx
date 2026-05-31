import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ShieldOff, ChevronLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../components/d2d/card';
import { Button } from '../components/d2d/button';
import { useCompany } from '../contexts/CompanyContext';
import {
  getCommissionRules,
  createCommissionRule,
  updateCommissionRule,
} from '../lib/commissionsApi';
import { fetchTeamList, type OrgMember } from '../lib/invitationsApi';
import type { FsCommissionRule } from '../types';
import PersonalCommissionView from '../components/commissions/PersonalCommissionView';
import AdminCommissionOverview from '../components/commissions/AdminCommissionOverview';
import RepCommissionSummary from '../components/commissions/RepCommissionSummary';
import CommissionFilters, { type CommissionFiltersValue } from '../components/commissions/CommissionFilters';
import CommissionTable from '../components/commissions/CommissionTable';
import { supabase } from '../lib/supabase';
import {
  getCommissionEntries,
  approveCommission,
  reverseCommission,
} from '../lib/commissionsApi';
import type { FsCommissionEntry } from '../types';

type AdminTab = 'overview' | 'reps' | 'my' | 'rates';

// ──────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────

/**
 * Commissions page — role-aware.
 *  - technician           → Access denied (also blocked by the route Gated)
 *  - sales_rep            → personal dashboard, scoped to self by the backend
 *  - owner / admin        → management dashboard with Overview / Reps / My / Rates tabs
 */
export default function Commissions() {
  const { currentRole, loading } = useCompany();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
        <span className="ml-2 text-sm text-text-muted">Loading…</span>
      </div>
    );
  }

  if (currentRole === 'technician' || currentRole == null) {
    return <AccessDenied />;
  }

  if (currentRole === 'sales_rep') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">My Commissions</h1>
            <p className="text-xs text-text-tertiary">Your closes, commission earnings and next payouts</p>
          </div>
        </div>
        <PersonalCommissionView />
      </div>
    );
  }

  // owner / admin
  return <AdminCommissionsLayout />;
}

// ──────────────────────────────────────────────────────────────────────
// Access denied (defense in depth — route Gated already blocks technician)
// ──────────────────────────────────────────────────────────────────────

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="rounded-full bg-error/10 p-3">
        <ShieldOff className="h-8 w-8 text-error" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-text-primary">Access denied</h2>
      <p className="mt-1 max-w-sm text-sm text-text-muted">
        You don't have permission to view commissions. Contact an owner or admin if you believe this is a mistake.
      </p>
      <Link to="/" className="mt-6">
        <Button variant="outline" size="sm">Back to dashboard</Button>
      </Link>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Admin / owner layout
// ──────────────────────────────────────────────────────────────────────

function AdminCommissionsLayout() {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [drilldownRep, setDrilldownRep] = useState<{ id: string; name: string } | null>(null);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});

  // Resolve names once for the drilldown header. The composite views resolve
  // their own as well; this is just for the back-link label.
  const handleSelectRep = (userId: string) => {
    const name = profileMap[userId] || userId;
    setDrilldownRep({ id: userId, name });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Commissions</h1>
          <p className="text-xs text-text-tertiary">
            Overview of deals, commissions and payouts across all reps
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {([
          { key: 'overview' as AdminTab, label: 'Overview' },
          { key: 'reps' as AdminTab,     label: 'Reps' },
          { key: 'my' as AdminTab,       label: 'My commissions' },
          { key: 'rates' as AdminTab,    label: 'Rates' },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setDrilldownRep(null); }}
            className={cn(
              'rounded-lg border px-4 py-2 text-sm font-semibold transition-all',
              tab === t.key
                ? 'bg-white text-text-primary border-border shadow-sm'
                : 'bg-transparent text-text-muted border-transparent hover:text-text-secondary hover:bg-white/50'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <AdminCommissionOverview onSelectRep={(uid) => { setTab('reps'); handleSelectRep(uid); }} />
      )}

      {tab === 'reps' && !drilldownRep && (
        <RepsTab onSelectRep={handleSelectRep} onProfileMap={setProfileMap} />
      )}

      {tab === 'reps' && drilldownRep && (
        <div className="space-y-4">
          <button
            onClick={() => setDrilldownRep(null)}
            className="inline-flex items-center gap-1 text-sm font-medium text-text-secondary hover:text-text-primary"
          >
            <ChevronLeft className="h-4 w-4" /> Back to reps
          </button>
          <PersonalCommissionView
            userId={drilldownRep.id}
            title={`${drilldownRep.name}'s commissions`}
            subtitle="Read-only drilldown — same view your rep sees"
          />
        </div>
      )}

      {tab === 'my' && (
        <PersonalCommissionView
          title="My commissions"
          subtitle="Your own commissions, if any"
        />
      )}

      {tab === 'rates' && <RatesPanel />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Reps tab — wraps RepCommissionSummary + admin actions on the table
// ──────────────────────────────────────────────────────────────────────

interface RepsTabProps {
  onSelectRep: (userId: string) => void;
  onProfileMap: (map: Record<string, string>) => void;
}

function defaultRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

function RepsTab({ onSelectRep, onProfileMap }: RepsTabProps) {
  const [filters, setFilters] = useState<CommissionFiltersValue>(() => {
    const { from, to } = defaultRange();
    return { status: 'all', from, to };
  });
  const [entries, setEntries] = useState<FsCommissionEntry[] | null>(null);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCommissionEntries({
        userId: filters.repId,
        status: filters.status === 'all' ? undefined : filters.status,
        from: filters.from,
        to: filters.to,
      });
      setEntries(data);

      const ids = [...new Set(data.map((e) => e.user_id).filter(Boolean))];
      if (ids.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids);
        if (profiles) {
          const map: Record<string, string> = {};
          for (const p of profiles) map[p.id] = p.full_name ?? p.id;
          setProfileMap(map);
          onProfileMap(map);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load commissions');
    } finally {
      setLoading(false);
    }
  }, [filters.repId, filters.status, filters.from, filters.to, onProfileMap]);

  useEffect(() => { void load(); }, [load]);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      const updated = await approveCommission(id);
      setEntries((prev) => prev?.map((e) => (e.id === id ? updated : e)) ?? null);
    } finally { setActionLoading(null); }
  };
  const handleReverse = async (id: string) => {
    setActionLoading(id);
    try {
      const updated = await reverseCommission(id);
      setEntries((prev) => prev?.map((e) => (e.id === id ? updated : e)) ?? null);
    } finally { setActionLoading(null); }
  };

  const repOptions = (() => {
    const ids = [...new Set((entries ?? []).map((e) => e.user_id).filter(Boolean))];
    return ids.map((id) => ({ id, label: profileMap[id] ?? id }));
  })();

  return (
    <div className="space-y-6">
      <CommissionFilters value={filters} onChange={setFilters} reps={repOptions} />

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
        </div>
      )}
      {!loading && error && (
        <div className="rounded-xl border border-error/30 bg-error/5 px-5 py-4 text-sm text-error">{error}</div>
      )}
      {!loading && !error && (
        <>
          <RepCommissionSummary
            entries={entries ?? []}
            profileMap={profileMap}
            onSelectRep={onSelectRep}
          />

          <Card>
            <CardHeader>
              <CardTitle>All entries</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <CommissionTable
                entries={entries ?? []}
                profileMap={profileMap}
                showRep={true}
                showActions={true}
                actionLoading={actionLoading}
                onApprove={handleApprove}
                onReverse={handleReverse}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Rates panel — preserved from the previous implementation
// (admin-only; lets owner/admin edit per-rep commission % rules)
// ──────────────────────────────────────────────────────────────────────

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
      setMembers(team.members.filter((m) => m.status === 'active'));
      setRules(rulesData);
    } catch (err) {
      console.error('Failed to load rates:', err);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  function rateForUser(userId: string): FsCommissionRule | undefined {
    return rules.find((r) => r.applies_to_user_id === userId && r.type === 'percentage');
  }

  async function handleSave(userId: string) {
    const pct = parseFloat(draftPct);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      alert('Invalid percentage (0-100)');
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
        } as Partial<FsCommissionRule>);
      }
      setEditingId(null);
      setDraftPct('');
      await reload();
    } catch (err: any) {
      alert(err?.message || 'Save failed');
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
        <CardTitle>Commission rates per rep</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Member</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Role</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Current rate</th>
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
                          className="w-20 rounded border border-border bg-surface-card px-2 py-1 text-right text-sm"
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
                            {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                          </Button>
                          <Button size="sm" variant="outline" disabled={isSaving} onClick={() => { setEditingId(null); setDraftPct(''); }}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => { setEditingId(m.user_id); setDraftPct(pct != null ? String(pct) : ''); }}>
                          Edit
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {members.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-text-muted">No members.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
