import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useTranslation } from '@/lib/i18n';
import { CompanySettings, getCompany, updateCompany } from '@/lib/api/org';
import { useMembership } from '@/lib/membership-context';
import { usePermissions } from '@/lib/usePermissions';

type Form = Partial<Omit<CompanySettings, 'org_id'>>;

export default function Company() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { refresh } = useMembership();
  const { orgId, can, role } = usePermissions();
  const isManager = can('settings.update') || role === 'owner' || role === 'admin';
  const [form, setForm] = useState<Form>({});

  const { data, isLoading } = useQuery({
    queryKey: ['company', orgId],
    queryFn: () => getCompany(orgId ?? ''),
    enabled: !!orgId && isManager,
  });

  useEffect(() => {
    if (data) {
      setForm({
        company_name: data.company_name ?? '',
        phone: data.phone ?? '',
        email: data.email ?? '',
        website: data.website ?? '',
        street1: data.street1 ?? '',
        street2: data.street2 ?? '',
        city: data.city ?? '',
        province: data.province ?? '',
        postal_code: data.postal_code ?? '',
        country: data.country ?? '',
      });
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: () => updateCompany(orgId ?? '', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company'] });
      // Refresh memberships so the live company name (used in client messages,
      // the More header, etc.) updates everywhere without an app reload.
      refresh();
      router.back();
    },
    onError: (e: Error) => Alert.alert(t.mobileTeam.couldNotSave, e.message),
  });

  if (!isManager) return <Redirect href="/(app)/(tabs)/profile" />;
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <ActivityIndicator color="#171717" />
      </View>
    );
  }

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <ScreenContainer scroll>
      <View className="gap-3 py-4">
        <Input label={t.mobileTeam.companyName} value={form.company_name ?? ''} onChangeText={set('company_name')} />
        <Input label={t.mobileTeam.phone} value={form.phone ?? ''} onChangeText={set('phone')} keyboardType="phone-pad" />
        <Input
          label={t.mobileTeam.email}
          value={form.email ?? ''}
          onChangeText={set('email')}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Input label={t.mobileTeam.website} value={form.website ?? ''} onChangeText={set('website')} autoCapitalize="none" />
        <Input label={t.mobileTeam.streetAddress} value={form.street1 ?? ''} onChangeText={set('street1')} />
        <Input label={t.mobileTeam.streetAddress2} value={form.street2 ?? ''} onChangeText={set('street2')} />
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Input label={t.mobileTeam.city} value={form.city ?? ''} onChangeText={set('city')} />
          </View>
          <View className="flex-1">
            <Input label={t.mobileTeam.province} value={form.province ?? ''} onChangeText={set('province')} />
          </View>
        </View>
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Input label={t.mobileTeam.postalCode} value={form.postal_code ?? ''} onChangeText={set('postal_code')} />
          </View>
          <View className="flex-1">
            <Input label={t.mobileTeam.country} value={form.country ?? ''} onChangeText={set('country')} />
          </View>
        </View>

        <Button title={t.mobileTeam.saveChanges} onPress={() => saveMut.mutate()} loading={saveMut.isPending} />
      </View>
    </ScreenContainer>
  );
}
