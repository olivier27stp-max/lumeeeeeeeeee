import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useTranslation } from '@/lib/i18n';
import { listMembers } from '@/lib/api/org';
import { ROLE_LABELS, TeamRole } from '@/lib/permissions';
import { usePermissions } from '@/lib/usePermissions';

export default function ManageTeam() {
  const { t, language } = useTranslation();
  const { orgId, can, role } = usePermissions();
  const isManager = can('team.update') || role === 'owner' || role === 'admin';

  const { data: members, isLoading } = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => listMembers(orgId ?? ''),
    enabled: !!orgId && isManager,
  });

  if (!isManager) return <Redirect href="/(app)/(tabs)/profile" />;

  return (
    <ScreenContainer scroll>
      <View className="gap-4 py-6">
        <View>
          <Text className="text-2xl font-bold text-ink">{t.mobileTeam.manageTeam}</Text>
          <Text className="mt-1 text-sm text-ink-muted">
            {members?.length ?? 0}{' '}
            {(members?.length ?? 0) === 1 ? t.mobileTeam.memberSingular : t.mobileTeam.memberPlural}
          </Text>
        </View>

        {isLoading ? (
          <ActivityIndicator color="#171717" />
        ) : (
          <Card className="gap-0 p-0">
            {(members ?? []).map((m) => {
              const label = ROLE_LABELS[m.role as TeamRole]?.[language] ?? m.role;
              const initials = (m.full_name ?? m.email ?? '?')
                .split(' ')
                .map((s) => s[0])
                .join('')
                .slice(0, 2)
                .toUpperCase();
              return (
                <Pressable
                  key={m.user_id}
                  onPress={() => router.push(`/(app)/member/${m.user_id}`)}
                  className="flex-row items-center gap-3 border-b border-surface-border px-4 py-3 active:bg-surface-sunken"
                >
                  <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-sunken">
                    <Text className="text-sm font-bold text-ink">{initials}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-ink">
                      {m.full_name ?? m.email ?? t.mobileTeam.memberFallback}
                    </Text>
                    {m.status === 'pending' ? (
                      <Text className="text-xs text-ink-subtle">{t.mobileTeam.pending}</Text>
                    ) : null}
                  </View>
                  <View className="rounded-full bg-surface-sunken px-3 py-1">
                    <Text className="text-xs font-semibold text-ink">{label}</Text>
                  </View>
                  <SymbolView name="chevron.right" tintColor="#A3A3A3" size={13} resizeMode="scaleAspectFit" />
                </Pressable>
              );
            })}
          </Card>
        )}

        <Text className="px-1 text-xs text-ink-subtle">{t.mobileTeam.manageTeamHint}</Text>
      </View>
    </ScreenContainer>
  );
}
