import { useQuery } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import { getTrackingHistory, TrackPoint } from '@/lib/api/tracking';
import { listEntriesInRange, workedMs, TimeEntryRow } from '@/lib/api/timesheets';
import { getDoorStats } from '@/lib/api/salesRep';
import { listCommissions } from '@/lib/api/commissions';
import { usePermissions } from '@/lib/usePermissions';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  manager: 'Gérant',
  technician: 'Technicien',
  sales_rep: 'Représentant',
};

type Period = 'today' | 'week' | 'month' | 'all';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: "Aujourd'hui" },
  { key: 'week', label: '7 jours' },
  { key: 'month', label: '30 jours' },
  { key: 'all', label: 'Tout' },
];

const money = (n: number) =>
  new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
function rangeFor(p: Period): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  if (p === 'today') start.setHours(0, 0, 0, 0);
  else if (p === 'week') start.setDate(start.getDate() - 7);
  else if (p === 'month') start.setDate(start.getDate() - 30);
  else start.setFullYear(2000, 0, 1);
  return { start, end };
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 rounded-2xl bg-white p-4">
      <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{label}</Text>
      <Text className="mt-1 text-xl font-bold text-ink">{value}</Text>
    </View>
  );
}

/** A team member's full history/profile, filterable by period. */
export default function TechDetail() {
  const { orgId, role } = usePermissions();
  const isManager = role === 'owner' || role === 'admin';
  const { id, name, role: techRole } = useLocalSearchParams<{ id: string; name?: string; role?: string }>();
  const [period, setPeriod] = useState<Period>('today');

  const { start, end } = useMemo(() => rangeFor(period), [period]);
  const startDate = localDate(start);
  const endDate = localDate(end);
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  const { data: entries } = useQuery({
    queryKey: ['tech', 'entries', id, startDate, endDate],
    queryFn: () => listEntriesInRange(String(id), startDate, endDate),
    enabled: !!id,
  });
  const { data: points } = useQuery({
    queryKey: ['tech', 'points', orgId, id, startISO, endISO],
    queryFn: () => getTrackingHistory(orgId ?? '', String(id), startISO, endISO),
    enabled: !!orgId && !!id,
  });
  const { data: doors } = useQuery({
    queryKey: ['tech', 'doors', orgId, id, startISO],
    queryFn: () => getDoorStats(orgId ?? '', String(id), startISO),
    enabled: !!orgId && !!id,
  });
  const { data: commissions } = useQuery({
    queryKey: ['tech', 'commissions', orgId, id],
    queryFn: () => listCommissions(orgId ?? '', String(id)),
    enabled: !!orgId && !!id,
  });

  const pts = points ?? [];
  const trail = pts.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
  const distanceKm = useMemo(() => {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += haversineKm(pts[i - 1], pts[i]);
    return d;
  }, [pts]);
  const workedTotal = (entries ?? []).reduce((s, e) => s + workedMs(e), 0);
  const commTotal = (commissions ?? [])
    .filter((c) => new Date(c.created_at) >= start)
    .reduce((s, c) => s + (Number(c.amount) || 0), 0);

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

  const hasDoors = (doors?.total ?? 0) > 0;

  return (
    <ScrollView
      className="flex-1 bg-surface-alt"
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 12 }}
    >
      {/* Header */}
      <View className="flex-row items-center gap-3">
        <UnifiedAvatar id={String(id)} name={String(name || '—')} size={52} />
        <View className="flex-1">
          <Text className="text-xl font-bold text-ink">{name || '—'}</Text>
          <Text className="text-xs text-ink-muted">{ROLE_LABEL[String(techRole)] ?? techRole}</Text>
        </View>
      </View>

      {/* Period selector */}
      <View className="flex-row rounded-2xl bg-surface-sunken p-1">
        {PERIODS.map((p) => {
          const sel = period === p.key;
          return (
            <Pressable
              key={p.key}
              onPress={() => setPeriod(p.key)}
              className={`flex-1 items-center rounded-xl py-2 ${sel ? 'bg-white' : ''}`}
            >
              <Text className={`text-xs font-semibold ${sel ? 'text-ink' : 'text-ink-muted'}`}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* KPIs */}
      <View className="flex-row gap-3">
        <Kpi label="Heures" value={fmtHM(workedTotal)} />
        <Kpi label="Distance" value={`${distanceKm.toFixed(1)} km`} />
      </View>
      {hasDoors || commTotal > 0 ? (
        <View className="flex-row gap-3">
          {hasDoors ? <Kpi label="Portes" value={String(doors?.knocks ?? 0)} /> : null}
          {hasDoors ? <Kpi label="Ventes" value={String(doors?.sales ?? 0)} /> : null}
          {commTotal > 0 ? <Kpi label="Commissions" value={money(commTotal)} /> : null}
        </View>
      ) : null}

      {/* Route map */}
      {region ? (
        <View className="h-64 overflow-hidden rounded-3xl border border-surface-border">
          <MapView style={{ flex: 1 }} initialRegion={region} userInterfaceStyle="light">
            {trail.length > 1 ? <Polyline coordinates={trail} strokeColor="#2563EB" strokeWidth={4} /> : null}
            {trail.length > 0 ? <Marker coordinate={trail[0]} title="Début" pinColor="green" /> : null}
            {trail.length > 1 ? <Marker coordinate={trail[trail.length - 1]} title="Fin" pinColor="red" /> : null}
          </MapView>
        </View>
      ) : (
        <View className="items-center rounded-3xl bg-white p-8">
          <SymbolView name="map" tintColor="#A3A3A3" size={32} resizeMode="scaleAspectFit" />
          <Text className="mt-2 text-sm text-ink-muted">Aucune position enregistrée pour cette période.</Text>
        </View>
      )}

      {/* Pointages */}
      <Text className="px-1 pt-1 text-[10px] font-bold uppercase tracking-widest text-ink-subtle">Pointages</Text>
      {(entries ?? []).length === 0 ? (
        <Text className="px-1 text-sm text-ink-muted">Aucun pointage pour cette période.</Text>
      ) : (
        (entries ?? []).map((e: TimeEntryRow) => (
          <View key={e.id} className="rounded-2xl bg-white p-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-semibold text-ink">
                {fmtClock(e.punch_in_at)} → {e.punch_out_at ? fmtClock(e.punch_out_at) : 'en cours'}
              </Text>
              <Text className="text-sm font-bold text-ink">{fmtHM(workedMs(e))}</Text>
            </View>
            <Text className="mt-0.5 text-xs text-ink-muted">
              {e.punch_in_at ? new Date(e.punch_in_at).toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' }) : ''}
              {(e.breaks?.length ?? 0) > 0 ? ` · ${e.breaks.length} pause${e.breaks.length === 1 ? '' : 's'}` : ''}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}
