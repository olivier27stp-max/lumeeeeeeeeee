/**
 * HeightTool3D — measure a building's REAL height.
 *
 * The user clicks once on a building (reliable 2D satellite map — the beta 3D
 * map's click was unreliable, and we only need the lat/lng anyway). We read the
 * building's true height from Google's DSM data via the Solar API
 * (highest roof plane − ground elevation) — the Elevation API and the 3D click
 * only return bare-earth terrain and can't see buildings. If Google has no Solar
 * coverage for that building, we fall back to manual entry (floors × ~3 m, or an
 * exact height).
 *
 * Fully isolated from the 2D drawing workspace: own map instance, hands a finished
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
  const mapRef = useRef<google.maps.Map | null>(null);
  const gcRef = useRef<google.maps.Geocoder | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const reqId = useRef(0);

  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState(quoteAddress || '');
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BuildingHeightResult | { found: false; reason: string } | null>(null);
  const [floors, setFloors] = useState('');
  const [manualH, setManualH] = useState('');

  function pick(lat: number, lng: number) {
    setPicked({ lat, lng });
    setResult(null);
    setLoading(true);
    setFloors(''); setManualH('');
    const id = ++reqId.current;
    fetchBuildingHeight(lat, lng, key).then((r) => {
      if (id !== reqId.current) return;
      setLoading(false);
      setResult(r);
      if (!r.found) toast.message(fr ? 'Pas de données Google pour ce bâtiment — entre la hauteur' : 'No Google data for this building — enter the height');
    }).catch(() => {
      if (id !== reqId.current) return;
      setLoading(false);
      setResult({ found: false, reason: 'error' });
    });
  }

  function flyTo(lat: number, lng: number) {
    const m = mapRef.current;
    if (!m) return;
    m.setCenter({ lat, lng });
    m.setZoom(20);
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

  // ── Init the 2D satellite map (reliable single-click) ──
  useEffect(() => {
    if (!mapsOk || !mapDiv.current || mapRef.current) return;
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
      if (e.latLng) pick(e.latLng.lat(), e.latLng.lng());
    });
    setReady(true);
    if (quoteAddress) {
      gcRef.current.geocode({ address: quoteAddress }, (r, s) => {
        if (s === 'OK' && r?.[0]) { const loc = r[0].geometry.location; flyTo(loc.lat(), loc.lng()); }
        else centerOnUser();
      });
    } else centerOnUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsOk]);

  // ── Marker on the picked building ──
  useEffect(() => {
    if (markerRef.current) { markerRef.current.setMap(null); markerRef.current = null; }
    const map = mapRef.current;
    if (!map || !picked) return;
    markerRef.current = new google.maps.Marker({
      position: { lat: picked.lat, lng: picked.lng }, map, clickable: false,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#FF4444', fillOpacity: 1, strokeColor: '#FFF', strokeWeight: 2 },
      zIndex: 200,
    });
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
    reqId.current++;
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim() || !gcRef.current) return;
    setSearching(true);
    gcRef.current.geocode({ address: search }, (r, s) => {
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
    const points: LatLng[] = [point, point];
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
                  <span className="text-[10px] text-text-muted/60">→ {fmt(manualMeters || 0)}</span>
                </div>
                <div className="flex items-center gap-2 justify-center">
                  <label className="text-[10px] text-text-muted">{fr ? `Ou hauteur (${unitSystem === 'metric' ? 'm' : 'pi'})` : `Or height (${unitSystem === 'metric' ? 'm' : 'ft'})`}</label>
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
