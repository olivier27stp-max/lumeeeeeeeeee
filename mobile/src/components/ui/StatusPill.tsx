import { Text, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { statusLabel, statusStyle } from '@/lib/statusColors';

type Props = { status: string };

// Web-style pills: a colored dot + label on a soft tinted background.
// Colours come from the shared status scheme (lib/statusColors); the label is
// resolved through the i18n dictionary so it stays translated.
export function StatusPill({ status }: Props) {
  const { t } = useTranslation();
  const s = statusStyle(status);
  return (
    <View
      style={{ backgroundColor: s.bg }}
      className="flex-row items-center gap-1.5 self-start rounded-full px-2.5 py-1"
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.solid }} />
      <Text style={{ color: s.text }} className="text-[11px] font-semibold">
        {statusLabel(status, t.mobileComp)}
      </Text>
    </View>
  );
}
