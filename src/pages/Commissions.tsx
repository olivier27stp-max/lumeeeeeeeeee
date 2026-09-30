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
  getCommissionSettings,
  updateCommissionSettings,
  deleteCommissionRule,
} from '../lib/commissionsApi';
import PlanEditeur from '../components/commissions/PlanEditeur';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { fetchTeamList, type OrgMember } from '../lib/invitationsApi';
import type { FsCommissionRule, CommissionSettings } from '../types';
import PersonalCommissionView, { defaultRange } from '../components/commissions/PersonalCommissionView';
import { confirmer } from '../components/ui/ConfirmDialog';
import { fmtArgent } from '../components/commissions/format';
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
  unmarkCommissionPaid,
  telechargerExportCommissions,
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
        {/* Suit le mode de paie de la fiche Équipe : à l'heure, à commission ou les deux. */}
        <PayrollSummaryCard />
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
  const { userId } = useCompany();
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

      {/* Tabs — défilent sur petit écran : à 390 px, « Taux » sortait de l'écran,
          coupé par le conteneur, donc inatteignable. */}
      <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
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
          <PayrollSummaryCard canManagePlans />
          {/* userId explicite : sans lui, le serveur (appelant admin) renvoyait
              les commissions de TOUTE l'équipe sous le titre « Mes commissions ». */}
          <PersonalCommissionView
            userId={userId ?? undefined}
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

  // Avant : pas de catch — un refus du serveur (403, commission déjà versée…)
  // ne montrait rien et le bouton semblait mort.
  const agir = async (id: string, action: () => Promise<FsCommissionEntry>, echec: string) => {
    setActionLoading(id);
    try {
      const updated = await action();
      setEntries((prev) => prev?.map((e) => (e.id === id ? { ...e, ...updated } : e)) ?? null);
    } catch (err: any) {
      console.error('[commissions] action refusée', err);
      toast.error(err?.message || echec);
    } finally { setActionLoading(null); }
  };
  const handleApprove = (id: string) => agir(id, () => approveCommission(id), isFr ? "Échec de l'approbation" : 'Approve failed');
  const handleReverse = async (id: string) => {
    const cible = entries?.find((e) => e.id === id);
    const ok = await confirmer({
      title: isFr ? 'Reverser cette commission ?' : 'Reverse this commission?',
      message: isFr
        ? `${cible ? fmtArgent(cible.amount, true) + ' — ' : ''}la commission ne sera plus due au représentant. Cette action ne peut pas être annulée.`
        : `${cible ? fmtArgent(cible.amount, false) + ' — ' : ''}the commission will no longer be owed to the rep. This cannot be undone.`,
      confirmLabel: isFr ? 'Reverser' : 'Reverse',
      danger: true,
    });
    if (!ok) return;
    await agir(id, () => reverseCommission(id, isFr ? 'Reversée manuellement' : 'Manually reversed'), isFr ? 'Échec du reversement' : 'Reverse failed');
  };
  const handleMarkPaid = (id: string) => agir(id, () => markCommissionPaid(id), isFr ? 'Échec du versement' : 'Mark paid failed');
  const handleUnmarkPaid = async (id: string) => {
    const ok = await confirmer({
      title: isFr ? 'Annuler ce versement ?' : 'Undo this payout?',
      message: isFr
        ? 'La commission redevient « approuvée » (à verser). À utiliser seulement si elle a été marquée versée par erreur.'
        : 'The commission goes back to “approved” (to pay). Only use this if it was marked paid by mistake.',
      confirmLabel: isFr ? 'Annuler le versement' : 'Undo payout',
    });
    if (ok) await agir(id, () => unmarkCommissionPaid(id), isFr ? "Échec de l'annulation" : 'Undo failed');
  };
  const exporter = async () => {
    try {
      await telechargerExportCommissions({
        from: filters.from, to: filters.to, userId: filters.repId,
        status: filters.status === 'all' ? undefined : filters.status, lang: isFr ? 'fr' : 'en',
      });
    } catch (err: any) {
      toast.error(err?.message || (isFr ? "Échec de l'export" : 'Export failed'));
    }
  };

  const repOptions = allReps.length
    ? allReps
    : [...new Set((entries ?? []).map((e) => e.user_id).filter(Boolean))].map((id) => ({ id, label: profileMap[id] ?? id }));

  return (
    <div className="space-y-6">
      <CommissionFilters value={filters} onChange={setFilters} reps={repOptions} />
      <div className="-mt-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void exporter()}>
          {filters.repId ? (isFr ? 'Relevé du représentant (CSV)' : 'Rep statement (CSV)') : (isFr ? 'Exporter (CSV)' : 'Export (CSV)')}
        </Button>
      </div>

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
                onUnmarkPaid={handleUnmarkPaid}
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

/** Libellé du rôle (la colonne affichait « Sales_rep », « Owner » en français). */
function libelleRole(role: string | null | undefined, isFr: boolean): string {
  const fr: Record<string, string> = { owner: 'Propriétaire', admin: 'Administrateur', sales_rep: 'Représentant', technician: 'Technicien' };
  const en: Record<string, string> = { owner: 'Owner', admin: 'Admin', sales_rep: 'Sales rep', technician: 'Technician' };
  return (isFr ? fr : en)[role ?? ''] ?? role ?? '—';
}

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
  // Fiche Équipe (mode de paie + taux horaire) : la même source que la page
  // Paie, pour que « à l'heure », « à commission » et « les deux » se lisent
  // au même endroit que le plan.
  const [paieParUser, setPaieParUser] = useState<Record<string, { id: string; mode: 'hourly' | 'commission' | 'both'; rate_cents: number }>>({});
  const [defaultRuleId, setDefaultRuleId] = useState<string | null>(null);
  // Tous les plans (actifs ou non), pour l'écran de gestion des plans.
  const [tousLesPlans, setTousLesPlans] = useState<FsCommissionRule[]>([]);
  const [politique, setPolitique] = useState<CommissionSettings['reversal_policy']>('alert');
  const [editeur, setEditeur] = useState<{ ouvert: boolean; regle: FsCommissionRule | null }>({ ouvert: false, regle: null });
  const [reglageEnCours, setReglageEnCours] = useState(false);

  // `silencieux` : rafraîchir après un enregistrement SANS remplacer l'onglet par
  // un spinner (la liste disparaissait puis revenait à chaque sauvegarde).
  const reload = useCallback(async (silencieux = false) => {
    if (!silencieux) setBusy(true);
    try {
      const [team, rulesData, reglages, orgId] = await Promise.all([fetchTeamList(), getCommissionRules(), getCommissionSettings().catch(() => null), getCurrentOrgIdOrThrow()]);
      // Ordre alphabétique stable : la liste d'équipe arrive sans ordre garanti
      // et les lignes changeaient de place d'un chargement à l'autre.
      setMembers(team.members.filter((m) => m.status === 'active')
        .sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', 'fr')));
      setRules(rulesData.filter((r) => r.is_active && !r.deleted_at));
      setDefaultRuleId(reglages?.default_rule_id ?? null);
      setPolitique(reglages?.reversal_policy ?? 'alert');
      setTousLesPlans(rulesData.filter((r) => !r.deleted_at));
      const { data: tm, error: tmErr } = await supabase
        .from('team_members')
        .select('id, user_id, compensation_mode, hourly_rate_cents, labour_cost_hourly')
        .eq('org_id', orgId)
        .neq('status', 'inactive')
        .not('user_id', 'is', null);
      if (tmErr) throw tmErr;
      const map: typeof paieParUser = {};
      for (const r of (tm || []) as Array<{ id: string; user_id: string; compensation_mode: string | null; hourly_rate_cents: number | null; labour_cost_hourly: number | null }>) {
        const mode = r.compensation_mode === 'commission' || r.compensation_mode === 'both' ? r.compensation_mode : 'hourly';
        map[r.user_id] = { id: r.id, mode, rate_cents: Number(r.hourly_rate_cents) || Math.round(Number(r.labour_cost_hourly || 0) * 100) || 0 };
      }
      setPaieParUser(map);
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

  // Bénéficiaire d'un split d'une AUTRE règle : il touche une part des ventes
  // du vendeur assigné. Sans ça, l'onglet affichait « Aucun plan : aucune
  // commission ne sera calculée » pour quelqu'un qui en touche (audit 2026-09-30).
  function partsDeSplit(userId: string): Array<{ rule: FsCommissionRule; pct: number }> {
    return rules.flatMap((r) => {
      const a = r.attribution as { mode?: string; splits?: Array<{ user_id: string; pct: number }> } | null | undefined;
      if (a?.mode !== 'split' || (r.assigned_user_ids || []).includes(userId)) return [];
      const part = (a.splits || []).find((s) => s.user_id === userId);
      return part ? [{ rule: r, pct: Number(part.pct) }] : [];
    });
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

  async function supprimerPlan(regle: FsCommissionRule) {
    const ok = await confirmer({
      title: isFr ? `Supprimer « ${regle.name} » ?` : `Delete “${regle.name}”?`,
      message: isFr
        ? 'Les commissions déjà calculées ne changent pas. Les membres de ce plan passeront au plan par défaut de l’entreprise (ou à aucun).'
        : 'Commissions already calculated do not change. Members of this plan fall back to the company default plan (or none).',
      confirmLabel: isFr ? 'Supprimer' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteCommissionRule(regle.id);
      if (defaultRuleId === regle.id) await updateCommissionSettings({ default_rule_id: null });
      toast.success(isFr ? 'Plan supprimé' : 'Plan deleted');
      await reload(true);
    } catch (err: any) {
      console.error('[commissions] suppression du plan refusée', err);
      toast.error(err?.message || (isFr ? 'Échec de la suppression' : 'Delete failed'));
    }
  }

  async function changerReglage(patch: Partial<CommissionSettings>) {
    setReglageEnCours(true);
    try {
      const r = await updateCommissionSettings(patch);
      setDefaultRuleId(r.default_rule_id ?? null);
      setPolitique(r.reversal_policy);
      toast.success(isFr ? 'Réglage enregistré' : 'Setting saved');
    } catch (err: any) {
      console.error('[commissions] réglage refusé', err);
      toast.error(err?.message || (isFr ? "Échec de l'enregistrement" : 'Save failed'));
    } finally {
      setReglageEnCours(false);
    }
  }

  const politiques: Array<{ v: CommissionSettings['reversal_policy']; fr: string; en: string }> = [
    { v: 'alert', fr: 'Signaler seulement — la commission reste due, marquée « facture remboursée »', en: 'Flag only — commission stays owed, marked “invoice refunded”' },
    { v: 'auto', fr: 'Annuler si pas encore versée — une commission déjà versée reste versée', en: 'Cancel if not yet paid out — an already paid commission stays paid' },
    { v: 'clawback', fr: 'Annuler, et reprendre une commission déjà versée sur la prochaine paie', en: 'Cancel, and claw back an already paid commission on the next payroll' },
    { v: 'keep', fr: 'Ne rien faire — le représentant garde sa commission', en: 'Do nothing — the rep keeps the commission' },
  ];
  const membresPlan = members.map((m) => ({ user_id: m.user_id, nom: m.full_name || m.email || m.user_id }));
  const idPlanDefaut = `plan-defaut-reglage`;
  const idPolitique = `politique-remboursement-reglage`;

  return (
    <div className="space-y-6">
      <PlanEditeur
        open={editeur.ouvert}
        regle={editeur.regle}
        membres={membresPlan}
        fr={isFr}
        onClose={() => setEditeur({ ouvert: false, regle: null })}
        onSaved={() => { void reload(true); }}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{isFr ? 'Plans de commission' : 'Commission plans'}</CardTitle>
            <Button size="sm" onClick={() => setEditeur({ ouvert: true, regle: null })}>
              {isFr ? 'Nouveau plan' : 'New plan'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {tousLesPlans.length === 0 ? (
            <p className="px-5 py-6 text-sm text-text-muted">{isFr ? 'Aucun plan. Crée ton premier plan de commission.' : 'No plan yet. Create your first commission plan.'}</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {tousLesPlans.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">
                      {r.name}
                      {r.id === defaultRuleId && <span className="ml-2 rounded bg-info/10 px-1.5 py-0.5 text-[11px] font-semibold text-info">{isFr ? 'Par défaut' : 'Default'}</span>}
                      {!r.is_active && <span className="ml-2 rounded bg-surface-elevated px-1.5 py-0.5 text-[11px] text-text-muted">{isFr ? 'Inactif' : 'Inactive'}</span>}
                    </p>
                    <p className="text-xs text-text-tertiary">
                      {planRateLabel(r, isFr)}
                      {(r.performance_tiers?.length ?? 0) > 0 && ` · ${r.performance_tiers.length} ${isFr ? 'palier(s)' : 'tier(s)'}`}
                      {(r.product_overrides?.length ?? 0) > 0 && ` · ${r.product_overrides.length} ${isFr ? 'catégorie(s)' : 'categor(ies)'}`}
                      {(r.bonuses?.length ?? 0) > 0 && ` · ${r.bonuses.length} bonus`}
                      {r.attribution?.mode === 'split' && ` · ${isFr ? 'partagé' : 'split'}`}
                      {` · ${(r.assigned_user_ids ?? []).length} ${isFr ? 'membre(s)' : 'member(s)'}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditeur({ ouvert: true, regle: r })}>{isFr ? 'Modifier' : 'Edit'}</Button>
                    <Button size="sm" variant="outline" onClick={() => void supprimerPlan(r)}>{isFr ? 'Supprimer' : 'Delete'}</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{isFr ? 'Réglages des commissions' : 'Commission settings'}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={idPlanDefaut} className="mb-1 block text-xs font-medium text-text-secondary">
              {isFr ? "Plan par défaut de l'entreprise" : 'Company default plan'}
            </label>
            <select
              id={idPlanDefaut}
              value={defaultRuleId ?? ''}
              disabled={reglageEnCours}
              onChange={(e) => void changerReglage({ default_rule_id: e.target.value || null })}
              className="w-full rounded-md border border-border-subtle px-2 py-1.5 text-sm text-text-primary"
              style={{ colorScheme: 'dark light' }}
            >
              <option value="">{isFr ? 'Aucun (pas de commission sans plan assigné)' : 'None (no commission without an assigned plan)'}</option>
              {rules.map((r) => <option key={r.id} value={r.id}>{r.name} — {planRateLabel(r, isFr)}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-text-tertiary">{isFr ? 'Utilisé pour un membre payé à commission qui n’a aucun plan assigné.' : 'Used for a commission-paid member with no assigned plan.'}</p>
          </div>
          <div>
            <label htmlFor={idPolitique} className="mb-1 block text-xs font-medium text-text-secondary">
              {isFr ? 'Quand une facture est remboursée' : 'When an invoice is refunded'}
            </label>
            <select
              id={idPolitique}
              value={politique}
              disabled={reglageEnCours}
              onChange={(e) => void changerReglage({ reversal_policy: e.target.value as CommissionSettings['reversal_policy'] })}
              className="w-full rounded-md border border-border-subtle px-2 py-1.5 text-sm text-text-primary"
              style={{ colorScheme: 'dark light' }}
            >
              {politiques.map((p) => <option key={p.v} value={p.v}>{isFr ? p.fr : p.en}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-text-tertiary">{isFr ? 'Une période de paie déjà versée ne change jamais : toute correction passe par la période suivante.' : 'A pay period already paid out never changes: any correction goes to the next period.'}</p>
          </div>
        </CardContent>
      </Card>

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
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">{isFr ? 'Mode de paie' : 'Pay mode'}</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">{isFr ? 'Taux horaire' : 'Hourly rate'}</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">{isFr ? 'Plan appliqué' : 'Applied plan'}</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">{isFr ? 'Taux effectif' : 'Effective rate'}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const plan = planForUser(m.user_id);
                const isSaving = savingId === m.user_id;
                const paie = paieParUser[m.user_id];
                const mode = paie?.mode ?? 'hourly';
                const modeLabel = mode === 'hourly' ? (isFr ? 'À l’heure' : 'Hourly') : mode === 'commission' ? 'Commission' : (isFr ? 'Horaire + commission' : 'Hourly + commission');
                const planParDefautValide = !!defaultRuleId && rules.some((r) => r.id === defaultRuleId);
                const splits = partsDeSplit(m.user_id);
                const sansPlan = mode !== 'hourly' && !plan && !planParDefautValide && splits.length === 0;
                return (
                  <tr key={m.user_id} className="border-b border-border-subtle last:border-b-0">
                    <td className="px-5 py-2.5 text-sm font-medium">
                      <Link to={`/reps/${m.user_id}`} className="text-text-primary hover:underline">
                        {m.full_name || m.email}
                      </Link>
                    </td>
                    <td className="px-5 py-2.5 text-sm text-text-muted">{libelleRole(m.role, isFr)}</td>
                    <td className="px-5 py-2.5 text-sm">
                      {paie ? (
                        <Link to={`/settings/team/${paie.id}`} className="text-text-primary hover:underline" title={isFr ? 'Modifier dans la fiche Équipe' : 'Edit on the team member page'}>
                          {modeLabel}
                        </Link>
                      ) : <span className="text-text-muted">—</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right text-sm tabular-nums text-text-primary">
                      {mode === 'commission' ? <span className="text-text-muted">—</span> : paie && paie.rate_cents > 0
                        ? `${(paie.rate_cents / 100).toLocaleString(isFr ? 'fr-CA' : 'en-CA', { minimumFractionDigits: 2 })} $/h`
                        : <span className="text-amber-700 dark:text-amber-300">0 $/h</span>}
                    </td>
                    <td className="px-5 py-2.5">
                      {sansPlan && (
                        <p className="mb-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                          {isFr ? 'Aucun plan : aucune commission ne sera calculée' : 'No plan: no commission will be calculated'}
                        </p>
                      )}
                      {splits.map((s) => (
                        <p key={s.rule.id} className="mb-1 text-[11px] text-text-tertiary">
                          {isFr ? `Part de split : ${s.pct} % de « ${s.rule.name} »` : `Split share: ${s.pct}% of “${s.rule.name}”`}
                        </p>
                      ))}
                      <div className="flex items-center gap-2">
                        <select
                          value={plan?.id ?? ''}
                          disabled={isSaving}
                          onChange={(e) => handleAssign(m.user_id, e.target.value)}
                          aria-label={`${isFr ? 'Plan de commission de' : 'Commission plan for'} ${m.full_name || m.email}`}
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
                      {plan
                        ? planRateLabel(plan, isFr)
                        : planParDefautValide
                          ? `${planRateLabel(rules.find((r) => r.id === defaultRuleId), isFr)} ${isFr ? '(par défaut)' : '(default)'}`
                          : mode === 'hourly'
                            ? <span className="font-normal text-text-muted">{isFr ? 'Aucune commission' : 'No commission'}</span>
                            : <span className="text-amber-700 dark:text-amber-300">{isFr ? 'Aucun plan' : 'No plan'}</span>}
                    </td>
                  </tr>
                );
              })}
              {members.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-text-muted">{isFr ? 'Aucun membre.' : 'No members.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
    </div>
  );
}
