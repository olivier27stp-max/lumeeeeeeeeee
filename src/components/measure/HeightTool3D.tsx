/**
 * HeightTool3D — measure a building's REAL height in a full-screen 3D view.
 *
 * The user clicks once on a building. We read its true height from Google's DSM
 * data via the Solar API (highest roof plane − ground elevation) — the Elevation
 * API and the 3D click only return bare-earth terrain and can't see buildings.
 * If Google has no Solar coverage for that building, we fall back to manual entry
 * (number of floors × ~3 m, or an exact height).
 *
 * Fully isolated from the 2D drawing workspace: own <gmp-map-3d>, hands a finished
 * Shape back via onComplete. Stored as an ordinary 2-point 'line' with
 * metadata.kind === 'height' (no DB schema change).
 */

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Search, Loader2, RotateCcw, Check, MoveVertical, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import type { LatLng, UnitSystem, Shape } from '../../lib/measurementTypes';
import { nextColor, elevationStats, formatElevation } from '../../lib/measurementEngine';
import { fetchBuildingHeight, type BuildingHeightResult } from '../../lib/buildingHeightApi';
import { useGMaps3D } from './useGMaps3D';

const FT_TO_M = 0.3048;
const M_TO_FT = 1 / FT_TO_M;
const M_PER_FLOOR = 3; // typical storey height for the floor-count estimate

interface Props {
  quoteAddress: string;
  fr: boolean;
  unitSystem: UnitSystem;
  index: number;
  onComplete: (shape: Shape) => void;
  onClose: () => void;
}

type Picked = { lat: number; lng: number };

