import { useEffect, useState } from 'react';
import { Loader2, CalendarClock, Clock, Wallet, Handshake } from 'lucide-react';
import { getCurrentPayPeriod, type CurrentPeriodResult } from '../../lib/payrollApi';
import { useTranslation } from '../../i18n';

interface Props {
  /** Admin drilldown: inspect a specific rep. Omitted → the caller's own data. */
  userId?: string;
  /**
   * Which left metric to show. Sales reps are paid on commission, never on
   * hours, so the Commissions page passes 'deals'. Timesheet-driven contexts
   * (e.g. Settings → Payroll, hourly employees) keep 'hours'.
   */
  metric?: 'hours' | 'deals';
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
export default function PayrollSummaryCard({ userId, metric = 'hours' }: Props) {
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

  const { period, hours, commission } = data;
  // What's actually heading to their account: not-yet-paid commission.
  const upcoming = (commission.pending || 0) + (commission.approved || 0);

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

      <div className="grid grid-cols-2 gap-3">
        {/* Left metric — deals (commission-paid reps) or hours (hourly staff) */}
        {metric === 'deals' ? (
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-1.5 text-text-tertiary">
              <Handshake size={13} />
              <span className="text-[11px] font-medium uppercase tracking-wide">{tp.deals || (fr ? 'Ventes' : 'Deals')}</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-text-primary">{commission.count}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-1.5 text-text-tertiary">
              <Clock size={13} />
              <span className="text-[11px] font-medium uppercase tracking-wide">{tp.hoursWorked || (fr ? 'Heures travaillées' : 'Hours worked')}</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-text-primary">{hours.toFixed(2)}<span className="text-sm font-medium text-text-tertiary ml-1">h</span></p>
          </div>
        )}

        {/* Commission coming */}
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center gap-1.5 text-text-tertiary">
            <Wallet size={13} />
            <span className="text-[11px] font-medium uppercase tracking-wide">{tp.commissionComing || (fr ? 'Commission à venir' : 'Commission coming')}</span>
          </div>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-emerald-600">{fmtMoney(upcoming, fr)}</p>
        </div>
      </div>

      {/* Breakdown */}
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
    </div>
  );
}
