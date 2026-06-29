import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { Input } from '@/components/ui/Input';
import { StatusPill } from '@/components/ui/StatusPill';
import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import { listClients } from '@/lib/api/clients';
import { searchJobs } from '@/lib/api/jobs';
import { listMembers } from '@/lib/api/org';
import { clientFullName } from '@/lib/format';
import { usePermissions } from '@/lib/usePermissions';

type Row =
  | { type: 'header'; key: string; label: string }
  | { type: 'client'; key: string; id: string; name: string; sub?: string }
  | { type: 'job'; key: string; id: string; title: string; client: string; status: string }
  | { type: 'member'; key: string; id: string; name: string; role: string };

export default function GlobalSearch() {
  const { orgId, teamId, scope, permissions, role } = usePermissions();
  const access = { teamId, scope, permissions, role };
  const [q, setQ] = useState('');
  const term = q.trim();
  const enabled = term.length >= 1 && !!orgId;

  const clientsQ = useQuery({
    queryKey: ['gsearch', 'clients', term],
    queryFn: () => listClients(term),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
  const jobsQ = useQuery({
    queryKey: ['gsearch', 'jobs', term, role, teamId],
    queryFn: () => searchJobs(term, access),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
  const membersQ = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => listMembers(orgId ?? ''),
    enabled: !!orgId,
  });

  const members =
    term.length >= 1
      ? (membersQ.data ?? []).filter((m) =>
          (m.full_name ?? '').toLowerCase().includes(term.toLowerCase()),
        )
      : [];

  const rows: Row[] = [];
  if ((clientsQ.data?.length ?? 0) > 0) {
    rows.push({ type: 'header', key: 'h-c', label: 'Clients' });
    for (const c of clientsQ.data!) {
      rows.push({
        type: 'client',
        key: `c-${c.id}`,
        id: c.id,
        name: clientFullName(c),
        sub: c.company ?? c.email ?? undefined,
      });
    }
  }
  if ((jobsQ.data?.length ?? 0) > 0) {
    rows.push({ type: 'header', key: 'h-j', label: 'Jobs' });
    for (const j of jobsQ.data!) {
      rows.push({
        type: 'job',
        key: `j-${j.id}`,
        id: j.id,
        title: j.title,
        client: j.client_name ?? '',
        status: j.status,
      });
    }
  }
  if (members.length > 0) {
    rows.push({ type: 'header', key: 'h-m', label: 'Équipe' });
    for (const m of members) {
      rows.push({ type: 'member', key: `m-${m.user_id}`, id: m.user_id, name: m.full_name ?? '—', role: m.role });
    }
  }

  const card = 'flex-row items-center gap-3 rounded-2xl bg-white p-3';

  const renderItem = ({ item }: { item: Row }) => {
    if (item.type === 'header') {
      return (
        <Text className="px-1 pb-1 pt-4 text-[11px] font-bold uppercase tracking-widest text-ink-subtle">
          {item.label}
        </Text>
      );
    }
    if (item.type === 'client') {
      return (
        <Pressable onPress={() => router.push(`/(app)/clients/${item.id}` as any)} className={card}>
          <UnifiedAvatar id={item.id} name={item.name} size={40} />
          <View className="flex-1">
            <Text className="text-base font-semibold text-ink" numberOfLines={1}>{item.name}</Text>
            {item.sub ? <Text className="text-sm text-ink-muted" numberOfLines={1}>{item.sub}</Text> : null}
          </View>
        </Pressable>
      );
    }
    if (item.type === 'job') {
      return (
        <Pressable onPress={() => router.push(`/(app)/jobs/${item.id}` as any)} className={card}>
          <View className="flex-1">
            <Text className="text-base font-semibold text-ink" numberOfLines={1}>{item.title}</Text>
            {item.client ? <Text className="text-sm text-ink-muted" numberOfLines={1}>{item.client}</Text> : null}
          </View>
          <StatusPill status={item.status} />
        </Pressable>
      );
    }
    return (
      <Pressable onPress={() => router.push(`/(app)/member/${item.id}` as any)} className={card}>
        <UnifiedAvatar id={item.id} name={item.name} size={40} />
        <View className="flex-1">
          <Text className="text-base font-semibold text-ink" numberOfLines={1}>{item.name}</Text>
          <Text className="text-sm capitalize text-ink-muted">{item.role}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View className="flex-1 bg-surface-alt">
      <View className="px-5 pb-2 pt-3">
        <Input
          value={q}
          onChangeText={setQ}
          placeholder="Rechercher : client, job, technicien…"
          autoFocus
          autoCapitalize="none"
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 8 }}
        keyboardShouldPersistTaps="handled"
        renderItem={renderItem}
        ListEmptyComponent={
          term.length >= 1 ? (
            <View className="items-center py-16">
              <Text className="text-sm text-ink-muted">Aucun résultat pour « {term} ».</Text>
            </View>
          ) : (
            <View className="items-center py-16">
              <Text className="text-sm text-ink-muted">Cherche un client, un job ou un technicien.</Text>
            </View>
          )
        }
      />
    </View>
  );
}
