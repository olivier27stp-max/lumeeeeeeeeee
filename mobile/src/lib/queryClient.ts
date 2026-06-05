import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import NetInfo from '@react-native-community/netinfo';
import { onlineManager, QueryClient } from '@tanstack/react-query';

// Bridge React Query's online state to the device's connectivity so queries
// pause/resume correctly offline.
onlineManager.setEventListener((setOnline) => {
  const sub = NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected);
  });
  return sub;
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Keep cached data around long enough to survive an app restart so the
      // persister can rehydrate Today's jobs / clients / pins while offline.
      gcTime: 24 * 60 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Persists the read cache to AsyncStorage so the app boots with the last-synced
// data when there is no network.
export const asyncPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'lume-query-cache',
});
