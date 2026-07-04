import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';

import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NotificationRow,
} from '@/lib/api/notifications';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

// Where to go when a notification is tapped, based on its entity.
function routeFor(n: NotificationRow): string | null {
  if (!n.entity_id) return null;
  switch (n.entity_type) {
    case 'job':
      return `/(app)/jobs/${n.entity_id}`;
    case 'client':
      return `/(app)/clients/${n.entity_id}`;
    default:
      return null;
  }
}

export default function Notifications() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { session } = useAuth();
  const { orgId } = usePermissions();
  const userId = session?.user.id ?? '';

  const timeAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return t.mobileMisc.notificationsRelJustNow;
    if (m < 60) return t.mobileMisc.notificationsRelMinutes.replace('{n}', String(m));
    const h = Math.floor(m / 60);
    if (h < 24) return t.mobileMisc.notificationsRelHours.replace('{n}', String(h));
    return t.mobileMisc.notificationsRelDays.replace('{n}', String(Math.floor(h / 24)));
  };

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', orgId, userId],
    queryFn: () => listNotifications(orgId ?? '', userId),
    enabled: !!orgId,
  });

  const onPress = async (n: NotificationRow) => {
    if (!n.read_at) {
      await markNotificationRead(n.id);
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }
    const r = routeFor(n);
    if (r) router.push(r as any);
  };

  const markAll = async () => {
    if (!orgId) return;
    await markAllNotificationsRead(orgId);
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  return (
    <View className="flex-1 bg-surface-alt">
      {(data?.length ?? 0) > 0 ? (
        <Pressable onPress={markAll} className="items-end px-5 pb-1 pt-3">
          <Text className="text-sm font-medium text-brand">{t.mobileMisc.markAllRead}</Text>
        </Pressable>
      ) : null}

      <FlatList
        data={data ?? []}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        renderItem={({ item }) => {
          const unread = !item.read_at;
          return (
            <Pressable
              onPress={() => onPress(item)}
              className={`gap-1 rounded-2xl p-4 ${unread ? 'bg-white' : 'bg-surface-sunken'}`}
              style={{ shadowColor: '#000', shadowOpacity: unread ? 0.04 : 0, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}
            >
              <View className="flex-row items-center justify-between">
                <Text className={`text-base ${unread ? 'font-bold' : 'font-semibold'} text-ink`} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text className="text-[11px] text-ink-subtle">{timeAgo(item.created_at)}</Text>
              </View>
              {item.body ? (
                <Text className="text-sm text-ink-muted" numberOfLines={2}>
                  {item.body}
                </Text>
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          !isLoading ? (
            <View className="items-center py-16">
              <Text className="text-sm text-ink-muted">{t.mobileMisc.noNotifications}</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
