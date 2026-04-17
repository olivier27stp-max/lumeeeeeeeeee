import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polygon, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
// leaflet.heat loaded dynamically in HeatmapLayer
import MarkerClusterGroup from 'react-leaflet-cluster';
import {
  X, ChevronRight, MapPin, Star, CheckCircle2, XCircle, CircleDot,
  Clock, Phone as PhoneIcon, FileText, Mic, Plus, Filter, Search, Users,
  TrendingUp, Target, BarChart3, ChevronDown, Navigation, Layers,
  AlertCircle, ArrowRight, User, Calendar, Hash, Thermometer,
  Briefcase, Receipt, UserPlus, Sparkles, Zap, Mail, StickyNote,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
import { useJobModalController } from '../contexts/JobModalController';
import type {
  FieldHouse, FieldHouseDetail, FieldHouseEvent, FieldPin, FieldPinLight,
  FieldTerritory, FieldDailyStats, FieldStatsAggregated,
} from '../lib/fieldSalesApi';
import {
  getPins as fetchFieldPins, getHouseDetail as fetchFieldHouseDetail,
  addHouseEvent as createFieldHouseEvent,
  listTerritories as fetchFieldTerritories, getStats as fetchFieldStats,
  createHouse as createFieldHouse, createTerritory as createFieldTerritory,
  getAITerritoryRecommendations,
} from '../lib/fieldSalesApi';
import type { AITerritoryRecommendations } from '../lib/fieldSalesApi';
import QuoteCreateModal from '../components/quotes/QuoteCreateModal';
import CreateInvoiceModal from '../components/CreateInvoiceModal';

// ── Constants ─────────────────────────────────────────────────
const DEFAULT_CENTER: L.LatLngTuple = [45.5017, -73.5673];
const DEFAULT_ZOOM = 13;

// Satellite tiles (Esri) — real aerial photos of houses
const TILE_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TILE_SAT_LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
const TILE_ATTR = '&copy; Esri, Maxar, Earthstar Geographics';

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// ── Status config ─────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof MapPin; bgClass: string }> = {
  unknown:         { label: 'Unknown',         color: '#6b7280', icon: CircleDot,    bgClass: 'bg-gray-500' },
  no_answer:       { label: 'No Answer',       color: '#9ca3af', icon: CircleDot,    bgClass: 'bg-gray-400' },
  not_interested:  { label: 'Not Interested',  color: '#ef4444', icon: XCircle,      bgClass: 'bg-red-500' },
  lead:            { label: 'Lead',            color: '#3b82f6', icon: Star,         bgClass: 'bg-blue-500' },
  quote_sent:      { label: 'Quote Sent',      color: '#64748b', icon: FileText,     bgClass: 'bg-neutral-500' },
  sale:            { label: 'Sale',            color: '#22c55e', icon: CheckCircle2, bgClass: 'bg-green-500' },
  callback:        { label: 'Callback',        color: '#f59e0b', icon: PhoneIcon,     bgClass: 'bg-amber-500' },
  do_not_knock:    { label: 'Do Not Knock',    color: '#dc2626', icon: XCircle,      bgClass: 'bg-red-600' },
  revisit:         { label: 'Revisit',         color: '#06b6d4', icon: Clock,        bgClass: 'bg-cyan-500' },
};

const SCORE_CONFIG: Record<string, { label: string; color: string }> = {
  cold: { label: 'Cold', color: '#60a5fa' },
  warm: { label: 'Warm', color: '#f59e0b' },
  hot:  { label: 'Hot',  color: '#ef4444' },
};

const EVENT_TYPES = [
  { value: 'knock', label: 'Knock' },
  { value: 'no_answer', label: 'No Answer' },
  { value: 'lead', label: 'Lead' },
  { value: 'quote_sent', label: 'Quote Sent' },
  { value: 'sale', label: 'Sale' },
  { value: 'callback', label: 'Callback' },
  { value: 'note', label: 'Note' },
  { value: 'revisit', label: 'Revisit' },
  { value: 'do_not_knock', label: 'Do Not Knock' },
];

