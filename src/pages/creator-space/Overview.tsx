// Creator Space — Overview : compteurs plateforme + activité récente.
// Uniquement des statistiques dérivées de données réelles (aucune valeur
// fabriquée) ; les sections sans données affichent un état vide clair.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Building2 } from 'lucide-react';
import { getOverview } from '../../lib/creatorSpaceApi';
import { CardSkeleton, TableSkeleton } from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import { ErrorState, MaskedActor, StatTile, fmtDateTime } from './shared';

export default function Overview() {
  const query = useQuery({
    queryKey: ['creator-space', 'overview'],
    queryFn: getOverview,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  if (query.isLoading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <TableSkeleton rows={5} cols={3} />
      </div>
    );
  }
  if (query.isError) return <ErrorState message={(query.error as Error)?.message} onRetry={() => query.refetch()} />;

  const data = query.data!;
  const t = data.totals;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-bold text-text-primary mb-3">Overview</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Compagnies" value={t.companies} />
          <StatTile label="Utilisateurs" value={t.users} />
          <StatTile label="Actives (7 j)" value={t.active_companies_7d} hint={`${t.active_companies_30d} sur 30 j`} />
          <StatTile label="Inactives (30 j+)" value={t.inactive_companies_30d} />
          <StatTile label="Nouvelles (30 j)" value={t.new_companies_30d} />
          <StatTile label="Abonnements actifs" value={t.subscriptions_active} hint="actifs + essais" />
          <StatTile label="Abonnements impayés" value={t.subscriptions_past_due} />
          <StatTile label="État plateforme" value={t.subscriptions_past_due > 0 ? 'Attention' : 'Sain'} hint="basé sur la facturation" />
        </div>
      </div>

      <div className="rounded-lg border border-outline bg-surface-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-outline">
          <Activity size={15} className="text-text-tertiary" />
          <h2 className="text-[13.5px] font-semibold text-text-primary">Activité récente</h2>
          <span className="text-[11.5px] text-text-tertiary">journal d’audit, toutes compagnies</span>
        </div>
        {data.recent_events.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Aucun événement récent"
            description="Les événements du journal d’audit apparaîtront ici dès qu’il y en aura."
          />
        ) : (
          <ul>
            {data.recent_events.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-outline last:border-b-0 text-[13px]">
                <span className="font-medium text-text-primary truncate max-w-[220px]">{e.org_name ?? 'Compagnie inconnue'}</span>
                <span className="text-text-secondary truncate">{e.action ?? e.entity_type ?? '—'}</span>
                {e.actor_id && (
                  <span className="text-text-tertiary truncate">
                    par <MaskedActor userId={e.actor_id} />
                  </span>
                )}
                <span className="ml-auto shrink-0 text-[12px] text-text-tertiary">{fmtDateTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
