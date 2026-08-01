import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { isSameDay } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import type { ScheduleEventRecord } from '../../lib/scheduleApi';
import type { TeamRecord } from '../../lib/teamsApi';
import { getRosterForDate, fetchMemberNames, firstNameOf } from '../../lib/teamScheduleApi';
import type { useCalendarDnd } from '../../hooks/useCalendarDnd';
import { useJobTagColors } from '../../hooks/useJobTagColors';
import { FALLBACK_TEAM_COLOR, isHexColor } from '../../lib/colorUtils';
import {
  DispatchDailyPrefs, loadDispatchDailyPrefs, saveDispatchDailyPrefs, vehicleNumberForTeam,
} from '../../lib/dispatchDailyPrefs';
import DailyVisitCard from './DailyVisitCard';
import DailyCustomizePopover from './DailyCustomizePopover';
import {
  CARD_GAP_X_PX, CARD_HEIGHT_PX, DRAG_THRESHOLD_PX, EXTERNAL_DROP_DURATION_MIN,
  HEADER_HEIGHT_PX, HOUR_WIDTH_PX, PX_PER_MINUTE, RESOURCE_COL_PX,
  assignLanes, computeDayRange, eventMinutes, laneTop, minutesToX,
  rowHeightForLanes, snapMinutes, xToMinutes,
} from './dailyGeometry';

/**
 * Vue Jour du calendrier Dispatch — timeline horizontale.
 * Heures en haut, ressources (équipes / véhicules) à gauche, visites en
 * cartes blanches — sauf si la job porte un tag : la carte prend alors la
 * couleur vive du premier tag (fond pâle + barre gauche). La couleur
 * d'équipe n'apparaît que dans la pastille de la colonne ressource.
 * Composant DÉDIÉ à la vue Jour : les vues Semaine / Mois / Agenda gardent
 * leurs composants existants (TimeGrid, MonthView, AgendaView) intacts.
 */

type CalendarDnd = ReturnType<typeof useCalendarDnd>;

interface DailyRow {
  key: string;
  teamId: string | null;
  team: TeamRecord | null;
  /** Ligne d'exemple affichée quand aucune équipe ni visite n'existe (1-based). */
  placeholderIndex?: number;
}

/** Nombre de lignes d'exemple quand la journée est entièrement vide. */
const PLACEHOLDER_ROW_COUNT = 5;

interface DailyDispatchViewProps {
  date: Date;
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
  onResize: (eventId: string, startAt: string, endAt: string) => Promise<void>;
  /** Instance DnD partagée — utilisée seulement pour les drops du tiroir « Jobs non planifiés ». */
  externalDnd: CalendarDnd;
}

type DailyDrag =
  | {
      mode: 'move'; ev: ScheduleEventRecord; startClientX: number; startClientY: number;
      grabOffsetMin: number; durationMin: number; originRowIndex: number; hasTeam: boolean;
      ghostStartMin: number; ghostRowIndex: number; moved: boolean;
    }
  | {
      mode: 'resize'; ev: ScheduleEventRecord; startClientX: number; startClientY: number;
      startMin: number; origDurationMin: number; previewDurationMin: number; moved: boolean;
    };

