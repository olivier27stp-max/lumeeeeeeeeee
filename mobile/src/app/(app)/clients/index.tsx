import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { ClientCard } from '@/components/ClientCard';
import { Input } from '@/components/ui/Input';
import { listClients } from '@/lib/api/clients';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

/** "Dossiers clients" — browse/search every client folder (opened from More). */
export default function ClientsIndex() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const { canCreateClients } = usePermissions();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['clients', search],
    queryFn: () => listClients(search),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <View className="flex-1 bg-surface-alt">
      <View className="flex-row items-center gap-2 px-5 pt-3 pb-2">
        <View className="flex-1">
          <Input value={search} onChangeText={setSearch} placeholder={t.mobileClients.searchPlaceholder} autoCapitalize="none" />
        </View>
        {canCreateClients ? (
          <Pressable
            onPress={() => router.push('/(app)/clients/new')}
            className="h-11 w-11 items-center justify-center rounded-full bg-brand"
          >
            <Text className="text-2xl text-white">+</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={data ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ClientCard client={item} onPress={() => router.push(`/(app)/clients/${item.id}`)} />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#171717" />}
        ListEmptyComponent={
          !isLoading ? (
            <View className="items-center py-16">
              <Text className="text-base text-ink-muted text-center">
                {error ? t.mobileClients.errorPrefix.replace('{message}', (error as Error).message) : t.mobileClients.noClientsFound}
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
