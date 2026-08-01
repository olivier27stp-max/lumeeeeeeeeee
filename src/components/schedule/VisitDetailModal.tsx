import React from 'react';
import { format } from 'date-fns';
import { frCA, enCA } from 'date-fns/locale';
import { Clock, MapPin, X as XIcon } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import type { ScheduleEventRecord } from '../../lib/scheduleApi';
import { toRgba } from '../../lib/colorUtils';

/**
 * Modale « Voir la visite » — partagée par les vues Semaine et Mois.
 * Extraite telle quelle de WeeklyDispatchView : mêmes jetons, même layout.
 */

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function VisitDetailModal({ ev, color, teamName, timeLabel, onClose, onView }: {
  ev: ScheduleEventRecord;
  color: string;
  teamName: string | null;
  timeLabel: string;
  onClose: () => void;
  onView: () => void;
}) {
  const { t, language } = useTranslation();
  const isFr = language === 'fr';
  const locale = isFr ? frCA : enCA;
  const s = new Date(ev.start_at);
  const clientName = ev.job?.client_name || ev.job?.title || 'Job';
  const address = (ev.job?.property_address || '').trim() || null;
  const jobNumber = ev.job?.job_number ? `#${ev.job.job_number}` : null;
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
        <button
          onClick={onView}
          className="mt-4 w-full rounded-lg bg-text-primary px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          {isFr ? 'Voir la visite' : 'View Visit'}
        </button>
      </div>
    </div>
  );
}
