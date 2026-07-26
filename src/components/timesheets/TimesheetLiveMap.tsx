import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// Minimal shape the map needs; the caller's richer rep type extends this and is
// passed straight back through onSelect (kept generic so no fields are lost).
export interface LiveRep {
  user_id: string;
  latitude: number;
  longitude: number;
  tracking_status: string;
  user_name?: string;
  team_color?: string;
}

interface Props<R extends LiveRep> {
  reps: R[];
  /** Fly the camera here (e.g. after selecting a rep). */
  flyTo: { lat: number; lng: number } | null;
  onSelect: (rep: R) => void;
  fr: boolean;
}

function statusDot(status: string): string {
  return status === 'active' ? '#22c55e' : status === 'idle' ? '#f59e0b' : '#6b7280';
}
function statusLabel(status: string, fr: boolean): string {
  if (status === 'active') return fr ? 'En service' : 'Working';
  if (status === 'idle') return fr ? 'En pause' : 'Idle';
  return fr ? 'Hors ligne' : 'Offline';
}

/**
 * Live technician map for the Timesheets hub — Mapbox, to match the rest of the
 * CRM (Field Sales / calendar / route). Numbered-less avatar-initial markers
 * with a status dot, hover tooltip, click-to-select, and camera fly-to.
 */
export default function TimesheetLiveMap<R extends LiveRep>({ reps, flyTo, onSelect, fr }: Props<R>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const frRef = useRef(fr); frRef.current = fr;

  // Init once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container,
      style: 'mapbox://styles/mapbox/satellite-streets-v12', // keeps the satellite look
      center: [-73.5673, 45.5017],
      zoom: 11,
      attributionControl: false,
    });
    mapRef.current = map;
    map.on('load', () => { map.resize(); setReady(true); });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; setReady(false); };
  }, []);

  // Render / refresh rep markers when the list changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const next = new Set(reps.map((r) => r.user_id));
    // Remove markers for reps no longer present.
    markersRef.current.forEach((m, id) => {
      if (!next.has(id)) { m.remove(); markersRef.current.delete(id); }
    });

    reps.forEach((rep) => {
      const lngLat: [number, number] = [rep.longitude, rep.latitude];
      const existing = markersRef.current.get(rep.user_id);
      if (existing) { existing.setLngLat(lngLat); return; }

      const el = document.createElement('div');
      const color = rep.team_color || '#3b82f6';
      const initial = (rep.user_name || '?').trim()[0]?.toUpperCase() || '?';
      el.style.cssText = 'position:relative;cursor:pointer;';
      el.innerHTML =
        `<div style="width:34px;height:34px;border-radius:50%;background:${color};border:3px solid #fff;` +
        `box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;` +
        `font:700 12px Inter,system-ui,sans-serif;color:#fff;">${initial}` +
        `<span style="position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;` +
        `background:${statusDot(rep.tracking_status)};border:2px solid #fff;"></span></div>`;

      const popup = new mapboxgl.Popup({ offset: 22, closeButton: false, closeOnClick: false })
        .setHTML(
          `<div style="font:600 11px Inter,system-ui,sans-serif;color:#171717;">${esc(rep.user_name || 'Unknown')}` +
          `<div style="font-size:9px;color:#9ca3af;font-weight:500;">${esc(statusLabel(rep.tracking_status, frRef.current))}</div></div>`,
        );

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat(lngLat).addTo(map);
      el.addEventListener('mouseenter', () => popup.setLngLat(lngLat).addTo(map));
      el.addEventListener('mouseleave', () => popup.remove());
      el.addEventListener('click', (e) => { e.stopPropagation(); onSelectRef.current(rep); });
      markersRef.current.set(rep.user_id, marker);
    });
  }, [reps, ready]);

  // Camera fly-to.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !flyTo) return;
    map.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: Math.max(map.getZoom(), 14), duration: 800 });
  }, [flyTo, ready]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
