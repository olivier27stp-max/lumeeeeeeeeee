import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { ClientInput, createClient } from '@/lib/api/clients';
import { usePermissions } from '@/lib/usePermissions';

export default function NewClient() {
  const qc = useQueryClient();
  const { orgId, canCreateClients } = usePermissions();
  const [form, setForm] = useState<ClientInput>({});

  const set = (k: keyof ClientInput) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const saveMut = useMutation({
    mutationFn: () => createClient(orgId ?? '', form),
    onSuccess: (client) => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      router.replace(`/(app)/clients/${client.id}`);
    },
    onError: (e: Error) => Alert.alert('Could not create client', e.message),
  });

  if (!canCreateClients) return <Redirect href="/(app)/(tabs)/clients" />;

  const valid = !!(form.first_name?.trim() || form.last_name?.trim() || form.company?.trim());

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

        <Button
          title="Create client"
          onPress={() => saveMut.mutate()}
          loading={saveMut.isPending}
          disabled={!valid || !orgId}
        />
      </View>
    </ScreenContainer>
  );
}
