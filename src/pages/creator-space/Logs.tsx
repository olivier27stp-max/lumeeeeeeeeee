// Creator Space — Logs : consultation des journaux existants (audit,
// activité, sécurité). Réutilise les tables audit_events / activity_log /
// security_events — aucun nouveau système de logs. Jamais d'IP, de
// user-agent ni de données sensibles dans les payloads.

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { getLogs, type LogSource } from '../../lib/creatorSpaceApi';
import { TableSkeleton } from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import { ErrorState, MaskedActor, Paginator, fmtDateTime, useDebounced } from './shared';

const SOURCES: Array<{ id: LogSource; label: string }> = [
  { id: 'audit', label: 'Audit' },
  { id: 'activity', label: 'Activité' },
  { id: 'security', label: 'Sécurité' },
];

export default function Logs() {
  const [source, setSource] = useState<LogSource>('audit');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const debouncedQ = useDebounced(q);

  const query = useQuery({
    queryKey: ['creator-space', 'logs', source, debouncedQ, page],
    queryFn: () => getLogs({ source, q: debouncedQ || undefined, page }),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data?.data ?? [];

  return (
    <div>
      <h1 className="text-[22px] font-bold text-text-primary mb-3">Logs</h1>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="inline-flex rounded-md border border-outline overflow-hidden">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSource(s.id);
                setPage(1);
              }}
              className={cn(
                'px-3.5 py-1.5 text-[12.5px] font-medium transition-all border-r border-outline last:border-r-0',
                source === s.id ? 'bg-text-primary text-white' : 'bg-surface text-text-secondary hover:bg-surface-secondary',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Filtrer par type d’événement…"
            aria-label="Rechercher dans les journaux"
            className="h-8 w-64 pl-8 pr-3 rounded-md border border-outline bg-surface text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>
      </div>

      {query.isLoading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : query.isError ? (
        <ErrorState message={(query.error as Error)?.message} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-outline bg-surface-card">
          <EmptyState
            icon={FileText}
            title={debouncedQ ? 'Aucun événement trouvé' : 'Aucun événement'}
            description={
              debouncedQ
                ? 'Aucun événement ne correspond à cette recherche. Essayez un autre terme.'
                : 'Les événements de ce journal apparaîtront ici dès qu’il y en aura.'
            }
          />
        </div>
      ) : (
        <div className="rounded-lg border border-outline bg-surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-text-tertiary border-b border-outline">
                  <th className="px-4 py-2.5 font-semibold">Date</th>
                  <th className="px-4 py-2.5 font-semibold">Événement</th>
                  <th className="px-4 py-2.5 font-semibold">Compagnie</th>
                  <th className="px-4 py-2.5 font-semibold">Utilisateur</th>
                  <th className="px-4 py-2.5 font-semibold">Détails</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-outline last:border-b-0 hover:bg-surface-secondary/50">
                    <td className="px-4 py-2.5 whitespace-nowrap text-text-tertiary">{fmtDateTime(r.created_at)}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-text-primary">{r.action ?? r.event_type ?? '—'}</span>
                      {r.severity && (
                        <span
                          className={cn(
                            'ml-2 inline-flex px-1.5 rounded-full border text-[10.5px] font-semibold leading-[18px]',
                            r.severity === 'critical' || r.severity === 'high'
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : r.severity === 'medium'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-surface-secondary text-text-tertiary border-outline',
                          )}
                        >
                          {r.severity}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary truncate max-w-[200px]">{r.org_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">
                      <MaskedActor userId={r.actor_id} />
                    </td>
                    <td className="px-4 py-2.5 text-text-tertiary truncate max-w-[260px]">
                      {r.entity_type ? `${r.entity_type}` : ''}
                      {r.resolved != null && (r.resolved ? ' · résolu' : ' · non résolu')}
                      {r.metadata && Object.keys(r.metadata).length > 0 && (
                        <span title={JSON.stringify(r.metadata, null, 2)}> · {Object.keys(r.metadata).length} champ(s)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginator page={page} total={query.data?.total ?? 0} pageSize={query.data?.page_size ?? 30} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
