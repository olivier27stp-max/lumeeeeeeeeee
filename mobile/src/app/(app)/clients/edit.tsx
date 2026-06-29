import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { ClientInput, getClient, updateClient } from '@/lib/api/clients';
import { usePermissions } from '@/lib/usePermissions';

export default function EditClient() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = usePermissions();
  const [form, setForm] = useState<ClientInput>({});

  const { data: client, isLoading } = useQuery({
    queryKey: ['clients', id],
    queryFn: () => getClient(String(id)),
    enabled: !!id,
  });

  useEffect(() => {
    if (client) {
      setForm({
        first_name: client.first_name ?? '',
        last_name: client.last_name ?? '',
        company: client.company ?? '',
        phone: client.phone ?? '',
        email: client.email ?? '',
        address: client.address ?? '',
        city: client.city ?? '',
        province: client.province ?? '',
        postal_code: client.postal_code ?? '',
        notes: client.notes ?? '',
      });
    }
  }, [client]);

  const set = (k: keyof ClientInput) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const saveMut = useMutation({
    mutationFn: () => updateClient(String(id), form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      router.back();
    },
    onError: (e: Error) => Alert.alert('Could not save', e.message),
  });

  if (!can('clients.update')) return <Redirect href="/(app)/(tabs)/clients" />;
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <ActivityIndicator color="#171717" />
      </View>
    );
  }

  return (
    <ScreenContainer scroll>
      <View className="gap-3 py-4">
        <Input label="First name" value={form.first_name ?? ''} onChangeText={set('first_name')} />
        <Input label="Last name" value={form.last_name ?? ''} onChangeText={set('last_name')} />
        <Input label="Company" value={form.company ?? ''} onChangeText={set('company')} />
        <Input
          label="Phone"
          value={form.phone ?? ''}
          onChangeText={set('phone')}
          keyboardType="phone-pad"
        />
        <Input
          label="Email"
          value={form.email ?? ''}
          onChangeText={set('email')}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Input label="Address" value={form.address ?? ''} onChangeText={set('address')} />
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Input label="City" value={form.city ?? ''} onChangeText={set('city')} />
          </View>
          <View className="flex-1">
            <Input label="Province" value={form.province ?? ''} onChangeText={set('province')} />
          </View>
        </View>
        <Input label="Postal code" value={form.postal_code ?? ''} onChangeText={set('postal_code')} />
        <Input
          label="Notes"
          value={form.notes ?? ''}
          onChangeText={set('notes')}
          multiline
          numberOfLines={3}
          style={{ height: 80, textAlignVertical: 'top', paddingTop: 12 }}
        />

        <Button title="Save changes" onPress={() => saveMut.mutate()} loading={saveMut.isPending} />
      </View>
    </ScreenContainer>
  );
}
