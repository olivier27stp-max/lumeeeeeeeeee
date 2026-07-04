import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { ClientCard } from '@/components/ClientCard';
import { Input } from '@/components/ui/Input';
import { listClients } from '@/lib/api/clients';
import { useTranslation } from '@/lib/i18n';

export default function Search() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');

  // Empty query → listClients('') returns the most recent clients (updated_at desc).
  const { data, isFetching } = useQuery({
    queryKey: ['clients', 'search', q.trim()],
    queryFn: () => listClients(q),
    staleTime: 0,
    gcTime: 0,
  });

  return (
    <View className="flex-1 bg-surface-alt">
      <View className="px-5 pb-2 pt-3">
        <Input
          value={q}
          onChangeText={setQ}
          placeholder={t.mobileMisc.searchClientPlaceholder}
          autoFocus
          autoCapitalize="none"
        />
        <Text className="mt-2 text-xs text-ink-muted">
          {t.mobileMisc.searchClientHint}
        </Text>
      </View>

      <FlatList
        data={data ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        ListHeaderComponent={
          (data?.length ?? 0) > 0 ? (
            <Text className="pb-2 text-[11px] font-bold uppercase tracking-widest text-ink-subtle">
              {q.trim() ? t.mobileMisc.resultsHeader : t.mobileMisc.recentClientsHeader}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <ClientCard client={item} onPress={() => router.push(`/(app)/clients/${item.id}`)} />
        )}
        ListEmptyComponent={
          q.trim().length >= 1 && !isFetching ? (
            <View className="items-center py-12">
              <Text className="text-sm text-ink-muted">{t.mobileMisc.noClientsFound}</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
