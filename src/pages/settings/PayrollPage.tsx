import { useCallback, useEffect, useState } from 'react';
import {
  Banknote,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Loader2,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  Undo2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import {
  getPeriodSummary,
  addPayrollAdjustment,
  deletePayrollAdjustment,
  markPeriodPaid,
  unmarkPeriodPaid,
  downloadPayrollCsv,
  getPayHistory,
  type PeriodSummary,
  type PayrollRow,
  type PayHistoryEntry,
} from '../../lib/payrollApi';
import PayrollSettingsPanel from '../../components/payroll/PayrollSettingsPanel';

function money(cents: number, fr: boolean = false): string {
  return new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(cents / 100);
}

function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function fmtDate(dateStr: string, fr: boolean): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export default function PayrollPage() {
  const { language } = useTranslation();
  const fr = language === 'fr';

  // ref = any date inside the displayed period; undefined = today.
  const [ref, setRef] = useState<string | undefined>(undefined);
  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  // Adjustment form (inside the open row)
  const [adjAmount, setAdjAmount] = useState('');
  const [adjNote, setAdjNote] = useState('');
  const [adjSaving, setAdjSaving] = useState(false);

  // Per-employee pay history, lazy-loaded when a row is expanded.
  const [historyByUser, setHistoryByUser] = useState<Record<string, PayHistoryEntry[] | 'loading'>>({});

  async function openRow(userId: string) {
    setOpenUserId(userId);
    if (historyByUser[userId]) return;
    setHistoryByUser((prev) => ({ ...prev, [userId]: 'loading' }));
    try {
      const { payments } = await getPayHistory(userId);
      setHistoryByUser((prev) => ({ ...prev, [userId]: payments }));
    } catch {
      setHistoryByUser((prev) => ({ ...prev, [userId]: [] }));
    }
  }

  const load = useCallback(async (r?: string) => {
    setLoading(true);
    setError('');
    try {
      const s = await getPeriodSummary(r);
      setSummary(s);
    } catch (err: any) {
      setError(err?.message || (fr ? 'Échec du chargement' : 'Failed to load'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(ref); }, [ref, load]);

  const goPrev = () => summary && setRef(addDaysStr(summary.period.start, -1));
  const goNext = () => summary && setRef(addDaysStr(summary.period.end, 1));
  const goToday = () => setRef(undefined);

  async function handleAddAdjustment(row: PayrollRow) {
    if (!summary) return;
    const dollars = parseFloat(adjAmount.replace(',', '.'));
    if (!Number.isFinite(dollars) || dollars === 0) {
      toast.error(fr ? 'Montant invalide (négatif = retenue)' : 'Invalid amount (negative = deduction)');
      return;
    }
    setAdjSaving(true);
    try {
      await addPayrollAdjustment({
        user_id: row.user_id,
        period_start: summary.period.start,
        period_end: summary.period.end,
        amount_cents: Math.round(dollars * 100),
        note: adjNote.trim() || undefined,
      });
      setAdjAmount('');
      setAdjNote('');
      toast.success(fr ? 'Ajustement ajouté' : 'Adjustment added');
      await load(ref);
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Échec de l\'ajout' : 'Failed to add'));
    } finally {
      setAdjSaving(false);
    }
  }

  async function handleDeleteAdjustment(id: string) {
    try {
      await deletePayrollAdjustment(id);
      toast.success(fr ? 'Ajustement retiré' : 'Adjustment removed');
      await load(ref);
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Échec' : 'Failed'));
    }
  }

  async function handleTogglePaid(row: PayrollRow) {
    setBusyUserId(row.user_id);
    try {
      if (row.payment) {
        await unmarkPeriodPaid(row.user_id, ref);
        toast.success(fr ? 'Paiement annulé' : 'Payment unmarked');
      } else {
        await markPeriodPaid(row.user_id, ref);
        toast.success(fr ? `${row.name} marqué payé` : `${row.name} marked paid`);
      }
      await load(ref);
      // The paid list changed — drop the cached history so it reloads fresh.
      setHistoryByUser((prev) => {
        const next = { ...prev };
        delete next[row.user_id];
        return next;
      });
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Échec' : 'Failed'));
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      await downloadPayrollCsv(ref);
      toast.success(fr ? 'CSV exporté — prêt pour QuickBooks' : 'CSV exported — QuickBooks-ready');
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Échec de l\'export' : 'Export failed'));
    } finally {
      setExporting(false);
    }
  }

  const rows = summary?.rows || [];
  const totals = rows.reduce(
    (acc, r) => ({
      hours: acc.hours + r.hours,
      total: acc.total + r.total_cents,
      paid: acc.paid + (r.payment ? 1 : 0),
    }),
    { hours: 0, total: 0, paid: 0 },
  );

  return (
    <div className="max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-surface-secondary flex items-center justify-center">
            <Banknote size={18} className="text-text-tertiary" />
          </div>
          <div>
            <h1 className="text-[20px] font-bold text-text-primary tracking-tight">{fr ? 'Paie' : 'Payroll'}</h1>
            <p className="text-[12px] text-text-tertiary">
              {fr
                ? 'Heures pointées × taux (Membres) + commissions. Montants bruts — les déductions se font dans votre logiciel comptable.'
                : 'Punched hours × rate (Members) + commissions. Gross amounts — deductions happen in your accounting software.'}
            </p>
          </div>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || loading || rows.length === 0}
          className="glass-button-primary inline-flex items-center gap-1.5 !text-[12.5px] disabled:opacity-50"
        >
          {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {fr ? 'Exporter (QuickBooks CSV)' : 'Export (QuickBooks CSV)'}
        </button>
      </div>

      {/* Period navigation */}
      <div className="section-card px-4 py-3 flex items-center justify-between gap-2">
        <button onClick={goPrev} disabled={loading} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition">
          <ChevronLeft size={16} />
        </button>
        <div className="text-center">
          {summary ? (
            <>
              <p className="text-[14px] font-semibold text-text-primary tabular-nums">
                {fmtDate(summary.period.start, fr)} → {fmtDate(summary.period.end, fr)}
              </p>
              <p className="text-[11px] text-text-tertiary">
                {fr ? 'Versement le' : 'Pay date'} {fmtDate(summary.period.payDate, fr)}
                {ref && (
                  <button onClick={goToday} className="ml-2 underline hover:text-text-primary">
                    {fr ? 'Période courante' : 'Current period'}
                  </button>
                )}
              </p>
            </>
          ) : (
            <Loader2 size={15} className="animate-spin text-text-tertiary" />
          )}
        </div>
        <button onClick={goNext} disabled={loading} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition">
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Migration notice */}
      {summary?.migration_missing && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-[12px] text-amber-700 dark:text-amber-300">
          {fr
            ? 'La migration « payroll_adjustments_payments » n\'est pas appliquée : les ajustements et le statut « Payé » sont désactivés. Les heures, salaires et commissions restent exacts.'
            : 'The "payroll_adjustments_payments" migration is not applied: adjustments and paid status are disabled. Hours, wages and commissions remain accurate.'}
        </div>
      )}

      {/* Summary chips */}
      {summary && rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="section-card p-4">
            <div className="flex items-center gap-1.5 text-text-tertiary"><Users size={13} /><span className="text-[10px] font-bold uppercase tracking-wider">{fr ? 'Employés' : 'Employees'}</span></div>
            <p className="mt-1 text-lg font-extrabold tabular-nums text-text-primary">{rows.length} <span className="text-[11px] font-medium text-text-tertiary">({totals.paid} {fr ? 'payés' : 'paid'})</span></p>
          </div>
          <div className="section-card p-4">
            <div className="flex items-center gap-1.5 text-text-tertiary"><Clock size={13} /><span className="text-[10px] font-bold uppercase tracking-wider">{fr ? 'Heures' : 'Hours'}</span></div>
            <p className="mt-1 text-lg font-extrabold tabular-nums text-text-primary">{totals.hours.toFixed(1)} h</p>
          </div>
          <div className="section-card p-4">
            <div className="flex items-center gap-1.5 text-text-tertiary"><Banknote size={13} /><span className="text-[10px] font-bold uppercase tracking-wider">{fr ? 'Total brut' : 'Gross total'}</span></div>
            <p className="mt-1 text-lg font-extrabold tabular-nums text-text-primary">{money(totals.total, fr)}</p>
          </div>
        </div>
      )}

      {error && <div className="section-card p-4 text-[13px] text-danger">{error}</div>}

      {/* Rows */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-surface-secondary/40 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 && !error ? (
        <div className="section-card p-10 text-center">
          <Users size={28} className="text-text-tertiary/40 mx-auto mb-3" />
          <p className="text-[14px] font-medium text-text-secondary">{fr ? 'Aucun membre avec compte lié' : 'No members with a linked account'}</p>
          <p className="text-[12px] text-text-tertiary mt-1">
            {fr ? 'Les taux horaires se configurent dans Équipe → Membres.' : 'Hourly rates are set in Team → Members.'}
          </p>
        </div>
      ) : (
        <div className="section-card overflow-hidden divide-y divide-outline/30">
          {/* Table header */}
          <div className="hidden md:grid grid-cols-[1fr_70px_80px_90px_90px_90px_100px_110px] gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
            <span>{fr ? 'Employé' : 'Employee'}</span>
            <span className="text-right">{fr ? 'Heures' : 'Hours'}</span>
            <span className="text-right">{fr ? 'Taux' : 'Rate'}</span>
            <span className="text-right">{fr ? 'Salaire' : 'Wages'}</span>
            <span className="text-right">{fr ? 'Comm.' : 'Comm.'}</span>
            <span className="text-right">{fr ? 'Ajust.' : 'Adj.'}</span>
            <span className="text-right">Total</span>
            <span className="text-right">{fr ? 'Statut' : 'Status'}</span>
          </div>
          {rows.map((row) => {
            const isOpen = openUserId === row.user_id;
            return (
              <div key={row.user_id}>
                <button
                  onClick={() => (isOpen ? setOpenUserId(null) : openRow(row.user_id))}
                  className="w-full grid grid-cols-2 md:grid-cols-[1fr_70px_80px_90px_90px_90px_100px_110px] gap-2 px-4 py-3 items-center text-left hover:bg-surface-secondary/40 transition-colors"
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <ChevronDown size={13} className={cn('shrink-0 text-text-tertiary transition-transform', isOpen && 'rotate-180')} />
                    <span className="truncate">
                      <span className="text-[13px] font-semibold text-text-primary">{row.name}</span>
                      {row.role && <span className="ml-1.5 text-[10px] text-text-tertiary">{row.role}</span>}
                    </span>
                  </span>
                  <span className="hidden md:block text-right text-[13px] tabular-nums text-text-secondary">{row.hours.toFixed(2)}</span>
                  <span className="hidden md:block text-right text-[13px] tabular-nums text-text-secondary">{row.rate_cents ? money(row.rate_cents, fr) : '—'}</span>
                  <span className="hidden md:block text-right text-[13px] tabular-nums text-text-secondary">{money(row.gross_cents, fr)}</span>
                  <span className="hidden md:block text-right text-[13px] tabular-nums text-text-secondary">{money(row.commission_cents, fr)}</span>
                  <span className={cn('hidden md:block text-right text-[13px] tabular-nums', row.adjustments_cents < 0 ? 'text-danger' : 'text-text-secondary')}>{money(row.adjustments_cents, fr)}</span>
                  <span className="text-right text-[13.5px] font-bold tabular-nums text-text-primary">{money(row.total_cents, fr)}</span>
                  <span className="text-right">
                    {row.payment ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 text-success px-2 py-0.5 text-[10.5px] font-semibold">
                        <Check size={10} /> {fr ? 'Payé' : 'Paid'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-surface-secondary text-text-tertiary px-2 py-0.5 text-[10.5px] font-medium">
                        {fr ? 'À payer' : 'Due'}
                      </span>
                    )}
                  </span>
                </button>

                {isOpen && (
                  <div className="px-5 pb-4 pt-1 space-y-3 bg-surface-secondary/20">
                    <p className="text-[11px] text-text-tertiary">
                      {row.punch_count} {fr ? 'punch(s) complété(s)' : 'completed punch(es)'} · {row.hours.toFixed(2)} h × {money(row.rate_cents, fr)}/h = {money(row.gross_cents, fr)}
                      {row.commission_cents > 0 && <> · {fr ? 'commissions' : 'commissions'} {money(row.commission_cents, fr)}</>}
                    </p>

                    {/* Adjustments */}
                    {!summary?.migration_missing && (
                      <div className="space-y-2">
                        {row.adjustments.map((a) => (
                          <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-card border border-outline/50 px-3 py-1.5">
                            <span className="text-[12px] text-text-secondary truncate">
                              <span className={cn('font-semibold tabular-nums', a.amount_cents < 0 ? 'text-danger' : 'text-success')}>{money(a.amount_cents, fr)}</span>
                              {a.note && <span className="ml-2 text-text-tertiary">{a.note}</span>}
                            </span>
                            <button onClick={() => handleDeleteAdjustment(a.id)} className="p-1 rounded text-text-tertiary hover:text-danger" title={fr ? 'Retirer' : 'Remove'}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                        <div className="flex items-center gap-2">
                          <input
                            value={adjAmount}
                            onChange={(e) => setAdjAmount(e.target.value)}
                            placeholder={fr ? 'Montant $ (négatif = retenue)' : 'Amount $ (negative = deduction)'}
                            inputMode="decimal"
                            className="glass-input w-48 !text-[12.5px]"
                          />
                          <input
                            value={adjNote}
                            onChange={(e) => setAdjNote(e.target.value)}
                            placeholder={fr ? 'Note (ex. bonus vente)' : 'Note (e.g. sales bonus)'}
                            className="glass-input flex-1 !text-[12.5px]"
                          />
                          <button
                            onClick={() => handleAddAdjustment(row)}
                            disabled={adjSaving || !adjAmount.trim()}
                            className="glass-button inline-flex items-center gap-1 !text-[12px] disabled:opacity-50"
                          >
                            {adjSaving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                            {fr ? 'Ajuster' : 'Adjust'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Pay history for this employee */}
                    {!summary?.migration_missing && (() => {
                      const hist = historyByUser[row.user_id];
                      return (
                        <div>
                          <p className="text-[10.5px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">
                            {fr ? 'Historique de paie' : 'Pay history'}
                          </p>
                          {hist === 'loading' || hist === undefined ? (
                            <Loader2 size={13} className="animate-spin text-text-tertiary" />
                          ) : hist.length === 0 ? (
                            <p className="text-[11.5px] text-text-tertiary">
                              {fr ? 'Aucune paye enregistrée — marquez une période « Payé » pour bâtir l\'historique.' : 'No recorded pays — mark a period as paid to build history.'}
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {hist.map((h) => (
                                <div key={h.period_start} className="flex items-center justify-between gap-3 rounded-lg bg-surface-card border border-outline/50 px-3 py-1.5 text-[12px]">
                                  <span className="text-text-secondary tabular-nums">
                                    {fmtDate(h.period_start, fr)} → {fmtDate(h.period_end, fr)}
                                  </span>
                                  <span className="text-text-tertiary tabular-nums hidden sm:inline">
                                    {Number(h.hours).toFixed(1)} h
                                    {h.commission_cents > 0 && <> · {fr ? 'comm.' : 'comm.'} {money(h.commission_cents, fr)}</>}
                                  </span>
                                  <span className="font-semibold text-text-primary tabular-nums">{money(h.total_cents, fr)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Paid toggle */}
                    {!summary?.migration_missing && (
                      <div className="flex justify-end">
                        <button
                          onClick={() => handleTogglePaid(row)}
                          disabled={busyUserId === row.user_id}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition',
                            row.payment
                              ? 'border border-outline text-text-secondary hover:bg-surface-secondary'
                              : 'bg-success text-white hover:opacity-90',
                          )}
                        >
                          {busyUserId === row.user_id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : row.payment ? (
                            <Undo2 size={12} />
                          ) : (
                            <Check size={12} />
                          )}
                          {row.payment
                            ? (fr ? 'Annuler le statut payé' : 'Unmark paid')
                            : (fr ? `Marquer payé (${money(row.total_cents, fr)})` : `Mark paid (${money(row.total_cents, fr)})`)}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Period settings (collapsible) */}
      <div>
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="flex items-center gap-1.5 text-[12px] font-medium text-text-tertiary hover:text-text-primary transition"
        >
          <SettingsIcon size={12} />
          {fr ? 'Réglages des périodes de paie' : 'Pay period settings'}
          <ChevronDown size={12} className={cn('transition-transform', showSettings && 'rotate-180')} />
        </button>
        {showSettings && (
          <div className="mt-3 max-w-2xl">
            <PayrollSettingsPanel />
          </div>
        )}
      </div>
    </div>
  );
}
