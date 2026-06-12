import { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  type LeadPinData,
  type PinStatus,
  PIN_STATUS_CONFIG,
  createLeadPinElement,
  createLeadPinPopupHTML,
} from './lead-pin';
import { type ZoneData, getZoneColor } from './zone-types';
import { getRepAvatar } from '../../lib/constants/avatars';
import { useTranslation } from '../../i18n';

// LocalStorage caching removed — was causing ghost pins (deleted pins reappearing).
// Pins and zones are loaded fresh from the API on each page load.

// Inline type (replaces @/types/lume import)
// LumeCreateResponse removed — CRM actions via callbacks

// ---------------------------------------------------------------------------
// Simulated rep live positions (would come from real-time API)
// ---------------------------------------------------------------------------

interface RepPosition {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: string;
}

const SIMULATED_REP_POSITIONS: RepPosition[] = [];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type UserRole = 'owner' | 'admin' | 'team_manager' | 'sales_rep';
type DateFilter = 'today' | 'yesterday' | 'this_month' | 'this_year' | 'all';
type MapMode = 'view' | 'add_pin' | 'select' | 'draw_zone';

const ROLE_CAN_CREATE_ZONE: UserRole[] = ['owner', 'admin', 'team_manager'];
const ROLE_CAN_ASSIGN_ZONE: UserRole[] = ['owner', 'admin', 'team_manager'];
const ROLE_CAN_DELETE_ANY_ZONE: UserRole[] = ['owner', 'admin'];

// Simulated current user — replace with real auth context
const CURRENT_USER = {
  id: 'user-1',
  name: '',
  role: 'owner' as UserRole,
};

const SALES_REPS: { id: string; name: string }[] = [];

function canCreateZone(role: UserRole) { return ROLE_CAN_CREATE_ZONE.includes(role); }
function canAssignZone(role: UserRole) { return ROLE_CAN_ASSIGN_ZONE.includes(role); }
function canDeleteZone(role: UserRole, zone: ZoneData) {
  if (ROLE_CAN_DELETE_ANY_ZONE.includes(role)) return true;
  if (role === 'team_manager' && zone.created_by === CURRENT_USER.id) return true;
  return false;
}

