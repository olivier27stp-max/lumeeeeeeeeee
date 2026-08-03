import React from 'react';
import { CheckCircle2, CalendarPlus, Archive, CircleDot } from 'lucide-react';

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
        <div className="flex items-center gap-2.5 mb-1">
          <span className="h-8 w-8 rounded-full bg-success/10 border border-success/30 flex items-center justify-center shrink-0">
            <CheckCircle2 size={16} className="text-success" />
          </span>
          <h2 className="text-[15px] font-bold text-text-primary">
            {fr ? 'Dernière visite complétée' : 'Final visit completed'}
          </h2>
        </div>
        <p className="text-[12px] text-text-tertiary mb-4">
          {fr
            ? 'Toutes les visites de ce job sont complétées. Que voulez-vous faire ?'
            : 'All of this job’s visits are completed. What would you like to do?'}
        </p>
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
