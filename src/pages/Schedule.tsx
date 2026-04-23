import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays, addHours, addMonths, endOfMonth, endOfWeek, format,
  isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek,
  getHours, getMinutes, differenceInMinutes,
} from 'date-fns';
import {
  AlertTriangle, Briefcase, CalendarDays, ChevronDown, ChevronLeft,
  ChevronRight, CircleAlert, Clock, GripVertical, List,
  MapPin, Plus, RefreshCw, SlidersHorizontal, UserCheck, UserPlus,
  Users, X as XIcon, PanelRightOpen, PanelRightClose,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarControllerProvider, CalendarUiView, useCalendarController } from '../contexts/CalendarController';
import { useJobModalController } from '../contexts/JobModalController';
import { getCurrentOrgId } from '../lib/orgApi';
import { getJobModalDraftById } from '../lib/jobsApi';
import {
  DEFAULT_TIMEZONE, ScheduleEventRecord, UnscheduledJobRecord,
  assignJobToTeam, invalidateScheduleCache, listScheduleEventsRange,
  listUnassignedScheduledEvents, listUnassignedUnscheduledJobs,
  listUnscheduledJobs, rescheduleEvent, scheduleUnscheduledJob,
} from '../lib/scheduleApi';
import { findFreeSlots, type FreeSlot } from '../lib/availabilityApi';
import { listTeams, TeamRecord } from '../lib/teamsApi';
import { supabase } from '../lib/supabase';
import { cn, formatCurrency } from '../lib/utils';
import { FALLBACK_TEAM_COLOR, isHexColor, toRgba } from '../lib/colorUtils';
import {
  useCalendarDnd,
  SLOT_HEIGHT_PX,
  snapToGrid,
  minutesToPx,
  pxToMinutes,
  type CalendarDragData,
} from '../hooks/useCalendarDnd';

/* ════════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════════ */
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const SLOT_H = SLOT_HEIGHT_PX;

function buildRange(date: Date, view: CalendarUiView) {
  if (view === 'day') return { start: startOfDay(date), end: addDays(startOfDay(date), 1) };
  if (view === 'month') return { start: startOfMonth(date), end: addMonths(startOfMonth(date), 1) };
  const s = startOfWeek(date, { weekStartsOn: 1 });
  return { start: s, end: addDays(s, 7) };
}

function hLabel(date: Date, view: CalendarUiView) {
  if (view === 'month') return format(date, 'MMMM yyyy');
  if (view === 'day') return format(date, 'EEEE, MMMM d, yyyy');
  const s = startOfWeek(date, { weekStartsOn: 1 }), e = addDays(s, 6);
  if (s.getMonth() === e.getMonth()) return `${format(s, 'MMM d')} – ${format(e, 'd, yyyy')}`;
  return `${format(s, 'MMM d')} – ${format(e, 'MMM d, yyyy')}`;
}

function computeOverlaps(events: ScheduleEventRecord[]) {
  const o: Record<string, number> = {};
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
    const a = events[i], b = events[j];
    if ((a.team_id || a.job?.team_id || '-') !== (b.team_id || b.job?.team_id || '-')) continue;
    if (new Date(a.start_at).getTime() < new Date(b.end_at).getTime() && new Date(b.start_at).getTime() < new Date(a.end_at).getTime()) {
      o[a.id] = (o[a.id] || 0) + 1; o[b.id] = (o[b.id] || 0) + 1;
    }
  }
  return o;
}

type QF = 'all' | 'ending_30' | 'requires_invoicing' | 'needs_attention';
const ns = (v: string | null | undefined) => String(v || '').trim().toLowerCase().replace(/\s+/g, '_');
const isEnd30 = (e: ScheduleEventRecord, now: Date) => { const s = ns(e.job?.status || e.status); if (s === 'completed' || s === 'cancelled' || s === 'canceled') return false; const d = new Date(e.end_at); return !isNaN(d.getTime()) && d >= now && d <= addDays(now, 30); };
const reqInv = (e: ScheduleEventRecord) => ns(e.job?.status || e.status) === 'completed';
const needsAtt = (e: ScheduleEventRecord) => { const s = ns(e.job?.status || e.status); return s === 'blocked' || s === 'late' || s === 'action_required' || (!e.team_id && !e.job?.team_id) || !e.start_at || !e.end_at; };

function eventsForDay(events: ScheduleEventRecord[], day: Date) {
  const dStr = format(day, 'yyyy-MM-dd');
  return events.filter((e) => e.start_at.startsWith(dStr));
}

/* ════════════════════════════════════════════════════════════════
   DRAGGABLE EVENT CARD (used in Week/Day time grids)
   ════════════════════════════════════════════════════════════════ */
interface DragEventProps {
  ev: ScheduleEventRecord;
  color: string;
  style: React.CSSProperties;
  isDragging: boolean;
  previewDuration: number | null;
  onEventClick: (jobId: string) => void;
  onDragStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
}

