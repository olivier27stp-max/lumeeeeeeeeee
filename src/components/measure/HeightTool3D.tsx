/**
 * HeightTool3D — full-screen photorealistic 3D modal to measure a REAL building
 * height. The user clicks the BASE of a building, then its TOP; we read the
 * clicked surface altitude from the 3D mesh (DSM, includes buildings) via the
 * gmp-click `position.altitude` (meters above sea level). Height = |topAlt − baseAlt|.
 *
 * This is fully isolated from the 2D drawing workspace: it mounts its OWN
 * <gmp-map-3d>, shares no refs/state with the main map, and only hands a finished
 * Shape back via onComplete. The height is stored as an ordinary 2-point 'line'
 * with metadata.kind === 'height', so no DB schema change is required.
 *
 * NOTE: the Maps 3D API (beta) is the only source of building-inclusive altitude —
 * the Elevation API returns bare-earth terrain and cannot measure building height.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Search, Loader2, RotateCcw, Check, MoveVertical } from 'lucide-react';
import { toast } from 'sonner';
import type { LatLng, UnitSystem, Shape } from '../../lib/measurementTypes';
import { nextColor, elevationStats, formatElevation } from '../../lib/measurementEngine';
import { useGMaps3D } from './useGMaps3D';

const M_TO_FT = 1 / 0.3048;
// Reject implausible reads (sky / adjacent-tile mis-picks): a height below this is
// likely two ground clicks or a failed altitude read; above this is almost
// certainly a bad pick. Tallest buildings on earth are < 830 m.
const MIN_HEIGHT_M = 1;
const MAX_HEIGHT_M = 830;

type Pt3D = { lat: number; lng: number; alt: number };

interface Props {
  quoteAddress: string;
  fr: boolean;
  unitSystem: UnitSystem;
  /** Running shape counter from the parent, for a unique id + colour. */
  index: number;
  onComplete: (shape: Shape) => void;
  onClose: () => void;
}

