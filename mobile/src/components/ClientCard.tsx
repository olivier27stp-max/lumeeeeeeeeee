import { Text, View } from 'react-native';

import { ClientRecord } from '@/types/db';
import { clientFullName } from '@/lib/format';
import { Card } from './ui/Card';
import UnifiedAvatar from './ui/UnifiedAvatar';

type Props = {
  client: ClientRecord;
  onPress?: () => void;
};

export function ClientCard({ client, onPress }: Props) {
  const name = clientFullName(client);
  const subtitle = client.company && name !== client.company ? client.company : client.email;

  return (
    <Card onPress={onPress} className="flex-row items-center gap-3">
      <UnifiedAvatar id={client.id} name={name} size={44} />
      <View className="flex-1 gap-1">
        <Text className="text-base font-semibold text-ink" numberOfLines={1}>
          {name}
        </Text>
        {subtitle ? (
          <Text className="text-sm text-ink-muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {client.city ? (
          <Text className="text-xs text-ink-subtle" numberOfLines={1}>
            {[client.city, client.province].filter(Boolean).join(', ')}
          </Text>
        ) : null}
        {client.phone ? (
          <View className="flex-row gap-2 pt-1">
            <View className="px-2 py-0.5 rounded-full bg-brand-50">
              <Text className="text-xs text-brand-700">{client.phone}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </Card>
  );
}
