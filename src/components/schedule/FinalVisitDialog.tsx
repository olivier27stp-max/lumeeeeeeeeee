import React from 'react';
import { CalendarPlus, Archive, CircleDot } from 'lucide-react';

/**
 * « Dernière visite complétée » — proposé quand la visite qu'on vient de
 * marquer terminée était la dernière visite active du job. Trois issues :
 * fermer le job, planifier une nouvelle visite, ou le laisser en
 * « Action requise » (actif sans visite à venir).
 */
export default function FinalVisitDialog({ open, fr, busy, onCloseJob, onScheduleNewVisit, onLeave }: {
  open: boolean;
  fr: boolean;
  busy?: boolean;
  onCloseJob: () => void;
  onScheduleNewVisit: () => void;
  onLeave: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4" onClick={onLeave}>
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[24px] font-black leading-tight text-text-primary mb-4">
          {fr ? 'Compléter la dernière visite et...' : 'Complete final visit and...'}
        </h2>
        <div className="space-y-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCloseJob}
            className="w-full rounded-lg bg-text-primary px-3.5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <Archive size={14} />
            {fr ? 'Fermer le job' : 'Close Job'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onScheduleNewVisit}
            className="w-full rounded-lg border border-outline-subtle bg-surface-secondary px-3.5 py-2.5 text-[13px] font-semibold text-text-primary transition-colors hover:border-primary/40 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <CalendarPlus size={14} />
            {fr ? 'Planifier une nouvelle visite' : 'Schedule new visit'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onLeave}
            className="w-full rounded-lg px-3.5 py-2.5 text-[13px] font-medium text-text-tertiary transition-colors hover:text-text-primary hover:bg-surface-secondary disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <CircleDot size={14} />
            {fr ? 'Laisser en « Action requise »' : 'Leave as Action Required'}
          </button>
        </div>
      </div>
    </div>
  );
}
