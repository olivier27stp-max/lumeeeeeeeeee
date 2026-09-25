import React from 'react';
import { CalendarPlus, Archive, CircleDot, FileText } from 'lucide-react';

/**
 * « Dernière visite complétée » — proposé quand la visite qu'on vient de
 * marquer terminée était la dernière visite active de la job.
 *
 * Le travail est fini : la suite normale, c'est de FACTURER. Le dialogue ne
 * proposait que fermer, replanifier ou laisser en « Action requise » — il
 * fallait sortir, aller chercher la job et créer la facture à la main. La
 * facturation est désormais le premier choix, et elle ferme la job au
 * passage (c'est ce que fait `finishJobAndPrepareInvoice`).
 *
 * `onInvoice` reste optionnel pour les appelants qui n'ont pas de quoi
 * facturer, mais les deux du produit le passent TOUJOURS : ne pas le
 * conditionner à `requires_invoicing`, qui marque les jobs EN ATTENTE de
 * facturation, pas les jobs facturables (les 6 jobs de production sont à
 * faux — le bouton aurait disparu partout).
 */
export default function FinalVisitDialog({ open, fr, busy, onInvoice, onCloseJob, onScheduleNewVisit, onLeave }: {
  open: boolean;
  fr: boolean;
  busy?: boolean;
  onInvoice?: () => void;
  onCloseJob: () => void;
  onScheduleNewVisit: () => void;
  onLeave: () => void;
}) {
  if (!open) return null;
  return (
    <div role="presentation" tabIndex={-1} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4" onClick={onLeave}>
      <div
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[24px] font-black leading-tight text-text-primary mb-4">
          {fr ? 'Compléter la dernière visite et...' : 'Complete final visit and...'}
        </h2>
        <div className="space-y-2">
          {onInvoice && (
            <button
              type="button"
              disabled={busy}
              onClick={onInvoice}
              className="w-full rounded-lg border border-primary/40 bg-primary px-3.5 py-2.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              <FileText size={14} />
              {fr ? 'Facturer la job' : 'Invoice the job'}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onCloseJob}
            className="w-full rounded-lg border border-outline-subtle bg-surface-secondary px-3.5 py-2.5 text-[13px] font-semibold text-text-primary transition-colors hover:border-primary/40 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <Archive size={14} />
            {fr ? 'Fermer la job' : 'Close Job'}
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
            className="w-full rounded-lg border border-outline-subtle bg-surface-secondary px-3.5 py-2.5 text-[13px] font-semibold text-text-primary transition-colors hover:border-primary/40 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <CircleDot size={14} />
            {fr ? 'Laisser en « Action requise »' : 'Leave as Action Required'}
          </button>
        </div>
      </div>
    </div>
  );
}
