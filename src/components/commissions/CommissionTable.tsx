import { Link } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Avatar } from '../d2d/avatar';
import { getRepAvatar } from '../../lib/constants/avatars';
import { cn } from '../../lib/utils';
import type { FsCommissionEntry } from '../../types';

const statusStyles: Record<string, string> = {
  pending:  'bg-warning text-white',
  approved: 'bg-info text-white',
  paid:     'bg-success text-white',
  reversed: 'bg-error text-white',
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
  emptyMessage?: string;
}

function fmtMoney(n: number) {
  return '$' + Number(n || 0).toLocaleString('en-US');
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
  emptyMessage = 'No commission entries found',
}: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border-subtle">
            <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Deal</th>
            {showRep && (
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Rep</th>
            )}
            <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Deal amount</th>
            <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Commission</th>
            <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Status</th>
            <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Closed</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const repName = profileMap[e.user_id] ?? e.rep_name ?? e.user_id;
            const pct = e.base_amount > 0 ? Math.round((e.amount / e.base_amount) * 100) : 0;
            return (
              <tr key={e.id} className="border-b border-border-subtle last:border-b-0 table-row-hover">
                <td className="px-5 py-2.5 text-sm font-medium text-text-primary">
                  {e.description ?? e.lead_id ?? '—'}
                </td>
                {showRep && (
                  <td className="px-5 py-2.5">
                    <Link to={`/reps/${e.user_id}`} className="flex items-center gap-2 hover:underline">
                      <Avatar name={repName} src={getRepAvatar(repName)} size="sm" className="!h-5 !w-5 !text-[8px]" />
                      <span className="text-sm text-text-secondary">{repName}</span>
                    </Link>
                  </td>
                )}
                <td className="px-5 py-2.5 text-right text-sm text-text-secondary">{fmtMoney(e.base_amount)}</td>
                <td className="px-5 py-2.5 text-right text-sm font-medium text-text-primary">
                  {fmtMoney(e.amount)}
                  <span className="ml-1 text-xs text-text-muted">({pct}%)</span>
                </td>
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize',
                      statusStyles[e.status] ?? 'bg-surface-elevated text-text-muted'
                    )}>
                      {e.status}
                    </span>
                    {showActions && e.status === 'pending' && onApprove && (
                      <button
                        onClick={() => onApprove(e.id)}
                        disabled={actionLoading === e.id}
                        className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium text-success hover:bg-success/10 transition-colors disabled:opacity-50"
                        title="Approve"
                      >
                        {actionLoading === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                      </button>
                    )}
                    {showActions && (e.status === 'pending' || e.status === 'approved') && onReverse && (
                      <button
                        onClick={() => onReverse(e.id)}
                        disabled={actionLoading === e.id}
                        className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium text-error hover:bg-error/10 transition-colors disabled:opacity-50"
                        title="Reverse"
                      >
                        <XCircle className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-5 py-2.5 text-sm text-text-muted">{fmtDate(e.created_at)}</td>
              </tr>
            );
          })}
          {entries.length === 0 && (
            <tr>
              <td colSpan={showRep ? 6 : 5} className="px-5 py-8 text-center text-sm text-text-muted">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
