import React, { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { fetchMapJobs, type MapDateRange, type MapJobResult } from '../../lib/mapApi';
import { geocodeBatch } from '../../lib/geocodeApi';
import CRMMap from './CRMMap';
import MapFilterBar from './MapFilterBar';
import IconTile from '../ui/IconTile';

interface CRMMapCardProps {
  defaultRange?: MapDateRange;
  heightClassName?: string;
  onOpenJob?: (jobId: string) => void;
}

const EMPTY_RESULT: MapJobResult = { pins: [], totalEvents: 0, missingLocationCount: 0 };

export default function CRMMapCard({
  defaultRange = 'this_week',
  heightClassName = 'h-[420px]',
  onOpenJob,
}: CRMMapCardProps) {
  const [dateRange, setDateRange] = useState<MapDateRange>(defaultRange);
  const [geocoding, setGeocoding] = useState(false);
  const queryClient = useQueryClient();

  const { data = EMPTY_RESULT, isLoading, isError, refetch } = useQuery({
    queryKey: ['mapJobs', dateRange],
    queryFn: () => fetchMapJobs(dateRange),
  });

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const handleGeocodeMissing = useCallback(async () => {
    setGeocoding(true);
    try {
      const result = await geocodeBatch();
      if (result.succeeded > 0) {
        toast.success(`${result.succeeded} job${result.succeeded > 1 ? 's' : ''} geocoded.`);
      }
      if (result.failed > 0) {
        toast.warning(`${result.failed} job${result.failed > 1 ? 's' : ''} could not be geocoded (missing or invalid address).`);
      }
      if (result.processed === 0) {
        toast.info('No jobs to geocode.');
      }
      await queryClient.invalidateQueries({ queryKey: ['mapJobs'] });
    } catch (err: any) {
      toast.error(err?.message || 'Geocoding failed.');
    } finally {
      setGeocoding(false);
    }
  }, [queryClient]);

  return (
    <div className="section-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <IconTile icon={MapPin} color="cyan" size="sm" />
          <h2 className="text-sm font-bold text-text-primary">Job Map</h2>
        </div>
        {data.missingLocationCount > 0 && (
          <button
            type="button"
            onClick={handleGeocodeMissing}
            disabled={geocoding}
            className="rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning hover:bg-warning/20 transition-colors disabled:opacity-50"
          >
            {geocoding ? 'Geocoding...' : `Geocode ${data.missingLocationCount} missing`}
          </button>
        )}
      </div>

      {/* Filters */}
      <MapFilterBar
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onRefresh={handleRefresh}
        loading={isLoading}
      />

      {/* Map */}
      {isLoading && data.pins.length === 0 ? (
        <div className={`skeleton rounded-2xl ${heightClassName}`} />
      ) : isError ? (
        <div className={`flex items-center justify-center rounded-2xl border border-outline bg-surface-tertiary ${heightClassName}`}>
          <div className="text-center space-y-2">
            <p className="text-sm text-text-secondary">Failed to load map data.</p>
            <button
              type="button"
              onClick={handleRefresh}
              className="text-xs font-semibold text-accent hover:underline"
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        <CRMMap
          pins={data.pins}
          heightClassName={heightClassName}
          onOpenJob={onOpenJob}
          missingLocationCount={data.missingLocationCount}
        />
      )}
    </div>
  );
}
