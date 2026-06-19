import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { cn } from '../../lib/utils';
import type { MapJobPin } from '../../lib/mapApi';
import JobPopup from './JobPopup';

const DEFAULT_CENTER: L.LatLngTuple = [45.5017, -73.5673];
const DEFAULT_ZOOM = 10;
const OSM_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';
// Satellite tiles (Esri) — same basemap as the Field Sales map.
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// Place/city labels only (no highway shields, no airports) — keeps geographic
// context on the satellite basemap without the transportation overlay clutter.
const SAT_LABELS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const SAT_ATTR = '&copy; Esri, Maxar, Earthstar Geographics';

function createPinIcon(color: string, selected: boolean, completed = false): L.DivIcon {
  // Teardrop pin: rounded head centered at (15,14), pointing down to the tip
  // at (15,39) which marks the exact location (iconAnchor).
  const scale = selected ? 1.2 : 1;
  const ring = selected
    ? `<circle cx="15" cy="14" r="13" fill="none" stroke="${color}" stroke-width="2" opacity="0.35"/>`
    : '';
  // Completed jobs get a white checkmark inside the head; pending jobs a dot.
  const inner = completed
    ? `<path d="M10.4 14.2 L13.4 17.2 L19.2 10.4" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<circle cx="15" cy="14" r="4" fill="white" opacity="0.95"/>`;
  const drop = `<path d="M15 1.5 C8.1 1.5 2.5 7.1 2.5 14 C2.5 22.6 15 38.5 15 38.5 C15 38.5 27.5 22.6 27.5 14 C27.5 7.1 21.9 1.5 15 1.5 Z" fill="${color}" stroke="#2d2d2d" stroke-width="1.5"/>`;
  const svg = `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg" style="transform:scale(${scale});transform-origin:15px 39px">${ring}${drop}${inner}</svg>`;
  return L.divIcon({
    html: svg,
    className: 'crm-marker',
    iconSize: [30, 40],
    iconAnchor: [15, 39],
    popupAnchor: [0, -36],
  });
}

/** A job is "done" when its status maps to completed (DB: 'completed'). */
function isCompletedStatus(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase().trim();
  return s === 'completed' || s === 'complete' || s === 'done' || s === 'terminé' || s === 'termine';
}

const FALLBACK_COLOR = '#2563eb';

/** Past this zoom level the city/place labels are hidden (you're close enough). */
const LABEL_HIDE_ZOOM = 13;

function isHexColor(value: string | null | undefined) {
  if (!value) return false;
  return /^#[0-9a-f]{3,8}$/i.test(value);
}

/* Auto-fit bounds when pins change */
function FitBounds({ pins }: { pins: MapJobPin[] }) {
  const map = useMap();

  useEffect(() => {
    if (pins.length === 0) return;

    // Ensure the map container has correct dimensions before fitting
    map.invalidateSize({ animate: false });

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
  /** When true, completed jobs render with a checkmark pin. */
  showCompletionCheck?: boolean;
  /** Basemap style. 'voyager' (default) keeps the existing map; 'satellite' uses Esri imagery like Field Sales. */
  tileStyle?: 'voyager' | 'satellite';
  /** Force a single pin color (e.g. gold) instead of per-team colors. */
  pinColor?: string;
  /** When false, all map interaction (drag/zoom/click) is disabled and the
   *  wrapper ignores pointer events — used for the Home page background map. */
  interactive?: boolean;
  /** When true, drop the card chrome (rounded corners, border, bg) so the map
   *  can fill a parent edge-to-edge as a page background. */
  bare?: boolean;
}

export default function CRMMap({
  pins,
  heightClassName = 'h-[420px]',
  className,
  onOpenJob,
  showJobCount = true,
  missingLocationCount = 0,
  showCompletionCheck = false,
  tileStyle = 'voyager',
  pinColor,
  interactive = true,
  bare = false,
}: CRMMapProps) {
  const [selectedPin, setSelectedPin] = useState<MapJobPin | null>(null);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const mapRef = useRef<L.Map | null>(null);

  // Clear stale selection when pins change (e.g. switching date filters)
  useEffect(() => {
    setSelectedPin(null);
  }, [pins]);

  const icons = useMemo(() => {
    return pins.map((pin) => {
      const color = pinColor ?? (isHexColor(pin.teamColor) ? pin.teamColor! : FALLBACK_COLOR);
      const done = showCompletionCheck && isCompletedStatus(pin.status);
      return {
        id: pin.id,
        normal: createPinIcon(color, false, done),
        selected: createPinIcon(color, true, done),
      };
    });
  }, [pins, showCompletionCheck, pinColor]);

  return (
    <div
      className={cn(
        'relative overflow-hidden',
        bare ? 'bg-surface-tertiary' : 'rounded-2xl border border-outline bg-surface-tertiary',
        !interactive && 'pointer-events-none',
        heightClassName,
        className,
      )}
    >
      <MapContainer
        ref={mapRef}
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
        attributionControl={false}
        // Smooth, continuous zoom: fractional zoom levels so the tiles scale
        // with the wheel instead of snapping between integer steps.
        zoomSnap={0}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={120}
        scrollWheelZoom={interactive}
        dragging={interactive}
        doubleClickZoom={interactive}
        touchZoom={interactive}
        boxZoom={interactive}
        keyboard={interactive}
        zoomAnimation
        fadeAnimation
        markerZoomAnimation
      >
        {tileStyle === 'satellite' ? (
          <>
            <TileLayer url={SAT_URL} attribution={SAT_ATTR} maxZoom={19} />
            {labelsVisible && <TileLayer url={SAT_LABELS_URL} attribution="" maxZoom={19} />}
            <LabelZoomToggle threshold={LABEL_HIDE_ZOOM} onChange={setLabelsVisible} />
          </>
        ) : (
          <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
        )}
        <FitBounds pins={pins} />

        {/* Zoom control top-right */}
        {interactive && <ZoomControl />}

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
          <div className="rounded-xl border border-outline bg-surface px-3 py-2 shadow-md">
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

/* Hides the city/place label overlay once you zoom in past the threshold. */
function LabelZoomToggle({ threshold, onChange }: { threshold: number; onChange: (visible: boolean) => void }) {
  const map = useMap();

  useEffect(() => {
    const update = () => onChange(map.getZoom() < threshold);
    update();
    map.on('zoomend', update);
    return () => {
      map.off('zoomend', update);
    };
  }, [map, threshold, onChange]);

  return null;
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
