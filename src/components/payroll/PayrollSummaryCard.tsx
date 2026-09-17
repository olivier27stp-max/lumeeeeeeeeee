import { useEffect, useState } from 'react';
import { Loader2, CalendarClock, Clock, Wallet, Handshake, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getCurrentPayPeriod, type CurrentPeriodResult } from '../../lib/payrollApi';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';

interface Props {
  /** Admin drilldown: inspect a specific rep. Omitted → the caller's own data. */
  userId?: string;
  /**
   * Quelle métrique de gauche afficher. Par défaut ('auto'), la carte suit le
   * mode de paie de la fiche Équipe : horaire → heures × taux ; commission →
   * ventes + commission ; les deux → heures, salaire et commission côte à
   * côte. 'hours' / 'deals' forcent l'ancien comportement.
   */
  metric?: 'hours' | 'deals' | 'auto';
  /** Lien « Assigner un plan » (réservé aux admins/proprios). */
  canManagePlans?: boolean;
}

function fmtMoney(n: number, fr: boolean) {
  return '$' + Number(n || 0).toLocaleString(fr ? 'fr-CA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string, fr: boolean) {
  // iso is YYYY-MM-DD — render in the user's locale, date-only (no TZ shift).
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { month: 'short', day: 'numeric' });
}

/**
 * Rep-facing payroll summary for the current pay period: hours worked +
 * commission landing on the next paycheque. Driven by the org's payroll
 * settings (Settings → Payroll). Also reused in the admin per-rep drilldown.
 */
