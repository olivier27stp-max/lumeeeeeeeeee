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
  HouseEventType,
  HouseStatus,
  listHousesInBounds,
  listTerritories,
  logHouseEvent,
} from '@/lib/api/fieldSales';
import { listTeams } from '@/lib/api/org';
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
const EVENT_STATUSES = new Set(['sale', 'lead', 'quote_sent', 'callback', 'revisit', 'no_answer', 'do_not_knock']);

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

  const [pickerMode, setPickerMode] = useState<'place' | 'edit' | null>(null);
  const [editHouseId, setEditHouseId] = useState<string | null>(null);
  const [armed, setArmed] = useState<HouseStatus | null>(null);
  const [drawing, setDrawing] = useState(false);

  const [zoneCoords, setZoneCoords] = useState<[number, number][] | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [zoneTeam, setZoneTeam] = useState<string | null>(null);

  // Filters (like the web's filter panel, as a bottom sheet)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeBuckets, setActiveBuckets] = useState<Set<string>>(new Set(ALL_BUCKETS));
  const [showZones, setShowZones] = useState(true);
  const [showReps, setShowReps] = useState(true);

  // Street search (Mapbox geocoding, like the web's top-center search)
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
          // Live GPS: keep the blue "me" dot moving, like the web's watchPosition
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

  // Colored per-status counts for the top bar (web's top-right stats)
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (houses ?? []).forEach((h) => {
      const b = STATUS_TO_BUCKET[h.current_status ?? ''] ?? 'other';
      c[b] = (c[b] ?? 0) + 1;
    });
    return c;
  }, [houses]);

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

  // Place a brand-new pin at a tapped location (web flow: choose status → tap map).
  const placePin = async (lat: number, lng: number) => {
    const house = armed;
    setArmed(null);
    mapRef.current?.stopPlace();
    if (!house || !orgId || !userId) return;
    try {
      const created = await createHouseAt({ orgId, userId, lat, lng, status: house });
      refetch();
      crmFor(house, created.address ?? '');
    } catch (e) {
      Alert.alert(t.mobileField.pin, (e as Error).message);
    }
  };

  // Recolor an existing pin.
  const recolor = async (house: HouseStatus) => {
    const id = editHouseId;
    setPickerMode(null);
    setEditHouseId(null);
    if (!id || !orgId || !userId) return;
    try {
      const isEvent = EVENT_STATUSES.has(house);
      await logHouseEvent({
        orgId,
        houseId: id,
        userId,
        eventType: (isEvent ? house : 'status_change') as HouseEventType,
        statusOverride: isEvent ? null : house,
      });
      refetch();
      crmFor(house, houses?.find((h) => h.id === id)?.address ?? '');
    } catch (e) {
      Alert.alert(t.mobileField.pin, (e as Error).message);
    }
  };

  const onChip = (house: HouseStatus) => {
    if (pickerMode === 'place') {
      setArmed(house);
      setPickerMode(null);
      mapRef.current?.startPlace();
    } else if (pickerMode === 'edit') {
      recolor(house);
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

  const idle = !pickerMode && !armed && !drawing;

  return (
    <View className="flex-1">
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
          // history, schedule a visit) — not just a colour change.
          router.push(`/(app)/d2d-house/${id}` as any);
        }}
        onPlace={placePin}
        onZoneDrawn={(c) => {
          setDrawing(false);
          setZoneCoords(c);
        }}
        onCenterChange={(lat, lng) => setMapCenter({ lat, lng })}
      />

      {/* Top: street search + colored status counts (web's search bar + stats) */}
      <View className="absolute left-5 right-5" style={{ top: insets.top + 8 }}>
        <View
          className="flex-row items-center rounded-xl bg-white/95 px-3"
          style={{ shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6 }}
        >
          <SymbolView name="magnifyingglass" tintColor="#737373" size={16} resizeMode="scaleAspectFit" />
          <TextInput
            value={searchQ}
            onChangeText={setSearchQ}
            placeholder={t.mobileField.searchAddressPlaceholder}
            placeholderTextColor="#A3A3A3"
            autoCorrect={false}
            className="flex-1 px-2 py-2.5 text-sm text-ink"
          />
          {searchQ ? (
            <Pressable onPress={() => { setSearchQ(''); setSearchResults([]); }} hitSlop={8}>
              <SymbolView name="xmark.circle.fill" tintColor="#A3A3A3" size={18} resizeMode="scaleAspectFit" />
            </Pressable>
          ) : null}
        </View>
        {searchResults.length > 0 ? (
          <View className="mt-1 overflow-hidden rounded-xl bg-white/95" style={{ shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6 }}>
            {searchResults.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => {
                  mapRef.current?.flyTo(r.center[1], r.center[0], 17);
                  setSearchQ('');
                  setSearchResults([]);
                  Keyboard.dismiss();
                }}
                className="border-b border-surface-border/50 px-3 py-2.5"
              >
                <Text className="text-[13px] text-ink" numberOfLines={1}>{r.place_name}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View
          className="mt-2 flex-row items-center gap-3 self-start rounded-xl bg-white/90 px-3 py-1.5"
          style={{ shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6 }}
        >
          {PIN_STATUSES.filter((s) => counts[s.bucket]).map((s) => (
            <View key={s.bucket} className="flex-row items-center gap-1">
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
              <Text className="text-xs font-bold text-ink">{counts[s.bucket]}</Text>
            </View>
          ))}
          <Text className="text-xs font-medium text-ink-muted">
            {t.mobileField.housesZonesSummary
              .replace('{houses}', String(houses?.length ?? 0))
              .replace('{zones}', String(zones?.length ?? 0))}
          </Text>
        </View>
      </View>

      {!ready ? (
        <View className="absolute inset-0 items-center justify-center bg-black/40">
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}

      {/* Big native buttons (bottom-right) */}
      {idle ? (
        <View className="absolute right-5 gap-3" style={{ bottom: insets.bottom + 24 }}>
          <Pressable
            onPress={() => setFiltersOpen(true)}
            className="h-12 w-12 items-center justify-center self-end rounded-full bg-white"
            style={{ shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}
          >
            <SymbolView name="line.3.horizontal.decrease" tintColor="#171717" size={20} resizeMode="scaleAspectFit" />
          </Pressable>
          <Pressable
            onPress={recenter}
            className="h-12 w-12 items-center justify-center self-end rounded-full bg-white"
            style={{ shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}
          >
            <SymbolView name="location.fill" tintColor="#2563EB" size={20} resizeMode="scaleAspectFit" />
          </Pressable>
          {canDraw ? (
            <Pressable
              onPress={() => {
                mapRef.current?.startZoneDraw();
                setDrawing(true);
              }}
              className="h-16 w-16 items-center justify-center rounded-full bg-white"
              style={{ shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}
            >
              <SymbolView name="square.dashed" tintColor="#171717" size={28} resizeMode="scaleAspectFit" />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setPickerMode('place')}
            className="h-16 w-16 items-center justify-center rounded-full bg-ink"
            style={{ shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}
          >
            <SymbolView name="plus" tintColor="#FFFFFF" size={30} resizeMode="scaleAspectFit" />
          </Pressable>
        </View>
      ) : null}

      {/* "Tap the map to place" banner */}
      {armed ? (
        <View className="absolute left-5 right-5 flex-row items-center gap-3" style={{ bottom: insets.bottom + 24 }}>
          <View className="flex-1 rounded-xl bg-white/90 px-4 py-3">
            <Text className="text-sm font-medium text-ink">{t.mobileField.tapHouseOnMap}</Text>
          </View>
          <Pressable
            onPress={() => {
              setArmed(null);
              mapRef.current?.stopPlace();
            }}
            className="h-12 items-center justify-center rounded-full bg-white px-4"
          >
            <Text className="text-sm font-semibold text-ink">{t.mobileField.cancel}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Zone drawing controls */}
      {drawing ? (
        <View className="absolute left-5 right-5 flex-row items-center gap-3" style={{ bottom: insets.bottom + 24 }}>
          <View className="flex-1 rounded-xl bg-white/90 px-4 py-3">
            <Text className="text-sm font-medium text-ink">{t.mobileField.tapCornersThenFinish}</Text>
          </View>
          <Pressable
            onPress={() => {
              mapRef.current?.cancelZoneDraw();
              setDrawing(false);
            }}
            className="h-12 items-center justify-center rounded-full bg-white px-4"
          >
            <Text className="text-sm font-semibold text-ink">{t.mobileField.cancel}</Text>
          </Pressable>
          <Pressable
            onPress={() => mapRef.current?.finishZoneDraw()}
            className="h-12 items-center justify-center rounded-full bg-ink px-5"
          >
            <Text className="text-sm font-semibold text-white">{t.mobileField.finish}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Status strip (choose to place / recolor) */}
      {pickerMode ? (
        <View
          className="absolute left-0 right-0 rounded-t-3xl bg-white px-4 pt-4"
          style={{ bottom: 0, paddingBottom: insets.bottom + 14, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12 }}
        >
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-base font-bold text-ink">
              {pickerMode === 'place' ? t.mobileField.pickStatusThenTapMap : t.mobileField.changeStatus}
            </Text>
            <Pressable
              onPress={() => {
                setPickerMode(null);
                setEditHouseId(null);
              }}
              hitSlop={10}
            >
              <SymbolView name="xmark.circle.fill" tintColor="#A3A3A3" size={24} resizeMode="scaleAspectFit" />
            </Pressable>
          </View>
          <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 4 }}>
            {pickerMode === 'edit' && editHouseId ? (
              <Pressable
                onPress={() => {
                  const id = editHouseId;
                  setPickerMode(null);
                  setEditHouseId(null);
                  router.push(`/(app)/d2d-house/${id}` as any);
                }}
                className="w-[72px] items-center gap-1"
              >
                <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-sunken">
                  <SymbolView name="doc.text" tintColor="#171717" size={22} resizeMode="scaleAspectFit" />
                </View>
                <Text className="text-center text-[11px] text-ink-muted">{t.mobileField.record}</Text>
              </Pressable>
            ) : null}
            {PIN_STATUSES.map((s) => (
              <Pressable key={s.house} onPress={() => onChip(s.house)} className="w-[72px] items-center gap-1">
                <View
                  className="h-12 w-12 rounded-full border-2 border-white"
                  style={{ backgroundColor: s.color, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4 }}
                />
                <Text className="text-center text-[11px] text-ink-muted">{t.mobileField[s.labelKey]}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Filters bottom sheet (web's filter panel, phone-adapted) */}
      <Modal visible={filtersOpen} transparent animationType="slide" onRequestClose={() => setFiltersOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setFiltersOpen(false)}>
          <Pressable
            className="rounded-t-3xl bg-white px-5 pt-5"
            style={{ paddingBottom: insets.bottom + 16 }}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-lg font-bold text-ink">{t.mobileField.filters}</Text>
              <Pressable onPress={() => setFiltersOpen(false)} hitSlop={10}>
                <SymbolView name="xmark.circle.fill" tintColor="#A3A3A3" size={24} resizeMode="scaleAspectFit" />
              </Pressable>
            </View>

            {/* Pins — status */}
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{t.mobileField.pinsStatusHeader}</Text>
              <Pressable
                onPress={() =>
                  setActiveBuckets(activeBuckets.size === ALL_BUCKETS.length ? new Set() : new Set(ALL_BUCKETS))
                }
                hitSlop={8}
              >
                <Text className="text-xs font-medium text-ink-muted">
                  {activeBuckets.size === ALL_BUCKETS.length ? t.mobileField.deselectAll : t.mobileField.selectAll}
                </Text>
              </Pressable>
            </View>
            <View className="mb-4 flex-row flex-wrap gap-2">
              {PIN_STATUSES.map((s) => {
                const on = activeBuckets.has(s.bucket);
                return (
                  <Pressable
                    key={s.bucket}
                    onPress={() => toggleBucket(s.bucket)}
                    className={`flex-row items-center gap-1.5 rounded-full border px-3 py-2 ${on ? 'border-ink bg-ink' : 'border-surface-border'}`}
                  >
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
                    <Text className={`text-sm font-medium ${on ? 'text-white' : 'text-ink'}`}>
                      {t.mobileField[s.labelKey]}
                      {counts[s.bucket] ? ` · ${counts[s.bucket]}` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Zones toggle */}
            <Pressable
              onPress={() => setShowZones(!showZones)}
              className="mb-2 flex-row items-center justify-between rounded-xl bg-surface-sunken px-4 py-3"
            >
              <Text className="text-sm font-medium text-ink">{t.mobileField.showZonesFilter}</Text>
              <SymbolView
                name={showZones ? 'checkmark.circle.fill' : 'circle'}
                tintColor={showZones ? '#6366F1' : '#A3A3A3'}
                size={22}
                resizeMode="scaleAspectFit"
              />
            </Pressable>

            {/* Reps toggle */}
            <Pressable
              onPress={() => setShowReps(!showReps)}
              className="flex-row items-center justify-between rounded-xl bg-surface-sunken px-4 py-3"
            >
              <View className="flex-row items-center gap-2">
                <Text className="text-sm font-medium text-ink">{t.mobileField.showRepsFilter}</Text>
                <Text className="text-xs font-semibold text-emerald-600">
                  {t.mobileField.repsOnline.replace('{count}', String(onlineReps.length))}
                </Text>
              </View>
              <SymbolView
                name={showReps ? 'checkmark.circle.fill' : 'circle'}
                tintColor={showReps ? '#22C55E' : '#A3A3A3'}
                size={22}
                resizeMode="scaleAspectFit"
              />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* New zone (admin/owner): name + assign team */}
      <Modal visible={!!zoneCoords} transparent animationType="slide" onRequestClose={closeZone}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={closeZone}>
          <Pressable className="gap-3 rounded-t-3xl bg-white p-5" onPress={(e) => e.stopPropagation()}>
            <Text className="text-lg font-bold text-ink">{t.mobileField.newZone}</Text>
            <TextInput
              value={zoneName}
              onChangeText={setZoneName}
              placeholder={t.mobileField.zoneNamePlaceholder}
              className="rounded-xl border border-surface-border px-4 py-3 text-base text-ink"
            />
            <Text className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{t.mobileField.assignToTeam}</Text>
            <View className="flex-row flex-wrap gap-2">
              <Pressable
                onPress={() => setZoneTeam(null)}
                className={`rounded-full border px-3.5 py-2 ${zoneTeam === null ? 'border-ink bg-ink' : 'border-surface-border'}`}
              >
                <Text className={`text-sm font-medium ${zoneTeam === null ? 'text-white' : 'text-ink'}`}>{t.mobileField.none}</Text>
              </Pressable>
              {(teams ?? []).map((t) => {
                const sel = zoneTeam === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => setZoneTeam(t.id)}
                    className={`flex-row items-center gap-1.5 rounded-full border px-3.5 py-2 ${sel ? 'border-ink bg-ink' : 'border-surface-border'}`}
                  >
                    {t.color_hex ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color_hex }} /> : null}
                    <Text className={`text-sm font-medium ${sel ? 'text-white' : 'text-ink'}`}>{t.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={saveZone}
              disabled={!zoneName.trim()}
              className={`mt-1 items-center rounded-xl py-3.5 ${zoneName.trim() ? 'bg-ink' : 'bg-surface-border'}`}
            >
              <Text className="text-base font-semibold text-white">{t.mobileField.saveZone}</Text>
            </Pressable>
            <Pressable onPress={closeZone} className="items-center py-1">
              <Text className="text-sm font-medium text-ink-muted">{t.mobileField.cancel}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
