// Creator Space — espace interne plateforme, réservé aux comptes de
// platformAdminIds. La page se gate elle-même via GET /api/creator-space/check
// et redirige sinon ; le serveur re-vérifie de toute façon chaque requête.
// Hors navigation : on y accède par URL directe (/creator-space).

import React from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { checkCreatorAccess } from '../../lib/creatorSpaceApi';
import Overview from './Overview';
import Logs from './Logs';
import Engagement from './Engagement';
import Companies from './Companies';

const NAV_ITEMS = [
  { to: '/creator-space', label: 'Overview', end: true },
  { to: '/creator-space/logs', label: 'Logs', end: false },
  { to: '/creator-space/engagement', label: 'Company Engagement', end: false },
  { to: '/creator-space/companies', label: 'Companies', end: false },
];

export default function CreatorSpace() {
  const gate = useQuery({
    queryKey: ['creator-space', 'check'],
    queryFn: checkCreatorAccess,
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (gate.isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-text-tertiary">
        <Loader2 size={22} className="animate-spin" />
      </div>
    );
  }
  if (!gate.data) return <Navigate to="/" replace />;

  // La fine barre (Open New Tab / Refresh / Close) vit au niveau de l'app,
  // au-dessus du header principal — voir CreatorSpaceBar dans App.tsx.
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto">
        <div className="px-8 py-5">
          <PageNav />
          <Routes>
            <Route index element={<Overview />} />
            <Route path="logs" element={<Logs />} />
            <Route path="engagement" element={<Engagement />} />
            <Route path="companies" element={<Companies />} />
            <Route path="*" element={<Navigate to="/creator-space" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function PageNav() {
  return (
    <nav className="inline-flex rounded-md border border-outline overflow-hidden mb-5" aria-label="Creator Space">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              'px-4 py-1.5 text-[12.5px] font-medium transition-all border-r border-outline last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40',
              isActive ? 'bg-text-primary text-white' : 'bg-surface text-text-secondary hover:bg-surface-secondary',
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