function matchesDateFilter(dateStr: string, filter: DateFilter): boolean {
  if (filter === 'all') return true;
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter === 'today') return d >= today;
  if (filter === 'yesterday') {
    const yday = new Date(today); yday.setDate(yday.getDate() - 1);
    return d >= yday && d < today;
  }
  if (filter === 'this_month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (filter === 'this_year') return d.getFullYear() === now.getFullYear();
  return true;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface MapContainerProps {
  /** Called when a pin is set to closed_won — should open the Job modal */
  onPinClosedWon?: (pin: LeadPinData) => void;
  /** Called when a pin is set to appointment — should open the Quote modal */
  onPinAppointment?: (pin: LeadPinData) => void;
  /** Initial pins to render (loaded from API by parent) */
  initialPins?: LeadPinData[];
  /** Called when a new pin is created on the map */
  onPinCreated?: (pin: LeadPinData) => void;
  /** Called when a pin is deleted */
  onPinDeleted?: (pinId: string) => void;
  /** Called when a pin is edited */
  onPinUpdated?: (pin: LeadPinData) => void;
  /** Live rep positions (loaded from API by parent) */
  liveReps?: Array<{ user_id: string; user_name: string | null; latitude: number; longitude: number; tracking_status: string; speed_mps: number | null; team_name: string | null; team_color: string | null }>;
  /** Imperative link-id updates by pin id (parent pushes after creating job/quote) */
  pinLinkUpdates?: Record<string, { job_id?: string | null; quote_id?: string | null; client_id?: string | null; lead_id?: string | null }>;
}

export function MapContainer({ onPinClosedWon, onPinAppointment, initialPins, onPinCreated, onPinDeleted, onPinUpdated, liveReps: liveRepsProp, pinLinkUpdates }: MapContainerProps = {}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // Stable refs for callbacks (avoids stale closure in map click handler)
  const onPinClosedWonRef = useRef(onPinClosedWon);
  onPinClosedWonRef.current = onPinClosedWon;
  const onPinAppointmentRef = useRef(onPinAppointment);
  onPinAppointmentRef.current = onPinAppointment;
  const onPinCreatedRef = useRef(onPinCreated);
  onPinCreatedRef.current = onPinCreated;
  const onPinDeletedRef = useRef(onPinDeleted);
  onPinDeletedRef.current = onPinDeleted;
  const onPinUpdatedRef = useRef(onPinUpdated);
  onPinUpdatedRef.current = onPinUpdated;

  // Single GPS marker — useRef so cleanup always finds it
  const gpsMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const gpsWatchRef = useRef<number | null>(null);
  // Re-center on the live position + (re)start tracking — used by the "Enable" banner.
  const gpsRecenterRef = useRef<((lng: number, lat: number) => void) | null>(null);

  // Markers stored in a plain Map — never in React state
  const markersRef = useRef(new Map<string, {
    pin: LeadPinData;
    marker: mapboxgl.Marker;
    noteMarker: mapboxgl.Marker | null;
  }>());

  // --- Mode ---
  const [mode, setMode] = useState<MapMode>('view');
  const [selectedPinIds, setSelectedPinIds] = useState<Set<string>>(new Set());
  const [selectedStatus, setSelectedStatus] = useState<PinStatus>('closed_won');
  const [showTokenMsg, setShowTokenMsg] = useState(false);
  // GPS permission refused/unavailable → discreet, dismissible banner.
  const [gpsDenied, setGpsDenied] = useState(false);
  const [gpsBannerDismissed, setGpsBannerDismissed] = useState(false);
  const [, forceUpdate] = useState(0);

  // --- Filters ---
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<PinStatus>>(
    new Set(['closed_won', 'follow_up', 'appointment', 'no_answer', 'rejected', 'other'])
  );
  const [showNotes, setShowNotes] = useState(true);
  const [pinDateFilter, setPinDateFilter] = useState<DateFilter>('all');
  const [showZones, setShowZones] = useState(true);
  const [zoneDateFilter, setZoneDateFilter] = useState<DateFilter>('all');
  const [filterByRep, setFilterByRep] = useState<string>('all');
  const [showReps, setShowReps] = useState(true);
  const repMarkersRef = useRef(new Map<string, mapboxgl.Marker>());

  // --- Select mode refs ---
  const selectBoxRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);

  // --- Edit modal ---
  const [editingPin, setEditingPin] = useState<LeadPinData | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editStatus, setEditStatus] = useState<PinStatus>('closed_won');
  const [editNote, setEditNote] = useState('');

  // --- Lume ---
  // CRM actions handled via props callbacks

  // --- Street search ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; place_name: string; center: [number, number] }>>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTimerRef = useRef<number | null>(null);

  // --- Pin navigation (Find & Replace style) ---
  const [navigatingStatus, setNavigatingStatus] = useState<PinStatus | null>(null);
  const [navIndex, setNavIndex] = useState(0);
  const navPinsRef = useRef<LeadPinData[]>([]);
  const prevHighlightRef = useRef<HTMLElement | null>(null);

  /** Collect all visible pins matching a status, sorted by distance from map center */
  function getNavPins(status: PinStatus): LeadPinData[] {
    const center = mapRef.current?.getCenter();
    const pins: LeadPinData[] = [];
    markersRef.current.forEach(({ pin, marker }) => {
      if (pin.status === status && marker.getElement().style.display !== 'none') {
        pins.push(pin);
      }
    });
    if (center) {
      pins.sort((a, b) => {
        const dA = Math.hypot(a.lat - center.lat, a.lng - center.lng);
        const dB = Math.hypot(b.lat - center.lat, b.lng - center.lng);
        return dA - dB;
      });
    }
    return pins;
  }

  /** Fly to a pin and highlight it */
  function flyToNavPin(pin: LeadPinData) {
    // Remove previous highlight
    if (prevHighlightRef.current) {
      prevHighlightRef.current.style.outline = '';
      prevHighlightRef.current.style.outlineOffset = '';
      prevHighlightRef.current.style.zIndex = '';
    }
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ center: [pin.lng, pin.lat], zoom: Math.max(map.getZoom(), 17), duration: 600 });
    // Highlight the pin element
    const rec = markersRef.current.get(pin.id);
    if (rec) {
      const el = rec.marker.getElement();
      el.style.outline = '3px solid white';
      el.style.outlineOffset = '2px';
      el.style.zIndex = '999';
      el.style.borderRadius = '50%';
      prevHighlightRef.current = el;
    }
  }

  /** Start navigating pins of a given status */
  function startPinNavigation(status: PinStatus) {
    const pins = getNavPins(status);
    navPinsRef.current = pins;
    if (pins.length === 0) {
      setNavigatingStatus(null);
      return;
    }
    setNavigatingStatus(status);
    setNavIndex(0);
    flyToNavPin(pins[0]);
  }

  /** Go to next/prev pin */
  function navNext() {
    const pins = navPinsRef.current;
    if (pins.length === 0) return;
    const next = (navIndex + 1) % pins.length;
    setNavIndex(next);
    flyToNavPin(pins[next]);
  }

  function navPrev() {
    const pins = navPinsRef.current;
    if (pins.length === 0) return;
    const prev = (navIndex - 1 + pins.length) % pins.length;
    setNavIndex(prev);
    flyToNavPin(pins[prev]);
  }

  /** Stop navigation */
  function stopPinNavigation() {
    if (prevHighlightRef.current) {
      prevHighlightRef.current.style.outline = '';
      prevHighlightRef.current.style.outlineOffset = '';
      prevHighlightRef.current.style.zIndex = '';
    }
    setNavigatingStatus(null);
    setNavIndex(0);
    navPinsRef.current = [];
  }

  // Keyboard: Space = next, Shift+Space = prev, Escape = stop
  useEffect(() => {
    if (!navigatingStatus) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && navigatingStatus) {
        e.preventDefault();
        if (e.shiftKey) navPrev(); else navNext();
      }
      if (e.code === 'Escape') {
        stopPinNavigation();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigatingStatus, navIndex]);

  // --- Zones ---
  const zonesRef = useRef<ZoneData[]>([]);
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const drawingMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const [zoneNameInput, setZoneNameInput] = useState('');
  const [zoneAssignInput, setZoneAssignInput] = useState('');
  const [showZoneConfirm, setShowZoneConfirm] = useState(false);
  const [selectedZone, setSelectedZone] = useState<ZoneData | null>(null);

  const noteLabelRefs = useRef(new Map<string, HTMLDivElement>());

  function bump() { forceUpdate((n) => n + 1); }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  function savePins() {
    // Pin caching disabled — was causing ghost pins after deletion.
    // Pins are loaded fresh from the API on each page load.
  }

  function saveZones() {
    // Zone caching disabled — same ghost issue as pins
  }

  // ---------------------------------------------------------------------------
  // Pin visibility — applies status + date + rep filters
  // ---------------------------------------------------------------------------
  function applyPinVisibility(filters?: Set<PinStatus>) {
    const f = filters ?? activeFilters;
    const notesOn = containerRef.current?.dataset.showNotes === 'true';
    markersRef.current.forEach(({ pin, marker, noteMarker }) => {
      let visible = f.has(pin.status);
      if (visible && pinDateFilter !== 'all') {
        // pins don't have created_at in the current schema, always show for date filter
      }
      marker.getElement().style.display = visible ? '' : 'none';
      if (noteMarker) {
        noteMarker.getElement().style.display = (visible && notesOn) ? '' : 'none';
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Zone rendering on Mapbox
  // ---------------------------------------------------------------------------
  function renderZonesOnMap() {
    const map = mapRef.current;
    if (!map) return;

    // Remove all existing zone layers/sources
    zonesRef.current.forEach((_, i) => {
      const fillId = `zone-fill-${i}`;
      const lineId = `zone-line-${i}`;
      const srcId = `zone-src-${i}`;
      if (map.getLayer(fillId)) map.removeLayer(fillId);
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getSource(srcId)) map.removeSource(srcId);
    });
    // Also clean up any orphaned layers from previous renders
    for (let i = 0; i < 100; i++) {
      const fillId = `zone-fill-${i}`;
      const lineId = `zone-line-${i}`;
      const srcId = `zone-src-${i}`;
      if (map.getLayer(fillId)) map.removeLayer(fillId);
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getSource(srcId)) map.removeSource(srcId);
    }

    if (!showZones) return;

    zonesRef.current.forEach((zone, i) => {
      // Date filter
      if (!matchesDateFilter(zone.created_at, zoneDateFilter)) return;
      // Rep filter
      if (filterByRep !== 'all' && zone.assigned_to !== filterByRep) return;

      const srcId = `zone-src-${i}`;
      const fillId = `zone-fill-${i}`;
      const lineId = `zone-line-${i}`;

      const coords = [...zone.coordinates];
      if (coords.length > 0 && (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])) {
        coords.push(coords[0]);
      }

      map.addSource(srcId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: { name: zone.name, assigned: zone.assigned_to_name || 'Non assigné', created: zone.created_at },
          geometry: { type: 'Polygon', coordinates: [coords] },
        },
      });

      map.addLayer({
        id: fillId,
        type: 'fill',
        source: srcId,
        paint: {
          'fill-color': zone.color,
          'fill-opacity': 0.18,
        },
      });

      map.addLayer({
        id: lineId,
        type: 'line',
        source: srcId,
        paint: {
          'line-color': zone.color,
          'line-width': 2.5,
          'line-opacity': 0.8,
        },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Pin CRUD
  // ---------------------------------------------------------------------------
  function toggleNotes() {
    setShowNotes((prev) => {
      const next = !prev;
      if (containerRef.current) containerRef.current.dataset.showNotes = String(next);
      markersRef.current.forEach(({ pin, noteMarker }) => {
        if (!noteMarker) return;
        const visible = activeFilters.has(pin.status) && next;
        noteMarker.getElement().style.display = visible ? '' : 'none';
      });
      return next;
    });
  }

  function toggleFilter(status: PinStatus) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      applyPinVisibility(next);
      return next;
    });
  }

  function removePin(id: string) {
    const rec = markersRef.current.get(id);
    if (!rec) return;
    rec.marker.remove();
    if (rec.noteMarker) rec.noteMarker.remove();
    markersRef.current.delete(id);
    bump();
    // Notify parent to delete from DB
    onPinDeletedRef.current?.(id);
  }

  function placePin(map: mapboxgl.Map, pin: LeadPinData) {
    const el = createLeadPinElement(pin.status);
    const editId = `e-${pin.id}`;
    const delId = `d-${pin.id}`;
    const crmId = `crm-${pin.id}`;

    const popup = new mapboxgl.Popup({
      offset: 18, closeButton: false, closeOnClick: true, maxWidth: '280px', className: 'fp-popup', anchor: 'bottom',
    });

    function refreshPopupHTML() {
      const current = markersRef.current.get(pin.id)?.pin || pin;
      popup.setHTML(createLeadPinPopupHTML(current, editId, delId, crmId, fr ? 'fr' : 'en'));
    }

    popup.on('open', () => {
      refreshPopupHTML();
      // Use requestAnimationFrame + setTimeout to ensure DOM is fully rendered
      requestAnimationFrame(() => {
        setTimeout(() => {
          const editBtn = document.getElementById(editId);
          const delBtn = document.getElementById(delId);
          // lumeBtn removed — CRM button handled by crmBtn above

          if (editBtn) {
            editBtn.onclick = (e) => {
              e.stopPropagation();
              const current = markersRef.current.get(pin.id)?.pin || pin;
              popup.remove();
              setEditingPin(current);
              setEditName(current.name);
              setEditPhone(current.phone || '');
              setEditEmail(current.email || '');
              setEditStatus(current.status);
              setEditNote(current.note);
            };
          }
          if (delBtn) {
            delBtn.onclick = (e) => {
              e.stopPropagation();
              popup.remove();
              removePin(pin.id);
            };
          }
          const crmBtn = document.getElementById(crmId);
          if (crmBtn) {
            crmBtn.onclick = (e) => {
              e.stopPropagation();
              const current = markersRef.current.get(pin.id)?.pin || pin;
              popup.remove();
              if (current.status === 'closed_won' && onPinClosedWonRef.current) {
                onPinClosedWonRef.current(current);
              } else if (current.status === 'appointment' && onPinAppointmentRef.current) {
                onPinAppointmentRef.current(current);
              }
            };
          }
        }, 50);
      });
    });

    const marker = new mapboxgl.Marker({ element: el })
      .setLngLat([pin.lng, pin.lat])
      .setPopup(popup)
      .addTo(map);

    let noteMarker: mapboxgl.Marker | null = null;
    if (pin.note) {
      const noteEl = document.createElement('div');
      noteEl.setAttribute('style', [
        'box-sizing:border-box', 'max-width:160px', 'padding:3px 8px', 'border-radius:6px',
        'background:rgba(12,12,20,0.88)', 'border:1px solid rgba(255,255,255,0.08)',
        'backdrop-filter:blur(8px)', 'font-family:Inter,system-ui,sans-serif',
        'font-size:10px', 'line-height:1.35', 'color:rgba(255,255,255,0.65)',
        'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
        'pointer-events:none', 'text-align:center',
      ].join(';'));
      noteEl.textContent = `📝 ${pin.note}`;
      noteMarker = new mapboxgl.Marker({ element: noteEl, anchor: 'top' })
        .setLngLat([pin.lng, pin.lat]).setOffset([0, 18]).addTo(map);
      noteEl.style.display = containerRef.current?.dataset.showNotes === 'true' ? '' : 'none';
    }

    markersRef.current.set(pin.id, { pin, marker, noteMarker });
    if (!activeFilters.has(pin.status)) {
      marker.getElement().style.display = 'none';
      if (noteMarker) noteMarker.getElement().style.display = 'none';
    }
    bump();
    savePins();
  }

  // ---------------------------------------------------------------------------
  // Init map
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) { setShowTokenMsg(true); return; }
    mapboxgl.accessToken = token;

    const fallback: [number, number] = [-72.5485, 46.343];

    function initMap(center: [number, number], startZoom: number) {
      const map = new mapboxgl.Map({
        container: containerRef.current!,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center, zoom: startZoom, maxZoom: 22, minZoom: 2, antialias: true, attributionControl: false,
      });

      map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
      // GeolocateControl removed — it created a duplicate GPS dot.
      // Map is already centered on user position via getCurrentPosition in the init flow.
      // A manual "re-center" button is added in the UI instead.
      map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100 }), 'bottom-left');

      map.on('load', () => {
        mapRef.current = map;
        setMapReady(true);

        // Clear any stale caches
        try { localStorage.removeItem('d2d-map-pins'); localStorage.removeItem('d2d-map-zones'); } catch {}

        // Load initial pins from API (passed via props)
        if (initialPins?.length) {
          initialPins.forEach((pin) => placePin(map, pin));
        }

        // Zone hover tooltip
        map.on('mousemove', (e) => {
          const features = map.queryRenderedFeatures(e.point).filter((f) => f.layer?.id?.startsWith('zone-fill-'));
          map.getCanvas().style.cursor = features.length > 0 && mode === 'view' ? 'pointer' : (mode === 'draw_zone' || mode === 'add_pin' || mode === 'select' ? 'crosshair' : '');
        });

        // Zone click
        map.on('click', (e) => {
          // Draw zone mode — add points
          if (containerRef.current?.dataset.mapMode === 'draw_zone') {
            const { lng, lat } = e.lngLat;
            // Add visual marker for the point
            const dotEl = document.createElement('div');
            dotEl.setAttribute('style', 'width:10px;height:10px;border-radius:50%;background:#6366f1;border:2px solid white;box-shadow:0 0 6px rgba(99,102,241,.6);');
            const m = new mapboxgl.Marker({ element: dotEl }).setLngLat([lng, lat]).addTo(map);
            drawingMarkersRef.current.push(m);

            setDrawingPoints((prev) => {
              const next = [...prev, [lng, lat] as [number, number]];
              // Draw preview line
              renderDrawingPreview(map, next);
              return next;
            });
            return;
          }

          // Add pin mode
          if (containerRef.current?.dataset.mapMode === 'add_pin') {
            const status = (containerRef.current.dataset.status || 'other') as PinStatus;
            const { lng, lat } = e.lngLat;
            const id = crypto.randomUUID();
            const pin: LeadPinData = { id, lat, lng, status, name: 'Nouveau lead', phone: '', email: '', address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, note: '' };
            placePin(map, pin);
            containerRef.current!.dataset.mapMode = 'view';
            map.getCanvas().style.cursor = '';
            setMode('view');
            // Reverse geocode for address, then notify parent to persist + trigger CRM flow
            fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&language=fr&limit=1`)
              .then((r) => r.json())
              .then((data) => {
                const place = data.features?.[0];
                const rec = markersRef.current.get(id);
                if (rec) {
                  rec.pin.name = place?.text || 'Nouveau lead';
                  rec.pin.address = place?.place_name || pin.address;
                }
                const finalPin = rec?.pin || pin;
                // Save pin to DB
                onPinCreatedRef.current?.(finalPin);
                // Trigger CRM flow based on pin status
                if (finalPin.status === 'closed_won') onPinClosedWonRef.current?.(finalPin);
                if (finalPin.status === 'appointment') onPinAppointmentRef.current?.(finalPin);
              }).catch(() => {
                onPinCreatedRef.current?.(pin);
                if (pin.status === 'closed_won') onPinClosedWonRef.current?.(pin);
                if (pin.status === 'appointment') onPinAppointmentRef.current?.(pin);
              });
            return;
          }

          // View mode — check zone click
          if (containerRef.current?.dataset.mapMode === 'view') {
            const features = map.queryRenderedFeatures(e.point).filter((f) => f.layer?.id?.startsWith('zone-fill-'));
            if (features.length > 0) {
              const props = features[0].properties;
              const idx = parseInt(features[0].layer!.id.replace('zone-fill-', ''), 10);
              const zone = zonesRef.current[idx];
              if (zone) setSelectedZone(zone);
            }
          }
        });
      });

      return map;
    }

    function placeGpsDot(map: mapboxgl.Map, lng: number, lat: number) {
      // Always remove previous first — guarantees exactly 1 dot
      if (gpsMarkerRef.current) { gpsMarkerRef.current.remove(); gpsMarkerRef.current = null; }

      const el = document.createElement('div');
      el.innerHTML = `
        <div style="position:relative;width:22px;height:22px;display:flex;align-items:center;justify-content:center">
          <div style="position:absolute;inset:0;border-radius:50%;background:rgba(99,102,241,0.25);animation:gpsPulse 2s ease-out infinite"></div>
          <div style="width:14px;height:14px;border-radius:50%;background:#6366f1;border:2.5px solid white;box-shadow:0 1px 6px rgba(0,0,0,0.4)"></div>
        </div>
      `;
      gpsMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map);
    }

    // Inject GPS pulse animation once
    if (!document.getElementById('gps-pulse-style')) {
      const s = document.createElement('style');
      s.id = 'gps-pulse-style';
      s.textContent = '@keyframes gpsPulse{0%{transform:scale(.8);opacity:1}100%{transform:scale(2.2);opacity:0}}';
      document.head.appendChild(s);
    }

    // Cleanup any previous GPS watch from HMR re-mount
    if (gpsWatchRef.current != null) {
      navigator.geolocation.clearWatch(gpsWatchRef.current);
      gpsWatchRef.current = null;
    }
    if (gpsMarkerRef.current) {
      gpsMarkerRef.current.remove();
      gpsMarkerRef.current = null;
    }

    // Last-known GPS position, cached so the map opens on (or very near) the
    // user's blue pin instantly instead of blanking while a fresh fix loads.
    let cached: [number, number] | null = null;
    try {
      const raw = localStorage.getItem('d2d-last-gps');
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p?.lng === 'number' && typeof p?.lat === 'number') cached = [p.lng, p.lat];
      }
    } catch {}

    // Open immediately — on the cached user position if we have one, else the
    // regional fallback. The map never waits on the GPS lookup to render.
    const map = initMap(cached ?? fallback, cached ? 17 : 14);
    if (cached) {
      const c = cached;
      map.on('load', () => placeGpsDot(map, c[0], c[1]));
    }

    // Drop/refresh the blue pin on the user's live position and remember it.
    function centerOnUser(lng: number, lat: number, fly: boolean) {
      placeGpsDot(map, lng, lat);
      if (fly) map.flyTo({ center: [lng, lat], zoom: 17, duration: 800 });
      else map.jumpTo({ center: [lng, lat], zoom: 17 });
      try { localStorage.setItem('d2d-last-gps', JSON.stringify({ lng, lat })); } catch {}
    }

    // Live GPS updates — moves the single dot, never creates a second.
    function startWatch() {
      if (gpsWatchRef.current != null) return;
      gpsWatchRef.current = navigator.geolocation.watchPosition(
        (p) => { if (mapRef.current) { setGpsDenied(false); placeGpsDot(map, p.coords.longitude, p.coords.latitude); try { localStorage.setItem('d2d-last-gps', JSON.stringify({ lng: p.coords.longitude, lat: p.coords.latitude })); } catch {} } },
        (err) => { if (err.code === err.PERMISSION_DENIED) setGpsDenied(true); },
        { enableHighAccuracy: true }
      );
    }

    // Exposed to the "Enable" banner: re-center + (re)start tracking after the
    // user turns their location back on.
    gpsRecenterRef.current = (lng, lat) => { setGpsDenied(false); centerOnUser(lng, lat, true); startWatch(); };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGpsDenied(false);
          const { longitude: lng, latitude: lat } = pos.coords;
          // Smooth fly-in if we already opened near the user (cache); otherwise
          // jump straight to them so we don't animate across the whole region.
          const apply = () => centerOnUser(lng, lat, !!cached);
          if (map.loaded()) apply(); else map.on('load', apply);
          startWatch();
        },
        (err) => {
          // Permission denied, position unavailable or timed out — surface the
          // non-intrusive banner so the user knows their pin isn't live.
          if (err.code === err.PERMISSION_DENIED || err.code === err.POSITION_UNAVAILABLE) setGpsDenied(true);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
      );
    } else {
      // Browser has no geolocation API at all.
      setGpsDenied(true);
    }

    return () => {
      if (gpsWatchRef.current != null) { navigator.geolocation.clearWatch(gpsWatchRef.current); gpsWatchRef.current = null; }
      if (gpsMarkerRef.current) { gpsMarkerRef.current.remove(); gpsMarkerRef.current = null; }
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // mapReady is used by other effects below
  const [mapReady, setMapReady] = useState(false);

  // Debounced street search via Mapbox geocoding
  useEffect(() => {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    const q = searchQuery.trim();
    if (q.length < 3) { setSearchResults([]); return; }
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) return;
    searchTimerRef.current = window.setTimeout(() => {
      const center = mapRef.current?.getCenter();
      const proximity = center ? `&proximity=${center.lng},${center.lat}` : '';
      fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&language=fr&limit=6&types=address,place,postcode,locality,neighborhood${proximity}`)
        .then((r) => r.json())
        .then((data) => {
          const features = (data?.features ?? []).map((f: any) => ({
            id: f.id, place_name: f.place_name, center: f.center as [number, number],
          }));
          setSearchResults(features);
        })
        .catch(() => setSearchResults([]));
    }, 250);
    return () => { if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  // Sync external link updates into local markers so the popup re-renders with
  // "✓ Job liée" instead of "+ Créer une Job" after the parent creates a job.
  useEffect(() => {
    if (!pinLinkUpdates) return;
    for (const [pinId, links] of Object.entries(pinLinkUpdates)) {
      const rec = markersRef.current.get(pinId);
      if (!rec) continue;
      if (links.job_id !== undefined) rec.pin.job_id = links.job_id;
      if (links.quote_id !== undefined) rec.pin.quote_id = links.quote_id;
      if (links.client_id !== undefined) rec.pin.client_id = links.client_id;
      if (links.lead_id !== undefined) rec.pin.lead_id = links.lead_id;
    }
  }, [pinLinkUpdates]);

  // Sync data-attributes
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.dataset.mapMode = mode;
    containerRef.current.dataset.status = selectedStatus;
    const map = mapRef.current;
    if (map) {
      if (mode === 'select') { map.dragPan.disable(); } else { map.dragPan.enable(); }
      map.getCanvas().style.cursor = (mode === 'add_pin' || mode === 'select' || mode === 'draw_zone') ? 'crosshair' : '';
    }
  }, [mode, selectedStatus]);

  // Re-render zones when filters change
  useEffect(() => {
    renderZonesOnMap();
  }, [showZones, zoneDateFilter, filterByRep]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Rep live markers
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!showReps) {
      // Remove all rep markers
      repMarkersRef.current.forEach((m) => m.remove());
      repMarkersRef.current.clear();
      return;
    }

    // Add/update rep markers from live API data
    const reps = liveRepsProp || [];
    reps.forEach((rep) => {
      const repKey = rep.user_id;
      if (repMarkersRef.current.has(repKey)) {
        repMarkersRef.current.get(repKey)!.setLngLat([rep.longitude, rep.latitude]);
        return;
      }

      const name = rep.user_name || 'Rep';
      const initial = name.charAt(0).toUpperCase();
      const color = rep.team_color || '#6366f1';
      const statusDot = rep.tracking_status === 'active' ? '#22c55e' : '#f59e0b';
      // Build via DOM API (not innerHTML) — name/team_name/tracking_status come from API and would be XSS vectors otherwise
      const el = document.createElement('div');
      el.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;cursor:pointer;';

      const avatarWrap = document.createElement('div');
      avatarWrap.style.position = 'relative';

      const pulse = document.createElement('div');
      pulse.style.cssText = `position:absolute;inset:-3px;border-radius:50%;background:${color}40;animation:rep-pulse 2s ease-out infinite;`;

      const avatar = document.createElement('div');
      avatar.style.cssText = `width:36px;height:36px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:white;position:relative;z-index:1;`;
      avatar.textContent = initial;

      const statusBadge = document.createElement('div');
      statusBadge.style.cssText = `position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-radius:50%;background:${statusDot};border:2px solid white;z-index:2;`;

      avatarWrap.append(pulse, avatar, statusBadge);

      const labelBox = document.createElement('div');
      labelBox.style.cssText = 'margin-top:4px;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:2px 8px;white-space:nowrap;';

      const nameP = document.createElement('p');
      nameP.style.cssText = 'font-size:10px;font-weight:700;color:white;margin:0;line-height:1.3;';
      nameP.textContent = name;

      const metaP = document.createElement('p');
      metaP.style.cssText = 'font-size:8px;color:rgba(255,255,255,0.5);margin:0;line-height:1.3;';
      metaP.textContent = `${rep.team_name || ''} · ${rep.tracking_status}`;

      labelBox.append(nameP, metaP);
      el.append(avatarWrap, labelBox);

      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([rep.longitude, rep.latitude])
        .addTo(map);

      repMarkersRef.current.set(repKey, marker);
    });

    // Inject pulse animation if not present
    if (!document.getElementById('rep-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'rep-pulse-style';
      style.textContent = '@keyframes rep-pulse{0%{transform:scale(.9);opacity:1}100%{transform:scale(1.8);opacity:0}}';
      document.head.appendChild(style);
    }

    return () => {
      repMarkersRef.current.forEach((m) => m.remove());
      repMarkersRef.current.clear();
    };
  }, [showReps, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update rep positions when liveRepsProp changes (parent polls API)
  useEffect(() => {
    if (!showReps || !mapRef.current || !liveRepsProp?.length) return;
    liveRepsProp.forEach((rep) => {
      const marker = repMarkersRef.current.get(rep.user_id);
      if (marker) marker.setLngLat([rep.longitude, rep.latitude]);
    });
  }, [liveRepsProp, showReps]);

  // ---------------------------------------------------------------------------
  // Drawing zone preview
  // ---------------------------------------------------------------------------
  function renderDrawingPreview(map: mapboxgl.Map, points: [number, number][]) {
    if (map.getLayer('draw-preview-line')) map.removeLayer('draw-preview-line');
    if (map.getLayer('draw-preview-fill')) map.removeLayer('draw-preview-fill');
    if (map.getSource('draw-preview')) map.removeSource('draw-preview');
    if (points.length < 2) return;

    const coords = [...points, points[0]];
    map.addSource('draw-preview', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } },
    });
    map.addLayer({
      id: 'draw-preview-fill', type: 'fill', source: 'draw-preview',
      paint: { 'fill-color': '#6366f1', 'fill-opacity': 0.12 },
    });
    map.addLayer({
      id: 'draw-preview-line', type: 'line', source: 'draw-preview',
      paint: { 'line-color': '#6366f1', 'line-width': 2, 'line-dasharray': [2, 2] },
    });
  }

  function clearDrawingPreview() {
    const map = mapRef.current;
    if (!map) return;
    if (map.getLayer('draw-preview-line')) map.removeLayer('draw-preview-line');
    if (map.getLayer('draw-preview-fill')) map.removeLayer('draw-preview-fill');
    if (map.getSource('draw-preview')) map.removeSource('draw-preview');
    drawingMarkersRef.current.forEach((m) => m.remove());
    drawingMarkersRef.current = [];
  }

  function finishDrawing() {
    if (drawingPoints.length < 3) return;
    setShowZoneConfirm(true);
  }

  function cancelDrawing() {
    clearDrawingPreview();
    setDrawingPoints([]);
    setMode('view');
    setShowZoneConfirm(false);
    setZoneNameInput('');
    setZoneAssignInput('');
  }

  function confirmZone() {
    const zone: ZoneData = {
      id: crypto.randomUUID(),
      name: zoneNameInput || `Zone ${zonesRef.current.length + 1}`,
      created_by: CURRENT_USER.id,
      assigned_to: zoneAssignInput || null,
      assigned_to_name: SALES_REPS.find((r) => r.id === zoneAssignInput)?.name || null,
      coordinates: drawingPoints,
      color: getZoneColor(zonesRef.current.length),
      created_at: new Date().toISOString(),
    };
    zonesRef.current.push(zone);
    saveZones();
    clearDrawingPreview();
    setDrawingPoints([]);
    setMode('view');
    setShowZoneConfirm(false);
    setZoneNameInput('');
    setZoneAssignInput('');
    renderZonesOnMap();
    bump();
  }

  function deleteZone(zoneId: string) {
    zonesRef.current = zonesRef.current.filter((z) => z.id !== zoneId);
    saveZones();
    renderZonesOnMap();
    setSelectedZone(null);
    bump();
  }

  function reassignZone(zoneId: string, repId: string) {
    const rep = SALES_REPS.find((r) => r.id === repId);
    zonesRef.current = zonesRef.current.map((z) =>
      z.id === zoneId ? { ...z, assigned_to: repId || null, assigned_to_name: rep?.name || null } : z
    );
    saveZones();
    setSelectedZone(zonesRef.current.find((z) => z.id === zoneId) || null);
    bump();
  }

  // ---------------------------------------------------------------------------
  // Edit pin
  // ---------------------------------------------------------------------------
  function handleSaveEdit() {
    if (!editingPin || !mapRef.current) return;
    const prevStatus = editingPin.status;
    const newStatus = editStatus;
    const statusChanged = prevStatus !== newStatus;
    // Remove old marker (don't trigger onPinDeleted — this is an update, not a delete)
    const rec = markersRef.current.get(editingPin.id);
    if (rec) { rec.marker.remove(); if (rec.noteMarker) rec.noteMarker.remove(); markersRef.current.delete(editingPin.id); }
    const updated: LeadPinData = { ...editingPin, name: editName, phone: editPhone, email: editEmail, status: newStatus, note: editNote };
    placePin(mapRef.current, updated);
    setEditingPin(null);

    // Notify parent to persist the update
    onPinUpdatedRef.current?.(updated);

    // Trigger CRM action if status changed to a CRM-linked status
    if (statusChanged || (!updated.job_id && newStatus === 'closed_won') || (!updated.quote_id && newStatus === 'appointment')) {
      if (newStatus === 'closed_won' && !updated.job_id && onPinClosedWonRef.current) onPinClosedWonRef.current(updated);
      if (newStatus === 'appointment' && !updated.quote_id && onPinAppointmentRef.current) onPinAppointmentRef.current(updated);
    }
  }

  // (Lume handlers removed — CRM actions handled via onPinClosedWon/onPinAppointment callbacks)

  // ---------------------------------------------------------------------------
  // Select mode
  // ---------------------------------------------------------------------------
  function enterSelectMode() {
    setMode('select');
    setSelectedPinIds(new Set());
    clearPinHighlights();
  }
  function exitSelectMode() {
    setMode('view');
    setSelectedPinIds(new Set());
    clearPinHighlights();
    dragStartRef.current = null;
    isDraggingRef.current = false;
    if (selectBoxRef.current) selectBoxRef.current.style.display = 'none';
  }
  function clearPinHighlights() {
    markersRef.current.forEach(({ marker }) => { marker.getElement().style.outline = ''; marker.getElement().style.outlineOffset = ''; });
  }
  function highlightPins(ids: Set<string>) {
    clearPinHighlights();
    markersRef.current.forEach(({ marker }, id) => {
      if (ids.has(id)) { marker.getElement().style.outline = '2px solid rgba(239,68,68,0.8)'; marker.getElement().style.outlineOffset = '2px'; }
    });
  }
  function findPinsInRect(startPx: { x: number; y: number }, endPx: { x: number; y: number }): Set<string> {
    const map = mapRef.current;
    if (!map) return new Set();
    const minX = Math.min(startPx.x, endPx.x), maxX = Math.max(startPx.x, endPx.x);
    const minY = Math.min(startPx.y, endPx.y), maxY = Math.max(startPx.y, endPx.y);
    const sw = map.unproject([minX, maxY]), ne = map.unproject([maxX, minY]);
    const found = new Set<string>();
    markersRef.current.forEach(({ pin }, id) => {
      if (pin.lng >= sw.lng && pin.lng <= ne.lng && pin.lat >= sw.lat && pin.lat <= ne.lat && activeFilters.has(pin.status)) found.add(id);
    });
    return found;
  }
  function isMapCanvas(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    return target.tagName === 'CANVAS' || target.classList.contains('mapboxgl-canvas');
  }
  function handleSelectMouseDown(e: React.MouseEvent) {
    if (mode !== 'select' || !isMapCanvas(e)) return;
    const rect = containerRef.current!.getBoundingClientRect();
    dragStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    isDraggingRef.current = false;
  }
  function handleSelectMouseMove(e: React.MouseEvent) {
    if (mode !== 'select' || !dragStartRef.current) return;
    isDraggingRef.current = true;
    const rect = containerRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const start = dragStartRef.current;
    const box = selectBoxRef.current;
    if (box) {
      box.style.display = 'block';
      box.style.left = `${Math.min(start.x, cx)}px`; box.style.top = `${Math.min(start.y, cy)}px`;
      box.style.width = `${Math.abs(cx - start.x)}px`; box.style.height = `${Math.abs(cy - start.y)}px`;
    }
  }
  function handleSelectMouseUp(e: React.MouseEvent) {
    if (mode !== 'select' || !dragStartRef.current) return;
    const box = selectBoxRef.current;
    if (box) box.style.display = 'none';
    if (isDraggingRef.current) {
      const rect = containerRef.current!.getBoundingClientRect();
      const endPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const dx = Math.abs(endPx.x - dragStartRef.current.x), dy = Math.abs(endPx.y - dragStartRef.current.y);
      if (dx > 10 && dy > 10) {
        const ids = findPinsInRect(dragStartRef.current, endPx);
        setSelectedPinIds(ids);
        highlightPins(ids);
      }
    }
    dragStartRef.current = null;
    isDraggingRef.current = false;
  }
  function handleBulkDelete() {
    selectedPinIds.forEach((id) => removePin(id)); // each removePin calls onPinDeleted
    exitSelectMode();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const statuses = Object.entries(PIN_STATUS_CONFIG) as [PinStatus, (typeof PIN_STATUS_CONFIG)[PinStatus]][];
  const totalPins = markersRef.current.size;
  const counts: Record<PinStatus, number> = { closed_won: 0, follow_up: 0, appointment: 0, no_answer: 0, rejected: 0, other: 0 };
  markersRef.current.forEach(({ pin }) => { counts[pin.status]++; });
  const totalZones = zonesRef.current.length;

  const dateLabels: Record<DateFilter, string> = fr
    ? { today: "Aujourd'hui", yesterday: 'Hier', this_month: 'Ce mois', this_year: 'Cette année', all: 'Tout' }
    : { today: 'Today', yesterday: 'Yesterday', this_month: 'This month', this_year: 'This year', all: 'All' };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      data-map-mode="view"
      data-status="closed_won"
      data-show-notes="true"
      onMouseDown={handleSelectMouseDown}
      onMouseMove={handleSelectMouseMove}
      onMouseUp={handleSelectMouseUp}
    >
      <style>{`
        .fp-popup .mapboxgl-popup-content {
          background: rgba(12,12,20,.94) !important;
          backdrop-filter: blur(20px) saturate(1.4) !important;
          border: 1px solid rgba(255,255,255,.07) !important;
          border-radius: 16px !important;
          padding: 16px 18px !important;
          box-shadow: 0 12px 40px rgba(0,0,0,.55) !important;
        }
        .fp-popup .mapboxgl-popup-tip { border-top-color: rgba(12,12,20,.94) !important; }
        .mapboxgl-ctrl-group {
          background: rgba(12,12,20,.85) !important; backdrop-filter: blur(10px) !important;
          border: 1px solid rgba(255,255,255,.07) !important; border-radius: 12px !important; overflow: hidden;
        }
        .mapboxgl-ctrl-group button { border-color: rgba(255,255,255,.05) !important; }
        .mapboxgl-ctrl-group button span { filter: invert(1) !important; }
        .mapboxgl-ctrl-group button:hover { background: rgba(255,255,255,.07) !important; }
        .mapboxgl-user-location-dot { box-shadow: 0 0 0 4px rgba(99,102,241,.3) !important; }
        .mapboxgl-ctrl-scale {
          background: rgba(12,12,20,.7) !important; border-color: rgba(255,255,255,.12) !important;
          color: rgba(255,255,255,.45) !important; border-radius: 4px !important; font-size: 10px !important;
        }
        .mapboxgl-ctrl-attrib { background: rgba(0,0,0,.35) !important; border-radius: 6px !important; }
        .mapboxgl-ctrl-attrib a { color: rgba(255,255,255,.2) !important; font-size: 10px !important; }
        .mapboxgl-marker { cursor: pointer !important; z-index: 5 !important; }
        .mapboxgl-popup { z-index: 15 !important; }
      `}</style>

      {/* Selection rectangle overlay */}
      <div ref={selectBoxRef} className="pointer-events-none absolute z-20 rounded border-2 border-red-400/60 bg-red-500/15" style={{ display: 'none' }} />

      {/* Street search */}
      {!showTokenMsg && (
        <div className="pointer-events-auto absolute left-1/2 top-3 z-30 w-[min(240px,calc(100vw-2rem))] -translate-x-1/2">
          <div className="relative">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              placeholder={fr ? 'Rechercher une rue, un quartier, un code postal…' : 'Search a street, neighborhood, postal code…'}
              className="w-full rounded-xl border border-white/10 bg-black/70 py-2.5 pl-9 pr-9 text-[13px] text-white placeholder-white/35 shadow-xl outline-none backdrop-blur-xl focus:border-indigo-400/40"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white"
                aria-label={fr ? 'Effacer' : 'Clear'}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
            {searchOpen && searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 max-h-[300px] overflow-auto rounded-xl border border-white/10 bg-black/85 shadow-2xl backdrop-blur-xl">
                {searchResults.map((r) => (
                  <button
                    key={r.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      mapRef.current?.flyTo({ center: r.center, zoom: 17, duration: 800 });
                      setSearchOpen(false);
                      setSearchQuery(r.place_name);
                    }}
                    className="block w-full truncate px-3 py-2 text-left text-[12px] text-white/80 hover:bg-white/10"
                  >
                    {r.place_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Custom GPS re-center button (replaces Mapbox GeolocateControl to avoid duplicate dot) */}
      {!showTokenMsg && (
        <button
          onClick={() => {
            if (!navigator.geolocation) return;
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                mapRef.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 17, duration: 1000 });
              },
              () => {},
              { enableHighAccuracy: true, timeout: 5000 }
            );
          }}
          className="pointer-events-auto absolute bottom-20 right-3 z-10 flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-white/10 bg-black/70 text-white/60 shadow-xl backdrop-blur-xl transition-all hover:bg-white/15 hover:text-white"
          title={fr ? 'Centrer sur ma position' : 'Center on my location'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M12 2v4m0 12v4m-10-10h4m12 0h4" />
          </svg>
        </button>
      )}

      {/* Discreet banner when the user's location is off / refused */}
      {!showTokenMsg && gpsDenied && !gpsBannerDismissed && (
        <div className="pointer-events-auto absolute bottom-5 left-1/2 z-30 w-[min(360px,calc(100vw-2rem))] -translate-x-1/2">
          <div className="flex items-center gap-2.5 rounded-xl border border-amber-400/20 bg-black/80 px-3 py-2.5 shadow-xl backdrop-blur-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-400">
              <path d="M12 2v4m0 12v4m-10-10h4m12 0h4" /><circle cx="12" cy="12" r="3" />
            </svg>
            <p className="flex-1 text-[12px] leading-snug text-white/80">
              {fr
                ? 'Votre localisation est désactivée — votre position n’apparaît pas sur la carte.'
                : 'Your location is off — your position isn’t showing on the map.'}
            </p>
            <button
              onClick={() => {
                if (!navigator.geolocation) return;
                navigator.geolocation.getCurrentPosition(
                  (pos) => gpsRecenterRef.current?.(pos.coords.longitude, pos.coords.latitude),
                  () => {},
                  { enableHighAccuracy: true, timeout: 8000 },
                );
              }}
              className="shrink-0 rounded-lg bg-amber-400/15 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-400/25"
            >
              {fr ? 'Activer' : 'Enable'}
            </button>
            <button
              onClick={() => setGpsBannerDismissed(true)}
              className="shrink-0 rounded-md p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
              aria-label={fr ? 'Fermer' : 'Dismiss'}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* No token */}
      {showTokenMsg && (
        <div className="flex h-full w-full items-center justify-center bg-[#080b10]">
          <div className="max-w-md rounded-2xl border border-white/8 bg-white/[.03] p-8 text-center">
            <h2 className="text-lg font-semibold text-white">{fr ? 'Token Mapbox requis' : 'Mapbox token required'}</h2>
            <div className="mt-4 rounded-lg border border-white/8 bg-black/40 p-3 text-left">
              <code className="text-xs text-indigo-300">VITE_MAPBOX_TOKEN=pk.eyJ1Ijo...</code>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* TOP LEFT — Action buttons                                          */}
      {/* ================================================================== */}
      {!showTokenMsg && (
        <div className="pointer-events-none absolute left-4 right-4 top-4 z-10 flex items-start justify-between">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2">
            {/* Add pin */}
            {mode === 'view' && (
              <button
                onClick={() => setMode('add_pin')}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-[13px] font-semibold text-white/80 shadow-xl backdrop-blur-xl transition-all hover:bg-white/10"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14m-7-7h14" /></svg>
                Ajouter un pin
              </button>
            )}

            {/* Add pin active */}
            {mode === 'add_pin' && (
              <>
                <button
                  onClick={() => setMode('view')}
                  className="flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-[13px] font-semibold text-white shadow-xl shadow-indigo-500/25 transition-all"
                >
                  <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-white" /></span>
                  Cliquez sur la carte
                </button>
                <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/60 p-1 shadow-xl backdrop-blur-xl">
                  {statuses.map(([key, cfg]) => (
                    <button key={key} onClick={() => setSelectedStatus(key)}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all ${selectedStatus === key ? 'bg-white/12 text-white' : 'text-white/40 hover:text-white/70'}`}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cfg.color }} />
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Select mode */}
            {mode === 'view' && (
              <button
                onClick={enterSelectMode}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-[13px] font-semibold text-white/80 shadow-xl backdrop-blur-xl transition-all hover:bg-white/10"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 3a2 2 0 0 0-2 2" /><path d="M19 3a2 2 0 0 1 2 2" /><path d="M21 19a2 2 0 0 1-2 2" /><path d="M5 21a2 2 0 0 1-2-2" />
                  <path d="M9 3h1" /><path d="M9 21h1" /><path d="M14 3h1" /><path d="M14 21h1" /><path d="M3 9v1" /><path d="M3 14v1" /><path d="M21 9v1" /><path d="M21 14v1" />
                </svg>
                Sélectionner
              </button>
            )}
            {mode === 'select' && (
              <button onClick={exitSelectMode} className="flex items-center gap-2 rounded-xl bg-red-500/80 px-4 py-2.5 text-[13px] font-semibold text-white shadow-xl shadow-red-500/25 transition-all">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                Annuler sélection
              </button>
            )}

            {/* Create Zone — only for authorized roles */}
            {mode === 'view' && canCreateZone(CURRENT_USER.role) && (
              <button
                onClick={() => { setMode('draw_zone'); setDrawingPoints([]); }}
                className="flex items-center gap-2 rounded-xl border border-indigo-400/20 bg-indigo-500/15 px-4 py-2.5 text-[13px] font-semibold text-indigo-300 shadow-xl backdrop-blur-xl transition-all hover:bg-indigo-500/25"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
                </svg>
                Créer une zone
              </button>
            )}

            {/* Draw zone active */}
            {mode === 'draw_zone' && (
              <>
                <div className="flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-[13px] font-semibold text-white shadow-xl shadow-indigo-500/25">
                  <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-white" /></span>
                  Tracez la zone ({drawingPoints.length} points)
                </div>
                {drawingPoints.length >= 3 && (
                  <button onClick={finishDrawing} className="rounded-xl bg-emerald-500 px-4 py-2.5 text-[13px] font-semibold text-white shadow-xl shadow-emerald-500/25 transition-all hover:bg-emerald-400">
                    Terminer
                  </button>
                )}
                <button onClick={cancelDrawing} className="rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-[13px] font-semibold text-white/60 shadow-xl backdrop-blur-xl transition-all hover:bg-white/10 hover:text-white/80">
                  Annuler
                </button>
              </>
            )}
          </div>

          {/* ================================================================ */}
          {/* TOP RIGHT — Filter button + stats                                */}
          {/* ================================================================ */}
          <div className="pointer-events-auto flex items-center gap-2">
            {/* Pin stats */}
            {totalPins > 0 && (
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 shadow-xl backdrop-blur-xl">
                {statuses.map(([key, cfg]) => {
                  if (!counts[key]) return null;
                  return (
                    <div key={key} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cfg.color }} />
                      <span className="text-[12px] font-bold tabular-nums text-white/80">{counts[key]}</span>
                    </div>
                  );
                })}
                <div className="h-4 w-px bg-white/10" />
                <span className="text-[12px] font-semibold text-white/50">{totalPins} pin{totalPins > 1 ? 's' : ''}</span>
                {totalZones > 0 && (
                  <>
                    <div className="h-4 w-px bg-white/10" />
                    <span className="text-[12px] font-semibold text-indigo-300/70">{totalZones} zone{totalZones > 1 ? 's' : ''}</span>
                  </>
                )}
              </div>
            )}

            {/* FILTER BUTTON — top right */}
            <div className="relative">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold shadow-xl transition-all ${
                  showFilters
                    ? 'bg-white/15 text-white border border-white/20 backdrop-blur-xl'
                    : 'border border-white/10 bg-black/60 text-white/70 backdrop-blur-xl hover:bg-white/10 hover:text-white'
                }`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                Filtres
              </button>

              {/* FILTER PANEL */}
              {showFilters && (
                <div className="absolute right-0 top-full mt-2 w-[280px] rounded-xl border border-white/10 bg-black/85 p-3 shadow-2xl backdrop-blur-xl">
                  {/* --- PINS section --- */}
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30">{fr ? 'Pins — Statut' : 'Pins — Status'}</p>
                    <button
                      onClick={() => {
                        const allStatuses: PinStatus[] = statuses.map(([k]) => k);
                        const allActive = allStatuses.every((s) => activeFilters.has(s));
                        const next = new Set(allActive ? [] as PinStatus[] : allStatuses);
                        setActiveFilters(next);
                        applyPinVisibility(next);
                      }}
                      className="text-[9px] font-medium text-white/40 hover:text-white/70 transition-colors"
                    >
                      {statuses.every(([k]) => activeFilters.has(k)) ? (fr ? 'Tout désélectionner' : 'Deselect all') : (fr ? 'Tout sélectionner' : 'Select all')}
                    </button>
                  </div>
                  <div className="space-y-0.5">
                    {statuses.map(([key, cfg]) => {
                      const isActive = activeFilters.has(key);
                      return (
                        <button key={key} onClick={() => {
                            if (isActive) {
                              // Already active — start or continue navigation for this color
                              startPinNavigation(key);
                            } else {
                              toggleFilter(key);
                            }
                          }}
                          onDoubleClick={() => { if (!isActive) { toggleFilter(key); setTimeout(() => startPinNavigation(key), 50); } }}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-all ${isActive ? 'bg-white/8 text-white' : 'text-white/30 hover:text-white/50'} ${navigatingStatus === key ? 'ring-1 ring-white/40' : ''}`}
                        >
                          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-all"
                            style={{ borderColor: isActive ? cfg.color : 'rgba(255,255,255,.15)', backgroundColor: isActive ? cfg.color : 'transparent' }}
                          >
                            {isActive && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                          </span>
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cfg.color, opacity: isActive ? 1 : 0.35 }} />
                          <span className="text-[12px] font-medium flex-1">{cfg.label}</span>
                          {navigatingStatus === key && navPinsRef.current.length > 0 && (
                            <span className="text-[10px] font-bold text-white/60">{navIndex + 1}/{navPinsRef.current.length}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Pin navigation bar */}
                  {navigatingStatus && navPinsRef.current.length > 0 && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PIN_STATUS_CONFIG[navigatingStatus]?.color }} />
                      <span className="text-[11px] font-semibold text-white/80 flex-1">
                        {navIndex + 1} / {navPinsRef.current.length}
                      </span>
                      <button onClick={navPrev} className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white transition-colors" title={fr ? 'Précédent (Shift+Espace)' : 'Previous (Shift+Space)'}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                      </button>
                      <button onClick={navNext} className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white transition-colors" title={fr ? 'Suivant (Espace)' : 'Next (Space)'}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </button>
                      <button onClick={stopPinNavigation} className="rounded p-1 text-white/30 hover:bg-white/10 hover:text-white/70 transition-colors" title={fr ? 'Fermer (Échap)' : 'Close (Escape)'}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  )}

                  {/* Notes toggle */}
                  <button onClick={toggleNotes}
                    className={`mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-all ${showNotes ? 'bg-white/8 text-white' : 'text-white/30 hover:text-white/50'}`}
                  >
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-all"
                      style={{ borderColor: showNotes ? '#6366f1' : 'rgba(255,255,255,.15)', backgroundColor: showNotes ? '#6366f1' : 'transparent' }}
                    >
                      {showNotes && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                    </span>
                    <span className="text-[12px] font-medium">{fr ? 'Afficher notes' : 'Show notes'}</span>
                  </button>

                  {/* Pins date filter */}
                  <div className="mt-3 border-t border-white/8 pt-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/30">{fr ? 'Pins — Période' : 'Pins — Period'}</p>
                    <div className="flex flex-wrap gap-1">
                      {(['today', 'yesterday', 'this_month', 'this_year', 'all'] as DateFilter[]).map((d) => (
                        <button key={d} onClick={() => setPinDateFilter(d)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all ${pinDateFilter === d ? 'bg-white/12 text-white' : 'text-white/30 hover:text-white/50'}`}
                        >{dateLabels[d]}</button>
                      ))}
                    </div>
                  </div>

                  {/* --- ZONES section --- */}
                  <div className="mt-3 border-t border-white/8 pt-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-indigo-300/50">{fr ? 'Zones' : 'Zones'}</p>

                    {/* Show zones toggle */}
                    <button onClick={() => setShowZones(!showZones)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-all ${showZones ? 'bg-white/8 text-white' : 'text-white/30 hover:text-white/50'}`}
                    >
                      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-all"
                        style={{ borderColor: showZones ? '#6366f1' : 'rgba(255,255,255,.15)', backgroundColor: showZones ? '#6366f1' : 'transparent' }}
                      >
                        {showZones && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                      </span>
                      <span className="text-[12px] font-medium">{fr ? 'Afficher les zones' : 'Show zones'}</span>
                    </button>

                    {/* Zone date filter */}
                    <p className="mb-1.5 mt-2.5 text-[10px] font-medium text-white/25">{fr ? 'Période' : 'Period'}</p>
                    <div className="flex flex-wrap gap-1">
                      {(['today', 'this_month', 'this_year', 'all'] as DateFilter[]).map((d) => (
                        <button key={d} onClick={() => setZoneDateFilter(d)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all ${zoneDateFilter === d ? 'bg-indigo-500/20 text-indigo-300' : 'text-white/30 hover:text-white/50'}`}
                        >{dateLabels[d]}</button>
                      ))}
                    </div>

                    {/* Filter by rep */}
                    <p className="mb-1.5 mt-2.5 text-[10px] font-medium text-white/25">{fr ? 'Par représentant' : 'By rep'}</p>
                    <select
                      value={filterByRep}
                      onChange={(e) => setFilterByRep(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12px] text-white outline-none"
                    >
                      <option value="all">{fr ? 'Tous' : 'All'}</option>
                      {SALES_REPS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>

                  {/* --- REPS section --- */}
                  <div className="mt-3 border-t border-white/8 pt-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-300/50">{fr ? 'Représentants' : 'Reps'}</p>
                    <button onClick={() => setShowReps(!showReps)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-all ${showReps ? 'bg-white/8 text-white' : 'text-white/30 hover:text-white/50'}`}
                    >
                      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-all"
                        style={{ borderColor: showReps ? '#22c55e' : 'rgba(255,255,255,.15)', backgroundColor: showReps ? '#22c55e' : 'transparent' }}
                      >
                        {showReps && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                      </span>
                      <span className="text-[12px] font-medium">{fr ? 'Voir les représentants' : 'Show reps'}</span>
                      <span className="ml-auto text-[10px] font-medium text-emerald-400/60">{liveRepsProp?.length || 0} {fr ? 'en ligne' : 'online'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* BOTTOM CENTER — Select mode action bar                             */}
      {/* ================================================================== */}
      {mode === 'select' && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 z-20 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/10 bg-black/70 px-5 py-3 shadow-2xl backdrop-blur-xl">
            {selectedPinIds.size === 0 ? (
              <span className="text-[13px] text-white/50">{fr ? 'Dessinez un rectangle pour sélectionner des pins' : 'Draw a rectangle to select pins'}</span>
            ) : (
              <>
                <span className="text-[13px] font-medium text-white">
                  {selectedPinIds.size} pin{selectedPinIds.size > 1 ? 's' : ''} {fr ? `sélectionné${selectedPinIds.size > 1 ? 's' : ''}` : 'selected'}
                </span>
                <button onClick={handleBulkDelete}
                  className="flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-[12px] font-semibold text-white shadow-lg shadow-red-500/25 transition-all hover:bg-red-400"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                  Supprimer tout
                </button>
                <button onClick={() => { setSelectedPinIds(new Set()); clearPinHighlights(); }}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[12px] text-white/50 transition-all hover:bg-white/10 hover:text-white/70"
                >
                  Désélectionner
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* Zone confirm modal                                                 */}
      {/* ================================================================== */}
      {showZoneConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-[380px] rounded-2xl border border-white/10 bg-[#0c0c14] p-6 shadow-2xl">
            <h3 className="text-[15px] font-semibold text-white">{fr ? 'Nouvelle zone' : 'New zone'}</h3>
            <p className="mt-1 text-[12px] text-white/40">{drawingPoints.length} {fr ? 'points tracés' : 'points drawn'}</p>

            <div className="mt-4">
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/30">{fr ? 'Nom de la zone' : 'Zone name'}</label>
              <input type="text" value={zoneNameInput} onChange={(e) => setZoneNameInput(e.target.value)}
                placeholder={`Zone ${zonesRef.current.length + 1}`}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white outline-none focus:border-indigo-500/50"
              />
            </div>

            {canAssignZone(CURRENT_USER.role) && (
              <div className="mt-4">
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/30">{fr ? 'Assigner à un représentant' : 'Assign to a rep'}</label>
                <select value={zoneAssignInput} onChange={(e) => setZoneAssignInput(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white outline-none focus:border-indigo-500/50"
                >
                  <option value="">{fr ? 'Non assigné' : 'Unassigned'}</option>
                  {SALES_REPS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            )}

            <div className="mt-6 flex gap-2">
              <button onClick={confirmZone} className="flex-1 rounded-lg bg-indigo-500 py-2.5 text-[12px] font-semibold text-white hover:bg-indigo-400">
                {fr ? 'Créer la zone' : 'Create zone'}
              </button>
              <button onClick={cancelDrawing} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-[12px] text-white/50 hover:bg-white/10">
                {fr ? 'Annuler' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* Zone detail panel                                                  */}
      {/* ================================================================== */}
      {selectedZone && (
        <div className="absolute bottom-4 left-4 z-30 w-[300px] rounded-2xl border border-white/10 bg-black/85 p-5 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedZone.color }} />
                <h3 className="text-[14px] font-semibold text-white">{selectedZone.name}</h3>
              </div>
              <p className="mt-1.5 text-[11px] text-white/40">
                {fr ? 'Assigné à' : 'Assigned to'}: <span className="text-white/60">{selectedZone.assigned_to_name || (fr ? 'Non assigné' : 'Unassigned')}</span>
              </p>
              <p className="mt-1 text-[11px] text-white/30">
                {fr ? 'Créé le' : 'Created'} {new Date(selectedZone.created_at).toLocaleDateString(fr ? 'fr-CA' : 'en-US')}
              </p>
            </div>
            <button onClick={() => setSelectedZone(null)} className="rounded-lg p-1 text-white/30 transition-colors hover:bg-white/10 hover:text-white/60">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          {canAssignZone(CURRENT_USER.role) && (
            <div className="mt-4">
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/30">{fr ? 'Assigné à' : 'Assigned to'}</label>
              <select
                value={selectedZone.assigned_to || ''}
                onChange={(e) => reassignZone(selectedZone.id, e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white outline-none focus:border-indigo-500/50"
              >
                <option value="" className="bg-[#0c0c14]">{fr ? 'Non assigné' : 'Unassigned'}</option>
                {SALES_REPS.map((rep) => (
                  <option key={rep.id} value={rep.id} className="bg-[#0c0c14]">{rep.name}</option>
                ))}
              </select>
            </div>
          )}

          {canDeleteZone(CURRENT_USER.role, selectedZone) && (
            <button onClick={() => deleteZone(selectedZone.id)}
              className="mt-4 w-full rounded-lg border border-red-500/20 bg-red-500/10 py-2 text-[12px] font-medium text-red-400 transition-all hover:bg-red-500/20"
            >
              {fr ? 'Supprimer la zone' : 'Delete zone'}
            </button>
          )}
        </div>
      )}

      {/* ================================================================== */}
      {/* Edit pin modal                                                     */}
      {/* ================================================================== */}
      {editingPin && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-[340px] rounded-2xl border border-white/10 bg-[#0c0c14] p-6 shadow-2xl">
            <h3 className="text-[15px] font-semibold text-white">{fr ? 'Modifier le pin' : 'Edit pin'}</h3>
            <div className="mt-4">
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/30">{fr ? 'Nom' : 'Name'}</label>
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white outline-none focus:border-indigo-500/50" />
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/30">{fr ? 'Téléphone' : 'Phone'}</label>
              <input type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="819-555-0100"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white placeholder-white/20 outline-none focus:border-indigo-500/50" />
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/30">{fr ? 'Courriel' : 'Email'}</label>
              <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="client@email.com"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white placeholder-white/20 outline-none focus:border-indigo-500/50" />
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/30">{fr ? 'Statut' : 'Status'}</label>
              <div className="flex flex-wrap gap-1.5">
                {statuses.map(([key, cfg]) => (
                  <button key={key} onClick={() => setEditStatus(key)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-all ${editStatus === key ? 'border-white/20 bg-white/10 text-white' : 'border-white/5 bg-white/[.02] text-white/40'}`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cfg.color }} />
                    {cfg.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/30">Note</label>
              <textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder={fr ? 'Ajouter une note...' : 'Add a note...'} rows={3}
                className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white placeholder-white/20 outline-none focus:border-indigo-500/50" />
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/30">{fr ? 'Adresse' : 'Address'}</label>
              <p className="text-[12px] text-white/40">{editingPin.address}</p>
            </div>
            <div className="mt-6 flex gap-2">
              <button onClick={handleSaveEdit} className="flex-1 rounded-lg bg-indigo-500 py-2 text-[12px] font-semibold text-white hover:bg-indigo-400">{fr ? 'Sauvegarder' : 'Save'}</button>
              <button onClick={() => setEditingPin(null)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[12px] text-white/50">{fr ? 'Annuler' : 'Cancel'}</button>
              <button onClick={() => { removePin(editingPin.id); setEditingPin(null); }}
                className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-[12px] font-medium text-red-400">{fr ? 'Supprimer' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
