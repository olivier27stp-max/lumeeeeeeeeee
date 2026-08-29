// Creator Space — Company Engagement : niveau d'engagement par compagnie,
// calculé avec les formules plateforme existantes (dernière activité =
// logins/jobs, seuils 1/7/30 jours). Données réelles uniquement — les
// limites des signaux sont indiquées, jamais compensées par des valeurs
// fictives.

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';
import { cn } from '../../lib/utils';
import { getEngagement, type EngagementLevel } from '../../lib/creatorSpaceApi';
import { TableSkeleton } from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import { EngagementBadge, ErrorState, Paginator, fmtDate, relativeDays } from './shared';

const LEVELS: Array<{ id: '' | EngagementLevel; label: string }> = [
  { id: '', label: 'Toutes' },
  { id: 'high', label: 'Élevé' },
  { id: 'medium', label: 'Moyen' },
  { id: 'low', label: 'Faible' },
  { id: 'inactive', label: 'Inactif' },
];

export default function Engagement() {
  const [level, setLevel] = useState<'' | EngagementLevel>('');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['creator-space', 'engagement', level, page],
    queryFn: () => getEngagement({ level, page }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data?.data ?? [];
  const counts = query.data?.counts;

  return (
    <div>
      <h1 className="text-[22px] font-bold text-text-primary mb-1">Company Engagement</h1>
      <p className="text-[12.5px] text-text-tertiary mb-4">
        Dernière activité = connexions et jobs créés. Seules les connexions réussies sont captées.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {LEVELS.map((l) => {
          const count = counts ? (l.id === '' ? counts.all : counts[l.id]) : null;
          return (
            <button
              key={l.id || 'all'}
              type="button"
              onClick={() => {
                setLevel(l.id);
                setPage(1);
              }}
              className={cn(
                'h-8 px-3 rounded-md border text-[12.5px] font-medium transition-all',
                level === l.id
                  ? 'bg-text-primary text-white border-text-primary'
                  : 'bg-surface text-text-secondary border-outline hover:bg-surface-secondary',
              )}
            >
              {l.label}
              {count != null && <span className={cn('ml-1.5', level === l.id ? 'text-white/70' : 'text-text-tertiary')}>{count}</span>}
            </button>
          );
        })}
      </div>

      {query.isLoading ? (
        <TableSkeleton rows={8} cols={6} />
      ) : query.isError ? (
        <ErrorState message={(query.error as Error)?.message} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-outline bg-surface-card">
          <EmptyState
            icon={TrendingUp}
            title="Aucune compagnie dans ce niveau"
            description="Aucune compagnie ne correspond à ce niveau d’engagement pour le moment."
          />
        </div>
      ) : (
        <div className="rounded-lg border border-outline bg-surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-text-tertiary border-b border-outline">
                  <th className="px-4 py-2.5 font-semibold">Compagnie</th>
                  <th className="px-4 py-2.5 font-semibold">Engagement</th>
                  <th className="px-4 py-2.5 font-semibold">Dernière activité</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Membres</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Jobs (30 j)</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Connexions (30 j)</th>
                  <th className="px-4 py-2.5 font-semibold">Créée le</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="border-b border-outline last:border-b-0 hover:bg-surface-secondary/50">
                    <td className="px-4 py-2.5 font-medium text-text-primary truncate max-w-[240px]">{w.name}</td>
                    <td className="px-4 py-2.5">
                      <EngagementBadge level={w.engagement} />
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">{relativeDays(w.days_since_activity)}</td>
                    <td className="px-4 py-2.5 text-right text-text-secondary">{w.member_count}</td>
                    <td className="px-4 py-2.5 text-right text-text-secondary">{w.jobs_30d}</td>
                    <td className="px-4 py-2.5 text-right text-text-secondary">{w.logins_30d}</td>
                    <td className="px-4 py-2.5 text-text-tertiary whitespace-nowrap">{fmtDate(w.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginator page={page} total={query.data?.total ?? 0} pageSize={query.data?.page_size ?? 25} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
