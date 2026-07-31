import React from 'react';
import { Maximize2, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { MapDateRange } from '../../lib/mapApi';
import { useTranslation } from '../../i18n';

interface MapFilterBarProps {
  dateRange: MapDateRange;
  onDateRangeChange: (range: MapDateRange) => void;
  onFitAll?: () => void;
  onRefresh?: () => void;
  loading?: boolean;
  jobCount?: number;
}

const DATE_CHIPS: { value: MapDateRange; label: { fr: string; en: string } }[] = [
  { value: 'today', label: { fr: "Aujourd'hui", en: 'Today' } },
  { value: 'tomorrow', label: { fr: 'Demain', en: 'Tomorrow' } },
  { value: 'this_week', label: { fr: 'Cette semaine', en: 'This Week' } },
  { value: 'all', label: { fr: 'Toutes planifiées', en: 'All Scheduled' } },
];

export default function MapFilterBar({
  dateRange,
  onDateRangeChange,
  onFitAll,
  onRefresh,
  loading,
}: MapFilterBarProps) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-1.5">
        {DATE_CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            onClick={() => onDateRangeChange(chip.value)}
            className={cn(
              'rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors',
              dateRange === chip.value
                ? 'border-text-primary bg-primary text-white'
                : 'border-outline-subtle bg-surface text-text-secondary hover:border-outline hover:bg-surface-secondary'
            )}
          >
            {fr ? chip.label.fr : chip.label.en}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        {onFitAll && (
          <button
            type="button"
            onClick={onFitAll}
            title={fr ? 'Ajuster à toutes les jobs' : 'Fit all jobs'}
            className="rounded-lg border border-outline-subtle bg-surface p-1.5 text-text-tertiary hover:text-text-primary hover:border-outline transition-colors"
          >
            <Maximize2 size={13} />
          </button>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            title={fr ? 'Actualiser' : 'Refresh'}
            className={cn(
              'rounded-lg border border-outline-subtle bg-surface p-1.5 text-text-tertiary hover:text-text-primary hover:border-outline transition-colors',
              loading && 'animate-spin'
            )}
          >
            <RefreshCw size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
