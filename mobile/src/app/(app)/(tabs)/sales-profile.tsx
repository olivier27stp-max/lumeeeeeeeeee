import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RepProfileView } from '@/components/RepProfileView';
import { useAuth } from '@/lib/auth';

/** Sales-mode "Profil" tab — the signed-in rep's own profile + next payout. */
export default function SalesProfileTab() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  // Cover banner is ink; pad the top inset with ink so it runs edge-to-edge.
  return (
    <View className="flex-1 bg-ink" style={{ paddingTop: insets.top }}>
      <RepProfileView userId={me} />
    </View>
  );
}
