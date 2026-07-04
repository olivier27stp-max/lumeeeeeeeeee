import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Switch, Text, View } from 'react-native';

import { getPeerPayoutsVisible, setPeerPayoutsVisible } from '@/lib/api/fieldSales';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

/** Sales / D2D settings (managers). */
export default function SalesSettings() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { orgId, role } = usePermissions();
  const isManager = role === 'owner' || role === 'admin';

  const { data, isLoading } = useQuery({
    queryKey: ['peer-payouts-visible', orgId],
    queryFn: () => getPeerPayoutsVisible(String(orgId)),
    enabled: !!orgId,
  });

  const [on, setOn] = useState(true);
  useEffect(() => {
    if (data != null) setOn(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (value: boolean) => setPeerPayoutsVisible(String(orgId), value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['peer-payouts-visible', orgId] }),
  });

  if (!isManager) return <Redirect href="/(app)/(tabs)/profile" />;

  return (
    <View className="flex-1 bg-surface-alt">
      <View className="gap-3 p-4">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileTeam.leaderboardCommissions}</Text>
        <View className="rounded-2xl bg-white p-4">
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-base font-semibold text-ink">{t.mobileTeam.peerCommissionsVisible}</Text>
              <Text className="mt-0.5 text-sm text-ink-muted">
                {t.mobileTeam.peerCommissionsDesc}
              </Text>
            </View>
            {isLoading ? (
              <ActivityIndicator color="#171717" />
            ) : (
              <Switch
                value={on}
                onValueChange={(v) => {
                  setOn(v);
                  save.mutate(v);
                }}
                trackColor={{ true: '#171717', false: '#D4D4D4' }}
              />
            )}
          </View>
        </View>
        <Text className="px-1 text-xs text-ink-subtle">
          {t.mobileTeam.peerCommissionsHint}
        </Text>
      </View>
    </View>
  );
}
