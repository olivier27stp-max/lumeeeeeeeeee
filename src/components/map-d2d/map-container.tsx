import { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  type LeadPinData,
  type PinStatus,
  PIN_STATUS_CONFIG,
  createLeadPinElement,
  createLeadPinPopupHTML,
  popupCloseBtnId,
  popupStatusDotId,
} from './lead-pin';
import { type ZoneData, getZoneColor } from './zone-types';
import { PinClusterManager, type ClusterSourcePoint } from './pin-cluster';
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

// Map base styles — satellite is essential in rural areas where OSM has no
// building footprints (streets-v12 renders nothing where houses aren't mapped).
const STREETS_STYLE = 'mapbox://styles/mapbox/streets-v12';
const SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';
const MAP_STYLE_KEY = 'd2d-map-style';

function loadSavedSatellite(): boolean {
  try { return localStorage.getItem(MAP_STYLE_KEY) === 'satellite'; } catch { return false; }
}

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
  /** Called when a pin is set to lead — should open the agreement/quote/skip choice */
  onPinLead?: (pin: LeadPinData) => void;
  /** Called when the "Open client" popup action is used — resolves + navigates to the client page */
  onOpenClient?: (pin: LeadPinData) => void;
  /** Initial pins to render (loaded from API by parent) */
  initialPins?: LeadPinData[];
  /** Called when a new pin is created on the map */
  onPinCreated?: (pin: LeadPinData) => void;
  /** Called when a pin is deleted; deleteClientId is set when the user also chose to delete the linked client */
  onPinDeleted?: (pinId: string, opts?: { deleteClientId?: string | null }) => void;
  /** Called when a pin is edited */
  onPinUpdated?: (pin: LeadPinData) => void;
  /** Live rep positions (loaded from API by parent) */
  liveReps?: Array<{ user_id: string; user_name: string | null; latitude: number; longitude: number; tracking_status: string; speed_mps: number | null; team_name: string | null; team_color: string | null }>;
  /** Imperative link-id updates by pin id (parent pushes after creating job/quote) */
  pinLinkUpdates?: Record<string, { job_id?: string | null; quote_id?: string | null; client_id?: string | null; lead_id?: string | null }>;
  /** Deep-link focus [lng, lat] — the map opens centered on this point and GPS won't re-center away from it */
  focusCenter?: [number, number] | null;
}

