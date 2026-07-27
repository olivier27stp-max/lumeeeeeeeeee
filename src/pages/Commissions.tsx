import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ShieldOff, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../components/d2d/card';
import { Button } from '../components/d2d/button';
import { useCompany } from '../contexts/CompanyContext';
import {
  getCommissionRules,
  assignMemberToRule,
} from '../lib/commissionsApi';
import { fetchTeamList, type OrgMember } from '../lib/invitationsApi';
import type { FsCommissionRule } from '../types';
import PersonalCommissionView from '../components/commissions/PersonalCommissionView';
import PayrollSummaryCard from '../components/payroll/PayrollSummaryCard';
import AdminCommissionOverview from '../components/commissions/AdminCommissionOverview';
import RepCommissionSummary from '../components/commissions/RepCommissionSummary';
import CommissionFilters, { type CommissionFiltersValue } from '../components/commissions/CommissionFilters';
import CommissionTable from '../components/commissions/CommissionTable';
import { supabase } from '../lib/supabase';
import {
  getCommissionEntries,
  approveCommission,
  reverseCommission,
  markCommissionPaid,
} from '../lib/commissionsApi';
import type { FsCommissionEntry } from '../types';
import { useTranslation } from '../i18n';

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
  const { currentRole, userId, loading } = useCompany();
  const { language } = useTranslation();
  const isFr = language === 'fr';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
        <span className="ml-2 text-sm text-text-muted">{isFr ? 'Chargement…' : 'Loading…'}</span>
      </div>
    );
  }

  if (currentRole === 'technician' || currentRole == null) {
    return <AccessDenied />;
  }

  // Only owners/admins get the management layout (Overview / Reps / Rates).
  // Every other role — sales_rep and any non-manager role — sees ONLY their
  // own commission, with no Overview/Reps tabs.
  const isManager = currentRole === 'owner' || currentRole === 'admin';

  if (!isManager) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">{isFr ? 'Mes commissions' : 'My Commissions'}</h1>
            <p className="text-xs text-text-tertiary">{isFr ? 'Vos ventes conclues, commissions gagnées et prochains versements' : 'Your closes, commission earnings and next payouts'}</p>
          </div>
        </div>
        <PayrollSummaryCard metric="deals" />
        {/* Scope explicitement au self: un rep ne voit QUE ses commissions.
            Sans userId, un owner en preview (Dev Role Switcher → rep) verrait
            tout, car le serveur applique son vrai rôle. Passer son propre id
            garantit l'aperçu correct; pour un vrai rep, le serveur force déjà. */}
        <PersonalCommissionView
          userId={userId ?? undefined}
          title={isFr ? 'Mes commissions' : 'My commissions'}
          subtitle={isFr ? 'Vos propres commissions' : 'Your own commissions'}
        />
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
  const { language } = useTranslation();
  const isFr = language === 'fr';
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="rounded-full bg-error/10 p-3">
        <ShieldOff className="h-8 w-8 text-error" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-text-primary">{isFr ? 'Accès refusé' : 'Access denied'}</h2>
      <p className="mt-1 max-w-sm text-sm text-text-muted">
        {isFr
          ? "Vous n'avez pas la permission de consulter les commissions. Contactez un propriétaire ou un admin si vous croyez qu'il s'agit d'une erreur."
          : "You don't have permission to view commissions. Contact an owner or admin if you believe this is a mistake."}
      </p>
      <Link to="/" className="mt-6">
        <Button variant="outline" size="sm">{isFr ? 'Retour au tableau de bord' : 'Back to dashboard'}</Button>
      </Link>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Admin / owner layout
// ──────────────────────────────────────────────────────────────────────

