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

export default function MapFilterBar({
  dateRange,
  onDateRangeChange,
  onFitAll,
  onRefresh,
  loading,
}: MapFilterBarProps) {
  const { t } = useTranslation();

  const dateChips: { value: MapDateRange; label: string }[] = [
    { value: 'today', label: t.dispatchMap.today },
    { value: 'tomorrow', label: t.dispatchMap.tomorrow },
    { value: 'this_week', label: t.dispatchMap.thisWeek },
    { value: 'all', label: t.dispatchMap.allScheduled },
  ];

  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-1.5">
        {dateChips.map((chip) => (
          <button
            key={chip.value}
            type="button"
            onClick={() => onDateRangeChange(chip.value)}
            className={cn(
              'rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors',
              dateRange === chip.value
                ? 'border-text-primary bg-text-primary text-surface'
                : 'border-outline-subtle bg-surface text-text-secondary hover:border-outline hover:bg-surface-secondary'
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        {onFitAll && (
          <button
            type="button"
            onClick={onFitAll}
            title={t.common.refresh}
            className="rounded-lg border border-outline-subtle bg-surface p-1.5 text-text-tertiary hover:text-text-primary hover:border-outline transition-colors"
          >
            <Maximize2 size={13} />
          </button>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            title={t.common.refresh}
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
