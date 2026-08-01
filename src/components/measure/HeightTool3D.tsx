/**
 * HeightTool3D — measure a building's height by placing TWO points and taking the
 * difference of their surface elevations.
 *
 * Reliable 2D satellite map (single-click). For each clicked point we read its
 * surface elevation: a point on a roof returns the real roof height (Solar DSM),
 * a point on the ground returns terrain elevation. Height = |elev(B) − elev(A)|.
 *
 * Fully isolated from the drawing workspace. Stored as an ordinary 2-point 'line'
 * with metadata.kind === 'height' (no DB schema change). Manual fallback when the
 * two points end up too close (e.g. no Solar roof data → both read terrain).
 */

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Search, Loader2, RotateCcw, Check, MoveVertical } from 'lucide-react';
import { toast } from 'sonner';
import type { LatLng, UnitSystem, Shape } from '../../lib/measurementTypes';
import { nextColor, elevationStats, formatElevation } from '../../lib/measurementEngine';
import { groundElevation, roofElevation } from '../../lib/buildingHeightApi';
import { useGMaps3D } from './useGMaps3D';
import Cam3DControls from './Cam3DControls';

const FT_TO_M = 0.3048;
const M_TO_FT = 1 / FT_TO_M;
const MIN_HEIGHT_M = 1;
// Hauteur typique de la caméra des voitures Street View (m). Sert de référence
// d'échelle au mode Photo : cliquer le pied du mur (angle sous l'horizon) donne
// la distance, puis l'angle du sommet donne la hauteur. C'est une ESTIMATION.
const SV_CAMERA_HEIGHT_M = 2.5;

interface Props {
  quoteAddress: string;
  fr: boolean;
  unitSystem: UnitSystem;
  index: number;
  onComplete: (shape: Shape) => void;
  onClose: () => void;
}

type Pt = { lat: number; lng: number; elev: number | null; onBuilding: boolean; loading: boolean; from3d?: boolean };

