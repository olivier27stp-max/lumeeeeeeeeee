import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { ClientInput, createClient } from '@/lib/api/clients';
import { usePermissions } from '@/lib/usePermissions';

// Mirrors the web ClientForm: First/Last, Company, Email/Phone, collapsible
// Address (autocomplete + readonly city/province/postal). No notes on create.
export default function NewClient() {
  const qc = useQueryClient();
  const { orgId, canCreateClients } = usePermissions();
  const [form, setForm] = useState<ClientInput>({});
  const [showAddress, setShowAddress] = useState(false);

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
      <View className="gap-4 py-4">
        {/* Name row */}
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Input label="First name" value={form.first_name ?? ''} onChangeText={set('first_name')} placeholder="John" />
          </View>
          <View className="flex-1">
            <Input label="Last name" value={form.last_name ?? ''} onChangeText={set('last_name')} placeholder="Doe" />
          </View>
        </View>

        <Input label="Company" value={form.company ?? ''} onChangeText={set('company')} placeholder="Acme Inc." />

        {/* Contact row */}
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Input label="Email" value={form.email ?? ''} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" placeholder="john@example.com" />
          </View>
          <View className="flex-1">
            <Input label="Phone" value={form.phone ?? ''} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="(555) 123-4567" />
          </View>
        </View>

        {/* Address — collapsed by default, like the web */}
        {!showAddress ? (
          <Pressable onPress={() => setShowAddress(true)} className="self-start">
            <Text className="text-sm font-semibold text-brand">+ Address</Text>
          </Pressable>
        ) : (
          <View className="gap-3">
            <AddressAutocomplete
              value={form.address ?? ''}
              onChangeText={set('address')}
              onSelect={(a) =>
                setForm((f) => ({
                  ...f,
                  address: a.address,
                  city: a.city ?? f.city,
                  province: a.province ?? f.province,
                  postal_code: a.postal_code ?? f.postal_code,
                }))
              }
            />
            {form.city ? (
              <View className="flex-row gap-3">
                <View className="flex-1"><Input label="City" value={form.city ?? ''} onChangeText={set('city')} /></View>
                <View className="flex-1"><Input label="Province" value={form.province ?? ''} onChangeText={set('province')} /></View>
              </View>
            ) : null}
            {form.city ? <Input label="Postal code" value={form.postal_code ?? ''} onChangeText={set('postal_code')} /> : null}
          </View>
        )}

        <Button title="Create client" onPress={() => saveMut.mutate()} loading={saveMut.isPending} disabled={!valid || !orgId} />
      </View>
    </ScreenContainer>
  );
}
