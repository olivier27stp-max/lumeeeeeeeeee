import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { getMember, updateMemberRole } from '@/lib/api/org';
import { ASSIGNABLE_ROLES, ROLE_LABELS, TeamRole } from '@/lib/permissions';
import { usePermissions } from '@/lib/usePermissions';

export default function MemberDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { orgId, can, role } = usePermissions();
  const isManager = can('team.update') || role === 'owner' || role === 'admin';

  const { data: member, isLoading } = useQuery({
    queryKey: ['member', id, orgId],
    queryFn: () => getMember(String(id), orgId ?? ''),
    enabled: !!id && !!orgId && isManager,
  });

  const roleMut = useMutation({
    mutationFn: (newRole: string) => updateMemberRole(String(id), orgId ?? '', newRole),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['member'] });
      qc.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (e: Error) => Alert.alert('Could not update role', e.message),
  });

  if (!isManager) return <Redirect href="/(app)/(tabs)/profile" />;
  if (isLoading || !member) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <ActivityIndicator color="#171717" />
      </View>
    );
  }

  const isOwner = member.role === 'owner';
  const initials = (member.full_name ?? member.email ?? '?')
    .split(' ')
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <ScreenContainer scroll>
      <View className="gap-5 py-6">
        {/* Header */}
        <View className="items-center gap-2">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-ink">
            <Text className="text-2xl font-bold text-white">{initials}</Text>
          </View>
          <Text className="text-xl font-bold text-ink">{member.full_name ?? 'Member'}</Text>
          {member.email ? <Text className="text-sm text-ink-muted">{member.email}</Text> : null}
          {member.status === 'pending' ? (
            <View className="rounded-full bg-surface-sunken px-3 py-1">
              <Text className="text-xs font-semibold text-ink-muted">Pending</Text>
            </View>
          ) : null}
        </View>

        {/* Role editor */}
        <Card className="gap-3">
          <Text className="text-xs uppercase text-ink-muted">Role</Text>
          {isOwner ? (
            <Text className="text-base text-ink">Owner (can't be changed)</Text>
          ) : (
            <View className="gap-2">
              {ASSIGNABLE_ROLES.map((r: TeamRole) => {
                const selected = member.role === r;
                return (
                  <Pressable
                    key={r}
                    onPress={() => !selected && roleMut.mutate(r)}
                    disabled={roleMut.isPending}
                    className={`flex-row items-center justify-between rounded-2xl border px-4 py-3 ${selected ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}
                  >
                    <Text className={`text-base font-semibold ${selected ? 'text-white' : 'text-ink'}`}>
                      {ROLE_LABELS[r].en}
                    </Text>
                    {selected ? <Text className="text-white">✓</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </Card>
      </View>
    </ScreenContainer>
  );
}
