import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SalesLeaderboardView } from '@/components/SalesLeaderboardView';

/** Sales-mode "Classement" tab. */
export default function SalesLeaderboardTab() {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-surface-alt" style={{ paddingTop: insets.top }}>
      <SalesLeaderboardView />
    </View>
  );
}