// ── Pin icon factory ──────────────────────────────────────────
function createPinIcon(status: string, hasNote: boolean, dark = true): L.DivIcon {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.unknown;
  const borderColor = dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.15)';
  const shadow = dark ? '0 2px 8px rgba(0,0,0,0.4)' : '0 2px 6px rgba(0,0,0,0.2)';
  const noteRing = hasNote ? `<div style="position:absolute;inset:-4px;border-radius:50%;border:2px solid ${cfg.color};opacity:0.5;animation:pulse 2s infinite"></div>` : '';
  return L.divIcon({
    className: 'field-pin',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div style="position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center">
      ${noteRing}
      <div style="width:26px;height:26px;border-radius:50%;background:${cfg.color};border:2px solid ${borderColor};box-shadow:${shadow}, 0 0 12px ${cfg.color}60;display:flex;align-items:center;justify-content:center">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          ${status === 'sale' ? '<polyline points="20 6 9 17 4 12"/>' :
            status === 'not_interested' || status === 'do_not_knock' ? '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' :
            status === 'lead' ? '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' :
            status === 'no_answer' ? '<circle cx="12" cy="12" r="8"/>' :
            '<circle cx="12" cy="12" r="4"/>'}
        </svg>
      </div>
    </div>`,
  });
}

// ── Heatmap layer (dynamic import of leaflet.heat) ──────────
function HeatmapLayer({ points }: { points: [number, number, number][] }) {
  const map = useMap();
  const layerRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if ((L as any).heatLayer) { setLoaded(true); return; }
    import('leaflet.heat').then(() => setLoaded(true)).catch(() => {
      // Fallback: try loading from node_modules directly
      const script = document.createElement('script');
      script.src = '/node_modules/leaflet.heat/dist/leaflet-heat.js';
      script.onload = () => setLoaded(true);
      document.head.appendChild(script);
    });
  }, []);

  useEffect(() => {
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    if (!loaded || points.length === 0 || !(L as any).heatLayer) return;
    layerRef.current = (L as any).heatLayer(points, { radius: 35, blur: 25, maxZoom: 17, max: 1.0, gradient: { 0.2: '#3b82f6', 0.4: '#22d3ee', 0.6: '#22c55e', 0.8: '#f59e0b', 1.0: '#ef4444' } }).addTo(map);
    return () => { if (layerRef.current) map.removeLayer(layerRef.current); };
  }, [map, points, loaded]);
  return null;
}

// ── Map bounds tracker ────────────────────────────────────────
function MapBoundsTracker({ onBoundsChange }: { onBoundsChange: (b: L.LatLngBounds) => void }) {
  const map = useMapEvents({
    moveend: () => onBoundsChange(map.getBounds()),
    zoomend: () => onBoundsChange(map.getBounds()),
  });
  useEffect(() => { onBoundsChange(map.getBounds()); }, []);
  return null;
}

// ── Map click handler (always opens pin creation, or draws territory) ──
function MapClickHandler({ mode, onMapClick }: { mode: 'view' | 'pin' | 'territory'; onMapClick: (latlng: L.LatLng) => void }) {
  useMapEvents({
    click: (e) => {
      onMapClick(e.latlng);
    },
  });
  return null;
}

// ── Create Pin Modal — full customer info + CRM flow triggers ──
function CreatePinModal({ latlng, onClose, onCreated, onContinueToJob, onContinueToQuote }: {
  latlng: L.LatLng;
  onClose: () => void;
  onCreated: (houseData?: any) => void;
  onContinueToJob: (address: string, clientId?: string) => void;
  onContinueToQuote: (address: string) => void;
}) {
  const [pinType, setPinType] = useState('lead');
  const [noteText, setNoteText] = useState('');
  const [address, setAddress] = useState(`${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [geocoding, setGeocoding] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Auto-focus name field
  useEffect(() => { setTimeout(() => nameRef.current?.focus(), 200); }, []);

  // Non-blocking reverse geocode
  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setGeocoding(true);
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}&zoom=18&addressdetails=1`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => {
        if (ctrl.signal.aborted) return;
        const a = d?.address;
        if (a) {
          // Build a proper street address from structured fields
          const num = a.house_number || '';
          const street = a.road || a.pedestrian || a.footway || '';
          const city = a.city || a.town || a.village || a.municipality || '';
          const state = a.state || a.province || '';
          const parts = [num && street ? `${num} ${street}` : street || '', city, state].filter(Boolean);
          if (parts.length > 0) { setAddress(parts.join(', ')); return; }
        }
        if (d?.display_name) setAddress(d.display_name.split(',').slice(0, 3).join(',').trim());
      })
      .catch(() => {})
      .finally(() => { if (!ctrl.signal.aborted) setGeocoding(false); });
    return () => ctrl.abort();
  }, [latlng]);

  const handleCreate = async (overrideStatus?: string) => {
    const status = overrideStatus ?? pinType;
    // Require customer info for CRM-linked statuses
    const requiresClientInfo = ['lead', 'sale', 'quote_sent'].includes(status);
    if (requiresClientInfo) {
      if (!customerName.trim()) {
        toast.error('Customer name is required for a lead/sale/quote');
        return;
      }
      if (!customerPhone.trim() && !customerEmail.trim()) {
        toast.error('Phone or email is required to create a client');
        return;
      }
    }
    setSubmitting(true);
    try {
      const result = await createFieldHouse({
        address, lat: latlng.lat, lng: latlng.lng, status,
        note_text: noteText || undefined,
        metadata: { customer_name: customerName, customer_phone: customerPhone, customer_email: customerEmail },
        // Extended fields sent to backend
        ...(customerName ? { customer_name: customerName } as any : {}),
        ...(customerPhone ? { customer_phone: customerPhone } as any : {}),
        ...(customerEmail ? { customer_email: customerEmail } as any : {}),
      });

      toast.success('Pin created');
      onCreated(result);

      // Status-driven CRM flow continuation
      if (status === 'sale') {
        onClose();
        onContinueToJob(address, (result as any)?.client_id);
      } else if (status === 'quote_sent') {
        onClose();
        onContinueToQuote(address);
      } else {
        onClose();
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create pin');
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 text-[11px] bg-surface-secondary border border-outline rounded-lg text-text-primary placeholder:text-text-tertiary outline-none focus:border-white/20';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ scale: 0.97, y: 8 }} animate={{ scale: 1, y: 0 }}
        transition={{ duration: 0.12, ease: 'easeOut' }}
        className="bg-surface border border-outline rounded-2xl shadow-2xl w-[400px] max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-4 py-3 border-b border-outline flex items-center justify-between sticky top-0 bg-surface z-10">
          <div className="flex-1 min-w-0">
            <h3 className="text-[13px] font-bold text-text-primary">New Pin</h3>
            <p className="text-[10px] text-text-tertiary mt-0.5 truncate">{geocoding ? 'Resolving address...' : address}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-secondary text-text-tertiary"><X size={14} /></button>
        </div>

        <div className="px-4 py-3 space-y-3">
          {/* Customer Info */}
          <div>
            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">Customer Info</p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <User size={12} className="text-text-tertiary shrink-0" />
                <input ref={nameRef} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Name" className={inputCls} />
              </div>
              <div className="flex gap-1.5">
                <div className="flex items-center gap-1.5 flex-1">
                  <PhoneIcon size={12} className="text-text-tertiary shrink-0" />
                  <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Phone" type="tel" className={inputCls} />
                </div>
                <div className="flex items-center gap-1.5 flex-1">
                  <Mail size={12} className="text-text-tertiary shrink-0" />
                  <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="Email" type="email" className={inputCls} />
                </div>
              </div>
            </div>
          </div>

          {/* Pin Status */}
          <div>
            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">Status</p>
            <div className="grid grid-cols-4 gap-1">
              {Object.entries(STATUS_CONFIG).filter(([k]) => k !== 'unknown').map(([key, cfg]) => (
                <button key={key} onClick={() => setPinType(key)}
                  className={cn('flex flex-col items-center gap-1 py-2 px-1 rounded-lg text-[9px] font-medium border transition-all',
                    pinType === key
                      ? 'border-white/20 bg-white/5 text-text-primary'
                      : 'border-outline text-text-tertiary hover:text-text-secondary hover:border-white/10')}>
                  <div className="w-3 h-3 rounded-full" style={{ background: cfg.color }} />
                  {cfg.label}
                </button>
              ))}
            </div>
            {pinType === 'sale' && (
              <p className="text-[10px] text-green-400 mt-1.5 flex items-center gap-1"><Briefcase size={10} /> Will open Job creation after saving</p>
            )}
            {pinType === 'quote_sent' && (
              <p className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-1"><FileText size={10} /> Will open Quote creation after saving</p>
            )}
          </div>

          {/* Note */}
          <div>
            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1.5">Note</p>
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
              className={cn(inputCls, 'resize-none')}
              rows={2} placeholder="e.g. Dog in yard, call before coming, pays cash..." />
          </div>

          {/* Create */}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={() => handleCreate()} disabled={submitting}
              className="flex-1 py-2.5 rounded-lg bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors disabled:opacity-50">
              {submitting ? 'Creating...' : pinType === 'sale' ? 'Create & Open Job' : pinType === 'quote_sent' ? 'Create & Open Quote' : `Create ${STATUS_CONFIG[pinType]?.label ?? 'Pin'}`}
            </button>
            <button onClick={onClose} className="px-3 py-2.5 rounded-lg border border-outline text-text-tertiary text-[11px] font-medium hover:text-text-secondary">
              Cancel
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Territory Drawing Polyline Renderer ───────────────────────
function TerritoryDrawingOverlay({ points }: { points: L.LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    const polyline = L.polyline(points, { color: '#6366f1', weight: 2, dashArray: '6 4', opacity: 0.8 }).addTo(map);
    return () => { map.removeLayer(polyline); };
  }, [points, map]);
  return null;
}

// ── Territory Setup Panel ─────────────────────────────────────
function TerritorySetupPanel({ onSave, onCancel, reps }: {
  onSave: (data: { name: string; color: string; assigned_rep_id: string | null; is_exclusive: boolean; notes: string }) => void;
  onCancel: () => void;
  reps: Array<{ id: string; display_name: string }>;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [repId, setRepId] = useState('');
  const [exclusive, setExclusive] = useState(false);
  const [notes, setNotes] = useState('');

  const COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#64748b', '#06b6d4', '#ec4899'];

  return (
    <motion.div initial={{ x: 420, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 420, opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed right-0 top-0 bottom-0 w-[380px] bg-surface border-l border-outline z-[1000] flex flex-col shadow-2xl">
      <div className="px-5 py-4 border-b border-outline">
        <h2 className="text-[15px] font-bold text-text-primary">Territory Setup</h2>
        <p className="text-[11px] text-text-tertiary mt-0.5">Configure the new territory zone</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Name */}
        <div>
          <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider block mb-1.5">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North District"
            className="w-full px-3 py-2.5 bg-surface-secondary border border-outline rounded-lg text-[13px] text-text-primary placeholder:text-text-tertiary outline-none focus:border-white/20" />
        </div>

        {/* Color */}
        <div>
          <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider block mb-2">Color</label>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)}
                className={cn('w-7 h-7 rounded-full transition-all', color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-surface scale-110' : 'opacity-60 hover:opacity-100')}
                style={{ background: c }} />
            ))}
          </div>
        </div>

        {/* Assign Rep */}
        <div>
          <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider block mb-1.5">Assign to Rep</label>
          <select value={repId} onChange={(e) => setRepId(e.target.value)}
            className="w-full px-3 py-2.5 bg-surface-secondary border border-outline rounded-lg text-[13px] text-text-primary outline-none focus:border-white/20">
            <option value="">Unassigned</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>{r.display_name}</option>
            ))}
          </select>
        </div>

        {/* Exclusive toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[12px] font-semibold text-text-primary">Exclusive Territory</p>
            <p className="text-[10px] text-text-tertiary mt-0.5">Only assigned rep can operate here</p>
          </div>
          <button onClick={() => setExclusive(!exclusive)}
            className={cn('w-10 h-5 rounded-full transition-colors relative', exclusive ? 'bg-white' : 'bg-outline')}>
            <div className={cn('w-4 h-4 rounded-full absolute top-0.5 transition-all', exclusive ? 'left-5.5 bg-black left-[22px]' : 'left-0.5 bg-text-tertiary')} />
          </button>
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider block mb-1.5">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Instructions for the rep..."
            rows={3} className="w-full px-3 py-2 bg-surface-secondary border border-outline rounded-lg text-[12px] text-text-primary placeholder:text-text-tertiary resize-none outline-none focus:border-white/20" />
        </div>
      </div>

      <div className="px-5 py-4 border-t border-outline flex items-center gap-2">
        <button onClick={() => { if (!name.trim()) { toast.error('Name required'); return; } onSave({ name, color, assigned_rep_id: repId || null, is_exclusive: exclusive, notes }); }}
          className="flex-1 py-2.5 rounded-lg bg-white text-black text-[12px] font-semibold hover:bg-white/90 transition-colors">
          Save Territory
        </button>
        <button onClick={onCancel} className="px-4 py-2.5 rounded-lg border border-outline text-text-tertiary text-[12px] font-medium hover:text-text-secondary">
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

// ── Territory Detail Panel (view/edit/delete) ─────────────────
function TerritoryDetailPanel({ territory, reps, onClose, onDelete, onUpdate }: {
  territory: FieldTerritory;
  reps: Array<{ id: string; display_name: string }>;
  onClose: () => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: any) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(territory.name);
  const [color, setColor] = useState(territory.color || '#6366f1');
  const [repId, setRepId] = useState((territory as any).assigned_rep_id || (territory as any).assigned_user_id || '');
  const [exclusive, setExclusive] = useState((territory as any).is_exclusive || false);
  const [notes, setNotes] = useState((territory as any).notes || '');
  const [deleting, setDeleting] = useState(false);

  const COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#64748b', '#06b6d4', '#ec4899'];
  const assignedRep = reps.find((r) => r.id === repId);

  return (
    <motion.div initial={{ x: 420, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 420, opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed right-0 top-0 bottom-0 w-[380px] bg-surface border-l border-outline z-[1000] flex flex-col shadow-2xl">
      {/* Header */}
      <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ background: territory.color || '#6366f1' }} />
          <h2 className="text-[15px] font-bold text-text-primary">{territory.name}</h2>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-tertiary"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {!editing ? (
          <>
            {/* View mode */}
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Assigned Rep</p>
                <p className="text-[13px] text-text-primary mt-0.5">{assignedRep?.display_name || 'Unassigned'}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Exclusive</p>
                <p className="text-[13px] text-text-primary mt-0.5">{exclusive ? 'Yes' : 'No'}</p>
              </div>
              {notes && (
                <div>
                  <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Notes</p>
                  <p className="text-[12px] text-text-secondary mt-0.5 whitespace-pre-wrap">{notes}</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Edit mode */}
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider block mb-1.5">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2.5 bg-surface-secondary border border-outline rounded-lg text-[13px] text-text-primary outline-none focus:border-white/20" />
            </div>
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider block mb-2">Color</label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button key={c} onClick={() => setColor(c)}
                    className={cn('w-7 h-7 rounded-full transition-all', color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-surface scale-110' : 'opacity-60 hover:opacity-100')}
                    style={{ background: c }} />
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider block mb-1.5">Assign Rep</label>
              <select value={repId} onChange={(e) => setRepId(e.target.value)}
                className="w-full px-3 py-2.5 bg-surface-secondary border border-outline rounded-lg text-[13px] text-text-primary outline-none">
                <option value="">Unassigned</option>
                {reps.map((r) => <option key={r.id} value={r.id}>{r.display_name}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12px] font-semibold text-text-primary">Exclusive</p>
                <p className="text-[10px] text-text-tertiary">Only assigned rep can work here</p>
              </div>
              <button onClick={() => setExclusive(!exclusive)}
                className={cn('w-10 h-5 rounded-full transition-colors relative', exclusive ? 'bg-white' : 'bg-outline')}>
                <div className={cn('w-4 h-4 rounded-full absolute top-0.5 transition-all', exclusive ? 'left-[22px] bg-black' : 'left-0.5 bg-text-tertiary')} />
              </button>
            </div>
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider block mb-1.5">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                className="w-full px-3 py-2 bg-surface-secondary border border-outline rounded-lg text-[12px] text-text-primary placeholder:text-text-tertiary resize-none outline-none" />
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="px-5 py-4 border-t border-outline space-y-2">
        {!editing ? (
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(true)}
              className="flex-1 py-2.5 rounded-lg border border-outline text-text-primary text-[12px] font-semibold hover:bg-surface-secondary transition-colors">
              Edit
            </button>
            <button onClick={() => setDeleting(true)}
              className="px-4 py-2.5 rounded-lg border border-red-500/30 text-red-400 text-[12px] font-medium hover:bg-red-500/10 transition-colors">
              Delete
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={() => { onUpdate(territory.id, { name, color, assigned_rep_id: repId || null, is_exclusive: exclusive, notes }); setEditing(false); }}
              className="flex-1 py-2.5 rounded-lg bg-white text-black text-[12px] font-semibold hover:bg-white/90 transition-colors">
              Save Changes
            </button>
            <button onClick={() => setEditing(false)}
              className="px-4 py-2.5 rounded-lg border border-outline text-text-tertiary text-[12px] font-medium">
              Cancel
            </button>
          </div>
        )}

        {/* Delete confirmation */}
        <AnimatePresence>
          {deleting && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden">
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-[12px] text-red-400 font-medium mb-2">Delete this territory permanently?</p>
                <div className="flex gap-2">
                  <button onClick={() => { onDelete(territory.id); }}
                    className="px-4 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600">
                    Yes, Delete
                  </button>
                  <button onClick={() => setDeleting(false)}
                    className="px-4 py-1.5 rounded-lg border border-outline text-text-tertiary text-[11px]">
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Fly to component ──────────────────────────────────────────
function FlyTo({ lat, lng, zoom }: { lat: number; lng: number; zoom?: number }) {
  const map = useMap();
  useEffect(() => { map.flyTo([lat, lng], zoom ?? 17, { duration: 0.8 }); }, [lat, lng]);
  return null;
}

// ── User location marker (blue pulsing dot) ──────────────────
function UserLocationMarker({ position }: { position: L.LatLngTuple }) {
  const icon = useMemo(() => L.divIcon({
    className: 'user-location-pin',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div style="position:relative;width:20px;height:20px;display:flex;align-items:center;justify-content:center">
      <div style="position:absolute;inset:0;border-radius:50%;background:rgba(59,130,246,0.2);animation:userPulse 2s ease-out infinite"></div>
      <div style="width:12px;height:12px;border-radius:50%;background:#3b82f6;border:2.5px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>
    </div>`,
  }), []);

  return <Marker position={position} icon={icon} interactive={false} />;
}

// ── Auto-center on user location once ─────────────────────────
function CenterOnUser({ position }: { position: L.LatLngTuple }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (!done.current) {
      map.setView(position, 15, { animate: true, duration: 1 });
      done.current = true;
    }
  }, [position]);
  return null;
}

