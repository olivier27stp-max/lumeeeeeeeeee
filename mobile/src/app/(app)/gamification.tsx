import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import {
  listActiveBattles,
  listActiveChallenges,
  listMyBadges,
  joinChallenge,
} from '@/lib/api/gamification';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

export default function Gamification() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const { orgId } = usePermissions();
  const { t } = useTranslation();
  const userId = session?.user.id ?? '';

  const badges = useQuery({
    queryKey: ['gam-badges', orgId, userId],
    queryFn: () => listMyBadges(String(orgId), userId),
    enabled: !!orgId,
  });
  const challenges = useQuery({
    queryKey: ['gam-challenges', orgId, userId],
    queryFn: () => listActiveChallenges(String(orgId), userId),
    enabled: !!orgId,
  });
  const battles = useQuery({
    queryKey: ['gam-battles', orgId],
    queryFn: () => listActiveBattles(String(orgId)),
    enabled: !!orgId,
  });

  const join = useMutation({
    mutationFn: (challengeId: string) => joinChallenge(challengeId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gam-challenges'] }),
    onError: (e: Error) => Alert.alert(t.mobileD2D.challengeAlertTitle, e.message),
  });

  const loading = badges.isLoading || challenges.isLoading || battles.isLoading;
  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <ActivityIndicator color="#171717" />
      </View>
    );
  }

  return (
    <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 18 }}>
      {/* Badges */}
      <View className="gap-2">
        <Text className="text-lg font-bold text-ink">{t.mobileD2D.myBadges}</Text>
        {(badges.data?.length ?? 0) === 0 ? (
          <Text className="text-sm text-ink-muted">{t.mobileD2D.noBadgesKnock}</Text>
        ) : (
          <View className="flex-row flex-wrap gap-3">
            {badges.data!.map((b) => (
              <View key={b.id} className="w-[30%] items-center gap-1 rounded-2xl bg-white p-3">
                <View
                  className="h-12 w-12 items-center justify-center rounded-full"
                  style={{ backgroundColor: (b.color ?? '#2563EB') + '22' }}
                >
                  <SymbolView name={(b.icon as any) || 'rosette'} tintColor={b.color ?? '#2563EB'} size={24} />
                </View>
                <Text className="text-center text-xs font-semibold text-ink" numberOfLines={2}>
                  {b.name}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Challenges */}
      <View className="gap-2">
        <Text className="text-lg font-bold text-ink">{t.mobileD2D.activeChallenges}</Text>
        {(challenges.data?.length ?? 0) === 0 ? (
          <Text className="text-sm text-ink-muted">{t.mobileD2D.noActiveChallenges}</Text>
        ) : (
          challenges.data!.map((c) => {
            const joined = c.my_value != null;
            const pct = c.target_value ? Math.min(100, Math.round(((c.my_value ?? 0) / c.target_value) * 100)) : 0;
            return (
              <View key={c.id} className="gap-2 rounded-2xl bg-white p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="flex-1 text-base font-semibold text-ink">{c.name}</Text>
                  <Text className="text-xs font-semibold uppercase text-ink-subtle">{c.type === 'daily' ? t.mobileD2D.challengeDaily : t.mobileD2D.challengeWeekly}</Text>
                </View>
                {c.description ? <Text className="text-sm text-ink-muted">{c.description}</Text> : null}
                {c.prize_description ? <Text className="text-sm text-brand">🏆 {c.prize_description}</Text> : null}
                {joined ? (
                  <>
                    <View className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                      <View className="h-2 rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </View>
                    <Text className="text-xs text-ink-subtle">
                      {c.my_value ?? 0}{c.target_value ? ` / ${c.target_value}` : ''} · {pct}%
                    </Text>
                  </>
                ) : (
                  <Button title={t.mobileD2D.joinChallenge} variant="secondary" onPress={() => join.mutate(c.id)} loading={join.isPending} />
                )}
              </View>
            );
          })
        )}
      </View>

      {/* Battles */}
      <View className="gap-2">
        <Text className="text-lg font-bold text-ink">{t.mobileD2D.battles}</Text>
        {(battles.data?.length ?? 0) === 0 ? (
          <Text className="text-sm text-ink-muted">{t.mobileD2D.noActiveBattles}</Text>
        ) : (
          battles.data!.map((b) => (
            <View key={b.id} className="gap-2 rounded-2xl bg-white p-4">
              <Text className="text-base font-semibold text-ink">{b.name}</Text>
              <View className="flex-row items-center justify-center gap-4">
                <Text className="text-2xl font-bold text-brand">{b.challenger_score}</Text>
                <Text className="text-sm text-ink-subtle">{t.mobileD2D.battleVs}</Text>
                <Text className="text-2xl font-bold text-ink">{b.opponent_score}</Text>
              </View>
              <Text className="text-center text-xs text-ink-subtle">{t.mobileD2D.battleUntil.replace('{date}', new Date(b.end_date).toLocaleDateString('fr-CA'))}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}
