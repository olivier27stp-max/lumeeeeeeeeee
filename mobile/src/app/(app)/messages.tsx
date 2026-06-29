import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { Input } from '@/components/ui/Input';
import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import { ConversationRow, listConversations } from '@/lib/api/messaging';
import { usePermissions } from '@/lib/usePermissions';

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function Messages() {
  const { orgId } = usePermissions();
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['conversations', orgId, q.trim()],
    queryFn: () => listConversations(orgId ?? '', q),
    enabled: !!orgId,
  });

  const open = (c: ConversationRow) => {
    const name = c.client_name || c.phone_number;
    router.push(
      `/(app)/conversation/${c.id}?phone=${encodeURIComponent(c.phone_number)}&name=${encodeURIComponent(
        name,
      )}&clientId=${encodeURIComponent(c.client_id ?? '')}`,
    );
  };

  return (
    <View className="flex-1 bg-surface-alt">
      <View className="px-5 pb-2 pt-3">
        <Input
          value={q}
          onChangeText={setQ}
          placeholder="Rechercher un client ou une conversation…"
          autoCapitalize="none"
        />
      </View>

      <FlatList
        data={data ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        renderItem={({ item }) => {
          const name = item.client_name || item.phone_number;
          const unread = (item.unread_count ?? 0) > 0;
          return (
            <Pressable
              onPress={() => open(item)}
              className="flex-row items-center gap-3 rounded-2xl bg-white p-3"
              style={{ shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}
            >
              <UnifiedAvatar id={item.client_id || item.id} name={name} size={44} />
              <View className="flex-1">
                <View className="flex-row items-center justify-between">
                  <Text className={`text-base ${unread ? 'font-bold' : 'font-semibold'} text-ink`} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text className="text-xs text-ink-muted">{timeAgo(item.last_message_at)}</Text>
                </View>
                <Text
                  className={`text-sm ${unread ? 'text-ink' : 'text-ink-muted'}`}
                  numberOfLines={1}
                >
                  {item.last_message_text || 'Aucun message'}
                </Text>
              </View>
              {unread ? <View className="h-2.5 w-2.5 rounded-full bg-brand" /> : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          !isLoading ? (
            <View className="items-center py-16">
              <Text className="text-sm text-ink-muted">Aucune conversation.</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