export default function HeightTool3D({ quoteAddress, fr, unitSystem, index, onComplete, onClose }: Props) {
  const { ok: mapsOk, key } = useGMaps3D();

  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const map3dRef = useRef<any>(null); // gmp-map-3d element (mode 3D photoréaliste)
  const overlays3d = useRef<HTMLElement[]>([]);
  const lastClick3d = useRef<{ t: number; lat: number; lng: number } | null>(null);
  const gcRef = useRef<google.maps.Geocoder | null>(null);
  const markers = useRef<google.maps.Marker[]>([]);
  const aRef = useRef<Pt | null>(null);
  const bRef = useRef<Pt | null>(null);

  const [ready, setReady] = useState(false);
  // Mode 3D photoréaliste : tenté par défaut, repli automatique sur la carte
  // satellite 2D si l'élément <gmp-map-3d> ne s'initialise pas.
  const [wants3d, setWants3d] = useState(true);
  const [is3d, setIs3d] = useState(false);
  const [search, setSearch] = useState(quoteAddress || '');
  const [searching, setSearching] = useState(false);
  const [ptA, setPtA] = useState<Pt | null>(null);
  const [ptB, setPtB] = useState<Pt | null>(null);
  const [manualH, setManualH] = useState('');

  // ── Mode « Photo » (Street View) — mesure par estimation trigonométrique ──
  const streetPanoDiv = useRef<HTMLDivElement>(null);
  const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const svTargetRef = useRef<{ lat: number; lng: number } | null>(null);
  const [streetMode, setStreetMode] = useState(false);
  const [streetState, setStreetState] = useState<'idle' | 'loading' | 'ok' | 'none'>('idle');
  const [svMeasuring, setSvMeasuring] = useState(false);
  const [svBase, setSvBase] = useState<{ pitch: number } | null>(null);
  const [svHeight, setSvHeight] = useState<number | null>(null);

  function setA(p: Pt | null) { aRef.current = p; setPtA(p); }
  function setB(p: Pt | null) { bRef.current = p; setPtB(p); }

  async function resolve(which: 'A' | 'B', lat: number, lng: number) {
    // Point 1 = base → ground/terrain; point 2 = top → roof (Solar DSM).
    const elev = which === 'A'
      ? await groundElevation(lat, lng).catch(() => null)
      : await roofElevation(lat, lng, key).catch(() => null);
    const cur = which === 'A' ? aRef.current : bRef.current;
    if (!cur || cur.lat !== lat || cur.lng !== lng) return; // superseded by a redo
    const done: Pt = { lat, lng, elev, onBuilding: which === 'B' && elev != null, loading: false };
    if (which === 'A') setA(done); else setB(done);
  }

  function onMapClick(lat: number, lng: number) {
    if (!aRef.current) {
      const p: Pt = { lat, lng, elev: null, onBuilding: false, loading: true };
      setA(p); resolve('A', lat, lng);
    } else if (!bRef.current) {
      const p: Pt = { lat, lng, elev: null, onBuilding: false, loading: true };
      setB(p); resolve('B', lat, lng);
    }
  }

  /** Clic sur la carte 3D photoréaliste : l'altitude du point cliqué (tuiles 3D)
   *  donne l'élévation directement — base au sol, sommet sur le bâtiment.
   *  Sans altitude (cas bêta), on retombe sur la résolution Solar/terrain. */
  function onMapClick3d(lat: number, lng: number, altitude: number | null) {
    const which: 'A' | 'B' | null = !aRef.current ? 'A' : !bRef.current ? 'B' : null;
    if (!which) return;
    if (altitude != null && Number.isFinite(altitude)) {
      const p: Pt = { lat, lng, elev: altitude, onBuilding: which === 'B', loading: false, from3d: true };
      if (which === 'A') setA(p); else setB(p);
    } else {
      const p: Pt = { lat, lng, elev: null, onBuilding: false, loading: true };
      if (which === 'A') setA(p); else setB(p);
      resolve(which, lat, lng);
    }
  }

  function flyTo(lat: number, lng: number) {
    if (map3dRef.current) {
      try {
        map3dRef.current.center = { lat, lng, altitude: 0 };
        map3dRef.current.range = 250;
        map3dRef.current.tilt = 65;
        return;
      } catch { /* retombe sur la carte 2D */ }
    }
    const m = mapRef.current; if (!m) return;
    m.setCenter({ lat, lng }); m.setZoom(20);
  }
  function centerOnUser() {
    try {
      const raw = localStorage.getItem('d2d-last-gps');
      if (raw) { const p = JSON.parse(raw); if (typeof p?.lat === 'number') flyTo(p.lat, p.lng); }
    } catch {}
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => flyTo(pos.coords.latitude, pos.coords.longitude),
      () => {}, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }

  // ── Init : carte 3D photoréaliste (avec repli 2D après 4 s) ──
  useEffect(() => {
    if (!mapsOk || !wants3d || !mapDiv.current || map3dRef.current || mapRef.current) return;
    let disposed = false;
    let map3d: any = null;
    try {
      map3d = document.createElement('gmp-map-3d') as any;
      map3d.setAttribute('center', '45.5017,-73.5673,0');
      map3d.setAttribute('tilt', '65');
      map3d.setAttribute('heading', '0');
      map3d.setAttribute('range', '400');
      map3d.setAttribute('mode', 'hybrid');
      map3d.style.width = '100%';
      map3d.style.height = '100%';
      mapDiv.current.appendChild(map3d);
    } catch {
      setWants3d(false);
      return;
    }

    const elementReady = () =>
      Boolean((window as any).customElements?.get('gmp-map-3d')) && map3d.center !== undefined;
    let elapsed = 0;
    const check = setInterval(() => {
      if (disposed) { clearInterval(check); return; }
      elapsed += 200;
      if (elementReady()) {
        clearInterval(check);
        map3dRef.current = map3d;
        setIs3d(true);
        gcRef.current = new google.maps.Geocoder();
        map3d.addEventListener('gmp-click', (e: any) => {
          try {
            const pos = e?.position;
            if (!pos) return;
            const lat = typeof pos.lat === 'function' ? pos.lat() : pos.lat;
            const lng = typeof pos.lng === 'function' ? pos.lng() : pos.lng;
            if (typeof lat !== 'number' || typeof lng !== 'number') return;
            // La bêta émet parfois 2 clics pour un tap — on déduplique.
            const now = Date.now();
            const last = lastClick3d.current;
            if (last && now - last.t < 400 && Math.abs(last.lat - lat) < 1e-7 && Math.abs(last.lng - lng) < 1e-7) return;
            lastClick3d.current = { t: now, lat, lng };
            const alt = typeof pos.altitude === 'number' && Number.isFinite(pos.altitude) ? pos.altitude : null;
            onMapClick3d(lat, lng, alt);
          } catch { /* clic 3D invalide — ignoré */ }
        });
        setReady(true);
        if (quoteAddress) {
          gcRef.current.geocode({ address: quoteAddress }, (r, s) => {
            if (s === 'OK' && r?.[0]) { const loc = r[0].geometry.location; flyTo(loc.lat(), loc.lng()); }
            else centerOnUser();
          });
        } else centerOnUser();
      } else if (elapsed >= 4000) {
        clearInterval(check);
        try { map3d.remove(); } catch {}
        setWants3d(false); // déclenche l'init 2D ci-dessous
      }
    }, 200);
    return () => { disposed = true; clearInterval(check); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsOk, wants3d]);

  // ── Init the 2D satellite map (repli, ou choix manuel « 2D ») ──
  useEffect(() => {
    if (!mapsOk || wants3d || !mapDiv.current || mapRef.current) return;
    const map = new google.maps.Map(mapDiv.current, {
      center: { lat: 45.5017, lng: -73.5673 }, zoom: 19,
      mapTypeId: 'hybrid', tilt: 45, heading: 0,
      zoomControl: true, mapTypeControl: true,
      mapTypeControlOptions: { position: google.maps.ControlPosition.TOP_RIGHT },
      scaleControl: true, streetViewControl: false, fullscreenControl: false,
      gestureHandling: 'greedy', rotateControl: true, clickableIcons: false,
    });
    mapRef.current = map;
    gcRef.current = new google.maps.Geocoder();
    map.setOptions({ draggableCursor: 'crosshair' });
    map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (e.latLng) onMapClick(e.latLng.lat(), e.latLng.lng());
    });
    setReady(true);
    if (quoteAddress) {
      gcRef.current.geocode({ address: quoteAddress }, (r, s) => {
        if (s === 'OK' && r?.[0]) { const loc = r[0].geometry.location; flyTo(loc.lat(), loc.lng()); }
        else centerOnUser();
      });
    } else centerOnUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsOk, wants3d]);

  // ── Bascule manuelle 2D ↔ 3D (réinitialise les points et la carte) ──
  function switchMode(to3d: boolean) {
    if (to3d === (wants3d || is3d)) return;
    reset();
    overlays3d.current.forEach(o => { try { o.remove(); } catch {} });
    overlays3d.current = [];
    if (map3dRef.current) { try { map3dRef.current.remove(); } catch {} map3dRef.current = null; }
    markers.current.forEach(m => m.setMap(null));
    markers.current = [];
    mapRef.current = null;
    // Vide le conteneur dans tous les cas — un <gmp-map-3d> en cours d'init
    // (pas encore dans map3dRef) resterait sinon par-dessus la nouvelle carte.
    if (mapDiv.current) mapDiv.current.innerHTML = '';
    setIs3d(false);
    setReady(false);
    setWants3d(to3d);
  }

  // ── Mode Photo : cible courante (dernière recherche, sinon centre de la carte) ──
  function currentTarget(): { lat: number; lng: number } {
    if (svTargetRef.current) return svTargetRef.current;
    try {
      if (map3dRef.current?.center) {
        const c = map3dRef.current.center;
        if (typeof c.lat === 'number') return { lat: c.lat, lng: c.lng };
      }
      const c2 = mapRef.current?.getCenter();
      if (c2) return { lat: c2.lat(), lng: c2.lng() };
    } catch { /* centre indisponible */ }
    return { lat: 45.5017, lng: -73.5673 };
  }

  // ── Mode Photo : chargement du panorama (imagerie officielle extérieure) ──
  useEffect(() => {
    if (!streetMode || streetState !== 'idle' || !streetPanoDiv.current) return;
    setStreetState('loading');
    const target = currentTarget();
    const svc = new google.maps.StreetViewService();
    const show = (data: google.maps.StreetViewPanoramaData) => {
      if (!data?.location?.latLng || !streetPanoDiv.current) { setStreetState('none'); return; }
      let heading = 0;
      try {
        heading = google.maps.geometry.spherical.computeHeading(
          data.location.latLng, new google.maps.LatLng(target.lat, target.lng));
      } catch { /* heading par défaut */ }
      streetPanoDiv.current.innerHTML = '';
      panoRef.current = new google.maps.StreetViewPanorama(streetPanoDiv.current, {
        pano: data.location.pano,
        pov: { heading, pitch: 0 },
        zoom: 0.8,
        addressControl: false,
        fullscreenControl: false,
        motionTracking: false,
        motionTrackingControl: false,
      });
      setStreetState('ok');
    };
    // Tentative stricte (officiel+extérieur), repli extérieur, garde-fou 10 s —
    // même mécanique que la visionneuse (Viewer3D).
    const attempt = (extra: Record<string, unknown>, onFail: () => void) => {
      let settled = false;
      const settle = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
      const timer = setTimeout(() => settle(onFail), 10000);
      try {
        const req = { location: target, radius: 120, preference: 'nearest', ...extra } as unknown as google.maps.StreetViewLocationRequest;
        const p: any = svc.getPanorama(req, (data, status) => {
          if (String(status).toUpperCase() === 'OK') settle(() => show(data as google.maps.StreetViewPanoramaData));
          else settle(onFail);
        });
        p?.catch?.(() => settle(onFail));
      } catch { settle(onFail); }
    };
    attempt({ sources: ['google', 'outdoor'] }, () =>
      attempt({ source: 'outdoor' }, () => setStreetState('none')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streetMode, streetState]);

  // ── Mode Photo : clic sur la photo → angle → hauteur estimée ──
  function svResetMeasure() { setSvBase(null); setSvHeight(null); }
  function svClick(e: React.MouseEvent<HTMLDivElement>) {
    const pano = panoRef.current;
    if (!pano) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pov = pano.getPov();
    const zoom = pano.getZoom() ?? 1;
    // FOV horizontal Street View ≈ 180°/2^zoom; projection rectilinéaire approx.
    const hfov = (180 / Math.pow(2, zoom)) * (Math.PI / 180);
    const f = (rect.width / 2) / Math.tan(hfov / 2);
    const upRad = Math.atan((rect.height / 2 - y) / f);
    const sideRad = Math.atan((x - rect.width / 2) / f);
    // Le pitch réel du rayon dépend un peu de l'écart horizontal — négligé (estimation).
    void sideRad;
    const pitchDeg = (pov.pitch ?? 0) + (upRad * 180) / Math.PI;
    if (!svBase) {
      if (pitchDeg >= -0.5) {
        toast.error(fr
          ? 'Cliquez d’abord le point où le mur touche le SOL (sous l’horizon).'
          : 'First click where the wall meets the GROUND (below the horizon).');
        return;
      }
      setSvBase({ pitch: pitchDeg });
    } else {
      const d = SV_CAMERA_HEIGHT_M / Math.tan((-svBase.pitch * Math.PI) / 180);
      const h = SV_CAMERA_HEIGHT_M + d * Math.tan((pitchDeg * Math.PI) / 180);
      if (!Number.isFinite(h) || h <= 0.3 || h > 200 || d > 120) {
        toast.error(fr ? 'Mesure invalide — recommencez plus près du mur.' : 'Invalid measurement — retry closer to the wall.');
        setSvBase(null);
        return;
      }
      setSvHeight(h);
      setSvMeasuring(false);
    }
  }

  function addStreetEstimate() {
    if (svHeight == null) return;
    const pos = panoRef.current?.getPosition?.();
    const base = pos ? { lat: pos.lat(), lng: pos.lng() } : currentTarget();
    const points: LatLng[] = [
      { lat: base.lat, lng: base.lng, elevation: 0 },
      { lat: base.lat, lng: base.lng, elevation: svHeight },
    ];
    const geojson: any = { type: 'LineString', coordinates: points.map(p => [p.lng, p.lat, p.elevation]) };
    const shape: Shape = {
      id: `sh-${index}`,
      label: fr ? `Hauteur ${index + 1} (photo)` : `Height ${index + 1} (photo)`,
      color: nextColor(index),
      result: { type: 'line', value: svHeight * M_TO_FT, areaValue: null, perimeterValue: null, geojson, points, elevation: elevationStats(points) },
      notes: '',
      visible: true,
      metadata: { kind: 'height', heightMeters: svHeight, source: 'street-estimate' },
    };
    onComplete(shape);
    onClose();
  }

  // ── Markers for the two points ──
  useEffect(() => {
    // Mode 3D : marqueurs et ligne verticale via les primitives 3D (best-effort —
    // la carte fonctionne sans eux, la carte latérale montre l'état des points).
    if (is3d && map3dRef.current) {
      overlays3d.current.forEach(o => { try { o.remove(); } catch {} });
      overlays3d.current = [];
      const map3d = map3dRef.current;
      const mk3d = (p: Pt, label: string) => {
        try {
          const m = document.createElement('gmp-marker-3d') as any;
          m.position = { lat: p.lat, lng: p.lng, altitude: p.elev ?? 0 };
          m.altitudeMode = p.elev != null ? 'absolute' : 'clamp-to-ground';
          m.label = label;
          map3d.appendChild(m);
          overlays3d.current.push(m);
        } catch { /* primitive 3D indisponible */ }
      };
      if (ptA) mk3d(ptA, '1');
      if (ptB) mk3d(ptB, '2');
      if (ptA && ptB) {
        try {
          const line = document.createElement('gmp-polyline-3d') as any;
          line.coordinates = [
            { lat: ptA.lat, lng: ptA.lng, altitude: ptA.elev ?? 0 },
            { lat: ptB.lat, lng: ptB.lng, altitude: ptB.elev ?? 0 },
          ];
          line.altitudeMode = 'absolute';
          line.strokeColor = '#FFCC00';
          line.strokeWidth = 8;
          map3d.appendChild(line);
          overlays3d.current.push(line);
        } catch { /* primitive 3D indisponible */ }
      }
      return;
    }
    markers.current.forEach(m => m.setMap(null));
    markers.current = [];
    const map = mapRef.current; if (!map) return;
    const mk = (p: Pt, color: string, label: string) => new google.maps.Marker({
      position: { lat: p.lat, lng: p.lng }, map, clickable: false,
      label: { text: label, color: '#FFF', fontSize: '11px', fontWeight: '700' },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: color, fillOpacity: 1, strokeColor: '#FFF', strokeWeight: 2 },
      zIndex: 200,
    });
    if (ptA) markers.current.push(mk(ptA, '#FF4444', '1'));
    if (ptB) markers.current.push(mk(ptB, '#44BB44', '2'));
    if (ptA && ptB) {
      const line = new google.maps.Polyline({
        path: [{ lat: ptA.lat, lng: ptA.lng }, { lat: ptB.lat, lng: ptB.lng }],
        strokeColor: '#FFCC00', strokeWeight: 3, clickable: false, map,
      });
      markers.current.push(line as any);
    }
  }, [ptA, ptB, is3d]);

  // ── Height = roof(point 2) − ground(point 1), or manual ──
  const bothDone = !!(ptA && ptB && !ptA.loading && !ptB.loading);
  const haveElevs = bothDone && ptA!.elev != null && ptB!.elev != null;
  const diffMeters = haveElevs ? Math.abs((ptB!.elev as number) - (ptA!.elev as number)) : 0;
  const manualMeters = (() => {
    const h = parseFloat(manualH);
    if (Number.isFinite(h) && h > 0) return unitSystem === 'metric' ? h : h * FT_TO_M;
    return 0;
  })();
  const roofMissing = bothDone && ptB!.elev == null;       // no Solar roof data at point 2
  const tooClose = haveElevs && diffMeters < MIN_HEIGHT_M;  // both points ~same level
  const needManual = bothDone && (roofMissing || tooClose);
  const heightMeters = manualMeters > 0 ? manualMeters : diffMeters;
  const canAdd = !!ptA && !!ptB && heightMeters > 0;

  function reset() { setA(null); setB(null); setManualH(''); }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;
    if (!gcRef.current) { try { gcRef.current = new google.maps.Geocoder(); } catch { return; } }
    setSearching(true);
    gcRef.current.geocode({ address: search }, (r, s) => {
      setSearching(false);
      if (s === 'OK' && r?.[0]) {
        const loc = r[0].geometry.location;
        svTargetRef.current = { lat: loc.lat(), lng: loc.lng() };
        if (streetMode) {
          // Recharge le panorama le plus proche de la nouvelle adresse.
          svResetMeasure(); setSvMeasuring(false); setStreetState('idle');
        } else {
          flyTo(loc.lat(), loc.lng());
        }
      } else toast.error(fr ? 'Adresse introuvable' : 'Address not found');
    });
  }

  function add() {
    if (!ptA || !ptB || heightMeters <= 0) return;
    const points: LatLng[] = [
      { lat: ptA.lat, lng: ptA.lng, ...(ptA.elev != null ? { elevation: ptA.elev } : {}) },
      { lat: ptB.lat, lng: ptB.lng, ...(ptB.elev != null ? { elevation: ptB.elev } : {}) },
    ];
    const heightFt = heightMeters * M_TO_FT;
    const geojson: any = { type: 'LineString', coordinates: points.map(p => p.elevation != null ? [p.lng, p.lat, p.elevation] : [p.lng, p.lat]) };
    const shape: Shape = {
      id: `sh-${index}`,
      label: fr ? `Hauteur ${index + 1}` : `Height ${index + 1}`,
      color: nextColor(index),
      result: { type: 'line', value: heightFt, areaValue: null, perimeterValue: null, geojson, points, elevation: elevationStats(points) },
      notes: '',
      visible: true,
      metadata: {
        kind: 'height',
        heightMeters,
        source: manualMeters > 0 ? 'manual' : (ptA.from3d && ptB.from3d ? '3d' : 'solar'),
        elevA: ptA.elev, elevB: ptB.elev,
      },
    };
    onComplete(shape);
    onClose();
  }

  const fmt = (m: number) => formatElevation(m, unitSystem);
  const step = !ptA ? 1 : !ptB ? 2 : 3;

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      <div className="h-12 border-b border-outline/20 flex items-center px-4 gap-3 bg-surface-card shrink-0">
        <button onClick={onClose} className="p-1.5 hover:bg-surface-secondary rounded-lg transition-colors">
          <ArrowLeft size={16} className="text-text-secondary" />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <MoveVertical size={15} className="text-text-primary shrink-0" />
          <span className="text-[13px] font-bold text-text-primary truncate">{fr ? 'Hauteur du bâtiment' : 'Building height'}</span>
        </div>
        <div className="flex items-center rounded-lg border border-outline/30 overflow-hidden shrink-0">
          <button onClick={() => { setStreetMode(false); switchMode(true); }}
            className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${!streetMode && (wants3d || is3d) ? 'bg-text-primary text-surface' : 'text-text-muted hover:text-text-primary'}`}>
            3D
          </button>
          <button onClick={() => { setStreetMode(false); switchMode(false); }}
            className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${!streetMode && !(wants3d || is3d) ? 'bg-text-primary text-surface' : 'text-text-muted hover:text-text-primary'}`}>
            2D
          </button>
          <button onClick={() => { if (!streetMode) { svResetMeasure(); setSvMeasuring(false); setStreetMode(true); if (streetState === 'none') setStreetState('idle'); } }}
            className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${streetMode ? 'bg-text-primary text-surface' : 'text-text-muted hover:text-text-primary'}`}>
            Photo
          </button>
        </div>
        <form onSubmit={handleSearch} className="flex-1 max-w-md mx-4">
          <div className="relative">
            {searching
              ? <Loader2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted animate-spin" />
              : <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />}
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={fr ? 'Rechercher une adresse...' : 'Search address...'}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-outline/30 bg-surface-secondary text-[12px] focus:outline-none focus:ring-2 focus:ring-text-primary/20 text-text-primary placeholder:text-text-muted" />
          </div>
        </form>
      </div>

      <div className="flex-1 relative">
        <div ref={mapDiv} className="absolute inset-0" />

        {/* ── Mode Photo : panorama Street View + couche de mesure ── */}
        <div ref={streetPanoDiv} className={`absolute inset-0 z-[15] ${streetMode ? '' : 'hidden'}`} />
        {streetMode && streetState === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-[16]">
            <Loader2 size={28} className="animate-spin text-text-muted" />
          </div>
        )}
        {streetMode && streetState === 'none' && (
          <div className="absolute inset-0 flex items-center justify-center z-[16]">
            <p className="text-[13px] text-text-secondary bg-surface-card border border-outline/30 rounded-xl px-4 py-3">
              {fr ? 'Street View n’est pas disponible ici — cherchez une adresse ou utilisez 2D/3D.' : 'Street View is not available here — search an address or use 2D/3D.'}
            </p>
          </div>
        )}
        {streetMode && streetState === 'ok' && svMeasuring && (
          <div className="absolute inset-0 z-[17] cursor-crosshair" onClick={svClick} />
        )}
        {streetMode && streetState === 'ok' && svMeasuring && svHeight == null && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gray-900/80 text-white text-[12px] px-4 py-1.5 rounded-full z-[18] pointer-events-none backdrop-blur-sm font-medium">
            {!svBase
              ? (fr ? '1. Cliquez le point où le mur touche le SOL' : '1. Click where the wall meets the GROUND')
              : (fr ? '2. Cliquez le SOMMET du mur (même verticale)' : '2. Click the TOP of the wall (same vertical)')}
          </div>
        )}
        {streetMode && streetState === 'ok' && !svMeasuring && svHeight == null && (
          <button
            onClick={() => { svResetMeasure(); setSvMeasuring(true); }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[18] glass-button-primary flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold shadow-xl"
          >
            <MoveVertical size={14} /> {fr ? 'Mesurer (estimation)' : 'Measure (estimate)'}
          </button>
        )}
        {streetMode && svHeight != null && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-surface/95 backdrop-blur-sm border border-outline/30 rounded-2xl px-5 py-4 z-[18] shadow-xl text-center min-w-[260px] space-y-1.5">
            <p className="text-[10px] text-text-muted font-semibold uppercase tracking-wide">
              {fr ? 'Estimation photo (±10-15 %)' : 'Photo estimate (±10-15%)'}
            </p>
            <p className="text-2xl font-bold text-text-primary">≈ {fmt(svHeight)}</p>
            <div className="flex items-center gap-2 justify-center pt-1">
              <button onClick={() => { svResetMeasure(); setSvMeasuring(true); }} className="glass-button flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium">
                <RotateCcw size={13} /> {fr ? 'Refaire' : 'Redo'}
              </button>
              <button onClick={addStreetEstimate} className="glass-button-primary flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold">
                <Check size={13} /> {fr ? 'Ajouter' : 'Add'}
              </button>
            </div>
          </div>
        )}

        {!streetMode && !ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-10">
            <Loader2 size={28} className="animate-spin text-text-muted" />
          </div>
        )}

        {!streetMode && is3d && ready && (
          <>
            <Cam3DControls getEl={() => map3dRef.current} fr={fr} className="absolute right-3 top-14 z-20" />
            <div className="absolute bottom-3 right-3 z-20 bg-gray-900/70 text-white/90 text-[10px] px-3 py-1.5 rounded-lg pointer-events-none backdrop-blur-sm hidden sm:block">
              {fr ? 'Glisser : déplacer · Ctrl+glisser : pivoter · Molette : zoom' : 'Drag: pan · Ctrl+drag: rotate · Scroll: zoom'}
            </div>
          </>
        )}

        {!streetMode && step < 3 && ready && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gray-900/80 text-white text-[12px] px-4 py-1.5 rounded-full z-20 pointer-events-none backdrop-blur-sm font-medium">
            {step === 1
              ? (is3d
                ? (fr ? '1. Cliquez la base du bâtiment (au sol)' : '1. Click the base of the building (on the ground)')
                : (fr ? '1. Cliquez le 1er point (ex: la base au sol)' : '1. Click point 1 (e.g. the base on the ground)'))
              : (is3d
                ? (fr ? '2. Cliquez le sommet du bâtiment en 3D' : '2. Click the top of the building in 3D')
                : (fr ? '2. Cliquez le 2e point (ex: le sommet du toit)' : '2. Click point 2 (e.g. the top of the roof)'))}
          </div>
        )}

        {!streetMode && (ptA || ptB) && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-surface/95 backdrop-blur-sm border border-outline/30 rounded-2xl px-5 py-4 z-20 shadow-xl text-center min-w-[280px] space-y-1.5">
            <div className="flex items-center justify-between gap-6 text-[11px] font-mono">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FF4444' }} />{fr ? 'Base (sol)' : 'Base (ground)'}</span>
              <span>{ptA ? (ptA.loading ? '…' : ptA.elev != null ? fmt(ptA.elev) : '—') : '—'}</span>
            </div>
            <div className="flex items-center justify-between gap-6 text-[11px] font-mono">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#44BB44' }} />{fr ? 'Sommet (toit)' : 'Top (roof)'}</span>
              <span>{ptB ? (ptB.loading ? '…' : ptB.elev != null ? fmt(ptB.elev) + ' 🏢' : (fr ? 'pas de toit' : 'no roof')) : '—'}</span>
            </div>

            {bothDone && (
              <>
                <div className="border-t border-outline/20 my-1.5" />
                {!needManual && (
                  <>
                    <p className="text-[11px] text-text-muted font-medium uppercase tracking-wide">{fr ? 'Hauteur' : 'Height'}</p>
                    <p className="text-2xl font-bold text-text-primary">{fmt(heightMeters)}</p>
                  </>
                )}
                {needManual && (
                  <div className="space-y-1.5 pt-0.5">
                    <p className="text-[10px] text-danger">
                      {roofMissing
                        ? (fr ? 'Pas de données de toit ici — saisis la hauteur :' : 'No roof data here — enter the height:')
                        : (fr ? 'Points au même niveau — mets le 2e sur le toit, ou saisis :' : 'Points at the same level — put point 2 on the roof, or enter:')}
                    </p>
                    <div className="flex items-center gap-2 justify-center">
                      <label className="text-[10px] text-text-muted">{fr ? `Hauteur (${unitSystem === 'metric' ? 'm' : 'pi'})` : `Height (${unitSystem === 'metric' ? 'm' : 'ft'})`}</label>
                      <input type="number" min="0" step="0.1" value={manualH} onChange={e => setManualH(e.target.value)}
                        className="w-20 text-[12px] rounded-md border border-outline/30 bg-surface-card px-2 py-1 text-center" />
                    </div>
                    {manualMeters > 0 && <p className="text-[13px] font-bold text-text-primary">{fmt(manualMeters)}</p>}
                  </div>
                )}
              </>
            )}

            <div className="flex items-center gap-2 justify-center pt-1">
              <button onClick={reset} className="glass-button flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium">
                <RotateCcw size={13} /> {fr ? 'Refaire' : 'Redo'}
              </button>
              <button onClick={add} disabled={!canAdd}
                className="glass-button-primary flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-40">
                <Check size={13} /> {fr ? 'Ajouter' : 'Add'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
