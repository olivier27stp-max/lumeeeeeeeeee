import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../d2d/card';
import { supabase } from '../../lib/supabase';
import {
  getCommissionEntries,
  getPayrollPreview,
} from '../../lib/commissionsApi';
import type { FsCommissionEntry, CommissionPayrollPreview } from '../../types';
import CommissionFilters, { type CommissionFiltersValue } from './CommissionFilters';
import CommissionTable from './CommissionTable';
import UpcomingPayouts from './UpcomingPayouts';
import { CommissionHero, KpiCard, fmtMoney } from './CommissionCharts';
import { useTranslation } from '../../i18n';

interface Props {
  /**
   * userId to scope the data to. When omitted, the backend defaults to the
   * caller's own user (the rep view). Admins viewing another rep pass the rep's
   * id explicitly.
   */
  userId?: string;
  /** Optional title override (e.g. "John Smith's commissions" in admin drilldown). */
  title?: string;
  /** Subtitle override. */
  subtitle?: string;
}

function defaultRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * Personal commission dashboard — used both for the sales_rep "My Commissions"
 * page AND for the admin/owner per-rep drilldown. Visually identical; the
 * scoping is controlled by the `userId` prop.
 */
export default function PersonalCommissionView({
  userId,
  title,
  subtitle,
}: Props) {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const resolvedTitle = title ?? (isFr ? 'Mes commissions' : 'My Commissions');
  const resolvedSubtitle = subtitle ?? (isFr ? 'Vos ventes conclues, vos commissions et vos prochains versements' : 'Your closes, commission, and next payouts');
  const [filters, setFilters] = useState<CommissionFiltersValue>(() => {
    const { from, to } = defaultRange();
    return { status: 'all', from, to };
  });
  const [entries, setEntries] = useState<FsCommissionEntry[] | null>(null);
  const [payroll, setPayroll] = useState<CommissionPayrollPreview | null>(null);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [entriesData, payrollData] = await Promise.all([
        getCommissionEntries({
          userId,
          status: filters.status === 'all' ? undefined : filters.status,
          from: filters.from,
          to: filters.to,
        }),
        getPayrollPreview(filters.from, filters.to, userId),
      ]);
      setEntries(entriesData);
      setPayroll(payrollData);

      // Resolve rep names (only used when admin drills into a specific rep)
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
      console.error('[PersonalCommissionView] failed to load:', err);
      setError(err?.message || (isFr ? 'Échec du chargement des commissions' : 'Failed to load commissions'));
    } finally {
      setLoading(false);
    }
  }, [userId, filters.status, filters.from, filters.to]);

  useEffect(() => { void load(); }, [load]);

  const dash = useMemo(() => {
    const list = entries ?? [];
    const total = list.reduce((s, e) => s + Number(e.amount || 0), 0);
    const pending = payroll?.pending ?? 0;
    const paid = payroll?.paid ?? 0;
    const next = list.filter((e) => e.status === 'approved').reduce((s, e) => s + Number(e.amount || 0), 0);

    // Cumulative earnings over the range.
    const from = new Date(filters.from + 'T00:00:00');
    const to = new Date(filters.to + 'T00:00:00');
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
    const buckets = new Array(days).fill(0);
    for (const e of list) {
      const d = new Date(e.triggered_at || e.created_at);
      const idx = Math.floor((d.getTime() - from.getTime()) / 86_400_000);
      if (idx >= 0 && idx < days) buckets[idx] += Number(e.amount || 0);
    }
    let run = 0;
    const series = buckets.map((v) => (run += v));
    const step = Math.max(1, Math.floor(days / 6));
    const xLabels: string[] = [];
    for (let i = 0; i < days; i += step) xLabels.push(String(new Date(from.getTime() + i * 86_400_000).getDate()));

    return { total, pending, paid, next, series, xLabels, deals: list.length };
  }, [entries, payroll, filters.from, filters.to]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">{resolvedTitle}</h2>
        <p className="text-xs text-text-tertiary">{resolvedSubtitle}</p>
      </div>

      <CommissionFilters value={filters} onChange={setFilters} />

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
          <CommissionHero
            label={isFr ? 'Commissions gagnées' : 'Commission earned'}
            value={dash.total}
            deltaPct={null}
            series={dash.series}
            xLabels={dash.xLabels}
            note={isFr ? `${dash.deals} vente(s) sur la période` : `${dash.deals} deal(s) this period`}
          />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label={isFr ? 'En attente' : 'Pending'} value={fmtMoney(dash.pending)} money note={isFr ? "d'approbation" : 'approval'} />
            <KpiCard label={isFr ? 'Versé' : 'Paid'} value={fmtMoney(dash.paid)} money note={isFr ? 'sur la période' : 'this period'} />
            <KpiCard label={isFr ? 'Prochain versement' : 'Next payout'} value={fmtMoney(dash.next)} money note={isFr ? 'approuvé' : 'approved'} />
            <KpiCard label={isFr ? 'Ventes conclues' : 'Deals closed'} value={String(dash.deals)} note={isFr ? 'sur la période' : 'this period'} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{isFr ? 'Ventes récentes' : 'Recent closes'}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <CommissionTable
                entries={entries ?? []}
                profileMap={profileMap}
                showRep={false}
                showActions={false}
                emptyMessage={isFr ? 'Aucune vente conclue sur la période sélectionnée' : 'No closes for the selected period'}
              />
            </CardContent>
          </Card>

          <UpcomingPayouts entries={entries ?? []} />
        </>
      )}
    </div>
  );
}
