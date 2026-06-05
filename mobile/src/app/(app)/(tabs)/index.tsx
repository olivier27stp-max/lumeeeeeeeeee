import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { JobCard } from '@/components/JobCard';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { listTodaysJobs } from '@/lib/api/jobs';

export default function TodaysJobs() {
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['jobs', 'today'],
    queryFn: listTodaysJobs,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <ScreenContainer padded={false}>
      <View className="px-5 pt-2 pb-3">
        <Text className="text-3xl font-bold text-ink">Today</Text>
        <Text className="text-sm text-ink-muted">
          {data?.length ?? 0} job{(data?.length ?? 0) === 1 ? '' : 's'} scheduled
        </Text>
      </View>

      <FlatList
        data={data ?? []}
        keyExtractor={(j) => j.id}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        renderItem={({ item }) => (
          <JobCard job={item} onPress={() => router.push(`/(app)/jobs/${item.id}`)} />
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#208AEF" />
        }
        ListEmptyComponent={
          !isLoading ? (
            <View className="items-center justify-center py-16">
              <Text className="text-5xl mb-3">🎉</Text>
              <Text className="text-base text-ink-muted text-center">
                {error ? `Error: ${(error as Error).message}` : 'Nothing scheduled today.'}
              </Text>
            </View>
          ) : null
        }
      />
    </ScreenContainer>
  );
}
