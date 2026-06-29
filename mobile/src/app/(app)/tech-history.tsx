import { useQuery } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Redirect } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

import { listMembers } from '@/lib/api/org';
import { getTrackingHistory, TrackPoint } from '@/lib/api/tracking';
import { listEntriesInRange, workedMs, TimeEntryRow } from '@/lib/api/timesheets';
import { usePermissions } from '@/lib/usePermissions';

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtClock(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtHM(ms: number): string {
  const min = Math.floor(ms / 60000);
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}
function haversineKm(a: TrackPoint, b: TrackPoint): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const la1 = (a.latitude * Math.PI) / 180;
  const la2 = (b.latitude * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

export default function TechHistory() {
  const { orgId, role } = usePermissions();
  const isManager = role === 'owner' || role === 'admin';
  const [userId, setUserId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => new Date());

  const { data: members } = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => listMembers(orgId ?? ''),
    enabled: !!orgId && isManager,
  });

  // Default to the first member once loaded.
  const selected = userId ?? members?.[0]?.user_id ?? null;
  const dayStr = localDate(cursor);

  const { data: points } = useQuery({
    queryKey: ['tracking', 'history', orgId, selected, dayStr],
    queryFn: () => {
      const s = new Date(cursor); s.setHours(0, 0, 0, 0);
      const e = new Date(cursor); e.setHours(23, 59, 59, 999);
      return getTrackingHistory(orgId ?? '', selected ?? '', s.toISOString(), e.toISOString());
    },
    enabled: !!orgId && !!selected,
  });
  const { data: entries } = useQuery({
    queryKey: ['timesheet', 'history', selected, dayStr],
    queryFn: () => listEntriesInRange(selected ?? '', dayStr, dayStr),
    enabled: !!selected,
  });

  const pts = points ?? [];
  const trail = pts.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
  const distanceKm = useMemo(() => {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += haversineKm(pts[i - 1], pts[i]);
    return d;
  }, [pts]);
  const workedTotal = (entries ?? []).reduce((s, e) => s + workedMs(e), 0);

  const region =
    trail.length > 0
      ? {
          latitude: trail.reduce((s, p) => s + p.latitude, 0) / trail.length,
          longitude: trail.reduce((s, p) => s + p.longitude, 0) / trail.length,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }
      : null;

  if (!isManager) return <Redirect href="/(app)/(tabs)" />;

  return (
    <View className="flex-1 bg-surface-alt">
      {/* Technician picker */}
      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}
      >
        {(members ?? []).map((m) => {
          const sel = selected === m.user_id;
          return (
            <Pressable
              key={m.user_id}
              onPress={() => setUserId(m.user_id)}
              className={`rounded-full px-3.5 py-1.5 ${sel ? 'bg-ink' : 'bg-white'}`}
            >
              <Text className={`text-sm font-medium ${sel ? 'text-white' : 'text-ink'}`} numberOfLines={1}>
                {m.full_name ?? '—'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Day nav */}
      <View className="flex-row items-center justify-between px-5 pb-2">
        <Pressable onPress={() => setCursor((c) => addDays(c, -1))} className="h-9 w-9 items-center justify-center rounded-full bg-white">
          <SymbolView name="chevron.left" tintColor="#171717" size={16} resizeMode="scaleAspectFit" />
        </Pressable>
        <Text className="text-sm font-semibold capitalize text-ink">
          {cursor.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' })}
        </Text>
        <Pressable onPress={() => setCursor((c) => addDays(c, 1))} className="h-9 w-9 items-center justify-center rounded-full bg-white">
          <SymbolView name="chevron.right" tintColor="#171717" size={16} resizeMode="scaleAspectFit" />
        </Pressable>
      </View>

      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 12 }}>
        {/* Summary */}
        <View className="flex-row gap-3">
          <View className="flex-1 rounded-2xl bg-white p-4">
            <Text className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Heures</Text>
            <Text className="mt-1 text-xl font-bold text-ink">{fmtHM(workedTotal)}</Text>
          </View>
          <View className="flex-1 rounded-2xl bg-white p-4">
            <Text className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Distance</Text>
            <Text className="mt-1 text-xl font-bold text-ink">{distanceKm.toFixed(1)} km</Text>
          </View>
        </View>

        {/* Route map */}
        {region ? (
          <View className="h-64 overflow-hidden rounded-3xl border border-surface-border">
            <MapView style={{ flex: 1 }} initialRegion={region} userInterfaceStyle="light">
              {trail.length > 1 ? <Polyline coordinates={trail} strokeColor="#2563EB" strokeWidth={4} /> : null}
              {trail.length > 0 ? (
                <Marker coordinate={trail[0]} title="Début" pinColor="green" />
              ) : null}
              {trail.length > 1 ? (
                <Marker coordinate={trail[trail.length - 1]} title="Fin" pinColor="red" />
              ) : null}
            </MapView>
          </View>
        ) : (
          <View className="items-center rounded-3xl bg-white p-8">
            <SymbolView name="map" tintColor="#A3A3A3" size={32} resizeMode="scaleAspectFit" />
            <Text className="mt-2 text-sm text-ink-muted">Aucune position enregistrée ce jour.</Text>
          </View>
        )}

        {/* Time entries */}
        <Text className="px-1 pt-1 text-xs font-bold uppercase tracking-widest text-ink-subtle">Pointages</Text>
        {(entries ?? []).length === 0 ? (
          <Text className="px-1 text-sm text-ink-muted">Aucun pointage ce jour.</Text>
        ) : (
          (entries ?? []).map((e: TimeEntryRow) => (
            <View key={e.id} className="rounded-2xl bg-white p-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-base font-semibold text-ink">
                  {fmtClock(e.punch_in_at)} → {e.punch_out_at ? fmtClock(e.punch_out_at) : 'en cours'}
                </Text>
                <Text className="text-sm font-bold text-ink">{fmtHM(workedMs(e))}</Text>
              </View>
              {(e.breaks?.length ?? 0) > 0 ? (
                <Text className="mt-1 text-xs text-ink-muted">
                  {e.breaks.length} pause{e.breaks.length === 1 ? '' : 's'}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
