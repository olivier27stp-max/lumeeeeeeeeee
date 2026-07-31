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
import { getQuoteById, saveQuoteLineItems, createQuote, type QuoteLineItemInput } from '../lib/quotesApi';
import { listClients, createClient, clientDisplayName, type ClientRecord } from '../lib/clientsApi';
import {
  listMeasurements, createMeasurement, deleteAllMeasurements,
  uploadMeasurementScreenshot, getQuoteCamera, saveQuoteCamera,
} from '../lib/measurementApi';
import {
  computeMeasurement, formatLength, formatArea,
  haversineDistanceFt, midpoint, centroid, nextColor,
  geoJsonToPoints, formatMeasurementValue, fetchElevations, elevationStats,
} from '../lib/measurementEngine';
import type {
  LatLng, MeasurementType, Tool, UnitSystem, Shape, CameraState,
} from '../lib/measurementTypes';
import { SNAP_PX } from '../lib/measurementTypes';
import MeasureToolbar from '../components/measure/MeasureToolbar';
import MeasureSidebar from '../components/measure/MeasureSidebar';
import MeasureStatusBar from '../components/measure/MeasureStatusBar';
import HeightTool3D from '../components/measure/HeightTool3D';
import { useGMaps3D } from '../components/measure/useGMaps3D';
import { toast } from 'sonner';

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

  // Standalone mode: "Send to Quote" first asks which client the quote is for.
  const [quotePickerOpen, setQuotePickerOpen] = useState(false);

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
  // Default to the Area (polygon) tool so a click on the map immediately starts
  // a measurement — matching the "click to measure" expectation of the workspace.
  // Press 1 (or the Select tool) to switch to editing/panning mode.
  const [tool, setTool] = useState<Tool>('polygon');
  const [pts, setPts] = useState<LatLng[]>([]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState(true);
  const [cursorPos, setCursorPos] = useState<LatLng | null>(null);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('imperial');
  const [tilt3d, setTilt3d] = useState(true);
  const [is3dMode, setIs3dMode] = useState(false);
  const [heightOpen, setHeightOpen] = useState(false);
  const cnt = useRef(0);
  // Last 3D click, to drop duplicate gmp-click events fired in quick succession
  // (the beta 3D map sometimes emits 2 clicks for one tap → stray extra points).
  const lastClick3d = useRef<{ t: number; lat: number; lng: number } | null>(null);

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

    // Google's photorealistic 3D map (beta) cannot reliably place a point on a
    // single click — clicks miss the terrain or land on overlays, producing stray
    // points and odd shapes, and there's no way to test it headlessly. We draw on
    // the 2D satellite map instead: pixel-accurate single click, dbl-click to
    // finish (no zoom). The status-bar "3D" button still tilts the view to 45°
    // aerial. Flip ENABLE_3D back to true to revisit the 3D drawing path.
    const ENABLE_3D = false;
    if (has3d && ENABLE_3D) {
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

      // Wait for the custom element to be defined AND initialized (fallback to 2D
      // after 5s). Requiring the element registration ensures the 3D overlay
      // primitives (gmp-polygon-3d / gmp-polyline-3d) used for drawing are ready.
      const elementReady = () =>
        Boolean((window as any).customElements?.get('gmp-map-3d')) && map3d.center !== undefined;
      let elapsed = 0;
      const check = setInterval(() => {
        elapsed += 200;
        if (elementReady()) {
          clearInterval(check);
          gcRef.current = new google.maps.Geocoder();
          setReady(true);
          if (addr) setSearch(addr);
          if (!savedCamera) centerOnUserIfNoTarget();
        } else if (elapsed >= 5000) {
          clearInterval(check);
          console.warn('[gmaps] 3D map failed to initialize, falling back to 2D');
          try { mapDiv.current?.removeChild(map3d); } catch {}
          map3dRef.current = null;
          setIs3dMode(false);
          if (!mapDiv.current) return;
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
          if (addr) setSearch(addr);
          if (!savedCamera) centerOnUserIfNoTarget();
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
      if (addr) setSearch(addr);
      if (!savedCamera) centerOnUserIfNoTarget();
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
    // Fill the search field with the client address for a quick manual lookup,
    // but do NOT recenter the map — the rep is on site, so it stays on their
    // live GPS position. They can hit search if they want to jump to the address.
    setSearch(addr);
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

  // Center on the user's current location when there's no address / saved camera
  // to target — same principle as the D2D sales map. Opens near the rep instantly
  // via the shared last-known-position cache, then refines with a live GPS fix.
  function applyUserCenter(lat: number, lng: number) {
    if (map3dRef.current) flyTo3d(lat, lng);
    else if (mapRef.current) { mapRef.current.setCenter({ lat, lng }); mapRef.current.setZoom(20); }
  }

  function centerOnUserIfNoTarget() {
    // Always center on the rep's live position when opening — they're on site
    // measuring the property. A previously saved camera for this quote still wins.
    if (savedCamera) return;
    // Instant: last-known position shared with the D2D map (key 'd2d-last-gps').
    try {
      const raw = localStorage.getItem('d2d-last-gps');
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p?.lat === 'number' && typeof p?.lng === 'number') applyUserCenter(p.lat, p.lng);
      }
    } catch {}
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        try { localStorage.setItem('d2d-last-gps', JSON.stringify({ lng, lat })); } catch {}
        if (savedCamera) return; // a saved camera appeared meanwhile
        applyUserCenter(lat, lng);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }

  // ════════════════════════════════════════════
  // LOAD SAVED MEASUREMENTS
  // ════════════════════════════════════════════

  useEffect(() => {
    if (!saved || shapes.length) return;
    const loaded = saved.map(m => {
      const points = geoJsonToPoints(m.geojson);
      return {
        id: `s-${m.id}`, label: m.label, color: m.color,
        result: {
          type: m.measurement_type, value: m.value,
          areaValue: m.area_value, perimeterValue: m.perimeter_value,
          geojson: m.geojson, points,
          // Elevation round-trips through the GeoJSON altitude on each point.
          elevation: elevationStats(points),
        } as any,
        notes: m.notes || '', visible: true,
        metadata: m.metadata ?? null,
      };
    });
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
      // The gmp-click event payload differs across Maps 3D API channels:
      // the position can live on the event itself or in e.detail, and lat/lng
      // can be plain numbers OR accessor functions. Normalise all cases.
      const read = (v: any): number => (typeof v === 'function' ? v() : v);
      const src = e?.position ?? e?.detail?.position ?? e?.latLng ?? e?.detail?.latLng;
      if (!src) return;
      const lat = read(src.lat);
      const lng = read(src.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      // Drop duplicate clicks: same spot within 350 ms = one physical tap that
      // the 3D map double-fired. Prevents the stray "second point" the user saw.
      const now = Date.now();
      const last = lastClick3d.current;
      if (last && now - last.t < 350 && haversineDistanceFt({ lat, lng }, last) < 2) return;
      lastClick3d.current = { t: now, lat, lng };

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

    // While a drawing tool is active, every map click must place exactly ONE
    // point. The 3D map's native double-click-to-zoom hijacks rapid clicks and
    // zooms instead — there's no API flag to disable it (verified against
    // Map3DElement options), so we swallow dblclick at the capture phase.
    const blockDblZoom = (e: Event) => { e.preventDefault(); e.stopPropagation(); };

    el.addEventListener('gmp-click', handler);
    el.addEventListener('dblclick', blockDblZoom, true);
    return () => {
      el.removeEventListener('gmp-click', handler);
      el.removeEventListener('dblclick', blockDblZoom, true);
    };
    // NOTE: `shapes` intentionally excluded — the handler never reads it, and
    // re-binding the listener on every saved measurement dropped in-flight clicks.
  }, [tool, ready, is3dMode]);

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

    // Render active drawing — a vertex dot at EVERY clicked point (so the very
    // first click gives immediate feedback) plus the connecting line/polygon.
    // Everything is clamped to the ground: floating overlays were stealing the
    // click ray, so points landed on the overlay instead of the terrain.
    if (pts.length >= 1 && tool !== 'select') {
      pts.forEach((p) => {
        const dot = make3dVertex(el, p.lat, p.lng, '#FF4444');
        if (dot) overlays3d.current.push(dot);
      });
    }
    if (pts.length >= 2) {
      const coords = pts.map(p => ({ lat: p.lat, lng: p.lng }));

      // A polygon fill needs ≥3 points; with 2 it renders as a degenerate sliver
      // that looked like a "stray shape". Until then, draw the connecting line.
      if (tool === 'polygon' && pts.length >= 3) {
        const poly = document.createElement('gmp-polygon-3d') as any;
        poly.setAttribute('altitude-mode', 'clamp-to-ground');
        poly.setAttribute('fill-color', 'rgba(255,68,68,0.25)');
        poly.setAttribute('stroke-color', '#FF4444');
        poly.setAttribute('stroke-width', '4');
        poly.setAttribute('draws-occluded-segments', '');
        poly.outerCoordinates = coords;
        el.appendChild(poly);
        overlays3d.current.push(poly);
      } else {
        const line = document.createElement('gmp-polyline-3d') as any;
        line.setAttribute('altitude-mode', 'clamp-to-ground');
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
      const coords = s.result.points.map(p => ({ lat: p.lat, lng: p.lng }));
      const sel = s.id === selId;

      if (s.result.type === 'polygon' && coords.length >= 3) {
        const poly = document.createElement('gmp-polygon-3d') as any;
        poly.setAttribute('altitude-mode', 'clamp-to-ground');
        poly.setAttribute('fill-color', hexToRgba(s.color, sel ? 0.35 : 0.18));
        poly.setAttribute('stroke-color', s.color);
        poly.setAttribute('stroke-width', sel ? '6' : '3');
        poly.setAttribute('draws-occluded-segments', '');
        poly.outerCoordinates = coords;
        el.appendChild(poly);
        overlays3d.current.push(poly);
      } else if (coords.length >= 2) {
        const line = document.createElement('gmp-polyline-3d') as any;
        line.setAttribute('altitude-mode', 'clamp-to-ground');
        line.setAttribute('stroke-color', s.color);
        line.setAttribute('stroke-width', sel ? '8' : '4');
        line.setAttribute('draws-occluded-segments', '');
        line.coordinates = coords;
        el.appendChild(line);
        overlays3d.current.push(line);
      }

      // Vertex dots for the saved shape (skip when a huge number of points).
      if (s.result.points.length <= 60) {
        s.result.points.forEach((p) => {
          const dot = make3dVertex(el, p.lat, p.lng, s.color);
          if (dot) overlays3d.current.push(dot);
        });
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
      strokeColor: '#FF4444', strokeWeight: 2, strokeOpacity: 0.6, icons: dashIcon, clickable: false, map,
    }));
    const dist = haversineDistanceFt(lastPt, snapped);
    if (dist > 0.5) cursorOv.current.push(mkLabel(map, midpoint(lastPt, snapped), fmtLen(dist)));
    if (tool === 'polygon' && pts.length >= 2) {
      const allPts = [...pts, snapped];
      cursorOv.current.push(new google.maps.Polyline({
        path: [new google.maps.LatLng(snapped.lat, snapped.lng), new google.maps.LatLng(pts[0].lat, pts[0].lng)],
        strokeColor: '#FF4444', strokeWeight: 2, strokeOpacity: 0.6, icons: dashIcon, clickable: false, map,
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
        drawOv.current.push(new google.maps.Polygon({ paths: path, strokeColor: '#FF4444', strokeWeight: 2, fillColor: '#FF4444', fillOpacity: 0.15, clickable: false, map }));
      } else {
        drawOv.current.push(new google.maps.Polyline({ path, strokeColor: '#FF4444', strokeWeight: 3, clickable: false, map }));
      }
      for (let i = 1; i < pts.length; i++) drawOv.current.push(mkLabel(map, midpoint(pts[i - 1], pts[i]), fmtLen(haversineDistanceFt(pts[i - 1], pts[i]))));
      if (tool === 'polygon' && pts.length >= 3) {
        drawOv.current.push(mkLabel(map, midpoint(pts[pts.length - 1], pts[0]), fmtLen(haversineDistanceFt(pts[pts.length - 1], pts[0]))));
        drawOv.current.push(mkLabel(map, centroid(pts), `⬡ ${fmtArea(computeMeasurement('polygon', pts).value)}`));
      }
      if (tool === 'path' && pts.length > 2) drawOv.current.push(mkLabel(map, pts[pts.length - 1], `Total: ${fmtLen(computeMeasurement('path', pts).value)}`));
    }
    path.forEach(p => {
      drawOv.current.push(new google.maps.Marker({ position: p, map, clickable: false, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: '#FFF', fillOpacity: 1, strokeColor: '#FF4444', strokeWeight: 2 }, zIndex: 100 }));
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
      // Height measurements are captured in the 3D modal: their 2 points have a
      // near-zero horizontal footprint and altitudes that MUST NOT be re-derived.
      // Render a single non-draggable pin + label so they never become a stray
      // zero-length line and can't be dragged through computeMeasurement/enrichElevation.
      if (s.metadata?.kind === 'height') {
        const base = s.result.points[0];
        if (base) {
          const sel = s.id === selId;
          const marker = new google.maps.Marker({
            position: new google.maps.LatLng(base.lat, base.lng), map,
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: sel ? 7 : 5, fillColor: sel ? '#FFFFFF' : s.color, fillOpacity: 1, strokeColor: s.color, strokeWeight: sel ? 3 : 1.5 },
            zIndex: sel ? 200 : 50, cursor: 'pointer',
          });
          marker.addListener('click', () => setSelId(s.id));
          shapeOv.current.push(marker);
          shapeOv.current.push(mkLabel(map, base, `↕ ${fmtLen(s.result.value)}`));
        }
        return;
      }
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
          const newPts = [...s.result.points]; newPts[vi] = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          setShapes(prev => prev.map(sh =>
            sh.id === s.id ? { ...sh, result: computeMeasurement(sh.result.type, newPts) } : sh,
          ));
          // The moved vertex lost its elevation — re-query so height stays accurate.
          enrichElevation(s.id, s.result.type, newPts);
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
    enrichElevation(newId, type, points);
  }

  // Query ground elevation for a shape's points (one batched Google Elevation
  // request) and fold the result back in so the sidebar can show height/grade.
  // Non-blocking: the measurement is already usable; elevation just enriches it.
  async function enrichElevation(id: string, type: MeasurementType, points: LatLng[]) {
    const withElev = await fetchElevations(points);
    if (!withElev.some(p => typeof p.elevation === 'number')) return;
    setShapes(prev => prev.map(s => s.id === id ? { ...s, result: computeMeasurement(type, withElev) } : s));
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
      await persistShapes(quoteId, getCameraStateNow());
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

  // Height measurements are informational (a building height isn't a billable
  // per-foot quantity), so they're excluded from the quote line items.
  function buildMeasureItems(startOrder: number): QuoteLineItemInput[] {
    return shapes.filter(s => s.metadata?.kind !== 'height').map((s, i) => ({
      name: `${s.label} (${formatMeasurementValue(s.result.type, s.result.value, unitSystem)})`,
      description: `${formatMeasurementValue(s.result.type, s.result.value, unitSystem)}${
        s.result.type === 'polygon' && s.result.perimeterValue ? ` • ${fr ? 'Périmètre' : 'Perimeter'}: ${fmtLen(s.result.perimeterValue)}` : ''
      }${s.notes ? ` — ${s.notes}` : ''}`,
      quantity: r2(s.result.value), unit_price_cents: 0,
      sort_order: startOrder + i, is_optional: false, item_type: 'service' as const,
    }));
  }

  async function persistShapes(toQuoteId: string, camState: CameraState) {
    await deleteAllMeasurements(toQuoteId);
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i];
      await createMeasurement({
        quote_id: toQuoteId, measurement_type: s.result.type, label: s.label,
        unit: s.result.type === 'polygon' ? (unitSystem === 'metric' ? 'm²' : 'sq ft') : (unitSystem === 'metric' ? 'm' : 'ft'),
        value: r2(s.result.value),
        area_value: s.result.areaValue ? r2(s.result.areaValue) : null,
        perimeter_value: s.result.perimeterValue ? r2(s.result.perimeterValue) : null,
        geojson: s.result.geojson, notes: s.notes || null, color: s.color, sort_order: i,
        camera_state: camState,
        metadata: (s.metadata || s.result.elevation)
          ? { ...(s.metadata || {}), ...(s.result.elevation ? { elevation: s.result.elevation } : {}) }
          : null,
      });
    }
    await saveQuoteCamera(toQuoteId, camState, search, unitSystem);
  }

  async function doSend() {
    if (!shapes.length) return;
    // Standalone measure (no quote yet): pick a client, the quote gets created
    // from the measured address instead of dead-ending on an error toast.
    if (!quoteId || !quote) { setQuotePickerOpen(true); return; }
    setSaving(true);
    try {
      const existing: QuoteLineItemInput[] = (quote.line_items || []).map((li, i) => ({
        source_service_id: li.source_service_id, name: li.name, description: li.description,
        quantity: li.quantity, unit_price_cents: li.unit_price_cents, sort_order: i,
        is_optional: li.is_optional, item_type: li.item_type, image_url: li.image_url,
      }));
      const items = buildMeasureItems(existing.length);
      await saveQuoteLineItems(quoteId, [...existing, ...items]);
      qc.invalidateQueries({ queryKey: ['quoteDetail', quoteId] });
      toast.success(fr ? `${shapes.length} mesure(s) envoyée(s)` : `${shapes.length} sent`);
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setSaving(false); }
  }

  async function createQuoteFromMeasures(clientId: string) {
    setQuotePickerOpen(false);
    setSaving(true);
    try {
      const title = search.trim() || (fr ? 'Devis — mesures satellite' : 'Quote — satellite measurements');
      const created = await createQuote({
        client_id: clientId,
        context_type: 'client',
        title,
        line_items: buildMeasureItems(0),
      });
      const newQuoteId = created.quote.id;
      await persistShapes(newQuoteId, getCameraStateNow());
      toast.success(fr ? 'Devis créé avec les mesures' : 'Quote created with measurements');
      nav(`/quotes/${newQuoteId}`);
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
      if (e.key === '2') handleToolChange('path');
      if (e.key === '3') handleToolChange('polygon');
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
          onOpenHeight={() => setHeightOpen(true)}
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
              {tool === 'line' && (fr ? 'Cliquez 2 points sur la carte' : 'Click 2 points on the map')}
              {tool === 'path' && (fr ? 'Cliquez pour placer des points • Entrée pour terminer' : 'Click to place points • Enter to finish')}
              {tool === 'polygon' && (fr ? 'Cliquez pour placer des points • Entrée pour fermer la zone' : 'Click to place points • Enter to close the area')}
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

      {heightOpen && (
        <HeightTool3D
          quoteAddress={addr}
          fr={fr}
          unitSystem={unitSystem}
          index={cnt.current}
          onComplete={(shape) => { cnt.current++; setShapes(p => [...p, shape]); setSelId(shape.id); }}
          onClose={() => setHeightOpen(false)}
        />
      )}

      {quotePickerOpen && (
        <MeasureClientPicker
          fr={fr}
          address={search.trim()}
          onClose={() => setQuotePickerOpen(false)}
          onPick={(clientId) => void createQuoteFromMeasures(clientId)}
        />
      )}
    </div>
  );
}

// ── Client picker for standalone measure → quote creation ──
function MeasureClientPicker({ fr, address, onClose, onPick }: {
  fr: boolean; address: string; onClose: () => void; onPick: (clientId: string) => void;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      listClients({ q: q.trim() || undefined, pageSize: 8 })
        .then((r) => { if (active) { setItems(r.items); setLoading(false); } })
        .catch(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [q]);

  async function createAndPick() {
    if (!firstName.trim() || !lastName.trim()) return;
    setBusy(true);
    try {
      // The measured address becomes the new client's address.
      const created = await createClient({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        address: address || undefined,
      });
      onPick(created.id);
    } catch (e: any) {
      toast.error(e?.message || 'Failed');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-outline/30 bg-surface-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[14px] font-semibold text-text-primary">{fr ? 'Créer le devis — pour quel client ?' : 'Create the quote — which client?'}</h2>
        <p className="mt-0.5 text-[11px] text-text-muted">
          {fr ? 'Le devis sera créé avec vos mesures en lignes.' : 'The quote will be created with your measurements as line items.'}
          {address ? ` — ${address}` : ''}
        </p>
        {!creating ? (
          <>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={fr ? 'Rechercher un client…' : 'Search clients…'}
              className="glass-input w-full mt-3"
            />
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-outline/20">
              {loading ? (
                <p className="px-3 py-2.5 text-[12px] text-text-muted">…</p>
              ) : items.length === 0 ? (
                <p className="px-3 py-2.5 text-[12px] text-text-muted">{fr ? 'Aucun client trouvé.' : 'No clients found.'}</p>
              ) : (
                items.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={busy}
                    onClick={() => { setBusy(true); onPick(c.id); }}
                    className="w-full px-3 py-2 text-left hover:bg-surface-secondary transition-colors disabled:opacity-50"
                  >
                    <span className="block text-[12px] font-semibold text-text-primary">
                      {clientDisplayName(c) || `${c.first_name} ${c.last_name}`.trim()}
                    </span>
                    {c.address && <span className="block truncate text-[11px] text-text-muted">{c.address}</span>}
                  </button>
                ))
              )}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <button type="button" onClick={() => setCreating(true)} className="text-[12px] font-medium text-text-secondary hover:text-text-primary transition-colors">
                ＋ {fr ? 'Nouveau client' : 'New client'}
              </button>
              <button type="button" onClick={onClose} className="glass-button px-3 py-1.5 rounded-lg text-[12px]">{fr ? 'Annuler' : 'Cancel'}</button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <input autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder={fr ? 'Prénom' : 'First name'} className="glass-input w-full" />
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder={fr ? 'Nom' : 'Last name'} className="glass-input w-full" />
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="glass-button px-3 py-1.5 rounded-lg text-[12px]">{fr ? 'Retour' : 'Back'}</button>
              <button
                type="button"
                onClick={createAndPick}
                disabled={busy || !firstName.trim() || !lastName.trim()}
                className="glass-button-primary px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-40"
              >
                {busy ? '…' : (fr ? 'Créer et continuer' : 'Create & continue')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──

function mkLabel(map: google.maps.Map, pos: LatLng, text: string): google.maps.Marker {
  return new google.maps.Marker({
    position: pos, map, clickable: false, zIndex: 200,
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

/**
 * Builds a small white vertex dot on the 3D map by drawing a tiny filled circle
 * with <gmp-polygon-3d> (reliable across API channels, unlike Marker3D pins).
 * Returns the appended element, or null if 3D polygons aren't available.
 */
function make3dVertex(parent: HTMLElement, lat: number, lng: number, color: string): HTMLElement | null {
  try {
    const dot = document.createElement('gmp-polygon-3d') as any;
    // Clamp to the ground so the dot hugs the terrain instead of floating — a
    // floating dot intercepts the click ray and corrupts the next point.
    dot.setAttribute('altitude-mode', 'clamp-to-ground');
    dot.setAttribute('fill-color', '#FFFFFF');
    dot.setAttribute('stroke-color', color);
    dot.setAttribute('stroke-width', '2');
    dot.setAttribute('draws-occluded-segments', '');
    const radiusM = 0.5; // ~0.5 m radius — visible but not obtrusive at house scale
    const dLat = radiusM / 111_320;
    const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
    const ring: Array<{ lat: number; lng: number }> = [];
    const segments = 12;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * 2 * Math.PI;
      ring.push({ lat: lat + dLat * Math.sin(a), lng: lng + dLng * Math.cos(a) });
    }
    dot.outerCoordinates = ring;
    parent.appendChild(dot);
    return dot;
  } catch {
    return null;
  }
}

function r2(n: number) { return Math.round(n * 100) / 100; }
