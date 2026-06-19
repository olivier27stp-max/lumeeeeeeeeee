/**
 * HomeMapBackground — full-bleed, NON-interactive job map used as the
 * background layer of the Home page (CrmWorkspace). This is the exact same map
 * as the Calendar map (CalendarMapGL: Mapbox satellite + gold teardrop pins),
 * rendered edge-to-edge and showing TODAY's jobs only. Inert so it never traps
 * scroll/clicks — the page content scrolls freely on top of it.
 *
 * Self-contained + easy to remove: delete this file and the background block
 * in CrmWorkspace.tsx to fully revert.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchMapJobs, type MapJobResult } from '../../lib/mapApi';
import { useTranslation } from '../../i18n';
import CalendarMapGL from './CalendarMapGL';

const EMPTY_RESULT: MapJobResult = { pins: [], totalEvents: 0, missingLocationCount: 0 };

export default function HomeMapBackground() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Today's jobs only — same data source as the Calendar map.
  const { data = EMPTY_RESULT } = useQuery({
    queryKey: ['mapJobs', 'today'],
    queryFn: () => fetchMapJobs('today'),
    staleTime: 60_000,
  });

  return (
    <CalendarMapGL
      pins={data.pins}
      heightClassName="h-full"
      bare
      interactive={false}
      openJobLabel={t.schedule.mapOpenJob}
      onOpenJob={(id) => navigate(`/jobs/${id}`)}
    />
  );
}