export function MapContainer({ onPinClosedWon, onPinLead, onOpenClient, initialPins, onPinCreated, onPinDeleted, onPinUpdated, liveReps: liveRepsProp, pinLinkUpdates, focusCenter = null }: MapContainerProps = {}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // Stable refs for callbacks (avoids stale closure in map click handler)
  const onPinClosedWonRef = useRef(onPinClosedWon);
  onPinClosedWonRef.current = onPinClosedWon;
  const onPinLeadRef = useRef(onPinLead);
  onPinLeadRef.current = onPinLead;
  const onOpenClientRef = useRef(onOpenClient);
  onOpenClientRef.current = onOpenClient;
  const onPinCreatedRef = useRef(onPinCreated);
  onPinCreatedRef.current = onPinCreated;
  const onPinDeletedRef = useRef(onPinDeleted);
  onPinDeletedRef.current = onPinDeleted;
  const focusCenterRef = useRef(focusCenter);
  focusCenterRef.current = focusCenter;
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
  const [gpsEnabling, setGpsEnabling] = useState(false);
  // Permission hard-blocked at the browser level: getCurrentPosition fails
  // instantly without re-prompting, so "Enable" must show unblock steps instead.
  const [gpsBlocked, setGpsBlocked] = useState(false);
  const [, forceUpdate] = useState(0);

  // --- Filters ---
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<PinStatus>>(
    new Set(['closed_won', 'lead', 'follow_up', 'appointment', 'no_answer', 'rejected', 'other'])
  );
  const [showNotes, setShowNotes] = useState(true);
  const [pinDateFilter, setPinDateFilter] = useState<DateFilter>('all');
  const [showZones, setShowZones] = useState(true);
  const [satellite, setSatellite] = useState(loadSavedSatellite);
  const [zoneDateFilter, setZoneDateFilter] = useState<DateFilter>('all');
  const [filterByRep, setFilterByRep] = useState<string>('all');
  const [showReps, setShowReps] = useState(true);
  const repMarkersRef = useRef(new Map<string, mapboxgl.Marker>());

  // --- Clustering (regroupement progressif au dézoom) ---
  const clusterMgrRef = useRef<PinClusterManager | null>(null);
  // Pins couverts par un cluster au zoom courant — masqués par applyPinVisibility
  const clusteredIdsRef = useRef<Set<string>>(new Set());
  // Répliques stables pour les callbacks hors-React (événements carte)
  const activeFiltersRef = useRef(activeFilters);
  activeFiltersRef.current = activeFilters;
  const applyPinVisibilityRef = useRef<() => void>(() => {});
  applyPinVisibilityRef.current = () => applyPinVisibility();
  const clusterRebuildQueuedRef = useRef(false);

  // --- Boussole ---
  const [compassBearing, setCompassBearing] = useState(0);

  // --- Select mode refs ---
  const selectBoxRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);

  // --- Delete confirmation (single pin, or bulk selection) ---
  const [pinPendingDelete, setPinPendingDelete] = useState<LeadPinData | null>(null);
  const [bulkDeletePending, setBulkDeletePending] = useState(false);
  const [deleteLinkedClient, setDeleteLinkedClient] = useState(false);

  // --- Edit modal ---
  const [editingPin, setEditingPin] = useState<LeadPinData | null>(null);
  // "Log prospecting pin" action modal. Two modes:
  //  - isNew=true: a draft pin with no DB row yet → choosing an outcome
  //    creates the pin automatically with the right status. (No longer
  //    reachable from a map click — empty-map clicks are intentionally inert.)
  //  - isNew=false: clicked an existing pin → choosing an outcome updates it.
  const [actionPin, setActionPin] = useState<LeadPinData | null>(null);
  const [actionIsNew, setActionIsNew] = useState(false);
  // Locally-created pins (visit log / add-pin) — exempt from the reconcile
  // sweep, since they aren't in initialPins until the next full reload.
  const localPinIdsRef = useRef(new Set<string>());
  // The live instance listens for map clicks (dispatched as a DOM event from
  // the map handler) and opens the modal. Using an event decouples us from
  // which component instance owns the Mapbox map under StrictMode remounts.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ pin: LeadPinData; isNew?: boolean }>).detail;
      if (!detail?.pin) return;
      setActionPin(detail.pin);
      setActionIsNew(!!detail.isNew);
      // New visit: resolve the real street address in the background
      if (detail.isNew) {
        const token = import.meta.env.VITE_MAPBOX_TOKEN;
        if (token) {
          fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${detail.pin.lng},${detail.pin.lat}.json?access_token=${token}&language=fr&limit=1`)
            .then((r) => r.json())
            .then((data) => {
              const place = data?.features?.[0];
              if (!place) return;
              setActionPin((prev) => (prev && prev.id === detail.pin.id
                ? { ...prev, address: place.place_name || prev.address, name: place.text || prev.name }
                : prev));
            })
            .catch(() => {});
        }
      }
    };
    window.addEventListener('d2d:open-pin-modal', handler);
    return () => window.removeEventListener('d2d:open-pin-modal', handler);
  }, []);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editStatus, setEditStatus] = useState<PinStatus>('closed_won');
  const [editNote, setEditNote] = useState('');

  // --- Lume ---
  // CRM actions handled via props callbacks

  // --- Street search (spotlight modal) ---
  const RECENT_SEARCHES_KEY = 'lume.d2d.recent-searches';
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; place_name: string; center: [number, number] }>>([]);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchHighlight, setSearchHighlight] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<Array<{ id: string; place_name: string; center: [number, number] }>>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]'); } catch { return []; }
  });
  const searchTimerRef = useRef<number | null>(null);

  const selectSearchResult = (r: { id: string; place_name: string; center: [number, number] }) => {
    mapRef.current?.flyTo({ center: r.center, zoom: 17, duration: 800 });
    setRecentSearches((prev) => {
      const next = [r, ...prev.filter((p) => p.place_name !== r.place_name)].slice(0, 8);
      try { localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)); } catch { /* quota/private mode */ }
      return next;
    });
    setSearchModalOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSearchHighlight(-1);
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
    try { localStorage.removeItem(RECENT_SEARCHES_KEY); } catch { /* ignore */ }
  };

  // ⌘K / Ctrl+K toggles the search spotlight, Escape closes it
  useEffect(() => {
    function onSearchKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchModalOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setSearchModalOpen(false);
      }
    }
    window.addEventListener('keydown', onSearchKey);
    return () => window.removeEventListener('keydown', onSearchKey);
  }, []);

  // --- Pin navigation (Find & Replace style) ---
  const [navigatingStatus, setNavigatingStatus] = useState<PinStatus | null>(null);
  const [navIndex, setNavIndex] = useState(0);
  const navPinsRef = useRef<LeadPinData[]>([]);
  const prevHighlightRef = useRef<HTMLElement | null>(null);

  /** Collect all visible pins matching a status, sorted by distance from map center */
  function getNavPins(status: PinStatus): LeadPinData[] {
    const center = mapRef.current?.getCenter();
    const pins: LeadPinData[] = [];
    // Basé sur les filtres plutôt que sur le display : un pin regroupé dans un
    // cluster reste navigable — le vol (zoom ≥ 17) le fera réapparaître.
    if (!activeFilters.has(status)) return pins;
    markersRef.current.forEach(({ pin }) => {
      if (pin.status === status) pins.push(pin);
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
    const f = filters ?? activeFiltersRef.current;
    const notesOn = containerRef.current?.dataset.showNotes === 'true';
    markersRef.current.forEach(({ pin, marker, noteMarker }) => {
      // Un pin couvert par un cluster est temporairement masqué — ses données,
      // son statut et ses interactions restent intacts.
      let visible = f.has(pin.status) && !clusteredIdsRef.current.has(pin.id);
      if (visible && pinDateFilter !== 'all') {
        // pins don't have created_at in the current schema, always show for date filter
      }
      // 'flex', pas '' : le style inline du pin (createLeadPinElement) centre
      // l'icône via display:flex — '' le retomberait en block et l'icône se
      // collerait en haut à gauche du rond après un passage masqué→visible.
      marker.getElement().style.display = visible ? 'flex' : 'none';
      if (noteMarker) {
        noteMarker.getElement().style.display = (visible && notesOn) ? '' : 'none';
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Clustering — l'index n'est reconstruit que sur mutation des pins/filtres
  // ---------------------------------------------------------------------------
  function rebuildClusters(filters?: Set<PinStatus>) {
    const mgr = clusterMgrRef.current;
    if (!mgr) return;
    const f = filters ?? activeFiltersRef.current;
    const pts: ClusterSourcePoint[] = [];
    markersRef.current.forEach(({ pin }) => {
      if (f.has(pin.status)) pts.push({ id: pin.id, lng: pin.lng, lat: pin.lat });
    });
    mgr.setData(pts);
  }

  /** Reconstruction déduplicée en microtâche — placePin en boucle reste O(n). */
  function scheduleClusterRebuild() {
    if (clusterRebuildQueuedRef.current) return;
    clusterRebuildQueuedRef.current = true;
    queueMicrotask(() => {
      clusterRebuildQueuedRef.current = false;
      rebuildClusters();
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
  // Base style toggle (plan / satellite)
  // ---------------------------------------------------------------------------
  function toggleSatellite() {
    const map = mapRef.current;
    if (!map) return;
    const next = !satellite;
    setSatellite(next);
    try { localStorage.setItem(MAP_STYLE_KEY, next ? 'satellite' : 'streets'); } catch {}
    map.setStyle(next ? SATELLITE_STYLE : STREETS_STYLE);
    // setStyle wipes every custom source/layer (zones, drawing preview) —
    // DOM markers (pins, GPS dot, reps) survive. Re-add layers once the new
    // style is ready.
    map.once('style.load', () => {
      renderZonesOnMap();
      if (drawingPoints.length >= 2) renderDrawingPreview(map, drawingPoints);
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
        const visible = activeFilters.has(pin.status) && !clusteredIdsRef.current.has(pin.id) && next;
        noteMarker.getElement().style.display = visible ? '' : 'none';
      });
      return next;
    });
  }

  function toggleFilter(status: PinStatus) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      activeFiltersRef.current = next;
      applyPinVisibility(next);
      rebuildClusters(next);
      return next;
    });
  }

  function removePin(id: string, opts?: { deleteClientId?: string | null }) {
    const rec = markersRef.current.get(id);
    if (!rec) return;
    rec.marker.remove();
    if (rec.noteMarker) rec.noteMarker.remove();
    markersRef.current.delete(id);
    scheduleClusterRebuild();
    bump();
    // Notify parent to delete from DB
    onPinDeletedRef.current?.(id, opts);
  }

  /** Open the delete confirmation for a single pin (popup ✕ or edit modal). */
  function requestPinDelete(pin: LeadPinData) {
    setDeleteLinkedClient(false);
    setBulkDeletePending(false);
    setPinPendingDelete(pin);
  }

  function cancelPinDelete() {
    setPinPendingDelete(null);
    setBulkDeletePending(false);
    setDeleteLinkedClient(false);
  }

  function confirmPinDelete() {
    if (pinPendingDelete) {
      const clientId = pinPendingDelete.client_id || pinPendingDelete.lead_id || null;
      removePin(pinPendingDelete.id, deleteLinkedClient && clientId ? { deleteClientId: clientId } : undefined);
    } else if (bulkDeletePending) {
      selectedPinIds.forEach((id) => removePin(id)); // each removePin calls onPinDeleted
      exitSelectMode();
    }
    cancelPinDelete();
  }

  function placePin(map: mapboxgl.Map, pin: LeadPinData) {
    // Idempotent: if a marker for this pin already exists, remove it first so
    // re-renders/remounts never stack duplicate (ghost) markers on the map.
    const existing = markersRef.current.get(pin.id);
    if (existing) {
      existing.marker.remove();
      existing.noteMarker?.remove();
      markersRef.current.delete(pin.id);
    }
    const el = createLeadPinElement(pin.status);
    const editId = `e-${pin.id}`;
    const delId = `d-${pin.id}`;
    const clientId = `client-${pin.id}`;

    const popup = new mapboxgl.Popup({
      offset: 18, closeButton: false, closeOnClick: true, maxWidth: '320px', className: 'fp-popup', anchor: 'bottom',
    });

    function refreshPopupHTML() {
      const current = markersRef.current.get(pin.id)?.pin || pin;
      popup.setHTML(createLeadPinPopupHTML(current, editId, delId, fr ? 'fr' : 'en', clientId));
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
              const current = markersRef.current.get(pin.id)?.pin || pin;
              popup.remove();
              requestPinDelete(current);
            };
          }
          const closeBtn = document.getElementById(popupCloseBtnId(pin.id));
          if (closeBtn) {
            closeBtn.onclick = (e) => {
              e.stopPropagation();
              popup.remove();
            };
          }
          // Pastilles de statut — un tap change le statut (même mécanique que le
          // modal Modifier). Re-taper Vendu/Lead sans job/devis relance le flow CRM.
          (Object.keys(PIN_STATUS_CONFIG) as PinStatus[]).forEach((st) => {
            const dot = document.getElementById(popupStatusDotId(pin.id, st));
            if (dot) {
              dot.onclick = (e) => {
                e.stopPropagation();
                const current = markersRef.current.get(pin.id)?.pin || pin;
                if (current.status === st && st !== 'closed_won' && st !== 'lead') return;
                popup.remove();
                applyPinStatus(current, st);
              };
            }
          });
          const clientBtn = document.getElementById(clientId);
          if (clientBtn) {
            clientBtn.onclick = (e) => {
              e.stopPropagation();
              const current = markersRef.current.get(pin.id)?.pin || pin;
              popup.remove();
              onOpenClientRef.current?.(current);
            };
          }
        }, 50);
      });
    });

    // Pin clicks are handled by the map's own 'click' handler (nearest-pin
    // hit test in the view-mode branch), which fires reliably regardless of
    // marker z-index / canvas stacking. Just show the pointer cursor here.
    el.style.cursor = 'pointer';

    const marker = new mapboxgl.Marker({ element: el })
      .setLngLat([pin.lng, pin.lat])
      .addTo(map);
    void popup;

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
    scheduleClusterRebuild();
    bump();
    savePins();
  }

  // ---------------------------------------------------------------------------
  // Init map
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    // Synchronous guard against StrictMode's double-invoke: the map is built in
    // an async IIFE, so mapRef.current isn't set until later and can't block the
    // second pass. Mark the container element synchronously here — the second
    // effect sees the flag and bails before creating a second stacked map.
    if (container.dataset.mapInit === '1') return;
    container.dataset.mapInit = '1';
    // If a previous map left DOM behind (HMR / fast remount), empty the
    // container so Mapbox doesn't warn and lose interactivity.
    container.querySelectorAll('.mapboxgl-map').forEach((n) => n.remove());

    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) { setShowTokenMsg(true); return; }
    mapboxgl.accessToken = token;

    const fallback: [number, number] = [-72.5485, 46.343];

    function initMap(center: [number, number], startZoom: number) {
      const map = new mapboxgl.Map({
        container: containerRef.current!,
        style: loadSavedSatellite() ? SATELLITE_STYLE : STREETS_STYLE,
        center, zoom: startZoom, maxZoom: 22, minZoom: 1, antialias: true, attributionControl: false,
        // Disabled: default double-click zooms a full level. We handle dblclick
        // ourselves below for a lighter zoom-in (view mode only).
        doubleClickZoom: false,
      });
      // Assign the ref IMMEDIATELY (not in the async 'load' handler). Otherwise,
      // under StrictMode's mount→unmount→remount, the cleanup runs before 'load'
      // fires, sees mapRef.current === null, and never removes this map — leaving
      // a second orphaned map stacked in the container that swallows pin clicks.
      mapRef.current = map;

      map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
      // GeolocateControl removed — it created a duplicate GPS dot.
      // Map is already centered on user position via getCurrentPosition in the init flow.
      // A manual "re-center" button is added in the UI instead.
      map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100 }), 'bottom-left');

      map.on('load', () => {
        // If StrictMode already tore this effect down, this map is orphaned —
        // remove it so it can't stack a ghost canvas over the live map's pins.
        if (disposed) { map.remove(); return; }
        setMapReady(true);

        // Clear any stale caches
        try { localStorage.removeItem('d2d-map-pins'); localStorage.removeItem('d2d-map-zones'); } catch {}

        // Pins are placed by the [initialPins, mapReady] effect (which guards
        // against duplicates). No placePin loop here — it had no dedupe guard
        // and stacked duplicate markers that swallowed clicks.

        // Zone hover tooltip
        map.on('mousemove', (e) => {
          const features = map.queryRenderedFeatures(e.point).filter((f) => f.layer?.id?.startsWith('zone-fill-'));
          map.getCanvas().style.cursor = features.length > 0 && mode === 'view' ? 'pointer' : (mode === 'draw_zone' || mode === 'add_pin' || mode === 'select' ? 'crosshair' : '');
        });

        // Map click — pin / zone / draw / add-pin
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
            localPinIdsRef.current.add(id);
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
                // Trigger CRM flow based on pin status (Vendu + Lead only)
                if (finalPin.status === 'closed_won') onPinClosedWonRef.current?.(finalPin);
                if (finalPin.status === 'lead') onPinLeadRef.current?.(finalPin);
              }).catch(() => {
                onPinCreatedRef.current?.(pin);
                if (pin.status === 'closed_won') onPinClosedWonRef.current?.(pin);
                if (pin.status === 'lead') onPinLeadRef.current?.(pin);
              });
            return;
          }

          // View mode — pin click only. Clicking empty map does nothing
          // (no visit modal, no pin placement — pins are created via the
          // add-pin button).
          if (containerRef.current?.dataset.mapMode === 'view') {
            // Clic/tap sur un cluster → zoom d'exploration vers son contenu.
            // Jamais de sélection de client, jamais de popup.
            const clusterHit = clusterMgrRef.current?.findClusterAt(e.point);
            if (clusterHit) {
              clusterMgrRef.current!.zoomToCluster(clusterHit);
              return;
            }
            // Find the nearest pin to the click point (screen space). This is
            // the reliable path: the map's own click always fires, regardless
            // of marker z-index / canvas stacking that can eat DOM clicks.
            let nearest: LeadPinData | null = null;
            let nearestDist = Infinity;
            const HIT_RADIUS_PX = 22;
            markersRef.current.forEach(({ pin, marker }) => {
              // Pins masqués (regroupés dans un cluster ou filtrés) : inertes.
              if (marker.getElement().style.display === 'none') return;
              const p = map.project([pin.lng, pin.lat]);
              const d = Math.hypot(p.x - e.point.x, p.y - e.point.y);
              if (d < nearestDist) { nearestDist = d; nearest = pin; }
            });
            if (nearest && nearestDist <= HIT_RADIUS_PX) {
              window.dispatchEvent(new CustomEvent('d2d:open-pin-modal', { detail: { pin: nearest, isNew: false } }));
            }
          }
        });

        // Double-click on empty map — slight zoom in, centered on the click.
        // Lighter than the default doubleClickZoom (disabled in map options),
        // and only in view mode so drawing/add-pin flows are unaffected.
        map.on('dblclick', (e) => {
          if (containerRef.current?.dataset.mapMode !== 'view') return;
          // Sur un cluster, le clic simple gère déjà le zoom d'exploration.
          if (clusterMgrRef.current?.findClusterAt(e.point)) return;
          const HIT_RADIUS_PX = 22;
          let onPin = false;
          markersRef.current.forEach(({ pin, marker }) => {
            if (marker.getElement().style.display === 'none') return;
            const p = map.project([pin.lng, pin.lat]);
            if (Math.hypot(p.x - e.point.x, p.y - e.point.y) <= HIT_RADIUS_PX) onPin = true;
          });
          if (onPin) return;
          map.easeTo({ zoom: map.getZoom() + 0.5, around: e.lngLat, duration: 350 });
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

    // When the user's location is off (permission hard-denied or no
    // geolocation API), no blue dot is coming: ignore the cached position and
    // open on a from-space globe view instead of a misleading zoomed-in
    // region — the user dives onto their pins themselves. The permission
    // lookup resolves in ~1ms, so the map still appears instantly.
    let disposed = false;
    (async () => {
      let locationOff = !navigator.geolocation;
      try {
        const st = await navigator.permissions?.query?.({ name: 'geolocation' as PermissionName });
        if (st?.state === 'denied') locationOff = true;
      } catch {}
      if (disposed || !containerRef.current) return;

      // Open immediately — on the deep-link focus point if one is set, else the
      // cached user position, else from space over the pins' region. The map
      // never waits on the GPS lookup to render.
      const focus = focusCenterRef.current;
      const useCache = !locationOff && !!cached;
      const map = initMap(
        focus ?? (useCache ? cached! : fallback),
        focus ? 18 : useCache ? 17 : locationOff ? 1.3 : 14,
      );
      if (useCache) {
        const c = cached!;
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

      if (locationOff) setGpsDenied(true);
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setGpsDenied(false);
            const { longitude: lng, latitude: lat } = pos.coords;
            // Smooth fly-in if we already opened near the user (cache) or from
            // the space view; otherwise jump straight to them so we don't
            // animate across the whole region. With an active deep-link focus,
            // keep the camera on the focused pin and only drop/remember the dot.
            const apply = () => {
              if (focusCenterRef.current) {
                placeGpsDot(map, lng, lat);
                try { localStorage.setItem('d2d-last-gps', JSON.stringify({ lng, lat })); } catch {}
              } else {
                centerOnUser(lng, lat, useCache || locationOff);
              }
            };
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
    })();

    return () => {
      disposed = true;
      if (gpsWatchRef.current != null) { navigator.geolocation.clearWatch(gpsWatchRef.current); gpsWatchRef.current = null; }
      if (gpsMarkerRef.current) { gpsMarkerRef.current.remove(); gpsMarkerRef.current = null; }
      // Clear pin markers so a remount rebuilds them fresh (no stacked duplicates).
      markersRef.current.forEach(({ marker, noteMarker }) => { marker.remove(); noteMarker?.remove(); });
      markersRef.current.clear();
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      // Release the synchronous init guard so a real remount can rebuild.
      if (container) delete container.dataset.mapInit;
      setMapReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // mapReady is used by other effects below
  const [mapReady, setMapReady] = useState(false);

  // Place pins whenever they arrive. The map's 'load' handler only sees the
  // pins that existed at load time; the API usually resolves AFTER load, so
  // without this effect the pins (and their click handlers) are never created.
  // Reconciles markers to exactly match initialPins:
  //  - removes markers whose pin is no longer present (stops ghost buildup),
  //  - places pins that aren't on the map yet (placePin is idempotent).
  // Also sweeps any orphaned .mapboxgl-marker DOM nodes left by a dead
  // StrictMode/HMR instance that aren't tracked in markersRef.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const wanted = new Set((initialPins ?? []).map((p) => p.id));

    // Remove tracked markers that are no longer wanted — but keep pins the
    // user just created locally (visit log / add-pin), which aren't in
    // initialPins until the next full reload.
    markersRef.current.forEach((rec, id) => {
      if (!wanted.has(id) && !localPinIdsRef.current.has(id)) {
        rec.marker.remove();
        rec.noteMarker?.remove();
        markersRef.current.delete(id);
      }
    });

    // Sweep orphaned pin-marker DOM nodes that no tracked marker owns. Preserve
    // GPS dot, rep markers, and zone-drawing markers (all also .mapboxgl-marker).
    const tracked = new Set<HTMLElement>();
    markersRef.current.forEach((rec) => { tracked.add(rec.marker.getElement()); if (rec.noteMarker) tracked.add(rec.noteMarker.getElement()); });
    if (gpsMarkerRef.current) tracked.add(gpsMarkerRef.current.getElement());
    repMarkersRef.current.forEach((m) => tracked.add(m.getElement()));
    drawingMarkersRef.current.forEach((m) => tracked.add(m.getElement()));
    clusterMgrRef.current?.trackedElements().forEach((el) => tracked.add(el));
    map.getContainer().querySelectorAll('.mapboxgl-marker').forEach((node) => {
      const el = node as HTMLElement;
      if (!tracked.has(el)) el.remove();
    });

    // Place any missing pins.
    (initialPins ?? []).forEach((pin) => {
      if (!markersRef.current.has(pin.id)) placePin(map, pin);
    });

    // Réconciliation terminée → index de clustering à jour en un seul rebuild.
    rebuildClusters();
  }, [initialPins, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clustering progressif — le gestionnaire vit tant que la carte existe.
  // Il rapporte quels pins sont couverts par un cluster ; la visibilité est
  // appliquée ici, au même endroit que les filtres (un seul écrivain).
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const mgr = new PinClusterManager(map, {
      label: (n) => (fr ? `${n} emplacements regroupés` : `${n} grouped locations`),
      onChange: (clustered, reveals) => {
        clusteredIdsRef.current = clustered;
        applyPinVisibilityRef.current();
        // Divergence : les pins révélés par un split partent du centre de
        // leur cluster parent vers leur position réelle.
        reveals.forEach((from, id) => {
          const rec = markersRef.current.get(id);
          if (rec && rec.marker.getElement().style.display !== 'none') {
            mgr.animatePinReveal(rec.marker, from);
          }
        });
      },
    });
    clusterMgrRef.current = mgr;
    rebuildClusters();
    return () => {
      if (clusterMgrRef.current === mgr) clusterMgrRef.current = null;
      clusteredIdsRef.current = new Set();
      mgr.destroy();
    };
  }, [mapReady, fr]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow deep-link focus changes once the map is up (covers the case where
  // the URL's lat/lng change while the map page is already mounted).
  const focusLng = focusCenter?.[0];
  const focusLat = focusCenter?.[1];
  useEffect(() => {
    if (focusLng == null || focusLat == null) return;
    if (!mapReady || !mapRef.current) return;
    mapRef.current.flyTo({ center: [focusLng, focusLat], zoom: 18, duration: 900 });
  }, [focusLng, focusLat, mapReady]);

  // Boussole — suit la rotation de la carte
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const onRotate = () => setCompassBearing(map.getBearing());
    map.on('rotate', onRotate);
    return () => { map.off('rotate', onRotate); };
  }, [mapReady]);

  // Debounced street search via Mapbox geocoding
  useEffect(() => {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchResults([]); return; }
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
    }, 200);
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

    // Trigger CRM action if status changed to a CRM-linked status (Vendu + Lead only)
    if (statusChanged || (!updated.job_id && newStatus === 'closed_won') || (!updated.job_id && !updated.quote_id && newStatus === 'lead')) {
      if (newStatus === 'closed_won' && !updated.job_id && onPinClosedWonRef.current) onPinClosedWonRef.current(updated);
      if (newStatus === 'lead' && !updated.job_id && !updated.quote_id && onPinLeadRef.current) onPinLeadRef.current(updated);
    }
  }

  // (Lume handlers removed — CRM actions handled via onPinClosedWon/onPinLead callbacks)

  // ---------------------------------------------------------------------------
  // Quick status change from the "Log prospecting pin" action modal.
  // Same mechanics as handleSaveEdit: swap the marker, persist, fire CRM action.
  // ---------------------------------------------------------------------------
  function applyPinStatus(pin: LeadPinData, newStatus: PinStatus) {
    if (!mapRef.current) return;
    const current = markersRef.current.get(pin.id)?.pin || pin;
    const statusChanged = current.status !== newStatus;
    const rec = markersRef.current.get(pin.id);
    if (rec) { rec.marker.remove(); if (rec.noteMarker) rec.noteMarker.remove(); markersRef.current.delete(pin.id); }
    const updated: LeadPinData = { ...current, status: newStatus };
    placePin(mapRef.current, updated);
    setActionPin(null);

    // Persist the update
    onPinUpdatedRef.current?.(updated);

    // Fire CRM action when the new status is CRM-linked (Vendu + Lead only)
    if (newStatus === 'closed_won' && !updated.job_id && onPinClosedWonRef.current) onPinClosedWonRef.current(updated);
    else if (newStatus === 'lead' && !updated.job_id && !updated.quote_id && onPinLeadRef.current) onPinLeadRef.current(updated);

    void statusChanged;
  }

  // ---------------------------------------------------------------------------
  // New visit logged from the modal (house clicked with no pin yet):
  // create the pin with the chosen status, persist it, fire the CRM action.
  // ---------------------------------------------------------------------------
  function createVisitPin(pin: LeadPinData, newStatus: PinStatus) {
    if (!mapRef.current) return;
    const created: LeadPinData = { ...pin, status: newStatus };
    localPinIdsRef.current.add(created.id);
    placePin(mapRef.current, created);
    setActionPin(null);

    // Persist (parent creates the house/pin server-side)
    onPinCreatedRef.current?.(created);

    // CRM flow: closed won → create Job, lead → agreement/quote/skip choice
    if (newStatus === 'closed_won' && onPinClosedWonRef.current) onPinClosedWonRef.current(created);
    else if (newStatus === 'lead' && onPinLeadRef.current) onPinLeadRef.current(created);
  }

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
    if (selectedPinIds.size === 0) return;
    setPinPendingDelete(null);
    setDeleteLinkedClient(false);
    setBulkDeletePending(true); // actual removal happens in confirmPinDelete
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const statuses = Object.entries(PIN_STATUS_CONFIG) as [PinStatus, (typeof PIN_STATUS_CONFIG)[PinStatus]][];

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
          background: #ffffff !important;
          border: 1px solid rgba(20,24,40,.09) !important;
          border-radius: 18px !important;
          padding: 14px 14px 12px !important;
          box-shadow: 0 22px 55px rgba(20,25,50,.2), 0 4px 14px rgba(20,25,50,.12) !important;
        }
        .fp-popup .mapboxgl-popup-tip { border-top-color: #ffffff !important; }
        .fp-popup .ppq:hover, .fp-popup .ppx:hover { background: #e5e7ee !important; }
        .fp-popup .ppcc:hover { background: #eae6dc !important; }
        .fp-popup .pped:hover { background: #2b2f40 !important; border-color: #2b2f40 !important; }
        .fp-popup .ppdel:hover { background: #e5e7ee !important; color: #dc2626 !important; }
        .fp-popup .ppsd { transition: opacity .15s, transform .15s; }
        .fp-popup .ppsd:hover { opacity: .85 !important; }
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
        @keyframes d2dSearchIn { from { opacity: 0; transform: translateY(-10px) scale(.97); } to { opacity: 1; transform: none; } }
        @keyframes d2dSearchBackdrop { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {/* Selection rectangle overlay */}
      <div ref={selectBoxRef} className="pointer-events-none absolute z-20 rounded border-2 border-red-400/60 bg-red-500/15" style={{ display: 'none' }} />

      {/* ================================================================== */}
      {/* RIGHT EDGE — Toolbar (boxes blanches, icônes rouges)               */}
      {/* ================================================================== */}
      {!showTokenMsg && (
        <div className="pointer-events-auto absolute right-3 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-2">
          {/* Box 1 — Pin : ajouter un pin (toolbar de statuts en bas) */}
          <button
            onClick={() => setMode(mode === 'add_pin' ? 'view' : 'add_pin')}
            className={`flex h-11 w-11 items-center justify-center rounded-xl shadow-lg transition-all hover:scale-105 ${mode === 'add_pin' ? 'bg-red-600 text-white shadow-red-600/40' : 'bg-white text-red-600 shadow-black/30 hover:bg-red-50'}`}
            title={fr ? (mode === 'add_pin' ? "Annuler l'ajout de pin" : 'Ajouter un pin') : (mode === 'add_pin' ? 'Cancel pin placement' : 'Add a pin')}
            aria-label={fr ? 'Ajouter un pin' : 'Add a pin'}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
            </svg>
          </button>

          {/* Box 2 — Entonnoir : filtrer les pins */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex h-11 w-11 items-center justify-center rounded-xl shadow-lg transition-all hover:scale-105 ${showFilters ? 'bg-red-600 text-white shadow-red-600/40' : 'bg-white text-red-600 shadow-black/30 hover:bg-red-50'}`}
            title={fr ? 'Filtrer les pins' : 'Filter pins'}
            aria-label={fr ? 'Filtres' : 'Filters'}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </button>
          {/* Box 3 — Loupe : recherche */}
          <button
            onClick={() => setSearchModalOpen(true)}
            className={`flex h-11 w-11 items-center justify-center rounded-xl shadow-lg transition-all hover:scale-105 ${searchModalOpen ? 'bg-red-600 text-white shadow-red-600/40' : 'bg-white text-red-600 shadow-black/30 hover:bg-red-50'}`}
            title={fr ? 'Rechercher une adresse (⌘K)' : 'Search an address (⌘K)'}
            aria-label={fr ? 'Rechercher' : 'Search'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>

          {/* Box 4 — Doigt qui trace : création de zone */}
          {canCreateZone(CURRENT_USER.role) && (
            <button
              onClick={() => {
                if (mode === 'draw_zone') cancelDrawing();
                else { setMode('draw_zone'); setDrawingPoints([]); }
              }}
              className={`flex h-11 w-11 items-center justify-center rounded-xl shadow-lg transition-all hover:scale-105 ${mode === 'draw_zone' ? 'bg-red-600 text-white shadow-red-600/40' : 'bg-white text-red-600 shadow-black/30 hover:bg-red-50'}`}
              title={fr ? 'Créer une zone' : 'Create a zone'}
              aria-label={fr ? 'Créer une zone' : 'Create a zone'}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 5.5c1-2 4-3.2 6-2.7" strokeDasharray="1 2.6" />
                <path d="M22 14a8 8 0 0 1-8 8" />
                <path d="M18 11v-1a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
                <path d="M14 10V9a2 2 0 0 0-2-2 2 2 0 0 0-2 2v1" />
                <path d="M10 9.5V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v10" />
                <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
              </svg>
            </button>
          )}

          {/* Box 5 — Sélection rectangle : sélectionner des pins */}
          <button
            onClick={() => { if (mode === 'select') exitSelectMode(); else enterSelectMode(); }}
            className={`flex h-11 w-11 items-center justify-center rounded-xl shadow-lg transition-all hover:scale-105 ${mode === 'select' ? 'bg-red-600 text-white shadow-red-600/40' : 'bg-white text-red-600 shadow-black/30 hover:bg-red-50'}`}
            title={fr ? (mode === 'select' ? 'Annuler la sélection' : 'Sélectionner des pins') : (mode === 'select' ? 'Cancel selection' : 'Select pins')}
            aria-label={fr ? 'Sélectionner' : 'Select'}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3a2 2 0 0 0-2 2" /><path d="M19 3a2 2 0 0 1 2 2" /><path d="M21 19a2 2 0 0 1-2 2" /><path d="M5 21a2 2 0 0 1-2-2" />
              <path d="M9 3h1" /><path d="M9 21h1" /><path d="M14 3h1" /><path d="M14 21h1" /><path d="M3 9v1" /><path d="M3 14v1" /><path d="M21 9v1" /><path d="M21 14v1" />
            </svg>
          </button>

          {/* Box 6 — Plan plié : bascule plan / satellite */}
          <button
            onClick={toggleSatellite}
            className={`flex h-11 w-11 items-center justify-center rounded-xl shadow-lg transition-all hover:scale-105 ${satellite ? 'bg-red-600 text-white shadow-red-600/40' : 'bg-white text-red-600 shadow-black/30 hover:bg-red-50'}`}
            title={fr ? (satellite ? 'Passer en vue plan' : 'Passer en vue satellite') : (satellite ? 'Switch to map view' : 'Switch to satellite view')}
            aria-label={fr ? 'Changer le style de carte' : 'Toggle map style'}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
              <path d="M15 5.764v15" /><path d="M9 3.236v15" />
            </svg>
          </button>

          {/* Box 7 — Boussole (ronde) : indique le nord, clic = réaligner */}
          <button
            onClick={() => mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 600 })}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black shadow-lg shadow-black/30 transition-all hover:scale-105"
            title={fr ? 'Boussole — cliquer pour réaligner au nord' : 'Compass — click to reset north'}
            aria-label={fr ? 'Boussole' : 'Compass'}
          >
            <svg width="27" height="27" viewBox="0 0 24 24" style={{ transform: `rotate(${-compassBearing}deg)`, transition: 'transform .2s ease-out' }}>
              <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M12 3.6v1.5M12 18.9v1.5M3.6 12h1.5M18.9 12h1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              <path d="M12 5.6l2.1 6.4H9.9z" fill="#dc2626" />
              <path d="M12 18.4L9.9 12h4.2z" fill="currentColor" />
              <circle cx="12" cy="12" r="1.1" fill="white" stroke="currentColor" strokeWidth=".7" />
            </svg>
          </button>
        </div>
      )}

      {/* Street search — spotlight modal */}
      {!showTokenMsg && searchModalOpen && (() => {
        const searchTyping = searchQuery.trim().length >= 2;
        const searchList = searchTyping ? searchResults : recentSearches;
        return (
          <div
            className="absolute inset-0 z-40 flex items-start justify-center bg-black/50 px-4 pt-[14vh] backdrop-blur-[3px]"
            style={{ animation: 'd2dSearchBackdrop .15s ease-out' }}
            onMouseDown={() => setSearchModalOpen(false)}
          >
            <div
              className="w-[min(560px,100%)] overflow-hidden rounded-2xl border border-white/10 bg-[#0c0c14]/95 shadow-[0_24px_80px_rgba(0,0,0,.65)] backdrop-blur-2xl"
              style={{ animation: 'd2dSearchIn .18s cubic-bezier(.2,.9,.3,1)' }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="relative border-b border-white/[.08]">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-300/70">
                  <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setSearchHighlight(-1); }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setSearchHighlight((i) => Math.min(i + 1, searchList.length - 1)); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchHighlight((i) => Math.max(i - 1, -1)); }
                    else if (e.key === 'Enter') {
                      const pick = searchList[searchHighlight] ?? searchList[0];
                      if (pick) selectSearchResult(pick);
                    }
                  }}
                  placeholder={fr ? 'Rechercher une rue, un quartier, un code postal…' : 'Search a street, neighborhood, postal code…'}
                  className="w-full bg-transparent py-4 pl-11 pr-20 text-[15px] text-white placeholder-white/30 outline-none"
                  /* le typebar global (index.css, non-layeré) force un fond
                     var(--color-surface) sur tous les inputs — blanc en mode
                     clair, donc texte blanc invisible; l'inline le neutralise */
                  style={{ backgroundColor: 'transparent' }}
                />
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(''); setSearchResults([]); setSearchHighlight(-1); }}
                    className="absolute right-12 top-1/2 -translate-y-1/2 rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white"
                    aria-label={fr ? 'Effacer' : 'Clear'}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                )}
                <kbd className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-white/35">esc</kbd>
              </div>

              <div className="max-h-[320px] overflow-auto py-1.5">
                {searchTyping ? (
                  searchResults.length > 0 ? (
                    searchResults.map((r, idx) => (
                      <button
                        key={r.id}
                        onMouseEnter={() => setSearchHighlight(idx)}
                        onClick={() => selectSearchResult(r)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-colors ${searchHighlight === idx ? 'bg-indigo-500/20 text-white' : 'text-white/80 hover:bg-white/[.07]'}`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-indigo-300/60">
                          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
                        </svg>
                        <span className="truncate">{r.place_name}</span>
                      </button>
                    ))
                  ) : (
                    <p className="px-4 py-6 text-center text-[12.5px] text-white/35">
                      {fr ? <>Aucun résultat pour «&nbsp;{searchQuery.trim()}&nbsp;»</> : <>No results for “{searchQuery.trim()}”</>}
                    </p>
                  )
                ) : recentSearches.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between px-4 pb-1 pt-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-white/35">{fr ? 'Recherches récentes' : 'Recent searches'}</span>
                      <button onClick={clearRecentSearches} className="text-[10.5px] text-white/30 transition-colors hover:text-white/70">{fr ? 'Effacer' : 'Clear'}</button>
                    </div>
                    {recentSearches.map((r, idx) => (
                      <button
                        key={r.place_name}
                        onMouseEnter={() => setSearchHighlight(idx)}
                        onClick={() => selectSearchResult(r)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-colors ${searchHighlight === idx ? 'bg-indigo-500/20 text-white' : 'text-white/80 hover:bg-white/[.07]'}`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/30">
                          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
                        </svg>
                        <span className="truncate">{r.place_name}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <div className="px-4 py-8 text-center">
                    <p className="text-[13px] text-white/50">{fr ? 'Cherchez une rue, un quartier ou un code postal' : 'Search a street, neighborhood or postal code'}</p>
                    <p className="mt-1 text-[11.5px] text-white/25">{fr ? 'Les suggestions apparaissent dès que vous tapez' : 'Suggestions appear as you type'}</p>
                  </div>
                )}
              </div>

            </div>
          </div>
        );
      })()}

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
              {gpsBlocked
                ? (fr
                    ? 'Localisation bloquée par le navigateur. Cliquez l’icône à gauche de la barre d’adresse → Localisation → Autoriser, puis réessayez.'
                    : 'Location is blocked by the browser. Click the icon left of the address bar → Location → Allow, then retry.')
                : (fr
                    ? 'Votre localisation est désactivée — votre position n’apparaît pas sur la carte.'
                    : 'Your location is off — your position isn’t showing on the map.')}
            </p>
            <button
              disabled={gpsEnabling}
              onClick={async () => {
                if (!navigator.geolocation || gpsEnabling) return;
                setGpsEnabling(true);
                try {
                  // A hard-blocked permission fails getCurrentPosition instantly
                  // without prompting — detect it to show unblock steps instead.
                  const status = await navigator.permissions
                    ?.query?.({ name: 'geolocation' as PermissionName })
                    .catch(() => null);
                  if (status?.state === 'denied') { setGpsBlocked(true); return; }
                  await new Promise<void>((resolve) => {
                    navigator.geolocation.getCurrentPosition(
                      (pos) => { setGpsBlocked(false); gpsRecenterRef.current?.(pos.coords.longitude, pos.coords.latitude); resolve(); },
                      (err) => { if (err.code === err.PERMISSION_DENIED) setGpsBlocked(true); resolve(); },
                      { enableHighAccuracy: true, timeout: 8000 },
                    );
                  });
                } finally {
                  setGpsEnabling(false);
                }
              }}
              className="shrink-0 rounded-lg bg-amber-400/15 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-400/25 disabled:opacity-60"
            >
              {gpsEnabling
                ? (fr ? 'Localisation…' : 'Locating…')
                : gpsBlocked
                  ? (fr ? 'Réessayer' : 'Retry')
                  : (fr ? 'Activer' : 'Enable')}
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
            {/* Add pin — déplacé dans la barre droite (box 1) + toolbar du bas */}

            {/* Select mode — déplacé dans la barre droite (box 4) */}

            {/* Create Zone — déplacé dans la barre droite (box 3) */}

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
          {/* TOP RIGHT — Filter panel                                         */}
          {/* ================================================================ */}
          <div className="pointer-events-auto flex items-center gap-2">
            {/* FILTER PANEL — ouvert par la box entonnoir de la barre droite */}
            <div className="relative self-stretch">
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
                        activeFiltersRef.current = next;
                        applyPinVisibility(next);
                        rebuildClusters(next);
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
      {/* BOTTOM CENTER — Add-pin status toolbar                             */}
      {/* ================================================================== */}
      {!showTokenMsg && mode === 'add_pin' && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 z-20 w-[min(640px,calc(100vw-1rem))] -translate-x-1/2">
          <div className="pointer-events-auto flex items-end gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-black/75 px-2.5 py-2 shadow-2xl backdrop-blur-xl">
            {statuses.map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => setSelectedStatus(key)}
                className={`flex min-w-[82px] flex-1 flex-col items-center gap-1.5 rounded-xl px-1.5 py-1.5 transition-all ${selectedStatus === key ? 'bg-white/15' : 'hover:bg-white/[.07]'}`}
              >
                {/* Réplique exacte du pin de la carte (createLeadPinElement) */}
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-transform ${selectedStatus === key ? 'scale-110' : ''}`}
                  style={{
                    background: `linear-gradient(135deg, ${cfg.gradientFrom}, ${cfg.gradientTo})`,
                    border: '2px solid rgba(255,255,255,0.92)',
                    boxShadow: selectedStatus === key
                      ? `0 0 14px ${cfg.color}CC, 0 2px 6px rgba(0,0,0,0.4)`
                      : `0 0 8px ${cfg.color}66, 0 2px 6px rgba(0,0,0,0.4)`,
                  }}
                >
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                    dangerouslySetInnerHTML={{ __html: cfg.iconPaths }}
                  />
                </span>
                <span className="whitespace-nowrap text-center text-[10px] font-medium leading-tight text-white">
                  {cfg.label}
                </span>
              </button>
            ))}
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
                /* neutralise le fond blanc du typebar global (mode clair) */
                style={{ backgroundColor: 'rgba(255,255,255,.05)' }}
              />
            </div>

            {canAssignZone(CURRENT_USER.role) && (
              <div className="mt-4">
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/30">{fr ? 'Assigner à un représentant' : 'Assign to a rep'}</label>
                <select value={zoneAssignInput} onChange={(e) => setZoneAssignInput(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white outline-none focus:border-indigo-500/50"
                  /* neutralise le fond blanc du typebar global (mode clair) */
                  style={{ backgroundColor: 'rgba(255,255,255,.05)' }}
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
      {/* "Log prospecting pin" action modal — opens when a pin is clicked    */}
      {/* ================================================================== */}
      {actionPin && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
          onClick={() => setActionPin(null)}
        >
          <div
            className="w-[380px] max-w-[92vw] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — new visit: fixed title · existing pin: name + status chip */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <h3 className="truncate text-[16px] font-bold text-slate-900">
                  {actionIsNew ? (fr ? 'Consigner une visite' : 'Log prospecting pin') : (actionPin.name || 'Pin')}
                </h3>
                {!actionIsNew && (
                  <span
                    className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide"
                    style={{ backgroundColor: `${PIN_STATUS_CONFIG[actionPin.status].color}18`, color: PIN_STATUS_CONFIG[actionPin.status].color }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: PIN_STATUS_CONFIG[actionPin.status].color }} />
                    {PIN_STATUS_CONFIG[actionPin.status].label}
                  </span>
                )}
              </div>
              <button
                onClick={() => setActionPin(null)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label={fr ? 'Fermer' : 'Close'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div className="px-5 py-4">
              {/* Info card: address (+ contact/note for existing pins) */}
              <div className="space-y-1.5 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
                <p className="text-[13.5px] font-semibold leading-snug text-slate-800">{actionPin.address}</p>
                <p className="text-[11.5px] font-medium text-slate-400">Lat/Lng: {actionPin.lat.toFixed(5)}, {actionPin.lng.toFixed(5)}</p>
                {!actionIsNew && actionPin.phone && (
                  <p className="text-[12.5px] text-slate-600">📞 <a href={`tel:${actionPin.phone}`} className="text-sky-600 hover:underline">{actionPin.phone}</a></p>
                )}
                {!actionIsNew && actionPin.email && (
                  <p className="text-[12.5px] text-slate-600">✉️ <a href={`mailto:${actionPin.email}`} className="text-sky-600 hover:underline">{actionPin.email}</a></p>
                )}
                {!actionIsNew && actionPin.note && (
                  <p className="rounded-lg bg-white px-2.5 py-1.5 text-[12px] leading-snug text-slate-500 ring-1 ring-slate-100">📝 {actionPin.note}</p>
                )}
                {!actionIsNew && actionPin.job_id && (
                  <p className="text-[11.5px] font-semibold text-emerald-600">✓ {fr ? 'Job liée' : 'Job linked'}</p>
                )}
                {!actionIsNew && actionPin.quote_id && (
                  <p className="text-[11.5px] font-semibold text-slate-500">✓ {fr ? 'Devis lié' : 'Quote linked'}</p>
                )}
              </div>

              {/* Outcome buttons.
                  New visit → big stacked buttons (the primary decision).
                  Existing pin → compact 2×2 chips (info stays the focus). */}
              {actionIsNew ? (
                <div className="mt-4 flex flex-col gap-2.5">
                  {(['no_answer', 'rejected', 'follow_up', 'lead', 'closed_won'] as PinStatus[]).map((status) => {
                    const cfg = PIN_STATUS_CONFIG[status];
                    // Button color = the color of the pin it creates.
                    const label = status === 'closed_won' ? (fr ? '+ Créer une Job' : '+ Create Job') : cfg.label;
                    return (
                      <button
                        key={status}
                        onClick={() => createVisitPin(actionPin, status)}
                        className="w-full rounded-xl py-3 text-[14px] font-bold text-white shadow-sm transition-all hover:brightness-110 active:scale-[.99]"
                        style={{ background: `linear-gradient(135deg, ${cfg.gradientFrom}, ${cfg.gradientTo})` }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <>
                  <p className="mb-1.5 mt-4 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{fr ? 'Statut' : 'Status'}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['no_answer', 'rejected', 'follow_up', 'lead', 'closed_won'] as PinStatus[]).map((status) => {
                      const cfg = PIN_STATUS_CONFIG[status];
                      const active = actionPin.status === status;
                      return (
                        <button
                          key={status}
                          onClick={() => applyPinStatus(actionPin, status)}
                          className={`rounded-lg px-2 py-1.5 text-[12px] font-semibold transition-all active:scale-[.98] ${active ? 'text-white shadow-sm' : 'ring-1 ring-inset hover:brightness-95'}`}
                          style={active
                            ? { backgroundColor: cfg.color }
                            : { color: cfg.color, backgroundColor: `${cfg.color}14`, ['--tw-ring-color' as string]: `${cfg.color}40` } as React.CSSProperties}
                        >
                          {active ? '✓ ' : ''}{status === 'closed_won' ? (fr ? 'Vendu ✓' : 'Sold ✓') : cfg.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Secondary actions for an existing pin */}
              {!actionIsNew && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => {
                      const current = markersRef.current.get(actionPin.id)?.pin || actionPin;
                      setActionPin(null);
                      setEditingPin(current);
                      setEditName(current.name);
                      setEditPhone(current.phone || '');
                      setEditEmail(current.email || '');
                      setEditStatus(current.status);
                      setEditNote(current.note);
                    }}
                    className="flex-1 rounded-lg bg-slate-100 py-2 text-[12.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-200"
                  >
                    ✎ {fr ? 'Modifier' : 'Edit'}
                  </button>
                  {(actionPin.client_id || actionPin.lead_id || actionPin.job_id || actionPin.lume_job_id) && (
                    <button
                      onClick={() => {
                        const current = markersRef.current.get(actionPin.id)?.pin || actionPin;
                        setActionPin(null);
                        onOpenClientRef.current?.(current);
                      }}
                      className="flex-1 rounded-lg bg-sky-50 py-2 text-[12.5px] font-semibold text-sky-600 transition-colors hover:bg-sky-100"
                    >
                      → {fr ? 'Fiche client' : 'Client'}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const current = markersRef.current.get(actionPin.id)?.pin || actionPin;
                      setActionPin(null);
                      requestPinDelete(current);
                    }}
                    className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-500 transition-colors hover:bg-red-100"
                    aria-label={fr ? 'Supprimer le pin' : 'Delete pin'}
                  >
                    ✕
                  </button>
                </div>
              )}

              <button
                onClick={() => setActionPin(null)}
                className="mt-3 w-full py-2.5 text-[13.5px] font-semibold text-slate-500 transition-colors hover:text-slate-700"
              >
                {actionIsNew ? (fr ? 'Annuler' : 'Cancel') : (fr ? 'Fermer' : 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* Edit pin modal                                                     */}
      {/* ================================================================== */}
      {editingPin && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="w-[340px] rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5">
            <h3 className="text-[15px] font-bold text-slate-900">{fr ? 'Modifier le pin' : 'Edit pin'}</h3>
            <div className="mt-4">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">{fr ? 'Nom' : 'Name'}</label>
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-[13px] text-slate-800 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">{fr ? 'Téléphone' : 'Phone'}</label>
              <input type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="819-555-0100"
                className="w-full rounded-lg px-3 py-2 text-[13px] text-slate-800 placeholder-slate-300 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">{fr ? 'Courriel' : 'Email'}</label>
              <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="client@email.com"
                className="w-full rounded-lg px-3 py-2 text-[13px] text-slate-800 placeholder-slate-300 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">{fr ? 'Statut' : 'Status'}</label>
              <div className="flex flex-wrap gap-1.5">
                {statuses.map(([key, cfg]) => (
                  <button key={key} onClick={() => setEditStatus(key)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all ${editStatus === key ? 'text-white shadow-sm' : 'text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'}`}
                    style={editStatus === key ? { backgroundColor: cfg.color } : undefined}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: editStatus === key ? 'white' : cfg.color }} />
                    {cfg.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Note</label>
              <textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder={fr ? 'Ajouter une note...' : 'Add a note...'} rows={3}
                className="w-full resize-none rounded-lg px-3 py-2 text-[13px] text-slate-800 placeholder-slate-300 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">{fr ? 'Adresse' : 'Address'}</label>
              <p className="text-[12px] text-slate-500">{editingPin.address}</p>
            </div>
            <div className="mt-6 flex gap-2">
              <button onClick={handleSaveEdit} className="flex-1 rounded-lg bg-indigo-500 py-2 text-[12px] font-bold text-white transition-colors hover:bg-indigo-600">{fr ? 'Sauvegarder' : 'Save'}</button>
              <button onClick={() => setEditingPin(null)} className="rounded-lg bg-slate-100 px-4 py-2 text-[12px] font-semibold text-slate-600 transition-colors hover:bg-slate-200">{fr ? 'Annuler' : 'Cancel'}</button>
              <button onClick={() => { const current = markersRef.current.get(editingPin.id)?.pin || editingPin; setEditingPin(null); requestPinDelete(current); }}
                className="rounded-lg bg-red-50 px-4 py-2 text-[12px] font-semibold text-red-500 transition-colors hover:bg-red-100">{fr ? 'Supprimer' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* Delete pin confirmation modal                                      */}
      {/* ================================================================== */}
      {(pinPendingDelete || bulkDeletePending) && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={cancelPinDelete}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0c0c14] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-2xl font-extrabold tracking-tight text-white">
              {bulkDeletePending
                ? (fr
                    ? `Supprimer ${selectedPinIds.size} pin${selectedPinIds.size > 1 ? 's' : ''} ?`
                    : `Delete ${selectedPinIds.size} pin${selectedPinIds.size > 1 ? 's' : ''}?`)
                : (fr ? 'Supprimer ce pin ?' : 'Delete this pin?')}
            </h3>
            <p className="mt-3 text-[13px] font-medium text-white/60">
              {fr ? 'Cette action est irréversible.' : 'This action cannot be undone.'}
            </p>
            {pinPendingDelete && (pinPendingDelete.client_id || pinPendingDelete.lead_id) && (
              <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                <input
                  type="checkbox"
                  checked={deleteLinkedClient}
                  onChange={(e) => setDeleteLinkedClient(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-red-500"
                />
                <span className="text-[12px] font-medium leading-snug text-white/70">
                  {fr
                    ? 'Ce pin est lié à un client. Voulez-vous aussi supprimer le client ?'
                    : 'This pin is linked to a client. Also delete the client?'}
                </span>
              </label>
            )}
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={cancelPinDelete}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-[13px] font-semibold text-white/70 transition-colors hover:bg-white/10"
              >
                {fr ? 'Annuler' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={confirmPinDelete}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
              >
                {fr ? 'Supprimer' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
