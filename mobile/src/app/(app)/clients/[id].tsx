import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { getClient } from '@/lib/api/clients';
import { clientFullName } from '@/lib/format';

function Row({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const Inner = (
    <View className="gap-1">
      <Text className="text-xs text-ink-muted uppercase">{label}</Text>
      <Text className={`text-base ${onPress ? 'text-brand underline' : 'text-ink'}`}>
        {value}
      </Text>
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{Inner}</Pressable> : Inner;
}

export default function ClientDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: client, isLoading, error } = useQuery({
    queryKey: ['clients', id],
    queryFn: () => getClient(String(id)),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <Text className="text-ink-muted">Loading…</Text>
      </View>
    );
  }
  if (error || !client) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt p-6">
        <Text className="text-ink-muted text-center">
          {error ? (error as Error).message : 'Client not found.'}
        </Text>
      </View>
    );
  }

  const address = [client.address, client.city, client.province, client.postal_code]
    .filter(Boolean)
    .join(', ');

  return (
    <ScrollView className="flex-1 bg-surface-alt">
      <View className="p-5 gap-4">
        <View className="gap-1">
          <Text className="text-2xl font-bold text-ink">{clientFullName(client)}</Text>
          {client.company ? (
            <Text className="text-base text-ink-muted">{client.company}</Text>
          ) : null}
        </View>

        <Card className="gap-4">
          {client.phone ? (
            <Row
              label="Phone"
              value={client.phone}
              onPress={() => Linking.openURL(`tel:${client.phone}`)}
            />
          ) : null}
          {client.email ? (
            <Row
              label="Email"
              value={client.email}
              onPress={() => Linking.openURL(`mailto:${client.email}`)}
            />
          ) : null}
          {address ? (
            <Row
              label="Address"
              value={address}
              onPress={() =>
                Linking.openURL(`https://maps.apple.com/?q=${encodeURIComponent(address)}`)
              }
            />
          ) : null}
        </Card>

        {client.notes ? (
          <Card>
            <Text className="text-xs text-ink-muted uppercase mb-1">Notes</Text>
            <Text className="text-base text-ink leading-6">{client.notes}</Text>
          </Card>
        ) : null}
      </View>
    </ScrollView>
  );
}
