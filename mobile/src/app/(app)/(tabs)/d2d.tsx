import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Linking, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import D2DWebMap, { D2DWebMapHandle } from '@/components/D2DWebMap';
import { IconCompass, IconDrawHand, IconFoldedMap, IconFunnel, IconPin, IconSearch, IconSelectRect } from '@/components/MapToolbarIcons';
import {
  createHouseAt,
  createTerritory,
  deleteTerritory,
  FieldHouse,
  HouseStatus,
  listFieldReps,
  listHousesInBounds,
  listLastNotes,
  listTerritories,
  logHouseEvent,
  Territory,
  updateTerritory,
} from '@/lib/api/fieldSales';
import { deleteFieldHouse } from '@/lib/api/server';
import { getActiveLiveLocations } from '@/lib/api/tracking';
import { useAuth } from '@/lib/auth';
import { useTranslation, type TranslationKeys } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

const DEFAULT = { lat: 45.5019, lng: -73.5674 };
// Web parity (zone-types.ts): palette picked to stay distinguishable on satellite imagery.
const ZONE_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#64748b', '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#78716c'];
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

// Exactly the web's 7 pin statuses (lead-pin.ts PIN_STATUS_CONFIG on current
// main): same order, labels and colours, each mapped to the stored HouseStatus
// via the web's REVERSE_STATUS_MAP. Keep in sync with D2DWebMap.tsx.
const PIN_STATUSES: { bucket: string; labelKey: keyof TranslationKeys['mobileField']; color: string; house: HouseStatus }[] = [
  { bucket: 'closed_won', labelKey: 'pinClosed', color: '#22C55E', house: 'sale' },
  { bucket: 'lead', labelKey: 'pinLead', color: '#A855F7', house: 'lead' },
  { bucket: 'follow_up', labelKey: 'pinFollowUp', color: '#06B6D4', house: 'callback' },
  { bucket: 'appointment', labelKey: 'pinAppointment', color: '#6B7280', house: 'quote_sent' },
  { bucket: 'no_answer', labelKey: 'pinNoAnswer', color: '#EAB308', house: 'no_answer' },
  { bucket: 'rejected', labelKey: 'pinDeclined', color: '#EF4444', house: 'not_interested' },
  { bucket: 'other', labelKey: 'pinOther', color: '#F97316', house: 'unknown' },
];
const ALL_BUCKETS = PIN_STATUSES.map((s) => s.bucket);
// The web's action modal offers these 5 outcomes only (map-container 2549-2703)
const OUTCOME_BUCKETS = ['no_answer', 'rejected', 'follow_up', 'lead', 'closed_won'];
// DB status -> bucket (mirror of STATUS_MAP in src/pages/D2DMap.tsx, current main)
const STATUS_TO_BUCKET: Record<string, string> = {
  sale: 'closed_won', sold: 'closed_won', closed_won: 'closed_won',
  lead: 'lead',
  follow_up: 'follow_up', callback: 'follow_up',
  no_answer: 'no_answer',
  not_interested: 'rejected', do_not_knock: 'rejected', rejected: 'rejected',
  quote_sent: 'appointment', appointment: 'appointment',
};
// Web zone-stats breakdown order (map-container zone panel)
const ZONE_BREAKDOWN_ORDER = ['closed_won', 'lead', 'appointment', 'follow_up', 'no_answer', 'rejected', 'other'];
// SF Symbols closest to the web pin glyphs (placement toolbar replicas)
const BUCKET_SF_ICON: Record<string, string> = {
  closed_won: 'checkmark',
  lead: 'scope',
  follow_up: 'clock',
  appointment: 'calendar',
  no_answer: 'questionmark',
  rejected: 'xmark',
  other: 'circle.fill',
};

