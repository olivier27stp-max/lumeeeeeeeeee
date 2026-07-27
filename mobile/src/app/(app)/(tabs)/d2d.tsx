import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Linking, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import D2DWebMap, { D2DWebMapHandle } from '@/components/D2DWebMap';
import {
  createHouseAt,
  createTerritory,
  deleteTerritory,
  FieldHouse,
  HouseStatus,
  listHousesInBounds,
  listLastNotes,
  listTerritories,
  logHouseEvent,
  Territory,
  updateTerritory,
} from '@/lib/api/fieldSales';
import { listTeams } from '@/lib/api/org';
import { deleteFieldHouse } from '@/lib/api/server';
import { getActiveLiveLocations } from '@/lib/api/tracking';
import { useAuth } from '@/lib/auth';
import { useTranslation, type TranslationKeys } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

const DEFAULT = { lat: 45.5019, lng: -73.5674 };
// Web parity (zone-types.ts): palette picked to stay distinguishable on satellite imagery.
const ZONE_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#64748b', '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#78716c'];
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

// Exactly the web's 6 pin statuses (lead-pin.ts PIN_STATUS_CONFIG): same labels
// and colours, each mapped to the stored HouseStatus via the web's
// REVERSE_STATUS_MAP (src/pages/D2DMap.tsx). Keep in sync with D2DWebMap.tsx.
const PIN_STATUSES: { bucket: string; labelKey: keyof TranslationKeys['mobileField']; color: string; house: HouseStatus }[] = [
  { bucket: 'closed_won', labelKey: 'pinClosed', color: '#22C55E', house: 'sale' },
  { bucket: 'follow_up', labelKey: 'pinFollowUp', color: '#06B6D4', house: 'lead' },
  { bucket: 'appointment', labelKey: 'pinAppointment', color: '#6B7280', house: 'quote_sent' },
  { bucket: 'no_answer', labelKey: 'pinNoAnswer', color: '#EAB308', house: 'no_answer' },
  { bucket: 'rejected', labelKey: 'pinDeclined', color: '#EF4444', house: 'not_interested' },
  { bucket: 'other', labelKey: 'pinOther', color: '#9CA3AF', house: 'unknown' },
];
const ALL_BUCKETS = PIN_STATUSES.map((s) => s.bucket);
// DB status -> bucket (mirror of STATUS_MAP in src/pages/D2DMap.tsx / D2DWebMap COLOR_JS)
const STATUS_TO_BUCKET: Record<string, string> = {
  sale: 'closed_won', sold: 'closed_won', closed_won: 'closed_won',
  lead: 'follow_up', follow_up: 'follow_up', callback: 'follow_up',
  no_answer: 'no_answer',
  not_interested: 'rejected', do_not_knock: 'rejected', rejected: 'rejected',
  quote_sent: 'appointment', appointment: 'appointment',
};

