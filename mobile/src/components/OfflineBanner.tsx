import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

/** Thin banner shown while the device is offline. Cached data stays visible. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sub = NetInfo.addEventListener((state) => {
      setOffline(state.isConnected === false);
    });
    return () => sub();
  }, []);

  if (!offline) return null;

  return (
    <View className="bg-amber-500 px-4 py-1.5">
      <Text className="text-center text-xs font-medium text-white">
        Offline — showing last synced data
      </Text>
    </View>
  );
}
