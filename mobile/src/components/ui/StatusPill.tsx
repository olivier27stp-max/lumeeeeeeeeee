import { Text, View } from 'react-native';

import { statusStyle } from '@/lib/statusColors';

type Props = { status: string };

// Web-style pills: a colored dot + label on a soft tinted background.
// Colours come from the shared status scheme (lib/statusColors).
export function StatusPill({ status }: Props) {
  const s = statusStyle(status);
  return (
    <View
      style={{ backgroundColor: s.bg }}
      className="flex-row items-center gap-1.5 self-start rounded-full px-2.5 py-1"
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.solid }} />
      <Text style={{ color: s.text }} className="text-[11px] font-semibold">
        {s.label}
      </Text>
    </View>
  );
}
