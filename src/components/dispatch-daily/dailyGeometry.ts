/**
 * Géométrie pure de la vue Jour du calendrier Dispatch (timeline horizontale).
 * Aucun rendu ici : uniquement des conversions temps ↔ pixels, l'assignation
 * des couloirs de chevauchement et la plage horaire visible. Tout le
 * positionnement des cartes dérive de ces fonctions — jamais de valeurs
 * arbitraires par carte.
 */
import type { ScheduleEventRecord } from '../../lib/scheduleApi';

export const HOUR_WIDTH_PX = 128;
export const PX_PER_MINUTE = HOUR_WIDTH_PX / 60;
export const SNAP_MINUTES = 15;
export const RESOURCE_COL_PX = 184;
export const HEADER_HEIGHT_PX = 40;
export const CARD_HEIGHT_PX = 72;
export const LANE_GAP_PX = 6;
export const ROW_PAD_Y_PX = 10;
export const CARD_GAP_X_PX = 2;
export const DEFAULT_DAY_START_HOUR = 7;
export const DEFAULT_DAY_END_HOUR = 19;
export const DRAG_THRESHOLD_PX = 4;
export const EXTERNAL_DROP_DURATION_MIN = 120;

export const minutesToX = (minutes: number, rangeStartMin: number): number =>
  (minutes - rangeStartMin) * PX_PER_MINUTE;

export const xToMinutes = (x: number, rangeStartMin: number): number =>
  rangeStartMin + x / PX_PER_MINUTE;

export const snapMinutes = (m: number, grid = SNAP_MINUTES): number =>
  Math.round(m / grid) * grid;

/**
 * Minutes de début/fin d'une visite dans la journée affichée.
 * Cas particuliers gérés : fin absente ou invalide (durée d'une heure par
 * défaut), visite très courte (largeur minimale de 15 min pour rester
 * cliquable), visite qui déborde après minuit (tronquée à 24 h).
 */
export function eventMinutes(ev: Pick<ScheduleEventRecord, 'start_at' | 'end_at'>): {
  startMin: number;
  endMin: number;
} {
  const s = new Date(ev.start_at);
  const e = new Date(ev.end_at);
  const startMin = s.getHours() * 60 + s.getMinutes();
  let dur = (e.getTime() - s.getTime()) / 60000;
  if (!Number.isFinite(dur) || dur <= 0) dur = 60;
  dur = Math.max(dur, 15);
  return { startMin, endMin: Math.min(startMin + dur, 24 * 60) };
}

export interface DayRange {
  startMin: number;
  endMin: number;
  hours: number[];
}

/**
 * Plage visible : 07 h – 19 h par défaut, étendue automatiquement pour
 * englober toutes les visites du jour (aucune visite hors plage n'est
 * silencieusement masquée).
 */
export function computeDayRange(events: ScheduleEventRecord[]): DayRange {
  let startHour = DEFAULT_DAY_START_HOUR;
  let endHour = DEFAULT_DAY_END_HOUR;
  for (const ev of events) {
    const { startMin, endMin } = eventMinutes(ev);
    startHour = Math.min(startHour, Math.floor(startMin / 60));
    endHour = Math.max(endHour, Math.ceil(endMin / 60));
  }
  startHour = Math.max(0, startHour);
  endHour = Math.min(24, Math.max(endHour, startHour + 1));
  const hours: number[] = [];
  for (let h = startHour; h < endHour; h++) hours.push(h);
  return { startMin: startHour * 60, endMin: endHour * 60, hours };
}

export interface PositionedEvent {
  ev: ScheduleEventRecord;
  startMin: number;
  endMin: number;
  lane: number;
}

/**
 * Chevauchements : assignation gloutonne de couloirs (sous-lignes empilées
 * verticalement dans la ligne de la ressource). Aucune carte n'en masque une
 * autre — la hauteur de la ligne grandit avec le nombre de couloirs.
 */
export function assignLanes(events: ScheduleEventRecord[]): {
  positioned: PositionedEvent[];
  laneCount: number;
} {
  const sorted = [...events].sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  );
  const laneEnds: number[] = [];
  const positioned = sorted.map((ev) => {
    const { startMin, endMin } = eventMinutes(ev);
    let lane = laneEnds.findIndex((end) => end <= startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endMin);
    } else {
      laneEnds[lane] = endMin;
    }
    return { ev, startMin, endMin, lane };
  });
  return { positioned, laneCount: Math.max(1, laneEnds.length) };
}

export function rowHeightForLanes(laneCount: number): number {
  return ROW_PAD_Y_PX * 2 + laneCount * CARD_HEIGHT_PX + (laneCount - 1) * LANE_GAP_PX;
}

export function laneTop(lane: number): number {
  return ROW_PAD_Y_PX + lane * (CARD_HEIGHT_PX + LANE_GAP_PX);
}

/** « 123 Rue King, Sherbrooke, QC J1H 1A1 » → « Sherbrooke, QC » */
export function shortAddress(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const parts = addr
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && !/^(canada|usa|united states)$/i.test(p));
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  const city = parts[1];
  const region = (parts[2] || '').replace(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i, '').trim();
  return region ? `${city}, ${region}` : city;
}
