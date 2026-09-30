import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../d2d/card';
import { supabase } from '../../lib/supabase';
import {
  getCommissionEntries,
  getPayrollPreview,
  approveCommission,
  reverseCommission,
  markCommissionPaid,
  unmarkCommissionPaid,
  telechargerExportCommissions,
} from '../../lib/commissionsApi';
import { toast } from 'sonner';
import { Button } from '../d2d/button';
import type { FsCommissionEntry, CommissionPayrollPreview } from '../../types';
import { fetchTeamList } from '../../lib/invitationsApi';
import CommissionFilters, { type CommissionFiltersValue } from './CommissionFilters';
import CommissionTable from './CommissionTable';
import UpcomingPayouts from './UpcomingPayouts';
import { CommissionHero, RepLeaderboard, StatusDonut, KpiCard, fmtMoney, type LeaderRep } from './CommissionCharts';
import { useTranslation } from '../../i18n';
import { confirmer } from '../ui/ConfirmDialog';
import { serieCumulee } from './PersonalCommissionView';

interface Props {
  /** Called when the admin clicks a rep — host page can open the drilldown view */
  onSelectRep?: (userId: string) => void;
}

function defaultRange() {
  // Bornes du mois courant construites SANS toISOString() : passer par UTC
  // décalait le 1er/dernier jour d'une journée pour les fuseaux à l'ouest de
  // Greenwich (comme le Québec), faisant tomber les commissions de début/fin
  // de mois du mauvais côté. On formate les composantes locales directement.
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const fmt = (yy: number, mm: number, dd: number) =>
    `${yy}-${String(mm + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const from = fmt(y, m, 1);
  const lastDay = new Date(y, m + 1, 0).getDate();
  const to = fmt(y, m, lastDay);
  return { from, to };
}

/**
 * Admin/owner overview — KPIs across all reps, rep breakdown, deals table,
 * and upcoming payouts. The same building blocks as the personal view, so the
 * two experiences feel consistent.
 */
export default function AdminCommissionOverview({ onSelectRep }: Props) {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const [filters, setFilters] = useState<CommissionFiltersValue>(() => {
    const { from, to } = defaultRange();
    return { status: 'all', from, to };
  });
  const [entries, setEntries] = useState<FsCommissionEntry[] | null>(null);
  const [payroll, setPayroll] = useState<CommissionPayrollPreview | null>(null);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [entriesData, payrollData] = await Promise.all([
        getCommissionEntries({
          userId: filters.repId, // backend treats undefined as "all reps" for admin/owner
          status: filters.status === 'all' ? undefined : filters.status,
          from: filters.from,
          to: filters.to,
        }),
        getPayrollPreview(filters.from, filters.to, filters.repId),
      ]);
      setEntries(entriesData);
      setPayroll(payrollData);

      const ids = [...new Set(entriesData.map((e) => e.user_id).filter(Boolean))];
      if (ids.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids);
        if (profiles) {
          const map: Record<string, string> = {};
          for (const p of profiles) map[p.id] = p.full_name ?? p.id;
          setProfileMap(map);
        }
      }
    } catch (err: any) {
      console.error('[AdminCommissionOverview] failed to load:', err);
      setError(err?.message || (isFr ? 'Échec du chargement des commissions' : 'Failed to load commissions'));
    } finally {
      setLoading(false);
    }
  }, [filters.repId, filters.status, filters.from, filters.to]);

  useEffect(() => { void load(); }, [load]);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      const updated = await approveCommission(id);
      setEntries((prev) => prev?.map((e) => (e.id === id ? { ...e, ...updated } : e)) ?? null);
      setPayroll(await getPayrollPreview(filters.from, filters.to, filters.repId));
    } catch (err: any) {
      // Toast, pas setError : une action refusée ne doit pas masquer tout le tableau de bord.
      toast.error(err?.message || (isFr ? "Échec de l'approbation" : 'Approve failed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleReverse = async (id: string) => {
    // Irréversible et touche la paie d'un rep : confirmation obligatoire (avant :
    // un seul clic sur une petite croix, sans raison ni retour possible).
    const cible = entries?.find((e) => e.id === id);
    const ok = await confirmer({
      title: isFr ? 'Reverser cette commission ?' : 'Reverse this commission?',
      message: isFr
        ? `${cible ? fmtMoney(Number(cible.amount)) + ' — ' : ''}la commission ne sera plus due au représentant. Cette action ne peut pas être annulée.`
        : `${cible ? fmtMoney(Number(cible.amount)) + ' — ' : ''}the commission will no longer be owed to the rep. This cannot be undone.`,
      confirmLabel: isFr ? 'Reverser' : 'Reverse',
      danger: true,
    });
    if (!ok) return;
    setActionLoading(id);
    try {
      const updated = await reverseCommission(id, isFr ? 'Reversée manuellement' : 'Manually reversed');
      setEntries((prev) => prev?.map((e) => (e.id === id ? { ...e, ...updated } : e)) ?? null);
      setPayroll(await getPayrollPreview(filters.from, filters.to, filters.repId));
    } catch (err: any) {
      toast.error(err?.message || (isFr ? 'Échec du reversement' : 'Reverse failed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkPaid = async (id: string) => {
    setActionLoading(id);
    try {
      const updated = await markCommissionPaid(id);
      setEntries((prev) => prev?.map((e) => (e.id === id ? { ...e, ...updated } : e)) ?? null);
      // Reflète le versement dans les totaux (payé/en attente).
      const p = await getPayrollPreview(filters.from, filters.to, filters.repId);
      setPayroll(p);
    } catch (err: any) {
      toast.error(err?.message || (isFr ? 'Échec du versement' : 'Mark paid failed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnmarkPaid = async (id: string) => {
    const ok = await confirmer({
      title: isFr ? 'Annuler ce versement ?' : 'Undo this payout?',
      message: isFr
        ? 'La commission redevient « approuvée » (à verser). À utiliser seulement si elle a été marquée versée par erreur.'
        : 'The commission goes back to “approved” (to pay). Only use this if it was marked paid by mistake.',
      confirmLabel: isFr ? 'Annuler le versement' : 'Undo payout',
    });
    if (!ok) return;
    setActionLoading(id);
    try {
      const updated = await unmarkCommissionPaid(id);
      setEntries((prev) => prev?.map((e) => (e.id === id ? { ...e, ...updated } : e)) ?? null);
      setPayroll(await getPayrollPreview(filters.from, filters.to, filters.repId));
    } catch (err: any) {
      toast.error(err?.message || (isFr ? "Échec de l'annulation" : 'Undo failed'));
    } finally {
      setActionLoading(null);
    }
  };

  const [exportEnCours, setExportEnCours] = useState(false);
  const exporter = async () => {
    setExportEnCours(true);
    try {
      await telechargerExportCommissions({
        from: filters.from, to: filters.to, userId: filters.repId,
        status: filters.status === 'all' ? undefined : filters.status, lang: isFr ? 'fr' : 'en',
      });
    } catch (err: any) {
      toast.error(err?.message || (isFr ? "Échec de l'export" : 'Export failed'));
    } finally {
      setExportEnCours(false);
    }
  };

  // Dashboard derivations — total + cumulative time series + leaderboard + split.
  const dash = useMemo(() => {
    const paid = payroll?.paid ?? 0;
    const pending = payroll?.pending ?? 0;
    const reversed = payroll?.reversed ?? 0;
    // « approved » = approuvé, en attente de versement. Sans lui, une commission
    // approuvée comptait dans le total mais n'apparaissait dans AUCUN segment :
    // « 1 total, 0 partout ». C'est le prochain versement à faire.
    const approved = payroll?.approved ?? 0;
    // Le total et les segments viennent de la MÊME source (payroll, période
    // entière) : ils se réconcilient toujours. On NE recalcule PAS le total
    // depuis `entries` — celles-ci suivent le filtre de statut et incluaient
    // le reversed en positif, ce qui contredisait le donut. Le total est ce
    // qui est réellement dû : en attente + approuvé + versé (reversed exclu).
    const total = payroll?.total ?? (pending + approved + paid);

    // Courbe, classement, ventes et moyenne : totaux SERVEUR sur toute la
    // période (la liste est bornée et suit le filtre de statut). Avant, ils
    // additionnaient la liste — reprises et estimations comprises — et chaque
    // part d'un split comptait comme une vente.
    const { series, xLabels } = serieCumulee(filters.from, filters.to, payroll?.par_jour ?? []);
    const actifs = (payroll?.par_rep ?? []).filter((r) => r.du_cents > 0);
    const leaderboard: LeaderRep[] = actifs
      .map((r) => ({ userId: r.user_id, name: profileMap[r.user_id] ?? r.rep_name ?? r.user_id, amount: r.du_cents / 100, deals: r.ventes }))
      .slice(0, 5);
    const deals = payroll?.sales ?? 0;
    const avgPerDeal = deals ? total / deals : 0;
    return { total, paid, pending, approved, reversed, estimated: payroll?.estimated ?? 0, series, xLabels, leaderboard, deals, avgPerDeal, repCount: actifs.length };
  }, [payroll, profileMap, filters.from, filters.to]);

  // Rep list for the filter dropdown — loaded once from the org's members, so
  // it stays STABLE. (Deriving it from the filtered entries collapsed the list
  // to just the selected rep, trapping the filter.)
  const [allReps, setAllReps] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchTeamList()
      .then(({ members }) => {
        if (cancelled) return;
        setAllReps(
          members
            .filter((m) => m.status === 'active' && m.user_id)
            .map((m) => ({ id: m.user_id, label: m.full_name || m.email || m.user_id })),
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // Fallback: if the team list is empty, derive from entries (union, not just the
  // filtered rep) so the dropdown is never empty.
  const repOptions = useMemo(() => {
    if (allReps.length) return allReps;
    const ids = [...new Set((entries ?? []).map((e) => e.user_id).filter(Boolean))];
    return ids.map((id) => ({ id, label: profileMap[id] ?? id }));
  }, [allReps, entries, profileMap]);

  return (
    <div className="space-y-6">
      <CommissionFilters value={filters} onChange={setFilters} reps={repOptions} />
      <div className="-mt-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void exporter()} disabled={exportEnCours}>
          {exportEnCours ? (isFr ? 'Export…' : 'Exporting…') : filters.repId ? (isFr ? 'Relevé du représentant (CSV)' : 'Rep statement (CSV)') : (isFr ? 'Exporter (CSV)' : 'Export (CSV)')}
        </Button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
          <span className="ml-2 text-sm text-text-muted">{isFr ? 'Chargement des commissions...' : 'Loading commissions...'}</span>
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-error/30 bg-error/5 px-5 py-4 text-sm text-error">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Hero (total + trend + evolution) beside quick facts */}
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.5fr_1fr]">
            <CommissionHero
              label={isFr ? 'Commissions totales' : 'Total commissions'}
              value={dash.total}
              deltaPct={null}
              series={dash.series}
              xLabels={dash.xLabels}
              note={isFr ? 'Sur la période' : 'Selected period'}
            />
            <div className="rounded-2xl border border-border bg-surface-card p-4 shadow-card">
              <div className="px-1 pb-1 text-[14px] font-bold tracking-tight text-text-primary">{isFr ? 'En bref' : 'At a glance'}</div>
              <div className="mt-1 flex flex-col">
                {[
                  { l: isFr ? 'Ventes conclues' : 'Deals closed', v: String(dash.deals) },
                  { l: isFr ? 'Commission moyenne / vente' : 'Avg. per deal', v: fmtMoney(dash.avgPerDeal), money: true },
                  { l: isFr ? 'Représentants actifs' : 'Active reps', v: String(dash.repCount) },
                  { l: isFr ? 'Versé sur la période' : 'Paid this period', v: fmtMoney(dash.paid), money: true },
                ].map((r) => (
                  <div key={r.l} className="flex items-center justify-between border-b border-border-light py-2.5 last:border-b-0">
                    <span className="text-[12px] text-text-secondary">{r.l}</span>
                    <span className="text-[14px] font-bold tabular-nums text-text-primary">{r.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label={isFr ? 'En attente' : 'Pending'} value={fmtMoney(dash.pending)} money note={isFr ? "en attente d'approbation" : 'awaiting approval'} />
            <KpiCard label={isFr ? 'Approuvé' : 'Approved'} value={fmtMoney(dash.approved)} money note={isFr ? 'à verser' : 'to pay out'} />
            <KpiCard label={isFr ? 'Versé' : 'Paid'} value={fmtMoney(dash.paid)} money note={isFr ? 'réglé' : 'settled'} />
            <KpiCard label={isFr ? 'Reversé' : 'Reversed'} value={fmtMoney(dash.reversed)} money note={isFr ? 'annulé' : 'clawed back'} />
          </div>

          {/* Leaderboard + status donut */}
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader><CardTitle>{isFr ? 'Classement des représentants' : 'Rep leaderboard'}</CardTitle></CardHeader>
              <CardContent><RepLeaderboard reps={dash.leaderboard} onSelect={onSelectRep} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{isFr ? 'Répartition' : 'Breakdown'}</CardTitle></CardHeader>
              <CardContent>
                <StatusDonut
                  centerLabel="Total"
                  segments={[
                    { label: isFr ? 'Versé' : 'Paid', value: dash.paid, color: 'var(--color-success)' },
                    { label: isFr ? 'Approuvé' : 'Approved', value: dash.approved, color: 'var(--color-info)' },
                    { label: isFr ? 'En attente' : 'Pending', value: dash.pending, color: 'var(--color-warning)' },
                    { label: isFr ? 'Reversé' : 'Reversed', value: dash.reversed, color: 'var(--color-danger)' },
                  ]}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{isFr ? 'Entrées de commission' : 'Commission entries'}</CardTitle>
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
                timeZone={payroll?.timezone}
              />
            </CardContent>
          </Card>

          {dash.estimated > 0 && (
            <p className="text-xs text-text-tertiary">
              {isFr
                ? `Estimé sur des jobs pas encore payés : ${fmtMoney(dash.estimated)} — jamais compté dans les totaux.`
                : `Estimated on jobs not paid yet: ${fmtMoney(dash.estimated)} — never counted in the totals.`}
            </p>
          )}
          <UpcomingPayouts entries={entries ?? []} timeZone={payroll?.timezone} />
        </>
      )}
    </div>
  );
}
