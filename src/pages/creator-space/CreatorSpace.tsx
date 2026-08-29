// Creator Space — espace interne plateforme, réservé aux comptes de
// platformAdminIds. La page se gate elle-même via GET /api/creator-space/check
// et redirige sinon ; le serveur re-vérifie de toute façon chaque requête.
// Hors navigation : on y accède par URL directe (/creator-space).

import React from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useIsFetching, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, RotateCw, Sparkles, X } from 'lucide-react';
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

  return (
    <div className="flex flex-col h-full min-h-0">
      <TopBar />
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

/** Barre très mince, présente sur toutes les pages du Creator Space. */
function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const fetching = useIsFetching({ queryKey: ['creator-space'] }) > 0;

  const openNewTab = () => {
    window.open(location.pathname + location.search, '_blank', 'noopener');
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['creator-space'] });
  };

  // Ferme la vue interne ouverte (panneau compagnie), sinon revient à
  // l'écran principal ; ferme l'onglet seulement si le navigateur le permet.
  const close = () => {
    if (searchParams.has('org')) {
      const next = new URLSearchParams(searchParams);
      next.delete('org');
      setSearchParams(next, { replace: true });
      return;
    }
    if (location.pathname !== '/creator-space') {
      navigate('/creator-space');
      return;
    }
    if (window.opener && window.history.length <= 1) {
      window.close();
      return;
    }
    navigate('/');
  };

  const btn =
    'inline-flex items-center gap-1.5 h-6 px-2 rounded text-[11.5px] font-medium text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40';

  return (
    <div className="shrink-0 h-8 flex items-center gap-2 px-4 border-b border-outline bg-surface-elevated">
      <Sparkles size={13} className="text-text-tertiary" />
      <span className="text-[11.5px] font-semibold text-text-secondary tracking-wide">Creator Space</span>
      <span className="text-[10.5px] text-text-tertiary border border-outline rounded-full px-1.5 leading-[16px]">Console interne</span>
      <div className="flex-1" />
      <button type="button" onClick={openNewTab} className={btn} title="Ouvrir cette page dans un nouvel onglet">
        <ExternalLink size={12} /> Open New Tab
      </button>
      <button type="button" onClick={refresh} className={btn} title="Actualiser les données" disabled={fetching}>
        <RotateCw size={12} className={cn(fetching && 'animate-spin')} /> Refresh
      </button>
      <button type="button" onClick={close} className={btn} title="Fermer la vue actuelle">
        <X size={12} /> Close
      </button>
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
