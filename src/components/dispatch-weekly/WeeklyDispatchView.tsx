import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { format, isSameDay } from 'date-fns';
import { frCA, enCA } from 'date-fns/locale';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import { isAnytimeVisit, anytimeLabel, type ScheduleEventRecord } from '../../lib/scheduleApi';
import type { TeamRecord } from '../../lib/teamsApi';
import type { useCalendarDnd } from '../../hooks/useCalendarDnd';
import { useJobTagColors } from '../../hooks/useJobTagColors';
import { FALLBACK_TEAM_COLOR, isHexColor, toRgba } from '../../lib/colorUtils';
import {
  DispatchDailyPrefs, loadDispatchDailyPrefs, saveDispatchDailyPrefs, vehicleNumberForTeam,
} from '../../lib/dispatchDailyPrefs';
import DailyCustomizePopover from '../dispatch-daily/DailyCustomizePopover';
import {
  CARD_HEIGHT_PX, DRAG_THRESHOLD_PX, HEADER_HEIGHT_PX, RESOURCE_COL_PX, ROW_PAD_Y_PX,
} from '../dispatch-daily/dailyGeometry';

/**
 * Vue Semaine du calendrier Dispatch — planche de dispatch hebdomadaire.
 * Même langage visuel que la vue Jour (DailyDispatchView) : mêmes jetons,
 * mêmes bordures, mêmes ombres, même colonne ressource à gauche. Seule
 * différence structurelle : X = les 7 jours de la semaine, Y = les routes
 * (équipes). Les cartes de visite s'empilent verticalement dans chaque
 * cellule — jamais de chevauchement.
 * Couleurs : la couleur de route existante (team.color_hex) — fond pastel +
 * barre gauche de la carte; si la job porte un tag, la couleur vive du
 * premier tag remplace celle de la route. Jamais de couleur par statut.
 */

type CalendarDnd = ReturnType<typeof useCalendarDnd>;

interface WeeklyRow {
  key: string;
  teamId: string | null;
  team: TeamRecord | null;
  /** Ligne d'exemple affichée quand aucune équipe ni visite n'existe (1-based). */
  placeholderIndex?: number;
}

/** Nombre de lignes d'exemple quand la semaine est entièrement vide. */
const PLACEHOLDER_ROW_COUNT = 5;
const UNASSIGNED_KEY = '__unassigned__';
/** Largeur minimale d'une colonne jour — la grille défile horizontalement au besoin. */
const DAY_COL_MIN_PX = 172;
/** Hauteur minimale d'une ligne route (mêmes constantes que la vue Jour). */
const ROW_MIN_HEIGHT_PX = ROW_PAD_Y_PX * 2 + CARD_HEIGHT_PX;
/** Heure de début par défaut (clic sur cellule vide + drop du tiroir). */
const DEFAULT_SLOT_HOUR = 9;

interface WeeklyDispatchViewProps {
  /** Les 7 jours de la semaine affichée (lundi → dimanche). */
  weekDays: Date[];
  events: ScheduleEventRecord[];
  teams: TeamRecord[];
  /** Équipes sélectionnées dans le filtre ([] = toutes). */
  visibleTeamIds: string[];
  orgId: string | null;
  unassignedMode: boolean;
  isError?: boolean;
  onEventClick: (jobId: string) => void;
  onSlotClick: (start: Date) => void;
  onReschedule: (eventId: string, startAt: string, endAt: string, teamId: string | null) => Promise<void>;
  /** Instance DnD partagée — utilisée seulement pour les drops du tiroir « Jobs non planifiés ». */
  externalDnd: CalendarDnd;
}

interface CellRef {
  rowKey: string;
  dayKey: string;
}

interface WeeklyDrag {
  ev: ScheduleEventRecord;
  originRowKey: string;
  originDayKey: string;
  hasTeam: boolean;
  startClientX: number;
  startClientY: number;
  moved: boolean;
  target: CellRef | null;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const eventDurationMs = (ev: ScheduleEventRecord): number => {
  const ms = new Date(ev.end_at).getTime() - new Date(ev.start_at).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : 60 * 60000;
};

/** Cellule (ligne route × jour) sous le pointeur, via les data-attributes. */
function cellFromPoint(x: number, y: number): CellRef | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const cell = el?.closest?.('[data-week-cell]') as HTMLElement | null;
  if (!cell || !cell.dataset.rowKey || !cell.dataset.dayKey) return null;
  return { rowKey: cell.dataset.rowKey, dayKey: cell.dataset.dayKey };
}

