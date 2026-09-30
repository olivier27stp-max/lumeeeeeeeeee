import { Card, CardContent, CardHeader, CardTitle } from '../d2d/card';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import type { FsCommissionEntry } from '../../types';

interface Props {
  entries: FsCommissionEntry[];
  /** Limit number of rows rendered (default 5) */
  limit?: number;
  /** Fuseau de l'entreprise pour les dates. */
  timeZone?: string;
}

const statusStyles: Record<string, string> = {
  pending:  'bg-warning text-white',
  approved: 'bg-info text-white',
  paid:     'bg-success text-white',
};

import { fmtArgent, fmtDateCommission, libelleVente, libelleStatut, estEstimation } from './format';

/**
 * Upcoming payouts panel — shows entries that are not yet paid, sorted by
 * approval date (then created date). Designed to drop into either dashboard.
 */
export default function UpcomingPayouts({ entries, limit = 5, timeZone }: Props) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  // Une estimation (job pas encore payé) n'est pas un versement à venir.
  const upcoming = entries
    .filter((e) => (e.status === 'pending' || e.status === 'approved') && !estEstimation(e))
    .sort((a, b) => {
      const ax = a.approved_at ?? a.created_at;
      const bx = b.approved_at ?? b.created_at;
      return new Date(bx).getTime() - new Date(ax).getTime();
    })
    .slice(0, limit);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{fr ? 'Prochains versements' : 'Upcoming payouts'}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border-subtle">
          {upcoming.map((e) => (
            <li key={e.id} className="flex items-center justify-between px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text-primary">
                  {libelleVente(e, fr)}
                </p>
                <p className="text-xs text-text-muted">
                  {fr ? `Gagnée le ${fmtDateCommission(e.triggered_at || e.created_at, fr, timeZone, false)}` : `Earned ${fmtDateCommission(e.triggered_at || e.created_at, fr, timeZone, false)}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={cn(
                  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize',
                  statusStyles[e.status] ?? 'bg-surface-elevated text-text-muted'
                )}>
                  {libelleStatut(e, fr)}
                </span>
                <span className="text-sm font-semibold tabular-nums text-text-primary">{fmtArgent(e.amount, fr)}</span>
              </div>
            </li>
          ))}
          {upcoming.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-text-muted">
              {fr ? 'Aucun versement à venir' : 'No upcoming payouts'}
            </li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