function AdminCommissionsLayout() {
  const { language } = useTranslation();
  const isFr = language === 'fr';
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
            {isFr
              ? 'Vue d\'ensemble des ventes, commissions et versements pour tous les représentants'
              : 'Overview of deals, commissions and payouts across all reps'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {([
          { key: 'overview' as AdminTab, label: isFr ? 'Vue d\'ensemble' : 'Overview' },
          { key: 'reps' as AdminTab,     label: isFr ? 'Représentants' : 'Reps' },
          { key: 'my' as AdminTab,       label: isFr ? 'Mes commissions' : 'My commissions' },
          { key: 'rates' as AdminTab,    label: isFr ? 'Taux' : 'Rates' },
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
            <ChevronLeft className="h-4 w-4" /> {isFr ? 'Retour aux représentants' : 'Back to reps'}
          </button>
          <PersonalCommissionView
            userId={drilldownRep.id}
            title={isFr ? `Commissions de ${drilldownRep.name}` : `${drilldownRep.name}'s commissions`}
            subtitle={isFr ? 'Vue en lecture seule — identique à ce que voit votre représentant' : 'Read-only drilldown — same view your rep sees'}
          />
        </div>
      )}

      {tab === 'my' && (
        <div className="space-y-6">
          <PayrollSummaryCard metric="deals" />
          <PersonalCommissionView
            title={isFr ? 'Mes commissions' : 'My commissions'}
            subtitle={isFr ? 'Vos propres commissions, le cas échéant' : 'Your own commissions, if any'}
          />
        </div>
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
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const [filters, setFilters] = useState<CommissionFiltersValue>(() => {
    const { from, to } = defaultRange();
    return { status: 'all', from, to };
  });
  const [entries, setEntries] = useState<FsCommissionEntry[] | null>(null);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [allReps, setAllReps] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Liste stable des reps pour le filtre (membres actifs de l'org), pas dérivée
  // des entrées filtrées — sinon on reste coincé sur le rep sélectionné.
  useEffect(() => {
    let cancelled = false;
    fetchTeamList()
      .then(({ members }) => {
        if (cancelled) return;
        setAllReps(members.filter((m) => m.status === 'active' && m.user_id).map((m) => ({ id: m.user_id, label: m.full_name || m.email || m.user_id })));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
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
      setError(err?.message || (isFr ? 'Échec du chargement des commissions' : 'Failed to load commissions'));
    } finally {
      setLoading(false);
    }
  }, [filters.repId, filters.status, filters.from, filters.to, onProfileMap, isFr]);

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
  const handleMarkPaid = async (id: string) => {
    setActionLoading(id);
    try {
      const updated = await markCommissionPaid(id);
      setEntries((prev) => prev?.map((e) => (e.id === id ? updated : e)) ?? null);
    } finally { setActionLoading(null); }
  };

  const repOptions = allReps.length
    ? allReps
    : [...new Set((entries ?? []).map((e) => e.user_id).filter(Boolean))].map((id) => ({ id, label: profileMap[id] ?? id }));

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
              <CardTitle>{isFr ? 'Toutes les entrées' : 'All entries'}</CardTitle>
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
                onMarkPaid={handleMarkPaid}
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

/** Taux effectif d'un plan (base_percent > percentage, ou forfait). */
function planRateLabel(rule: FsCommissionRule | undefined, isFr: boolean): string {
  if (!rule) return isFr ? 'Plan par défaut' : 'Default plan';
  if (rule.base_kind === 'flat') return `${((rule.base_value_cents || 0) / 100).toFixed(2)} $ ${isFr ? '/ vente' : '/ sale'}`;
  const pct = rule.base_percent ?? rule.percentage ?? 0;
  return `${pct}%`;
}

function RatesPanel() {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [rules, setRules] = useState<FsCommissionRule[]>([]);
  const [busy, setBusy] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const [team, rulesData] = await Promise.all([fetchTeamList(), getCommissionRules()]);
      setMembers(team.members.filter((m) => m.status === 'active'));
      setRules(rulesData.filter((r) => r.is_active && !r.deleted_at));
    } catch (err) {
      console.error('Failed to load rates:', err);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // Le plan qui paie un membre = la règle dont assigned_user_ids le contient.
  // C'est EXACTEMENT ce que le moteur de calcul résout quand une facture est
  // payée — donc l'assignation ici est réellement effective.
  function planForUser(userId: string): FsCommissionRule | undefined {
    return rules.find((r) => (r.assigned_user_ids || []).includes(userId));
  }

  async function handleAssign(userId: string, ruleId: string) {
    setSavingId(userId);
    try {
      await assignMemberToRule(userId, ruleId || null);
      // maj optimiste
      setRules((prev) => prev.map((r) => ({
        ...r,
        assigned_user_ids: r.id === ruleId
          ? [...new Set([...(r.assigned_user_ids || []), userId])]
          : (r.assigned_user_ids || []).filter((u) => u !== userId),
      })));
      toast.success(isFr ? 'Plan mis à jour' : 'Plan updated');
    } catch (err: any) {
      toast.error(err?.message || (isFr ? "Échec de l'enregistrement" : 'Save failed'));
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
        <CardTitle>{isFr ? 'Plan de commission par membre' : 'Commission plan per member'}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rules.length === 0 && (
          <p className="px-5 pt-3 text-xs text-text-muted">
            {isFr
              ? "Aucun plan de commission créé. Les commissions utilisent le plan par défaut de l'entreprise tant qu'aucun plan n'est assigné."
              : 'No commission plan created yet. Commissions use the company default until a plan is assigned.'}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">{isFr ? 'Membre' : 'Member'}</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">{isFr ? 'Rôle' : 'Role'}</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">{isFr ? 'Plan appliqué' : 'Applied plan'}</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">{isFr ? 'Taux effectif' : 'Effective rate'}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const plan = planForUser(m.user_id);
                const isSaving = savingId === m.user_id;
                return (
                  <tr key={m.user_id} className="border-b border-border-subtle last:border-b-0">
                    <td className="px-5 py-2.5 text-sm font-medium">
                      <Link to={`/reps/${m.user_id}`} className="text-text-primary hover:underline">
                        {m.full_name || m.email}
                      </Link>
                    </td>
                    <td className="px-5 py-2.5 text-sm text-text-muted capitalize">{m.role}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <select
                          value={plan?.id ?? ''}
                          disabled={isSaving}
                          onChange={(e) => handleAssign(m.user_id, e.target.value)}
                          style={{ colorScheme: 'dark light' }}
                          className="rounded-md border border-border-subtle px-2 py-1 text-sm text-text-primary disabled:opacity-60"
                        >
                          <option value="">{isFr ? "Plan par défaut de l'entreprise" : 'Company default plan'}</option>
                          {rules.map((r) => (
                            <option key={r.id} value={r.id}>{r.name} — {planRateLabel(r, isFr)}</option>
                          ))}
                        </select>
                        {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" />}
                      </div>
                    </td>
                    <td className="px-5 py-2.5 text-right text-sm font-semibold text-text-primary tabular-nums">
                      {planRateLabel(plan, isFr)}
                    </td>
                  </tr>
                );
              })}
              {members.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-text-muted">{isFr ? 'Aucun membre.' : 'No members.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
