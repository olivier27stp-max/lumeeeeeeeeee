import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { MapJobPin } from '../../lib/mapApi';

/** Mapbox config (same token + satellite style as the Field Sales / D2D map). */
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const MAPBOX_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';
const DEFAULT_CENTER: [number, number] = [-73.5673, 45.5017]; // Montréal
const DEFAULT_ZOOM = 10;

/** Gold pins over the satellite basemap (matches the calendar map design). */
const GOLD = '#E0A82E';

/**
 * Past this zoom the city/place labels are hidden — once you're close enough to
 * a city, its name disappears so it stops covering the streets and pins.
 */
const LABEL_HIDE_ZOOM = 12.5;

/**
 * Font applied to the city/place names. Must be a font available in the style's
 * glyph set — DIN Pro ships with Mapbox's standard styles.
 */
const CITY_FONT = ['DIN Pro Bold', 'Arial Unicode MS Bold'];

/** Settlement (city / town / neighbourhood) label layers in satellite-streets-v12. */
const SETTLEMENT_LAYERS = [
  'settlement-major-label',
  'settlement-minor-label',
  'settlement-subdivision-label',
];

/** Layers we hide entirely: highway shields / road numbers and airports. */
const HIDDEN_LAYERS = [
  'road-number-shield',
  'road-exit-shield',
  'road-label',
  'road-label-simple',
  'airport-label',
];

/** A job is "done" when its status maps to completed. */
function isCompletedStatus(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase().trim();
  return s === 'completed' || s === 'complete' || s === 'done' || s === 'terminé' || s === 'termine';
}

/** Teardrop pin DOM element (mirrors the Leaflet CRMMap marker). */
function createPinElement(color: string, completed: boolean): HTMLElement {
  const inner = completed
    ? '<path d="M10.4 14.2 L13.4 17.2 L19.2 10.4" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<circle cx="15" cy="14" r="4" fill="white" opacity="0.95"/>';
  const drop = `<path d="M15 1.5 C8.1 1.5 2.5 7.1 2.5 14 C2.5 22.6 15 38.5 15 38.5 C15 38.5 27.5 22.6 27.5 14 C27.5 7.1 21.9 1.5 15 1.5 Z" fill="${color}" stroke="#2d2d2d" stroke-width="1.5"/>`;
  const el = document.createElement('div');
  el.style.cursor = 'pointer';
  el.innerHTML = `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">${drop}${inner}</svg>`;
  return el;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/** Human-readable schedule label, e.g. "mer. 12 mars · 09:00". */
function scheduleLabel(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${date} · ${time}`;
  } catch {
    return null;
  }
}

interface CalendarMapGLProps {
  pins: MapJobPin[];
  heightClassName?: string;
  onOpenJob?: (jobId: string) => void;
  /** Localised label for the "open job" link in the popup. */
  openJobLabel: string;
}

export default function CalendarMapGL({
  pins,
  heightClassName = 'h-[60vh]',
  onOpenJob,
  openJobLabel,
}: CalendarMapGLProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  // Keep the freshest onOpenJob without re-creating markers.
  const onOpenJobRef = useRef(onOpenJob);
  onOpenJobRef.current = onOpenJob;

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!MAPBOX_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('style.load', () => {
      // 1. Remove highway numbers / road labels and airports.
      for (const id of HIDDEN_LAYERS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
      }
      // 2. Restyle city names and make them disappear once zoomed in close.
      for (const id of SETTLEMENT_LAYERS) {
        if (!map.getLayer(id)) continue;
        map.setLayoutProperty(id, 'text-font', CITY_FONT);
        map.setLayerZoomRange(id, 0, LABEL_HIDE_ZOOM);
        map.setPaintProperty(id, 'text-color', '#ffffff');
        map.setPaintProperty(id, 'text-halo-color', 'rgba(0,0,0,0.75)');
        map.setPaintProperty(id, 'text-halo-width', 1.6);
      }
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync markers + fit bounds whenever pins change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (pins.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    for (const pin of pins) {
      const done = isCompletedStatus(pin.status);
      const sched = scheduleLabel(pin.scheduledAt);
      const popupHtml = `
        <div style="min-width:180px">
          <p style="font-weight:700;font-size:13px;margin:0 0 2px">${escapeHtml(pin.title || 'Job')}</p>
          ${pin.clientName ? `<p style="font-size:12px;margin:0 0 4px;color:#555">${escapeHtml(pin.clientName)}</p>` : ''}
          ${pin.address ? `<p style="font-size:12px;margin:0 0 4px;color:#555">${escapeHtml(pin.address)}</p>` : ''}
          ${sched ? `<p style="font-size:12px;margin:0 0 6px;color:#555">${escapeHtml(sched)}</p>` : ''}
          ${onOpenJobRef.current ? `<button data-open-job="${escapeHtml(pin.jobId)}" style="font-size:12px;color:#2563eb;font-weight:600;cursor:pointer;background:none;border:none;padding:0">${escapeHtml(openJobLabel)}</button>` : ''}
        </div>`;
      const popup = new mapboxgl.Popup({ offset: 28, closeButton: false }).setHTML(popupHtml);
      popup.on('open', () => {
        const btn = popup.getElement()?.querySelector('[data-open-job]') as HTMLButtonElement | null;
        if (btn) btn.onclick = () => onOpenJobRef.current?.(btn.dataset.openJob || pin.jobId);
      });

      const marker = new mapboxgl.Marker({ element: createPinElement(GOLD, done), anchor: 'bottom' })
        .setLngLat([pin.longitude, pin.latitude])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
      bounds.extend([pin.longitude, pin.latitude]);
    }

    if (pins.length === 1) {
      map.flyTo({ center: [pins[0].longitude, pins[0].latitude], zoom: 13, duration: 600 });
    } else {
      map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 600 });
    }
  }, [pins, openJobLabel]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className={`flex items-center justify-center rounded-2xl border border-outline bg-surface-tertiary text-sm text-text-secondary ${heightClassName}`}>
        Mapbox token manquant (VITE_MAPBOX_TOKEN).
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden rounded-2xl border border-outline bg-surface-tertiary ${heightClassName}`}
    />
  );
}
