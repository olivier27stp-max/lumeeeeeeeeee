import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

/**
 * Thin status bar: shows when the device is offline and how many write actions
 * are queued (paused mutations), plus a brief "syncing" state when back online.
 */
export function OfflineBanner() {
  const qc = useQueryClient();
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const sub = NetInfo.addEventListener((state) => setOffline(state.isConnected === false));
    return () => sub();
  }, []);

  useEffect(() => {
    const mc = qc.getMutationCache();
    const update = () =>
      setPending(mc.getAll().filter((m) => m.state.isPaused || m.state.status === 'pending').length);
    update();
    const unsub = mc.subscribe(update);
    return unsub;
  }, [qc]);

  if (offline) {
    return (
      <View className="bg-amber-500 px-4 py-1.5">
        <Text className="text-center text-xs font-medium text-white">
          Hors-ligne — données en cache
          {pending > 0 ? ` · ${pending} action${pending > 1 ? 's' : ''} en attente` : ''}
        </Text>
      </View>
    );
  }

  if (pending > 0) {
    return (
      <View className="bg-[#2563EB] px-4 py-1.5">
        <Text className="text-center text-xs font-medium text-white">
          Synchronisation de {pending} action{pending > 1 ? 's' : ''}…
        </Text>
      </View>
    );
  }

  return null;
}
