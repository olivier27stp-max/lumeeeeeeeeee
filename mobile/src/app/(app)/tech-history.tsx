import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { ScrollView, Pressable, Text, View } from 'react-native';

import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import { listMembers } from '@/lib/api/org';
import { usePermissions } from '@/lib/usePermissions';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  manager: 'Gérant',
  technician: 'Technicien',
  sales_rep: 'Représentant',
};

/** Team roster — tap a member to open their full history/profile. */
export default function TechHistory() {
  const { orgId, role } = usePermissions();
  const isManager = role === 'owner' || role === 'admin';

  const { data: members } = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => listMembers(orgId ?? ''),
    enabled: !!orgId && isManager,
  });

  if (!isManager) return <Redirect href="/(app)/(tabs)" />;

  return (
    <ScrollView
      className="flex-1 bg-surface-alt"
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 10 }}
    >
      <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">Équipe</Text>

      {(members ?? []).length === 0 ? (
        <Text className="text-sm text-ink-muted">Aucun membre.</Text>
      ) : (
        (members ?? []).map((m) => (
          <Pressable
            key={m.user_id}
            onPress={() =>
              router.push(
                `/(app)/tech-history/${m.user_id}?name=${encodeURIComponent(m.full_name ?? '')}&role=${encodeURIComponent(m.role ?? '')}` as any,
              )
            }
            className="flex-row items-center gap-3 rounded-2xl bg-white p-4"
          >
            <UnifiedAvatar id={m.user_id} name={m.full_name ?? '—'} url={m.avatar_url} size={44} />
            <View className="flex-1">
              <Text className="text-base font-semibold text-ink">{m.full_name ?? '—'}</Text>
              <Text className="text-xs text-ink-muted">{ROLE_LABEL[m.role] ?? m.role}</Text>
            </View>
            <Text className="text-2xl text-ink-subtle">›</Text>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}
