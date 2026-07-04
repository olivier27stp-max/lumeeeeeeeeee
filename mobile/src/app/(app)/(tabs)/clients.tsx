import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { ClientCard } from '@/components/ClientCard';
import { Input } from '@/components/ui/Input';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { listClients } from '@/lib/api/clients';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

export default function ClientsTab() {
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
    <ScreenContainer padded={false}>
      <View className="px-5 pt-2 pb-3 gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-3xl font-bold text-ink">{t.mobileField.clientsTitle}</Text>
          {canCreateClients ? (
            <Pressable
              onPress={() => router.push('/(app)/clients/new')}
              className="h-9 w-9 items-center justify-center rounded-full bg-brand"
            >
              <Text className="text-xl text-white">+</Text>
            </Pressable>
          ) : null}
        </View>
        <Input
          value={search}
          onChangeText={setSearch}
          placeholder={t.mobileField.searchClientsPlaceholder}
          autoCapitalize="none"
        />
      </View>

      <FlatList
        data={data ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        renderItem={({ item }) => (
          <ClientCard client={item} onPress={() => router.push(`/(app)/clients/${item.id}`)} />
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#171717" />
        }
        ListEmptyComponent={
          !isLoading ? (
            <View className="items-center py-16">
              <Text className="text-base text-ink-muted text-center">
                {error
                  ? t.mobileField.errorPrefix.replace('{message}', (error as Error).message)
                  : t.mobileField.noClientsFound}
              </Text>
            </View>
          ) : null
        }
      />
    </ScreenContainer>
  );
}
