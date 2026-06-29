import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { ClientCard } from '@/components/ClientCard';
import { Input } from '@/components/ui/Input';
import { listClients } from '@/lib/api/clients';

export default function Search() {
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
          placeholder="Search a client by name, company, email…"
          autoFocus
          autoCapitalize="none"
        />
        <Text className="mt-2 text-xs text-ink-muted">
          Find a client to see their jobs, quotes and invoices.
        </Text>
      </View>

      <FlatList
        data={data ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        ListHeaderComponent={
          (data?.length ?? 0) > 0 ? (
            <Text className="pb-2 text-[11px] font-bold uppercase tracking-widest text-ink-subtle">
              {q.trim() ? 'Résultats' : 'Clients récents'}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <ClientCard client={item} onPress={() => router.push(`/(app)/clients/${item.id}`)} />
        )}
        ListEmptyComponent={
          q.trim().length >= 1 && !isFetching ? (
            <View className="items-center py-12">
              <Text className="text-sm text-ink-muted">No clients found.</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