const sameCell = (a: CellRef | null, b: CellRef | null) =>
  a?.rowKey === b?.rowKey && a?.dayKey === b?.dayKey;

/* ── Carte de visite (empilée dans une cellule jour) ──
   Même gabarit que DailyVisitCard : rayon, bordure, ombre, typographie —
   avec le fond pastel de la couleur de route + barre gauche pleine. */
const WeekVisitCard = React.memo(function WeekVisitCard({
  ev, color, tagName, timeLabel, attention, dimmed, onOpen, onMoveStart,
}: {
  ev: ScheduleEventRecord;
  color: string;
  /** Nom du premier tag de la job — affiché en haut de la carte dans `color`. */
  tagName?: string | null;
  timeLabel: string;
  attention: boolean;
  dimmed: boolean;
  onOpen: () => void;
  onMoveStart: (e: React.PointerEvent) => void;
}) {
  const clientName = ev.job?.client_name || ev.job?.title || 'Job';
  const address = (ev.job?.property_address || '').trim() || null;
  const tooltip = [tagName, timeLabel, clientName, address].filter(Boolean).join(' · ');
  return (
    <div
      role="button"
      tabIndex={0}
      title={tooltip}
      className={cn(
        'flex w-full select-none flex-col justify-center overflow-hidden rounded-lg border border-border py-1 pl-3 pr-2 text-left',
        'transition-shadow',
        dimmed
          ? 'opacity-40 shadow-none'
          : 'shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:z-10 hover:shadow-md cursor-grab active:cursor-grabbing',
      )}
      style={{ minHeight: CARD_HEIGHT_PX, backgroundColor: toRgba(color, 0.12), borderLeft: `3px solid ${color}` }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      onPointerDown={(e) => { if (e.button === 0) onMoveStart(e); }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {tagName && (
          <span className="truncate text-[10px] font-bold leading-[1.4]" style={{ color }}>{tagName}</span>
        )}
        <span className="shrink-0 truncate text-[10px] font-medium tabular-nums leading-[1.4] text-text-tertiary">{timeLabel}</span>
        {attention && <AlertTriangle size={9} className="shrink-0 text-[#c2410c]" />}
      </div>
      <div className="truncate text-[12.5px] font-semibold leading-[1.35] text-text-primary">{clientName}</div>
      {address && <div className="truncate text-[11px] leading-[1.4] text-text-secondary">{address}</div>}
    </div>
  );
});

/* ── Fantôme de drop (déplacement de carte / job du tiroir) ── */
function CellDropGhost({ label }: { label: string }) {
  return (
    <div
      className="pointer-events-none flex w-full flex-col justify-center overflow-hidden rounded-lg border-2 border-dashed border-primary/60 bg-primary/10 px-2 py-1"
      style={{ minHeight: CARD_HEIGHT_PX }}
    >
      <span className="truncate text-[11px] font-semibold text-primary">{label}</span>
    </div>
  );
}

export default function WeeklyDispatchView({
  weekDays, events, teams, visibleTeamIds, orgId, unassignedMode, isError,
  onEventClick, onSlotClick, onReschedule, externalDnd,
}: WeeklyDispatchViewProps) {
  const { t, language } = useTranslation();
  const isFr = language === 'fr';
  const locale = isFr ? frCA : enCA;
  const { firstTagFor } = useJobTagColors();

  /* ── Préférences colonne de gauche — partagées avec la vue Jour ── */
  const [prefs, setPrefs] = useState<DispatchDailyPrefs>(() => loadDispatchDailyPrefs(orgId));
  useEffect(() => { setPrefs(loadDispatchDailyPrefs(orgId)); }, [orgId]);
  const updatePrefs = useCallback((p: DispatchDailyPrefs) => {
    setPrefs(p);
    saveDispatchDailyPrefs(orgId, p);
  }, [orgId]);

  /* ── Mises à jour optimistes locales (déplacement de cartes) ── */
  const [optimistic, setOptimistic] = useState<Map<string, Partial<ScheduleEventRecord>>>(new Map());
  const applyOpt = useCallback((id: string, patch: Partial<ScheduleEventRecord>) => {
    setOptimistic((prev) => new Map(prev).set(id, patch));
  }, []);
  const clearOpt = useCallback((id: string) => {
    setOptimistic((prev) => { const m = new Map(prev); m.delete(id); return m; });
  }, []);
  const effEvents = useMemo(
    () => (optimistic.size ? events.map((e) => (optimistic.has(e.id) ? { ...e, ...optimistic.get(e.id)! } : e)) : events),
    [events, optimistic],
  );

  /* ── Jours de la semaine ── */
  const dayKeys = useMemo(() => weekDays.map((d) => format(d, 'yyyy-MM-dd')), [weekDays]);
  const dayByKey = useMemo(() => new Map(weekDays.map((d, i) => [dayKeys[i], d])), [weekDays, dayKeys]);

  /* ── Lignes (routes) — même logique que la vue Jour ── */
  const activeTeams = useMemo(() => teams.filter((tm) => tm.is_active !== false), [teams]);
  const rowTeams = useMemo(
    () => (visibleTeamIds.length ? activeTeams.filter((tm) => visibleTeamIds.includes(tm.id)) : activeTeams),
    [activeTeams, visibleTeamIds],
  );

  const { rows, cellMap } = useMemo(() => {
    const teamIdSet = new Set(rowTeams.map((tm) => tm.id));
    // Dédup par id : le filtre serveur peut renvoyer un même event deux fois.
    const seen = new Set<string>();
    const cells = new Map<string, ScheduleEventRecord[]>();
    let hasUnassigned = false;
    for (const ev of effEvents) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      // Comparer sur la date LOCALE de l'event (start_at est en UTC).
      const dayKey = format(new Date(ev.start_at), 'yyyy-MM-dd');
      if (!dayByKey.has(dayKey)) continue;
      const tid = ev.team_id || ev.job?.team_id || null;
      // Sans équipe, équipe désactivée ou hors filtre : jamais masquée
      // silencieusement — regroupée dans la ligne « Non assigné ».
      const rowKey = tid && teamIdSet.has(tid) ? tid : UNASSIGNED_KEY;
      if (rowKey === UNASSIGNED_KEY) hasUnassigned = true;
      const key = `${rowKey}|${dayKey}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push(ev);
    }
    for (const list of cells.values()) {
      list.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    }
    const list: WeeklyRow[] = unassignedMode
      ? []
      : rowTeams.map((tm) => ({ key: tm.id, teamId: tm.id, team: tm }));
    if (unassignedMode || hasUnassigned) {
      list.push({ key: UNASSIGNED_KEY, teamId: null, team: null });
    }
    // Semaine entièrement vide : la grille reste complètement dessinée,
    // avec des lignes d'exemple à gauche — même structure que la vue Jour.
    if (list.length === 0) {
      for (let i = 1; i <= PLACEHOLDER_ROW_COUNT; i++) {
        list.push({ key: `__placeholder-${i}__`, teamId: null, team: null, placeholderIndex: i });
      }
    }
    return { rows: list, cellMap: cells };
  }, [effEvents, rowTeams, unassignedMode, dayByKey]);

  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);

  /* ── Formats horaires — identiques à la vue Jour ── */
  const fmtTime = useCallback((d: Date) => {
    const h = d.getHours();
    const m = d.getMinutes();
    if (isFr) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }, [isFr]);
  const timeLabelFor = useCallback(
    (ev: ScheduleEventRecord) => (isAnytimeVisit(ev.start_at, ev.end_at)
      ? anytimeLabel(isFr)
      : `${fmtTime(new Date(ev.start_at))} – ${fmtTime(new Date(new Date(ev.start_at).getTime() + eventDurationMs(ev)))}`),
    [fmtTime, isFr],
  );

  /* ── Drag local : déplacer une carte vers un autre jour / une autre route ── */
  const dragRef = useRef<WeeklyDrag | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const suppressClickRef = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const finishDrag = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    bump();
    if (!d || !d.moved) return;
    // Le pointerup précède le click : on libère le flag juste après.
    setTimeout(() => { suppressClickRef.current = false; }, 0);
    const target = d.target;
    if (!target) return;
    const targetRow = rowByKey.get(target.rowKey);
    const day = dayByKey.get(target.dayKey);
    if (!day) return;
    const originTeam = d.ev.team_id || d.ev.job?.team_id || null;
    const targetTeam = targetRow && !targetRow.placeholderIndex ? targetRow.teamId : originTeam;
    if (target.dayKey === d.originDayKey && targetTeam === originTeam) return;
    // La carte garde son heure : seuls le jour et la route changent.
    const s = new Date(d.ev.start_at);
    const newStart = new Date(day);
    newStart.setHours(s.getHours(), s.getMinutes(), 0, 0);
    const newEnd = new Date(newStart.getTime() + eventDurationMs(d.ev));
    applyOpt(d.ev.id, { start_at: newStart.toISOString(), end_at: newEnd.toISOString(), team_id: targetTeam });
    onReschedule(d.ev.id, newStart.toISOString(), newEnd.toISOString(), targetTeam)
      .catch(() => {})
      .finally(() => clearOpt(d.ev.id));
  }, [applyOpt, clearOpt, dayByKey, onReschedule, rowByKey]);

  const handleMoveStart = useCallback((ev: ScheduleEventRecord, rowKey: string, dayKey: string, e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = {
      ev, originRowKey: rowKey, originDayKey: dayKey,
      hasTeam: !!(ev.team_id || ev.job?.team_id),
      startClientX: e.clientX, startClientY: e.clientY, moved: false, target: null,
    };
    const onMove = (pe: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved) {
        const dist = Math.abs(pe.clientX - d.startClientX) + Math.abs(pe.clientY - d.startClientY);
        if (dist < DRAG_THRESHOLD_PX) return;
        d.moved = true;
        suppressClickRef.current = true;
      }
      let next = cellFromPoint(pe.clientX, pe.clientY);
      // Le RPC ne peut pas désassigner : une visite avec équipe ne se dépose
      // pas sur la ligne « Non assigné » (elle reste sur sa route).
      if (next && d.hasTeam && next.rowKey === UNASSIGNED_KEY) {
        next = { rowKey: d.originRowKey, dayKey: next.dayKey };
      }
      if (!sameCell(d.target, next)) { d.target = next; bump(); } else bump();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      dragCleanupRef.current = null;
    };
    const onUp = () => { cleanup(); finishDrag(); };
    const onCancel = () => { cleanup(); dragRef.current = null; bump(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    dragCleanupRef.current = cleanup;
  }, [finishDrag]);

  /* ── Drop externe : jobs non planifiés glissés depuis le tiroir ── */
  const extActive = externalDnd.dragState.active?.type === 'unscheduled';
  const extTargetRef = useRef<CellRef | null>(null);
  useEffect(() => {
    if (!extActive) { extTargetRef.current = null; return; }
    const onMove = (e: PointerEvent) => {
      const cell = cellFromPoint(e.clientX, e.clientY);
      if (!sameCell(extTargetRef.current, cell)) { extTargetRef.current = cell; bump(); }
    };
    const onUp = () => {
      const target = extTargetRef.current;
      extTargetRef.current = null;
      bump();
      const row = target ? rowByKey.get(target.rowKey) : null;
      const day = target ? dayByKey.get(target.dayKey) : null;
      if (target && day) {
        externalDnd.completeDrop(day, DEFAULT_SLOT_HOUR, 0, row && !row.placeholderIndex ? row.teamId : null).catch(() => {});
      } else {
        externalDnd.cancelDrag();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [extActive, externalDnd, rowByKey, dayByKey]);

  /* ── Clic sur une cellule vide → ajouter une visite ce jour-là ── */
  const handleCellClick = useCallback((dayKey: string) => {
    if (suppressClickRef.current || dragRef.current || extActive) return;
    const day = dayByKey.get(dayKey);
    if (!day) return;
    const start = new Date(day);
    start.setHours(DEFAULT_SLOT_HOUR, 0, 0, 0);
    onSlotClick(start);
  }, [dayByKey, extActive, onSlotClick]);

  /* ── Détails de visite (clic sur une carte) ── */
  const [detailEv, setDetailEv] = useState<ScheduleEventRecord | null>(null);
  const openCard = useCallback((ev: ScheduleEventRecord) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    setDetailEv(ev);
  }, []);

  /* ── Textes de la colonne ressources — identiques à la vue Jour ── */
  const teamIndex = useMemo(() => new Map(activeTeams.map((tm, i) => [tm.id, i])), [activeTeams]);
  const fieldText = useCallback((field: DispatchDailyPrefs['secondary'], row: WeeklyRow): string | null => {
    if (field === 'none') return null;
    if (!row.team) {
      if (field === 'vehicle') return t.schedule.vehicleUnassigned;
      if (field === 'teamName') return t.schedule.unassigned;
      return null;
    }
    if (field === 'vehicle') {
      return t.schedule.vehicleLabel.replace('{n}', vehicleNumberForTeam(prefs, row.team.id, teamIndex.get(row.team.id) ?? 0));
    }
    if (field === 'teamName') return row.team.name;
    return row.team.description || null;
  }, [prefs, t, teamIndex]);

  const drag = dragRef.current;
  const extTarget = extTargetRef.current;
  const extGhostLabel = useMemo(() => {
    const s = new Date();
    s.setHours(DEFAULT_SLOT_HOUR, 0, 0, 0);
    const e = new Date(s.getTime() + 120 * 60000);
    return `${fmtTime(s)} – ${fmtTime(e)}`;
  }, [fmtTime]);

  /* ── États particuliers ── */
  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-text-tertiary">
        <AlertTriangle size={28} className="opacity-40" />
        <p className="text-sm font-medium">{t.schedule.calendarError}</p>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0" data-dispatch-weekly>
      <div
        className="h-full overflow-auto overscroll-contain"
        style={{ touchAction: drag?.moved || extActive ? 'none' : 'auto' }}
      >
        <div style={{ minWidth: RESOURCE_COL_PX + dayKeys.length * DAY_COL_MIN_PX }} className="w-full">
          {/* ── En-tête des jours (sticky verticalement) ── */}
          <div className="sticky top-0 z-30 flex border-b border-border bg-surface" style={{ height: HEADER_HEIGHT_PX }}>
            <div
              className="sticky left-0 z-10 flex shrink-0 items-center justify-between gap-1 border-r border-border bg-surface pl-3 pr-2"
              style={{ width: RESOURCE_COL_PX }}
            >
              <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                {t.schedule.dailyResource}
              </span>
              <DailyCustomizePopover prefs={prefs} teams={activeTeams} onChange={updatePrefs} />
            </div>
            {weekDays.map((d, i) => {
              const today = isSameDay(d, new Date());
              return (
                <div
                  key={dayKeys[i]}
                  className={cn(
                    'flex min-w-0 flex-1 items-end border-l border-border/50 pb-2 pl-2 first:border-l-0',
                    today && 'bg-primary/[0.02]',
                  )}
                  style={{ minWidth: DAY_COL_MIN_PX }}
                >
                  <span className={cn(
                    'truncate text-[10.5px] font-medium tabular-nums',
                    today ? 'font-semibold text-primary' : 'text-text-tertiary',
                  )}>
                    {cap(format(d, 'EEEE d', { locale }))}
                  </span>
                </div>
              );
            })}
          </div>

          {/* ── Lignes routes ── */}
          <div>
            {rows.map((row) => {
              const teamColor = row.team && isHexColor(row.team.color_hex) ? row.team.color_hex : FALLBACK_TEAM_COLOR;
              const primaryText = row.placeholderIndex
                ? t.schedule.placeholderTruck.replace('{n}', String(row.placeholderIndex).padStart(2, '0'))
                : fieldText(prefs.primary, row);
              const secondaryRaw = row.placeholderIndex
                ? t.schedule.placeholderTeam.replace('{n}', String(row.placeholderIndex))
                : prefs.secondary === prefs.primary ? null : fieldText(prefs.secondary, row);
              const secondaryAsEyebrow = row.placeholderIndex
                ? true
                : prefs.secondary === 'teamName' || prefs.secondary === 'vehicle';
              return (
                <div key={row.key} className="flex border-b border-border/70" style={{ minHeight: ROW_MIN_HEIGHT_PX }}>
                  {/* Colonne fixe de gauche (sticky horizontalement) */}
                  <div
                    className="sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-0.5 border-r border-border bg-surface px-3"
                    style={{ width: RESOURCE_COL_PX }}
                  >
                    {secondaryRaw && secondaryAsEyebrow && (
                      <span className="truncate text-[9.5px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                        {secondaryRaw}
                      </span>
                    )}
                    <span className="flex min-w-0 items-center gap-1.5">
                      {row.team && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: teamColor }} />}
                      <span className="truncate text-[13px] font-semibold text-text-primary">{primaryText}</span>
                    </span>
                    {secondaryRaw && !secondaryAsEyebrow && (
                      <span className="truncate text-[11px] text-text-secondary">{secondaryRaw}</span>
                    )}
                  </div>

                  {/* Cellules jour */}
                  {dayKeys.map((dayKey, di) => {
                    const cellEvents = row.placeholderIndex ? [] : cellMap.get(`${row.key}|${dayKey}`) || [];
                    const today = isSameDay(weekDays[di], new Date());
                    const isDragTarget = !!(drag?.moved && drag.target && drag.target.rowKey === row.key && drag.target.dayKey === dayKey);
                    const isExtTarget = !!(extActive && extTarget && extTarget.rowKey === row.key && extTarget.dayKey === dayKey);
                    return (
                      <div
                        key={dayKey}
                        data-week-cell
                        data-row-key={row.key}
                        data-day-key={dayKey}
                        onClick={() => handleCellClick(dayKey)}
                        className={cn(
                          'flex min-w-0 flex-1 flex-col gap-1.5 border-l border-border/40 px-1.5 first:border-l-0',
                          extActive ? 'cursor-copy' : drag?.moved ? '' : 'cursor-pointer',
                          today && 'bg-primary/[0.02]',
                          (isDragTarget || isExtTarget) && 'bg-primary/[0.05]',
                        )}
                        style={{ minWidth: DAY_COL_MIN_PX, paddingTop: ROW_PAD_Y_PX, paddingBottom: ROW_PAD_Y_PX }}
                      >
                        {cellEvents.map((ev) => {
                          const st = String(ev.job?.status || ev.status || '').trim().toLowerCase().replace(/\s+/g, '_');
                          const tag = firstTagFor(ev.job?.tag_ids);
                          return (
                            <WeekVisitCard
                              key={ev.id}
                              ev={ev}
                              color={tag?.hex || teamColor}
                              tagName={tag?.name ?? null}
                              timeLabel={timeLabelFor(ev)}
                              attention={st === 'blocked' || st === 'late' || st === 'action_required'}
                              dimmed={!!(drag?.moved && drag.ev.id === ev.id)}
                              onOpen={() => openCard(ev)}
                              onMoveStart={(e) => handleMoveStart(ev, row.key, dayKey, e)}
                            />
                          );
                        })}
                        {/* Fantôme — déplacement d'une carte */}
                        {isDragTarget && drag && <CellDropGhost label={timeLabelFor(drag.ev)} />}
                        {/* Fantôme — job non planifié glissé depuis le tiroir */}
                        {isExtTarget && <CellDropGhost label={extGhostLabel} />}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Détails de la visite — clic sur une carte ── */}
      {detailEv && (() => {
        const tid = detailEv.team_id || detailEv.job?.team_id || null;
        const team = tid ? activeTeams.find((tm) => tm.id === tid) || teams.find((tm) => tm.id === tid) || null : null;
        const color = team && isHexColor(team.color_hex) ? team.color_hex : FALLBACK_TEAM_COLOR;
        const s = new Date(detailEv.start_at);
        const clientName = detailEv.job?.client_name || detailEv.job?.title || 'Job';
        const address = (detailEv.job?.property_address || '').trim() || null;
        const jobNumber = detailEv.job?.job_number ? `#${detailEv.job.job_number}` : null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => setDetailEv(null)}>
            <div
              className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <h2 className="truncate text-[15px] font-bold text-text-primary">{clientName}</h2>
                  </div>
                  {detailEv.job?.title && detailEv.job.title !== clientName && (
                    <p className="mt-0.5 truncate text-[12px] text-text-secondary">
                      {detailEv.job.title}{jobNumber ? ` · ${jobNumber}` : ''}
                    </p>
                  )}
                </div>
                <button onClick={() => setDetailEv(null)} className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-tertiary">
                  <XIcon size={16} />
                </button>
              </div>
              <div className="space-y-2 rounded-xl bg-surface-secondary p-3">
                <p className="flex items-center gap-2 text-[12px] font-medium text-text-primary">
                  <Clock size={12} className="shrink-0 text-text-tertiary" />
                  <span>{cap(format(s, isFr ? 'EEEE d MMMM' : 'EEEE, MMMM d', { locale }))} · {timeLabelFor(detailEv)}</span>
                </p>
                {address && (
                  <p className="flex items-center gap-2 text-[12px] text-text-secondary">
                    <MapPin size={12} className="shrink-0 text-text-tertiary" />
                    <span className="truncate">{address}</span>
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <span
                    className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: toRgba(color, 0.12), color }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                    {team?.name || t.schedule.unassigned}
                  </span>
                  {detailEv.job?.total_cents ? (
                    <span className="text-[12px] font-bold text-text-primary">{formatCurrency((detailEv.job.total_cents || 0) / 100)}</span>
                  ) : null}
                </div>
                {detailEv.notes && <p className="text-[11px] leading-relaxed text-text-tertiary">{detailEv.notes}</p>}
              </div>
              <button
                onClick={() => {
                  const jobId = detailEv.job_id;
                  setDetailEv(null);
                  if (jobId) onEventClick(jobId);
                }}
                className="mt-4 w-full rounded-lg bg-text-primary px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              >
                {isFr ? 'Voir la visite' : 'View Visit'}
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
