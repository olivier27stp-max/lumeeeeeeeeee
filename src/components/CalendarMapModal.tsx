import { useQuery } from '@tanstack/react-query';
import { X as XIcon, Loader2 } from 'lucide-react';
import { fetchMapJobsInRange } from '../lib/mapApi';
import { useTranslation } from '../i18n';
import CalendarMapGL from './map/CalendarMapGL';

interface CalendarMapModalProps {
  /** Inclusive start of the selected calendar period. */
  start: Date;
  /** Exclusive end of the selected calendar period (matches buildRange()). */
  end: Date;
  /** Human label of the period, shown in the header (e.g. "March 2026"). */
  periodLabel: string;
  onClose: () => void;
  onOpenJob?: (jobId: string) => void;
}

/** Gold used for the calendar map pins (over the satellite basemap). */
const GOLD = '#E0A82E';
/** Paler gold for completed jobs — kept in sync with CalendarMapGL. */
const GOLD_COMPLETED = '#F5E6B8';

/** Small teardrop pin swatch for the legend, mirroring the map markers. */
function LegendPin({ completed }: { completed: boolean }) {
  const color = completed ? GOLD_COMPLETED : GOLD;
  return (
    <svg width="16" height="21" viewBox="0 0 30 40" className="shrink-0" style={{ opacity: completed ? 0.65 : 1 }}>
      <path d="M15 1.5 C8.1 1.5 2.5 7.1 2.5 14 C2.5 22.6 15 38.5 15 38.5 C15 38.5 27.5 22.6 27.5 14 C27.5 7.1 21.9 1.5 15 1.5 Z" fill={color} stroke="#2d2d2d" strokeWidth="1.5" />
      {completed ? (
        <path d="M10.4 14.2 L13.4 17.2 L19.2 10.4" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <circle cx="15" cy="14" r="4" fill="white" opacity="0.95" />
      )}
    </svg>
  );
}

export default function CalendarMapModal({ start, end, periodLabel, onClose, onOpenJob }: CalendarMapModalProps) {
  const { t } = useTranslation();
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['calendarMapJobs', startISO, endISO],
    queryFn: () => fetchMapJobsInRange(startISO, endISO),
  });

  const pins = data?.pins ?? [];
  const missing = data?.missingLocationCount ?? 0;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-[15px] font-bold text-text-primary">{t.schedule.mapTitle}</h2>
            <p className="mt-0.5 text-xs text-text-secondary">{t.schedule.mapSubtitle} · {periodLabel}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-tertiary transition-colors">
            <XIcon size={16} />
          </button>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 border-b border-border px-5 py-2.5 text-[12px] text-text-secondary">
          <span className="flex items-center gap-1.5"><LegendPin completed /> {t.schedule.mapLegendDone}</span>
          <span className="flex items-center gap-1.5"><LegendPin completed={false} /> {t.schedule.mapLegendPending}</span>
          {!isLoading && !isError && (
            <span className="ml-auto font-medium text-text-primary">
              {pins.length} {t.schedule.mapJobsShown}
              {missing > 0 && <span className="ml-2 font-medium text-warning">· {missing} {t.schedule.mapMissingLocation}</span>}
            </span>
          )}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 p-4">
          {isLoading ? (
            <div className="flex h-[60vh] items-center justify-center gap-2 text-text-secondary">
              <Loader2 size={18} className="animate-spin" /> {t.schedule.mapLoading}
            </div>
          ) : isError ? (
            <div className="flex h-[60vh] items-center justify-center text-sm text-error">{t.schedule.mapError}</div>
          ) : pins.length === 0 ? (
            <div className="flex h-[60vh] items-center justify-center text-sm text-text-secondary">{t.schedule.mapEmpty}</div>
          ) : (
            <CalendarMapGL
              pins={pins}
              heightClassName="h-[60vh]"
              onOpenJob={onOpenJob}
              openJobLabel={t.schedule.mapOpenJob}
            />
          )}
        </div>
      </div>
    </div>
  );
}