export default function PayrollSummaryCard({ userId, metric = 'auto', canManagePlans = false }: Props) {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const tp = (t as any).payroll || {};
  const [data, setData] = useState<CurrentPeriodResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getCurrentPayPeriod(userId);
        if (!cancelled) setData(res);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || (fr ? 'Échec du chargement du résumé de paie' : 'Failed to load payroll summary'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-6 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="glass-card rounded-2xl p-6">
        <p className="text-sm text-text-tertiary">{error || (fr ? 'Aucune donnée de paie.' : 'No payroll data.')}</p>
      </div>
    );
  }

  const { period, hours, commission, pay } = data;
  // What's actually heading to their account: not-yet-paid commission.
  const upcoming = (commission.pending || 0) + (commission.approved || 0);
  // Mode effectif : celui de la fiche Équipe, sinon l'ancien réglage du parent.
  const mode: 'hourly' | 'commission' | 'both' =
    metric === 'hours' ? 'hourly' : metric === 'deals' ? 'commission' : (pay?.compensation_mode ?? 'hourly');
  const rateDollars = (pay?.hourly_rate_cents ?? 0) / 100;
  const grossDollars = pay ? pay.gross_cents / 100 : hours * rateDollars;
  const showHours = mode !== 'commission';
  const showCommission = mode !== 'hourly' || commission.total > 0;
  const totalDollars = (showHours ? grossDollars : 0) + (showCommission ? upcoming : 0);
  const modeLabel = mode === 'hourly'
    ? (fr ? 'Payé à l’heure' : 'Paid hourly')
    : mode === 'commission'
      ? (fr ? 'Payé à commission' : 'Paid on commission')
      : (fr ? 'Horaire + commission' : 'Hourly + commission');

  return (
    <div className="glass-card rounded-2xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <CalendarClock size={17} className="text-primary" />
          </div>
          <div>
            <h3 className="text-[14px] font-bold text-text-primary">
              {tp.currentPeriod || (fr ? 'Période de paie actuelle' : 'Current Pay Period')}
            </h3>
            <p className="text-[12px] text-text-tertiary">
              {fmtDate(period.start, fr)} – {fmtDate(period.end, fr)}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-text-tertiary uppercase tracking-wide">{tp.payday || (fr ? 'Versement' : 'Pay day')}</p>
          <p className="text-[13px] font-semibold text-text-primary">{fmtDate(period.payDate, fr)}</p>
        </div>
      </div>

      {pay && (
        <p className="text-[12px] text-text-tertiary -mt-2">
          {modeLabel}
          {showHours && rateDollars > 0 && <> · {fmtMoney(rateDollars, fr)}/h</>}
        </p>
      )}

      <div className={cn('grid gap-3', showHours && showCommission ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-2')}>
        {/* Heures poinçonnées — membres payés à l'heure ou mixtes */}
        {showHours && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-1.5 text-text-tertiary">
              <Clock size={13} />
              <span className="text-[11px] font-medium uppercase tracking-wide">{tp.hoursWorked || (fr ? 'Heures travaillées' : 'Hours worked')}</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-text-primary">{hours.toFixed(2)}<span className="text-sm font-medium text-text-tertiary ml-1">h</span></p>
          </div>
        )}

        {/* Salaire horaire = heures × taux (fiche Équipe) */}
        {showHours && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-1.5 text-text-tertiary">
              <Wallet size={13} />
              <span className="text-[11px] font-medium uppercase tracking-wide">{fr ? 'Salaire horaire' : 'Hourly pay'}</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-text-primary">{fmtMoney(grossDollars, fr)}</p>
            {rateDollars <= 0 && (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{fr ? 'Taux horaire à 0 $ — à régler dans la fiche Équipe.' : 'Hourly rate is $0 — set it on the team member page.'}</p>
            )}
          </div>
        )}

        {/* Ventes — membres à commission seulement */}
        {mode === 'commission' && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-1.5 text-text-tertiary">
              <Handshake size={13} />
              <span className="text-[11px] font-medium uppercase tracking-wide">{tp.deals || (fr ? 'Ventes' : 'Deals')}</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-text-primary">{commission.count}</p>
          </div>
        )}

        {/* Commission à venir */}
        {showCommission && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-1.5 text-text-tertiary">
              <Handshake size={13} />
              <span className="text-[11px] font-medium uppercase tracking-wide">{tp.commissionComing || (fr ? 'Commission à venir' : 'Commission coming')}</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-emerald-600">{fmtMoney(upcoming, fr)}</p>
          </div>
        )}
      </div>

      {/* Total prévu sur la prochaine paie */}
      {pay && (
        <div className="flex items-center justify-between rounded-xl bg-primary/5 px-4 py-2.5">
          <span className="text-[12px] font-medium text-text-secondary">{fr ? 'Total prévu sur la prochaine paie' : 'Expected on next paycheque'}</span>
          <span className="text-[15px] font-bold tabular-nums text-text-primary">{fmtMoney(totalDollars, fr)}</span>
        </div>
      )}

      {/* Rep à commission sans plan : rien ne sera calculé — dire pourquoi */}
      {pay?.commission_plan_missing && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {fr
              ? 'Aucun plan de commission n’est assigné à ce membre et il n’y a pas de plan par défaut : aucune commission ne sera calculée sur ses ventes.'
              : 'No commission plan is assigned to this member and there is no default plan: no commission will be calculated on their sales.'}
            {canManagePlans && (
              <> <Link to="/commissions" className="font-semibold underline">{fr ? 'Assigner un plan' : 'Assign a plan'}</Link></>
            )}
          </span>
        </div>
      )}

      {/* Breakdown */}
      {showCommission && (
      <div className="flex items-center justify-between text-[12px] pt-1">
        <span className="text-text-tertiary">
          {tp.pending || (fr ? 'En attente' : 'Pending')}: <span className="font-semibold text-text-secondary">{fmtMoney(commission.pending, fr)}</span>
        </span>
        <span className="text-text-tertiary">
          {tp.approved || (fr ? 'Approuvé' : 'Approved')}: <span className="font-semibold text-text-secondary">{fmtMoney(commission.approved, fr)}</span>
        </span>
        <span className="text-text-tertiary">
          {tp.paid || (fr ? 'Payé' : 'Paid')}: <span className="font-semibold text-text-secondary">{fmtMoney(commission.paid, fr)}</span>
        </span>
      </div>
      )}
    </div>
  );
}
