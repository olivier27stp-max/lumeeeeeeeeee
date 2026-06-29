import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SalesHome from '@/components/SalesHome';

/** Sales-mode "Stats" tab: per-rep stats, commissions (coming), leaderboard. */
export default function SalesStats() {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-surface-alt" style={{ paddingTop: insets.top }}>
      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        <SalesHome />
      </ScrollView>
    </View>
  );
}
