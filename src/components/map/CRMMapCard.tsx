import React, { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { fetchMapJobs, type MapDateRange } from '../../lib/mapApi';
import CRMMap from './CRMMap';
import MapFilterBar from './MapFilterBar';
import IconTile from '../ui/IconTile';

interface CRMMapCardProps {
  defaultRange?: MapDateRange;
  heightClassName?: string;
  onOpenJob?: (jobId: string) => void;
}

export default function CRMMapCard({
  defaultRange = 'this_week',
  heightClassName = 'h-[420px]',
  onOpenJob,
}: CRMMapCardProps) {
  const [dateRange, setDateRange] = useState<MapDateRange>(defaultRange);

  const { data: pins = [], isLoading, refetch } = useQuery({
    queryKey: ['mapJobs', dateRange],
    queryFn: () => fetchMapJobs(dateRange),
  });

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <div className="section-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <IconTile icon={MapPin} color="cyan" size="sm" />
          <h2 className="text-sm font-bold text-text-primary">Job Map</h2>
        </div>
      </div>

      {/* Filters */}
      <MapFilterBar
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onRefresh={handleRefresh}
        loading={isLoading}
      />

      {/* Map */}
      {isLoading && pins.length === 0 ? (
        <div className={`skeleton rounded-2xl ${heightClassName}`} />
      ) : (
        <CRMMap
          pins={pins}
          heightClassName={heightClassName}
          onOpenJob={onOpenJob}
        />
      )}
    </div>
  );
}