// ── Timeline event component ──────────────────────────────────
function TimelineEvent({ event, isLast, onDelete }: { event: FieldHouseEvent; isLast: boolean; onDelete?: (eventId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const cfg = STATUS_CONFIG[event.event_type] || STATUS_CONFIG.unknown;
  const Icon = cfg.icon;
  const timeAgo = useMemo(() => {
    const diff = Date.now() - new Date(event.created_at).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(event.created_at).toLocaleDateString();
  }, [event.created_at]);

  return (
    <div className="flex gap-3">
      {/* Timeline line + dot */}
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ background: `${cfg.color}20`, border: `2px solid ${cfg.color}` }}>
          <Icon size={12} style={{ color: cfg.color }} />
        </div>
        {!isLast && <div className="w-px flex-1 bg-outline/50 my-1" />}
      </div>

      {/* Content */}
      <div className={cn('group flex-1 pb-4 min-w-0', !isLast && 'border-b border-outline/30 mb-1')}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="text-[12px] font-semibold text-text-primary">{cfg.label}</span>
            <span className="text-[10px] text-text-tertiary ml-2">{timeAgo}</span>
          </div>
          {onDelete && !confirming && (
            <button onClick={() => setConfirming(true)} className="p-1 rounded hover:bg-red-500/10 text-text-tertiary hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100" title="Delete">
              <X size={11} />
            </button>
          )}
          {confirming && (
            <div className="flex items-center gap-1">
              <button onClick={() => { onDelete(event.id); setConfirming(false); }} className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-semibold hover:bg-red-500/30">Delete</button>
              <button onClick={() => setConfirming(false)} className="text-[9px] px-1.5 py-0.5 rounded text-text-tertiary hover:text-text-secondary">Cancel</button>
            </div>
          )}
        </div>
        {(event as any).user_name && (
          <p className="text-[11px] text-text-tertiary mt-0.5 flex items-center gap-1">
            <User size={10} /> {(event as any).user_name}
          </p>
        )}
        {event.note_text && (
          <p className={cn('text-[12px] text-text-secondary mt-1.5 leading-relaxed', !expanded && 'line-clamp-2 cursor-pointer')}
            onClick={() => setExpanded(!expanded)}>
            {event.note_text}
          </p>
        )}
        {event.note_voice_url && (
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-primary">
            <Mic size={12} /> Voice note
          </div>
        )}
        {(event as any).ai_summary && (
          <div className="mt-1.5 px-2 py-1 bg-primary/5 border border-primary/10 rounded-lg text-[11px] text-text-secondary italic">
            AI: {(event as any).ai_summary}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Add Event Form ────────────────────────────────────────────
function AddEventForm({ houseId, onSuccess }: { houseId: string; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [eventType, setEventType] = useState('knock');
  const [noteText, setNoteText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await createFieldHouseEvent(houseId, {
        event_type: eventType,
        note_text: noteText || undefined,
      });
      toast.success('Event logged');
      setNoteText('');
      setOpen(false);
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message || 'Failed');
    }
    setSubmitting(false);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full py-2 rounded-lg border-2 border-dashed border-outline text-text-tertiary text-[12px] font-medium hover:border-primary hover:text-primary transition-colors flex items-center justify-center gap-1.5">
        <Plus size={13} /> Log Activity
      </button>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
      <div className="p-3 bg-surface-secondary rounded-xl border border-outline space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {EVENT_TYPES.map((et) => (
            <button key={et.value} onClick={() => setEventType(et.value)}
              className={cn('px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors border',
                eventType === et.value ? 'border-primary bg-primary/10 text-primary' : 'border-outline text-text-tertiary hover:text-text-secondary')}>
              {et.label}
            </button>
          ))}
        </div>
        <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add a note..." rows={2}
          className="w-full px-3 py-2 text-[12px] bg-surface border border-outline rounded-lg text-text-primary placeholder:text-text-tertiary resize-none outline-none focus:border-primary" />
        <div className="flex items-center gap-2">
          <button onClick={handleSubmit} disabled={submitting}
            className="glass-button-primary text-[11px] px-4 py-1.5 disabled:opacity-50">
            {submitting ? 'Saving...' : 'Save'}
          </button>
          <button onClick={() => setOpen(false)} className="glass-button text-[11px] px-3 py-1.5">Cancel</button>
        </div>
      </div>
    </motion.div>
  );
}