export default function HeightTool3D({ quoteAddress, fr, unitSystem, index, onComplete, onClose }: Props) {
  const { ok: mapsOk, key } = useGMaps3D();

  const mapDiv = useRef<HTMLDivElement>(null);
  const map3dRef = useRef<any>(null);
  const gcRef = useRef<any>(null);
  const overlays = useRef<HTMLElement[]>([]);
  const lastClick = useRef<{ t: number; lat: number; lng: number } | null>(null);
  const baseRef = useRef<Pt3D | null>(null);
  const topRef = useRef<Pt3D | null>(null);

  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState(quoteAddress || '');
  const [searching, setSearching] = useState(false);
  const [base, setBase] = useState<Pt3D | null>(null);
  const [top, setTop] = useState<Pt3D | null>(null);

  const step: 'base' | 'top' = base ? 'top' : 'base';

  // ── Geocode / fly helpers ──
  function flyTo(lat: number, lng: number) {
    const el = map3dRef.current;
    if (!el) return;
    el.center = { lat, lng, altitude: 120 };
    el.range = 220;
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

  // ── Init the 3D map (own instance) ──
  useEffect(() => {
    if (!mapsOk || !mapDiv.current || map3dRef.current) return;
    const map3d = document.createElement('gmp-map-3d') as any;
    map3d.setAttribute('center', '45.5017,-73.5673,120');
    map3d.setAttribute('tilt', '67');
    map3d.setAttribute('range', '220');
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
        setReady(true); // let the map show even if registration is slow
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

  // ── Click capture (base → top) ──
  useEffect(() => {
    const el = map3dRef.current;
    if (!el || !ready) return;

    const read = (v: any): number => (typeof v === 'function' ? v() : v);
    const handler = (e: any) => {
      e.preventDefault?.();
      const src = e?.position ?? e?.detail?.position ?? e?.latLng ?? e?.detail?.latLng;
      if (!src) return; // clicked sky / no surface
      const lat = read(src.lat);
      const lng = read(src.lng);
      const alt = read(src.altitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (!Number.isFinite(alt)) {
        toast.error(fr ? 'Surface non détectée — zoomez et recliquez' : 'No surface detected — zoom in and retry');
        return;
      }
      // De-dupe the beta map's occasional double-fire for one tap.
      const now = Date.now();
      const l = lastClick.current;
      if (l && now - l.t < 350 && Math.hypot(lat - l.lat, lng - l.lng) < 0.00002) return;
      lastClick.current = { t: now, lat, lng };

      const pt: Pt3D = { lat, lng, alt };
      if (!baseRef.current) { baseRef.current = pt; setBase(pt); }
      else if (!topRef.current) { topRef.current = pt; setTop(pt); }
    };
    // Swallow the 3D map's native double-click-to-zoom while measuring.
    const blockDbl = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };

    el.addEventListener('gmp-click', handler);
    el.addEventListener('dblclick', blockDbl, true);
    return () => {
      el.removeEventListener('gmp-click', handler);
      el.removeEventListener('dblclick', blockDbl, true);
    };
  }, [ready, fr]);

  // ── Render base/top dots + vertical connector at ABSOLUTE altitude ──
  useEffect(() => {
    const el = map3dRef.current;
    if (!el) return;
    overlays.current.forEach(o => { try { o.remove(); } catch {} });
    overlays.current = [];
    if (base) { const d = makeDot(el, base, '#FF4444'); if (d) overlays.current.push(d); }
    if (top) { const d = makeDot(el, top, '#44BB44'); if (d) overlays.current.push(d); }
    if (base && top) {
      try {
        const line = document.createElement('gmp-polyline-3d') as any;
        line.setAttribute('altitude-mode', 'absolute');
        line.setAttribute('stroke-color', '#FFCC00');
        line.setAttribute('stroke-width', '8');
        line.setAttribute('draws-occluded-segments', '');
        // Draw the vertical: base point, then straight up to the top's altitude.
        line.coordinates = [
          { lat: base.lat, lng: base.lng, altitude: base.alt },
          { lat: top.lat, lng: top.lng, altitude: top.alt },
        ];
        el.appendChild(line);
        overlays.current.push(line);
      } catch {}
    }
  }, [base, top]);

  // ── Height computation ──
  const heightMeters = base && top ? Math.abs(top.alt - base.alt) : 0;
  const heightValid = base && top && heightMeters >= MIN_HEIGHT_M && heightMeters <= MAX_HEIGHT_M;

  function reset() {
    baseRef.current = null; topRef.current = null;
    setBase(null); setTop(null);
    lastClick.current = null;
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
    if (!base || !top || !heightValid) return;
    // Lower altitude is the base, higher is the top — order-independent.
    const lower = base.alt <= top.alt ? base : top;
    const higher = base.alt <= top.alt ? top : base;
    const points: LatLng[] = [
      { lat: lower.lat, lng: lower.lng, elevation: lower.alt },
      { lat: higher.lat, lng: higher.lng, elevation: higher.alt },
    ];
    const heightFt = heightMeters * M_TO_FT;
    const geojson: any = { type: 'LineString', coordinates: points.map(p => [p.lng, p.lat, p.elevation]) };
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
      metadata: { kind: 'height', heightMeters, baseAltitude: lower.alt, topAltitude: higher.alt },
    };
    onComplete(shape);
    onClose();
  }

  const fmtAlt = (m: number) => formatElevation(m, unitSystem);

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      {/* Top bar */}
      <div className="h-12 border-b border-outline/20 flex items-center px-4 gap-3 bg-surface-card shrink-0">
        <button onClick={onClose} className="p-1.5 hover:bg-surface-secondary rounded-lg transition-colors">
          <ArrowLeft size={16} className="text-text-secondary" />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <MoveVertical size={15} className="text-text-primary shrink-0" />
          <span className="text-[13px] font-bold text-text-primary truncate">{fr ? 'Mesurer la hauteur' : 'Measure height'}</span>
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
        {!(base && top) && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gray-900/80 text-white text-[12px] px-4 py-1.5 rounded-full z-20 pointer-events-none backdrop-blur-sm font-medium">
            {step === 'base'
              ? (fr ? '1. Cliquez la BASE du bâtiment (au sol)' : '1. Click the building BASE (ground)')
              : (fr ? '2. Cliquez le SOMMET du bâtiment (toit)' : '2. Click the building TOP (roof)')}
          </div>
        )}

        {/* Live altitude readout (also serves as the empirical sanity check) */}
        {(base || top) && (
          <div className="absolute top-3 left-3 bg-surface/90 backdrop-blur-sm border border-outline/30 rounded-lg px-3 py-2 z-20 text-[11px] font-mono space-y-0.5">
            <div className="flex justify-between gap-4"><span className="text-text-muted">{fr ? 'Base' : 'Base'}</span><span className="text-text-primary">{base ? fmtAlt(base.alt) : '—'}</span></div>
            <div className="flex justify-between gap-4"><span className="text-text-muted">{fr ? 'Sommet' : 'Top'}</span><span className="text-text-primary">{top ? fmtAlt(top.alt) : '—'}</span></div>
          </div>
        )}

        {/* Result / confirm card */}
        {base && top && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-surface/95 backdrop-blur-sm border border-outline/30 rounded-2xl px-5 py-4 z-20 shadow-xl text-center min-w-[260px]">
            {heightValid ? (
              <>
                <p className="text-[11px] text-text-muted font-medium uppercase tracking-wide">{fr ? 'Hauteur' : 'Height'}</p>
                <p className="text-3xl font-bold text-text-primary my-1">{fmtAlt(heightMeters)}</p>
              </>
            ) : (
              <p className="text-[12px] text-danger font-medium my-2 max-w-[240px]">
                {fr
                  ? 'Mesure invalide — assurez-vous de cliquer la base puis le sommet du bâtiment, bien zoomé.'
                  : 'Invalid reading — click the base then the top of the building, zoomed in.'}
              </p>
            )}
            <div className="flex items-center gap-2 justify-center mt-2">
              <button onClick={reset} className="glass-button flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium">
                <RotateCcw size={13} /> {fr ? 'Refaire' : 'Redo'}
              </button>
              <button onClick={add} disabled={!heightValid}
                className="glass-button-primary flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-40">
                <Check size={13} /> {fr ? 'Ajouter la mesure' : 'Add measurement'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Small filled circle hugging the clicked surface at its ABSOLUTE altitude. */
function makeDot(parent: HTMLElement, p: Pt3D, color: string): HTMLElement | null {
  try {
    const dot = document.createElement('gmp-polygon-3d') as any;
    dot.setAttribute('altitude-mode', 'absolute');
    dot.setAttribute('fill-color', '#FFFFFF');
    dot.setAttribute('stroke-color', color);
    dot.setAttribute('stroke-width', '2');
    dot.setAttribute('draws-occluded-segments', '');
    const radiusM = 0.8;
    const dLat = radiusM / 111_320;
    const dLng = radiusM / (111_320 * Math.cos((p.lat * Math.PI) / 180));
    const ring: Array<{ lat: number; lng: number; altitude: number }> = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI;
      ring.push({ lat: p.lat + dLat * Math.sin(a), lng: p.lng + dLng * Math.cos(a), altitude: p.alt });
    }
    dot.outerCoordinates = ring;
    parent.appendChild(dot);
    return dot;
  } catch {
    return null;
  }
}