export default function DailyDispatchView({
  date, events, teams, visibleTeamIds, orgId, unassignedMode, isError,
  onEventClick, onSlotClick, onReschedule, onResize, externalDnd,
}: DailyDispatchViewProps) {
  const { t, language } = useTranslation();
  const isFr = language === 'fr';
  const { colorForTagIds } = useJobTagColors();

  /* ── Préférences colonne de gauche (par organisation) ── */
  const [prefs, setPrefs] = useState<DispatchDailyPrefs>(() => loadDispatchDailyPrefs(orgId));
  useEffect(() => { setPrefs(loadDispatchDailyPrefs(orgId)); }, [orgId]);
  const updatePrefs = useCallback((p: DispatchDailyPrefs) => {
    setPrefs(p);
    saveDispatchDailyPrefs(orgId, p);
  }, [orgId]);

  /* ── Mises à jour optimistes locales (drag / resize) ── */
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

  /* ── Roster du jour — qui travaille dans chaque équipe CETTE date ──
     Source de vérité : l'onglet Horaire (Feuilles de temps). Repli silencieux
     tant que la migration team_daily_schedule n'est pas appliquée. */
  const dayKey = useMemo(() => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [date]);
  const rosterQuery = useQuery({
    queryKey: ['team-schedule-roster', orgId, dayKey],
    queryFn: () => getRosterForDate(dayKey),
    enabled: !!orgId,
    staleTime: 60_000,
    retry: false,
  });
  // Noms en direct Supabase (memberships → profiles) — même source que le
  // reste des rosters, sans dépendre de l'API serveur.
  const namesQuery = useQuery({
    queryKey: ['member-names', orgId],
    queryFn: fetchMemberNames,
    enabled: !!orgId && !!rosterQuery.data && !rosterQuery.data.missing,
    staleTime: 5 * 60_000,
  });
  const memberFirstName = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, name] of namesQuery.data ?? new Map<string, string>()) {
      map.set(id, firstNameOf(name));
    }
    return map;
  }, [namesQuery.data]);

  /* ── Lignes (ressources) ── */
  const activeTeams = useMemo(() => teams.filter((tm) => tm.is_active !== false), [teams]);
  const rowTeams = useMemo(
    () => (visibleTeamIds.length ? activeTeams.filter((tm) => visibleTeamIds.includes(tm.id)) : activeTeams),
    [activeTeams, visibleTeamIds],
  );

  const { rows, rowLayouts, rowHeights } = useMemo(() => {
    const teamIdSet = new Set(rowTeams.map((tm) => tm.id));
    const byTeam = new Map<string, ScheduleEventRecord[]>();
    const unassigned: ScheduleEventRecord[] = [];
    for (const ev of effEvents) {
      const tid = ev.team_id || ev.job?.team_id || null;
      if (tid && teamIdSet.has(tid)) {
        if (!byTeam.has(tid)) byTeam.set(tid, []);
        byTeam.get(tid)!.push(ev);
      } else {
        // Sans équipe, équipe désactivée ou hors filtre : jamais masquée
        // silencieusement — regroupée dans la ligne « Non assigné ».
        unassigned.push(ev);
      }
    }
    const list: DailyRow[] = unassignedMode
      ? []
      : rowTeams.map((tm) => ({ key: tm.id, teamId: tm.id, team: tm }));
    if (unassignedMode || unassigned.length > 0) {
      list.push({ key: '__unassigned__', teamId: null, team: null });
    }
    // Journée entièrement vide (aucune équipe, aucune visite) : la grille
    // reste complètement dessinée, avec des lignes d'exemple à gauche —
    // même structure, mêmes dimensions, prête à recevoir des jobs.
    if (list.length === 0) {
      for (let i = 1; i <= PLACEHOLDER_ROW_COUNT; i++) {
        list.push({ key: `__placeholder-${i}__`, teamId: null, team: null, placeholderIndex: i });
      }
    }
    const layouts = list.map((row) =>
      assignLanes(row.placeholderIndex ? [] : row.teamId ? byTeam.get(row.teamId) || [] : unassigned));
    const heights = layouts.map((l) => rowHeightForLanes(l.laneCount));
    return { rows: list, rowLayouts: layouts, rowHeights: heights };
  }, [effEvents, rowTeams, unassignedMode]);

  /* ── Plage horaire (défaut 07–19 h, étendue aux visites du jour) ── */
  const range = useMemo(() => computeDayRange(effEvents), [effEvents]);
  const timelineWidth = (range.endMin - range.startMin) * PX_PER_MINUTE;

  /* ── Géométrie accessible depuis les listeners window ── */
  const rowsAreaRef = useRef<HTMLDivElement>(null);
  const geomRef = useRef({ range, rows, rowHeights });
  geomRef.current = { range, rows, rowHeights };

  const pointFromClient = useCallback((clientX: number, clientY: number) => {
    const el = rowsAreaRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left - RESOURCE_COL_PX;
    const y = clientY - rect.top;
    const { range: g, rowHeights: heights } = { range: geomRef.current.range, rowHeights: geomRef.current.rowHeights };
    let rowIndex = -1;
    let acc = 0;
    for (let i = 0; i < heights.length; i++) {
      if (y >= acc && y < acc + heights[i]) { rowIndex = i; break; }
      acc += heights[i];
    }
    return { x, y, rowIndex, minute: xToMinutes(x, g.startMin) };
  }, []);

  /* ── Drag local (déplacement / redimensionnement des cartes) ── */
  const dragRef = useRef<DailyDrag | null>(null);
  const [, bumpDrag] = useReducer((x: number) => x + 1, 0);
  const suppressClickRef = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const finishDrag = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    bumpDrag();
    if (!d || !d.moved) return;
    // Le pointerup précède le click : on libère le flag juste après.
    setTimeout(() => { suppressClickRef.current = false; }, 0);

    if (d.mode === 'move') {
      const g = geomRef.current;
      const targetRow = g.rows[d.ghostRowIndex];
      const { startMin } = eventMinutes(d.ev);
      const originTeam = d.ev.team_id || d.ev.job?.team_id || null;
      const targetTeam = targetRow ? targetRow.teamId : originTeam;
      if (d.ghostStartMin === startMin && targetTeam === originTeam) return;
      const newStart = new Date(date);
      newStart.setHours(Math.floor(d.ghostStartMin / 60), d.ghostStartMin % 60, 0, 0);
      const newEnd = new Date(newStart.getTime() + d.durationMin * 60000);
      applyOpt(d.ev.id, { start_at: newStart.toISOString(), end_at: newEnd.toISOString(), team_id: targetTeam });
      onReschedule(d.ev.id, newStart.toISOString(), newEnd.toISOString(), targetTeam)
        .catch(() => {})
        .finally(() => clearOpt(d.ev.id));
    } else {
      if (d.previewDurationMin === d.origDurationMin) return;
      const s = new Date(d.ev.start_at);
      const newEnd = new Date(s.getTime() + d.previewDurationMin * 60000);
      applyOpt(d.ev.id, { end_at: newEnd.toISOString() });
      onResize(d.ev.id, d.ev.start_at, newEnd.toISOString())
        .catch(() => {})
        .finally(() => clearOpt(d.ev.id));
    }
  }, [applyOpt, clearOpt, date, onReschedule, onResize]);

  const beginDrag = useCallback((init: DailyDrag) => {
    dragRef.current = init;
    bumpDrag();

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved) {
        const dist = Math.abs(e.clientX - d.startClientX) + Math.abs(e.clientY - d.startClientY);
        if (dist < DRAG_THRESHOLD_PX) return;
        d.moved = true;
        suppressClickRef.current = true;
      }
      const g = geomRef.current;
      if (d.mode === 'move') {
        const p = pointFromClient(e.clientX, e.clientY);
        if (!p) return;
        let minute = snapMinutes(p.minute - d.grabOffsetMin);
        minute = Math.max(g.range.startMin, Math.min(minute, g.range.endMin - d.durationMin));
        let row = p.rowIndex >= 0 ? p.rowIndex : p.y < 0 ? 0 : g.rows.length - 1;
        // Le RPC ne peut pas désassigner : une visite avec équipe ne se
        // dépose pas sur la ligne « Non assigné » (le fantôme reste chez elle).
        if (d.hasTeam && g.rows[row]?.teamId === null) row = d.originRowIndex;
        d.ghostStartMin = minute;
        d.ghostRowIndex = row;
      } else {
        const deltaMin = (e.clientX - d.startClientX) / PX_PER_MINUTE;
        let next = Math.max(15, snapMinutes(d.origDurationMin + deltaMin));
        next = Math.min(next, 24 * 60 - d.startMin);
        d.previewDurationMin = next;
      }
      bumpDrag();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      dragCleanupRef.current = null;
    };
    const onUp = () => { cleanup(); finishDrag(); };
    const onCancel = () => { cleanup(); dragRef.current = null; bumpDrag(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    dragCleanupRef.current = cleanup;
  }, [finishDrag, pointFromClient]);

  const handleMoveStart = useCallback((ev: ScheduleEventRecord, rowIndex: number, e: React.PointerEvent) => {
    e.preventDefault();
    const p = pointFromClient(e.clientX, e.clientY);
    if (!p) return;
    const { startMin, endMin } = eventMinutes(ev);
    beginDrag({
      mode: 'move', ev, startClientX: e.clientX, startClientY: e.clientY,
      grabOffsetMin: p.minute - startMin, durationMin: endMin - startMin,
      originRowIndex: rowIndex, hasTeam: !!(ev.team_id || ev.job?.team_id),
      ghostStartMin: startMin, ghostRowIndex: rowIndex, moved: false,
    });
  }, [beginDrag, pointFromClient]);

  const handleResizeStart = useCallback((ev: ScheduleEventRecord, e: React.PointerEvent) => {
    e.preventDefault();
    const { startMin, endMin } = eventMinutes(ev);
    beginDrag({
      mode: 'resize', ev, startClientX: e.clientX, startClientY: e.clientY,
      startMin, origDurationMin: endMin - startMin, previewDurationMin: endMin - startMin, moved: false,
    });
  }, [beginDrag]);

  /* ── Drop externe : jobs non planifiés glissés depuis le tiroir ── */
  const extActive = externalDnd.dragState.active?.type === 'unscheduled';
  const extGhostRef = useRef<{ rowIndex: number; startMin: number } | null>(null);
  useEffect(() => {
    if (!extActive) { extGhostRef.current = null; return; }
    const onMove = (e: PointerEvent) => {
      const p = pointFromClient(e.clientX, e.clientY);
      const g = geomRef.current;
      if (!p || p.rowIndex < 0 || p.x < 0) {
        if (extGhostRef.current) { extGhostRef.current = null; bumpDrag(); }
        return;
      }
      let minute = snapMinutes(p.minute);
      minute = Math.max(g.range.startMin, Math.min(minute, g.range.endMin - EXTERNAL_DROP_DURATION_MIN));
      extGhostRef.current = { rowIndex: p.rowIndex, startMin: minute };
      bumpDrag();
    };
    const onUp = () => {
      const ghost = extGhostRef.current;
      extGhostRef.current = null;
      bumpDrag();
      const g = geomRef.current;
      const row = ghost ? g.rows[ghost.rowIndex] : null;
      if (ghost && row) {
        externalDnd.completeDrop(date, Math.floor(ghost.startMin / 60), ghost.startMin % 60, row.teamId).catch(() => {});
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
  }, [extActive, externalDnd, date, pointFromClient]);

  /* ── Ligne « maintenant » ── */
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowX = useMemo(() => {
    const n = new Date(nowTick);
    if (!isSameDay(n, date)) return null;
    const min = n.getHours() * 60 + n.getMinutes();
    if (min < range.startMin || min > range.endMin) return null;
    return minutesToX(min, range.startMin);
  }, [nowTick, date, range]);

  /* ── Formats horaires ── */
  const fmtMin = useCallback((min: number) => {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    if (isFr) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }, [isFr]);
  const timeLabelFor = useCallback((s: number, e: number) => `${fmtMin(s)} – ${fmtMin(e)}`, [fmtMin]);
  const hourLabel = useCallback((h: number) => {
    if (isFr) return `${String(h).padStart(2, '0')}:00`;
    return h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
  }, [isFr]);

  /* ── Clic sur une plage vide → ajouter une visite ── */
  const handleRowClick = useCallback((e: React.MouseEvent) => {
    if (suppressClickRef.current || dragRef.current || extActive) return;
    const p = pointFromClient(e.clientX, e.clientY);
    if (!p || p.x < 0) return;
    const g = geomRef.current;
    const minute = Math.max(g.range.startMin, Math.min(snapMinutes(p.minute, 30), g.range.endMin - 30));
    const start = new Date(date);
    start.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
    onSlotClick(start);
  }, [date, extActive, onSlotClick, pointFromClient]);

  const openEvent = useCallback((jobId: string | null) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    if (jobId) onEventClick(jobId);
  }, [onEventClick]);

  /* ── Textes de la colonne ressources ── */
  // Numérotation auto des véhicules basée sur TOUTES les équipes actives :
  // filtrer le calendrier ne change jamais le numéro d'une équipe.
  const teamIndex = useMemo(() => new Map(activeTeams.map((tm, i) => [tm.id, i])), [activeTeams]);
  const fieldText = useCallback((field: DispatchDailyPrefs['secondary'], row: DailyRow): string | null => {
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
  const extGhost = extGhostRef.current;

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
    <div className="relative h-full min-h-0" data-dispatch-daily>
      <div
        className="h-full overflow-auto overscroll-contain"
        style={{ touchAction: drag || extActive ? 'none' : 'auto' }}
      >
        <div style={{ width: RESOURCE_COL_PX + timelineWidth, minWidth: '100%' }}>
          {/* ── En-tête des heures (sticky verticalement) ── */}
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
            <div className="relative shrink-0" style={{ width: timelineWidth }}>
              {range.hours.map((h) => (
                <div
                  key={h}
                  className="absolute bottom-0 top-0 flex items-end border-l border-border/50 pb-2 pl-1.5 first:border-l-0"
                  style={{ left: minutesToX(h * 60, range.startMin), width: HOUR_WIDTH_PX }}
                >
                  <span className="text-[10.5px] font-medium tabular-nums text-text-tertiary">{hourLabel(h)}</span>
                </div>
              ))}
              {nowX != null && <span className="absolute bottom-0 h-2 w-px bg-primary" style={{ left: nowX }} />}
            </div>
          </div>

          {/* ── Lignes ressources ── */}
          <div ref={rowsAreaRef}>
            {rows.map((row, ri) => {
              const layout = rowLayouts[ri];
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
                <div key={row.key} className="flex border-b border-border/70" style={{ height: rowHeights[ri] }}>
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
                    {/* Membres assignés à l'équipe pour CETTE journée (onglet Horaire) */}
                    {row.team && rosterQuery.data && !rosterQuery.data.missing && (() => {
                      const roster = (rosterQuery.data.byTeam.get(row.team.id) || [])
                        .filter((e) => e.status === 'available' || e.status === 'partial');
                      if (!roster.length) {
                        return (
                          <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-[#c2410c]">
                            <AlertTriangle size={9} className="shrink-0" />
                            {isFr ? 'Aucun membre assigné' : 'No members assigned'}
                          </span>
                        );
                      }
                      // Noms seulement : les heures appartiennent à l'équipe-journée,
                      // pas aux membres.
                      const names = [...new Set(roster.map((e) => memberFirstName.get(e.user_id) || (isFr ? 'Membre' : 'Member')))];
                      return (
                        <span className="mt-0.5 truncate text-[10px] leading-[13px] text-text-secondary" title={names.join(', ')}>
                          {names.join(' · ')}
                        </span>
                      );
                    })()}
                  </div>

                  {/* Timeline de la ligne */}
                  <div
                    className={cn(
                      'relative shrink-0',
                      extActive ? 'cursor-copy' : drag ? '' : 'cursor-pointer',
                    )}
                    style={{ width: timelineWidth }}
                    onClick={handleRowClick}
                  >
                    {/* Séparateurs verticaux subtils (heure + demi-heure) */}
                    {range.hours.map((h) => (
                      <React.Fragment key={h}>
                        <span
                          className="pointer-events-none absolute inset-y-0 border-l border-border/40 first:border-l-0"
                          style={{ left: minutesToX(h * 60, range.startMin) }}
                        />
                        <span
                          className="pointer-events-none absolute inset-y-0 border-l border-border/20"
                          style={{ left: minutesToX(h * 60 + 30, range.startMin) }}
                        />
                      </React.Fragment>
                    ))}
                    {nowX != null && (
                      <span className="pointer-events-none absolute inset-y-0 w-px bg-primary/25" style={{ left: nowX }} />
                    )}

                    {/* Cartes de visite */}
                    {layout.positioned.map((p) => {
                      const isDraggingThis = drag?.mode === 'move' && drag.ev.id === p.ev.id && drag.moved;
                      const isResizingThis = drag?.mode === 'resize' && drag.ev.id === p.ev.id && drag.moved;
                      const durMin = isResizingThis ? drag.previewDurationMin : p.endMin - p.startMin;
                      const width = Math.max(durMin * PX_PER_MINUTE - CARD_GAP_X_PX * 2, 26);
                      return (
                        <DailyVisitCard
                          key={p.ev.id}
                          ev={p.ev}
                          left={minutesToX(p.startMin, range.startMin) + CARD_GAP_X_PX}
                          top={laneTop(p.lane)}
                          width={width}
                          height={CARD_HEIGHT_PX}
                          timeLabel={timeLabelFor(p.startMin, p.startMin + durMin)}
                          dimmed={isDraggingThis}
                          tagColor={colorForTagIds(p.ev.job?.tag_ids)}
                          onOpen={() => openEvent(p.ev.job_id)}
                          onMoveStart={(e) => handleMoveStart(p.ev, ri, e)}
                          onResizeStart={(e) => handleResizeStart(p.ev, e)}
                        />
                      );
                    })}

                    {/* Fantôme — déplacement d'une carte */}
                    {drag?.mode === 'move' && drag.moved && drag.ghostRowIndex === ri && (
                      <div
                        className="pointer-events-none absolute z-40 overflow-hidden rounded-lg border-2 border-dashed border-primary/60 bg-primary/10"
                        style={{
                          left: minutesToX(drag.ghostStartMin, range.startMin) + CARD_GAP_X_PX,
                          top: laneTop(0),
                          width: Math.max(drag.durationMin * PX_PER_MINUTE - CARD_GAP_X_PX * 2, 26),
                          height: CARD_HEIGHT_PX,
                        }}
                      >
                        <div className="truncate px-2 py-1 text-[11px] font-semibold text-primary">
                          {timeLabelFor(drag.ghostStartMin, drag.ghostStartMin + drag.durationMin)}
                        </div>
                      </div>
                    )}

                    {/* Fantôme — job non planifié glissé depuis le tiroir */}
                    {extActive && extGhost && extGhost.rowIndex === ri && (
                      <div
                        className="pointer-events-none absolute z-40 overflow-hidden rounded-lg border-2 border-dashed border-primary/60 bg-primary/10"
                        style={{
                          left: minutesToX(extGhost.startMin, range.startMin) + CARD_GAP_X_PX,
                          top: laneTop(0),
                          width: EXTERNAL_DROP_DURATION_MIN * PX_PER_MINUTE - CARD_GAP_X_PX * 2,
                          height: CARD_HEIGHT_PX,
                        }}
                      >
                        <div className="truncate px-2 py-1 text-[11px] font-semibold text-primary">
                          {timeLabelFor(extGhost.startMin, extGhost.startMin + EXTERNAL_DROP_DURATION_MIN)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}