type MapMode = 'view' | 'add_pin' | 'select' | 'draw_zone';

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

  // Same modes as the web map-container
  const [mode, setMode] = useState<MapMode>('view');
  const [selectedStatus, setSelectedStatus] = useState<HouseStatus>('sale');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [drawCount, setDrawCount] = useState(0);

  const [zoneCoords, setZoneCoords] = useState<[number, number][] | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [zoneTeam, setZoneTeam] = useState<string | null>(null);

  // Filters (web's filter panel, as a dark bottom sheet)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeBuckets, setActiveBuckets] = useState<Set<string>>(new Set(ALL_BUCKETS));
  const [showZones, setShowZones] = useState(true);
  const [showReps, setShowReps] = useState(true);
  const [showNotes, setShowNotes] = useState(false);
  const [pinPeriod, setPinPeriod] = useState<Period>('all');
  const [zonePeriod, setZonePeriod] = useState<Period>('all');
  const [zoneTeamFilter, setZoneTeamFilter] = useState<string | null>(null);
  // Pin-by-pin navigation (web: click an active status, then Space/Shift+Space)
  const [nav, setNav] = useState<{ bucket: string; ids: string[]; index: number } | null>(null);

  // Web parity: tap a pin → popup card; ✎ → edit modal; tap a zone → zone panel
  const [pinCard, setPinCard] = useState<FieldHouse | null>(null);
  const [editPin, setEditPin] = useState<{
    house: FieldHouse;
    name: string;
    phone: string;
    email: string;
    status: HouseStatus;
    note: string;
  } | null>(null);
  const [zoneCard, setZoneCard] = useState<Territory | null>(null);

  // Street search (web's top-center search)
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; place_name: string; center: [number, number] }>>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    let sub: Location.LocationSubscription | null = null;
    setReady(true);
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (alive) {
            const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setCenter(c);
            setMapCenter(c);
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
  // Teams: zone assignment (owner/admin) + the zones-by-team filter (everyone)
  const { data: teams } = useQuery({
    queryKey: ['teams', orgId],
    queryFn: () => listTeams(orgId ?? ''),
    enabled: !!orgId,
  });
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
  const onlineReps = useMemo(
    () => (liveReps ?? []).filter((r) => r.tracking_status !== 'offline'),
    [liveReps],
  );

  // Pin period filter applies before everything downstream (counts, map, nav)
  const filteredHouses = useMemo(
    () => (houses ?? []).filter((h) => inPeriod(h.created_at, pinPeriod)),
    [houses, pinPeriod],
  );

  // Colored per-status counts for the stats pill (web's top-right stats)
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    filteredHouses.forEach((h) => {
      const b = STATUS_TO_BUCKET[h.current_status ?? ''] ?? 'other';
      c[b] = (c[b] ?? 0) + 1;
    });
    return c;
  }, [filteredHouses]);
  const totalPins = filteredHouses.length;
  const totalZones = zones?.length ?? 0;

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
        (z) => inPeriod(z.created_at, zonePeriod) && (!zoneTeamFilter || z.assigned_team_id === zoneTeamFilter),
      ),
    [zones, zonePeriod, zoneTeamFilter],
  );
  const mapReps = useMemo(
    () =>
      onlineReps.map((r) => ({
        user_id: r.user_id,
        user_name: r.user_name ?? null,
        latitude: r.latitude,
        longitude: r.longitude,
        tracking_status: r.tracking_status,
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
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&language=${language}&limit=5&types=address,place,postcode,locality,neighborhood${proximity}`,
      )
        .then((r) => r.json())
        .then((data) => {
          setSearchResults(
            (data?.features ?? []).map((f: any) => ({ id: f.id, place_name: f.place_name, center: f.center as [number, number] })),
          );
        })
        .catch(() => setSearchResults([]));
    }, 300);
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
    // Like the web: a close opens a job, an estimation opens a quote.
    if (house === 'sale') {
      router.push(`/(app)/jobs/new?address=${encodeURIComponent(address)}` as any);
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

  // Place a pin at the tapped location with the selected status (web add_pin flow)
  const placePin = async (lat: number, lng: number) => {
    const house = selectedStatus;
    exitAddPin();
    if (!orgId || !userId) return;
    try {
      const created = await createHouseAt({ orgId, userId, lat, lng, status: house });
      refetch();
      crmFor(house, created.address ?? '');
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
    setZoneTeam(null);
  };
  const saveZone = async () => {
    if (!zoneCoords || !orgId || !zoneName.trim()) return;
    try {
      await createTerritory({
        orgId,
        name: zoneName.trim(),
        color: ZONE_COLORS[(zones?.length ?? 0) % ZONE_COLORS.length],
        coordinates: zoneCoords,
        assignedTeamId: zoneTeam,
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
    setFiltersOpen(false);
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
            refetch();
          } catch (e) {
            Alert.alert(t.mobileField.pin, (e as Error).message);
          }
        },
      },
    ]);
  };

  // --- Zone panel (web's bottom-left zone detail) ---
  const reassignZone = async (teamId: string | null) => {
    if (!zoneCard) return;
    try {
      await updateTerritory(zoneCard.id, { assignedTeamId: teamId });
      setZoneCard({ ...zoneCard, assigned_team_id: teamId });
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
        onSelectionChange={setSelectedIds}
        onDrawCount={setDrawCount}
      />

      {/* ===== TOP — search (web top-center) + action buttons (web top-left) + stats ===== */}
      <View className="absolute left-3 right-3" style={{ top: insets.top + 8 }}>
        {/* Street search */}
        <View className="flex-row items-center rounded-xl border border-white/10 bg-black/70 px-3">
          <SymbolView name="magnifyingglass" tintColor="rgba(255,255,255,0.4)" size={15} resizeMode="scaleAspectFit" />
          <TextInput
            value={searchQ}
            onChangeText={setSearchQ}
            placeholder={t.mobileField.searchAddressPlaceholder}
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCorrect={false}
            className="flex-1 px-2 py-2.5 text-[13px] text-white"
          />
          {searchQ ? (
            <Pressable onPress={() => { setSearchQ(''); setSearchResults([]); }} hitSlop={8}>
              <SymbolView name="xmark.circle.fill" tintColor="rgba(255,255,255,0.4)" size={17} resizeMode="scaleAspectFit" />
            </Pressable>
          ) : null}
        </View>
        {searchResults.length > 0 ? (
          <View className="mt-1 overflow-hidden rounded-xl border border-white/10 bg-black/85">
            {searchResults.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => {
                  mapRef.current?.flyTo(r.center[1], r.center[0], 17);
                  setSearchQ('');
                  setSearchResults([]);
                  Keyboard.dismiss();
                }}
                className="border-b border-white/5 px-3 py-2.5"
              >
                <Text className="text-[12px] text-white/80" numberOfLines={1}>{r.place_name}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Action buttons row (same buttons as web, compact so all 4 fit) */}
        {mode === 'view' ? (
          <View className="mt-2 flex-row" style={{ gap: 6 }}>
            <Pressable onPress={enterAddPin} className="flex-1 flex-row items-center justify-center gap-1 rounded-xl border border-white/10 bg-black/60 px-1.5 py-2.5">
              <SymbolView name="plus" tintColor="rgba(255,255,255,0.8)" size={11} resizeMode="scaleAspectFit" />
              <Text className="text-[11px] font-semibold text-white/80" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{t.mobileField.addPin}</Text>
            </Pressable>
            <Pressable onPress={enterSelect} className="flex-1 flex-row items-center justify-center gap-1 rounded-xl border border-white/10 bg-black/60 px-1.5 py-2.5">
              <SymbolView name="rectangle.dashed" tintColor="rgba(255,255,255,0.8)" size={11} resizeMode="scaleAspectFit" />
              <Text className="text-[11px] font-semibold text-white/80" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{t.mobileField.selectMode}</Text>
            </Pressable>
            {canDraw ? (
              <Pressable onPress={enterDraw} className="flex-1 flex-row items-center justify-center gap-1 rounded-xl border border-indigo-400/20 bg-indigo-500/15 px-1.5 py-2.5">
                <SymbolView name="hexagon" tintColor="#A5B4FC" size={11} resizeMode="scaleAspectFit" />
                <Text className="text-[11px] font-semibold text-indigo-300" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{t.mobileField.createZone}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => setFiltersOpen(true)} className="flex-1 flex-row items-center justify-center gap-1 rounded-xl border border-white/10 bg-black/60 px-1.5 py-2.5">
              <SymbolView name="line.3.horizontal.decrease" tintColor="rgba(255,255,255,0.8)" size={11} resizeMode="scaleAspectFit" />
              <Text className="text-[11px] font-semibold text-white/80" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{t.mobileField.filters}</Text>
            </Pressable>
          </View>
        ) : null}

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

        {/* Status selector strip while adding a pin (web's inline selector) */}
        {mode === 'add_pin' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2" contentContainerStyle={{ gap: 4 }}>
            <View className="flex-row items-center gap-1 rounded-xl border border-white/10 bg-black/60 p-1">
              {PIN_STATUSES.map((s) => {
                const on = selectedStatus === s.house;
                return (
                  <Pressable
                    key={s.house}
                    onPress={() => setSelectedStatus(s.house)}
                    className={`flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5 ${on ? 'bg-white/15' : ''}`}
                  >
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color }} />
                    <Text className={`text-[11px] font-medium ${on ? 'text-white' : 'text-white/40'}`}>{t.mobileField[s.labelKey]}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        ) : null}

        {/* Stats pill (web's top-right stats) */}
        {totalPins > 0 && mode === 'view' ? (
          <View className="mt-2 flex-row items-center gap-3 self-start rounded-xl border border-white/10 bg-black/60 px-4 py-2">
            {PIN_STATUSES.filter((s) => counts[s.bucket]).map((s) => (
              <View key={s.bucket} className="flex-row items-center gap-1.5">
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
                <Text className="text-[12px] font-bold text-white/80">{counts[s.bucket]}</Text>
              </View>
            ))}
            <View className="h-4 w-px bg-white/10" />
            <Text className="text-[12px] font-semibold text-white/50">
              {t.mobileField.housesZonesSummary
                .replace('{houses}', String(totalPins))
                .replace('{zones}', String(totalZones))}
            </Text>
          </View>
        ) : null}
      </View>

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
        <SymbolView name="location.fill" tintColor="rgba(255,255,255,0.7)" size={17} resizeMode="scaleAspectFit" />
      </Pressable>

      {/* Pin-by-pin navigation bar (web's ◀ N/total ▶ bar, floating over the map) */}
      {nav && mode === 'view' ? (
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

      {/* ===== Filters — dark bottom sheet (web's filter panel) ===== */}
      <Modal visible={filtersOpen} transparent animationType="slide" onRequestClose={() => setFiltersOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/50" onPress={() => setFiltersOpen(false)}>
          <Pressable
            className="rounded-t-3xl border-t border-white/10 bg-[#0c0c14] px-5 pt-5"
            style={{ paddingBottom: insets.bottom + 16, maxHeight: '85%' }}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-[15px] font-semibold text-white">{t.mobileField.filters}</Text>
              <Pressable onPress={() => setFiltersOpen(false)} hitSlop={10}>
                <SymbolView name="xmark.circle.fill" tintColor="rgba(255,255,255,0.3)" size={24} resizeMode="scaleAspectFit" />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>

            {/* Pins — status */}
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-[10px] font-semibold uppercase tracking-wider text-white/30">{t.mobileField.pinsStatusHeader}</Text>
              <Pressable
                onPress={() =>
                  setActiveBuckets(activeBuckets.size === ALL_BUCKETS.length ? new Set() : new Set(ALL_BUCKETS))
                }
                hitSlop={8}
              >
                <Text className="text-[10px] font-medium text-white/40">
                  {activeBuckets.size === ALL_BUCKETS.length ? t.mobileField.deselectAll : t.mobileField.selectAll}
                </Text>
              </Pressable>
            </View>
            <View className="mb-4">
              {PIN_STATUSES.map((s) => {
                const on = activeBuckets.has(s.bucket);
                return (
                  <Pressable
                    key={s.bucket}
                    onPress={() => toggleBucket(s.bucket)}
                    className={`flex-row items-center gap-2.5 rounded-lg px-3 py-2 ${on ? 'bg-white/10' : ''}`}
                  >
                    <View
                      className="h-4 w-4 items-center justify-center rounded border"
                      style={{ borderColor: on ? s.color : 'rgba(255,255,255,0.15)', backgroundColor: on ? s.color : 'transparent' }}
                    >
                      {on ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={9} resizeMode="scaleAspectFit" /> : null}
                    </View>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color, opacity: on ? 1 : 0.35 }} />
                    <Text className={`flex-1 text-[13px] font-medium ${on ? 'text-white' : 'text-white/30'}`}>
                      {t.mobileField[s.labelKey]}
                    </Text>
                    {counts[s.bucket] ? <Text className="text-[11px] font-bold text-white/40">{counts[s.bucket]}</Text> : null}
                    {counts[s.bucket] ? (
                      <Pressable
                        onPress={() => startNav(s.bucket)}
                        hitSlop={8}
                        className="rounded-md border border-white/10 bg-white/5 p-1.5"
                      >
                        <SymbolView name="scope" tintColor="rgba(255,255,255,0.6)" size={13} resizeMode="scaleAspectFit" />
                      </Pressable>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            {/* Pins — period (web's DateFilter) + notes toggle */}
            <Text className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/30">{t.mobileField.pinsPeriodHeader}</Text>
            <View className="mb-2 flex-row flex-wrap" style={{ gap: 6 }}>
              {(
                [
                  ['today', t.mobileField.periodToday],
                  ['yesterday', t.mobileField.periodYesterday],
                  ['month', t.mobileField.periodThisMonth],
                  ['year', t.mobileField.periodThisYear],
                  ['all', t.mobileField.periodAll],
                ] as [Period, string][]
              ).map(([p, label]) => (
                <Pressable
                  key={p}
                  onPress={() => setPinPeriod(p)}
                  className={`rounded-full border px-3 py-1.5 ${pinPeriod === p ? 'border-indigo-400/40 bg-indigo-500/20' : 'border-white/10 bg-white/5'}`}
                >
                  <Text className={`text-[11px] font-semibold ${pinPeriod === p ? 'text-indigo-300' : 'text-white/40'}`}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => setShowNotes(!showNotes)}
              className={`mb-4 flex-row items-center gap-2.5 rounded-lg px-3 py-2 ${showNotes ? 'bg-white/10' : ''}`}
            >
              <View
                className="h-4 w-4 items-center justify-center rounded border"
                style={{ borderColor: showNotes ? '#EAB308' : 'rgba(255,255,255,0.15)', backgroundColor: showNotes ? '#EAB308' : 'transparent' }}
              >
                {showNotes ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={9} resizeMode="scaleAspectFit" /> : null}
              </View>
              <Text className={`text-[13px] font-medium ${showNotes ? 'text-white' : 'text-white/30'}`}>{t.mobileField.showNotesFilter}</Text>
            </Pressable>

            {/* Zones */}
            <View className="mb-3 border-t border-white/10 pt-3">
              <Text className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-indigo-300/50">Zones</Text>
              <Pressable
                onPress={() => setShowZones(!showZones)}
                className={`flex-row items-center gap-2.5 rounded-lg px-3 py-2 ${showZones ? 'bg-white/10' : ''}`}
              >
                <View
                  className="h-4 w-4 items-center justify-center rounded border"
                  style={{ borderColor: showZones ? '#6366F1' : 'rgba(255,255,255,0.15)', backgroundColor: showZones ? '#6366F1' : 'transparent' }}
                >
                  {showZones ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={9} resizeMode="scaleAspectFit" /> : null}
                </View>
                <Text className={`text-[13px] font-medium ${showZones ? 'text-white' : 'text-white/30'}`}>{t.mobileField.showZonesFilter}</Text>
              </Pressable>
              {showZones ? (
                <>
                  {/* Zones — period (web's zone DateFilter, 4 choices) */}
                  <View className="mt-2 flex-row flex-wrap" style={{ gap: 6 }}>
                    {(
                      [
                        ['today', t.mobileField.periodToday],
                        ['month', t.mobileField.periodThisMonth],
                        ['year', t.mobileField.periodThisYear],
                        ['all', t.mobileField.periodAll],
                      ] as [Period, string][]
                    ).map(([p, label]) => (
                      <Pressable
                        key={p}
                        onPress={() => setZonePeriod(p)}
                        className={`rounded-full border px-3 py-1.5 ${zonePeriod === p ? 'border-indigo-400/40 bg-indigo-500/20' : 'border-white/10 bg-white/5'}`}
                      >
                        <Text className={`text-[11px] font-semibold ${zonePeriod === p ? 'text-indigo-300' : 'text-white/40'}`}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {/* Zones — by team (web's per-rep select; zones are team-assigned here) */}
                  {(teams ?? []).length > 0 ? (
                    <View className="mt-2 flex-row flex-wrap" style={{ gap: 6 }}>
                      <Pressable
                        onPress={() => setZoneTeamFilter(null)}
                        className={`rounded-full border px-3 py-1.5 ${zoneTeamFilter === null ? 'border-indigo-400/40 bg-indigo-500/20' : 'border-white/10 bg-white/5'}`}
                      >
                        <Text className={`text-[11px] font-semibold ${zoneTeamFilter === null ? 'text-indigo-300' : 'text-white/40'}`}>
                          {t.mobileField.allTeams}
                        </Text>
                      </Pressable>
                      {(teams ?? []).map((tm) => {
                        const sel = zoneTeamFilter === tm.id;
                        return (
                          <Pressable
                            key={tm.id}
                            onPress={() => setZoneTeamFilter(sel ? null : tm.id)}
                            className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${sel ? 'border-indigo-400/40 bg-indigo-500/20' : 'border-white/10 bg-white/5'}`}
                          >
                            {tm.color_hex ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tm.color_hex }} /> : null}
                            <Text className={`text-[11px] font-semibold ${sel ? 'text-indigo-300' : 'text-white/40'}`}>{tm.name}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>

            {/* Reps */}
            <View className="border-t border-white/10 pt-3">
              <Text className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-300/50">{t.mobileField.showRepsFilter}</Text>
              <Pressable
                onPress={() => setShowReps(!showReps)}
                className={`flex-row items-center gap-2.5 rounded-lg px-3 py-2 ${showReps ? 'bg-white/10' : ''}`}
              >
                <View
                  className="h-4 w-4 items-center justify-center rounded border"
                  style={{ borderColor: showReps ? '#22C55E' : 'rgba(255,255,255,0.15)', backgroundColor: showReps ? '#22C55E' : 'transparent' }}
                >
                  {showReps ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={9} resizeMode="scaleAspectFit" /> : null}
                </View>
                <Text className={`flex-1 text-[13px] font-medium ${showReps ? 'text-white' : 'text-white/30'}`}>{t.mobileField.showRepsFilter}</Text>
                <Text className="text-[11px] font-medium text-emerald-400/60">
                  {t.mobileField.repsOnline.replace('{count}', String(onlineReps.length))}
                </Text>
              </Pressable>
            </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

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
            <Text className="text-[10px] font-semibold uppercase tracking-wider text-white/30">{t.mobileField.assignToTeam}</Text>
            <View className="flex-row flex-wrap gap-2">
              <Pressable
                onPress={() => setZoneTeam(null)}
                className={`rounded-full border px-3.5 py-2 ${zoneTeam === null ? 'border-indigo-400/40 bg-indigo-500/20' : 'border-white/10 bg-white/5'}`}
              >
                <Text className={`text-sm font-medium ${zoneTeam === null ? 'text-indigo-300' : 'text-white/50'}`}>{t.mobileField.none}</Text>
              </Pressable>
              {(teams ?? []).map((tm) => {
                const sel = zoneTeam === tm.id;
                return (
                  <Pressable
                    key={tm.id}
                    onPress={() => setZoneTeam(tm.id)}
                    className={`flex-row items-center gap-1.5 rounded-full border px-3.5 py-2 ${sel ? 'border-indigo-400/40 bg-indigo-500/20' : 'border-white/10 bg-white/5'}`}
                  >
                    {tm.color_hex ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tm.color_hex }} /> : null}
                    <Text className={`text-sm font-medium ${sel ? 'text-indigo-300' : 'text-white/50'}`}>{tm.name}</Text>
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

      {/* ===== Pin popup card (web's Mapbox popup, as a bottom card) ===== */}
      <Modal visible={!!pinCard} transparent animationType="slide" onRequestClose={() => setPinCard(null)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setPinCard(null)}>
          {pinCard ? (
            <Pressable
              className="gap-3 rounded-t-3xl border-t border-white/10 bg-[#0c0c14] p-5"
              style={{ paddingBottom: insets.bottom + 16 }}
              onPress={(e) => e.stopPropagation()}
            >
              <View className="flex-row items-center justify-between">
                <View
                  className="flex-row items-center gap-2 rounded-full border px-3 py-1.5"
                  style={{ borderColor: `${bucketOf(pinCard.current_status).color}66`, backgroundColor: `${bucketOf(pinCard.current_status).color}22` }}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: bucketOf(pinCard.current_status).color }} />
                  <Text className="text-[11px] font-bold" style={{ color: bucketOf(pinCard.current_status).color }}>
                    {t.mobileField[bucketOf(pinCard.current_status).labelKey]}
                  </Text>
                </View>
                <Pressable onPress={() => setPinCard(null)} hitSlop={10}>
                  <SymbolView name="xmark.circle.fill" tintColor="rgba(255,255,255,0.3)" size={24} resizeMode="scaleAspectFit" />
                </Pressable>
              </View>
              {custOf(pinCard).name ? <Text className="text-[16px] font-bold text-white">{custOf(pinCard).name}</Text> : null}
              {custOf(pinCard).phone ? (
                <Pressable onPress={() => Linking.openURL(`tel:${custOf(pinCard).phone}`)}>
                  <Text className="text-[13px] text-indigo-300">📞 {custOf(pinCard).phone}</Text>
                </Pressable>
              ) : null}
              {custOf(pinCard).email ? (
                <Pressable onPress={() => Linking.openURL(`mailto:${custOf(pinCard).email}`)}>
                  <Text className="text-[13px] text-indigo-300">✉️ {custOf(pinCard).email}</Text>
                </Pressable>
              ) : null}
              {pinCard.address ? <Text className="text-[12px] text-white/50">📍 {pinCard.address}</Text> : null}
              {houseNotes?.[pinCard.id] ? (
                <View className="rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2">
                  <Text className="text-[12px] text-amber-200">📝 {houseNotes[pinCard.id]}</Text>
                </View>
              ) : null}
              <View className="flex-row" style={{ gap: 8 }}>
                <Pressable
                  onPress={() => openEdit(pinCard)}
                  className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 py-3"
                >
                  <SymbolView name="pencil" tintColor="rgba(255,255,255,0.8)" size={13} resizeMode="scaleAspectFit" />
                  <Text className="text-[13px] font-semibold text-white/80">{t.mobileField.editPin}</Text>
                </Pressable>
                <Pressable
                  onPress={() => confirmDeletePin(pinCard)}
                  className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-red-400/30 bg-red-500/10 py-3"
                >
                  <SymbolView name="trash" tintColor="#FCA5A5" size={13} resizeMode="scaleAspectFit" />
                  <Text className="text-[13px] font-semibold text-red-300">{t.mobileField.deletePin}</Text>
                </Pressable>
              </View>
              {bucketOf(pinCard.current_status).bucket === 'closed_won' && !pinCard.job_id ? (
                <Pressable
                  onPress={() => {
                    const addr = pinCard.address ?? '';
                    setPinCard(null);
                    crmFor('sale', addr);
                  }}
                  className="items-center rounded-xl border border-indigo-400/40 bg-indigo-500/20 py-3"
                >
                  <Text className="text-[13px] font-semibold text-indigo-300">→ {t.mobileField.createJob}</Text>
                </Pressable>
              ) : null}
              {bucketOf(pinCard.current_status).bucket === 'appointment' && !pinCard.quote_id ? (
                <Pressable
                  onPress={() => {
                    const addr = pinCard.address ?? '';
                    setPinCard(null);
                    crmFor('quote_sent', addr);
                  }}
                  className="items-center rounded-xl border border-indigo-400/40 bg-indigo-500/20 py-3"
                >
                  <Text className="text-[13px] font-semibold text-indigo-300">→ {t.mobileField.createQuote}</Text>
                </Pressable>
              ) : null}
              {pinCard.client_id ? (
                <Pressable
                  onPress={() => {
                    const cid = pinCard.client_id;
                    setPinCard(null);
                    router.push(`/(app)/clients/${cid}` as any);
                  }}
                  className="items-center rounded-xl border border-white/10 bg-white/5 py-3"
                >
                  <Text className="text-[13px] font-semibold text-white/80">👤 {t.mobileField.viewClient}</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => {
                  const id = pinCard.id;
                  setPinCard(null);
                  router.push(`/(app)/d2d-house/${id}` as any);
                }}
                className="items-center py-1"
              >
                <Text className="text-[13px] font-medium text-white/40">{t.mobileField.fullRecord} →</Text>
              </Pressable>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>

      {/* ===== Edit pin modal (web's edit modal) ===== */}
      <Modal visible={!!editPin} transparent animationType="slide" onRequestClose={() => setEditPin(null)}>
        <Pressable className="flex-1 justify-end bg-black/50" onPress={() => setEditPin(null)}>
          {editPin ? (
            <Pressable
              className="gap-3 rounded-t-3xl border-t border-white/10 bg-[#0c0c14] p-5"
              style={{ paddingBottom: insets.bottom + 16 }}
              onPress={(e) => e.stopPropagation()}
            >
              <Text className="text-[15px] font-semibold text-white">✎ {t.mobileField.editPin}</Text>
              <Text className="text-[10px] font-semibold uppercase tracking-wider text-white/30">{t.mobileField.statusLabel}</Text>
              <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                {PIN_STATUSES.map((s) => {
                  const sel = (STATUS_TO_BUCKET[editPin.status] ?? 'other') === s.bucket;
                  return (
                    <Pressable
                      key={s.bucket}
                      onPress={() => setEditPin({ ...editPin, status: s.house })}
                      className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${sel ? 'border-white/40 bg-white/15' : 'border-white/10 bg-white/5'}`}
                    >
                      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: s.color }} />
                      <Text className={`text-[11px] font-semibold ${sel ? 'text-white' : 'text-white/40'}`}>{t.mobileField[s.labelKey]}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={editPin.name}
                onChangeText={(v) => setEditPin({ ...editPin, name: v })}
                placeholder={t.mobileField.nameLabel}
                placeholderTextColor="rgba(255,255,255,0.25)"
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[14px] text-white"
              />
              <TextInput
                value={editPin.phone}
                onChangeText={(v) => setEditPin({ ...editPin, phone: v })}
                placeholder={t.mobileField.phoneLabel}
                placeholderTextColor="rgba(255,255,255,0.25)"
                keyboardType="phone-pad"
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[14px] text-white"
              />
              <TextInput
                value={editPin.email}
                onChangeText={(v) => setEditPin({ ...editPin, email: v })}
                placeholder={t.mobileField.emailLabel}
                placeholderTextColor="rgba(255,255,255,0.25)"
                keyboardType="email-address"
                autoCapitalize="none"
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[14px] text-white"
              />
              <TextInput
                value={editPin.note}
                onChangeText={(v) => setEditPin({ ...editPin, note: v })}
                placeholder={t.mobileField.noteLabel}
                placeholderTextColor="rgba(255,255,255,0.25)"
                multiline
                className="min-h-[64px] rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[14px] text-white"
              />
              <Pressable onPress={savePinEdit} className="items-center rounded-xl bg-indigo-500 py-3.5">
                <Text className="text-base font-semibold text-white">{t.mobileField.save}</Text>
              </Pressable>
              <Pressable onPress={() => setEditPin(null)} className="items-center py-1">
                <Text className="text-sm font-medium text-white/40">{t.mobileField.cancel}</Text>
              </Pressable>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>

      {/* ===== Zone panel (web's zone detail: reassign + delete) ===== */}
      <Modal visible={!!zoneCard} transparent animationType="slide" onRequestClose={() => setZoneCard(null)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setZoneCard(null)}>
          {zoneCard ? (
            <Pressable
              className="gap-3 rounded-t-3xl border-t border-white/10 bg-[#0c0c14] p-5"
              style={{ paddingBottom: insets.bottom + 16 }}
              onPress={(e) => e.stopPropagation()}
            >
              <View className="flex-row items-center gap-2.5">
                <View style={{ width: 13, height: 13, borderRadius: 4, backgroundColor: zoneCard.color ?? '#6366f1' }} />
                <Text className="flex-1 text-[16px] font-bold text-white">{zoneCard.name}</Text>
                <Pressable onPress={() => setZoneCard(null)} hitSlop={10}>
                  <SymbolView name="xmark.circle.fill" tintColor="rgba(255,255,255,0.3)" size={24} resizeMode="scaleAspectFit" />
                </Pressable>
              </View>
              <Text className="text-[12px] text-white/50">
                {t.mobileField.assignedTo}{' '}
                {(teams ?? []).find((tm) => tm.id === zoneCard.assigned_team_id)?.name ?? t.mobileField.none}
                {zoneCard.created_at
                  ? ` · ${new Date(zoneCard.created_at).toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA')}`
                  : ''}
              </Text>
              {canDraw ? (
                <>
                  <Text className="text-[10px] font-semibold uppercase tracking-wider text-white/30">{t.mobileField.assignToTeam}</Text>
                  <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                    <Pressable
                      onPress={() => reassignZone(null)}
                      className={`rounded-full border px-3 py-1.5 ${!zoneCard.assigned_team_id ? 'border-indigo-400/40 bg-indigo-500/20' : 'border-white/10 bg-white/5'}`}
                    >
                      <Text className={`text-[11px] font-semibold ${!zoneCard.assigned_team_id ? 'text-indigo-300' : 'text-white/40'}`}>
                        {t.mobileField.none}
                      </Text>
                    </Pressable>
                    {(teams ?? []).map((tm) => {
                      const sel = zoneCard.assigned_team_id === tm.id;
                      return (
                        <Pressable
                          key={tm.id}
                          onPress={() => reassignZone(tm.id)}
                          className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${sel ? 'border-indigo-400/40 bg-indigo-500/20' : 'border-white/10 bg-white/5'}`}
                        >
                          {tm.color_hex ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tm.color_hex }} /> : null}
                          <Text className={`text-[11px] font-semibold ${sel ? 'text-indigo-300' : 'text-white/40'}`}>{tm.name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Pressable onPress={confirmDeleteZone} className="items-center rounded-xl border border-red-400/30 bg-red-500/10 py-3">
                    <Text className="text-[13px] font-semibold text-red-300">{t.mobileField.deleteZoneBtn}</Text>
                  </Pressable>
                </>
              ) : null}
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}
