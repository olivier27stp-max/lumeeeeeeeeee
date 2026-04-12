/**
 * QuoteMeasure — Full-screen 3D photorealistic measurement workspace.
 * Uses Google Maps 3D Tiles via <gmp-map-3d> for Google Earth-quality rendering.
 * Falls back to classic 2D satellite map if Map ID is unavailable.
 *
 * Keyboard: 1-4 tools | Enter/dblclick finish | Esc cancel | Backspace undo | Del delete
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Camera, Save, Search, Send, Loader2,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useTranslation } from '../i18n';
import { getQuoteById, saveQuoteLineItems, type QuoteLineItemInput } from '../lib/quotesApi';
import {
  listMeasurements, createMeasurement, deleteAllMeasurements,
  uploadMeasurementScreenshot, getQuoteCamera, saveQuoteCamera,
} from '../lib/measurementApi';
import {
  computeMeasurement, formatLength, formatArea,
  haversineDistanceFt, midpoint, centroid, nextColor,
  geoJsonToPoints, formatMeasurementValue,
} from '../lib/measurementEngine';
import type {
  LatLng, MeasurementType, Tool, UnitSystem, Shape, CameraState,
} from '../lib/measurementTypes';
import { SNAP_PX } from '../lib/measurementTypes';
import MeasureToolbar from '../components/measure/MeasureToolbar';
import MeasureSidebar from '../components/measure/MeasureSidebar';
import MeasureStatusBar from '../components/measure/MeasureStatusBar';
import { toast } from 'sonner';

// ── Google Maps 3D API loader ──
function useGMaps3D() {
  const [ok, setOk] = useState(false);
  const key = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '') as string;
  const mapId = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || '') as string;

  useEffect(() => {
    if (!key) return;
    try { if (window.google?.maps) { setOk(true); return; } } catch {}
    const id = 'gmap-measure';
    if (document.getElementById(id)) {
      const p = setInterval(() => { try { if (window.google?.maps) { setOk(true); clearInterval(p); } } catch {} }, 200);
      return () => clearInterval(p);
    }
    const s = document.createElement('script');
    s.id = id; s.async = true; s.defer = true;
    // Load alpha channel for 3D tiles support
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places,geometry&v=alpha`;
    s.onload = () => {
      const p = setInterval(() => { try { if (window.google?.maps) { setOk(true); clearInterval(p); } } catch {} }, 100);
    };
    document.head.appendChild(s);
  }, [key]);

  return { ok, key, mapId, has3d: Boolean(mapId) };
}

// ── Component ──
export default function QuoteMeasure() {
  const { id: quoteId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fr = typeof t === 'object' && (t as any)?.quotes?.title === 'Devis';
  const { ok: mapsOk, key: apiKey, mapId, has3d } = useGMaps3D();

  // Data
  const { data: quote } = useQuery({ queryKey: ['quoteDetail', quoteId], queryFn: () => getQuoteById(quoteId!), enabled: Boolean(quoteId) });
  const addr = quote?.lead?.address || quote?.client?.address || '';
  const contactName = quote ? `${quote.lead?.first_name || quote.client?.first_name || ''} ${quote.lead?.last_name || quote.client?.last_name || ''}`.trim() : '';
  const { data: saved } = useQuery({ queryKey: ['quoteMeasurements', quoteId], queryFn: () => listMeasurements(quoteId!), enabled: Boolean(quoteId) });
  const { data: savedCamera } = useQuery({ queryKey: ['quoteCamera', quoteId], queryFn: () => getQuoteCamera(quoteId!), enabled: Boolean(quoteId) });

  // Refs
  const mapDiv = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const map3dRef = useRef<any>(null); // gmp-map-3d element
  const mapRef = useRef<google.maps.Map | null>(null); // fallback 2D
  const gcRef = useRef<google.maps.Geocoder | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  // State
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [pts, setPts] = useState<LatLng[]>([]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState(true);
  const [cursorPos, setCursorPos] = useState<LatLng | null>(null);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('imperial');
  const [tilt3d, setTilt3d] = useState(true);
  const [is3dMode, setIs3dMode] = useState(false);
  const cnt = useRef(0);

  // Overlay refs (for 2D fallback)
  const drawOv = useRef<google.maps.MVCObject[]>([]);
  const shapeOv = useRef<google.maps.MVCObject[]>([]);
  const cursorOv = useRef<google.maps.MVCObject[]>([]);
  const pending = useRef<{ tool: Tool; pts: LatLng[] } | null>(null);
  const allVertices = useRef<LatLng[]>([]);

  // 3D overlay refs
  const overlays3d = useRef<HTMLElement[]>([]);

  useEffect(() => { allVertices.current = shapes.flatMap(s => s.result.points); }, [shapes]);

  const fmtLen = useCallback((ft: number) => formatLength(ft, unitSystem), [unitSystem]);
  const fmtArea = useCallback((sqft: number) => formatArea(sqft, unitSystem), [unitSystem]);

  // ════════════════════════════════════════════
  // 3D MAP INIT
  // ════════════════════════════════════════════

  useEffect(() => {
    if (!mapsOk || !mapDiv.current || map3dRef.current || mapRef.current) return;

    if (has3d) {
      // Create 3D photorealistic map
      const map3d = document.createElement('gmp-map-3d') as any;
      map3d.setAttribute('center', '45.5017,-73.5673,200');
      map3d.setAttribute('tilt', '60');
      map3d.setAttribute('heading', '0');
      map3d.setAttribute('range', '500');
      map3d.setAttribute('default-labels-disabled', '');
      map3d.style.width = '100%';
      map3d.style.height = '100%';
      mapDiv.current.appendChild(map3d);
      map3dRef.current = map3d;
      setIs3dMode(true);

      // Wait for element to be ready
      const check = setInterval(() => {
        if (map3d.center !== undefined) {
          clearInterval(check);
          gcRef.current = new google.maps.Geocoder();
          setReady(true);
          if (addr && !savedCamera) { setSearch(addr); doGeocode3d(addr); }
        }
      }, 200);
      return () => clearInterval(check);
    } else {
      // Fallback: classic 2D satellite map
      const map = new google.maps.Map(mapDiv.current, {
        center: { lat: 45.5017, lng: -73.5673 }, zoom: 19,
        mapTypeId: 'hybrid', tilt: 45, heading: 0,
        zoomControl: true, mapTypeControl: true,
        mapTypeControlOptions: { position: google.maps.ControlPosition.TOP_RIGHT },
        scaleControl: true, streetViewControl: false, fullscreenControl: false,
        gestureHandling: 'greedy', rotateControl: true,
      });
      mapRef.current = map;
      gcRef.current = new google.maps.Geocoder();
      setReady(true);
      if (addr && !savedCamera) { setSearch(addr); doGeocode(addr, map); }
    }
  }, [mapsOk]);

  // Restore camera
  useEffect(() => {
    if (!savedCamera || !ready) return;
    if (savedCamera.address) setSearch(savedCamera.address);
    if (savedCamera.unit_system) setUnitSystem(savedCamera.unit_system as UnitSystem);
    const cam = savedCamera.camera as CameraState | null;
    if (cam) {
      if (is3dMode && map3dRef.current) {
        map3dRef.current.center = { lat: cam.center.lat, lng: cam.center.lng, altitude: 200 };
        map3dRef.current.tilt = cam.tilt || 60;
        map3dRef.current.heading = cam.heading || 0;
        map3dRef.current.range = cam.zoom ? Math.max(100, 20000 / cam.zoom) : 500;
      } else if (mapRef.current) {
        mapRef.current.setCenter(cam.center);
        mapRef.current.setZoom(cam.zoom);
        mapRef.current.setTilt(cam.tilt);
        mapRef.current.setHeading(cam.heading);
      }
    }
  }, [savedCamera, ready]);

  // Autocomplete
  useEffect(() => {
    if (!mapsOk || !searchInput.current || autocompleteRef.current) return;
    const ac = new google.maps.places.Autocomplete(searchInput.current, {
      types: ['address'], fields: ['geometry', 'formatted_address'],
    });
    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if (!place?.geometry?.location) return;
      const loc = place.geometry.location;
      setSearch(place.formatted_address || '');
      if (is3dMode && map3dRef.current) {
        flyTo3d(loc.lat(), loc.lng());
      } else if (mapRef.current) {
        mapRef.current.setCenter(loc);
        mapRef.current.setZoom(20);
      }
    });
    autocompleteRef.current = ac;
  }, [mapsOk, is3dMode]);

  useEffect(() => {
    if (!addr || !ready || search || savedCamera) return;
    setSearch(addr);
    if (is3dMode) doGeocode3d(addr);
    else if (mapRef.current) doGeocode(addr, mapRef.current);
  }, [addr, ready]);

  function flyTo3d(lat: number, lng: number) {
    const el = map3dRef.current;
    if (!el) return;
    el.center = { lat, lng, altitude: 100 };
    el.range = 400;
    el.tilt = 60;
  }

  function doGeocode3d(a: string) {
    if (!gcRef.current || !a.trim()) return;
    gcRef.current.geocode({ address: a }, (r, s) => {
      if (s === 'OK' && r?.[0]) {
        const loc = r[0].geometry.location;
        flyTo3d(loc.lat(), loc.lng());
      }
    });
  }

  function doGeocode(a: string, m?: google.maps.Map) {
    const map = m || mapRef.current;
    if (!map || !gcRef.current || !a.trim()) return;
    gcRef.current.geocode({ address: a }, (r, s) => {
      if (s === 'OK' && r?.[0]) { map.setCenter(r[0].geometry.location); map.setZoom(20); }
    });
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;
    setSearching(true);
    gcRef.current?.geocode({ address: search }, (r, s) => {
      setSearching(false);
      if (s === 'OK' && r?.[0]) {
        const loc = r[0].geometry.location;
        if (is3dMode) flyTo3d(loc.lat(), loc.lng());
        else if (mapRef.current) { mapRef.current.setCenter(loc); mapRef.current.setZoom(20); }
      } else { toast.error(fr ? 'Adresse introuvable' : 'Address not found'); }
    });
  }

  // ════════════════════════════════════════════
  // LOAD SAVED MEASUREMENTS
  // ════════════════════════════════════════════

  useEffect(() => {
    if (!saved || shapes.length) return;
    const loaded = saved.map(m => ({
      id: `s-${m.id}`, label: m.label, color: m.color,
      result: {
        type: m.measurement_type, value: m.value,
        areaValue: m.area_value, perimeterValue: m.perimeter_value,
        geojson: m.geojson, points: geoJsonToPoints(m.geojson),
      } as any,
      notes: m.notes || '', visible: true,
    }));
    if (loaded.length) { setShapes(loaded); cnt.current = loaded.length; }
  }, [saved]);

  // ════════════════════════════════════════════
  // SNAP HELPER (2D only)
  // ════════════════════════════════════════════

  function snapPoint(raw: LatLng): LatLng {
    const map = mapRef.current;
    if (!map) return raw;
    const proj = map.getProjection();
    if (!proj) return raw;
    const zoom = map.getZoom() || 19;
    const scale = Math.pow(2, zoom);
    const rawWorld = proj.fromLatLngToPoint(new google.maps.LatLng(raw.lat, raw.lng));
    if (!rawWorld) return raw;
    for (const v of allVertices.current) {
      const vWorld = proj.fromLatLngToPoint(new google.maps.LatLng(v.lat, v.lng));
      if (!vWorld) continue;
      const dx = (rawWorld.x - vWorld.x) * scale;
      const dy = (rawWorld.y - vWorld.y) * scale;
      if (Math.sqrt(dx * dx + dy * dy) < SNAP_PX) return v;
    }
    return raw;
  }

  // ════════════════════════════════════════════
  // 3D MAP CLICK HANDLER
  // ════════════════════════════════════════════

  useEffect(() => {
    const el = map3dRef.current;
    if (!el || !ready || !is3dMode) return;
    if (tool === 'select') return;

    const handler = (e: any) => {
      // gmp-map-3d click event gives position in the detail
      const detail = e.detail || e;
      let lat: number, lng: number;

      if (detail?.position) {
        lat = detail.position.lat;
        lng = detail.position.lng;
      } else if (detail?.latLng) {
        lat = typeof detail.latLng.lat === 'function' ? detail.latLng.lat() : detail.latLng.lat;
        lng = typeof detail.latLng.lng === 'function' ? detail.latLng.lng() : detail.latLng.lng;
      } else {
        return;
      }

      const pt: LatLng = { lat, lng };
      setPts(prev => {
        const next = [...prev, pt];
        if (tool === 'line' && next.length === 2) { pending.current = { tool: 'line', pts: next }; return []; }
        if ((tool === 'polygon' || tool === 'path') && prev.length >= 3) {
          const first = prev[0];
          const dist = haversineDistanceFt(pt, first);
          if (dist < 3) {
            pending.current = tool === 'path'
              ? { tool: 'path', pts: [...prev, first] }
              : { tool: 'polygon', pts: prev };
            return [];
          }
        }
        return next;
      });
    };

    el.addEventListener('gmp-click', handler);
    return () => el.removeEventListener('gmp-click', handler);
  }, [tool, ready, is3dMode, shapes]);

  // ════════════════════════════════════════════
  // 2D MAP EVENTS (fallback)
  // ════════════════════════════════════════════

  useEffect(() => {
    if (pending.current) { const { tool: t, pts: p } = pending.current; pending.current = null; finishShape(t, p); }
  });

  useEffect(() => {
    if (is3dMode) return;
    const map = mapRef.current;
    if (!map || !ready) return;
    if (tool === 'select') { map.setOptions({ draggableCursor: '' }); return; }
    map.setOptions({ draggableCursor: 'crosshair' });

    const listener = map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const pt = snapPoint({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      setPts(prev => {
        const next = [...prev, pt];
        if (tool === 'line' && next.length === 2) { pending.current = { tool: 'line', pts: next }; return []; }
        if ((tool === 'polygon' || tool === 'path') && prev.length >= 3) {
          const first = prev[0];
          if (haversineDistanceFt(pt, first) < 3 || (pt.lat === first.lat && pt.lng === first.lng)) {
            pending.current = tool === 'path' ? { tool: 'path', pts: [...prev, first] } : { tool: 'polygon', pts: prev };
            return [];
          }
        }
        return next;
      });
    });
    return () => google.maps.event.removeListener(listener);
  }, [tool, ready, shapes, is3dMode]);

  // Double-click to finish (2D)
  useEffect(() => {
    if (is3dMode) return;
    const map = mapRef.current;
    if (!map || !ready || tool === 'select' || tool === 'line') return;
    const listener = map.addListener('dblclick', (e: google.maps.MapMouseEvent) => {
      e.stop();
      setPts(prev => { if (prev.length >= 2) pending.current = { tool, pts: prev }; return []; });
    });
    return () => google.maps.event.removeListener(listener);
  }, [tool, ready, is3dMode]);

  // Mouse move (2D)
  useEffect(() => {
    if (is3dMode) return;
    const map = mapRef.current;
    if (!map || !ready || tool === 'select') { setCursorPos(null); return; }
    const listener = map.addListener('mousemove', (e: google.maps.MapMouseEvent) => {
      if (e.latLng) setCursorPos({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    });
    return () => { google.maps.event.removeListener(listener); setCursorPos(null); };
  }, [tool, ready, is3dMode]);

  // ════════════════════════════════════════════
  // 3D OVERLAY RENDERING
  // ════════════════════════════════════════════

  useEffect(() => {
    if (!is3dMode) return;
    const el = map3dRef.current;
    if (!el) return;

    // Clear old overlays
    overlays3d.current.forEach(o => o.remove());
    overlays3d.current = [];

    // Render active drawing points
    if (pts.length >= 2) {
      const coords = pts.map(p => ({ lat: p.lat, lng: p.lng, altitude: 15 }));

      if (tool === 'polygon') {
        const poly = document.createElement('gmp-polygon-3d') as any;
        poly.setAttribute('altitude-mode', 'relative-to-ground');
        poly.setAttribute('fill-color', 'rgba(255,68,68,0.25)');
        poly.setAttribute('stroke-color', '#FF4444');
        poly.setAttribute('stroke-width', '4');
        poly.setAttribute('draws-occluded-segments', '');
        poly.outerCoordinates = coords;
        el.appendChild(poly);
        overlays3d.current.push(poly);
      } else {
        const line = document.createElement('gmp-polyline-3d') as any;
        line.setAttribute('altitude-mode', 'relative-to-ground');
        line.setAttribute('stroke-color', '#FF4444');
        line.setAttribute('stroke-width', '6');
        line.setAttribute('draws-occluded-segments', '');
        line.coordinates = coords;
        el.appendChild(line);
        overlays3d.current.push(line);
      }
    }

    // Render saved shapes
    shapes.forEach(s => {
      if (!s.visible) return;
      const coords = s.result.points.map(p => ({ lat: p.lat, lng: p.lng, altitude: 12 }));
      const sel = s.id === selId;

      if (s.result.type === 'polygon' && coords.length >= 3) {
        const poly = document.createElement('gmp-polygon-3d') as any;
        poly.setAttribute('altitude-mode', 'relative-to-ground');
        poly.setAttribute('fill-color', hexToRgba(s.color, sel ? 0.35 : 0.18));
        poly.setAttribute('stroke-color', s.color);
        poly.setAttribute('stroke-width', sel ? '6' : '3');
        poly.setAttribute('draws-occluded-segments', '');
        poly.outerCoordinates = coords;
        el.appendChild(poly);
        overlays3d.current.push(poly);
      } else if (coords.length >= 2) {
        const line = document.createElement('gmp-polyline-3d') as any;
        line.setAttribute('altitude-mode', 'relative-to-ground');
        line.setAttribute('stroke-color', s.color);
        line.setAttribute('stroke-width', sel ? '8' : '4');
        line.setAttribute('draws-occluded-segments', '');
        line.coordinates = coords;
        el.appendChild(line);
        overlays3d.current.push(line);
      }
    });
  }, [pts, shapes, selId, tool, is3dMode]);

  // ════════════════════════════════════════════
  // 2D OVERLAY RENDERING (fallback)
  // ════════════════════════════════════════════

  // Cursor preview (2D)
  useEffect(() => {
    if (is3dMode) return;
    cursorOv.current.forEach((o: any) => o.setMap?.(null));
    cursorOv.current = [];
    const map = mapRef.current;
    if (!map || !cursorPos || pts.length === 0 || tool === 'select') return;
    const lastPt = pts[pts.length - 1];
    const snapped = snapPoint(cursorPos);
    const dashIcon = [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '15px' }];
    cursorOv.current.push(new google.maps.Polyline({
      path: [new google.maps.LatLng(lastPt.lat, lastPt.lng), new google.maps.LatLng(snapped.lat, snapped.lng)],
      strokeColor: '#FF4444', strokeWeight: 2, strokeOpacity: 0.6, icons: dashIcon, map,
    }));
    const dist = haversineDistanceFt(lastPt, snapped);
    if (dist > 0.5) cursorOv.current.push(mkLabel(map, midpoint(lastPt, snapped), fmtLen(dist)));
    if (tool === 'polygon' && pts.length >= 2) {
      const allPts = [...pts, snapped];
      cursorOv.current.push(new google.maps.Polyline({
        path: [new google.maps.LatLng(snapped.lat, snapped.lng), new google.maps.LatLng(pts[0].lat, pts[0].lng)],
        strokeColor: '#FF4444', strokeWeight: 2, strokeOpacity: 0.6, icons: dashIcon, map,
      }));
      const closeDist = haversineDistanceFt(snapped, pts[0]);
      if (closeDist > 0.5) cursorOv.current.push(mkLabel(map, midpoint(snapped, pts[0]), fmtLen(closeDist)));
      const area = computeMeasurement('polygon', allPts).value;
      if (area > 1) cursorOv.current.push(mkLabel(map, centroid(allPts), fmtArea(area)));
    }
  }, [cursorPos, pts, tool, unitSystem, is3dMode]);

  // Active drawing (2D)
  useEffect(() => {
    if (is3dMode) return;
    drawOv.current.forEach((o: any) => o.setMap?.(null));
    drawOv.current = [];
    const map = mapRef.current;
    if (!map || !pts.length) return;
    const path = pts.map(p => new google.maps.LatLng(p.lat, p.lng));
    if (path.length >= 2) {
      if (tool === 'polygon') {
        drawOv.current.push(new google.maps.Polygon({ paths: path, strokeColor: '#FF4444', strokeWeight: 2, fillColor: '#FF4444', fillOpacity: 0.15, map }));
      } else {
        drawOv.current.push(new google.maps.Polyline({ path, strokeColor: '#FF4444', strokeWeight: 3, map }));
      }
      for (let i = 1; i < pts.length; i++) drawOv.current.push(mkLabel(map, midpoint(pts[i - 1], pts[i]), fmtLen(haversineDistanceFt(pts[i - 1], pts[i]))));
      if (tool === 'polygon' && pts.length >= 3) {
        drawOv.current.push(mkLabel(map, midpoint(pts[pts.length - 1], pts[0]), fmtLen(haversineDistanceFt(pts[pts.length - 1], pts[0]))));
        drawOv.current.push(mkLabel(map, centroid(pts), `⬡ ${fmtArea(computeMeasurement('polygon', pts).value)}`));
      }
      if (tool === 'path' && pts.length > 2) drawOv.current.push(mkLabel(map, pts[pts.length - 1], `Total: ${fmtLen(computeMeasurement('path', pts).value)}`));
    }
    path.forEach(p => {
      drawOv.current.push(new google.maps.Marker({ position: p, map, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: '#FFF', fillOpacity: 1, strokeColor: '#FF4444', strokeWeight: 2 }, zIndex: 100 }));
    });
  }, [pts, tool, unitSystem, is3dMode]);

  // Saved shapes (2D)
  useEffect(() => {
    if (is3dMode) return;
    shapeOv.current.forEach((o: any) => o.setMap?.(null));
    shapeOv.current = [];
    const map = mapRef.current;
    if (!map) return;
    shapes.forEach(s => {
      if (!s.visible) return;
      const path = s.result.points.map(p => new google.maps.LatLng(p.lat, p.lng));
      const sel = s.id === selId;
      if (s.result.type === 'polygon' && path.length >= 3) {
        const poly = new google.maps.Polygon({ paths: path, strokeColor: s.color, strokeWeight: sel ? 4 : 2, fillColor: s.color, fillOpacity: sel ? 0.25 : 0.12, clickable: true, map });
        poly.addListener('click', () => setSelId(s.id));
        shapeOv.current.push(poly);
        shapeOv.current.push(mkLabel(map, centroid(s.result.points), `${s.label}: ${fmtArea(s.result.value)}`));
        for (let i = 0; i < s.result.points.length; i++) {
          const j = (i + 1) % s.result.points.length;
          shapeOv.current.push(mkLabel(map, midpoint(s.result.points[i], s.result.points[j]), fmtLen(haversineDistanceFt(s.result.points[i], s.result.points[j]))));
        }
      } else if (path.length >= 2) {
        const line = new google.maps.Polyline({ path, strokeColor: s.color, strokeWeight: sel ? 5 : 3, clickable: true, map });
        line.addListener('click', () => setSelId(s.id));
        shapeOv.current.push(line);
        for (let i = 1; i < s.result.points.length; i++) shapeOv.current.push(mkLabel(map, midpoint(s.result.points[i - 1], s.result.points[i]), fmtLen(haversineDistanceFt(s.result.points[i - 1], s.result.points[i]))));
        if (s.result.type === 'path' && s.result.points.length > 2) shapeOv.current.push(mkLabel(map, s.result.points[s.result.points.length - 1], `Total: ${fmtLen(s.result.value)}`));
      }
      s.result.points.forEach((p, vi) => {
        const marker = new google.maps.Marker({
          position: new google.maps.LatLng(p.lat, p.lng), map, draggable: sel,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: sel ? 7 : 5, fillColor: sel ? '#FFFFFF' : s.color, fillOpacity: 1, strokeColor: s.color, strokeWeight: sel ? 3 : 1.5 },
          zIndex: sel ? 200 : 50, cursor: sel ? 'grab' : 'pointer',
        });
        if (!sel) marker.addListener('click', () => setSelId(s.id));
        else marker.addListener('dragend', (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          setShapes(prev => prev.map(sh => {
            if (sh.id !== s.id) return sh;
            const newPts = [...sh.result.points]; newPts[vi] = { lat: e.latLng!.lat(), lng: e.latLng!.lng() };
            return { ...sh, result: computeMeasurement(sh.result.type, newPts) };
          }));
        });
        shapeOv.current.push(marker);
      });
    });
  }, [shapes, selId, unitSystem, is3dMode]);

  // ════════════════════════════════════════════
  // ACTIONS
  // ════════════════════════════════════════════

  function finishShape(t: Tool, points: LatLng[]) {
    if (points.length < 2) return;
    if (t === 'polygon' && points.length < 3) { toast.error('Min 3 points'); return; }
    const type: MeasurementType = t === 'select' ? 'line' : t;
    const result = computeMeasurement(type, points);
    const idx = cnt.current++;
    const newId = `sh-${idx}`;
    setShapes(p => [...p, {
      id: newId,
      label: type === 'polygon' ? `Zone ${idx + 1}` : `Mesure ${idx + 1}`,
      color: nextColor(idx), result, notes: '', visible: true,
    }]);
    setPts([]); setSelId(newId);
    clearDrawOverlays();
  }

  function handleToolChange(t: Tool) {
    setTool(t); setPts([]);
    clearDrawOverlays();
  }

  function handleDuplicateSelected() {
    const shape = shapes.find(s => s.id === selId);
    if (!shape) return;
    const idx = cnt.current++;
    setShapes(p => [...p, { ...shape, id: `sh-${idx}`, label: `${shape.label} (copy)`, color: nextColor(idx) }]);
    setSelId(`sh-${idx}`);
  }

  function toggleTilt() {
    if (is3dMode && map3dRef.current) {
      const next = !tilt3d;
      setTilt3d(next);
      map3dRef.current.tilt = next ? 60 : 0;
    } else if (mapRef.current) {
      const next = !tilt3d;
      setTilt3d(next);
      mapRef.current.setTilt(next ? 45 : 0);
      if (!next) mapRef.current.setHeading(0);
      const z = mapRef.current.getZoom();
      if (next && z && z < 18) mapRef.current.setZoom(18);
    }
  }

  function getCameraStateNow(): CameraState {
    if (is3dMode && map3dRef.current) {
      const el = map3dRef.current;
      const c = el.center || {};
      return {
        center: { lat: c.lat || 0, lng: c.lng || 0 },
        zoom: el.range ? Math.round(20000 / el.range) : 19,
        tilt: el.tilt || 0,
        heading: el.heading || 0,
      };
    }
    if (mapRef.current) {
      const c = mapRef.current.getCenter();
      return {
        center: { lat: c?.lat() || 0, lng: c?.lng() || 0 },
        zoom: mapRef.current.getZoom() || 19,
        tilt: mapRef.current.getTilt() || 0,
        heading: mapRef.current.getHeading() || 0,
      };
    }
    return { center: { lat: 0, lng: 0 }, zoom: 19, tilt: 0, heading: 0 };
  }

  async function doSave() {
    if (!quoteId) { toast.error(fr ? 'Créez un devis d\'abord pour sauvegarder' : 'Create a quote first to save'); return; }
    if (!shapes.length) return;
    setSaving(true);
    try {
      await deleteAllMeasurements(quoteId);
      const camState = getCameraStateNow();
      for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i];
        await createMeasurement({
          quote_id: quoteId, measurement_type: s.result.type, label: s.label,
          unit: s.result.type === 'polygon' ? (unitSystem === 'metric' ? 'm²' : 'sq ft') : (unitSystem === 'metric' ? 'm' : 'ft'),
          value: r2(s.result.value),
          area_value: s.result.areaValue ? r2(s.result.areaValue) : null,
          perimeter_value: s.result.perimeterValue ? r2(s.result.perimeterValue) : null,
          geojson: s.result.geojson, notes: s.notes || null, color: s.color, sort_order: i,
          camera_state: camState, metadata: null,
        });
      }
      await saveQuoteCamera(quoteId, camState, search, unitSystem);
      qc.invalidateQueries({ queryKey: ['quoteMeasurements', quoteId] });
      toast.success(fr ? 'Mesures sauvegardées' : 'Saved');
    } catch (e: any) { toast.error(e?.message || 'Error'); }
    finally { setSaving(false); }
  }

  async function doScreenshot() {
    if (!mapDiv.current) return;
    if (!quoteId) { toast.error(fr ? 'Créez un devis d\'abord' : 'Create a quote first'); return; }
    try {
      const h2c = (await import('html2canvas')).default;
      const canvas = await h2c(mapDiv.current, { useCORS: true, scale: 2 });
      const blob = await new Promise<Blob>((r, j) => canvas.toBlob(b => b ? r(b) : j(), 'image/png'));
      await uploadMeasurementScreenshot(quoteId, blob);
      toast.success(fr ? 'Capture sauvegardée' : 'Screenshot saved');
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); } catch {}
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
  }

  async function doSend() {
    if (!quoteId || !quote) { toast.error(fr ? 'Créez un devis d\'abord pour envoyer' : 'Create a quote first to send'); return; }
    if (!shapes.length) return;
    setSaving(true);
    try {
      const existing: QuoteLineItemInput[] = (quote.line_items || []).map((li, i) => ({
        source_service_id: li.source_service_id, name: li.name, description: li.description,
        quantity: li.quantity, unit_price_cents: li.unit_price_cents, sort_order: i,
        is_optional: li.is_optional, item_type: li.item_type, image_url: li.image_url,
      }));
      const items: QuoteLineItemInput[] = shapes.map((s, i) => ({
        name: `${s.label} (${formatMeasurementValue(s.result.type, s.result.value, unitSystem)})`,
        description: `${formatMeasurementValue(s.result.type, s.result.value, unitSystem)}${
          s.result.type === 'polygon' && s.result.perimeterValue ? ` • ${fr ? 'Périmètre' : 'Perimeter'}: ${fmtLen(s.result.perimeterValue)}` : ''
        }${s.notes ? ` — ${s.notes}` : ''}`,
        quantity: r2(s.result.value), unit_price_cents: 0,
        sort_order: existing.length + i, is_optional: false, item_type: 'service' as const,
      }));
      await saveQuoteLineItems(quoteId, [...existing, ...items]);
      qc.invalidateQueries({ queryKey: ['quoteDetail', quoteId] });
      toast.success(fr ? `${shapes.length} mesure(s) envoyée(s)` : `${shapes.length} sent`);
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setSaving(false); }
  }

  // ════════════════════════════════════════════
  // KEYBOARD
  // ════════════════════════════════════════════

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') { setPts([]); setTool('select'); clearDrawOverlays(); }
      if (e.key === 'Enter' && pts.length >= 2) finishShape(tool, pts);
      if (e.key === 'Backspace' || ((e.ctrlKey || e.metaKey) && e.key === 'z')) setPts(p => p.slice(0, -1));
      if (e.key === '1') handleToolChange('select');
      if (e.key === '2') handleToolChange('line');
      if (e.key === '3') handleToolChange('path');
      if (e.key === '4') handleToolChange('polygon');
      if (e.key === 'Delete' && selId) { setShapes(p => p.filter(s => s.id !== selId)); setSelId(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [pts, tool, selId]);

  function clearDrawOverlays() {
    drawOv.current.forEach((o: any) => o.setMap?.(null)); drawOv.current = [];
    cursorOv.current.forEach((o: any) => o.setMap?.(null)); cursorOv.current = [];
  }

  // ════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════

  if (!apiKey) return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
      <div className="text-center space-y-3">
        <p className="text-lg font-medium">{fr ? 'Clé API Google Maps requise' : 'Google Maps API key required'}</p>
        <p className="text-sm text-text-secondary">VITE_GOOGLE_MAPS_API_KEY</p>
        <button onClick={() => nav(-1)} className="glass-button-primary px-4 py-2 rounded-lg text-sm">{fr ? 'Retour' : 'Back'}</button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* ════ TOP BAR ════ */}
      <div className="h-12 border-b border-outline/20 flex items-center px-4 gap-3 bg-surface-card shrink-0">
        <button onClick={() => nav(quoteId ? `/quotes/${quoteId}` : '/quotes')} className="p-1.5 hover:bg-surface-secondary rounded-lg transition-colors">
          <ArrowLeft size={16} className="text-text-secondary" />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-bold text-text-primary truncate">{fr ? 'Mesure' : 'Measure'}</span>
          {is3dMode && <span className="text-[9px] font-bold bg-text-primary text-surface px-1.5 py-0.5 rounded">3D</span>}
          {quote && <span className="text-[11px] text-text-muted truncate">— {quote.quote.quote_number} {contactName && `• ${contactName}`}</span>}
        </div>
        <form onSubmit={handleSearch} className="flex-1 max-w-md mx-4">
          <div className="relative">
            {searching
              ? <Loader2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted animate-spin" />
              : <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />}
            <input ref={searchInput} value={search} onChange={e => setSearch(e.target.value)}
              placeholder={fr ? 'Rechercher une adresse...' : 'Search address...'}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-outline/30 bg-surface-secondary text-[12px] focus:outline-none focus:ring-2 focus:ring-text-primary/20 text-text-primary placeholder:text-text-muted" />
          </div>
        </form>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={doScreenshot} title="Screenshot" className="glass-button p-1.5 rounded-lg"><Camera size={14} /></button>
          <button onClick={doSave} disabled={saving || !shapes.length}
            className="glass-button flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium disabled:opacity-40">
            <Save size={13} /><span className="hidden lg:inline">{fr ? 'Sauvegarder' : 'Save'}</span>
          </button>
          <button onClick={doSend} disabled={saving || !shapes.length}
            className="glass-button-primary flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-40">
            <Send size={13} /><span className="hidden lg:inline">{fr ? 'Envoyer au devis' : 'Send to Quote'}</span>
          </button>
        </div>
      </div>

      {/* ════ MAIN LAYOUT ════ */}
      <div className="flex-1 flex overflow-hidden relative">
        <MeasureToolbar tool={tool} onToolChange={handleToolChange}
          onUndo={() => setPts(p => p.slice(0, -1))}
          onClearAll={() => { setShapes([]); setPts([]); setSelId(null); clearDrawOverlays(); }}
          onDuplicateSelected={handleDuplicateSelected}
          hasPoints={pts.length > 0} hasShapes={shapes.length > 0} hasSelection={!!selId} fr={fr} />

        <div className="flex-1 relative">
          <div ref={mapDiv} className="absolute inset-0" />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-10">
              <Loader2 size={28} className="animate-spin text-text-muted" />
            </div>
          )}
          {tool !== 'select' && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gray-900/80 text-white text-[11px] px-3 py-1.5 rounded-full z-20 pointer-events-none backdrop-blur-sm">
              {tool === 'line' && (fr ? 'Cliquez 2 points' : 'Click 2 points')}
              {tool === 'path' && (fr ? 'Cliquez, Enter pour terminer' : 'Click, Enter to finish')}
              {tool === 'polygon' && (fr ? 'Cliquez, Enter pour fermer' : 'Click, Enter to close')}
              {pts.length > 0 && ` • ${pts.length} pt${pts.length > 1 ? 's' : ''}`}
            </div>
          )}
          {pts.length >= 2 && tool !== 'line' && (
            <button onClick={() => finishShape(tool, pts)}
              className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-text-primary text-surface px-4 py-2 rounded-lg shadow-lg z-20 text-[12px] font-semibold hover:opacity-90">
              {fr ? 'Terminer' : 'Finish'} ↵
            </button>
          )}
          {selId && tool === 'select' && !is3dMode && (
            <div className="absolute bottom-12 left-4 bg-surface/90 backdrop-blur-sm border border-outline/30 rounded-lg px-3 py-1.5 z-20 text-[10px] text-text-muted">
              {fr ? 'Glissez les points • Delete pour supprimer' : 'Drag vertices • Delete to remove'}
            </div>
          )}
        </div>

        <div className={`border-l border-outline/20 bg-surface-card flex flex-col shrink-0 z-10 transition-all duration-200 ${panel ? 'w-72' : 'w-0 overflow-hidden border-l-0'}`}>
          {panel && (
            <MeasureSidebar shapes={shapes} selectedId={selId} unitSystem={unitSystem}
              onSelect={setSelId}
              onRename={(id, label) => setShapes(p => p.map(s => s.id === id ? { ...s, label } : s))}
              onToggleVisibility={(id) => setShapes(p => p.map(s => s.id === id ? { ...s, visible: !s.visible } : s))}
              onDelete={(id) => { setShapes(p => p.filter(s => s.id !== id)); if (selId === id) setSelId(null); }}
              onNotesChange={(id, notes) => setShapes(p => p.map(s => s.id === id ? { ...s, notes } : s))}
              fr={fr} />
          )}
        </div>

        <button onClick={() => setPanel(v => !v)}
          className="absolute top-1/2 -translate-y-1/2 bg-surface-card border border-outline/30 rounded-l-lg p-1 z-20 shadow-sm hover:bg-surface-secondary transition-colors"
          style={{ right: panel ? 288 : 0 }}>
          {panel ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </div>

      <MeasureStatusBar tool={tool} pointCount={pts.length} unitSystem={unitSystem}
        onUnitToggle={() => setUnitSystem(u => u === 'imperial' ? 'metric' : 'imperial')}
        tilt3d={tilt3d} onTiltToggle={toggleTilt} fr={fr} />
    </div>
  );
}

// ── Helpers ──

function mkLabel(map: google.maps.Map, pos: LatLng, text: string): google.maps.Marker {
  return new google.maps.Marker({
    position: pos, map, zIndex: 200,
    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 },
    label: { text, color: '#FFF', fontSize: '11px', fontWeight: '600', className: 'measurement-label' },
  });
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function r2(n: number) { return Math.round(n * 100) / 100; }
