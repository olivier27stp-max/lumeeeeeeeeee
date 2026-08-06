import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { ClientInput, createClient } from '@/lib/api/clients';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

// Mirrors the web ClientForm: First/Last, Company, Email/Phone, collapsible
// Address (autocomplete + readonly city/province/postal). No notes on create.
export default function NewClient() {
  const qc = useQueryClient();
  const { t } = useTranslation();
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
    onError: (e: Error) => Alert.alert(t.mobileClients.couldNotCreateClient, e.message),
  });

  if (!canCreateClients) return <Redirect href="/(app)/(tabs)/clients" />;

  const valid = !!(form.first_name?.trim() || form.last_name?.trim() || form.company?.trim());

  return (
    <ScreenContainer scroll>
      <View className="gap-4 py-4">
        {/* Name row */}
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Input label={t.mobileClients.firstName} value={form.first_name ?? ''} onChangeText={set('first_name')} placeholder={t.mobileClients.firstNamePlaceholder} />
          </View>
          <View className="flex-1">
            <Input label={t.mobileClients.lastName} value={form.last_name ?? ''} onChangeText={set('last_name')} placeholder={t.mobileClients.lastNamePlaceholder} />
          </View>
        </View>

        <Input label={t.mobileClients.company} value={form.company ?? ''} onChangeText={set('company')} placeholder={t.mobileClients.companyPlaceholder} />

        {/* Contact row */}
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Input label={t.mobileClients.email} value={form.email ?? ''} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" placeholder={t.mobileClients.emailPlaceholder} />
          </View>
          <View className="flex-1">
            <Input label={t.mobileClients.phone} value={form.phone ?? ''} onChangeText={set('phone')} keyboardType="phone-pad" placeholder={t.mobileClients.phonePlaceholder} />
          </View>
        </View>

        {/* Address — collapsed by default, like the web */}
        {!showAddress ? (
          <Pressable onPress={() => setShowAddress(true)} className="self-start">
            <Text className="text-sm font-semibold text-brand">{t.mobileClients.addAddress}</Text>
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
                  country: a.country ?? f.country,
                  // Without coordinates the client can't be placed on the map
                  // nor routed to — the picker resolves them, keep them.
                  latitude: a.lat ?? f.latitude,
                  longitude: a.lng ?? f.longitude,
                }))
              }
            />
            {form.city ? (
              <View className="flex-row gap-3">
                <View className="flex-1"><Input label={t.mobileClients.city} value={form.city ?? ''} onChangeText={set('city')} /></View>
                <View className="flex-1"><Input label={t.mobileClients.province} value={form.province ?? ''} onChangeText={set('province')} /></View>
              </View>
            ) : null}
            {form.city ? <Input label={t.mobileClients.postalCode} value={form.postal_code ?? ''} onChangeText={set('postal_code')} /> : null}
          </View>
        )}

        <Button title={t.mobileClients.createClient} onPress={() => saveMut.mutate()} loading={saveMut.isPending} disabled={!valid || !orgId} />
      </View>
    </ScreenContainer>
  );
}