export default function HeightTool3D({ quoteAddress, fr, unitSystem, index, onComplete, onClose }: Props) {
  const { ok: mapsOk, key } = useGMaps3D();

  const mapDiv = useRef<HTMLDivElement>(null);
  const map3dRef = useRef<any>(null);
  const gcRef = useRef<any>(null);
  const overlays = useRef<HTMLElement[]>([]);
  const lastClick = useRef<{ t: number; lat: number; lng: number } | null>(null);
  const reqId = useRef(0);

  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState(quoteAddress || '');
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BuildingHeightResult | { found: false; reason: string } | null>(null);
  const [floors, setFloors] = useState('');
  const [manualH, setManualH] = useState('');

  // ── Geocode / fly helpers ──
  function flyTo(lat: number, lng: number) {
    const el = map3dRef.current;
    if (!el) return;
    el.center = { lat, lng, altitude: 120 };
    el.range = 230;
    el.tilt = 67;
  }
  function doGeocode(a: string) {
    if (!gcRef.current || !a.trim()) return;
    gcRef.current.geocode({ address: a }, (r: any, s: string) => {
      if (s === 'OK' && r?.[0]) { const loc = r[0].geometry.location; flyTo(loc.lat(), loc.lng()); }
    });
  }
  function centerOnUser() {
    try {
      const raw = localStorage.getItem('d2d-last-gps');
      if (raw) { const p = JSON.parse(raw); if (typeof p?.lat === 'number') flyTo(p.lat, p.lng); }
    } catch {}
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => flyTo(pos.coords.latitude, pos.coords.longitude),
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }

  // ── Init the 3D map ──
  useEffect(() => {
    if (!mapsOk || !mapDiv.current || map3dRef.current) return;
    const map3d = document.createElement('gmp-map-3d') as any;
    map3d.setAttribute('center', '45.5017,-73.5673,120');
    map3d.setAttribute('tilt', '67');
    map3d.setAttribute('range', '230');
    map3d.setAttribute('default-labels-disabled', '');
    map3d.style.width = '100%';
    map3d.style.height = '100%';
    mapDiv.current.appendChild(map3d);
    map3dRef.current = map3d;

    let elapsed = 0;
    const poll = setInterval(() => {
      elapsed += 200;
      const reg = (window as any).customElements?.get('gmp-map-3d');
      if (reg && map3d.center !== undefined) {
        clearInterval(poll);
        try { gcRef.current = new (window as any).google.maps.Geocoder(); } catch {}
        setReady(true);
        if (quoteAddress) doGeocode(quoteAddress); else centerOnUser();
      } else if (elapsed >= 6000) {
        clearInterval(poll);
        setReady(true);
      }
    }, 200);
    return () => {
      clearInterval(poll);
      overlays.current.forEach(o => { try { o.remove(); } catch {} });
      overlays.current = [];
      try { map3d.remove(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsOk]);

  // ── Single click → pick a building → query its height ──
  useEffect(() => {
    const el = map3dRef.current;
    if (!el || !ready) return;
    const read = (v: any): number => (typeof v === 'function' ? v() : v);

    const handler = (e: any) => {
      e.preventDefault?.();
      const src = e?.position ?? e?.detail?.position ?? e?.latLng ?? e?.detail?.latLng;
      if (!src) return;
      const lat = read(src.lat);
      const lng = read(src.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const now = Date.now();
      const l = lastClick.current;
      if (l && now - l.t < 350 && Math.hypot(lat - l.lat, lng - l.lng) < 0.00002) return;
      lastClick.current = { t: now, lat, lng };

      setPicked({ lat, lng });
      setResult(null);
      setLoading(true);
      const id = ++reqId.current;
      fetchBuildingHeight(lat, lng, key).then((r) => {
        if (id !== reqId.current) return; // a newer click superseded this
        setLoading(false);
        setResult(r);
        if (!r.found) toast.message(fr ? 'Pas de données Google pour ce bâtiment — entre la hauteur' : 'No Google data for this building — enter the height');
      });
    };
    const blockDbl = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };

    el.addEventListener('gmp-click', handler);
    el.addEventListener('dblclick', blockDbl, true);
    return () => {
      el.removeEventListener('gmp-click', handler);
      el.removeEventListener('dblclick', blockDbl, true);
    };
  }, [ready, key, fr]);

  // ── Marker on the picked building ──
  useEffect(() => {
    const el = map3dRef.current;
    if (!el) return;
    overlays.current.forEach(o => { try { o.remove(); } catch {} });
    overlays.current = [];
    if (picked) { const d = makeDot(el, picked.lat, picked.lng, '#FF4444'); if (d) overlays.current.push(d); }
  }, [picked]);

  // ── Resolve the height to commit (solar result OR manual entry) ──
  const manualMeters = (() => {
    const h = parseFloat(manualH);
    if (Number.isFinite(h) && h > 0) return unitSystem === 'metric' ? h : h * FT_TO_M;
    const f = parseFloat(floors);
    if (Number.isFinite(f) && f > 0) return f * M_PER_FLOOR;
    return 0;
  })();

  const solarFound = result?.found === true;
  const heightMeters = solarFound ? (result as BuildingHeightResult).heightMeters : manualMeters;
  const canAdd = !!picked && heightMeters > 0;

  function reset() {
    setPicked(null); setResult(null); setLoading(false);
    setFloors(''); setManualH('');
    lastClick.current = null;
    reqId.current++;
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim() || !gcRef.current) return;
    setSearching(true);
    gcRef.current.geocode({ address: search }, (r: any, s: string) => {
      setSearching(false);
      if (s === 'OK' && r?.[0]) { const loc = r[0].geometry.location; flyTo(loc.lat(), loc.lng()); }
      else toast.error(fr ? 'Adresse introuvable' : 'Address not found');
    });
  }

  function add() {
    if (!picked || heightMeters <= 0) return;
    const ground = solarFound ? (result as BuildingHeightResult).groundMeters : undefined;
    const point: LatLng = typeof ground === 'number'
      ? { lat: picked.lat, lng: picked.lng, elevation: ground }
      : { lat: picked.lat, lng: picked.lng };
    const points: LatLng[] = [point, point]; // 2-point degenerate line keeps GeoJSON valid
    const heightFt = heightMeters * M_TO_FT;
    const coord = typeof ground === 'number' ? [picked.lng, picked.lat, ground] : [picked.lng, picked.lat];
    const geojson: any = { type: 'LineString', coordinates: [coord, coord] };
    const shape: Shape = {
      id: `sh-${index}`,
      label: fr ? `Hauteur ${index + 1}` : `Height ${index + 1}`,
      color: nextColor(index),
      result: {
        type: 'line',
        value: heightFt,
        areaValue: null,
        perimeterValue: null,
        geojson,
        points,
        elevation: elevationStats(points),
      },
      notes: '',
      visible: true,
      metadata: {
        kind: 'height',
        heightMeters,
        source: solarFound ? 'solar' : 'manual',
        ...(solarFound ? {
          roofMaxMeters: (result as BuildingHeightResult).roofMaxMeters,
          groundMeters: (result as BuildingHeightResult).groundMeters,
        } : {}),
      },
    };
    onComplete(shape);
    onClose();
  }

  const fmt = (m: number) => formatElevation(m, unitSystem);
  const missReason = result && !result.found ? (result as any).reason : null;

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      {/* Top bar */}
      <div className="h-12 border-b border-outline/20 flex items-center px-4 gap-3 bg-surface-card shrink-0">
        <button onClick={onClose} className="p-1.5 hover:bg-surface-secondary rounded-lg transition-colors">
          <ArrowLeft size={16} className="text-text-secondary" />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <MoveVertical size={15} className="text-text-primary shrink-0" />
          <span className="text-[13px] font-bold text-text-primary truncate">{fr ? 'Hauteur du bâtiment' : 'Building height'}</span>
          <span className="text-[9px] font-bold bg-text-primary text-surface px-1.5 py-0.5 rounded">3D</span>
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

      {/* Map */}
      <div className="flex-1 relative">
        <div ref={mapDiv} className="absolute inset-0" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-10">
            <Loader2 size={28} className="animate-spin text-text-muted" />
          </div>
        )}

        {/* Instruction pill */}
        {!picked && ready && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gray-900/80 text-white text-[12px] px-4 py-1.5 rounded-full z-20 pointer-events-none backdrop-blur-sm font-medium">
            {fr ? 'Cliquez sur le bâtiment à mesurer' : 'Click the building to measure'}
          </div>
        )}

        {/* Result / manual card */}
        {picked && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-surface/95 backdrop-blur-sm border border-outline/30 rounded-2xl px-5 py-4 z-20 shadow-xl text-center min-w-[280px]">
            {loading ? (
              <div className="flex items-center gap-2 justify-center py-3 text-text-muted text-[12px]">
                <Loader2 size={16} className="animate-spin" /> {fr ? 'Lecture de la hauteur…' : 'Reading height…'}
              </div>
            ) : solarFound ? (
              <>
                <p className="text-[11px] text-text-muted font-medium uppercase tracking-wide flex items-center gap-1 justify-center">
                  <Building2 size={12} /> {fr ? 'Hauteur (Google)' : 'Height (Google)'}
                </p>
                <p className="text-3xl font-bold text-text-primary my-1">{fmt(heightMeters)}</p>
                <p className="text-[10px] text-text-muted/70">
                  {fr ? 'Toit' : 'Roof'} {fmt((result as BuildingHeightResult).roofMaxMeters)} − {fr ? 'sol' : 'ground'} {fmt((result as BuildingHeightResult).groundMeters)}
                </p>
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-text-secondary font-medium">
                  {fr ? 'Pas de données Google pour ce bâtiment.' : 'No Google data for this building.'}
                </p>
                <div className="flex items-center gap-2 justify-center">
                  <label className="text-[10px] text-text-muted">{fr ? 'Étages' : 'Floors'}</label>
                  <input type="number" min="0" value={floors} onChange={e => { setFloors(e.target.value); setManualH(''); }}
                    className="w-16 text-[12px] rounded-md border border-outline/30 bg-surface-card px-2 py-1 text-center" />
                  <span className="text-[10px] text-text-muted/60">{fr ? `→ ${fmt(manualMeters || 0)}` : `→ ${fmt(manualMeters || 0)}`}</span>
                </div>
                <div className="flex items-center gap-2 justify-center">
                  <label className="text-[10px] text-text-muted">{fr ? `Ou hauteur exacte (${unitSystem === 'metric' ? 'm' : 'pi'})` : `Or exact height (${unitSystem === 'metric' ? 'm' : 'ft'})`}</label>
                  <input type="number" min="0" step="0.1" value={manualH} onChange={e => { setManualH(e.target.value); setFloors(''); }}
                    className="w-20 text-[12px] rounded-md border border-outline/30 bg-surface-card px-2 py-1 text-center" />
                </div>
              </div>
            )}

            {!loading && (
              <div className="flex items-center gap-2 justify-center mt-3">
                <button onClick={reset} className="glass-button flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium">
                  <RotateCcw size={13} /> {fr ? 'Refaire' : 'Redo'}
                </button>
                <button onClick={add} disabled={!canAdd}
                  className="glass-button-primary flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-40">
                  <Check size={13} /> {fr ? 'Ajouter la mesure' : 'Add measurement'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Small filled circle clamped to the ground marking the picked building. */
function makeDot(parent: HTMLElement, lat: number, lng: number, color: string): HTMLElement | null {
  try {
    const dot = document.createElement('gmp-polygon-3d') as any;
    dot.setAttribute('altitude-mode', 'clamp-to-ground');
    dot.setAttribute('fill-color', '#FFFFFF');
    dot.setAttribute('stroke-color', color);
    dot.setAttribute('stroke-width', '2');
    dot.setAttribute('draws-occluded-segments', '');
    const radiusM = 1.2;
    const dLat = radiusM / 111_320;
    const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
    const ring: Array<{ lat: number; lng: number }> = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * 2 * Math.PI;
      ring.push({ lat: lat + dLat * Math.sin(a), lng: lng + dLng * Math.cos(a) });
    }
    dot.outerCoordinates = ring;
    parent.appendChild(dot);
    return dot;
  } catch {
    return null;
  }
}
