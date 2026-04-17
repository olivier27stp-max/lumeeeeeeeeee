/**
 * useCalendarDnd — Drag & Drop logic for the Schedule calendar.
 *
 * Handles:
 * - Dragging existing events to new time slots (reschedule)
 * - Dragging events between days
 * - Dragging unscheduled jobs onto the calendar (schedule)
 * - Resizing events (change duration)
 * - Optimistic UI updates with rollback on error
 *
 * Uses @dnd-kit/core for the drag mechanics.
 */

import { useCallback, useRef, useState } from 'react';
import type { ScheduleEventRecord, UnscheduledJobRecord } from '../lib/scheduleApi';

// ── Snap grid ──────────────────────────────────────────────────────

export const SNAP_MINUTES = 15;
export const SLOT_HEIGHT_PX = 52; // px per hour row (matches Schedule.tsx)
const PX_PER_MINUTE = SLOT_HEIGHT_PX / 60;

/** Snap a minute value to the nearest grid increment */
export function snapToGrid(minutes: number, gridMinutes = SNAP_MINUTES): number {
  return Math.round(minutes / gridMinutes) * gridMinutes;
}

/** Convert a pixel offset from the top of the time grid to minutes */
export function pxToMinutes(px: number): number {
  return px / PX_PER_MINUTE;
}

/** Convert minutes to px offset */
export function minutesToPx(minutes: number): number {
  return minutes * PX_PER_MINUTE;
}

// ── Drag data types ────────────────────────────────────────────────

export interface CalendarDragData {
  type: 'event' | 'unscheduled' | 'resize-bottom';
  eventId?: string;
  jobId: string;
  /** Original event for rollback */
  originalEvent?: ScheduleEventRecord;
  /** Original start/end for resize */
  originalStartAt?: string;
  originalEndAt?: string;
  teamId?: string | null;
}

export interface CalendarDropResult {
  /** Target date (YYYY-MM-DD) */
  date: string;
  /** Target hour (0-23) */
  hour: number;
  /** Target minute (snapped) */
  minute: number;
  /** Target column index (for week view) */
  colIndex?: number;
  /** Target team ID (if dropping on team column) */
  teamId?: string | null;
}

// ── Drag state ─────────────────────────────────────────────────────

export interface DragState {
  /** Currently being dragged */
  active: CalendarDragData | null;
  /** Ghost preview position (top px, left info) */
  ghostTop: number | null;
  ghostDate: string | null;
  ghostColIndex: number | null;
  /** Preview duration in minutes (for resize) */
  previewDuration: number | null;
  /** Whether drag is over a valid drop zone */
  isOverDropZone: boolean;
}

const INITIAL_STATE: DragState = {
  active: null,
  ghostTop: null,
  ghostDate: null,
  ghostColIndex: null,
  previewDuration: null,
  isOverDropZone: false,
};

// ── Hook ───────────────────────────────────────────────────────────

export interface UseCalendarDndOptions {
  onReschedule: (eventId: string, startAt: string, endAt: string, teamId?: string | null) => Promise<void>;
  onScheduleJob: (jobId: string, startAt: string, endAt: string, teamId?: string | null) => Promise<void>;
  onResizeEvent: (eventId: string, startAt: string, endAt: string) => Promise<void>;
  defaultDurationMinutes?: number;
}

