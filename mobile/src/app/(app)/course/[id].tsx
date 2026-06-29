import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Button } from '@/components/ui/Button';
import {
  CourseModule,
  Lesson,
  getCompletedLessons,
  getCourseFull,
  markLesson,
  toEmbedUrl,
} from '@/lib/api/courses';
import { useAuth } from '@/lib/auth';

function stripHtml(s: string | null): string {
  if (!s) return '';
  return s
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function lessonIcon(l: Lesson): string {
  switch (l.content_type) {
    case 'video':
    case 'embed':
      return 'play.circle';
    case 'pdf':
      return 'doc.text';
    case 'link':
      return 'link';
    default:
      return 'text.alignleft';
  }
}

export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const { data: course, isLoading } = useQuery({
    queryKey: ['course', id],
    queryFn: () => getCourseFull(String(id)),
    enabled: !!id,
  });
  const { data: completed } = useQuery({
    queryKey: ['course', id, 'progress', userId],
    queryFn: () => getCompletedLessons(String(id), userId),
    enabled: !!id && !!userId,
  });

  const allLessons = useMemo(
    () => (course?.modules ?? []).flatMap((m) => m.lessons),
    [course],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeId && allLessons.length) setActiveId(allLessons[0].id);
  }, [allLessons, activeId]);

  const [openModules, setOpenModules] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (course?.modules?.[0]) setOpenModules(new Set([course.modules[0].id]));
  }, [course]);

  const active = allLessons.find((l) => l.id === activeId) ?? null;
  // Build a Set from the array. Only accept an array — a stale offline cache may
  // hold the old Set serialized as `{}` (non-iterable), so guard against it to
  // avoid both `{}.has is not a function` and `new Set({})` throwing.
  const doneSet = useMemo(
    () => new Set<string>(Array.isArray(completed) ? completed : []),
    [completed],
  );
  const doneCount = doneSet.size;
  const total = allLessons.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const markMut = useMutation({
    mutationFn: (vars: { lessonId: string; completed: boolean }) =>
      markLesson({ courseId: String(id), lessonId: vars.lessonId, userId, completed: vars.completed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['course', id, 'progress'] }),
  });

  if (isLoading || !course) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <ActivityIndicator color="#171717" />
      </View>
    );
  }

  const embedUrl = active ? toEmbedUrl(active.embed_url ?? active.video_url) : null;
  const isWebContent = active && (active.content_type === 'embed' || active.content_type === 'video' || active.content_type === 'pdf');
  const webSrc = active?.content_type === 'pdf' ? active.video_url : embedUrl;
  const activeDone = active ? doneSet.has(active.id) : false;

  return (
    <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" className="flex-1 bg-surface-alt" contentContainerStyle={{ paddingBottom: 32 }}>
      {/* Player */}
      <View className="aspect-video w-full bg-black">
        {isWebContent && webSrc ? (
          <WebView
            source={{ uri: webSrc }}
            allowsFullscreenVideo
            style={{ flex: 1, backgroundColor: '#000' }}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <SymbolView name={lessonIcon(active ?? ({} as Lesson)) as any} tintColor="#FFFFFF" size={48} resizeMode="scaleAspectFit" />
          </View>
        )}
      </View>

      <View className="p-5 gap-4">
        {/* Lesson header */}
        {active ? (
          <View>
            <Text className="text-xl font-bold text-ink">{active.title}</Text>
            {active.duration_min ? (
              <Text className="mt-0.5 text-xs text-ink-muted">{active.duration_min} min</Text>
            ) : null}
          </View>
        ) : null}

        {/* Text / link content */}
        {active?.content_type === 'text' ? (
          <View className="rounded-2xl bg-white p-5">
            <Text className="text-base leading-7 text-ink">{stripHtml(active.text_content)}</Text>
          </View>
        ) : null}
        {active?.content_type === 'link' && active.embed_url ? (
          <Button title="Open link" onPress={() => Linking.openURL(active.embed_url as string)} />
        ) : null}

        {/* Mark complete */}
        {active ? (
          <Pressable
            onPress={() => markMut.mutate({ lessonId: active.id, completed: !activeDone })}
            className={`flex-row items-center justify-between rounded-2xl border px-5 py-4 ${activeDone ? 'border-status-completed/30 bg-status-completed/10' : 'border-surface-border bg-white'}`}
          >
            <Text className={`text-sm font-semibold ${activeDone ? 'text-status-completed' : 'text-ink'}`}>
              {activeDone ? 'Completed' : 'Mark as complete'}
            </Text>
            <View
              className={`h-6 w-6 items-center justify-center rounded-md border-2 ${activeDone ? 'border-status-completed bg-status-completed' : 'border-surface-border'}`}
            >
              {activeDone ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={12} resizeMode="scaleAspectFit" /> : null}
            </View>
          </Pressable>
        ) : null}

        {/* Progress */}
        <View className="rounded-2xl bg-white p-5">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-sm font-bold text-ink">Your progress</Text>
            <Text className={`text-sm font-bold ${pct === 100 ? 'text-status-completed' : 'text-ink'}`}>{pct}%</Text>
          </View>
          <View className="h-2.5 overflow-hidden rounded-full bg-surface-sunken">
            <View style={{ width: `${pct}%` }} className={`h-full rounded-full ${pct === 100 ? 'bg-status-completed' : 'bg-ink'}`} />
          </View>
          <Text className="mt-2 text-xs text-ink-muted">
            {doneCount}/{total} lessons completed
          </Text>
        </View>

        {/* Modules / lessons */}
        <View className="gap-3">
          <Text className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Course content</Text>
          {course.modules.map((m: CourseModule) => {
            const open = openModules.has(m.id);
            const modDone = m.lessons.every((l) => doneSet.has(l.id)) && m.lessons.length > 0;
            return (
              <View key={m.id} className="overflow-hidden rounded-2xl bg-white">
                <Pressable
                  onPress={() =>
                    setOpenModules((s) => {
                      const n = new Set(s);
                      n.has(m.id) ? n.delete(m.id) : n.add(m.id);
                      return n;
                    })
                  }
                  className="flex-row items-center gap-3 px-4 py-3.5"
                >
                  <SymbolView
                    name={modDone ? 'checkmark.circle.fill' : 'play.circle'}
                    tintColor={modDone ? '#059669' : '#171717'}
                    size={20}
                    resizeMode="scaleAspectFit"
                  />
                  <Text className="flex-1 text-sm font-bold text-ink" numberOfLines={1}>
                    {m.title}
                  </Text>
                  <SymbolView name={open ? 'chevron.down' : 'chevron.right'} tintColor="#A3A3A3" size={13} resizeMode="scaleAspectFit" />
                </Pressable>

                {open
                  ? m.lessons.map((l) => {
                      const isActive = l.id === activeId;
                      const isDone = doneSet.has(l.id);
                      return (
                        <Pressable
                          key={l.id}
                          onPress={() => setActiveId(l.id)}
                          className={`flex-row items-center gap-3 border-t border-surface-border px-4 py-3 ${isActive ? 'bg-surface-sunken' : ''}`}
                        >
                          <SymbolView
                            name={(isDone ? 'checkmark.circle.fill' : lessonIcon(l)) as any}
                            tintColor={isDone ? '#059669' : '#A3A3A3'}
                            size={16}
                            resizeMode="scaleAspectFit"
                          />
                          <Text className={`flex-1 text-sm ${isActive ? 'font-bold text-ink' : 'text-ink-muted'}`} numberOfLines={1}>
                            {l.title}
                          </Text>
                          {l.duration_min ? (
                            <Text className="text-[11px] text-ink-subtle">{l.duration_min}m</Text>
                          ) : null}
                        </Pressable>
                      );
                    })
                  : null}
              </View>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}
