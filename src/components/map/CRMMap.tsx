import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { cn } from '../../lib/utils';
import type { MapJobPin } from '../../lib/mapApi';
import JobPopup from './JobPopup';

const DEFAULT_CENTER: L.LatLngTuple = [45.5017, -73.5673];
const DEFAULT_ZOOM = 10;
const OSM_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

function createPinIcon(color: string, selected: boolean): L.DivIcon {
  const scale = selected ? 1.25 : 1;
  const ring = selected
    ? `<circle cx="15" cy="15" r="14" fill="none" stroke="${color}" stroke-width="2" opacity="0.35"/>`
    : '';
  const svg = `<svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg" style="transform:scale(${scale});transform-origin:center">${ring}<circle cx="15" cy="15" r="10" fill="${color}" stroke="#2d2d2d" stroke-width="1.5"/><circle cx="15" cy="15" r="3.5" fill="white" opacity="0.9"/></svg>`;
  return L.divIcon({
    html: svg,
    className: 'crm-marker',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });
}

const FALLBACK_COLOR = '#2563eb';

function isHexColor(value: string | null | undefined) {
  if (!value) return false;
  return /^#[0-9a-f]{3,8}$/i.test(value);
}

/* Auto-fit bounds when pins change */
function FitBounds({ pins }: { pins: MapJobPin[] }) {
  const map = useMap();

  useEffect(() => {
    if (pins.length === 0) return;

    if (pins.length === 1) {
      map.flyTo([pins[0].latitude, pins[0].longitude], 13, { duration: 0.6 });
      return;
    }

    const bounds = L.latLngBounds(pins.map((p) => [p.latitude, p.longitude]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
  }, [pins, map]);

  return null;
}

interface CRMMapProps {
  pins: MapJobPin[];
  heightClassName?: string;
  className?: string;
  onOpenJob?: (jobId: string) => void;
  showJobCount?: boolean;
  missingLocationCount?: number;
}

export default function CRMMap({
  pins,
  heightClassName = 'h-[420px]',
  className,
  onOpenJob,
  showJobCount = true,
  missingLocationCount = 0,
}: CRMMapProps) {
  const [selectedPin, setSelectedPin] = useState<MapJobPin | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const icons = useMemo(() => {
    return pins.map((pin) => ({
      id: pin.id,
      normal: createPinIcon(isHexColor(pin.teamColor) ? pin.teamColor! : FALLBACK_COLOR, false),
      selected: createPinIcon(isHexColor(pin.teamColor) ? pin.teamColor! : FALLBACK_COLOR, true),
    }));
  }, [pins]);

  return (
    <div className={cn('relative overflow-hidden rounded-2xl border-[1.5px] border-outline bg-surface-tertiary', heightClassName, className)}>
      <MapContainer
        ref={mapRef}
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
        <FitBounds pins={pins} />

        {/* Zoom control top-right */}
        <ZoomControl />

        {pins.map((pin, i) => {
          const iconSet = icons[i];
          const isSelected = selectedPin?.id === pin.id;
          return (
            <Marker
              key={pin.id}
              position={[pin.latitude, pin.longitude]}
              icon={isSelected ? iconSet.selected : iconSet.normal}
              eventHandlers={{
                click: () => setSelectedPin(isSelected ? null : pin),
              }}
            />
          );
        })}

        {selectedPin && (
          <JobPopup
            pin={selectedPin}
            onClose={() => setSelectedPin(null)}
            onOpenJob={onOpenJob}
          />
        )}
      </MapContainer>

      {/* Job count badge */}
      {showJobCount && (
        <div className="absolute bottom-3 left-3 z-[1000]">
          <div className="rounded-xl border-[1.5px] border-outline bg-surface px-3 py-2 shadow-md">
            <p className="text-xs font-bold text-text-primary">{pins.length} jobs shown</p>
            {missingLocationCount > 0 && (
              <p className="text-[11px] text-warning font-medium mt-0.5">
                {missingLocationCount} missing location
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* Zoom-only control positioned top-right */
function ZoomControl() {
  const map = useMap();

  useEffect(() => {
    const ctrl = L.control.zoom({ position: 'topright' });
    ctrl.addTo(map);
    return () => {
      ctrl.remove();
    };
  }, [map]);

  return null;
}