export function useCalendarDnd(options: UseCalendarDndOptions) {
  const { onReschedule, onScheduleJob, onResizeEvent, defaultDurationMinutes = 120 } = options;
  const [dragState, setDragState] = useState<DragState>(INITIAL_STATE);
  const [optimisticUpdates, setOptimisticUpdates] = useState<Map<string, Partial<ScheduleEventRecord>>>(new Map());
  const dragStartY = useRef<number>(0);
  const dragStartMinuteOffset = useRef<number>(0);

  /** Start dragging an existing event */
  const startEventDrag = useCallback((
    event: ScheduleEventRecord,
    pointerY: number,
    gridTopY: number,
  ) => {
    const startMin = new Date(event.start_at).getHours() * 60 + new Date(event.start_at).getMinutes();
    const topPx = minutesToPx(startMin);
    // Calculate offset from pointer to event top
    const eventTopInGrid = topPx;
    const pointerInGrid = pointerY - gridTopY;
    dragStartMinuteOffset.current = pxToMinutes(pointerInGrid - eventTopInGrid);
    dragStartY.current = pointerY;

    setDragState({
      active: {
        type: 'event',
        eventId: event.id,
        jobId: event.job_id,
        originalEvent: event,
        originalStartAt: event.start_at,
        originalEndAt: event.end_at,
        teamId: event.team_id || event.job?.team_id || null,
      },
      ghostTop: topPx,
      ghostDate: null,
      ghostColIndex: null,
      previewDuration: null,
      isOverDropZone: false,
    });
  }, []);

  /** Start dragging an unscheduled job from the sidebar */
  const startUnscheduledDrag = useCallback((job: UnscheduledJobRecord) => {
    setDragState({
      active: {
        type: 'unscheduled',
        jobId: job.id,
        teamId: job.team_id,
      },
      ghostTop: null,
      ghostDate: null,
      ghostColIndex: null,
      previewDuration: null,
      isOverDropZone: false,
    });
  }, []);

  /** Start resize from bottom handle */
  const startResize = useCallback((
    event: ScheduleEventRecord,
    pointerY: number,
  ) => {
    dragStartY.current = pointerY;
    setDragState({
      active: {
        type: 'resize-bottom',
        eventId: event.id,
        jobId: event.job_id,
        originalEvent: event,
        originalStartAt: event.start_at,
        originalEndAt: event.end_at,
        teamId: event.team_id,
      },
      ghostTop: null,
      ghostDate: null,
      ghostColIndex: null,
      previewDuration: null,
      isOverDropZone: true,
    });
  }, []);

  /** Update ghost position during drag */
  const updateDragPosition = useCallback((
    pointerY: number,
    gridTopY: number,
    colIndex?: number,
    dateStr?: string,
  ) => {
    if (!dragState.active) return;

    if (dragState.active.type === 'resize-bottom') {
      // Resize: compute new duration based on drag delta
      const deltaY = pointerY - dragStartY.current;
      const deltaMinutes = pxToMinutes(deltaY);
      const original = dragState.active.originalEvent!;
      const origDur = (new Date(original.end_at).getTime() - new Date(original.start_at).getTime()) / 60000;
      const newDur = snapToGrid(Math.max(15, origDur + deltaMinutes));
      setDragState(prev => ({ ...prev, previewDuration: newDur, isOverDropZone: true }));
      return;
    }

    // Move: compute new top position
    const pointerInGrid = pointerY - gridTopY;
    const rawMinute = pxToMinutes(pointerInGrid) - dragStartMinuteOffset.current;
    const snappedMinute = snapToGrid(Math.max(0, Math.min(rawMinute, 23 * 60 + 45)));
    const topPx = minutesToPx(snappedMinute);

    setDragState(prev => ({
      ...prev,
      ghostTop: topPx,
      ghostColIndex: colIndex ?? prev.ghostColIndex,
      ghostDate: dateStr ?? prev.ghostDate,
      isOverDropZone: true,
    }));
  }, [dragState.active]);

  /** Cancel drag — reset to initial state */
  const cancelDrag = useCallback(() => {
    setDragState(INITIAL_STATE);
  }, []);

  /** Complete the drop */
  const completeDrop = useCallback(async (
    dropDate: Date,
    dropHour: number,
    dropMinute: number,
    dropTeamId?: string | null,
  ) => {
    const active = dragState.active;
    if (!active) return;

    // Build new start/end
    const newStart = new Date(dropDate);
    const snappedMin = snapToGrid(dropMinute);
    newStart.setHours(dropHour, snappedMin, 0, 0);

    // Reset drag state immediately for responsive feel
    setDragState(INITIAL_STATE);

    if (active.type === 'event' && active.eventId) {
      // Reschedule existing event
      const original = active.originalEvent!;
      const durationMs = new Date(original.end_at).getTime() - new Date(original.start_at).getTime();
      const newEnd = new Date(newStart.getTime() + durationMs);
      const teamId = dropTeamId !== undefined ? dropTeamId : active.teamId;

      // Optimistic update
      setOptimisticUpdates(prev => {
        const next = new Map(prev);
        next.set(active.eventId!, {
          start_at: newStart.toISOString(),
          end_at: newEnd.toISOString(),
          team_id: teamId ?? null,
        });
        return next;
      });

      try {
        await onReschedule(active.eventId, newStart.toISOString(), newEnd.toISOString(), teamId);
      } catch (err) {
        // Rollback optimistic update
        setOptimisticUpdates(prev => {
          const next = new Map(prev);
          next.delete(active.eventId!);
          return next;
        });
        throw err;
      } finally {
        setOptimisticUpdates(prev => {
          const next = new Map(prev);
          next.delete(active.eventId!);
          return next;
        });
      }
    } else if (active.type === 'unscheduled') {
      // Schedule an unscheduled job
      const newEnd = new Date(newStart.getTime() + defaultDurationMinutes * 60 * 1000);
      const teamId = dropTeamId !== undefined ? dropTeamId : active.teamId;

      try {
        await onScheduleJob(active.jobId, newStart.toISOString(), newEnd.toISOString(), teamId);
      } catch (err) {
        throw err;
      }
    }
  }, [dragState.active, onReschedule, onScheduleJob, defaultDurationMinutes]);

  /** Complete resize */
  const completeResize = useCallback(async () => {
    const active = dragState.active;
    if (!active || active.type !== 'resize-bottom' || !active.eventId) return;

    const original = active.originalEvent!;
    const newDuration = dragState.previewDuration;
    if (!newDuration || newDuration < 15) {
      setDragState(INITIAL_STATE);
      return;
    }

    const startMs = new Date(original.start_at).getTime();
    const newEnd = new Date(startMs + newDuration * 60 * 1000);

    setDragState(INITIAL_STATE);

    // Optimistic update
    setOptimisticUpdates(prev => {
      const next = new Map(prev);
      next.set(active.eventId!, { end_at: newEnd.toISOString() });
      return next;
    });

    try {
      await onResizeEvent(active.eventId, original.start_at, newEnd.toISOString());
    } catch {
      // Rollback
    } finally {
      setOptimisticUpdates(prev => {
        const next = new Map(prev);
        next.delete(active.eventId!);
        return next;
      });
    }
  }, [dragState, onResizeEvent]);

  /** Apply optimistic updates to an event */
  const applyOptimistic = useCallback((event: ScheduleEventRecord): ScheduleEventRecord => {
    const update = optimisticUpdates.get(event.id);
    if (!update) return event;
    return { ...event, ...update };
  }, [optimisticUpdates]);

  /** Check if an event is currently being dragged */
  const isDragging = useCallback((eventId: string): boolean => {
    return dragState.active?.eventId === eventId && dragState.active?.type === 'event';
  }, [dragState.active]);

  /** Check if an unscheduled job is being dragged */
  const isDraggingJob = useCallback((jobId: string): boolean => {
    return dragState.active?.jobId === jobId && dragState.active?.type === 'unscheduled';
  }, [dragState.active]);

  return {
    dragState,
    startEventDrag,
    startUnscheduledDrag,
    startResize,
    updateDragPosition,
    cancelDrag,
    completeDrop,
    completeResize,
    applyOptimistic,
    isDragging,
    isDraggingJob,
    isAnyDragActive: dragState.active !== null,
  };
}
