// Creator Space — Companies : liste des compagnies + recherche (nom,
// identifiant, propriétaire, courriel) + panneau de détails à droite
// (?org=<uuid> dans l'URL, ce qui permet « Open New Tab » avec contexte).

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Building2, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { listCompanies } from '../../lib/creatorSpaceApi';
import { TableSkeleton } from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import { ErrorState, Paginator, SubStatusBadge, fmtDate, useDebounced } from './shared';
import CompanyPanel from './CompanyPanel';

export default function Companies() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const debouncedQ = useDebounced(q);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedOrg = searchParams.get('org');

  const query = useQuery({
    queryKey: ['creator-space', 'companies', debouncedQ, page],
    queryFn: () => listCompanies({ q: debouncedQ || undefined, page }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data?.data ?? [];

  const select = (orgId: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (orgId) next.set('org', orgId);
    else next.delete('org');
    setSearchParams(next, { replace: !orgId });
  };

  return (
    <div className="flex items-start gap-5">
      <div className="flex-1 min-w-0">
        <h1 className="text-[22px] font-bold text-text-primary mb-3">Companies</h1>

        <div className="relative mb-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Rechercher par nom, identifiant, propriétaire ou courriel…"
            aria-label="Rechercher une compagnie"
            className="h-9 w-full max-w-md pl-9 pr-3 rounded-md border border-outline bg-surface text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        {query.isLoading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : query.isError ? (
          <ErrorState message={(query.error as Error)?.message} onRetry={() => query.refetch()} />
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-outline bg-surface-card">
            <EmptyState
              icon={Building2}
              title={debouncedQ ? 'Aucun résultat' : 'Aucune compagnie'}
              description={
                debouncedQ
                  ? 'Aucune compagnie ne correspond à cette recherche. Vérifiez l’orthographe ou essayez un identifiant.'
                  : 'Les compagnies enregistrées sur la plateforme apparaîtront ici.'
              }
            />
          </div>
        ) : (
          <div className="rounded-lg border border-outline bg-surface-card overflow-hidden">
            <div className="overflow-x-auto">
            <div className="min-w-[640px]">
            <div className="grid grid-cols-[minmax(180px,2fr)_minmax(120px,1.5fr)_90px_110px_90px] gap-3 px-4 py-2.5 border-b border-outline text-[11px] uppercase tracking-wide text-text-tertiary font-semibold">
              <span>Compagnie</span>
              <span>Propriétaire</span>
              <span className="text-right">Membres</span>
              <span>Forfait</span>
              <span>Créée le</span>
            </div>
            <ul>
              {rows.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => select(c.id)}
                    className={cn(
                      'w-full grid grid-cols-[minmax(180px,2fr)_minmax(120px,1.5fr)_90px_110px_90px] gap-3 items-center px-4 py-3 text-left text-[13px] border-b border-outline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40',
                      selectedOrg === c.id ? 'bg-surface-secondary' : 'hover:bg-surface-secondary/50',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-text-primary truncate">{c.name}</span>
                      <span className="block text-[11px] text-text-tertiary font-mono truncate">{c.id}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-text-secondary truncate">{c.owner_name ?? '—'}</span>
                      {c.contact_email && <span className="block text-[11.5px] text-text-tertiary truncate">{c.contact_email}</span>}
                    </span>
                    <span className="text-right text-text-secondary">{c.member_count}</span>
                    <span className="min-w-0">
                      <SubStatusBadge status={c.subscription_status} />
                      {c.plan_name && <span className="block text-[11px] text-text-tertiary truncate mt-0.5">{c.plan_name}</span>}
                    </span>
                    <span className="text-text-tertiary whitespace-nowrap text-[12.5px]">{fmtDate(c.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
            </div>
            </div>
            <Paginator page={page} total={query.data?.total ?? 0} pageSize={query.data?.page_size ?? 25} onPage={setPage} />
          </div>
        )}
      </div>

      {selectedOrg && <CompanyPanel orgId={selectedOrg} onClose={() => select(null)} />}
    </div>
  );
}
