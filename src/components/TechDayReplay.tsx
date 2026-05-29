import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { X, ChevronLeft, ChevronRight, Loader2, Play, Pause, MapPin } from 'lucide-react';
import { getTrackingPointsForDay } from '../lib/trackingApi';
import type { TrackingPoint } from '../lib/trackingApi';

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; OpenStreetMap &copy; CARTO';

interface Props {
  userId: string;
  userName: string;
  onClose: () => void;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function FitBounds({ points }: { points: TrackingPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as L.LatLngTuple));
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [points, map]);
  return null;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
}

function distanceMeters(a: TrackingPoint, b: TrackingPoint): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const startIcon = L.divIcon({
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#10b981;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>`,
  className: '', iconSize: [18, 18], iconAnchor: [9, 9],
});
const endIcon = L.divIcon({
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#ef4444;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>`,
  className: '', iconSize: [18, 18], iconAnchor: [9, 9],
});

export default function TechDayReplay({ userId, userName, onClose }: Props) {
  const [date, setDate] = useState<string>(todayIso());
  const [points, setPoints] = useState<TrackingPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCursor(0);
    setPlaying(false);
    getTrackingPointsForDay(userId, date)
      .then((p) => { if (!cancelled) setPoints(p); })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, date]);

  useEffect(() => {
    if (!playing || points.length === 0) return;
    const id = setInterval(() => {
      setCursor((c) => {
        if (c >= points.length - 1) { setPlaying(false); return c; }
        return c + 1;
      });
    }, 200);
    return () => clearInterval(id);
  }, [playing, points.length]);

  const stats = useMemo(() => {
    if (points.length < 2) return { km: 0, durationMin: 0, count: points.length };
    let m = 0;
    for (let i = 1; i < points.length; i++) m += distanceMeters(points[i - 1], points[i]);
    const startT = new Date(points[0].recorded_at).getTime();
    const endT = new Date(points[points.length - 1].recorded_at).getTime();
    return { km: m / 1000, durationMin: Math.round((endT - startT) / 60_000), count: points.length };
  }, [points]);

  const polylinePositions = points.slice(0, cursor + 1).map((p) => [p.latitude, p.longitude] as L.LatLngTuple);
  const fullPath = points.map((p) => [p.latitude, p.longitude] as L.LatLngTuple);
  const currentPoint = points[cursor];

  return (
    <div className="fixed inset-0 z-[2000] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-2xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline">
          <div>
            <h2 className="text-[15px] font-bold text-text-primary">Journée de {userName}</h2>
            <p className="text-[12px] text-text-tertiary">
              {stats.count} points · {stats.km.toFixed(2)} km · {Math.floor(stats.durationMin / 60)}h {stats.durationMin % 60}m
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setDate((d) => shiftDate(d, -1))} className="p-1.5 rounded-lg hover:bg-surface-secondary"><ChevronLeft size={16} /></button>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-outline bg-surface-secondary text-[13px] font-medium"
            />
            <button onClick={() => setDate((d) => shiftDate(d, 1))} disabled={date >= todayIso()} className="p-1.5 rounded-lg hover:bg-surface-secondary disabled:opacity-30"><ChevronRight size={16} /></button>
            <button onClick={onClose} className="ml-2 p-1.5 rounded-lg hover:bg-surface-secondary"><X size={16} /></button>
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-surface/80">
              <Loader2 size={28} className="animate-spin text-text-muted" />
            </div>
          )}
          {!loading && error && (
            <div className="absolute inset-0 z-[1000] flex items-center justify-center">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
          {!loading && !error && points.length === 0 && (
            <div className="absolute inset-0 z-[1000] flex items-center justify-center pointer-events-none">
              <div className="flex flex-col items-center gap-2 text-text-tertiary">
                <MapPin size={32} />
                <p className="text-sm">Aucun point GPS pour {date}</p>
              </div>
            </div>
          )}
          <MapContainer center={[45.5017, -73.5673]} zoom={11} style={{ width: '100%', height: '100%' }}>
            <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
            <FitBounds points={points} />
            {fullPath.length > 1 && (
              <Polyline positions={fullPath} pathOptions={{ color: '#94a3b8', weight: 3, opacity: 0.5, dashArray: '4 6' }} />
            )}
            {polylinePositions.length > 1 && (
              <Polyline positions={polylinePositions} pathOptions={{ color: '#3b82f6', weight: 4, opacity: 0.9 }} />
            )}
            {points.length > 0 && (
              <Marker position={[points[0].latitude, points[0].longitude]} icon={startIcon} />
            )}
            {points.length > 1 && cursor === points.length - 1 && (
              <Marker position={[points[points.length - 1].latitude, points[points.length - 1].longitude]} icon={endIcon} />
            )}
            {currentPoint && (
              <CircleMarker
                center={[currentPoint.latitude, currentPoint.longitude]}
                radius={8}
                pathOptions={{ color: '#1e3a8a', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 }}
              />
            )}
          </MapContainer>
        </div>

        {/* Timeline / playback controls */}
        <div className="px-5 py-3 border-t border-outline bg-surface-card">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { if (cursor >= points.length - 1) setCursor(0); setPlaying((p) => !p); }}
              disabled={points.length < 2}
              className="w-9 h-9 rounded-full bg-text-primary text-surface flex items-center justify-center disabled:opacity-30"
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <input
              type="range" min={0} max={Math.max(0, points.length - 1)} value={cursor}
              onChange={(e) => { setCursor(Number(e.target.value)); setPlaying(false); }}
              disabled={points.length < 2}
              className="flex-1"
            />
            <div className="text-[12px] tabular-nums text-text-secondary w-32 text-right">
              {currentPoint ? formatTime(currentPoint.recorded_at) : '—'}
              <span className="text-text-tertiary"> · {cursor + 1}/{points.length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
