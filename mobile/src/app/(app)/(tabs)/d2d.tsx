import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import D2DWebMap, { D2DWebMapHandle } from '@/components/D2DWebMap';
import {
  createHouseAt,
  createTerritory,
  HouseStatus,
  listHousesInBounds,
  listTerritories,
} from '@/lib/api/fieldSales';
import { listTeams } from '@/lib/api/org';
import { deleteFieldHouse } from '@/lib/api/server';
import { getActiveLiveLocations } from '@/lib/api/tracking';
import { useAuth } from '@/lib/auth';
import { useTranslation, type TranslationKeys } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

const DEFAULT = { lat: 45.5019, lng: -73.5674 };
const ZONE_COLORS = ['#6366F1', '#16A34A', '#DC2626', '#CA8A04', '#0D9488', '#7C3AED', '#DB2777', '#EA580C'];
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
  const { data: teams } = useQuery({
    queryKey: ['teams', orgId],
    queryFn: () => listTeams(orgId ?? ''),
    enabled: !!orgId && canDraw,
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

  // Colored per-status counts for the stats pill (web's top-right stats)
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (houses ?? []).forEach((h) => {
      const b = STATUS_TO_BUCKET[h.current_status ?? ''] ?? 'other';
      c[b] = (c[b] ?? 0) + 1;
    });
    return c;
  }, [houses]);
  const totalPins = houses?.length ?? 0;
  const totalZones = zones?.length ?? 0;

  // Stable references — a re-render (e.g. typing in the search bar) must not
  // re-inject houses/reps into the WebView and rebuild every marker.
  const mapHouses = useMemo(
    () => (houses ?? []).map((h) => ({ id: h.id, lat: h.lat, lng: h.lng, status: h.current_status })),
    [houses],
  );
  const mapZones = useMemo(() => zones ?? [], [zones]);
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

  const darkBtn = 'flex-row items-center gap-2 rounded-xl border border-white/10 bg-black/60 px-4 py-2.5';
  const darkBtnText = 'text-[13px] font-semibold text-white/80';

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
        onSelectHouse={(id) => {
          // Like the web popup: open the full pin sheet (status, customer, notes,
          // history, schedule a visit).
          router.push(`/(app)/d2d-house/${id}` as any);
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

        {/* Action buttons row (same buttons as web, dark translucent) */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" className="mt-2" contentContainerStyle={{ gap: 8 }}>
          {mode === 'view' ? (
            <>
              <Pressable onPress={enterAddPin} className={darkBtn}>
                <SymbolView name="plus" tintColor="rgba(255,255,255,0.8)" size={14} resizeMode="scaleAspectFit" />
                <Text className={darkBtnText}>{t.mobileField.addPin}</Text>
              </Pressable>
              <Pressable onPress={enterSelect} className={darkBtn}>
                <SymbolView name="rectangle.dashed" tintColor="rgba(255,255,255,0.8)" size={14} resizeMode="scaleAspectFit" />
                <Text className={darkBtnText}>{t.mobileField.selectMode}</Text>
              </Pressable>
              {canDraw ? (
                <Pressable onPress={enterDraw} className="flex-row items-center gap-2 rounded-xl border border-indigo-400/20 bg-indigo-500/15 px-4 py-2.5">
                  <SymbolView name="hexagon" tintColor="#A5B4FC" size={14} resizeMode="scaleAspectFit" />
                  <Text className="text-[13px] font-semibold text-indigo-300">{t.mobileField.createZone}</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => setFiltersOpen(true)} className={darkBtn}>
                <SymbolView name="line.3.horizontal.decrease" tintColor="rgba(255,255,255,0.8)" size={14} resizeMode="scaleAspectFit" />
                <Text className={darkBtnText}>{t.mobileField.filters}</Text>
              </Pressable>
            </>
          ) : null}

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
            style={{ paddingBottom: insets.bottom + 16 }}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-[15px] font-semibold text-white">{t.mobileField.filters}</Text>
              <Pressable onPress={() => setFiltersOpen(false)} hitSlop={10}>
                <SymbolView name="xmark.circle.fill" tintColor="rgba(255,255,255,0.3)" size={24} resizeMode="scaleAspectFit" />
              </Pressable>
            </View>

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
                  </Pressable>
                );
              })}
            </View>

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
    </View>
  );
}
