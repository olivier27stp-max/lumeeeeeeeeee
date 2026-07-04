import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { addJobVisit, deleteJobVisit, listJobVisits } from '@/lib/api/visits';
import { useTranslation } from '@/lib/i18n';

/** Extra scheduled visits for a job (multi-day / return visits). */
export function JobVisitsCard({
  jobId,
  orgId,
  teamId,
  canEdit,
}: {
  jobId: string;
  orgId: string;
  teamId?: string | null;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const c = t.mobileComp;
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [when, setWhen] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d;
  });

  const { data: visits } = useQuery({
    queryKey: ['job-visits', jobId],
    queryFn: () => listJobVisits(jobId),
    enabled: !!jobId,
  });

  const add = useMutation({
    mutationFn: () => {
      const end = new Date(when);
      end.setHours(end.getHours() + 2);
      return addJobVisit({ orgId, jobId, teamId, startISO: when.toISOString(), endISO: end.toISOString() });
    },
    onSuccess: () => {
      setAdding(false);
      qc.invalidateQueries({ queryKey: ['job-visits', jobId] });
    },
    onError: (e: Error) => Alert.alert(c.visit, e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteJobVisit(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-visits', jobId] }),
  });

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  // Only show the card if there are multiple visits or the user can add.
  if ((visits?.length ?? 0) <= 1 && !canEdit) return null;

  return (
    <View className="gap-3 rounded-2xl bg-white p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{c.plannedVisits}</Text>
        {canEdit ? (
          <Pressable onPress={() => setAdding((v) => !v)} className="flex-row items-center gap-1">
            <SymbolView name={adding ? 'minus.circle.fill' : 'plus.circle.fill'} tintColor="#2563EB" size={18} />
            <Text className="text-sm font-semibold text-brand">{adding ? c.close : c.add}</Text>
          </Pressable>
        ) : null}
      </View>

      {adding ? (
        <View className="gap-2">
          <DateTimePicker
            value={when}
            mode="datetime"
            display={Platform.OS === 'ios' ? 'compact' : 'default'}
            onChange={(_, d) => d && setWhen(d)}
          />
          <Button title={c.addVisit} onPress={() => add.mutate()} loading={add.isPending} />
        </View>
      ) : null}

      {(visits?.length ?? 0) === 0 ? (
        <Text className="text-sm text-ink-muted">{c.noPlannedVisits}</Text>
      ) : (
        visits!.map((v) => (
          <View key={v.id} className="flex-row items-center justify-between border-t border-surface-border pt-2">
            <Text className="text-base text-ink">{fmt(v.start_at)}</Text>
            {canEdit ? (
              <Pressable onPress={() => del.mutate(v.id)} hitSlop={8}>
                <SymbolView name="trash" tintColor="#A3A3A3" size={15} />
              </Pressable>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}
