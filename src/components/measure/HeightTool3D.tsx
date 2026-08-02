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

const FT_TO_M = 0.3048;
const M_TO_FT = 1 / FT_TO_M;
const MIN_HEIGHT_M = 1;

interface Props {
  quoteAddress: string;
  fr: boolean;
  unitSystem: UnitSystem;
  index: number;
  onComplete: (shape: Shape) => void;
  onClose: () => void;
}

type Pt = { lat: number; lng: number; elev: number | null; onBuilding: boolean; loading: boolean };

export default function HeightTool3D({ quoteAddress, fr, unitSystem, index, onComplete, onClose }: Props) {
  const { ok: mapsOk, key } = useGMaps3D();

  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const gcRef = useRef<google.maps.Geocoder | null>(null);
  const markers = useRef<google.maps.Marker[]>([]);
  const aRef = useRef<Pt | null>(null);
  const bRef = useRef<Pt | null>(null);

  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState(quoteAddress || '');
  const [searching, setSearching] = useState(false);
  const [ptA, setPtA] = useState<Pt | null>(null);
  const [ptB, setPtB] = useState<Pt | null>(null);
  const [manualH, setManualH] = useState('');

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

  function flyTo(lat: number, lng: number) {
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

  // ── Init the 2D satellite map ──
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
  }, [mapsOk]);

  // ── Markers for the two points ──
  useEffect(() => {
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
  }, [ptA, ptB]);

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
    if (!search.trim() || !gcRef.current) return;
    setSearching(true);
    gcRef.current.geocode({ address: search }, (r, s) => {
      setSearching(false);
      if (s === 'OK' && r?.[0]) { const loc = r[0].geometry.location; flyTo(loc.lat(), loc.lng()); }
      else toast.error(fr ? 'Adresse introuvable' : 'Address not found');
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
        source: manualMeters > 0 ? 'manual' : 'solar',
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
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-10">
            <Loader2 size={28} className="animate-spin text-text-muted" />
          </div>
        )}

        {step < 3 && ready && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gray-900/80 text-white text-[12px] px-4 py-1.5 rounded-full z-20 pointer-events-none backdrop-blur-sm font-medium">
            {step === 1
              ? (fr ? '1. Cliquez le 1er point (ex: la base au sol)' : '1. Click point 1 (e.g. the base on the ground)')
              : (fr ? '2. Cliquez le 2e point (ex: le sommet du toit)' : '2. Click point 2 (e.g. the top of the roof)')}
          </div>
        )}

        {(ptA || ptB) && (
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
