import { Card, CardContent, CardHeader, CardTitle } from '../d2d/card';
import { cn } from '../../lib/utils';
import type { FsCommissionEntry } from '../../types';

interface Props {
  entries: FsCommissionEntry[];
  /** Limit number of rows rendered (default 5) */
  limit?: number;
}

const statusStyles: Record<string, string> = {
  pending:  'bg-warning text-white',
  approved: 'bg-info text-white',
  paid:     'bg-success text-white',
};

function fmtMoney(n: number) {
  return '$' + Number(n || 0).toLocaleString('en-US');
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Upcoming payouts panel — shows entries that are not yet paid, sorted by
 * approval date (then created date). Designed to drop into either dashboard.
 */
export default function UpcomingPayouts({ entries, limit = 5 }: Props) {
  const upcoming = entries
    .filter((e) => e.status === 'pending' || e.status === 'approved')
    .sort((a, b) => {
      const ax = a.approved_at ?? a.created_at;
      const bx = b.approved_at ?? b.created_at;
      return new Date(bx).getTime() - new Date(ax).getTime();
    })
    .slice(0, limit);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming payouts</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border-subtle">
          {upcoming.map((e) => (
            <li key={e.id} className="flex items-center justify-between px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text-primary">
                  {e.description ?? e.lead_id ?? '—'}
                </p>
                <p className="text-xs text-text-muted">
                  Closed {fmtDate(e.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={cn(
                  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize',
                  statusStyles[e.status] ?? 'bg-surface-elevated text-text-muted'
                )}>
                  {e.status}
                </span>
                <span className="text-sm font-semibold text-text-primary">{fmtMoney(e.amount)}</span>
              </div>
            </li>
          ))}
          {upcoming.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-text-muted">
              No upcoming payouts
            </li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
