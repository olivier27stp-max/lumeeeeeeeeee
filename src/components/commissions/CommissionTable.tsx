import { Link } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, Banknote } from 'lucide-react';
import UnifiedAvatar from '../ui/UnifiedAvatar';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import type { FsCommissionEntry } from '../../types';
import { fmtArgent, fmtDateCommission, libelleVente, libelleStatut, estEstimation, rembourseeApresVersement } from './format';

// Pastilles douces (soft) plutôt que fond plein criard, cohérent avec le reste.
const statusStyles: Record<string, string> = {
  pending:  'bg-warning/10 text-warning',
  approved: 'bg-info/10 text-info',
  paid:     'bg-success/10 text-success',
  reversed: 'bg-error/10 text-error',
};

interface Props {
  entries: FsCommissionEntry[];
  profileMap: Record<string, string>;
  /** Show the "Rep" column — true for admin/owner views, false for personal view */
  showRep: boolean;
  /** Show approve/reverse actions — only for owner/admin */
  showActions: boolean;
  actionLoading?: string | null;
  onApprove?: (id: string) => void;
  onReverse?: (id: string) => void;
  onMarkPaid?: (id: string) => void;
  emptyMessage?: string;
  /** Fuseau de l'entreprise (renvoyé par payroll-preview) pour les dates. */
  timeZone?: string;
}

/** Read-only by default; renders admin actions only when `showActions` is true. */
export default function CommissionTable({
  entries,
  profileMap,
  showRep,
  showActions,
  actionLoading,
  onApprove,
  onReverse,
  onMarkPaid,
  emptyMessage,
  timeZone,
}: Props) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const empty = emptyMessage ?? (fr ? 'Aucune entrée de commission' : 'No commission entries found');
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border-subtle">
            <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">{fr ? 'Vente' : 'Deal'}</th>
            {showRep && (
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">{fr ? 'Représentant' : 'Rep'}</th>
            )}
            <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">{fr ? 'Valeur vente' : 'Deal amount'}</th>
            <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Commission</th>
            <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">{fr ? 'Statut' : 'Status'}</th>
            <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">{fr ? 'Gagnée le' : 'Earned'}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const repName = profileMap[e.user_id] ?? e.rep_name ?? e.user_id;
            // Taux réel de la règle (calc_breakdown), pas un ratio arrondi à l'entier.
            const cb = (e.calc_breakdown ?? {}) as { base_kind?: string; base_value?: number; split_pct?: number };
            const taux = cb.base_kind === 'percent' && typeof cb.base_value === 'number'
              ? `${cb.base_value.toLocaleString(fr ? 'fr-CA' : 'en-CA')} %${typeof cb.split_pct === 'number' && cb.split_pct < 100 ? ` × ${cb.split_pct} %` : ''}`
              : null;
            return (
              <tr key={e.id} className="border-b border-border-subtle last:border-b-0 table-row-hover">
                <td className="px-5 py-2.5 text-sm font-medium text-text-primary">
                  {libelleVente(e, fr)}
                  {rembourseeApresVersement(e) && (
                    <span className="ml-2 inline-flex rounded-md bg-warning/10 px-1.5 py-0.5 text-[11px] font-semibold text-warning" title={e.reverse_reason ?? ''}>
                      {fr ? 'Remboursée après versement' : 'Refunded after payout'}
                    </span>
                  )}
                </td>
                {showRep && (
                  <td className="px-5 py-2.5">
                    <Link to={`/reps/${e.user_id}`} className="flex items-center gap-2 hover:underline">
                      <UnifiedAvatar id={e.user_id} name={repName} size={20} />
                      <span className="text-sm text-text-secondary">{repName}</span>
                    </Link>
                  </td>
                )}
                <td className="px-5 py-2.5 text-right text-sm tabular-nums text-text-secondary">{fmtArgent(e.base_amount, fr)}</td>
                <td className="px-5 py-2.5 text-right text-sm font-medium tabular-nums text-text-primary">
                  {fmtArgent(e.amount, fr)}
                  {taux && <span className="ml-1 text-xs text-text-muted">({taux})</span>}
                </td>
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold',
                      estEstimation(e) ? 'bg-surface-elevated text-text-muted' : (statusStyles[e.status] ?? 'bg-surface-elevated text-text-muted')
                    )} title={e.status === 'reversed' ? e.reverse_reason ?? undefined : undefined}>
                      {libelleStatut(e, fr)}
                    </span>
                    {showActions && e.status === 'pending' && !estEstimation(e) && onApprove && (
                      <button
                        onClick={() => onApprove(e.id)}
                        aria-label={fr ? 'Approuver' : 'Approve'}
                        disabled={actionLoading === e.id}
                        className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium text-success hover:bg-success/10 transition-colors disabled:opacity-50"
                        title={fr ? 'Approuver' : 'Approve'}
                      >
                        {actionLoading === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                      </button>
                    )}
                    {showActions && e.status === 'approved' && onMarkPaid && (
                      <button
                        onClick={() => onMarkPaid(e.id)}
                        disabled={actionLoading === e.id}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-success hover:bg-success/10 transition-colors disabled:opacity-50"
                        title={fr ? 'Marquer comme versé (payé au rep)' : 'Mark as paid'}
                      >
                        {actionLoading === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Banknote className="h-3 w-3" />}
                        <span>{fr ? 'Verser' : 'Pay'}</span>
                      </button>
                    )}
                    {showActions && (e.status === 'pending' || e.status === 'approved') && onReverse && (
                      <button
                        onClick={() => onReverse(e.id)}
                        aria-label={fr ? 'Reverser la commission' : 'Reverse commission'}
                        disabled={actionLoading === e.id}
                        className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium text-error hover:bg-error/10 transition-colors disabled:opacity-50"
                        title={fr ? 'Annuler' : 'Reverse'}
                      >
                        <XCircle className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-5 py-2.5 text-sm text-text-muted">{fmtDateCommission(e.triggered_at || e.created_at, fr, timeZone)}</td>
              </tr>
            );
          })}
          {entries.length === 0 && (
            <tr>
              <td colSpan={showRep ? 6 : 5} className="px-5 py-8 text-center text-sm text-text-muted">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
