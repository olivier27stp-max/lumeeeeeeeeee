import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { JobCard } from '@/components/JobCard';
import { Button } from '@/components/ui/Button';
import { listJobsInRange } from '@/lib/api/jobs';
import { Job } from '@/types/db';
import { usePermissions } from '@/lib/usePermissions';

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function dayKey(iso: string | null): string {
  if (!iso) return 'unscheduled';
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function ScheduleScreen() {
  const { teamId, scope, permissions, role, canSeePricing, orgId } = usePermissions();
  const access = { teamId, scope, permissions, role };
  const [weekOffset, setWeekOffset] = useState(0);

  const weekStart = useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const { data: jobs } = useQuery({
    queryKey: ['jobs', 'week', orgId, role, teamId, weekStart.toISOString()],
    queryFn: () =>
      listJobsInRange(weekStart.toISOString(), weekEnd.toISOString(), access),
    enabled: !!orgId,
  });

  const byDay = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const j of jobs ?? []) {
      const k = dayKey(j.scheduled_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(j);
    }
    return map;
  }, [jobs]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const navigateDay = (dayJobs: Job[]) => {
    const stops = dayJobs
      .map((j) => j.property_address)
      .filter((a): a is string => !!a);
    if (stops.length === 0) return;
    // Google Maps multi-stop: origin current location, waypoints, last as destination.
    const dest = encodeURIComponent(stops[stops.length - 1]);
    const waypoints = stops.slice(0, -1).map(encodeURIComponent).join('|');
    const url =
      `https://www.google.com/maps/dir/?api=1&destination=${dest}` +
      (waypoints ? `&waypoints=${waypoints}` : '');
    Linking.openURL(url);
  };

  const label = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  return (
    <ScrollView className="flex-1 bg-surface-alt">
      <View className="p-5 gap-4">
        <View className="flex-row items-center justify-between">
          <Pressable onPress={() => setWeekOffset((w) => w - 1)} className="px-3 py-2">
            <Text className="text-2xl text-brand">‹</Text>
          </Pressable>
          <Text className="text-base font-semibold text-ink">{label}</Text>
          <Pressable onPress={() => setWeekOffset((w) => w + 1)} className="px-3 py-2">
            <Text className="text-2xl text-brand">›</Text>
          </Pressable>
        </View>

        {days.map((d, i) => {
          const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          const dayJobs = byDay.get(k) ?? [];
          const isToday = k === `${new Date().getFullYear()}-${new Date().getMonth()}-${new Date().getDate()}`;
          return (
            <View key={k} className="gap-2">
              <View className="flex-row items-center justify-between">
                <Text className={`text-sm font-semibold ${isToday ? 'text-brand' : 'text-ink-muted'}`}>
                  {DAY_NAMES[i]} {d.getDate()} {isToday ? '• Today' : ''}
                </Text>
                {dayJobs.length > 1 ? (
                  <Pressable onPress={() => navigateDay(dayJobs)}>
                    <Text className="text-xs text-brand">Route ({dayJobs.length}) ›</Text>
                  </Pressable>
                ) : null}
              </View>
              {dayJobs.length === 0 ? (
                <Text className="text-xs text-ink-subtle pl-1">—</Text>
              ) : (
                dayJobs.map((j) => (
                  <JobCard
                    key={j.id}
                    job={j}
                    showPricing={canSeePricing}
                    onPress={() => router.push(`/(app)/jobs/${j.id}`)}
                  />
                ))
              )}
            </View>
          );
        })}

        <Button title="Close" variant="ghost" onPress={() => router.back()} />
      </View>
    </ScrollView>
  );
}