// ── House Drawer ──────────────────────────────────────────────
function HouseDrawer({ house, onClose, onRefresh, onDeleted, onOpenJob, onOpenQuote, onOpenInvoice, onOpenClient }: {
  house: FieldHouseDetail | null;
  onClose: () => void;
  onRefresh: () => void;
  onDeleted: () => void;
  onOpenJob: (address: string, clientId?: string) => void;
  onOpenQuote: () => void;
  onOpenInvoice: () => void;
  onOpenClient: () => void;
}) {
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showLinkMenu, setShowLinkMenu] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Editable customer info from metadata
  const meta = (house?.metadata || {}) as Record<string, any>;
  const [editName, setEditName] = useState(meta.customer_name || '');
  const [editPhone, setEditPhone] = useState(meta.customer_phone || '');
  const [editEmail, setEditEmail] = useState(meta.customer_email || '');
  const [editingContact, setEditingContact] = useState(false);
  const [savingContact, setSavingContact] = useState(false);

  // Sync state when house changes
  useEffect(() => {
    const m = (house?.metadata || {}) as Record<string, any>;
    setEditName(m.customer_name || '');
    setEditPhone(m.customer_phone || '');
    setEditEmail(m.customer_email || '');
    setEditingContact(false);
  }, [house?.id]);

  const handleSaveContact = async () => {
    if (!house) return;
    setSavingContact(true);
    try {
      const { updateHouse } = await import('../lib/fieldSalesApi');
      await updateHouse(house.id, {
        metadata: { ...meta, customer_name: editName.trim(), customer_phone: editPhone.trim(), customer_email: editEmail.trim() },
      });
      toast.success('Contact info updated');
      setEditingContact(false);
      onRefresh();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update');
    }
    setSavingContact(false);
  };

  if (!house) return null;
  const statusCfg = STATUS_CONFIG[house.current_status] || STATUS_CONFIG.unknown;
  const reknockScore = (house as any).reknock_priority_score ?? house.score ?? 0;
  const aiAction = (house as any).ai_next_action || house.next_action;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const { deleteHouse } = await import('../lib/fieldSalesApi');
      await deleteHouse(house.id);
      // Invalidate pin cache so deleted pin doesn't come back from localStorage
      try { localStorage.removeItem('lume:field-pins'); } catch {}
      toast.success('Pin deleted');
      onDeleted();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete');
    }
    setDeleting(false);
  };

  const handleQuickNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await createFieldHouseEvent(house.id, { event_type: 'note', note_text: noteText.trim() });
      setNoteText('');
      toast.success('Note saved');
      onRefresh();
    } catch (err: any) {
      toast.error(err?.message || 'Failed');
    }
    setSavingNote(false);
  };

  const handleLink = (entityType: string) => {
    onClose();
    if (entityType === 'job') onOpenJob(house.address, (house as any).client_id);
    else if (entityType === 'quote') onOpenQuote();
    else if (entityType === 'client') onOpenClient();
    else if (entityType === 'invoice') onOpenInvoice();
  };

  // Quick status buttons — 1 tap to change status
  const quickStatuses = [
    { key: 'knock', label: 'Knocked', event: 'knock' },
    { key: 'no_answer', label: 'No Answer', event: 'no_answer' },
    { key: 'lead', label: 'Interested', event: 'lead' },
    { key: 'not_interested', label: 'Not Int.', event: 'not_interested' },
    { key: 'callback', label: 'Callback', event: 'callback' },
    { key: 'sale', label: 'Sale', event: 'sale' },
  ];

  const handleQuickStatus = async (eventType: string) => {
    try {
      await createFieldHouseEvent(house.id, { event_type: eventType });
      toast.success(`Status: ${eventType}`);
      onRefresh();
      // If sale/won → continue to real job creation flow
      if (eventType === 'sale') {
        onClose();
        onOpenJob(house.address, (house as any).client_id);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed');
    }
  };

  return (
    <motion.div
      initial={{ x: 420, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 420, opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed right-0 top-0 bottom-0 w-[400px] bg-surface border-l border-outline z-[1010] flex flex-col shadow-2xl"
    >
      {/* Header */}
      <div className="p-4 border-b border-outline">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-bold text-text-primary leading-tight">{house.address}</h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={cn('px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider text-white', statusCfg.bgClass)}>
                {statusCfg.label}
              </span>
              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold border" style={{
                color: reknockScore > 60 ? '#22c55e' : reknockScore > 30 ? '#f59e0b' : '#6b7280',
                borderColor: (reknockScore > 60 ? '#22c55e' : reknockScore > 30 ? '#f59e0b' : '#6b7280') + '40',
              }}>
                Score {reknockScore}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-tertiary"><X size={16} /></button>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 mt-2.5 text-[10px] text-text-tertiary flex-wrap">
          <span className="flex items-center gap-1"><Hash size={10} /> {house.visit_count} visits</span>
          {house.last_activity_at && <span className="flex items-center gap-1"><Clock size={10} /> {new Date(house.last_activity_at).toLocaleDateString()}</span>}
          {(house as any).client_id && <span className="flex items-center gap-1 text-blue-400"><User size={10} /> Client linked</span>}
          {(house as any).quote_id && <span className="flex items-center gap-1 text-slate-400"><FileText size={10} /> Quote linked</span>}
          {(house as any).job_id && <span className="flex items-center gap-1 text-green-400"><Briefcase size={10} /> Job linked</span>}
          {(house as any).closed_by_name && <span className="flex items-center gap-1 text-text-secondary"><CheckCircle2 size={10} /> Closed by {(house as any).closed_by_name} ({(house as any).closed_by_role})</span>}
        </div>

        {/* Quick Actions — call, text, navigate */}
        <div className="flex gap-1.5 mt-3">
          {editPhone && (
            <>
              <a href={`tel:${editPhone}`} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] font-semibold hover:bg-green-500/20 transition-colors">
                <PhoneIcon size={12} /> Call
              </a>
              <a href={`sms:${editPhone}`} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-semibold hover:bg-blue-500/20 transition-colors">
                <Mail size={12} /> Text
              </a>
            </>
          )}
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(house.address)}`} target="_blank" rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-neutral-500/10 border border-neutral-500/20 text-neutral-400 text-[10px] font-semibold hover:bg-neutral-500/20 transition-colors">
            <Navigation size={12} /> Navigate
          </a>
          <a href={`https://waze.com/ul?q=${encodeURIComponent(house.address)}&navigate=yes`} target="_blank" rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-semibold hover:bg-cyan-500/20 transition-colors">
            <MapPin size={12} /> Waze
          </a>
        </div>
      </div>

      {/* Customer Contact Info */}
      <div className="px-4 py-3 border-b border-outline">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">Contact Info</p>
          {!editingContact ? (
            <button onClick={() => setEditingContact(true)} className="text-[10px] text-primary font-medium hover:underline">Edit</button>
          ) : (
            <div className="flex gap-1.5">
              <button onClick={() => { setEditingContact(false); const m = meta; setEditName(m.customer_name || ''); setEditPhone(m.customer_phone || ''); setEditEmail(m.customer_email || ''); }}
                className="text-[10px] text-text-tertiary hover:text-text-secondary">Cancel</button>
              <button onClick={handleSaveContact} disabled={savingContact}
                className="text-[10px] text-primary font-semibold hover:underline disabled:opacity-50">{savingContact ? 'Saving...' : 'Save'}</button>
            </div>
          )}
        </div>
        {editingContact ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <User size={11} className="text-text-tertiary shrink-0" />
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Customer name"
                className="flex-1 px-2.5 py-1.5 text-[11px] bg-surface-secondary border border-outline rounded-lg text-text-primary placeholder:text-text-tertiary outline-none focus:border-white/20" />
            </div>
            <div className="flex gap-1.5">
              <div className="flex items-center gap-1.5 flex-1">
                <PhoneIcon size={11} className="text-text-tertiary shrink-0" />
                <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="Phone" type="tel"
                  className="flex-1 px-2.5 py-1.5 text-[11px] bg-surface-secondary border border-outline rounded-lg text-text-primary placeholder:text-text-tertiary outline-none focus:border-white/20" />
              </div>
              <div className="flex items-center gap-1.5 flex-1">
                <Mail size={11} className="text-text-tertiary shrink-0" />
                <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email" type="email"
                  className="flex-1 px-2.5 py-1.5 text-[11px] bg-surface-secondary border border-outline rounded-lg text-text-primary placeholder:text-text-tertiary outline-none focus:border-white/20" />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {editName ? (
              <p className="text-[12px] font-semibold text-text-primary flex items-center gap-1.5"><User size={11} className="text-text-tertiary" />{editName}</p>
            ) : (
              <p className="text-[11px] text-text-tertiary italic flex items-center gap-1.5"><User size={11} />No name</p>
            )}
            <div className="flex gap-4">
              {editPhone ? (
                <a href={`tel:${editPhone}`} className="text-[11px] text-primary flex items-center gap-1 hover:underline"><PhoneIcon size={10} />{editPhone}</a>
              ) : (
                <span className="text-[11px] text-text-tertiary flex items-center gap-1"><PhoneIcon size={10} />—</span>
              )}
              {editEmail ? (
                <a href={`mailto:${editEmail}`} className="text-[11px] text-primary flex items-center gap-1 hover:underline"><Mail size={10} />{editEmail}</a>
              ) : (
                <span className="text-[11px] text-text-tertiary flex items-center gap-1"><Mail size={10} />—</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* AI Next Action */}
      {aiAction && (
        <div className="px-4 py-2.5 border-b border-outline bg-primary/[0.03]">
          <div className="flex items-center gap-2">
            <Sparkles size={12} className="text-amber-400 shrink-0" />
            <p className="text-[11px] text-text-secondary"><span className="font-semibold text-text-primary">AI:</span> {aiAction}</p>
          </div>
        </div>
      )}

      {/* Quick Status Actions — 1 tap */}
      <div className="px-4 py-3 border-b border-outline">
        <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">Quick Action</p>
        <div className="grid grid-cols-3 gap-1.5">
          {quickStatuses.map((qs) => {
            const cfg = STATUS_CONFIG[qs.key] || STATUS_CONFIG[qs.event] || STATUS_CONFIG.unknown;
            const isActive = house.current_status === qs.key || house.current_status === qs.event;
            return (
              <button key={qs.key} onClick={() => handleQuickStatus(qs.event)}
                className={cn('flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-medium border transition-all',
                  isActive ? 'border-white/20 bg-white/5 text-text-primary' : 'border-outline text-text-tertiary hover:border-white/10 hover:text-text-secondary')}>
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: cfg.color }} />
                {qs.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quick Note */}
      <div className="px-4 py-3 border-b border-outline">
        <div className="flex gap-2">
          <input value={noteText} onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleQuickNote(); } }}
            placeholder="Add a note... (Enter to save)"
            className="flex-1 px-3 py-2 text-[11px] bg-surface-secondary border border-outline rounded-lg text-text-primary placeholder:text-text-tertiary outline-none focus:border-white/20" />
          <button onClick={handleQuickNote} disabled={savingNote || !noteText.trim()}
            className="px-3 py-2 rounded-lg bg-white text-black text-[10px] font-semibold hover:bg-white/90 transition-colors disabled:opacity-30">
            {savingNote ? '...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Link & Create Actions */}
      <div className="px-4 py-3 border-b border-outline">
        <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">Create & Link</p>
        <div className="flex gap-1.5">
          {[
            { key: 'quote', label: 'Create Quote', icon: FileText, color: '#64748b' },
            { key: 'job', label: 'Create Job', icon: Briefcase, color: '#22c55e' },
            { key: 'client', label: 'Create Client', icon: UserPlus, color: '#3b82f6' },
            { key: 'invoice', label: 'Invoice', icon: Receipt, color: '#f59e0b' },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} onClick={() => handleLink(item.key)}
                className="flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-lg border border-outline hover:border-white/20 hover:bg-white/5 transition-all">
                <Icon size={13} style={{ color: item.color }} />
                <span className="text-[8px] font-medium text-text-tertiary leading-tight text-center">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Add Event (expanded form) */}
      <div className="px-4 py-3 border-b border-outline">
        <AddEventForm houseId={house.id} onSuccess={onRefresh} />
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <h3 className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-3">Activity Timeline</h3>
        {house.events && house.events.length > 0 ? (
          <div>
            {house.events.map((event, i) => (
              <TimelineEvent key={event.id} event={event} isLast={i === house.events.length - 1} onDelete={async (eventId) => {
                try {
                  const { deleteHouseEvent } = await import('../lib/fieldSalesApi');
                  await deleteHouseEvent(eventId);
                  toast.success('Event deleted');
                  onRefresh();
                } catch (err: any) {
                  toast.error(err?.message || 'Failed to delete');
                }
              }} />
            ))}
          </div>
        ) : (
          <div className="text-center py-6">
            <CircleDot size={20} className="mx-auto text-text-tertiary opacity-30 mb-1.5" />
            <p className="text-[11px] text-text-tertiary">No activity yet</p>
          </div>
        )}
      </div>

      {/* Footer: Delete */}
      <div className="px-4 py-3 border-t border-outline">
        {!showDelete ? (
          <button onClick={() => setShowDelete(true)}
            className="w-full py-2 rounded-lg border border-red-500/20 text-red-400 text-[11px] font-medium hover:bg-red-500/5 transition-colors">
            Delete Pin
          </button>
        ) : (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-[11px] text-red-400 font-medium mb-2">Delete this pin permanently?</p>
              <div className="flex gap-2">
                <button onClick={handleDelete} disabled={deleting}
                  className="px-4 py-1.5 rounded-lg bg-red-500 text-white text-[10px] font-semibold hover:bg-red-600 disabled:opacity-50">
                  {deleting ? 'Deleting...' : 'Yes, Delete'}
                </button>
                <button onClick={() => setShowDelete(false)}
                  className="px-4 py-1.5 rounded-lg border border-outline text-text-tertiary text-[10px]">
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// ── Stats Bar ─────────────────────────────────────────────────
function StatsBar({ stats }: { stats: { knocks: number; leads: number; sales: number; conversion: number } }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-surface/80 backdrop-blur-md border-b border-outline">
      {[
        { label: 'Knocks', value: stats.knocks, color: '#6b7280' },
        { label: 'Leads', value: stats.leads, color: '#3b82f6' },
        { label: 'Sales', value: stats.sales, color: '#22c55e' },
        { label: 'Rate', value: `${stats.conversion}%`, color: '#f59e0b' },
      ].map((s) => (
        <div key={s.label} className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
          <span className="text-[11px] text-text-tertiary">{s.label}</span>
          <span className="text-[12px] font-bold text-text-primary">{s.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
export default function FieldSales() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const isDark = useIsDark();
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { openJobModal } = useJobModalController();
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [fabAddress, setFabAddress] = useState('');

  // Measure sidebar width + header height dynamically
  const [sidebarW, setSidebarW] = useState(0);
  const [headerH, setHeaderH] = useState(0);
  useEffect(() => {
    const measure = () => {
      const aside = document.querySelector('aside');
      const header = document.querySelector('header');
      if (aside) setSidebarW(aside.getBoundingClientRect().width);
      if (header) {
        // header + any alert bars above the content area
        const main = header.parentElement;
        const contentArea = main?.querySelector('.overflow-y-auto, .overflow-hidden');
        if (contentArea) {
          setHeaderH(contentArea.getBoundingClientRect().top);
        } else {
          setHeaderH(header.getBoundingClientRect().bottom);
        }
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    const aside = document.querySelector('aside');
    const main = document.querySelector('main');
    if (aside) ro.observe(aside);
    if (main) ro.observe(main);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  // User location
  const [userLocation, setUserLocation] = useState<L.LatLngTuple | null>(null);
  const [showUserLocation, setShowUserLocation] = useState(false);
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  // State
  const [pins, setPins] = useState<FieldPinLight[]>([]);
  const [territories, setTerritories] = useState<FieldTerritory[]>([]);
  const [selectedHouse, setSelectedHouse] = useState<FieldHouseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showTerritories, setShowTerritories] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number } | null>(null);
  const [stats, setStats] = useState({ knocks: 0, leads: 0, sales: 0, conversion: 0 });

  // Modes: view (normal), pin (click to create pin), territory (click to draw polygon)
  const [mode, setMode] = useState<'view' | 'pin' | 'territory'>('view');
  const [pendingPinLatlng, setPendingPinLatlng] = useState<L.LatLng | null>(null);
  const [territoryPoints, setTerritoryPoints] = useState<L.LatLng[]>([]);
  const [showTerritorySetup, setShowTerritorySetup] = useState(false);
  const [pendingTerritoryCoords, setPendingTerritoryCoords] = useState<number[][]>([]);
  const [reps, setReps] = useState<Array<{ id: string; display_name: string }>>([]);
  const [selectedTerritory, setSelectedTerritory] = useState<FieldTerritory | null>(null);
  const [repFilter, setRepFilter] = useState<string>('all');
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [createEntityType, setCreateEntityType] = useState<string | null>(null);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [aiRecommendations, setAiRecommendations] = useState<AITerritoryRecommendations | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Batch 1+2 features
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [myPinsOnly, setMyPinsOnly] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [territoryStats, setTerritoryStats] = useState<Record<string, any> | null>(null);
  const [compareTerritories, setCompareTerritories] = useState<[FieldTerritory | null, FieldTerritory | null]>([null, null]);
  const [showCompare, setShowCompare] = useState(false);
  const [compareStats, setCompareStats] = useState<[any, any]>([null, null]);

  // Batch 3+4 features
  const [liveReps, setLiveReps] = useState<any[]>([]);
  const [showLiveReps, setShowLiveReps] = useState(true);
  const [routePoints, setRoutePoints] = useState<[number, number][]>([]);
  const [routeRepId, setRouteRepId] = useState<string | null>(null);
  const [geoAlerts, setGeoAlerts] = useState<Array<{ id: string; type: string; repName: string; message: string; ts: number }>>([]);
  const [showAssignPanel, setShowAssignPanel] = useState(false);
  const [assignRecommendations, setAssignRecommendations] = useState<any[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);

  // AI Suggestions handler
  const handleAISuggestions = useCallback(async () => {
    if (showAIPanel) { setShowAIPanel(false); return; }
    setSelectedHouse(null);
    setSelectedTerritory(null);
    setAiLoading(true);
    setShowAIPanel(true);
    try {
      const data = await getAITerritoryRecommendations();
      setAiRecommendations(data);
    } catch (err: any) {
      toast.error('Failed to load AI recommendations');
    }
    setAiLoading(false);
  }, [showAIPanel]);

  // Load pins
  const loadPins = useCallback(async () => {
    try {
      const data = await fetchFieldPins(
        bounds ? {
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        } : undefined
      );
      setPins(data);
    } catch { /* silent on map move */ }
  }, [bounds]);

  // Load territories
  const loadTerritories = useCallback(async () => {
    try {
      const data = await fetchFieldTerritories();
      setTerritories(data);
    } catch { /* silent */ }
  }, []);

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      const data = await fetchFieldStats();
      const s = (data as any).totals || data;
      setStats({
        knocks: s.knocks || 0,
        leads: s.leads || 0,
        sales: s.sales || 0,
        conversion: s.knocks > 0 ? Math.round((s.leads / s.knocks) * 100) : 0,
      });
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    loadTerritories(); loadStats(); setLoading(false);
    import('../lib/fieldSalesApi').then(({ listReps }) => listReps().then(setReps).catch(() => {}));
    supabase.auth.getUser().then(({ data }) => { if (data.user) setCurrentUserId(data.user.id); });
  }, []);
  // Debounced pin loading — avoids excessive API calls on pan/zoom
  useEffect(() => {
    if (!bounds) return;
    const timer = setTimeout(() => { loadPins(); }, 300);
    return () => clearTimeout(timer);
  }, [bounds]);

  // Clear stale pin cache on mount — prevents deleted pins from reappearing
  useEffect(() => {
    try { localStorage.removeItem('lume:field-pins'); } catch {}
  }, []);

  // Live reps — fetch + realtime subscription
  useEffect(() => {
    if (!showLiveReps) { setLiveReps([]); return; }
    // Initial fetch
    import('../lib/trackingApi').then(({ getActiveLiveLocations }) =>
      getActiveLiveLocations().then(setLiveReps).catch(() => {})
    );
    // Realtime subscription
    const channel = supabase.channel('field-live-reps')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tracking_live_locations' }, () => {
        import('../lib/trackingApi').then(({ getActiveLiveLocations }) =>
          getActiveLiveLocations().then(setLiveReps).catch(() => {})
        );
      })
      .subscribe();
    // Poll every 30s as fallback
    const poll = setInterval(() => {
      import('../lib/trackingApi').then(({ getActiveLiveLocations }) =>
        getActiveLiveLocations().then(setLiveReps).catch(() => {})
      );
    }, 30000);
    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, [showLiveReps]);

  // Geo alerts — check for idle reps & out-of-territory
  useEffect(() => {
    if (liveReps.length === 0 || territories.length === 0) return;
    const newAlerts: typeof geoAlerts = [];
    for (const rep of liveReps) {
      // Idle alert (tracking_status === 'idle')
      if (rep.tracking_status === 'idle') {
        newAlerts.push({
          id: `idle-${rep.user_id}`, type: 'idle',
          repName: rep.user_name || rep.user_id,
          message: fr ? `${rep.user_name || 'Rep'} inactif depuis 5+ min` : `${rep.user_name || 'Rep'} idle for 5+ min`,
          ts: Date.now(),
        });
      }
      // Out of territory check — is rep inside any assigned territory?
      if (rep.latitude && rep.longitude) {
        const repPoint = L.latLng(rep.latitude, rep.longitude);
        let insideAny = false;
        for (const ter of territories) {
          try {
            const geo = (ter as any).polygon_geojson || (ter as any).geojson;
            const coords = geo?.coordinates?.[0];
            if (!coords) continue;
            const polygon = L.polygon(coords.map((c: number[]) => [c[1], c[0]] as L.LatLngTuple));
            if (polygon.getBounds().contains(repPoint)) { insideAny = true; break; }
          } catch {}
        }
        if (!insideAny) {
          newAlerts.push({
            id: `oob-${rep.user_id}`, type: 'out_of_territory',
            repName: rep.user_name || rep.user_id,
            message: fr ? `${rep.user_name || 'Rep'} hors territoire` : `${rep.user_name || 'Rep'} outside territory`,
            ts: Date.now(),
          });
        }
      }
    }
    setGeoAlerts(newAlerts);
  }, [liveReps, territories, fr]);

  // Load route for selected rep
  const loadRepRoute = useCallback(async (userId: string) => {
    setRouteRepId(userId);
    try {
      const { getEmployeeRouteForDay } = await import('../lib/trackingApi');
      const today = new Date().toISOString().slice(0, 10);
      const points = await getEmployeeRouteForDay(userId, today);
      setRoutePoints(points.map(p => [p.latitude, p.longitude] as [number, number]));
    } catch { setRoutePoints([]); }
  }, []);

  // AI Smart Analysis — analyze pins locally + call AI if available
  const runAutoAssign = useCallback(async () => {
    setAssignLoading(true);
    try {
      // Local analysis first — analyze what's on the map
      const recs: any[] = [];

      // 1. Find zones with unknocked pins
      for (const ter of territories) {
        const geo = (ter as any).polygon_geojson || (ter as any).geojson;
        const coords = geo?.coordinates?.[0];
        if (!coords) continue;

        const [minLng, minLat] = coords[0];
        const [maxLng, maxLat] = coords[2];
        const pinsInZone = pins.filter(p => p.lat >= minLat && p.lat <= maxLat && p.lng >= minLng && p.lng <= maxLng);
        const unvisited = pinsInZone.filter(p => ['unknown', 'revisit'].includes(p.status));
        const leads = pinsInZone.filter(p => p.status === 'lead');
        const callbacks = pinsInZone.filter(p => p.status === 'callback');
        const noAnswer = pinsInZone.filter(p => p.status === 'no_answer');

        if (unvisited.length > 0) {
          recs.push({
            type: 'unknocked', territory_name: ter.name, territory_id: ter.id, priority: unvisited.length,
            message: fr ? `${unvisited.length} maisons pas encore visitées` : `${unvisited.length} houses not yet visited`,
            action: fr ? `Aller knocker dans ${ter.name}` : `Go knock in ${ter.name}`,
            color: '#ef4444',
          });
        }
        if (callbacks.length > 0) {
          recs.push({
            type: 'callbacks', territory_name: ter.name, territory_id: ter.id, priority: callbacks.length * 2,
            message: fr ? `${callbacks.length} callbacks en attente` : `${callbacks.length} pending callbacks`,
            action: fr ? `Rappeler les prospects de ${ter.name}` : `Follow up callbacks in ${ter.name}`,
            color: '#f59e0b',
          });
        }
        if (noAnswer.length >= 3) {
          recs.push({
            type: 'retry', territory_name: ter.name, territory_id: ter.id, priority: noAnswer.length,
            message: fr ? `${noAnswer.length} "pas de réponse" — essayer un autre moment` : `${noAnswer.length} "no answer" — try different time`,
            action: fr ? `Revisiter ${ter.name} (matin/soir)` : `Revisit ${ter.name} (morning/evening)`,
            color: '#3b82f6',
          });
        }
        if (leads.length > 0) {
          recs.push({
            type: 'hot_leads', territory_name: ter.name, territory_id: ter.id, priority: leads.length * 3,
            message: fr ? `${leads.length} leads chauds à closer!` : `${leads.length} hot leads to close!`,
            action: fr ? `Closer les leads de ${ter.name}` : `Close leads in ${ter.name}`,
            color: '#22c55e',
          });
        }
      }

      // 2. Find orphan pins (outside all territories)
      const orphans = pins.filter(p => {
        for (const ter of territories) {
          const geo = (ter as any).polygon_geojson || (ter as any).geojson;
          const coords = geo?.coordinates?.[0];
          if (!coords) continue;
          const [minLng, minLat] = coords[0];
          const [maxLng, maxLat] = coords[2];
          if (p.lat >= minLat && p.lat <= maxLat && p.lng >= minLng && p.lng <= maxLng) return false;
        }
        return true;
      });
      if (orphans.length > 0) {
        recs.push({
          type: 'orphans', territory_name: fr ? 'Hors zone' : 'Outside zones', territory_id: null, priority: orphans.length,
          message: fr ? `${orphans.length} pins hors des territoires` : `${orphans.length} pins outside any territory`,
          action: fr ? 'Créer un nouveau territoire ou réassigner' : 'Create a new territory or reassign',
          color: '#9ca3af',
        });
      }

      // Sort by priority (highest first)
      recs.sort((a, b) => b.priority - a.priority);

      // Also try the backend AI if available
      try {
        const { getAITerritoryAssignments } = await import('../lib/fieldSalesApi');
        const aiResult = await getAITerritoryAssignments();
        if (aiResult.recommendations?.length) {
          recs.push(...aiResult.recommendations.map((r: any) => ({
            type: 'ai_assign', territory_name: r.territory_name || r.territory_id, territory_id: r.territory_id,
            priority: r.score || 50, message: r.reason || 'AI recommendation',
            action: fr ? `Assigner ${r.rep_name || 'rep'} à ${r.territory_name || 'territoire'}` : `Assign ${r.rep_name || 'rep'} to ${r.territory_name || 'territory'}`,
            color: '#64748b', rep_name: r.rep_name, user_id: r.user_id,
          })));
        }
      } catch { /* AI not available — local analysis only */ }

      setAssignRecommendations(recs);
      setShowAssignPanel(true);
      if (recs.length === 0) toast.info(fr ? 'Tout est bien couvert!' : 'Everything looks well covered!');
    } catch (err: any) {
      toast.error(err?.message || 'Analysis failed');
    }
    setAssignLoading(false);
  }, [pins, territories, fr]);

  // Export PDF report
  const exportReport = useCallback(async () => {
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF();
      doc.setFontSize(18);
      doc.text('Field Sales Report', 14, 22);
      doc.setFontSize(10);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 30);

      // Stats summary
      doc.setFontSize(12);
      doc.text('Summary', 14, 42);
      doc.setFontSize(10);
      doc.text(`Knocks: ${stats.knocks}`, 14, 50);
      doc.text(`Leads: ${stats.leads}`, 14, 56);
      doc.text(`Sales: ${stats.sales}`, 14, 62);
      doc.text(`Conversion Rate: ${stats.conversion}%`, 14, 68);
      doc.text(`Total Pins: ${pins.length}`, 14, 74);

      // Territory breakdown
      if (territories.length > 0) {
        doc.setFontSize(12);
        doc.text('Territories', 14, 88);
        doc.setFontSize(10);
        territories.forEach((t, i) => {
          const y = 96 + i * 6;
          if (y > 270) return;
          const pinsInTer = pins.filter(p => p.territory_id === t.id).length;
          doc.text(`${t.name}: ${pinsInTer} pins`, 14, y);
        });
      }

      // Pin status breakdown
      const statusBreakdown: Record<string, number> = {};
      pins.forEach(p => { statusBreakdown[p.status] = (statusBreakdown[p.status] || 0) + 1; });
      let yPos = 96 + territories.length * 6 + 14;
      if (yPos > 250) { doc.addPage(); yPos = 22; }
      doc.setFontSize(12);
      doc.text('Pin Status Breakdown', 14, yPos);
      doc.setFontSize(10);
      Object.entries(statusBreakdown).forEach(([status, count], i) => {
        doc.text(`${status}: ${count}`, 14, yPos + 8 + i * 6);
      });

      doc.save('field-sales-report.pdf');
      toast.success(fr ? 'Rapport exporté' : 'Report exported');
    } catch (err: any) {
      toast.error(err?.message || 'Export failed');
    }
  }, [stats, pins, territories, fr]);

  // Select house — close other panels to prevent overlap
  const handlePinClick = useCallback(async (houseId: string) => {
    try {
      const detail = await fetchFieldHouseDetail(houseId);
      setSelectedTerritory(null);
      setSelectedHouse(detail);
    } catch (err: any) {
      toast.error('Failed to load house details');
    }
  }, []);

  // Refresh house after event
  const refreshHouse = useCallback(async () => {
    if (!selectedHouse) return;
    try {
      const detail = await fetchFieldHouseDetail(selectedHouse.id);
      setSelectedHouse(detail);
      loadPins();
      loadStats();
    } catch { /* silent */ }
  }, [selectedHouse, loadPins, loadStats]);

  // Handle map click based on mode
  const handleMapClick = useCallback((latlng: L.LatLng) => {
    if (mode === 'territory') {
      setTerritoryPoints((prev) => [...prev, latlng]);
    } else if (mode === 'pin' && !pendingPinLatlng && !selectedHouse) {
      // Only open pin creation modal in explicit 'pin' mode — never in 'view' mode
      setPendingPinLatlng(latlng);
    } else if (mode === 'view') {
      // In view mode, clicking empty map area closes any open panels
      setSelectedHouse(null);
      setSelectedTerritory(null);
    }
  }, [mode, pendingPinLatlng, selectedHouse]);

  // Save territory polygon — opens setup panel
  const saveTerritory = useCallback(() => {
    if (territoryPoints.length < 3) { toast.error('Need at least 3 points'); return; }
    const coords = territoryPoints.map((p) => [p.lng, p.lat]);
    coords.push(coords[0]); // close polygon
    setPendingTerritoryCoords(coords);
    setShowTerritorySetup(true);
    setMode('view');
  }, [territoryPoints]);

  // Final save after setup panel
  const handleTerritorySave = useCallback(async (data: { name: string; color: string; assigned_rep_id: string | null; is_exclusive: boolean; notes: string }) => {
    try {
      await createFieldTerritory({
        name: data.name,
        color: data.color,
        geojson: { type: 'Polygon', coordinates: [pendingTerritoryCoords] },
      });
      // Update with rep assignment + settings via PUT
      toast.success('Territory created');
      setShowTerritorySetup(false);
      setTerritoryPoints([]);
      setPendingTerritoryCoords([]);
      loadTerritories();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create territory');
    }
  }, [pendingTerritoryCoords, loadTerritories]);

  // Delete territory
  const handleDeleteTerritory = useCallback(async (id: string) => {
    try {
      const { deleteTerritory } = await import('../lib/fieldSalesApi');
      await deleteTerritory(id);
      toast.success('Territory deleted');
      setSelectedTerritory(null);
      loadTerritories();
    } catch (err: any) { toast.error(err?.message || 'Failed'); }
  }, [loadTerritories]);

  // Update territory
  const handleUpdateTerritory = useCallback(async (id: string, data: any) => {
    try {
      const { updateTerritory } = await import('../lib/fieldSalesApi');
      await updateTerritory(id, { name: data.name, color: data.color });
      toast.success('Territory updated');
      setSelectedTerritory(null);
      loadTerritories();
    } catch (err: any) { toast.error(err?.message || 'Failed'); }
  }, [loadTerritories]);

  // Filter pins
  const filteredPins = useMemo(() => {
    let result = pins;
    if (statusFilter !== 'all') result = result.filter((p) => p.status === statusFilter);
    if (repFilter !== 'all') result = result.filter((p) => p.assigned_user_id === repFilter);
    if (myPinsOnly && currentUserId) result = result.filter((p) => p.assigned_user_id === currentUserId);
    return result;
  }, [pins, statusFilter, repFilter, myPinsOnly, currentUserId]);

  // Heatmap data points [lat, lng, intensity]
  const heatmapPoints = useMemo<[number, number, number][]>(() => {
    if (!showHeatmap) return [];
    return filteredPins.map((p) => [p.lat, p.lng, 0.6]);
  }, [filteredPins, showHeatmap]);

  // Find nearest unvisited pin
  const goToNearestPin = useCallback(() => {
    if (!userLocation) {
      toast.error(fr ? 'Position GPS non disponible' : 'GPS location not available');
      return;
    }
    const unvisited = filteredPins.filter((p) => !['sale', 'not_interested', 'do_not_knock'].includes(p.status));
    if (unvisited.length === 0) { toast.info(fr ? 'Aucun pin à visiter' : 'No pins to visit'); return; }
    let nearest = unvisited[0];
    let minDist = Infinity;
    for (const p of unvisited) {
      const d = Math.hypot(p.lat - userLocation[0], p.lng - userLocation[1]);
      if (d < minDist) { minDist = d; nearest = p; }
    }
    setFlyTarget({ lat: nearest.lat, lng: nearest.lng });
    handlePinClick(nearest.house_id);
  }, [userLocation, filteredPins, fr, handlePinClick]);

  return (
    <>
    <div ref={containerRef} className="fixed bottom-0 right-0" style={{ top: headerH || 48, left: sidebarW || 0, zIndex: 10 }}>
      {/* MAP (fills entire viewport below navbar) */}
      <div className="absolute inset-0 overflow-hidden">
        <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} className={cn('h-full w-full field-map', isDark ? 'field-map-dark' : 'field-map-light')} zoomControl={false}
          style={{ background: isDark ? '#0a0a0a' : '#f0f0f0' }}>
          <TileLayer url={TILE_SAT} attribution={TILE_ATTR} maxZoom={19} />
          <TileLayer url={TILE_SAT_LABELS} attribution="" maxZoom={19} />
          <MapBoundsTracker onBoundsChange={setBounds} />
          <MapClickHandler mode={mode} onMapClick={handleMapClick} />
          {flyTarget && <FlyTo lat={flyTarget.lat} lng={flyTarget.lng} />}
          {userLocation && showUserLocation && <UserLocationMarker position={userLocation} />}
          {userLocation && <CenterOnUser position={userLocation} />}
          {showHeatmap && <HeatmapLayer points={heatmapPoints} />}

          {/* Live rep markers */}
          {showLiveReps && liveReps.map((rep) => (
            <Marker key={`rep-${rep.user_id}`} position={[rep.latitude, rep.longitude]}
              icon={L.divIcon({
                html: `<div style="width:32px;height:32px;border-radius:50%;background:${rep.team_color || '#3b82f6'};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white">${(rep.user_name || '?')[0]}</div>${rep.tracking_status === 'idle' ? '<div style="position:absolute;top:-4px;right:-4px;width:10px;height:10px;border-radius:50%;background:#f59e0b;border:2px solid white"></div>' : '<div style="position:absolute;top:-4px;right:-4px;width:10px;height:10px;border-radius:50%;background:#22c55e;border:2px solid white;animation:pulse 2s infinite"></div>'}`,
                className: 'live-rep-marker', iconSize: [32, 32], iconAnchor: [16, 16],
              })}
              eventHandlers={{ click: () => loadRepRoute(rep.user_id) }}>
              <Tooltip direction="top" offset={[0, -20]} opacity={0.95}>
                <div style={{ fontSize: 11 }}>
                  <div style={{ fontWeight: 700 }}>{rep.user_name || 'Unknown'}</div>
                  <div style={{ fontSize: 9, color: '#9ca3af' }}>{rep.team_name || ''} · {rep.tracking_status}</div>
                  {rep.speed_mps != null && <div style={{ fontSize: 9, color: '#9ca3af' }}>{(rep.speed_mps * 3.6).toFixed(0)} km/h</div>}
                </div>
              </Tooltip>
            </Marker>
          ))}

          {/* Rep route history polyline */}
          {routePoints.length > 1 && (
            <Polyline positions={routePoints} pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.7, dashArray: '8 4' }} />
          )}
          {mode === 'territory' && territoryPoints.length > 0 && <TerritoryDrawingOverlay points={territoryPoints} />}

          {/* Territory polygons */}
          {showTerritories && territories.map((ter) => {
            try {
              const geo = (ter as any).polygon_geojson || (ter as any).geojson;
              const coords = geo?.coordinates?.[0];
              if (!coords) return null;
              const positions = coords.map((c: number[]) => [c[1], c[0]] as L.LatLngTuple);
              const isSel = selectedTerritory?.id === ter.id;
              return (
                <Polygon key={ter.id} positions={positions}
                  pathOptions={{ color: ter.color || '#6366f1', weight: isSel ? 3 : 2, fillOpacity: isSel ? 0.15 : 0.08, opacity: isSel ? 0.8 : 0.5 }}
                  eventHandlers={{ click: () => {
                    setSelectedHouse(null);
                    setSelectedTerritory(ter);
                    // Load territory stats
                    fetchFieldStats({ territory_id: ter.id }).then(s => setTerritoryStats({ id: ter.id, name: ter.name, ...s })).catch(() => {});
                  } }} />
              );
            } catch { return null; }
          })}

          {/* House pins */}
          <MarkerClusterGroup chunkedLoading maxClusterRadius={50}
            iconCreateFunction={(cluster: any) => {
              const count = cluster.getChildCount();
              return L.divIcon({
                html: `<div style="width:36px;height:36px;border-radius:50%;background:${isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)'};color:${isDark ? '#000' : '#fff'};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.3)">${count}</div>`,
                className: 'field-cluster',
                iconSize: L.point(36, 36),
              });
            }}>
            {filteredPins.map((pin) => (
              <Marker key={pin.id} position={[pin.lat, pin.lng]}
                icon={createPinIcon(pin.status, pin.has_note, isDark)}
                eventHandlers={{ click: () => handlePinClick(pin.house_id) }}>
                {(pin.note_preview || pin.customer_name) && (
                  <Tooltip direction="top" offset={[0, -20]} opacity={0.95} className="field-pin-tooltip">
                    <div style={{ maxWidth: 200, fontSize: 11 }}>
                      {pin.customer_name && <div style={{ fontWeight: 600, marginBottom: 2 }}>{pin.customer_name}</div>}
                      {pin.note_preview && <div style={{ color: '#9ca3af', fontSize: 10 }}>{pin.note_preview.length > 80 ? pin.note_preview.slice(0, 80) + '...' : pin.note_preview}</div>}
                    </div>
                  </Tooltip>
                )}
              </Marker>
            ))}
          </MarkerClusterGroup>
        </MapContainer>
      </div>

      {/* ── MAP OVERLAYS (outside overflow-hidden, above leaflet) ── */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 500 }}>

      {/* ── FLOATING TOOLBAR (top center) — 2 rows ── */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-surface/90 backdrop-blur-xl border border-outline rounded-xl px-3 py-2 shadow-xl pointer-events-auto" style={{ maxWidth: '95vw' }}>
        {/* Row 1: Title + Status Filters */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <MapPin size={14} className="text-text-primary" />
          <span className="text-[12px] font-bold text-text-primary mr-1">{fr ? 'Terrain' : 'Field Sales'}</span>
          <div className="w-px h-4 bg-outline" />
          <button onClick={() => setStatusFilter('all')}
            className={cn('px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors',
              statusFilter === 'all' ? 'bg-primary text-white' : 'text-text-tertiary hover:text-text-secondary')}>
            {fr ? 'Tous' : 'All'}
          </button>
          {['lead', 'no_answer', 'sale', 'not_interested'].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn('px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors flex items-center gap-1',
                statusFilter === s ? 'bg-primary text-white' : 'text-text-tertiary hover:text-text-secondary')}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_CONFIG[s]?.color }} />
              {STATUS_CONFIG[s]?.label}
            </button>
          ))}
          {reps.length > 0 && (
            <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}
              className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-transparent text-text-tertiary outline-none cursor-pointer border border-outline">
              <option value="all">{fr ? 'Tous les reps' : 'All Reps'}</option>
              {reps.map((r) => <option key={r.id} value={r.id}>{r.display_name}</option>)}
            </select>
          )}
        </div>

        {/* Row 2: Action Buttons with labels */}
        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
          <button onClick={() => setMode(mode === 'pin' ? 'view' : 'pin')}
            className={cn('px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors flex items-center gap-1.5',
              mode === 'pin' ? 'bg-white text-black' : 'bg-surface-secondary text-text-secondary hover:bg-surface-tertiary')}>
            <Plus size={11} /> {fr ? 'Ajouter Pin' : 'Add Pin'}
          </button>
          <button onClick={() => { if (mode === 'territory') { setMode('view'); setTerritoryPoints([]); } else { setMode('territory'); setTerritoryPoints([]); } }}
            className={cn('px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors flex items-center gap-1.5',
              mode === 'territory' ? 'bg-white text-black' : 'bg-surface-secondary text-text-secondary hover:bg-surface-tertiary')}>
            <Target size={11} /> Zone
          </button>
          <div className="w-px h-4 bg-outline mx-0.5" />
          <button onClick={() => setMyPinsOnly(!myPinsOnly)}
            className={cn('px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors flex items-center gap-1.5',
              myPinsOnly ? 'bg-primary text-white' : 'bg-surface-secondary text-text-secondary hover:bg-surface-tertiary')}>
            <User size={11} /> {fr ? 'Mes pins' : 'My Pins'}
          </button>
          <button onClick={goToNearestPin}
            className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-surface-secondary text-text-secondary hover:bg-surface-tertiary transition-colors flex items-center gap-1.5">
            <Navigation size={11} /> {fr ? 'Plus proche' : 'Nearest'}
          </button>
          <div className="w-px h-4 bg-outline mx-0.5" />
          <button onClick={() => setShowTerritories(!showTerritories)}
            className={cn('px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors flex items-center gap-1.5',
              showTerritories ? 'bg-primary/15 text-primary' : 'bg-surface-secondary text-text-secondary hover:bg-surface-tertiary')}>
            <Layers size={11} /> {fr ? 'Zones' : 'Zones'}
          </button>
          <button onClick={() => setShowHeatmap(!showHeatmap)}
            className={cn('px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors flex items-center gap-1.5',
              showHeatmap ? 'bg-red-500/15 text-red-400' : 'bg-surface-secondary text-text-secondary hover:bg-surface-tertiary')}>
            <Thermometer size={11} /> Heatmap
          </button>
          <button onClick={() => setShowLiveReps(!showLiveReps)}
            className={cn('px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors flex items-center gap-1.5',
              showLiveReps ? 'bg-green-500/15 text-green-400' : 'bg-surface-secondary text-text-secondary hover:bg-surface-tertiary')}>
            <Users size={11} /> Live
          </button>
          {userLocation && (
            <button onClick={() => setShowUserLocation(!showUserLocation)}
              className={cn('px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors flex items-center gap-1.5',
                showUserLocation ? 'bg-blue-500/15 text-blue-400' : 'bg-surface-secondary text-text-secondary hover:bg-surface-tertiary')}>
              <MapPin size={11} /> GPS
            </button>
          )}
          {routeRepId && (
            <button onClick={() => { setRoutePoints([]); setRouteRepId(null); }}
              className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-amber-500/15 text-amber-400 flex items-center gap-1.5">
              <X size={11} /> {fr ? 'Effacer route' : 'Clear Route'}
            </button>
          )}
          {territories.length >= 2 && (
            <button onClick={async () => {
              const opening = !showCompare;
              setShowCompare(opening);
              if (opening && territories.length >= 2) {
                setCompareTerritories([territories[0], territories[1]]);
                const [s0, s1] = await Promise.all([
                  fetchFieldStats({ territory_id: territories[0].id }).catch(() => null),
                  fetchFieldStats({ territory_id: territories[1].id }).catch(() => null),
                ]);
                setCompareStats([
                  s0 ? { name: territories[0].name, ...s0 } : null,
                  s1 ? { name: territories[1].name, ...s1 } : null,
                ]);
              }
            }}
              className={cn('px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors flex items-center gap-1.5',
                showCompare ? 'bg-primary text-white' : 'bg-surface-secondary text-text-secondary hover:bg-surface-tertiary')}>
              <BarChart3 size={11} /> {fr ? 'Comparer' : 'Compare'}
            </button>
          )}
          <div className="w-px h-4 bg-outline mx-0.5" />
          <button onClick={runAutoAssign} disabled={assignLoading}
            className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-surface-secondary text-text-secondary hover:bg-surface-tertiary transition-colors flex items-center gap-1.5 disabled:opacity-50">
            <Sparkles size={11} /> {fr ? 'Analyser' : 'Analyze'}
          </button>
          <button onClick={exportReport}
            className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-surface-secondary text-text-secondary hover:bg-surface-tertiary transition-colors flex items-center gap-1.5">
            <FileText size={11} /> {fr ? 'Exporter' : 'Export'}
          </button>
        </div>
      </div>

      {/* ── FLOATING STATS (bottom left) ── */}
      <div className="absolute bottom-4 left-4 flex items-center gap-3 bg-surface/85 backdrop-blur-xl border border-outline rounded-xl px-4 py-2.5 shadow-xl pointer-events-auto">
        {[
          { label: 'Knocks', value: stats.knocks, color: '#6b7280' },
          { label: 'Leads', value: stats.leads, color: '#3b82f6' },
          { label: 'Sales', value: stats.sales, color: '#22c55e' },
          { label: 'Rate', value: `${stats.conversion}%`, color: '#f59e0b' },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
            <span className="text-[10px] text-text-tertiary">{s.label}</span>
            <span className="text-[12px] font-bold text-text-primary">{s.value}</span>
          </div>
        ))}
      </div>

      {/* ── TERRITORY STATS PANEL ── */}
      {territoryStats && selectedTerritory && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className="absolute bottom-16 left-4 bg-surface/95 backdrop-blur-xl border border-outline rounded-xl px-4 py-3 shadow-2xl pointer-events-auto w-[280px]">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[12px] font-bold text-text-primary">{territoryStats.name}</h4>
            <button onClick={() => { setTerritoryStats(null); setSelectedTerritory(null); }} className="p-0.5 rounded hover:bg-surface-secondary text-text-tertiary"><X size={12} /></button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Knocks', value: territoryStats.totals?.knocks ?? 0, color: '#6b7280' },
              { label: 'Leads', value: territoryStats.totals?.leads ?? 0, color: '#3b82f6' },
              { label: 'Sales', value: territoryStats.totals?.sales ?? 0, color: '#22c55e' },
              { label: 'Callbacks', value: territoryStats.totals?.callbacks ?? 0, color: '#f59e0b' },
              { label: 'No Answer', value: territoryStats.totals?.no_answers ?? 0, color: '#9ca3af' },
              { label: 'Conversion', value: `${territoryStats.conversion_rate ?? 0}%`, color: '#64748b' },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                <span className="text-[10px] text-text-tertiary">{s.label}</span>
                <span className="text-[11px] font-bold text-text-primary ml-auto">{s.value}</span>
              </div>
            ))}
          </div>
          {(territoryStats as any).status_counts && Object.keys((territoryStats as any).status_counts).length > 0 && (
            <div className="mt-2 pt-2 border-t border-outline">
              <p className="text-[9px] text-text-tertiary uppercase tracking-wider mb-1">Pin Status Breakdown</p>
              <div className="flex gap-1 flex-wrap">
                {Object.entries((territoryStats as any).status_counts).map(([status, count]) => (
                  <span key={status} className="text-[9px] px-1.5 py-0.5 rounded-md border border-outline text-text-secondary">
                    {status}: <span className="font-bold">{count as number}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* ── COMPARE TERRITORIES PANEL ── */}
      {showCompare && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className="absolute top-16 left-1/2 -translate-x-1/2 bg-surface/95 backdrop-blur-xl border border-outline rounded-xl px-4 py-3 shadow-2xl pointer-events-auto w-[520px] max-w-[90vw]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[12px] font-bold text-text-primary">{fr ? 'Comparaison de territoires' : 'Compare Territories'}</h4>
            <button onClick={() => setShowCompare(false)} className="p-0.5 rounded hover:bg-surface-secondary text-text-tertiary"><X size={12} /></button>
          </div>
          <div className="flex gap-3 mb-3">
            {[0, 1].map((idx) => (
              <select key={idx} value={compareTerritories[idx]?.id || ''}
                onChange={(e) => {
                  const t = territories.find(tr => tr.id === e.target.value) || null;
                  setCompareTerritories(prev => { const next = [...prev] as [FieldTerritory | null, FieldTerritory | null]; next[idx] = t; return next; });
                  if (t) fetchFieldStats({ territory_id: t.id }).then(s => setCompareStats(prev => { const next = [...prev] as [any, any]; next[idx] = { name: t.name, ...s }; return next; })).catch(() => {});
                }}
                className="flex-1 px-2 py-1.5 rounded-lg text-[11px] bg-surface-secondary border border-outline text-text-primary outline-none">
                <option value="">{fr ? 'Choisir...' : 'Select...'}</option>
                {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ))}
          </div>
          {compareStats[0] && compareStats[1] && (
            <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 gap-y-1 text-[11px]">
              <div className="text-right font-bold text-text-primary">{compareStats[0].name}</div>
              <div className="text-center text-text-tertiary text-[9px]">vs</div>
              <div className="font-bold text-text-primary">{compareStats[1].name}</div>
              {['knocks', 'leads', 'sales', 'callbacks', 'no_answers'].map((key) => {
                const v0 = compareStats[0].totals?.[key] ?? 0;
                const v1 = compareStats[1].totals?.[key] ?? 0;
                const better = v0 > v1 ? 0 : v1 > v0 ? 1 : -1;
                return (
                  <React.Fragment key={key}>
                    <div className={cn('text-right', better === 0 ? 'text-green-400 font-bold' : 'text-text-secondary')}>{v0}</div>
                    <div className="text-center text-text-tertiary capitalize text-[9px]">{key.replace('_', ' ')}</div>
                    <div className={cn(better === 1 ? 'text-green-400 font-bold' : 'text-text-secondary')}>{v1}</div>
                  </React.Fragment>
                );
              })}
              <div className={cn('text-right', (compareStats[0].conversion_rate ?? 0) >= (compareStats[1].conversion_rate ?? 0) ? 'text-green-400 font-bold' : 'text-text-secondary')}>{compareStats[0].conversion_rate ?? 0}%</div>
              <div className="text-center text-text-tertiary text-[9px]">conversion</div>
              <div className={cn((compareStats[1].conversion_rate ?? 0) >= (compareStats[0].conversion_rate ?? 0) ? 'text-green-400 font-bold' : 'text-text-secondary')}>{compareStats[1].conversion_rate ?? 0}%</div>
            </div>
          )}
        </motion.div>
      )}

      {/* ── GEO ALERTS ── */}
      {geoAlerts.length > 0 && (
        <div className="absolute top-16 right-4 bg-surface/95 backdrop-blur-xl border border-outline rounded-xl shadow-2xl pointer-events-auto w-[260px] max-h-[200px] overflow-y-auto">
          <div className="px-3 py-2 border-b border-outline flex items-center justify-between">
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1"><AlertCircle size={11} /> Alerts ({geoAlerts.length})</span>
            <button onClick={() => setGeoAlerts([])} className="text-text-tertiary hover:text-text-secondary"><X size={11} /></button>
          </div>
          {geoAlerts.map((a) => (
            <div key={a.id} className={cn('px-3 py-2 border-b border-outline/50 text-[10px]', a.type === 'idle' ? 'text-amber-400' : 'text-red-400')}>
              <span className="font-semibold">{a.repName}</span>
              <span className="text-text-tertiary ml-1">— {a.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── AI SMART ANALYSIS PANEL ── */}
      {showAssignPanel && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="absolute top-20 left-1/2 -translate-x-1/2 bg-surface/95 backdrop-blur-xl border border-outline rounded-xl shadow-2xl pointer-events-auto w-[420px] max-w-[90vw] max-h-[55vh] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-outline">
            <h4 className="text-[12px] font-bold text-text-primary flex items-center gap-1.5"><Sparkles size={13} className="text-amber-400" /> {fr ? 'Analyse AI du terrain' : 'AI Field Analysis'}</h4>
            <button onClick={() => setShowAssignPanel(false)} className="p-0.5 rounded hover:bg-surface-secondary text-text-tertiary"><X size={12} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {assignRecommendations.length === 0 ? (
              <div className="text-center py-6">
                <CheckCircle2 size={24} className="mx-auto text-green-400 mb-2" />
                <p className="text-[12px] font-semibold text-text-primary">{fr ? 'Tout est bien couvert!' : 'Everything looks good!'}</p>
                <p className="text-[10px] text-text-tertiary mt-1">{fr ? 'Aucune action recommandée' : 'No recommended actions'}</p>
              </div>
            ) : (
              assignRecommendations.map((rec: any, i: number) => (
                <div key={i} className="p-3 rounded-xl border border-outline bg-surface-secondary/50 hover:bg-surface-secondary transition-colors">
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${rec.color}20` }}>
                      {rec.type === 'hot_leads' ? <TrendingUp size={14} style={{ color: rec.color }} /> :
                       rec.type === 'callbacks' ? <PhoneIcon size={14} style={{ color: rec.color }} /> :
                       rec.type === 'unknocked' ? <MapPin size={14} style={{ color: rec.color }} /> :
                       rec.type === 'orphans' ? <AlertCircle size={14} style={{ color: rec.color }} /> :
                       <Target size={14} style={{ color: rec.color }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-text-primary">{rec.territory_name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: `${rec.color}20`, color: rec.color }}>{rec.priority}</span>
                      </div>
                      <p className="text-[10px] text-text-tertiary mt-0.5">{rec.message}</p>
                      <p className="text-[10px] font-semibold mt-1" style={{ color: rec.color }}>{rec.action}</p>
                    </div>
                  </div>
                  {rec.territory_id && (
                    <button onClick={() => {
                      // Fly to territory
                      const ter = territories.find(t => t.id === rec.territory_id);
                      if (ter) {
                        const geo = (ter as any).polygon_geojson || (ter as any).geojson;
                        const coords = geo?.coordinates?.[0];
                        if (coords) {
                          const avgLat = coords.reduce((s: number, c: number[]) => s + c[1], 0) / coords.length;
                          const avgLng = coords.reduce((s: number, c: number[]) => s + c[0], 0) / coords.length;
                          setFlyTarget({ lat: avgLat, lng: avgLng });
                        }
                        setSelectedHouse(null);
                        setSelectedTerritory(ter);
                        fetchFieldStats({ territory_id: ter.id }).then(s => setTerritoryStats({ id: ter.id, name: ter.name, ...s })).catch(() => {});
                      }
                      setShowAssignPanel(false);
                    }} className="mt-2 w-full py-1.5 rounded-lg text-[10px] font-semibold transition-colors flex items-center justify-center gap-1.5"
                      style={{ background: `${rec.color}15`, color: rec.color }}>
                      <Navigation size={10} /> {fr ? 'Voir sur la carte' : 'View on map'}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </motion.div>
      )}

      {/* ── LEGEND (bottom right) ── */}
      <div className="absolute bottom-4 right-4 bg-surface/85 backdrop-blur-xl border border-outline rounded-xl p-2.5 shadow-xl pointer-events-auto">
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          {Object.entries(STATUS_CONFIG).filter(([k]) => k !== 'unknown').map(([key, cfg]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.color }} />
              <span className="text-[9px] text-text-tertiary">{cfg.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── FLOATING "+" FAB — real CRM create flows ── */}
      <div className="absolute bottom-20 right-4 pointer-events-auto">
        <AnimatePresence>
          {showCreateMenu && (
            <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="mb-2 bg-surface/95 backdrop-blur-xl border border-outline rounded-xl shadow-2xl overflow-hidden w-[190px]">
              {[
                { key: 'job', label: fr ? 'Créer Job' : 'Create Job', icon: Briefcase, color: '#22c55e',
                  action: () => { openJobModal({ initialValues: {}, onCreated: () => { loadPins(); loadStats(); } }); } },
                { key: 'quote', label: fr ? 'Créer Devis' : 'Create Quote', icon: FileText, color: '#64748b',
                  action: () => { setShowQuoteModal(true); } },
                { key: 'client', label: fr ? 'Créer Client' : 'Create Client', icon: UserPlus, color: '#3b82f6',
                  action: () => { navigate('/clients'); setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-new-client')), 300); } },
                { key: 'invoice', label: fr ? 'Créer Facture' : 'Create Invoice', icon: Receipt, color: '#f59e0b',
                  action: () => { setShowInvoiceModal(true); } },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.key} onClick={() => { setShowCreateMenu(false); item.action(); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] font-medium text-text-primary hover:bg-surface-secondary transition-colors">
                    <Icon size={14} style={{ color: item.color }} />
                    {item.label}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
        <button onClick={() => { setShowCreateMenu(!showCreateMenu); if (mode !== 'view') { setMode('view'); setTerritoryPoints([]); } }}
          className={cn('w-12 h-12 rounded-full shadow-xl flex items-center justify-center transition-all',
            showCreateMenu ? 'bg-red-500 rotate-45' : 'bg-white hover:bg-white/90')}>
          <Plus size={22} className={showCreateMenu ? 'text-white' : 'text-black'} />
        </button>
      </div>

      {/* ── AI Suggestions Button ── */}
      <button onClick={handleAISuggestions}
        className="absolute top-3 right-4 flex items-center gap-1.5 bg-surface/85 backdrop-blur-xl border border-outline rounded-xl px-3 py-2 shadow-xl text-xs font-medium text-text-primary hover:bg-surface transition-colors pointer-events-auto">
        <Sparkles size={13} className="text-amber-400" />
        {fr ? 'IA Suggestions' : 'AI Suggestions'}
      </button>

      {/* Mode indicator bar */}
      <AnimatePresence>
        {mode !== 'view' && (
          <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }}
            style={{ pointerEvents: 'auto' }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[600] bg-surface/95 backdrop-blur-md border border-outline rounded-xl px-5 py-3 shadow-2xl flex items-center gap-3">
            <div className={cn('w-2 h-2 rounded-full animate-pulse', mode === 'pin' ? 'bg-blue-400' : 'bg-indigo-400')} />
            <span className="text-[12px] font-semibold text-text-primary">
              {mode === 'pin' ? 'Click on the map to place a pin' : `Drawing territory — ${territoryPoints.length} point${territoryPoints.length !== 1 ? 's' : ''}`}
            </span>
            {mode === 'territory' && territoryPoints.length >= 3 && (
              <button onClick={saveTerritory} className="px-3 py-1 rounded-lg bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors">
                Save Territory
              </button>
            )}
            {mode === 'territory' && territoryPoints.length > 0 && (
              <button onClick={() => setTerritoryPoints((p) => p.slice(0, -1))} className="px-3 py-1 rounded-lg border border-outline text-text-tertiary text-[11px] font-medium hover:text-text-secondary">
                Undo
              </button>
            )}
            <button onClick={() => { setMode('view'); setTerritoryPoints([]); setPendingPinLatlng(null); }}
              className="px-3 py-1 rounded-lg border border-outline text-text-tertiary text-[11px] font-medium hover:text-text-secondary">
              Exit
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      </div>{/* end overlay container */}

      {/* Leaflet CSS — satellite with dark/light color grading */}
      <style>{`
        .field-pin { background: none !important; border: none !important; }
        .leaflet-control-attribution { display: none !important; }
        .leaflet-control-zoom { border: none !important; }
        .leaflet-control-zoom a { background: ${isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.9)'} !important; color: ${isDark ? '#e5e7eb' : '#333'} !important; border: 1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'} !important; backdrop-filter: blur(8px); }

        /* Satellite — full color, no filters */
        .field-map-dark .leaflet-tile-pane {
          filter: brightness(0.95) contrast(1.05);
        }
        .field-map-light .leaflet-tile-pane {
          filter: brightness(1.05) contrast(1);
        }

        @keyframes pulse { 0%, 100% { opacity: 0.4; transform: scale(1); } 50% { opacity: 0.1; transform: scale(1.3); } }
        @keyframes userPulse { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(3); opacity: 0; } }
        .user-location-pin { background: none !important; border: none !important; }
        .field-cluster { background: none !important; border: none !important; }
        .marker-cluster-small, .marker-cluster-medium, .marker-cluster-large { background: none !important; }
      `}</style>

    </div>
    {/* ── Fixed panels & modals (outside map container, free stacking context) ── */}

    {/* AI Recommendations Panel */}
    <AnimatePresence>
      {showAIPanel && aiRecommendations && (
        <motion.div initial={{ x: 420, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 420, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed right-0 top-0 bottom-0 w-[380px] bg-surface border-l border-outline z-[1000] flex flex-col shadow-2xl">
          <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-amber-400" />
              <h2 className="text-[15px] font-bold text-text-primary">{fr ? 'Recommandations IA' : 'AI Recommendations'}</h2>
            </div>
            <button onClick={() => setShowAIPanel(false)} className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-tertiary"><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            <div>
              <h3 className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider mb-3">{fr ? 'Meilleurs Territoires' : 'Top Territories'}</h3>
              {aiRecommendations.territories.map((t, i) => (
                <div key={t.id} className="p-3 bg-surface-secondary rounded-xl border border-outline mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] font-semibold text-text-primary">{i + 1}. {t.name}</span>
                    <span className="text-[12px] font-bold" style={{ color: t.score > 70 ? '#22c55e' : t.score > 40 ? '#f59e0b' : '#ef4444' }}>{t.score}/100</span>
                  </div>
                  <p className="text-[11px] text-text-tertiary">{t.explanation}</p>
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-text-tertiary">
                    <span>{t.total_pins} pins</span>
                    <span>{t.active_leads} leads</span>
                    <span>{t.close_rate}% close</span>
                    {t.fatigue_score > 50 && <span className="text-amber-400">Fatigued</span>}
                  </div>
                </div>
              ))}
            </div>
            <div>
              <h3 className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider mb-3">{fr ? 'Meilleurs Pins' : 'Top Pins to Reknock'}</h3>
              {aiRecommendations.pins.map((p, i) => (
                <button key={p.id} onClick={() => { setFlyTarget({ lat: p.lat, lng: p.lng }); setShowAIPanel(false); }}
                  className="w-full text-left p-3 bg-surface-secondary rounded-xl border border-outline mb-2 hover:border-primary/30 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-semibold text-text-primary">{i + 1}. {p.address?.split(',')[0]}</span>
                    <span className="text-[11px] font-bold" style={{ color: p.score > 60 ? '#22c55e' : '#f59e0b' }}>{p.score}/100</span>
                  </div>
                  <p className="text-[11px] text-text-secondary">{p.next_action}</p>
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Create Pin Modal */}
    <AnimatePresence>
      {pendingPinLatlng && (
        <CreatePinModal latlng={pendingPinLatlng}
          onClose={() => { setPendingPinLatlng(null); setMode('view'); }}
          onCreated={() => { loadPins(); loadStats(); }}
          onContinueToJob={(addr, clientId) => {
            openJobModal({
              initialValues: { property_address: addr, client_id: clientId || null },
              onCreated: () => { loadPins(); loadStats(); },
            });
          }}
          onContinueToQuote={() => { setShowQuoteModal(true); }}
        />
      )}
    </AnimatePresence>

    {/* House Drawer */}
    <AnimatePresence>
      {selectedHouse && (
        <HouseDrawer house={selectedHouse} onClose={() => setSelectedHouse(null)} onRefresh={refreshHouse}
          onDeleted={() => {
            // Optimistic: remove pin from state immediately so it disappears from the map
            const deletedId = selectedHouse?.id;
            if (deletedId) setPins(prev => prev.filter(p => p.house_id !== deletedId && p.id !== deletedId));
            setSelectedHouse(null);
            loadPins();
            loadStats();
          }}
          onOpenJob={(addr, clientId) => {
            openJobModal({
              initialValues: { property_address: addr, client_id: clientId || null },
              onCreated: () => { loadPins(); loadStats(); },
            });
          }}
          onOpenQuote={() => setShowQuoteModal(true)}
          onOpenInvoice={() => setShowInvoiceModal(true)}
          onOpenClient={() => { navigate('/clients'); setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-new-client')), 300); }}
        />
      )}
    </AnimatePresence>

    {/* Territory Detail Panel */}
    <AnimatePresence>
      {selectedTerritory && !showTerritorySetup && (
        <TerritoryDetailPanel
          territory={selectedTerritory}
          reps={reps}
          onClose={() => setSelectedTerritory(null)}
          onDelete={handleDeleteTerritory}
          onUpdate={handleUpdateTerritory}
        />
      )}
    </AnimatePresence>

    {/* Territory Setup Panel */}
    <AnimatePresence>
      {showTerritorySetup && (
        <TerritorySetupPanel
          reps={reps}
          onSave={handleTerritorySave}
          onCancel={() => { setShowTerritorySetup(false); setTerritoryPoints([]); setPendingTerritoryCoords([]); }}
        />
      )}
    </AnimatePresence>

    {/* ── Real CRM Modals (outside map container) ── */}
    {showQuoteModal && (
      <QuoteCreateModal
        isOpen={showQuoteModal}
        onClose={() => setShowQuoteModal(false)}
        createLeadInline
        onCreated={() => { setShowQuoteModal(false); loadPins(); loadStats(); toast.success('Quote created'); }}
      />
    )}
    {showInvoiceModal && (
      <CreateInvoiceModal
        isOpen={showInvoiceModal}
        onClose={() => setShowInvoiceModal(false)}
        onCreated={() => { setShowInvoiceModal(false); loadPins(); loadStats(); toast.success('Invoice created'); }}
      />
    )}
    </>
  );
}
