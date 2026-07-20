import React from 'react';
import { cn } from '../../lib/utils';
import type { ScheduleEventRecord } from '../../lib/scheduleApi';
import { shortAddress } from './dailyGeometry';

/**
 * Carte de visite de la vue Jour : fond blanc (jeton `bg-surface`), bordure
 * pâle, rayon discret, ombre très légère, sidebar verticale colorée (palette
 * des presets de devis) collée au bord gauche — la couleur ne remplit jamais
 * la carte. Le contenu se dégrade proprement sur les cartes étroites
 * (ellipsis, lignes retirées, tooltip natif complet).
 */
export interface DailyVisitCardProps {
  ev: ScheduleEventRecord;
  color: string;
  left: number;
  top: number;
  width: number;
  height: number;
  timeLabel: string;
  dimmed: boolean;
  onOpen: () => void;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
}

export default function DailyVisitCard({
  ev, color, left, top, width, height, timeLabel, dimmed, onOpen, onMoveStart, onResizeStart,
}: DailyVisitCardProps) {
  const clientName = ev.job?.client_name || ev.job?.title || 'Job';
  const city = shortAddress(ev.job?.property_address);
  const jobNumber = ev.job?.job_number ? `#${ev.job.job_number}` : null;
  const tooltip = [timeLabel, clientName, city, jobNumber].filter(Boolean).join(' · ');

  return (
    <div
      role="button"
      tabIndex={0}
      title={tooltip}
      className={cn(
        'group/daily-card absolute select-none overflow-hidden rounded-lg border border-border bg-surface text-left',
        'transition-shadow',
        dimmed
          ? 'opacity-40 shadow-none'
          : 'shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:z-10 hover:shadow-md cursor-grab active:cursor-grabbing',
      )}
      style={{ left, top, width, height }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).dataset.resize) return;
        onMoveStart(e);
      }}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[5px]" style={{ backgroundColor: color }} />
      <div className="flex h-full min-w-0 flex-col justify-center py-1 pl-3 pr-2">
        {width >= 96 && (
          <div className="truncate text-[10px] font-medium tabular-nums leading-[1.4] text-text-tertiary">{timeLabel}</div>
        )}
        <div className="truncate text-[12.5px] font-semibold leading-[1.35] text-text-primary">{clientName}</div>
        {width >= 132 && city && (
          <div className="truncate text-[11px] leading-[1.4] text-text-secondary">{city}</div>
        )}
        {width >= 96 && jobNumber && (
          <div className="truncate text-[10px] font-medium tabular-nums leading-[1.4] text-text-tertiary">{jobNumber}</div>
        )}
      </div>
      {/* Poignée de redimensionnement (bord droit → durée) */}
      <span
        data-resize="true"
        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize opacity-0 transition-opacity group-hover/daily-card:opacity-100"
        style={{ backgroundColor: `${color}55` }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          onResizeStart(e);
        }}
      />
    </div>
  );
}
