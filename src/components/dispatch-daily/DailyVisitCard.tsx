import React from 'react';
import { cn } from '../../lib/utils';
import type { ScheduleEventRecord } from '../../lib/scheduleApi';
import { toRgba } from '../../lib/colorUtils';
import { shortAddress } from './dailyGeometry';

/**
 * Carte de visite de la vue Jour : fond blanc (jeton `bg-surface`), bordure
 * pâle, rayon discret, ombre très légère. Si la job porte un tag, la carte
 * est teintée de la couleur (vive) du premier tag — fond pâle + barre
 * gauche pleine; sinon elle reste entièrement blanche. Le contenu se dégrade
 * proprement sur les cartes étroites (ellipsis, lignes retirées, tooltip
 * natif complet).
 */
export interface DailyVisitCardProps {
  ev: ScheduleEventRecord;
  left: number;
  top: number;
  width: number;
  height: number;
  timeLabel: string;
  dimmed: boolean;
  /** Couleur du premier tag de la job — null si aucun tag. */
  tagColor?: string | null;
  onOpen: () => void;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
}

export default function DailyVisitCard({
  ev, left, top, width, height, timeLabel, dimmed, tagColor, onOpen, onMoveStart, onResizeStart,
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
      style={{
        left, top, width, height,
        // La carte flotte au-dessus des lignes d'heures : la teinte du tag est
        // superposée au fond opaque plutôt qu'en backgroundColor translucide.
        ...(tagColor ? {
          backgroundImage: `linear-gradient(${toRgba(tagColor, 0.12)}, ${toRgba(tagColor, 0.12)})`,
          borderLeft: `3px solid ${tagColor}`,
        } : {}),
      }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).dataset.resize) return;
        onMoveStart(e);
      }}
    >
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
        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-border/70 opacity-0 transition-opacity group-hover/daily-card:opacity-100"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          onResizeStart(e);
        }}
      />
    </div>
  );
}
