import React, { useState } from 'react';
import { format } from 'date-fns';
import { frCA, enCA } from 'date-fns/locale';
import { CheckCircle2, Clock, MapPin, X as XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { invalidateScheduleCache, type ScheduleEventRecord } from '../../lib/scheduleApi';
import { createInvoiceForVisit } from '../../lib/jobBillingApi';
import { toRgba } from '../../lib/colorUtils';

/**
 * Modale « Voir la visite » — partagée par les vues Semaine et Mois.
 * Extraite telle quelle de WeeklyDispatchView : mêmes jetons, même layout.
 * Depuis 2026-08 : « Marquer la visite terminée » directement ici — pour les
 * jobs en facturation par visite (billing_mode = 'per_visit'), compléter la
 * visite crée aussi sa facture (envoyée d'emblée si auto_charge).
 */

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function VisitDetailModal({ ev, color, teamName, timeLabel, onClose, onView, onStatusChanged }: {
  ev: ScheduleEventRecord;
  color: string;
  teamName: string | null;
  timeLabel: string;
  onClose: () => void;
  onView: () => void;
  /** Appelé après un changement de statut (terminée / remise à faire). */
  onStatusChanged?: () => void;
}) {
  const { t, language } = useTranslation();
  const isFr = language === 'fr';
  const locale = isFr ? frCA : enCA;
  const s = new Date(ev.start_at);
  const clientName = ev.job?.client_name || ev.job?.title || 'Job';
  const address = (ev.job?.property_address || '').trim() || null;
  const jobNumber = ev.job?.job_number ? `#${ev.job.job_number}` : null;
  const [completed, setCompleted] = useState((ev.status || '').toLowerCase() === 'completed');
  const [busy, setBusy] = useState(false);
  const isCancelled = (ev.status || '').toLowerCase() === 'cancelled';

  const toggleCompleted = async () => {
    if (busy) return;
    const next = !completed;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('schedule_events')
        .update({ status: next ? 'completed' : 'scheduled', updated_at: new Date().toISOString() })
        .eq('id', ev.id);
      if (error) throw error;
      setCompleted(next);
      invalidateScheduleCache();
      toast.success(next
        ? (isFr ? 'Visite complétée.' : 'Visit completed.')
        : (isFr ? 'Visite remise à faire.' : 'Visit set back to scheduled.'));
      if (next && ev.job_id) {
        // Facturation par visite : billing_mode/auto_charge lus sur la table
        // jobs (colonnes absentes tant que la migration 20260802200000 n'est
        // pas appliquée → on saute sans bruit).
        try {
          const { data: billingRow } = await supabase
            .from('jobs')
            .select('*')
            .eq('id', ev.job_id)
            .maybeSingle();
          if ((billingRow as any)?.billing_mode === 'per_visit') {
            const sendNow = Boolean((billingRow as any)?.auto_charge);
            const result = await createInvoiceForVisit({ jobId: ev.job_id, visitId: ev.id, sendNow });
            if (!result.already_exists) {
              toast.success(sendNow
                ? (isFr ? 'Facture de la visite créée et envoyée au client.' : 'Visit invoice created and sent to the client.')
                : (isFr ? 'Facture de la visite créée (brouillon).' : 'Visit invoice created (draft).'));
            }
          }
        } catch (err: any) {
          console.error('[schedule] per-visit invoice failed', err);
          toast.error(err?.message || (isFr ? 'La facture de la visite n’a pas pu être créée.' : 'The visit invoice could not be created.'));
        }
      }
      onStatusChanged?.();
    } catch (err: any) {
      toast.error(err?.message || (isFr ? 'Impossible de mettre à jour la visite.' : 'Could not update the visit.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <h2 className="truncate text-[15px] font-bold text-text-primary">{clientName}</h2>
              {completed && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-success bg-success/10 border border-success/30 rounded-full px-2 py-0.5 shrink-0">
                  {isFr ? 'Complétée' : 'Completed'}
                </span>
              )}
            </div>
            {ev.job?.title && ev.job.title !== clientName && (
              <p className="mt-0.5 truncate text-[12px] text-text-secondary">
                {ev.job.title}{jobNumber ? ` · ${jobNumber}` : ''}
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-tertiary">
            <XIcon size={16} />
          </button>
        </div>
        <div className="space-y-2 rounded-xl bg-surface-secondary p-3">
          <p className="flex items-center gap-2 text-[12px] font-medium text-text-primary">
            <Clock size={12} className="shrink-0 text-text-tertiary" />
            <span>{cap(format(s, isFr ? 'EEEE d MMMM' : 'EEEE, MMMM d', { locale }))} · {timeLabel}</span>
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
              {teamName || t.schedule.unassigned}
            </span>
            {ev.job?.total_cents ? (
              <span className="text-[12px] font-bold text-text-primary">{formatCurrency((ev.job.total_cents || 0) / 100)}</span>
            ) : null}
          </div>
          {ev.notes && <p className="text-[11px] leading-relaxed text-text-tertiary">{ev.notes}</p>}
        </div>
        <div className="mt-4 space-y-2">
          {!isCancelled && (
            <button
              onClick={() => void toggleCompleted()}
              disabled={busy}
              className={completed
                ? 'w-full rounded-lg border border-outline-subtle bg-surface-secondary px-3.5 py-2 text-[13px] font-semibold text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50'
                : 'w-full rounded-lg bg-success px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2'}
            >
              {!completed && <CheckCircle2 size={15} />}
              {busy
                ? (isFr ? 'Mise à jour…' : 'Updating…')
                : completed
                  ? (isFr ? 'Remettre à faire' : 'Set back to scheduled')
                  : (isFr ? 'Marquer la visite terminée' : 'Mark visit complete')}
            </button>
          )}
          <button
            onClick={onView}
            className="w-full rounded-lg bg-text-primary px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            {isFr ? 'Voir la visite' : 'View Visit'}
          </button>
        </div>
      </div>
    </div>
  );
}