/** Ray-casting point-in-polygon on a [lng,lat] ring (web map-container 105-115). */
function pointInPolygon(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

type MapMode = 'view' | 'add_pin' | 'select' | 'draw_zone';

/** Web's right toolbar boxes: white 44px squares, red icons, active = red bg. */
function ToolBtn({ onPress, active, round, children }: { onPress: () => void; active?: boolean; round?: boolean; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      className={`h-11 w-11 items-center justify-center ${round ? 'rounded-full' : 'rounded-xl'} ${active ? 'bg-red-600' : 'bg-white'}`}
      style={{ shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}
    >
      {children}
    </Pressable>
  );
}

// Web's date filters (map-container DateFilter) — pins get 5 choices, zones 4
type Period = 'all' | 'today' | 'yesterday' | 'month' | 'year';
function inPeriod(iso: string | null | undefined, p: Period): boolean {
  if (p === 'all') return true;
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === 'today') return d >= startToday;
  if (p === 'yesterday') {
    const startYesterday = new Date(startToday);
    startYesterday.setDate(startYesterday.getDate() - 1);
    return d >= startYesterday && d < startToday;
  }
  if (p === 'month') return d >= new Date(now.getFullYear(), now.getMonth(), 1);
  return d >= new Date(now.getFullYear(), 0, 1);
}

export default function D2DMap() {
  const { t, language } = useTranslation();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { orgId, role } = usePermissions();
  const canDraw = role === 'owner' || role === 'admin';
  const userId = session?.user.id ?? '';

  const mapRef = useRef<D2DWebMapHandle>(null);
  const [center, setCenter] = useState(DEFAULT);
  const [mapCenter, setMapCenter] = useState(DEFAULT);
  const [ready, setReady] = useState(false);
  // Map bearing → the compass needle rotates like the web's
  const [bearing, setBearing] = useState(0);
  // Web parity: last GPS fix cached → instant open at zoom 17 next launch
  const [initialZoom, setInitialZoom] = useState(16);
  useEffect(() => {
    AsyncStorage.getItem('d2d-last-gps').then((v) => {
      try {
        const c = JSON.parse(v ?? '');
        if (c && typeof c.lat === 'number' && typeof c.lng === 'number') {
          setInitialZoom(17);
          setCenter(c);
          setMapCenter(c);
        }
      } catch {
        /* ignore */
      }
    });
  }, []);

  // Same modes as the web map-container
  const [mode, setMode] = useState<MapMode>('view');
  const [selectedStatus, setSelectedStatus] = useState<HouseStatus>('sale');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [drawCount, setDrawCount] = useState(0);

  const [zoneCoords, setZoneCoords] = useState<[number, number][] | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [zoneRep, setZoneRep] = useState<string | null>(null);

  // Filters (web's filter panel, as a dark bottom sheet)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeBuckets, setActiveBuckets] = useState<Set<string>>(new Set(ALL_BUCKETS));
  const [showZones, setShowZones] = useState(true);
  const [showReps, setShowReps] = useState(true);
  const [showNotes, setShowNotes] = useState(false);
  const [pinPeriod, setPinPeriod] = useState<Period>('all');
  const [zonePeriod, setZonePeriod] = useState<Period>('all');
  const [zoneRepFilter, setZoneRepFilter] = useState<string | null>(null);
  // Plan/satellite (web: streets default, choice persisted)
  const [mapStyle, setMapStyle] = useState<'streets' | 'satellite'>('streets');
  useEffect(() => {
    AsyncStorage.getItem('lume_d2d_map_style').then((v) => {
      if (v === 'satellite' || v === 'streets') setMapStyle(v);
    });
  }, []);
  const toggleMapStyle = () => {
    const next = mapStyle === 'streets' ? 'satellite' : 'streets';
    setMapStyle(next);
    AsyncStorage.setItem('lume_d2d_map_style', next);
  };
  // Pin-by-pin navigation (web: click an active status, then Space/Shift+Space)
  const [nav, setNav] = useState<{ bucket: string; ids: string[]; index: number } | null>(null);

  // Web parity: tap a pin → popup card; ✎ → edit modal; tap a zone → zone panel
  const [pinCard, setPinCard] = useState<FieldHouse | null>(null);
  // Freshly dropped pin → the modal shows the web's BIG stacked outcome buttons
  const [pinCardNew, setPinCardNew] = useState(false);
  const [editPin, setEditPin] = useState<{
    house: FieldHouse;
    name: string;
    phone: string;
    email: string;
    status: HouseStatus;
    note: string;
  } | null>(null);
  const [zoneCard, setZoneCard] = useState<Territory | null>(null);

  // Street search — full-screen spotlight opened from the toolbar loupe (web ⌘K)
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; place_name: string; center: [number, number] }>>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Recent searches (web: localStorage 'lume.d2d.recent-searches', 8 max)
  const [recentSearches, setRecentSearches] = useState<Array<{ id: string; place_name: string; center: [number, number] }>>([]);
  useEffect(() => {
    AsyncStorage.getItem('lume.d2d.recent-searches').then((v) => {
      try {
        const arr = JSON.parse(v ?? '[]');
        if (Array.isArray(arr)) setRecentSearches(arr);
      } catch {
        /* ignore */
      }
    });
  }, []);
  const rememberSearch = (r: { id: string; place_name: string; center: [number, number] }) => {
    const next = [r, ...recentSearches.filter((x) => x.id !== r.id)].slice(0, 8);
    setRecentSearches(next);
    AsyncStorage.setItem('lume.d2d.recent-searches', JSON.stringify(next));
  };

  // GPS-denied banner (web's amber non-blocking banner)
  const [gpsDenied, setGpsDenied] = useState(false);
  const [gpsBannerDismissed, setGpsBannerDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    let sub: Location.LocationSubscription | null = null;
    setReady(true);
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') setGpsDenied(true);
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (alive) {
            const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setCenter(c);
            setMapCenter(c);
            AsyncStorage.setItem('d2d-last-gps', JSON.stringify(c));
          }
          // Live GPS: keep the pulsing dot moving, like the web's watchPosition
          sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
            (p) => mapRef.current?.updateMe(p.coords.latitude, p.coords.longitude),
          );
        }
      } catch {
        /* keep default */
      }
    })();
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);

  const { data: houses, refetch } = useQuery({
    queryKey: ['d2d', 'houses', orgId, center.lat.toFixed(2), center.lng.toFixed(2)],
    queryFn: () =>
      listHousesInBounds({
        minLat: center.lat - 0.1,
        maxLat: center.lat + 0.1,
        minLng: center.lng - 0.1,
        maxLng: center.lng + 0.1,
      }),
    enabled: !!orgId && ready,
  });
  const { data: zones, refetch: refetchZones } = useQuery({
    queryKey: ['d2d', 'zones', orgId],
    queryFn: () => listTerritories(orgId ?? ''),
    enabled: !!orgId,
  });
  // Sales reps (web parity: zones are assigned/filtered by rep, value = user_id)
  const { data: fieldReps } = useQuery({
    queryKey: ['d2d', 'fieldReps', orgId],
    queryFn: () => listFieldReps(orgId ?? ''),
    enabled: !!orgId,
  });
  const repName = (uid: string | null | undefined) =>
    (fieldReps ?? []).find((r) => r.user_id === uid)?.display_name ?? null;
  // Last note per house, for the 📝 labels (web enriches /pins the same way)
  const { data: houseNotes, refetch: refetchNotes } = useQuery({
    queryKey: ['d2d', 'notes', orgId],
    queryFn: () => listLastNotes(orgId ?? ''),
    enabled: !!orgId,
  });
  // Live rep positions, polled every 15s like the web (src/pages/D2DMap.tsx)
  const { data: liveReps } = useQuery({
    queryKey: ['d2d', 'liveReps', orgId],
    queryFn: () => getActiveLiveLocations(orgId ?? ''),
    enabled: !!orgId && showReps,
    refetchInterval: 15_000,
  });
  // Web parity: own position excluded (the blue GPS dot already shows it)
  const onlineReps = useMemo(
    () => (liveReps ?? []).filter((r) => r.tracking_status !== 'offline' && r.user_id !== userId),
    [liveReps, userId],
  );

  // Pin period filter applies before everything downstream (counts, map, nav)
  const filteredHouses = useMemo(
    () => (houses ?? []).filter((h) => inPeriod(h.created_at, pinPeriod)),
    [houses, pinPeriod],
  );

  // Stable references — a re-render (e.g. typing in the search bar) must not
  // re-inject houses/reps into the WebView and rebuild every marker.
  const mapHouses = useMemo(
    () =>
      filteredHouses.map((h) => ({
        id: h.id,
        lat: h.lat,
        lng: h.lng,
        status: h.current_status,
        note: houseNotes?.[h.id] ?? null,
      })),
    [filteredHouses, houseNotes],
  );
  const mapZones = useMemo(
    () =>
      (zones ?? []).filter(
        (z) => inPeriod(z.created_at, zonePeriod) && (!zoneRepFilter || z.assigned_user_id === zoneRepFilter),
      ),
    [zones, zonePeriod, zoneRepFilter],
  );

  // Zone stats (web computeZoneStats: status filter + rep filter + ray-casting;
  // ignores the period filter, counts clustered pins too)
  const zoneStats = useMemo(() => {
    if (!zoneCard?.polygon_geojson?.coordinates?.[0]) return null;
    const ring = zoneCard.polygon_geojson.coordinates[0] as [number, number][];
    const byStatus: Record<string, number> = {};
    const repIds = new Set<string>();
    let total = 0;
    (houses ?? []).forEach((h) => {
      if (h.lat == null || h.lng == null) return;
      const b = STATUS_TO_BUCKET[h.current_status ?? ''] ?? 'other';
      if (!activeBuckets.has(b)) return;
      if (zoneRepFilter && h.assigned_user_id !== zoneRepFilter) return;
      if (!pointInPolygon(h.lng, h.lat, ring)) return;
      total += 1;
      byStatus[b] = (byStatus[b] ?? 0) + 1;
      if (h.assigned_user_id) repIds.add(h.assigned_user_id);
    });
    const sales = byStatus.closed_won ?? 0;
    const leads = byStatus.lead ?? 0;
    const appointments = byStatus.appointment ?? 0;
    const noAnswer = byStatus.no_answer ?? 0;
    const contacted = total - noAnswer;
    return {
      total,
      byStatus,
      sales,
      pipeline: leads + appointments,
      contacted,
      noAnswer,
      conversionRate: total > 0 ? Math.round((sales / total) * 100) : 0,
      contactRate: total > 0 ? Math.round((contacted / total) * 100) : 0,
      repCount: repIds.size,
      maxByStatus: Math.max(1, ...Object.values(byStatus)),
    };
  }, [zoneCard, houses, activeBuckets, zoneRepFilter]);
  const mapReps = useMemo(
    () =>
      onlineReps.map((r) => ({
        user_id: r.user_id,
        user_name: r.user_name ?? null,
        latitude: r.latitude,
        longitude: r.longitude,
        tracking_status: r.tracking_status,
        team_name: r.team_name ?? null,
        team_color: r.team_color ?? null,
      })),
    [onlineReps],
  );
  const visibleStatuses = useMemo(() => [...activeBuckets], [activeBuckets]);

  // Debounced street search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = searchQ.trim();
    if (q.length < 3 || !MAPBOX_TOKEN) {
      setSearchResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      const proximity = `&proximity=${mapCenter.lng},${mapCenter.lat}`;
      fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&language=${language}&limit=6&types=address,place,postcode,locality,neighborhood${proximity}`,
      )
        .then((r) => r.json())
        .then((data) => {
          setSearchResults(
            (data?.features ?? []).map((f: any) => ({ id: f.id, place_name: f.place_name, center: f.center as [number, number] })),
          );
        })
        .catch(() => setSearchResults([]));
    }, 200);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQ, language, mapCenter.lat, mapCenter.lng]);

  const recenter = async () => {
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      mapRef.current?.updateMe(pos.coords.latitude, pos.coords.longitude);
      mapRef.current?.flyTo(pos.coords.latitude, pos.coords.longitude, 17);
    } catch {
      /* no permission / no fix */
    }
  };

  const crmFor = (house: HouseStatus, address: string) => {
    // Web flows (pin-crm-actions.ts): closed_won opens the job flow; a lead
    // opens a choice (the web offers contract/quote/skip — mobile: quote/skip).
    if (house === 'sale') {
      router.push(`/(app)/jobs/new?address=${encodeURIComponent(address)}` as any);
    } else if (house === 'lead') {
      Alert.alert(t.mobileField.pinLead, undefined, [
        {
          text: t.mobileField.createQuote,
          onPress: () =>
            router.push(`/(app)/quotes/new?title=${encodeURIComponent(address ? `Estimation — ${address}` : '')}` as any),
        },
        { text: t.mobileField.skipForNow, style: 'cancel' },
      ]);
    } else if (house === 'quote_sent') {
      router.push(`/(app)/quotes/new?title=${encodeURIComponent(address ? `Estimation — ${address}` : '')}` as any);
    }
  };

  // --- Mode transitions (web's top-left buttons) ---
  const enterAddPin = () => {
    setMode('add_pin');
    mapRef.current?.startPlace();
  };
  const exitAddPin = () => {
    setMode('view');
    mapRef.current?.stopPlace();
  };
  const enterSelect = () => {
    setMode('select');
    setSelectedIds([]);
    mapRef.current?.setSelectMode(true);
  };
  const exitSelect = () => {
    setMode('view');
    setSelectedIds([]);
    mapRef.current?.setSelectMode(false);
  };
  const enterDraw = () => {
    setMode('draw_zone');
    setDrawCount(0);
    mapRef.current?.startZoneDraw();
  };
  const exitDraw = () => {
    setMode('view');
    setDrawCount(0);
    mapRef.current?.cancelZoneDraw();
  };

  // Place a pin at the tapped location (web add_pin flow: drop, back to view,
  // then the action modal opens on the NEW pin with big outcome buttons)
  const placePin = async (lat: number, lng: number) => {
    const house = selectedStatus;
    exitAddPin();
    if (!orgId || !userId) return;
    try {
      const created = await createHouseAt({ orgId, userId, lat, lng, status: house });
      refetch();
      setPinCardNew(true);
      setPinCard(created);
    } catch (e) {
      Alert.alert(t.mobileField.pin, (e as Error).message);
    }
  };

  // Bulk delete (web's "Supprimer tout")
  const bulkDelete = async () => {
    const ids = selectedIds;
    if (!ids.length) return;
    try {
      const results = await Promise.allSettled(ids.map((id) => deleteFieldHouse(id)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed) Alert.alert(t.mobileField.pin, t.mobileField.errorPrefix.replace('{message}', `${failed}/${ids.length}`));
    } finally {
      exitSelect();
      refetch();
    }
  };

  const closeZone = () => {
    setZoneCoords(null);
    setZoneName('');
    setZoneRep(null);
  };
  const saveZone = async () => {
    if (!zoneCoords || !orgId || !zoneName.trim()) return;
    try {
      await createTerritory({
        orgId,
        name: zoneName.trim(),
        color: ZONE_COLORS[(zones?.length ?? 0) % ZONE_COLORS.length],
        coordinates: zoneCoords,
        assignedUserId: zoneRep,
      });
      closeZone();
      refetchZones();
      Alert.alert(t.mobileField.zone, t.mobileField.zoneSaved);
    } catch (e) {
      Alert.alert(t.mobileField.zone, (e as Error).message);
    }
  };

  const toggleBucket = (bucket: string) => {
    setActiveBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  };

  // --- Pin-by-pin navigation (web: distance-sorted walk of one status) ---
  const goToHouse = (id: string) => {
    const h = filteredHouses.find((x) => x.id === id);
    if (!h || h.lat == null || h.lng == null) return;
    mapRef.current?.flyTo(h.lat, h.lng, 17);
    mapRef.current?.navHighlight(id);
  };
  const startNav = (bucket: string) => {
    const list = filteredHouses
      .filter(
        (h) => h.lat != null && h.lng != null && (STATUS_TO_BUCKET[h.current_status ?? ''] ?? 'other') === bucket,
      )
      .sort((a, b) => {
        const da = (a.lat! - mapCenter.lat) ** 2 + (a.lng! - mapCenter.lng) ** 2;
        const db = (b.lat! - mapCenter.lat) ** 2 + (b.lng! - mapCenter.lng) ** 2;
        return da - db;
      });
    if (!list.length) return;
    setNav({ bucket, ids: list.map((h) => h.id), index: 0 });
    goToHouse(list[0].id);
  };
  const navStep = (dir: 1 | -1) => {
    if (!nav) return;
    const index = (nav.index + dir + nav.ids.length) % nav.ids.length;
    setNav({ ...nav, index });
    goToHouse(nav.ids[index]);
  };
  const stopNav = () => {
    setNav(null);
    mapRef.current?.navHighlight(null);
  };

  // --- Pin popup card + edit modal (web's Mapbox popup + edit modal) ---
  const bucketOf = (s?: string | null) =>
    PIN_STATUSES.find((x) => x.bucket === (STATUS_TO_BUCKET[s ?? ''] ?? 'other')) ?? PIN_STATUSES[5];
  const custOf = (h: FieldHouse) => {
    const m = h.metadata ?? {};
    return {
      name: (m.name ?? m.customer_name ?? '') as string,
      phone: (m.phone ?? m.customer_phone ?? '') as string,
      email: (m.email ?? m.customer_email ?? '') as string,
    };
  };
  const openEdit = (h: FieldHouse) => {
    const c = custOf(h);
    setEditPin({
      house: h,
      name: c.name,
      phone: c.phone,
      email: c.email,
      status: (h.current_status as HouseStatus) ?? 'unknown',
      note: houseNotes?.[h.id] ?? '',
    });
    setPinCard(null);
    setPinCardNew(false);
  };
  const savePinEdit = async () => {
    if (!editPin || !orgId || !userId) return;
    const { house, name, phone, email, status, note } = editPin;
    const noteChanged = note.trim() !== (houseNotes?.[house.id] ?? '');
    try {
      await logHouseEvent({
        orgId,
        houseId: house.id,
        userId,
        eventType: 'status_change',
        statusOverride: status,
        noteText: noteChanged && note.trim() ? note.trim() : null,
        customer:
          name.trim() || phone.trim() || email.trim()
            ? { name: name.trim() || undefined, phone: phone.trim() || undefined, email: email.trim() || undefined }
            : null,
      });
      setEditPin(null);
      refetch();
      refetchNotes();
      // Web: switching to a close/estimation without a linked job/quote opens the CRM flow
      if (status === 'sale' && !house.job_id && house.current_status !== 'sale') {
        crmFor('sale', house.address ?? '');
      } else if (status === 'quote_sent' && !house.quote_id && house.current_status !== 'quote_sent') {
        crmFor('quote_sent', house.address ?? '');
      }
    } catch (e) {
      Alert.alert(t.mobileField.pin, (e as Error).message);
    }
  };
  const closePinCard = () => {
    setPinCard(null);
    setPinCardNew(false);
  };

  // Web action modal: tapping an outcome chip applies the status + CRM flow
  const applyOutcome = async (h: FieldHouse, status: HouseStatus) => {
    if (!orgId || !userId) return;
    try {
      await logHouseEvent({ orgId, houseId: h.id, userId, eventType: 'status_change', statusOverride: status });
      closePinCard();
      refetch();
      if (status === 'sale' && !h.job_id) crmFor('sale', h.address ?? '');
      else if (status === 'lead' && !h.quote_id) crmFor('lead', h.address ?? '');
    } catch (e) {
      Alert.alert(t.mobileField.pin, (e as Error).message);
    }
  };

  const confirmDeletePin = (h: FieldHouse) => {
    Alert.alert(t.mobileField.deletePin, t.mobileField.pinDeleteConfirm, [
      { text: t.mobileField.cancel, style: 'cancel' },
      {
        text: t.mobileField.deletePin,
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteFieldHouse(h.id);
            setPinCard(null);
            setPinCardNew(false);
            refetch();
          } catch (e) {
            Alert.alert(t.mobileField.pin, (e as Error).message);
          }
        },
      },
    ]);
  };

  // --- Zone panel (web's zone stats panel) ---
  const reassignZone = async (repId: string | null) => {
    if (!zoneCard) return;
    try {
      await updateTerritory(zoneCard.id, { assignedUserId: repId });
      setZoneCard({ ...zoneCard, assigned_user_id: repId });
      refetchZones();
    } catch (e) {
      Alert.alert(t.mobileField.zone, (e as Error).message);
    }
  };
  const confirmDeleteZone = () => {
    if (!zoneCard) return;
    Alert.alert(t.mobileField.deleteZoneBtn, t.mobileField.zoneDeleteConfirm, [
      { text: t.mobileField.cancel, style: 'cancel' },
      {
        text: t.mobileField.deletePin,
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTerritory(zoneCard.id);
            setZoneCard(null);
            refetchZones();
          } catch (e) {
            Alert.alert(t.mobileField.zone, (e as Error).message);
          }
        },
      },
    ]);
  };

  return (
    <View className="flex-1 bg-[#080b10]">
      <D2DWebMap
        ref={mapRef}
        center={center}
        houses={mapHouses}
        zones={mapZones}
        reps={mapReps}
        showReps={showReps}
        showZones={showZones}
        visibleStatuses={visibleStatuses}
        showNotes={showNotes}
        mapStyle={mapStyle}
        initialZoom={initialZoom}
        onSelectHouse={(id) => {
          // Web parity: tap → popup card (edit / delete / CRM / client record);
          // the full house sheet stays reachable from the card.
          const h = (houses ?? []).find((x) => x.id === id);
          if (h) setPinCard(h);
          else router.push(`/(app)/d2d-house/${id}` as any);
        }}
        onZoneTap={(id) => {
          const z = (zones ?? []).find((x) => x.id === id);
          if (z) setZoneCard(z);
        }}
        onPlace={placePin}
        onZoneDrawn={(c) => {
          setMode('view');
          setZoneCoords(c);
        }}
        onCenterChange={(lat, lng) => setMapCenter({ lat, lng })}
        onBearingChange={setBearing}
        onSelectionChange={setSelectedIds}
        onDrawCount={setDrawCount}
      />

      {/* ===== TOP-LEFT — mode banners ===== */}
      <View className="absolute left-3 right-16" style={{ top: insets.top + 8 }}>
        {mode !== 'view' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" className="mt-2" contentContainerStyle={{ gap: 8 }}>
          {mode === 'add_pin' ? (
            <Pressable onPress={exitAddPin} className="flex-row items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5">
              <View className="h-2 w-2 rounded-full bg-white" />
              <Text className="text-[13px] font-semibold text-white">{t.mobileField.tapMapNow}</Text>
            </Pressable>
          ) : null}

          {mode === 'select' ? (
            <Pressable onPress={exitSelect} className="flex-row items-center gap-2 rounded-xl bg-red-500/80 px-4 py-2.5">
              <SymbolView name="xmark" tintColor="#FFFFFF" size={13} resizeMode="scaleAspectFit" />
              <Text className="text-[13px] font-semibold text-white">{t.mobileField.cancelSelection}</Text>
            </Pressable>
          ) : null}

          {mode === 'draw_zone' ? (
            <>
              <View className="flex-row items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5">
                <View className="h-2 w-2 rounded-full bg-white" />
                <Text className="text-[13px] font-semibold text-white">
                  {t.mobileField.drawZonePoints.replace('{count}', String(drawCount))}
                </Text>
              </View>
              {drawCount >= 3 ? (
                <Pressable onPress={() => mapRef.current?.finishZoneDraw()} className="items-center justify-center rounded-xl bg-emerald-500 px-4 py-2.5">
                  <Text className="text-[13px] font-semibold text-white">{t.mobileField.finish}</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={exitDraw} className="items-center justify-center rounded-xl border border-white/10 bg-black/60 px-4 py-2.5">
                <Text className="text-[13px] font-semibold text-white/60">{t.mobileField.cancel}</Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
        ) : null}

      </View>

      {/* ===== RIGHT toolbar — exact web boxes (always visible, buttons toggle their mode) ===== */}
      <View className="absolute right-3 items-end" style={{ top: '30%', gap: 8 }}>
        <ToolBtn active={mode === 'add_pin'} onPress={() => (mode === 'add_pin' ? exitAddPin() : enterAddPin())}>
          <IconPin color={mode === 'add_pin' ? '#FFFFFF' : '#DC2626'} />
        </ToolBtn>
        <ToolBtn active={filtersOpen} onPress={() => setFiltersOpen(!filtersOpen)}>
          <IconFunnel color={filtersOpen ? '#FFFFFF' : '#DC2626'} />
        </ToolBtn>
        <ToolBtn active={searchVisible} onPress={() => { setSearchVisible(!searchVisible); setFiltersOpen(false); }}>
          <IconSearch color={searchVisible ? '#FFFFFF' : '#DC2626'} />
        </ToolBtn>
        {canDraw ? (
          <ToolBtn active={mode === 'draw_zone'} onPress={() => (mode === 'draw_zone' ? exitDraw() : enterDraw())}>
            <IconDrawHand color={mode === 'draw_zone' ? '#FFFFFF' : '#DC2626'} />
          </ToolBtn>
        ) : null}
        <ToolBtn active={mode === 'select'} onPress={() => (mode === 'select' ? exitSelect() : enterSelect())}>
          <IconSelectRect color={mode === 'select' ? '#FFFFFF' : '#DC2626'} />
        </ToolBtn>
        <ToolBtn active={mapStyle === 'satellite'} onPress={toggleMapStyle}>
          <IconFoldedMap color={mapStyle === 'satellite' ? '#FFFFFF' : '#DC2626'} />
        </ToolBtn>
        {/* Compass — round, black, needle rotates with the map bearing */}
        <ToolBtn round onPress={() => mapRef.current?.resetNorth()}>
          <View style={{ transform: [{ rotate: `${-bearing}deg` }] }}>
            <IconCompass color="#000000" />
          </View>
        </ToolBtn>
      </View>

      {/* Bottom placement toolbar while adding a pin (web's bottom strip) */}
      {mode === 'add_pin' ? (
        <View className="absolute left-0 right-0" style={{ bottom: insets.bottom + 16 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 12 }}>
            {PIN_STATUSES.map((s) => {
              const on = selectedStatus === s.house;
              return (
                <Pressable
                  key={s.house}
                  onPress={() => setSelectedStatus(s.house)}
                  className="items-center rounded-xl bg-white px-3 py-2"
                  style={{ minWidth: 82, opacity: on ? 1 : 0.55, borderWidth: 2, borderColor: on ? s.color : 'transparent' }}
                >
                  <View
                    className="h-7 w-7 items-center justify-center rounded-full"
                    style={{ backgroundColor: s.color, borderWidth: 2, borderColor: 'rgba(255,255,255,0.92)' }}
                  >
                    <SymbolView name={BUCKET_SF_ICON[s.bucket] as any} tintColor="#FFFFFF" size={12} resizeMode="scaleAspectFit" />
                  </View>
                  <Text className="mt-1 text-[10px] font-semibold text-neutral-700">{t.mobileField[s.labelKey]}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {!ready ? (
        <View className="absolute inset-0 items-center justify-center bg-black/40">
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}

      {/* GPS re-center (web's bottom-right dark square) */}
      <Pressable
        onPress={recenter}
        className="absolute right-4 h-[38px] w-[38px] items-center justify-center rounded-lg border border-white/10 bg-black/70"
        style={{ bottom: insets.bottom + 24 }}
      >
        <SymbolView name="scope" tintColor="rgba(255,255,255,0.85)" size={17} resizeMode="scaleAspectFit" />
      </Pressable>

      {/* GPS-denied banner (web's amber non-blocking banner) */}
      {gpsDenied && !gpsBannerDismissed && mode === 'view' ? (
        <View className="absolute left-3 right-3 items-center" style={{ bottom: insets.bottom + 76 }}>
          <View className="flex-row items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-500/15 px-4 py-2.5">
            <Text className="flex-1 text-[12px] text-amber-200">{t.mobileField.gpsDeniedBanner}</Text>
            <Pressable
              onPress={async () => {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                  setGpsDenied(false);
                  recenter();
                }
              }}
              hitSlop={6}
            >
              <Text className="text-[12px] font-bold text-amber-300">{t.mobileField.retryLabel}</Text>
            </Pressable>
            <Pressable onPress={() => setGpsBannerDismissed(true)} hitSlop={6}>
              <SymbolView name="xmark" tintColor="rgba(252,211,77,0.7)" size={12} resizeMode="scaleAspectFit" />
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Spotlight search overlay (web's ⌘K: dark full-screen, recents) */}
      {searchVisible ? (
        <View className="absolute inset-0" style={{ backgroundColor: 'rgba(12,12,20,0.95)', paddingTop: insets.top + 12 }}>
          <View className="mx-4 flex-row items-center rounded-xl border border-white/10 bg-white/5 px-3">
            <SymbolView name="magnifyingglass" tintColor="rgba(255,255,255,0.4)" size={16} resizeMode="scaleAspectFit" />
            <TextInput
              value={searchQ}
              onChangeText={setSearchQ}
              placeholder={t.mobileField.searchAddressPlaceholder}
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCorrect={false}
              autoFocus
              className="flex-1 px-2 py-3 text-[15px] text-white"
            />
            <Pressable
              onPress={() => {
                setSearchVisible(false);
                setSearchQ('');
                setSearchResults([]);
                Keyboard.dismiss();
              }}
              hitSlop={8}
            >
              <SymbolView name="xmark.circle.fill" tintColor="rgba(255,255,255,0.4)" size={19} resizeMode="scaleAspectFit" />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" className="mt-2 px-4">
            {searchQ.trim().length < 3 && recentSearches.length > 0 ? (
              <Text className="mb-1 mt-2 text-[10px] font-semibold uppercase tracking-wider text-white/30">{t.mobileField.recentSearches}</Text>
            ) : null}
            {(searchQ.trim().length >= 3 ? searchResults : recentSearches).map((r) => (
              <Pressable
                key={r.id}
                onPress={() => {
                  rememberSearch(r);
                  mapRef.current?.flyTo(r.center[1], r.center[0], 17);
                  setSearchQ('');
                  setSearchResults([]);
                  setSearchVisible(false);
                  Keyboard.dismiss();
                }}
                className="border-b border-white/5 py-3"
              >
                <Text className="text-[13px] text-white/80" numberOfLines={1}>{r.place_name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Floating pin-nav bar — only when the filters panel is closed (it hosts the bar otherwise) */}
      {nav && mode === 'view' && !filtersOpen ? (
        <View className="absolute left-3 right-3 items-center" style={{ bottom: insets.bottom + 72 }}>
          <View className="flex-row items-center gap-3 rounded-xl border border-white/10 bg-black/70 px-4 py-2.5">
            <View
              style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: PIN_STATUSES.find((s) => s.bucket === nav.bucket)?.color ?? '#9CA3AF' }}
            />
            <Text className="text-[13px] font-bold text-white">
              {nav.index + 1} / {nav.ids.length}
            </Text>
            <Pressable onPress={() => navStep(-1)} hitSlop={6} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
              <SymbolView name="chevron.left" tintColor="rgba(255,255,255,0.8)" size={13} resizeMode="scaleAspectFit" />
            </Pressable>
            <Pressable onPress={() => navStep(1)} hitSlop={6} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
              <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.8)" size={13} resizeMode="scaleAspectFit" />
            </Pressable>
            <Pressable onPress={stopNav} hitSlop={6} className="px-1">
              <SymbolView name="xmark" tintColor="rgba(255,255,255,0.5)" size={13} resizeMode="scaleAspectFit" />
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Select mode — bottom action bar (web's bottom-center bar) */}
      {mode === 'select' ? (
        <View className="absolute left-3 right-3 items-center" style={{ bottom: insets.bottom + 24 }}>
          <View className="flex-row items-center gap-3 rounded-xl border border-white/10 bg-black/70 px-5 py-3">
            {selectedIds.length === 0 ? (
              <Text className="text-[13px] text-white/50">{t.mobileField.tapPinsToSelect}</Text>
            ) : (
              <>
                <Text className="text-[13px] font-medium text-white">
                  {t.mobileField.selectedCount.replace('{count}', String(selectedIds.length))}
                </Text>
                <Pressable onPress={bulkDelete} className="flex-row items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2">
                  <SymbolView name="trash" tintColor="#FFFFFF" size={13} resizeMode="scaleAspectFit" />
                  <Text className="text-[12px] font-semibold text-white">{t.mobileField.deleteAll}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setSelectedIds([]);
                    mapRef.current?.clearSelection();
                  }}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                >
                  <Text className="text-[12px] text-white/50">{t.mobileField.deselect}</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      ) : null}

      {/* ===== Filters — anchored 280px panel, exact web structure (map-container 2136-2289) ===== */}
      {filtersOpen ? (
        <>
          <Pressable className="absolute inset-0" onPress={() => setFiltersOpen(false)} />
          <View
            className="absolute w-[280px] rounded-xl border border-white/10 bg-black/85 p-3"
            style={{ top: '30%', right: 64, maxHeight: '60%' }}
          >
            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              {/* 1) Pins — Statut + tout (dé)sélectionner */}
              <View className="mb-1 flex-row items-center justify-between">
                <Text className="text-[10px] font-semibold uppercase tracking-wider text-white/30">{t.mobileField.pinsStatusHeader}</Text>
                <Pressable
                  onPress={() => setActiveBuckets(activeBuckets.size === ALL_BUCKETS.length ? new Set() : new Set(ALL_BUCKETS))}
                  hitSlop={8}
                >
                  <Text className="text-[9px] font-medium text-white/40">
                    {activeBuckets.size === ALL_BUCKETS.length ? t.mobileField.deselectAll : t.mobileField.selectAll}
                  </Text>
                </Pressable>
              </View>
              {PIN_STATUSES.map((s) => {
                const on = activeBuckets.has(s.bucket);
                const navving = nav?.bucket === s.bucket;
                return (
                  <Pressable
                    key={s.bucket}
                    onPress={() => {
                      // Web behavior: an ACTIVE row starts pin-nav; an inactive one turns the filter on
                      if (on) startNav(s.bucket);
                      else setActiveBuckets((prev) => new Set(prev).add(s.bucket));
                    }}
                    className="flex-row items-center gap-2 rounded-lg px-1.5 py-1.5"
                    style={navving ? { borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' } : undefined}
                  >
                    <View
                      className="h-3.5 w-3.5 items-center justify-center rounded"
                      style={{ borderWidth: 1, borderColor: on ? s.color : 'rgba(255,255,255,0.2)', backgroundColor: on ? s.color : 'transparent' }}
                    >
                      {on ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={8} resizeMode="scaleAspectFit" /> : null}
                    </View>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color, opacity: on ? 1 : 0.35 }} />
                    <Text className={`flex-1 text-[12px] ${on ? 'text-white' : 'text-white/30'}`}>{t.mobileField[s.labelKey]}</Text>
                    {navving && nav ? (
                      <Text className="text-[10px] font-bold text-white/50" style={{ fontVariant: ['tabular-nums'] }}>
                        {nav.index + 1}/{nav.ids.length}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}

              {/* 2) Pin-nav bar (only while navigating, like the web) */}
              {nav ? (
                <View className="mt-1.5 flex-row items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: PIN_STATUSES.find((s) => s.bucket === nav.bucket)?.color ?? '#9CA3AF' }} />
                  <Text className="flex-1 text-[11px] font-bold text-white" style={{ fontVariant: ['tabular-nums'] }}>
                    {nav.index + 1} / {nav.ids.length}
                  </Text>
                  <Pressable onPress={() => navStep(-1)} hitSlop={6} className="rounded border border-white/10 px-2 py-1">
                    <SymbolView name="chevron.left" tintColor="rgba(255,255,255,0.8)" size={11} resizeMode="scaleAspectFit" />
                  </Pressable>
                  <Pressable onPress={() => navStep(1)} hitSlop={6} className="rounded border border-white/10 px-2 py-1">
                    <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.8)" size={11} resizeMode="scaleAspectFit" />
                  </Pressable>
                  <Pressable onPress={stopNav} hitSlop={6} className="px-1">
                    <SymbolView name="xmark" tintColor="rgba(255,255,255,0.5)" size={11} resizeMode="scaleAspectFit" />
                  </Pressable>
                </View>
              ) : null}

              {/* 3) Afficher notes */}
              <Pressable onPress={() => setShowNotes(!showNotes)} className="mt-1 flex-row items-center gap-2 rounded-lg px-1.5 py-1.5">
                <View
                  className="h-3.5 w-3.5 items-center justify-center rounded"
                  style={{ borderWidth: 1, borderColor: showNotes ? '#6366f1' : 'rgba(255,255,255,0.2)', backgroundColor: showNotes ? '#6366f1' : 'transparent' }}
                >
                  {showNotes ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={8} resizeMode="scaleAspectFit" /> : null}
                </View>
                <Text className={`text-[12px] ${showNotes ? 'text-white' : 'text-white/30'}`}>{t.mobileField.showNotesFilter}</Text>
              </Pressable>

              {/* 4) Pins — Période */}
              <View className="mt-2 border-t border-white/10 pt-2">
                <Text className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/30">{t.mobileField.pinsPeriodHeader}</Text>
                <View className="flex-row flex-wrap" style={{ gap: 4 }}>
                  {(
                    [
                      ['today', t.mobileField.periodToday],
                      ['yesterday', t.mobileField.periodYesterday],
                      ['month', t.mobileField.periodThisMonth],
                      ['year', t.mobileField.periodThisYear],
                      ['all', t.mobileField.periodAll],
                    ] as [Period, string][]
                  ).map(([p, label]) => (
                    <Pressable key={p} onPress={() => setPinPeriod(p)} className={`rounded-md px-2 py-1 ${pinPeriod === p ? 'bg-white/[0.12]' : 'bg-white/5'}`}>
                      <Text className={`text-[10px] font-semibold ${pinPeriod === p ? 'text-white' : 'text-white/40'}`}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* 5) Zones */}
              <View className="mt-2 border-t border-white/10 pt-2">
                <Text className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-indigo-300/50">Zones</Text>
                <Pressable onPress={() => setShowZones(!showZones)} className="flex-row items-center gap-2 rounded-lg px-1.5 py-1.5">
                  <View
                    className="h-3.5 w-3.5 items-center justify-center rounded"
                    style={{ borderWidth: 1, borderColor: showZones ? '#6366f1' : 'rgba(255,255,255,0.2)', backgroundColor: showZones ? '#6366f1' : 'transparent' }}
                  >
                    {showZones ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={8} resizeMode="scaleAspectFit" /> : null}
                  </View>
                  <Text className={`text-[12px] ${showZones ? 'text-white' : 'text-white/30'}`}>{t.mobileField.showZonesFilter}</Text>
                </Pressable>
                <Text className="mt-1 mb-1 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-white/25">{t.mobileField.periodLabel}</Text>
                <View className="flex-row flex-wrap px-1.5" style={{ gap: 4 }}>
                  {(
                    [
                      ['today', t.mobileField.periodToday],
                      ['month', t.mobileField.periodThisMonth],
                      ['year', t.mobileField.periodThisYear],
                      ['all', t.mobileField.periodAll],
                    ] as [Period, string][]
                  ).map(([p, label]) => (
                    <Pressable key={p} onPress={() => setZonePeriod(p)} className={`rounded-md px-2 py-1 ${zonePeriod === p ? 'bg-indigo-500/20' : 'bg-white/5'}`}>
                      <Text className={`text-[10px] font-semibold ${zonePeriod === p ? 'text-indigo-300' : 'text-white/40'}`}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                {(fieldReps ?? []).length > 0 ? (
                  <>
                    <Text className="mt-1.5 mb-1 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-white/25">{t.mobileField.byRep}</Text>
                    <View className="flex-row flex-wrap px-1.5" style={{ gap: 4 }}>
                      <Pressable
                        onPress={() => setZoneRepFilter(null)}
                        className={`rounded-md px-2 py-1 ${zoneRepFilter === null ? 'bg-indigo-500/20' : 'bg-white/5'}`}
                      >
                        <Text className={`text-[10px] font-semibold ${zoneRepFilter === null ? 'text-indigo-300' : 'text-white/40'}`}>{t.mobileField.allReps}</Text>
                      </Pressable>
                      {(fieldReps ?? []).map((r) => {
                        const sel = zoneRepFilter === r.user_id;
                        return (
                          <Pressable
                            key={r.user_id}
                            onPress={() => setZoneRepFilter(sel ? null : r.user_id)}
                            className={`rounded-md px-2 py-1 ${sel ? 'bg-indigo-500/20' : 'bg-white/5'}`}
                          >
                            <Text className={`text-[10px] font-semibold ${sel ? 'text-indigo-300' : 'text-white/40'}`}>{r.display_name ?? '—'}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : null}
              </View>

              {/* 6) Représentants */}
              <View className="mt-2 border-t border-white/10 pt-2">
                <Text className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300/50">{t.mobileField.repsHeader}</Text>
                <Pressable onPress={() => setShowReps(!showReps)} className="flex-row items-center gap-2 rounded-lg px-1.5 py-1.5">
                  <View
                    className="h-3.5 w-3.5 items-center justify-center rounded"
                    style={{ borderWidth: 1, borderColor: showReps ? '#22c55e' : 'rgba(255,255,255,0.2)', backgroundColor: showReps ? '#22c55e' : 'transparent' }}
                  >
                    {showReps ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={8} resizeMode="scaleAspectFit" /> : null}
                  </View>
                  <Text className={`flex-1 text-[12px] ${showReps ? 'text-white' : 'text-white/30'}`}>{t.mobileField.showRepsFilter}</Text>
                  <Text className="text-[10px] font-medium text-emerald-400/60">
                    {t.mobileField.repsOnline.replace('{count}', String(onlineReps.length))}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </>
      ) : null}

      {/* ===== New zone modal — dark (web's zone confirm) ===== */}
      <Modal visible={!!zoneCoords} transparent animationType="slide" onRequestClose={closeZone}>
        <Pressable className="flex-1 justify-end bg-black/50" onPress={closeZone}>
          <Pressable
            className="gap-3 rounded-t-3xl border-t border-white/10 bg-[#0c0c14] p-5"
            style={{ paddingBottom: insets.bottom + 16 }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text className="text-[15px] font-semibold text-white">{t.mobileField.newZone}</Text>
            <TextInput
              value={zoneName}
              onChangeText={setZoneName}
              placeholder={t.mobileField.zoneNamePlaceholder}
              placeholderTextColor="rgba(255,255,255,0.2)"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white"
            />
            <Text className="text-[10px] font-semibold uppercase tracking-wider text-white/30">{t.mobileField.assignToRep}</Text>
            <View className="flex-row flex-wrap gap-2">
              <Pressable
                onPress={() => setZoneRep(null)}
                className={`rounded-full border px-3.5 py-2 ${zoneRep === null ? 'border-indigo-400/40 bg-indigo-500/20' : 'border-white/10 bg-white/5'}`}
              >
                <Text className={`text-sm font-medium ${zoneRep === null ? 'text-indigo-300' : 'text-white/50'}`}>{t.mobileField.unassigned}</Text>
              </Pressable>
              {(fieldReps ?? []).map((r) => {
                const sel = zoneRep === r.user_id;
                return (
                  <Pressable
                    key={r.user_id}
                    onPress={() => setZoneRep(r.user_id)}
                    className={`rounded-full border px-3.5 py-2 ${sel ? 'border-indigo-400/40 bg-indigo-500/20' : 'border-white/10 bg-white/5'}`}
                  >
                    <Text className={`text-sm font-medium ${sel ? 'text-indigo-300' : 'text-white/50'}`}>{r.display_name ?? '—'}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={saveZone}
              disabled={!zoneName.trim()}
              className={`mt-1 items-center rounded-xl py-3.5 ${zoneName.trim() ? 'bg-indigo-500' : 'bg-white/10'}`}
            >
              <Text className="text-base font-semibold text-white">{t.mobileField.saveZone}</Text>
            </Pressable>
            <Pressable onPress={closeZone} className="items-center py-1">
              <Text className="text-sm font-medium text-white/40">{t.mobileField.cancel}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ===== Pin action modal (web's WHITE action modal, map-container 2549-2703) ===== */}
      <Modal visible={!!pinCard} transparent animationType="slide" onRequestClose={closePinCard}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={closePinCard}>
          {pinCard ? (
            <Pressable
              className="gap-3 rounded-t-3xl bg-white p-5"
              style={{ paddingBottom: insets.bottom + 16 }}
              onPress={(e) => e.stopPropagation()}
            >
              {/* Header: name + colored status chip + close */}
              <View className="flex-row items-center gap-2.5">
                <Text className="flex-1 text-[16px] font-bold text-neutral-900" numberOfLines={1}>
                  {custOf(pinCard).name || pinCard.address || t.mobileField.pin}
                </Text>
                <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: `${bucketOf(pinCard.current_status).color}18` }}>
                  <Text className="text-[11px] font-bold" style={{ color: bucketOf(pinCard.current_status).color }}>
                    {t.mobileField[bucketOf(pinCard.current_status).labelKey]}
                  </Text>
                </View>
                <Pressable onPress={closePinCard} hitSlop={10}>
                  <SymbolView name="xmark.circle.fill" tintColor="#D4D4D4" size={24} resizeMode="scaleAspectFit" />
                </Pressable>
              </View>

              {/* Info card (gray, like the web) */}
              <View className="gap-1.5 rounded-2xl bg-neutral-100 px-4 py-3">
                {pinCard.address ? <Text className="text-[12px] text-neutral-600">📍 {pinCard.address}</Text> : null}
                {pinCard.lat != null && pinCard.lng != null ? (
                  <Text className="text-[11px] text-neutral-400" style={{ fontVariant: ['tabular-nums'] }}>
                    {pinCard.lat.toFixed(5)}, {pinCard.lng.toFixed(5)}
                  </Text>
                ) : null}
                {custOf(pinCard).phone ? (
                  <Pressable onPress={() => Linking.openURL(`tel:${custOf(pinCard).phone}`)}>
                    <Text className="text-[12px] font-medium text-indigo-600">📞 {custOf(pinCard).phone}</Text>
                  </Pressable>
                ) : null}
                {custOf(pinCard).email ? (
                  <Pressable onPress={() => Linking.openURL(`mailto:${custOf(pinCard).email}`)}>
                    <Text className="text-[12px] font-medium text-indigo-600">✉️ {custOf(pinCard).email}</Text>
                  </Pressable>
                ) : null}
                {houseNotes?.[pinCard.id] ? <Text className="text-[12px] text-neutral-600">📝 {houseNotes[pinCard.id]}</Text> : null}
                {pinCard.job_id ? <Text className="text-[11px] font-semibold text-emerald-600">✓ {t.mobileField.linkedJob}</Text> : null}
                {pinCard.quote_id ? <Text className="text-[11px] font-semibold text-emerald-600">✓ {t.mobileField.linkedQuote}</Text> : null}
              </View>

              {/* Outcomes — new pin: BIG stacked colored buttons (web); existing: chips 2-col */}
              {pinCardNew ? (
                <View style={{ gap: 8 }}>
                  {OUTCOME_BUCKETS.map((b) => {
                    const s = PIN_STATUSES.find((x) => x.bucket === b)!;
                    return (
                      <Pressable
                        key={b}
                        onPress={() => applyOutcome(pinCard, s.house)}
                        className="flex-row items-center justify-center gap-2 rounded-xl py-3.5"
                        style={{ backgroundColor: s.color }}
                      >
                        <SymbolView name={BUCKET_SF_ICON[b] as any} tintColor="#FFFFFF" size={14} resizeMode="scaleAspectFit" />
                        <Text className="text-[14px] font-bold text-white">
                          {b === 'closed_won' ? t.mobileField.createJobOutcome : t.mobileField[s.labelKey]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {OUTCOME_BUCKETS.map((b) => {
                    const s = PIN_STATUSES.find((x) => x.bucket === b)!;
                    const current = bucketOf(pinCard.current_status).bucket === b;
                    return (
                      <Pressable
                        key={b}
                        onPress={() => applyOutcome(pinCard, s.house)}
                        className="flex-row items-center justify-center gap-1.5 rounded-xl border py-2.5"
                        style={{
                          width: '48%',
                          borderColor: current ? s.color : '#E5E5E5',
                          backgroundColor: current ? `${s.color}18` : '#FAFAFA',
                        }}
                      >
                        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: s.color }} />
                        <Text className="text-[12px] font-semibold" style={{ color: current ? s.color : '#404040' }}>
                          {b === 'closed_won' && !pinCard.job_id ? t.mobileField.createJobOutcome : t.mobileField[s.labelKey]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Secondary actions */}
              <View className="flex-row" style={{ gap: 8 }}>
                <Pressable
                  onPress={() => openEdit(pinCard)}
                  className="flex-1 items-center rounded-xl bg-neutral-900 py-3"
                >
                  <Text className="text-[13px] font-semibold text-white">✎ {t.mobileField.editPin}</Text>
                </Pressable>
                {pinCard.client_id ? (
                  <Pressable
                    onPress={() => {
                      const cid = pinCard.client_id;
                      setPinCard(null);
                      setPinCardNew(false);
                      router.push(`/(app)/clients/${cid}` as any);
                    }}
                    className="flex-1 items-center rounded-xl border border-neutral-300 bg-white py-3"
                  >
                    <Text className="text-[13px] font-semibold text-neutral-700">👤 {t.mobileField.viewClient}</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => {
                      const id = pinCard.id;
                      setPinCard(null);
                      setPinCardNew(false);
                      router.push(`/(app)/d2d-house/${id}` as any);
                    }}
                    className="flex-1 items-center rounded-xl border border-neutral-300 bg-white py-3"
                  >
                    <Text className="text-[13px] font-semibold text-neutral-700">{t.mobileField.fullRecord}</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => confirmDeletePin(pinCard)}
                  className="items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 py-3"
                >
                  <SymbolView name="trash" tintColor="#DC2626" size={15} resizeMode="scaleAspectFit" />
                </Pressable>
              </View>
              {pinCard.client_id ? (
                <Pressable
                  onPress={() => {
                    const id = pinCard.id;
                    setPinCard(null);
                    setPinCardNew(false);
                    router.push(`/(app)/d2d-house/${id}` as any);
                  }}
                  className="items-center py-0.5"
                >
                  <Text className="text-[12px] font-medium text-neutral-400">{t.mobileField.fullRecord} →</Text>
                </Pressable>
              ) : null}
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>

      {/* ===== Edit pin modal (web's WHITE edit modal: 7 chips, indigo save) ===== */}
      <Modal visible={!!editPin} transparent animationType="slide" onRequestClose={() => setEditPin(null)}>
        <Pressable className="flex-1 justify-end bg-black/50" onPress={() => setEditPin(null)}>
          {editPin ? (
            <Pressable
              className="gap-3 rounded-t-3xl bg-white p-5"
              style={{ paddingBottom: insets.bottom + 16 }}
              onPress={(e) => e.stopPropagation()}
            >
              <Text className="text-[15px] font-bold text-neutral-900">✎ {t.mobileField.editPin}</Text>
              <Text className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">{t.mobileField.statusLabel}</Text>
              <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                {PIN_STATUSES.map((s) => {
                  const sel = (STATUS_TO_BUCKET[editPin.status] ?? 'other') === s.bucket;
                  return (
                    <Pressable
                      key={s.bucket}
                      onPress={() => setEditPin({ ...editPin, status: s.house })}
                      className="flex-row items-center gap-1.5 rounded-full border px-3 py-1.5"
                      style={{
                        borderColor: sel ? s.color : '#E5E5E5',
                        backgroundColor: sel ? `${s.color}18` : '#FAFAFA',
                      }}
                    >
                      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: s.color }} />
                      <Text className="text-[11px] font-semibold" style={{ color: sel ? s.color : '#737373' }}>
                        {t.mobileField[s.labelKey]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={editPin.name}
                onChangeText={(v) => setEditPin({ ...editPin, name: v })}
                placeholder={t.mobileField.nameLabel}
                placeholderTextColor="#A3A3A3"
                className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[14px] text-neutral-900"
              />
              <TextInput
                value={editPin.phone}
                onChangeText={(v) => setEditPin({ ...editPin, phone: v })}
                placeholder={t.mobileField.phoneLabel}
                placeholderTextColor="#A3A3A3"
                keyboardType="phone-pad"
                className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[14px] text-neutral-900"
              />
              <TextInput
                value={editPin.email}
                onChangeText={(v) => setEditPin({ ...editPin, email: v })}
                placeholder={t.mobileField.emailLabel}
                placeholderTextColor="#A3A3A3"
                keyboardType="email-address"
                autoCapitalize="none"
                className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[14px] text-neutral-900"
              />
              <TextInput
                value={editPin.note}
                onChangeText={(v) => setEditPin({ ...editPin, note: v })}
                placeholder={t.mobileField.noteLabel}
                placeholderTextColor="#A3A3A3"
                multiline
                className="min-h-[64px] rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[14px] text-neutral-900"
              />
              {editPin.house.address ? (
                <Text className="px-1 text-[11px] text-neutral-400" numberOfLines={1}>📍 {editPin.house.address}</Text>
              ) : null}
              <Pressable onPress={savePinEdit} className="items-center rounded-xl bg-indigo-500 py-3.5">
                <Text className="text-base font-semibold text-white">{t.mobileField.save}</Text>
              </Pressable>
              <Pressable onPress={() => setEditPin(null)} className="items-center py-1">
                <Text className="text-sm font-medium text-neutral-400">{t.mobileField.cancel}</Text>
              </Pressable>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>

      {/* ===== Zone stats panel (web's neutral-palette stats card, 5cdd618) ===== */}
      <Modal visible={!!zoneCard} transparent animationType="slide" onRequestClose={() => setZoneCard(null)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setZoneCard(null)}>
          {zoneCard ? (
            <Pressable
              className="rounded-t-3xl border-t border-white/10 bg-neutral-950 px-5 pt-5"
              style={{ paddingBottom: insets.bottom + 16, maxHeight: '85%' }}
              onPress={(e) => e.stopPropagation()}
            >
              <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ gap: 12 }}>
                {/* Header: color dot + name + date + close */}
                <View className="flex-row items-center gap-2.5">
                  <View
                    style={{
                      width: 10, height: 10, borderRadius: 5,
                      backgroundColor: zoneCard.color ?? '#6366f1',
                      borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)',
                    }}
                  />
                  <View className="flex-1">
                    <Text className="text-[14px] font-bold text-white">{zoneCard.name}</Text>
                    {zoneCard.created_at ? (
                      <Text className="text-[10px] text-neutral-500">
                        {new Date(zoneCard.created_at).toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable onPress={() => setZoneCard(null)} hitSlop={10}>
                    <SymbolView name="xmark.circle.fill" tintColor="rgba(255,255,255,0.3)" size={24} resizeMode="scaleAspectFit" />
                  </Pressable>
                </View>

                {zoneStats ? (
                  <>
                    {/* 3 KPIs — Portes / Ventes / Pipeline */}
                    <View className="flex-row overflow-hidden rounded-xl" style={{ gap: 1, backgroundColor: 'rgba(255,255,255,0.06)' }}>
                      {[
                        [t.mobileField.kpiDoors, zoneStats.total],
                        [t.mobileField.kpiSales, zoneStats.sales],
                        [t.mobileField.pipeline, zoneStats.pipeline],
                      ].map(([label, value]) => (
                        <View key={String(label)} className="flex-1 items-center bg-neutral-950 py-2.5">
                          <Text className="text-[19px] font-bold text-white" style={{ fontVariant: ['tabular-nums'] }}>{value}</Text>
                          <Text className="text-[9px] font-semibold uppercase text-neutral-500" style={{ letterSpacing: 0.8 }}>{label}</Text>
                        </View>
                      ))}
                    </View>

                    {/* Conversion + contact rates (white bars, web style) */}
                    {[
                      [t.mobileField.conversionRate, zoneStats.conversionRate, 'rgba(255,255,255,1)'],
                      [t.mobileField.contactRate, zoneStats.contactRate, 'rgba(255,255,255,0.45)'],
                    ].map(([label, pct, barColor]) => (
                      <View key={String(label)} className="gap-1">
                        <View className="flex-row items-center justify-between">
                          <Text className="text-[10px] font-semibold uppercase text-neutral-500" style={{ letterSpacing: 0.8 }}>{label}</Text>
                          <Text className="text-[11px] font-bold text-white" style={{ fontVariant: ['tabular-nums'] }}>{pct}%</Text>
                        </View>
                        <View className="h-1 overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
                          <View style={{ width: `${Number(pct)}%`, height: '100%', backgroundColor: String(barColor) }} />
                        </View>
                      </View>
                    ))}

                    {/* Secondary: Contactées / Sans réponse / Reps */}
                    <View className="flex-row">
                      {[
                        [t.mobileField.contacted, zoneStats.contacted],
                        [t.mobileField.noAnswerShort, zoneStats.noAnswer],
                        [t.mobileField.repsShort, zoneStats.repCount],
                      ].map(([label, value]) => (
                        <View key={String(label)} className="flex-1 items-center">
                          <Text className="text-[13px] font-bold text-white" style={{ fontVariant: ['tabular-nums'] }}>{value}</Text>
                          <Text className="text-[9px] font-semibold uppercase text-neutral-500" style={{ letterSpacing: 0.8 }}>{label}</Text>
                        </View>
                      ))}
                    </View>

                    {/* Breakdown by status (web order, bars relative to max) */}
                    {zoneStats.total > 0 ? (
                      <View className="gap-1.5">
                        {ZONE_BREAKDOWN_ORDER.filter((b) => (zoneStats.byStatus[b] ?? 0) > 0).map((b) => {
                          const s = PIN_STATUSES.find((x) => x.bucket === b)!;
                          const n = zoneStats.byStatus[b] ?? 0;
                          return (
                            <View key={b} className="gap-1">
                              <View className="flex-row items-center gap-2">
                                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
                                <Text className="flex-1 text-[12px] text-white/80">{t.mobileField[s.labelKey]}</Text>
                                <Text className="text-[12px] font-bold text-white" style={{ fontVariant: ['tabular-nums'] }}>{n}</Text>
                                <Text className="w-9 text-right text-[10px] text-neutral-500" style={{ fontVariant: ['tabular-nums'] }}>
                                  {Math.round((n / zoneStats.total) * 100)}%
                                </Text>
                              </View>
                              <View className="ml-4 h-[3px] overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                                <View style={{ width: `${(n / zoneStats.maxByStatus) * 100}%`, height: '100%', backgroundColor: 'rgba(255,255,255,0.3)' }} />
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ) : (
                      <Text className="text-[12px] text-neutral-500">{t.mobileField.noPinsInZone}</Text>
                    )}
                  </>
                ) : null}

                {/* Assigné à + delete (owner/admin) */}
                {canDraw ? (
                  <>
                    <Text className="text-[10px] font-semibold uppercase text-neutral-500" style={{ letterSpacing: 0.8 }}>{t.mobileField.assignedTo}</Text>
                    <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                      <Pressable
                        onPress={() => reassignZone(null)}
                        className={`rounded-full border px-3 py-1.5 ${!zoneCard.assigned_user_id ? 'border-white/40 bg-white/15' : 'border-white/10 bg-white/5'}`}
                      >
                        <Text className={`text-[11px] font-semibold ${!zoneCard.assigned_user_id ? 'text-white' : 'text-white/40'}`}>
                          {t.mobileField.unassigned}
                        </Text>
                      </Pressable>
                      {(fieldReps ?? []).map((r) => {
                        const sel = zoneCard.assigned_user_id === r.user_id;
                        return (
                          <Pressable
                            key={r.user_id}
                            onPress={() => reassignZone(r.user_id)}
                            className={`rounded-full border px-3 py-1.5 ${sel ? 'border-white/40 bg-white/15' : 'border-white/10 bg-white/5'}`}
                          >
                            <Text className={`text-[11px] font-semibold ${sel ? 'text-white' : 'text-white/40'}`}>{r.display_name ?? '—'}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Pressable onPress={confirmDeleteZone} className="items-center rounded-xl border border-red-500/30 py-3" style={{ backgroundColor: 'rgba(239,68,68,0.08)' }}>
                      <Text className="text-[13px] font-semibold text-red-400">{t.mobileField.deleteZoneBtn}</Text>
                    </Pressable>
                  </>
                ) : zoneStats ? (
                  <Text className="text-[11px] text-neutral-500">
                    {t.mobileField.assignedTo} {repName(zoneCard.assigned_user_id) ?? t.mobileField.unassigned}
                  </Text>
                ) : null}
              </ScrollView>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}