function DragEventCard({ ev, color, style, isDragging, previewDuration, onEventClick, onDragStart, onResizeStart }: DragEventProps) {
  const s = new Date(ev.start_at), e = new Date(ev.end_at);
  const computedHeight = previewDuration != null
    ? Math.max(minutesToPx(previewDuration), 20)
    : (style.height as number | undefined);

  return (
    <div
      className={cn(
        'pointer-events-auto absolute cursor-grab overflow-hidden rounded-md px-1.5 py-1 text-left select-none',
        'transition-shadow group/event',
        isDragging
          ? 'opacity-40 ring-2 ring-primary/40 shadow-xl z-30 cursor-grabbing'
          : 'hover:shadow-lg hover:z-10',
      )}
      style={{
        ...style,
        height: computedHeight ?? style.height,
        backgroundColor: toRgba(color, isDragging ? 0.08 : 0.15),
        borderLeft: `3px solid ${color}`,
      }}
      onClick={(e) => { e.stopPropagation(); if (!isDragging) ev.job_id && onEventClick(ev.job_id); }}
      onPointerDown={(e) => {
        // Only left button, ignore resize handle
        if (e.button !== 0 || (e.target as HTMLElement).dataset.resize) return;
        e.preventDefault();
        onDragStart(e);
      }}
    >
      <div className="truncate text-[11px] font-semibold" style={{ color }}>{ev.job?.title || 'Job'}</div>
      <div className="truncate text-[10px] text-text-secondary">{format(s, 'h:mm a')}{computedHeight && computedHeight > 30 ? ` – ${format(e, 'h:mm a')}` : ''}</div>
      {ev.job?.client_name && computedHeight && computedHeight > 44 && (
        <div className="mt-0.5 truncate text-[10px] text-text-tertiary">{ev.job.client_name}</div>
      )}
      {/* Resize handle (bottom) */}
      <div
        data-resize="true"
        className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize opacity-0 group-hover/event:opacity-100 transition-opacity"
        style={{ backgroundColor: toRgba(color, 0.3), borderRadius: '0 0 4px 4px' }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(e);
        }}
      />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   GHOST PREVIEW (shown during drag)
   ════════════════════════════════════════════════════════════════ */
function DragGhostPreview({ top, width, left, height, label }: {
  top: number; width: string; left: string; height: number; label: string;
}) {
  return (
    <div
      className="pointer-events-none absolute rounded-md border-2 border-dashed border-primary/60 bg-primary/10 z-40"
      style={{ top, left, width, height: Math.max(height, 20) }}
    >
      <div className="px-2 py-1 text-[11px] font-semibold text-primary truncate">{label}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   DRAG-AWARE TIME GRID (shared between Week & Day views)
   ════════════════════════════════════════════════════════════════ */
interface TimeGridProps {
  columns: Date[];
  events: ScheduleEventRecord[];
  tcMap: Map<string, string>;
  onSlotClick: (start: Date) => void;
  onEventClick: (jobId: string) => void;
  // DnD
  isDragging: (eventId: string) => boolean;
  isAnyDragActive: boolean;
  dragState: ReturnType<typeof useCalendarDnd>['dragState'];
  applyOptimistic: (ev: ScheduleEventRecord) => ScheduleEventRecord;
  onEventDragStart: (ev: ScheduleEventRecord, e: React.PointerEvent, gridEl: HTMLElement) => void;
  onResizeStart: (ev: ScheduleEventRecord, e: React.PointerEvent) => void;
  onGridPointerMove: (e: React.PointerEvent, gridEl: HTMLElement) => void;
  onGridPointerUp: (e: React.PointerEvent, columns: Date[]) => void;
  onDragSlotDrop: (date: Date, hour: number, minute: number) => void;
}

function TimeGrid({
  columns, events, tcMap, onSlotClick, onEventClick,
  isDragging, isAnyDragActive, dragState, applyOptimistic,
  onEventDragStart, onResizeStart,
  onGridPointerMove, onGridPointerUp, onDragSlotDrop,
}: TimeGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMultiCol = columns.length > 1;
  const gridCols = isMultiCol ? `56px repeat(${columns.length}, 1fr)` : '56px 1fr';

  // Scroll to ~7am on mount
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * SLOT_H;
  }, [columns[0]?.getTime()]);

  // Pointer handlers on the grid for drag operations
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isAnyDragActive || !gridRef.current) return;
    onGridPointerMove(e, gridRef.current);
  }, [isAnyDragActive, onGridPointerMove]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isAnyDragActive) return;
    onGridPointerUp(e, columns);
  }, [isAnyDragActive, onGridPointerUp, columns]);

  // Compute drop target highlight during drag
  const dropHighlight = useMemo(() => {
    if (!isAnyDragActive || dragState.ghostTop == null) return null;
    const snappedMin = snapToGrid(pxToMinutes(dragState.ghostTop));
    const h = Math.floor(snappedMin / 60);
    const m = snappedMin % 60;
    return { hour: h, minute: m, top: minutesToPx(snappedMin), colIndex: dragState.ghostColIndex };
  }, [isAnyDragActive, dragState.ghostTop, dragState.ghostColIndex]);

  return (
    <div className="flex h-full flex-col">
      {/* Header row */}
      <div className="grid shrink-0 border-b border-border/60" style={{ gridTemplateColumns: gridCols }}>
        <div className="border-r border-border/40" />
        {columns.map((d, i) => {
          const today = isSameDay(d, new Date());
          return (
            <div key={i} className={cn('border-r border-border/40 px-2 py-2.5 text-center', today && 'bg-primary/[0.03]')}>
              <div className={cn('text-[11px] font-semibold uppercase tracking-wider', today ? 'text-primary' : 'text-text-tertiary')}>
                {format(d, 'EEE')}
              </div>
              <div className={cn('mx-auto mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-[15px]',
                today ? 'bg-primary font-bold text-white' : 'font-medium text-text-primary')}>
                {format(d, 'd')}
              </div>
            </div>
          );
        })}
      </div>

      {/* Scrollable time grid */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div ref={gridRef} className="relative" style={{ touchAction: isAnyDragActive ? 'none' : 'auto' }}>
          {/* Hour rows */}
          {HOURS.map((h) => (
            <div key={h} className="grid border-b border-border/30" style={{ gridTemplateColumns: gridCols, height: SLOT_H }}>
              <div className="flex items-start justify-end border-r border-border/40 pr-2 pt-0.5 text-[11px] font-medium text-text-tertiary">
                {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
              </div>
              {columns.map((d, ci) => {
                const today = isSameDay(d, new Date());
                const isDropTarget = dropHighlight && dropHighlight.colIndex === ci && dropHighlight.hour === h;
                return (
                  <div key={ci}
                    onClick={() => { if (!isAnyDragActive) { const slot = new Date(d); slot.setHours(h, 0, 0, 0); onSlotClick(slot); } }}
                    data-col={ci}
                    data-hour={h}
                    data-date={format(d, 'yyyy-MM-dd')}
                    className={cn(
                      'border-r border-border/30 transition-colors',
                      isAnyDragActive ? 'cursor-copy' : 'cursor-pointer hover:bg-primary/[0.03]',
                      today && 'bg-primary/[0.02]',
                      isDropTarget && 'bg-primary/[0.08]',
                    )}
                  />
                );
              })}
            </div>
          ))}

          {/* Events overlay */}
          <div className="pointer-events-none absolute inset-0" style={{ marginLeft: 56 }}>
            {columns.map((d, ci) => {
              const dayEvs = eventsForDay(events, d);
              const colWidth = isMultiCol ? `calc(100% / ${columns.length})` : '100%';
              return dayEvs.map((rawEv) => {
                const ev = applyOptimistic(rawEv);
                const s = new Date(ev.start_at), e = new Date(ev.end_at);
                const startMin = getHours(s) * 60 + getMinutes(s);
                const dur = Math.max(differenceInMinutes(e, s), 15);
                const top = minutesToPx(startMin);
                const height = minutesToPx(dur);
                const c = tcMap.get(ev.team_id || ev.job?.team_id || '') || FALLBACK_TEAM_COLOR;
                if (startMin < 0 || startMin >= 24 * 60) return null;
                const dragging = isDragging(ev.id);
                const previewDur = dragging && dragState.previewDuration ? dragState.previewDuration : null;

                return (
                  <DragEventCard
                    key={ev.id}
                    ev={ev}
                    color={c}
                    isDragging={dragging}
                    previewDuration={previewDur}
                    style={{
                      left: isMultiCol ? `calc(${ci} * ${colWidth} + 2px)` : '4px',
                      width: isMultiCol ? `calc(${colWidth} - 4px)` : 'calc(100% - 8px)',
                      top,
                      height: Math.max(height, 20),
                    }}
                    onEventClick={onEventClick}
                    onDragStart={(e) => gridRef.current && onEventDragStart(ev, e, gridRef.current)}
                    onResizeStart={(e) => onResizeStart(ev, e)}
                  />
                );
              });
            })}

            {/* Ghost preview during drag */}
            {isAnyDragActive && dragState.ghostTop != null && dragState.active?.type !== 'resize-bottom' && (
              <DragGhostPreview
                top={dragState.ghostTop}
                left={
                  isMultiCol && dragState.ghostColIndex != null
                    ? `calc(${dragState.ghostColIndex} * (100% / ${columns.length}) + 2px)`
                    : '4px'
                }
                width={
                  isMultiCol
                    ? `calc(100% / ${columns.length} - 4px)`
                    : 'calc(100% - 8px)'
                }
                height={minutesToPx(120)}
                label={(() => {
                  const min = snapToGrid(pxToMinutes(dragState.ghostTop));
                  const h = Math.floor(min / 60), m = min % 60;
                  const ampm = h >= 12 ? 'PM' : 'AM';
                  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
                })()}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   CUSTOM MONTH VIEW (unchanged — no drag in month view)
   ════════════════════════════════════════════════════════════════ */
function MonthView({ date, events, tcMap, onDayClick, onEventClick }: {
  date: Date; events: ScheduleEventRecord[]; tcMap: Map<string, string>;
  onDayClick: (d: Date) => void; onEventClick: (jobId: string) => void;
}) {
  const mStart = startOfMonth(date);
  const gStart = startOfWeek(mStart, { weekStartsOn: 0 });
  const gEnd = endOfWeek(endOfMonth(date), { weekStartsOn: 0 });
  const days: Date[] = [];
  for (let d = gStart; d <= gEnd; d = addDays(d, 1)) days.push(d);
  const numWeeks = Math.ceil(days.length / 7);

  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-7 border-b border-border/60">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
          <div key={d} className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{d}</div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${numWeeks}, 1fr)` }}>
        {days.map((day, i) => {
          const cur = isSameMonth(day, date);
          const today = isSameDay(day, new Date());
          const dayEvs = eventsForDay(events, day);
          return (
            <div key={i} onClick={() => onDayClick(day)}
              className={cn('cursor-pointer border-b border-r border-border/40 px-2 pb-1 pt-1.5 transition-colors hover:bg-surface-secondary/30',
                !cur && 'bg-surface-secondary/10')}>
              <div className="mb-1">
                <span className={cn('flex h-7 w-7 items-center justify-center rounded-full text-[13px]',
                  today ? 'bg-primary font-bold text-white' : cur ? 'font-medium text-text-primary' : 'text-text-tertiary/40')}>
                  {format(day, 'd')}
                </span>
              </div>
              <div className="space-y-0.5">
                {dayEvs.slice(0, 3).map((ev) => {
                  const c = tcMap.get(ev.team_id || ev.job?.team_id || '') || FALLBACK_TEAM_COLOR;
                  return (
                    <div key={ev.id} onClick={(e) => { e.stopPropagation(); onEventClick(ev.job_id); }}
                      className="cursor-pointer truncate rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors hover:opacity-80"
                      style={{ backgroundColor: toRgba(c, 0.15), color: c }}>
                      {format(new Date(ev.start_at), 'h:mma').toLowerCase()} {ev.job?.title || 'Job'}
                    </div>
                  );
                })}
                {dayEvs.length > 3 && <div className="px-1.5 text-[10px] font-semibold text-primary">+ {dayEvs.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   CUSTOM AGENDA VIEW (unchanged — no drag in agenda view)
   ════════════════════════════════════════════════════════════════ */
function AgendaView({ events, overlaps, tcMap, teams, onEventClick, onSlotClick }: {
  events: ScheduleEventRecord[]; overlaps: Record<string, number>; tcMap: Map<string, string>;
  teams: TeamRecord[]; onEventClick: (jobId: string) => void; onSlotClick: (s: Date, e: Date) => void;
}) {
  const { t } = useTranslation();
  const sorted = useMemo(() => [...events].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()), [events]);
  const grouped = useMemo(() => {
    const m = new Map<string, ScheduleEventRecord[]>();
    sorted.forEach((ev) => { const k = format(new Date(ev.start_at), 'yyyy-MM-dd'); if (!m.has(k)) m.set(k, []); m.get(k)!.push(ev); });
    return m;
  }, [sorted]);

  if (!sorted.length) return (
    <div className="flex flex-col items-center justify-center py-24 text-text-tertiary">
      <CalendarDays size={40} className="mb-4 opacity-30" />
      <p className="text-sm font-medium">No scheduled events this period</p>
    </div>
  );

  return (
    <div className="divide-y divide-border">
      {Array.from(grouped.entries()).map(([dk, dayEvs]) => {
        const d = new Date(dk + 'T12:00:00');
        const today = isSameDay(d, new Date());
        return (
          <div key={dk}>
            <div className="flex items-center gap-4 px-6 pb-2 pt-5 lg:px-8">
              <span className={cn('text-[11px] font-bold uppercase tracking-[0.1em]', today ? 'text-primary' : 'text-text-tertiary')}>
                {format(d, 'd MMM').toUpperCase()}, {format(d, 'EEEE').toUpperCase()}
              </span>
              <div className="h-px flex-1 bg-border" />
              {today && <span className="rounded-md bg-primary px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">Today</span>}
              <button onClick={() => { const sl = new Date(dk + 'T09:00:00'); onSlotClick(sl, addHours(sl, 2)); }}
                className="rounded-md p-1 text-text-tertiary hover:bg-surface-tertiary hover:text-text-secondary opacity-0 transition-opacity [div:hover>&]:opacity-100">
                <Plus size={14} />
              </button>
            </div>
            <div className="space-y-2 px-6 pb-4 lg:px-8">
              {dayEvs.map((ev) => {
                const tid = ev.team_id || ev.job?.team_id || null;
                const c = tid ? tcMap.get(tid) || FALLBACK_TEAM_COLOR : FALLBACK_TEAM_COLOR;
                const team = tid ? teams.find((t) => t.id === tid) : null;
                const s = new Date(ev.start_at), e = new Date(ev.end_at);
                const ov = overlaps[ev.id] || 0;
                const st = ns(ev.job?.status || ev.status || '');
                const blocked = st === 'blocked' || st === 'late' || st === 'action_required';
                const noTeam = !ev.team_id && !ev.job?.team_id;
                return (
                  <button key={ev.id} onClick={() => ev.job_id && onEventClick(ev.job_id)}
                    className="group w-full overflow-hidden rounded-xl text-left transition-all hover:shadow-md active:scale-[0.998]"
                    style={{ backgroundColor: toRgba(c, 0.08) }}>
                    <div className="flex min-h-[68px]">
                      <div className="w-1.5 shrink-0 rounded-l-xl" style={{ backgroundColor: c }} />
                      <div className="flex min-w-0 flex-1 items-start gap-4 px-5 py-3.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-bold leading-snug" style={{ color: c }}>{ev.job?.title || 'Job'}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary">
                            <span className="font-medium">{format(s, 'h:mm a')} – {format(e, 'h:mm a')}</span>
                            {ev.job?.client_name && <span>{ev.job.client_name}</span>}
                            {ev.job?.property_address && <span className="flex items-center gap-1 text-text-tertiary"><MapPin size={11} />{ev.job.property_address}</span>}
                          </div>
                          {ev.notes && <p className="mt-1.5 text-[11px] leading-relaxed text-text-tertiary line-clamp-2">{ev.notes}</p>}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                          {team && <span className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: toRgba(c, 0.12), color: c }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />{team.name}
                          </span>}
                          {ev.job?.total_cents ? <span className="text-[12px] font-bold text-text-primary">{formatCurrency((ev.job.total_cents || 0) / 100)}</span> : null}
                          {ov > 0 && <span className="flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"><CircleAlert size={10} />{t.schedule.overlapping}</span>}
                          {noTeam && <span className="rounded-md bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600">{t.schedule.unassigned}</span>}
                          {blocked && <span className="flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600"><AlertTriangle size={10} />{t.schedule.needsAttention}</span>}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   MINI CALENDAR (popover)
   ════════════════════════════════════════════════════════════════ */
function MiniCal({ date, onSelect }: { date: Date; onSelect: (d: Date) => void }) {
  const [anchor, setAnchor] = useState(date);
  useEffect(() => setAnchor(date), [date]);
  const mStart = startOfMonth(anchor);
  const gStart = startOfWeek(mStart, { weekStartsOn: 0 });
  const gEnd = endOfWeek(endOfMonth(anchor), { weekStartsOn: 0 });
  const days: Date[] = [];
  for (let d = gStart; d <= gEnd; d = addDays(d, 1)) days.push(d);
  return (
    <div className="w-[252px]">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[13px] font-semibold text-text-primary">{format(anchor, 'MMMM yyyy')}</span>
        <div className="flex gap-0.5">
          <button onClick={() => setAnchor(addMonths(anchor, -1))} className="rounded p-0.5 hover:bg-surface-tertiary text-text-secondary"><ChevronLeft size={14} /></button>
          <button onClick={() => setAnchor(addMonths(anchor, 1))} className="rounded p-0.5 hover:bg-surface-tertiary text-text-secondary"><ChevronRight size={14} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 text-center">
        {days.map((day, i) => {
          const today = isSameDay(day, new Date()), cur = isSameMonth(day, anchor), sel = isSameDay(day, date);
          return (
            <button key={i} onClick={() => onSelect(day)}
              className={cn('mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs transition-all',
                !cur && 'text-text-tertiary/50', cur && !sel && !today && 'text-text-primary hover:bg-surface-tertiary',
                today && !sel && 'font-bold text-primary', sel && 'bg-primary text-white font-semibold shadow-sm')}>
              {format(day, 'd')}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   SCHEDULE CONTENT (main orchestrator)
   ════════════════════════════════════════════════════════════════ */
function ScheduleContent() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { selectedDate, view, selectedTeamIds, hasTeamsParam, setDate, setView, setSelectedTeamIds, toggleTeam, goToday, goPrev, goNext } = useCalendarController();
  const { openJobModal } = useJobModalController();

  const [isOpeningJob, setIsOpeningJob] = useState(false);
  const [unassignedMode, setUnassignedMode] = useState(false);
  const [assignModalJob, setAssignModalJob] = useState<UnscheduledJobRecord | ScheduleEventRecord | null>(null);
  const [activeFilter, setActiveFilter] = useState<QF>('all');
  const [teamPickerDrop, setTeamPickerDrop] = useState<{ jobId: string; startAt: string; endAt: string; revert: () => void; removeEvent: () => void } | null>(null);
  const [teamSlots, setTeamSlots] = useState<Map<string, FreeSlot[]>>(new Map());
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [viewDrop, setViewDrop] = useState(false);
  const [calPop, setCalPop] = useState(false);
  const [teamPop, setTeamPop] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const hydratedRef = useRef(false);

  const dateKey = format(selectedDate, 'yyyy-MM-dd');
  const label = hLabel(selectedDate, view);

  /* ── Data ── */
  const { data: orgId } = useQuery({ queryKey: ['currentOrgId'], queryFn: getCurrentOrgId });
  const teamsQ = useQuery({ queryKey: ['teams', orgId || '-'], queryFn: listTeams, enabled: !!orgId, staleTime: 5 * 60_000 });
  const teams = teamsQ.data || [];

  useEffect(() => {
    if (!teams.length || hydratedRef.current) return;
    hydratedRef.current = true;
    if (!hasTeamsParam && selectedTeamIds.length === 0) setSelectedTeamIds(teams.map((t) => t.id));
  }, [hasTeamsParam, selectedTeamIds.length, setSelectedTeamIds, teams]);

  // Reset hydration when org changes so team filter re-syncs to the new org's teams
  useEffect(() => {
    hydratedRef.current = false;
    setSelectedTeamIds([]);
  }, [orgId, setSelectedTeamIds]);

  const allSel = teams.length > 0 && selectedTeamIds.length === teams.length;
  const noneSel = teams.length > 0 && selectedTeamIds.length === 0;
  const effTeams = useMemo(() => allSel ? [] : selectedTeamIds, [allSel, selectedTeamIds]);
  const tKey = useMemo(() => allSel ? 'all' : selectedTeamIds.length === 0 ? 'none' : [...selectedTeamIds].sort().join(','), [allSel, selectedTeamIds]);
  const range = useMemo(() => buildRange(selectedDate, view), [selectedDate, view]);

  const evQ = useQuery({
    queryKey: ['calendarEvents', orgId || '-', view, dateKey, tKey, unassignedMode ? 'u' : 't'],
    enabled: !!orgId && (!noneSel || unassignedMode),
    staleTime: 30_000,
    queryFn: () => unassignedMode
      ? listUnassignedScheduledEvents({ startAt: range.start.toISOString(), endAt: range.end.toISOString() })
      : listScheduleEventsRange({ startAt: range.start.toISOString(), endAt: range.end.toISOString(), teamIds: effTeams }),
  });
  const unschedQ = useQuery({
    queryKey: ['calendarUnscheduledJobs', orgId || '-', tKey, unassignedMode ? 'u' : 't'],
    enabled: !!orgId,
    staleTime: 30_000,
    queryFn: () => unassignedMode ? listUnassignedUnscheduledJobs() : listUnscheduledJobs(noneSel ? [] : effTeams),
  });

  const events = evQ.data || [];
  const unscheduledJobs = unschedQ.data || [];

  /* ── Mutations ── */
  const refresh = useCallback(() => { invalidateScheduleCache(); qc.invalidateQueries({ queryKey: ['calendarEvents'] }); qc.invalidateQueries({ queryKey: ['calendarUnscheduledJobs'] }); }, [qc]);

  const rescheduleMut = useMutation({ mutationFn: rescheduleEvent, onSuccess: refresh });
  const scheduleMut = useMutation({
    mutationFn: scheduleUnscheduledJob,
    onSuccess: () => { refresh(); toast.success(t.schedule.jobScheduled); },
    onError: (e: any) => toast.error(e?.message || t.schedule.couldNotSchedule),
  });
  const assignMut = useMutation({
    mutationFn: ({ jobId, teamId }: { jobId: string; teamId: string }) => assignJobToTeam(jobId, teamId),
    onSuccess: async () => { refresh(); setAssignModalJob(null); toast.success(t.schedule.jobAssigned); },
    onError: (e: any) => toast.error(e?.message || t.schedule.couldNotAssign),
  });

  /* ── Drag & Drop ── */
  const dnd = useCalendarDnd({
    onReschedule: async (eventId, startAt, endAt, teamId) => {
      try {
        const result = await rescheduleMut.mutateAsync({ eventId, startAt, endAt, teamId, timezone: DEFAULT_TIMEZONE });
        if (result.overlaps > 0) toast.warning(t.schedule.overlapping);
        else toast.success('Event moved');
      } catch (err: any) {
        toast.error(err?.message || 'Failed to reschedule');
        throw err;
      }
    },
    onScheduleJob: async (jobId, startAt, endAt, teamId) => {
      if (teamId) {
        await scheduleMut.mutateAsync({ jobId, teamId, startAt, endAt, timezone: DEFAULT_TIMEZONE });
      } else if (selectedTeamIds.length === 1) {
        await scheduleMut.mutateAsync({ jobId, teamId: selectedTeamIds[0], startAt, endAt, timezone: DEFAULT_TIMEZONE });
      } else {
        // Need team picker
        setTeamPickerDrop({ jobId, startAt, endAt, revert: () => {}, removeEvent: () => {} });
      }
    },
    onResizeEvent: async (eventId, startAt, endAt) => {
      try {
        const result = await rescheduleMut.mutateAsync({ eventId, startAt, endAt, timezone: DEFAULT_TIMEZONE });
        if (result.overlaps > 0) toast.warning(t.schedule.overlapping);
        else toast.success('Duration updated');
      } catch (err: any) {
        toast.error(err?.message || 'Failed to resize');
        throw err;
      }
    },
  });

  // Grid drag handlers
  const handleEventDragStart = useCallback((ev: ScheduleEventRecord, e: React.PointerEvent, gridEl: HTMLElement) => {
    const rect = gridEl.getBoundingClientRect();
    dnd.startEventDrag(ev, e.clientY, rect.top);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [dnd]);

  const handleResizeStart = useCallback((ev: ScheduleEventRecord, e: React.PointerEvent) => {
    dnd.startResize(ev, e.clientY);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [dnd]);

  const handleGridPointerMove = useCallback((e: React.PointerEvent, gridEl: HTMLElement) => {
    const rect = gridEl.getBoundingClientRect();
    // Determine which column we're over
    const timeColStart = 56; // px for time label column
    const gridWidth = rect.width - timeColStart;
    const relX = e.clientX - rect.left - timeColStart;
    const cols = view === 'week' ? 7 : 1;
    const colIndex = Math.max(0, Math.min(cols - 1, Math.floor((relX / gridWidth) * cols)));

    dnd.updateDragPosition(e.clientY, rect.top, colIndex);
  }, [dnd, view]);

  const handleGridPointerUp = useCallback((e: React.PointerEvent, columns: Date[]) => {
    if (!dnd.dragState.active) return;

    if (dnd.dragState.active.type === 'resize-bottom') {
      dnd.completeResize();
      return;
    }

    // Calculate drop position
    const ghostTop = dnd.dragState.ghostTop;
    if (ghostTop == null) {
      dnd.cancelDrag();
      return;
    }

    const snappedMin = snapToGrid(pxToMinutes(ghostTop));
    const dropHour = Math.floor(snappedMin / 60);
    const dropMinute = snappedMin % 60;
    const colIdx = dnd.dragState.ghostColIndex ?? 0;
    const dropDate = columns[colIdx] || columns[0];

    dnd.completeDrop(dropDate, dropHour, dropMinute).catch(() => {});
  }, [dnd]);

  /* ── Computed ── */
  // Stable "now" — only refreshed when the underlying events list changes,
  // so derived memos (filtered, overlaps, counts) don't invalidate on every render.
  const now = useMemo(() => new Date(), [evQ.dataUpdatedAt]);
  const c30 = useMemo(() => events.filter((e) => isEnd30(e, now)).length, [events, now]);
  const cInv = useMemo(() => events.filter(reqInv).length, [events]);
  const cAtt = useMemo(() => events.filter(needsAtt).length, [events]);
  const filtered = useMemo(() => {
    if (activeFilter === 'all') return events;
    if (activeFilter === 'ending_30') return events.filter((e) => isEnd30(e, now));
    if (activeFilter === 'requires_invoicing') return events.filter(reqInv);
    return events.filter(needsAtt);
  }, [events, activeFilter, now]);
  const overlaps = useMemo(() => computeOverlaps(filtered), [filtered]);
  const tcMap = useMemo(() => { const m = new Map<string, string>(); teams.forEach((t) => m.set(t.id, isHexColor(t.color_hex) ? t.color_hex : FALLBACK_TEAM_COLOR)); return m; }, [teams]);

  /* ── Handlers ── */
  const openCreate = (start: Date, end?: Date) => {
    openJobModal({ initialValues: { scheduled_at: start.toISOString(), end_at: (end || addHours(start, 2)).toISOString(), team_id: selectedTeamIds.length === 1 ? selectedTeamIds[0] : null, status: 'scheduled' }, sourceContext: { type: 'jobs' }, onCreated: refresh });
  };
  const openExisting = async (jobId: string) => {
    if (isOpeningJob) return; setIsOpeningJob(true);
    try { const d = await getJobModalDraftById(jobId); if (!d) { toast.error(t.schedule.jobNotFound); return; } openJobModal({ initialValues: d, jobId: d.id, sourceContext: { type: 'jobs' }, onCreated: refresh }); }
    catch { toast.error(t.schedule.couldNotOpenJob); } finally { setIsOpeningJob(false); }
  };
  const handleExtDrop = async (jobId: string, s: Date, e: Date) => {
    if (selectedTeamIds.length === 1) {
      try { await scheduleMut.mutateAsync({ jobId, teamId: selectedTeamIds[0], startAt: s.toISOString(), endAt: e.toISOString(), timezone: DEFAULT_TIMEZONE }); }
      catch (err: any) { toast.error(err?.message || t.schedule.couldNotSchedule); }
    } else { setTeamPickerDrop({ jobId, startAt: s.toISOString(), endAt: e.toISOString(), revert: () => {}, removeEvent: () => {} }); }
  };
  const pickTeam = async (teamId: string | null) => {
    if (!teamPickerDrop) return;
    try { await scheduleMut.mutateAsync({ jobId: teamPickerDrop.jobId, teamId, startAt: teamPickerDrop.startAt, endAt: teamPickerDrop.endAt, timezone: DEFAULT_TIMEZONE }); }
    catch (err: any) { toast.error(err?.message || t.schedule.couldNotSchedule); }
    finally { setTeamPickerDrop(null); }
  };

  /* ── Realtime ── */
  useEffect(() => {
    if (!orgId) return;
    // Debounce invalidations: realtime can burst many events; one refetch per burst is plenty.
    let evTimer: ReturnType<typeof setTimeout> | null = null;
    let teamTimer: ReturnType<typeof setTimeout> | null = null;
    const invEvents = () => {
      if (evTimer) return;
      evTimer = setTimeout(() => {
        evTimer = null;
        qc.invalidateQueries({ queryKey: ['calendarEvents'] });
        qc.invalidateQueries({ queryKey: ['calendarUnscheduledJobs'] });
      }, 400);
    };
    const invTeams = () => {
      if (teamTimer) return;
      teamTimer = setTimeout(() => {
        teamTimer = null;
        qc.invalidateQueries({ queryKey: ['teams'] });
      }, 400);
    };

    const ch = supabase.channel(`cal-rt-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_events', filter: `org_id=eq.${orgId}` }, invEvents)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `org_id=eq.${orgId}` }, invEvents)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `org_id=eq.${orgId}` }, invTeams)
      .subscribe();
    return () => {
      if (evTimer) clearTimeout(evTimer);
      if (teamTimer) clearTimeout(teamTimer);
      supabase.removeChannel(ch);
    };
  }, [orgId, qc]);

  /* Free slots */
  useEffect(() => {
    if (!teamPickerDrop || !teams.length) return; setLoadingSlots(true);
    Promise.all(teams.map((t) => findFreeSlots({ teamId: t.id, days: 1, slotDuration: 60 }).then((s) => [t.id, s] as [string, FreeSlot[]])))
      .then((r) => { setTeamSlots(new Map(r)); setLoadingSlots(false); }).catch(() => setLoadingSlots(false));
  }, [teamPickerDrop, teams]);

  // Build columns for TimeGrid
  const weekColumns = useMemo(() => {
    const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [selectedDate]);
  const dayColumns = useMemo(() => [selectedDate], [selectedDate]);

  const viewOpts: { id: CalendarUiView; label: string; icon: React.ReactNode }[] = [
    { id: 'month', label: t.schedule.month, icon: <CalendarDays size={14} /> },
    { id: 'week', label: t.schedule.week, icon: <SlidersHorizontal size={14} /> },
    { id: 'day', label: t.schedule.day, icon: <Clock size={14} /> },
    { id: 'agenda', label: (t.schedule as any).agenda || 'Agenda', icon: <List size={14} /> },
  ];
  const filters: { id: QF; label: string; count: number }[] = [
    { id: 'all', label: t.schedule.all, count: events.length },
    { id: 'ending_30', label: t.schedule.endingWithin30, count: c30 },
    { id: 'requires_invoicing', label: t.schedule.requiresInvoicing, count: cInv },
    { id: 'needs_attention', label: t.schedule.needsAttention, count: cAtt },
  ];

  // Shared TimeGrid DnD props
  const timeGridDndProps = {
    isDragging: dnd.isDragging,
    isAnyDragActive: dnd.isAnyDragActive,
    dragState: dnd.dragState,
    applyOptimistic: dnd.applyOptimistic,
    onEventDragStart: handleEventDragStart,
    onResizeStart: handleResizeStart,
    onGridPointerMove: handleGridPointerMove,
    onGridPointerUp: handleGridPointerUp,
    onDragSlotDrop: () => {},
  };

  /* ════════════════ RENDER ════════════════ */
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* TOOLBAR */}
      <header className="relative z-20 flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5 lg:px-6">
        <button onClick={goToday} className="rounded-lg border border-border px-3 py-[5px] text-[13px] font-semibold text-text-primary hover:bg-surface-secondary transition-colors">{t.schedule.today}</button>
        <button onClick={goPrev} className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-secondary transition-colors"><ChevronLeft size={18} /></button>
        <button onClick={goNext} className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-secondary transition-colors"><ChevronRight size={18} /></button>
        <div className="relative">
          <button onClick={() => setCalPop(!calPop)} className="flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-surface-secondary transition-colors">
            <h1 className="text-[17px] font-bold text-text-primary">{label}</h1>
            <ChevronDown size={14} className="text-text-tertiary" />
          </button>
          {calPop && (<><div className="fixed inset-0 z-30" onClick={() => setCalPop(false)} /><div className="absolute left-0 top-full z-40 mt-1 rounded-xl border border-border bg-surface p-3 shadow-xl"><MiniCal date={selectedDate} onSelect={(d) => { setDate(d); setCalPop(false); }} /></div></>)}
        </div>
        <div className="flex-1" />

        {/* Teams */}
        <div className="relative">
          <button onClick={() => setTeamPop(!teamPop)} className={cn('flex items-center gap-1.5 rounded-lg border px-2.5 py-[5px] text-[13px] font-medium transition-colors', teamPop ? 'border-primary/30 bg-primary/5 text-primary' : 'border-border text-text-secondary hover:bg-surface-secondary')}>
            <Users size={14} />{t.schedule.teams}
            {selectedTeamIds.length > 0 && selectedTeamIds.length < teams.length && <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-bold text-primary">{selectedTeamIds.length}</span>}
          </button>
          {teamPop && (<><div className="fixed inset-0 z-30" onClick={() => setTeamPop(false)} /><div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border border-border bg-surface p-2 shadow-xl">
            <div className="mb-1.5 flex items-center justify-between px-2"><button onClick={() => setSelectedTeamIds(teams.map((t) => t.id))} className="text-[11px] font-semibold text-primary hover:underline">{t.schedule.allTeams}</button><button onClick={() => setSelectedTeamIds([])} className="text-[11px] font-medium text-text-tertiary hover:underline">{t.schedule.clear}</button></div>
            <button onClick={() => { setUnassignedMode(!unassignedMode); setTeamPop(false); }} className={cn('mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] font-medium transition-colors', unassignedMode ? 'bg-primary/5 text-primary' : 'text-text-secondary hover:bg-surface-secondary')}>{unassignedMode ? <UserCheck size={13} /> : <UserPlus size={13} />}{t.schedule.unassigned}</button>
            <div className="max-h-52 space-y-0.5 overflow-y-auto">{teams.map((tm) => { const c = isHexColor(tm.color_hex) ? tm.color_hex : FALLBACK_TEAM_COLOR; const on = selectedTeamIds.includes(tm.id); return (<button key={tm.id} onClick={() => toggleTeam(tm.id)} className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] transition-colors', on ? 'bg-surface-secondary font-medium text-text-primary' : 'text-text-secondary hover:bg-surface-tertiary')}><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c }} /><span className="flex-1 truncate text-left">{tm.name}</span>{on && <span className="text-primary"><svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg></span>}</button>); })}</div>
          </div></>)}
        </div>

        {/* Filters */}
        <div className="hidden items-center gap-1 lg:flex">
          {filters.map((f) => (<button key={f.id} onClick={() => setActiveFilter(f.id)} className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors', activeFilter === f.id ? 'bg-primary text-white' : 'text-text-tertiary hover:bg-surface-secondary hover:text-text-secondary')}>{f.label} <span className={cn('ml-1 text-[10px]', activeFilter === f.id ? 'text-white/70' : 'text-text-tertiary')}>{f.count}</span></button>))}
        </div>

        {/* View dropdown */}
        <div className="relative">
          <button onClick={() => setViewDrop(!viewDrop)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-[5px] text-[13px] font-medium text-text-primary hover:bg-surface-secondary transition-colors">
            {viewOpts.find((v) => v.id === view)?.icon}{viewOpts.find((v) => v.id === view)?.label}<ChevronDown size={13} className="text-text-tertiary" />
          </button>
          {viewDrop && (<><div className="fixed inset-0 z-30" onClick={() => setViewDrop(false)} /><div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-xl border border-border bg-surface py-1 shadow-xl">{viewOpts.map((v) => (<button key={v.id} onClick={() => { setView(v.id); setViewDrop(false); }} className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition-colors', view === v.id ? 'bg-primary/5 font-semibold text-primary' : 'text-text-primary hover:bg-surface-secondary')}>{v.icon}{v.label}</button>))}</div></>)}
        </div>

        {/* Drawer toggle */}
        <button onClick={() => setDrawerOpen(!drawerOpen)} className={cn('relative rounded-lg border p-[5px] transition-colors', drawerOpen ? 'border-primary/30 bg-primary/5 text-primary' : 'border-border text-text-secondary hover:bg-surface-secondary')} title={t.schedule.unscheduledJobs}>
          {drawerOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          {unscheduledJobs.length > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">{unscheduledJobs.length}</span>}
        </button>

        <button onClick={refresh} className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-secondary transition-colors" title={t.schedule.refresh}><RefreshCw size={15} /></button>
        <button onClick={() => openCreate(selectedDate)} className="flex items-center gap-1.5 rounded-lg bg-text-primary px-3.5 py-[6px] text-[13px] font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"><Plus size={14} strokeWidth={2.5} />{t.schedule.scheduleJob}</button>
      </header>

      {/* BODY */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-hidden bg-surface">
          {evQ.isLoading ? <div className="h-full animate-pulse bg-surface-secondary/50" /> :
           noneSel && !unassignedMode ? (
            <div className="grid h-full place-items-center"><div className="text-center"><Users className="mx-auto mb-2 text-text-tertiary" size={32} /><p className="text-sm font-semibold text-text-primary">{t.schedule.noTeamsSelected}</p><p className="mt-1 text-xs text-text-secondary">{t.schedule.noTeamsSelectedMsg}</p></div></div>
          ) : view === 'month' ? (
            <MonthView date={selectedDate} events={filtered} tcMap={tcMap} onDayClick={(d) => { setDate(d); setView('day'); }} onEventClick={(id) => void openExisting(id)} />
          ) : view === 'week' ? (
            <TimeGrid columns={weekColumns} events={filtered} tcMap={tcMap} onSlotClick={(s) => openCreate(s)} onEventClick={(id) => void openExisting(id)} {...timeGridDndProps} />
          ) : view === 'day' ? (
            <TimeGrid columns={dayColumns} events={filtered} tcMap={tcMap} onSlotClick={(s) => openCreate(s)} onEventClick={(id) => void openExisting(id)} {...timeGridDndProps} />
          ) : view === 'agenda' ? (
            <div className="h-full overflow-y-auto"><AgendaView events={filtered} overlaps={overlaps} tcMap={tcMap} teams={teams} onEventClick={(id) => void openExisting(id)} onSlotClick={(s, e) => openCreate(s, e)} /></div>
          ) : null}
        </div>

        {/* Drawer — Unscheduled jobs with drag support */}
        {drawerOpen && (
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2"><Briefcase size={14} className="text-text-secondary" /><h3 className="text-[13px] font-semibold text-text-primary">{t.schedule.unscheduledJobs}</h3></div>
              <span className="rounded-md bg-surface-tertiary px-2 py-0.5 text-[11px] font-bold text-text-secondary">{unscheduledJobs.length}</span>
            </div>
            <div className="space-y-2 p-3">
              {unscheduledJobs.length === 0 && <p className="py-8 text-center text-xs text-text-tertiary">{t.schedule.noUnscheduledJobs}</p>}
              {unscheduledJobs.map((job) => {
                const c = job.team_id ? tcMap.get(job.team_id) || FALLBACK_TEAM_COLOR : FALLBACK_TEAM_COLOR;
                const dragging = dnd.isDraggingJob(job.id);
                return (
                  <div
                    key={job.id}
                    className={cn(
                      'group rounded-xl border border-border bg-surface p-3 transition-all select-none',
                      dragging
                        ? 'opacity-40 ring-2 ring-primary/40 shadow-xl cursor-grabbing'
                        : 'cursor-grab hover:shadow-md active:cursor-grabbing',
                    )}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      dnd.startUnscheduledDrag(job);
                      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical size={14} className="mt-0.5 shrink-0 text-text-tertiary opacity-0 group-hover:opacity-60 transition-opacity" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full shadow-sm" style={{ backgroundColor: c }} /><span className="truncate text-[13px] font-semibold text-text-primary">{job.title}</span></div>
                        {job.client_name && <p className="mt-0.5 truncate text-[11px] text-text-secondary">{job.client_name}</p>}
                        {job.property_address && <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-text-tertiary"><MapPin size={9} />{job.property_address}</p>}
                        <div className="mt-1.5 flex items-center justify-between">
                          {job.total_cents ? <span className="text-[11px] font-semibold text-text-primary">{formatCurrency((job.total_cents || 0) / 100)}</span> : <span />}
                          {!job.team_id && <button onClick={(e) => { e.stopPropagation(); setAssignModalJob(job); }} className="rounded-md bg-primary/5 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/10 transition-colors">{t.schedule.assignToTeam}</button>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        )}
      </div>

      {/* TEAM PICKER MODAL */}
      {teamPickerDrop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between"><div><h2 className="text-[15px] font-bold text-text-primary">{t.schedule.assignToTeamTitle}</h2><p className="mt-0.5 text-xs text-text-secondary">{t.schedule.assignToTeamDesc}</p></div><button onClick={() => { setTeamPickerDrop(null); }} className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-tertiary"><XIcon size={16} /></button></div>
            <div className="space-y-1.5">
              {teams.map((tm) => { const c = isHexColor(tm.color_hex) ? tm.color_hex : FALLBACK_TEAM_COLOR; const slots = teamSlots.get(tm.id) || []; return (
                <button key={tm.id} onClick={() => pickTeam(tm.id)} className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left hover:bg-surface-secondary transition-colors">
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full shadow-sm" style={{ backgroundColor: c }} />
                  <div className="min-w-0 flex-1"><span className="text-[13px] font-semibold text-text-primary">{tm.name}</span><p className="mt-0.5 text-[11px] text-text-tertiary">{loadingSlots ? '...' : slots.length > 0 ? slots.slice(0, 3).map((s) => `${s.start_time}–${s.end_time}`).join(', ') : t.schedule.noSlotsToday}</p></div>
                </button>); })}
              <button onClick={() => pickTeam(null)} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border p-3 text-[13px] text-text-secondary hover:bg-surface-secondary transition-colors">{t.schedule.scheduleWithoutTeam}</button>
            </div>
          </div>
        </div>
      )}

      {/* ASSIGN MODAL */}
      {assignModalJob && <AssignModal job={assignModalJob} teams={teams} events={events} tcMap={tcMap} onAssign={(tid) => assignMut.mutate({ jobId: 'id' in assignModalJob ? assignModalJob.id : '', teamId: tid })} onClose={() => setAssignModalJob(null)} loading={assignMut.isPending} t={t} />}
    </div>
  );
}

/* ── Assign Modal ── */
function AssignModal({ job, teams, events, tcMap, onAssign, onClose, loading, t }: {
  job: UnscheduledJobRecord | ScheduleEventRecord; teams: TeamRecord[]; events: ScheduleEventRecord[];
  tcMap: Map<string, string>; onAssign: (tid: string) => void; onClose: () => void; loading: boolean; t: any;
}) {
  const title = 'title' in job ? job.title : (job as ScheduleEventRecord).job?.title || 'Job';
  const client = 'client_name' in job ? job.client_name : (job as ScheduleEventRecord).job?.client_name;
  const addr = 'property_address' in job ? job.property_address : (job as ScheduleEventRecord).job?.property_address;
  const wl = useMemo(() => { const c = new Map<string, number>(); const td = format(new Date(), 'yyyy-MM-dd'); events.forEach((e) => { const tid = e.team_id || e.job?.team_id; if (tid && e.start_at.startsWith(td)) c.set(tid, (c.get(tid) || 0) + 1); }); return c; }, [events]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-[15px] font-bold text-text-primary">{t.schedule.assignToTeamTitle}</h2><button onClick={onClose} className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-tertiary"><XIcon size={16} /></button></div>
        <div className="mb-4 rounded-xl bg-surface-secondary p-3"><p className="text-[13px] font-semibold text-text-primary">{title}</p>{client && <p className="mt-0.5 text-[11px] text-text-secondary">{client}</p>}{addr && <p className="mt-0.5 flex items-center gap-1 text-[11px] text-text-tertiary"><MapPin size={9} />{addr}</p>}</div>
        <div className="space-y-1.5">{teams.map((tm) => { const c = tcMap.get(tm.id) || FALLBACK_TEAM_COLOR; const w = wl.get(tm.id) || 0; return (
          <button key={tm.id} onClick={() => onAssign(tm.id)} disabled={loading} className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left hover:bg-surface-secondary transition-colors disabled:opacity-50">
            <span className="h-3.5 w-3.5 shrink-0 rounded-full shadow-sm" style={{ backgroundColor: c }} /><div className="flex-1"><span className="text-[13px] font-semibold text-text-primary">{tm.name}</span>{w > 0 && <span className="ml-2 text-[11px] text-text-tertiary">{w} {t.schedule.teamWorkload}</span>}</div>
          </button>); })}</div>
      </div>
    </div>
  );
}

/* ═══ EXPORT ═══ */
export default function Schedule() {
  return <CalendarControllerProvider><ScheduleContent /></CalendarControllerProvider>;
}
