import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { ScrollView, Pressable, Text, View } from 'react-native';

import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import { listMembers } from '@/lib/api/org';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

/** Team roster — tap a member to open their full history/profile. */
export default function TechHistory() {
  const { t } = useTranslation();
  const { orgId, role } = usePermissions();
  const isManager = role === 'owner' || role === 'admin';

  const roleLabel: Record<string, string> = {
    owner: t.mobileField.roleOwner,
    admin: t.mobileField.roleAdmin,
    manager: t.mobileField.roleManager,
    technician: t.mobileField.roleTechnician,
    sales_rep: t.mobileField.roleSalesRep,
  };

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
      <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileField.team}</Text>

      {(members ?? []).length === 0 ? (
        <Text className="text-sm text-ink-muted">{t.mobileField.noMembers}</Text>
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
              <Text className="text-xs text-ink-muted">{roleLabel[m.role] ?? m.role}</Text>
            </View>
            <Text className="text-2xl text-ink-subtle">›</Text>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}
