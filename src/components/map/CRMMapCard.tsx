import React, { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { fetchMapJobs, type MapDateRange, type MapJobResult } from '../../lib/mapApi';
import { geocodeBatch } from '../../lib/geocodeApi';
import { useTranslation } from '../../i18n';
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
  const { language } = useTranslation();
  const fr = language === 'fr';
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
        toast.success(
          fr
            ? `${result.succeeded} job${result.succeeded > 1 ? 's' : ''} géocodée${result.succeeded > 1 ? 's' : ''}.`
            : `${result.succeeded} job${result.succeeded > 1 ? 's' : ''} geocoded.`,
        );
      }
      if (result.failed > 0) {
        toast.warning(
          fr
            ? `${result.failed} job${result.failed > 1 ? 's' : ''} n'a pas pu être géocodée (adresse manquante ou invalide).`
            : `${result.failed} job${result.failed > 1 ? 's' : ''} could not be geocoded (missing or invalid address).`,
        );
      }
      if (result.processed === 0) {
        toast.info(fr ? 'Aucune job à géocoder.' : 'No jobs to geocode.');
      }
      await queryClient.invalidateQueries({ queryKey: ['mapJobs'] });
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Échec du géocodage.' : 'Geocoding failed.'));
    } finally {
      setGeocoding(false);
    }
  }, [queryClient, fr]);

  return (
    <div className="section-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <IconTile icon={MapPin} color="cyan" size="sm" />
          <h2 className="text-sm font-bold text-text-primary">{fr ? 'Carte des jobs' : 'Job Map'}</h2>
        </div>
        {data.missingLocationCount > 0 && (
          <button
            type="button"
            onClick={handleGeocodeMissing}
            disabled={geocoding}
            className="rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning hover:bg-warning/20 transition-colors disabled:opacity-50"
          >
            {geocoding
              ? fr ? 'Géocodage...' : 'Geocoding...'
              : fr
                ? `Géocoder ${data.missingLocationCount} manquante${data.missingLocationCount > 1 ? 's' : ''}`
                : `Geocode ${data.missingLocationCount} missing`}
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
            <p className="text-sm text-text-secondary">
              {fr ? 'Échec du chargement de la carte.' : 'Failed to load map data.'}
            </p>
            <button
              type="button"
              onClick={handleRefresh}
              className="text-xs font-semibold text-accent hover:underline"
            >
              {fr ? 'Réessayer' : 'Retry'}
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
