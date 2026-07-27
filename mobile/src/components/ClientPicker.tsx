import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { createClient, listClients } from '@/lib/api/clients';
import { clientFullName } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

export type PickedClient = { id: string; name: string };

export function ClientPicker({
  value,
  onChange,
  initialForm,
}: {
  value: PickedClient | null;
  onChange: (c: PickedClient | null) => void;
  /** Pre-fills the "new client" form (e.g. from a D2D pin's customer info) */
  initialForm?: { name?: string; phone?: string; email?: string };
}) {
  const { t } = useTranslation();
  const tc = t.mobileComp;
  const qc = useQueryClient();
  const { orgId, canCreateClients } = usePermissions();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', company: '', phone: '', email: '' });

  const term = search.trim();
  const { data, error, isFetching } = useQuery({
    queryKey: ['clients', 'search', term],
    queryFn: () => listClients(term),
    enabled: !value && !creating && term.length >= 1,
    staleTime: 0,
    gcTime: 0,
  });

  const createMut = useMutation({
    mutationFn: () => createClient(orgId ?? '', form),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      onChange({ id: c.id, name: clientFullName(c) });
      setCreating(false);
      setSearch('');
    },
    onError: (e: Error) => Alert.alert(tc.couldNotCreateClient, e.message),
  });

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  if (value) {
    return (
      <Card className="flex-row items-center justify-between">
        <Text className="text-base text-ink">{value.name}</Text>
        <Pressable onPress={() => onChange(null)}>
          <Text className="text-sm text-brand">{tc.change}</Text>
        </Pressable>
      </Card>
    );
  }

  if (creating) {
    const valid = form.first_name.trim() || form.last_name.trim() || form.company.trim();
    return (
      <Card className="gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-bold text-ink">New client</Text>
          <Pressable onPress={() => setCreating(false)}>
            <Text className="text-sm text-brand">Back</Text>
          </Pressable>
        </View>
        <View className="flex-row gap-2">
          <View className="flex-1"><Input label="First name" value={form.first_name} onChangeText={set('first_name')} /></View>
          <View className="flex-1"><Input label="Last name" value={form.last_name} onChangeText={set('last_name')} /></View>
        </View>
        <Input label="Company" value={form.company} onChangeText={set('company')} />
        <View className="flex-row gap-2">
          <View className="flex-1"><Input label="Phone" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" /></View>
          <View className="flex-1"><Input label="Email" value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" /></View>
        </View>
        <Button title="Create & select" onPress={() => createMut.mutate()} loading={createMut.isPending} disabled={!valid || !orgId} />
      </Card>
    );
  }

  return (
    <View className="gap-2">
      <Input value={search} onChangeText={setSearch} placeholder="Rechercher un client (2+ lettres)…" autoCapitalize="none" />
      {error ? (
        <Text className="px-1 text-xs text-status-late">Erreur de recherche : {(error as Error).message}</Text>
      ) : null}
      {isFetching ? <Text className="px-1 text-xs text-ink-muted">Recherche…</Text> : null}
      {!isFetching && !error && term.length >= 2 && (data?.length ?? 0) === 0 ? (
        <Text className="px-1 text-xs text-ink-muted">Aucun client trouvé pour « {term} ».</Text>
      ) : null}
      {(data ?? []).slice(0, 6).map((c) => (
        <Pressable
          key={c.id}
          onPress={() => {
            onChange({ id: c.id, name: clientFullName(c) });
            setSearch('');
          }}
          className="rounded-xl border border-surface-border bg-white px-4 py-3"
        >
          <Text className="text-sm text-ink">{clientFullName(c)}</Text>
        </Pressable>
      ))}
      {canCreateClients ? (
        <Pressable
          onPress={() => {
            if (initialForm && (initialForm.name || initialForm.phone || initialForm.email)) {
              const parts = (initialForm.name ?? '').trim().split(/\s+/);
              setForm({
                first_name: parts[0] ?? '',
                last_name: parts.slice(1).join(' '),
                company: '',
                phone: initialForm.phone ?? '',
                email: initialForm.email ?? '',
              });
            } else {
              setForm((f) => ({ ...f, first_name: '', last_name: '', company: search }));
            }
            setCreating(true);
          }}
          className="flex-row items-center gap-2 rounded-xl border border-dashed border-surface-border px-4 py-3"
        >
          <SymbolView name="person.badge.plus" tintColor="#171717" size={16} resizeMode="scaleAspectFit" />
          <Text className="text-sm font-medium text-ink">Create new client</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
