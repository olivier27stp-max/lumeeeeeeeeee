/**
 * HomeMapBackground — full-bleed, non-interactive job map used as the
 * background layer of the Home page (CrmWorkspace). Same visual style as the
 * Sales Map (CRMMap + job pins), but bare (no card chrome) and inert so it
 * never traps scroll/clicks: the page content scrolls on top of it and the map
 * is revealed in the empty space below the cards.
 *
 * Self-contained + easy to remove: delete this file and the background block
 * in CrmWorkspace.tsx to fully revert.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMapJobs, type MapJobResult } from '../../lib/mapApi';
import CRMMap from './CRMMap';

const EMPTY_RESULT: MapJobResult = { pins: [], totalEvents: 0, missingLocationCount: 0 };

export default function HomeMapBackground() {
  const { data = EMPTY_RESULT } = useQuery({
    queryKey: ['mapJobs', 'this_week'],
    queryFn: () => fetchMapJobs('this_week'),
    staleTime: 60_000,
  });

  return (
    <CRMMap
      pins={data.pins}
      heightClassName="h-full"
      bare
      interactive={false}
      showJobCount={false}
    />
  );
}
