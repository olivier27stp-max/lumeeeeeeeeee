import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { OptimizedStop } from '../../lib/routeOptimizationApi';
import { useTranslation } from '../../i18n';

interface Props {
  stops: OptimizedStop[];
  totalDistanceKm: number;
  totalDriveMinutes: number;
  /** Optional start anchor (e.g. depot / rep home). */
  start?: { lat: number; lng: number } | null;
}

/**
 * Renders an interactive Mapbox map with numbered markers for each stop and
 * a polyline connecting them in optimized order.
 *
 * V1 uses straight-line connectors. To draw real road geometry, swap the
 * GeoJSON source to a fetch of the Mapbox Directions API result.
 */
export default function OptimizedRouteMap({ stops, totalDistanceKm, totalDriveMinutes, start }: Props) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) return;
    mapboxgl.accessToken = token;

    const first = stops[0];
    const center: [number, number] = first
      ? [first.lng, first.lat]
      : start
        ? [start.lng, start.lat]
        : [-73.5673, 45.5017];

    mapRef.current = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center,
      zoom: 11,
      attributionControl: false,
    });
    mapRef.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render markers + polyline + fit bounds whenever stops change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function onReady() {
      // Clear existing markers.
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      const coords: [number, number][] = [];
      if (start) coords.push([start.lng, start.lat]);

      stops.forEach((s, idx) => {
        coords.push([s.lng, s.lat]);

        // Numbered marker element.
        const el = document.createElement('div');
        el.className = 'lume-route-marker';
        el.textContent = String(idx + 1);
        el.style.cssText = [
          'width:28px',
          'height:28px',
          'border-radius:50%',
          'background:#4f46e5',
          'color:white',
          'font-weight:700',
          'font-size:13px',
          'display:flex',
          'align-items:center',
          'justify-content:center',
          'border:2px solid white',
          'box-shadow:0 2px 6px rgba(0,0,0,0.25)',
          'cursor:pointer',
        ].join(';');

        const popup = new mapboxgl.Popup({ offset: 18 }).setHTML(
          // « Job » se dit pareil dans les deux langues de l'app (la job / the job).
          `<div style="font-size:12px"><strong>${idx + 1}. ${escapeHtml(s.title || 'Job')}</strong><br/>` +
          `${escapeHtml(s.address || '')}<br/>` +
          `<span style="color:#6b7280">ETA ${new Date(s.estimated_arrival_time).toLocaleTimeString(fr ? 'fr-CA' : 'en-CA', { hour: '2-digit', minute: '2-digit' })}</span></div>`,
        );

        const marker = new mapboxgl.Marker({ element: el }).setLngLat([s.lng, s.lat]).setPopup(popup).addTo(map);
        markersRef.current.push(marker);
      });

      // Polyline source.
      const lineGeo = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: coords },
      } as GeoJSON.Feature<GeoJSON.LineString>;

      if (map.getLayer('route-line')) map.removeLayer('route-line');
      if (map.getSource('route-line-src')) map.removeSource('route-line-src');

      if (coords.length >= 2) {
        map.addSource('route-line-src', { type: 'geojson', data: lineGeo });
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route-line-src',
          paint: {
            'line-color': '#4f46e5',
            'line-width': 3,
            'line-dasharray': [2, 1.5],
          },
        });
      }

      // Fit bounds.
      if (coords.length > 0) {
        const bounds = coords.reduce(
          (b, c) => b.extend(c as [number, number]),
          new mapboxgl.LngLatBounds(coords[0], coords[0]),
        );
        map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 });
      }
    }

    if (map.isStyleLoaded()) onReady();
    else map.once('load', onReady);
  }, [stops, start, fr]);

  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (!token) {
    return (
      <div className="grid h-full place-items-center rounded-xl border border-border bg-surface-secondary p-8 text-center text-sm text-text-secondary">
        Mapbox token missing. Set <code className="px-1 font-mono">VITE_MAPBOX_TOKEN</code> in your env.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-surface">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-border bg-surface/95 px-3 py-2 text-[12px] shadow-md backdrop-blur">
        <div className="font-semibold text-text-primary">{stops.length} stops</div>
        <div className="text-text-secondary">{totalDistanceKm.toFixed(1)} km · ~{totalDriveMinutes} min driving</div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
