import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listCourses } from '@/lib/api/courses';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/usePermissions';

function fmtDuration(min: number): string {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

export default function Formations() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { orgId, role } = usePermissions();
  const userId = session?.user.id ?? '';
  const isAdmin = role === 'owner' || role === 'admin';

  const { data, error, isLoading } = useQuery({
    queryKey: ['courses', orgId, userId, role],
    queryFn: () => listCourses({ orgId: orgId ?? '', role, userId, isAdmin }),
    enabled: !!orgId && !!userId,
  });

  const courses = data ?? [];

  return (
    <View className="flex-1 bg-surface-alt" style={{ paddingTop: insets.top }}>
      <View className="px-5 pb-1 pt-3">
        <Text className="text-2xl font-bold text-ink">Formations</Text>
        <Text className="text-sm text-ink-muted">
          {courses.length} course{courses.length === 1 ? '' : 's'} available
        </Text>
      </View>

      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 14 }}>
        {error ? (
          <View className="rounded-3xl bg-white p-6">
            <Text className="text-sm font-semibold text-status-late">Couldn't load courses</Text>
            <Text className="mt-1 text-xs text-ink-muted">{(error as Error).message}</Text>
          </View>
        ) : null}
        {!error && !isLoading && courses.length === 0 ? (
          <View className="items-center rounded-3xl bg-white p-8">
            <SymbolView name="graduationcap" tintColor="#A3A3A3" size={40} resizeMode="scaleAspectFit" />
            <Text className="mt-2 text-sm text-ink-muted">No courses yet.</Text>
          </View>
        ) : null}
        {courses.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => router.push(`/(app)/course/${c.id}`)}
            className="overflow-hidden rounded-3xl bg-white"
            style={{ shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }}
          >
            {/* Cover */}
            <View className="h-36 w-full items-center justify-center bg-surface-sunken">
              {c.cover_image ? (
                <Image source={{ uri: c.cover_image }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : (
                <SymbolView name="graduationcap.fill" tintColor="#A3A3A3" size={40} resizeMode="scaleAspectFit" />
              )}
              {c.progress_pct > 0 ? (
                <View className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/10">
                  <View style={{ width: `${c.progress_pct}%` }} className="h-full bg-ink" />
                </View>
              ) : null}
            </View>

            <View className="p-4">
              {c.category ? (
                <Text className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">
                  {c.category}
                </Text>
              ) : null}
              <Text className="text-base font-bold text-ink" numberOfLines={1}>
                {c.title}
              </Text>
              {c.description ? (
                <Text className="mt-1 text-sm text-ink-muted" numberOfLines={2}>
                  {c.description}
                </Text>
              ) : null}

              {/* Meta */}
              <View className="mt-3 flex-row items-center gap-4">
                <Meta icon="square.stack.3d.up" text={`${c.module_count} ch.`} />
                <Meta icon="book" text={`${c.lesson_count} lessons`} />
                {c.duration_min > 0 ? <Meta icon="clock" text={fmtDuration(c.duration_min)} /> : null}
              </View>

              {/* Progress */}
              {c.progress_pct > 0 ? (
                <View className="mt-3 border-t border-surface-border pt-3">
                  <View className="mb-1 flex-row justify-between">
                    <Text className="text-xs text-ink-muted">Progress</Text>
                    <Text className={`text-xs font-bold ${c.progress_pct === 100 ? 'text-status-completed' : 'text-ink'}`}>
                      {c.progress_pct}%
                    </Text>
                  </View>
                  <View className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                    <View
                      style={{ width: `${c.progress_pct}%` }}
                      className={`h-full rounded-full ${c.progress_pct === 100 ? 'bg-status-completed' : 'bg-ink'}`}
                    />
                  </View>
                </View>
              ) : null}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function Meta({ icon, text }: { icon: string; text: string }) {
  return (
    <View className="flex-row items-center gap-1">
      <SymbolView name={icon as any} tintColor="#A3A3A3" size={13} resizeMode="scaleAspectFit" />
      <Text className="text-[11px] text-ink-muted">{text}</Text>
    </View>
  );
}
