import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useAuth } from '@/lib/auth';
import { useMembership } from '@/lib/membership-context';
import { usePermissions } from '@/lib/usePermissions';
import { MK } from '@/lib/offline/mutationKeys';
import { getActiveTimesheet, listTodaysEntries, workedMs } from '@/lib/api/timesheets';

function fmtDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export default function TimeTab() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const { current } = useMembership();
  const { orgId, teamId } = usePermissions();
  const employeeId = session?.user.id ?? '';

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const activeQ = useQuery({
    queryKey: ['timesheet', 'active', employeeId],
    queryFn: () => getActiveTimesheet(employeeId),
    enabled: !!employeeId,
  });
  const todayQ = useQuery({
    queryKey: ['timesheet', 'today', employeeId],
    queryFn: () => listTodaysEntries(employeeId),
    enabled: !!employeeId,
  });

  const onErr = (e: Error) => Alert.alert('Time tracking', e.message);

  // Offline-capable: these share mutation keys (registerMutationDefaults) so a
  // punch made without signal is queued and synced when back online.
  const punchInMut = useMutation<
    unknown,
    Error,
    { orgId: string; employeeId: string; employeeName: string | null; teamId: string | null }
  >({ mutationKey: MK.punchIn, onError: onErr });
  const punchOutMut = useMutation<unknown, Error, { entryId: string }>({
    mutationKey: MK.punchOut,
    onError: onErr,
  });
  const startBreakMut = useMutation<unknown, Error, { entryId: string }>({
    mutationKey: MK.startBreak,
    onError: onErr,
  });
  const endBreakMut = useMutation<unknown, Error, { entryId: string }>({
    mutationKey: MK.endBreak,
    onError: onErr,
  });

  const active = activeQ.data ?? null;
  const onBreak = active?.status === 'paused';
  const busy =
    punchInMut.isPending ||
    punchOutMut.isPending ||
    startBreakMut.isPending ||
    endBreakMut.isPending;

  // Today's total across completed + active entries.
  const todayTotal = (todayQ.data ?? []).reduce((sum, e) => sum + workedMs(e, now), 0);

  return (
    <ScreenContainer scroll>
      <View className="gap-6 py-6">
        <Text className="text-3xl font-bold text-ink">Time</Text>

        <Card className="items-center gap-2 py-8">
          <Text className="text-xs uppercase text-ink-muted">
            {active ? (onBreak ? 'On break' : 'On the clock') : 'Not punched in'}
          </Text>
          <Text className="text-5xl font-bold text-ink tabular-nums">
            {active ? fmtDuration(workedMs(active, now)) : '00:00:00'}
          </Text>
          {active?.punch_in ? (
            <Text className="text-sm text-ink-muted">Started {active.punch_in}</Text>
          ) : null}
        </Card>

        {activeQ.isLoading ? (
          <ActivityIndicator color="#208AEF" />
        ) : !active ? (
          <Button
            title="Punch in"
            onPress={() =>
              punchInMut.mutate({
                orgId: orgId ?? '',
                employeeId,
                employeeName: current?.fullName ?? session?.user.email ?? null,
                teamId: teamId ?? null,
              })
            }
            loading={busy}
            disabled={!orgId}
          />
        ) : (
          <View className="gap-3">
            {onBreak ? (
              <Button
                title="End break"
                onPress={() => endBreakMut.mutate({ entryId: active.id })}
                loading={busy}
              />
            ) : (
              <Button
                title="Start break"
                variant="secondary"
                onPress={() => startBreakMut.mutate({ entryId: active.id })}
                loading={busy}
              />
            )}
            <Button
              title="Punch out"
              variant="danger"
              onPress={() =>
                Alert.alert('Punch out', 'End your shift now?', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Punch out',
                    style: 'destructive',
                    onPress: () => punchOutMut.mutate({ entryId: active.id }),
                  },
                ])
              }
              loading={busy}
            />
          </View>
        )}

        <Card className="gap-1">
          <Text className="text-xs uppercase text-ink-muted">Today's total</Text>
          <Text className="text-2xl font-semibold text-ink tabular-nums">
            {fmtDuration(todayTotal)}
          </Text>
          <Text className="text-xs text-ink-subtle">
            {(todayQ.data ?? []).length} session{(todayQ.data ?? []).length === 1 ? '' : 's'}
          </Text>
        </Card>
      </View>
    </ScreenContainer>
  );
}
