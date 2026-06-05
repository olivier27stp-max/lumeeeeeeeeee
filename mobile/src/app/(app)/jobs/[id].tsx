import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { StatusPill } from '@/components/ui/StatusPill';
import { JobPhotoGrid } from '@/components/JobPhotoGrid';
import { getJob, markJobCompleted, markJobInProgress } from '@/lib/api/jobs';
import { formatCurrencyCents, formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/usePermissions';

export default function JobDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');
  const { session } = useAuth();
  const { teamId, scope, permissions, role, canSeePricing, orgId, can } = usePermissions();
  const access = { teamId, scope, permissions, role };

  const { data: job, isLoading, error } = useQuery({
    queryKey: ['jobs', id, role],
    queryFn: () => getJob(String(id), access),
    enabled: !!id,
  });

  const startMut = useMutation({
    mutationFn: () => markJobInProgress(String(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (e: Error) => Alert.alert('Could not start job', e.message),
  });

  const completeMut = useMutation({
    mutationFn: () => markJobCompleted(String(id), notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      Alert.alert('Job completed', 'Nice work!', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (e: Error) => Alert.alert('Could not complete job', e.message),
  });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <Text className="text-ink-muted">Loading…</Text>
      </View>
    );
  }

  if (error || !job) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt p-6">
        <Text className="text-ink-muted text-center">
          {error ? (error as Error).message : 'Job not found.'}
        </Text>
      </View>
    );
  }

  const when = job.scheduled_at ?? job.start_at ?? null;
  const address = job.property_address ?? job.address;
  const isDone = job.status === 'completed';
  const isActive = job.status === 'in_progress';

  return (
    <ScrollView className="flex-1 bg-surface-alt">
      <View className="p-5 gap-4">
        <View className="gap-2">
          <Text className="text-xs text-ink-muted">#{job.job_number}</Text>
          <Text className="text-2xl font-bold text-ink">{job.title}</Text>
          <StatusPill status={job.status} />
        </View>

        <Card className="gap-3">
          <View>
            <Text className="text-xs text-ink-muted uppercase mb-1">Scheduled</Text>
            <Text className="text-base text-ink">{formatDateTime(when)}</Text>
          </View>
          {job.client_name ? (
            <View>
              <Text className="text-xs text-ink-muted uppercase mb-1">Client</Text>
              <Text className="text-base text-ink">{job.client_name}</Text>
            </View>
          ) : null}
          {address ? (
            <Pressable
              onPress={() =>
                Linking.openURL(
                  `https://maps.apple.com/?q=${encodeURIComponent(address)}`,
                )
              }
            >
              <Text className="text-xs text-ink-muted uppercase mb-1">Address</Text>
              <Text className="text-base text-brand underline">{address}</Text>
            </Pressable>
          ) : null}
          {canSeePricing ? (
            <View>
              <Text className="text-xs text-ink-muted uppercase mb-1">Total</Text>
              <Text className="text-base font-semibold text-ink">
                {formatCurrencyCents(job.total_cents, job.currency)}
              </Text>
            </View>
          ) : null}
        </Card>

        {job.description ? (
          <Card>
            <Text className="text-xs text-ink-muted uppercase mb-1">Description</Text>
            <Text className="text-base text-ink leading-6">{job.description}</Text>
          </Card>
        ) : null}

        {job.notes ? (
          <Card>
            <Text className="text-xs text-ink-muted uppercase mb-1">Existing notes</Text>
            <Text className="text-base text-ink leading-6">{job.notes}</Text>
          </Card>
        ) : null}

        {orgId ? (
          <Card>
            <JobPhotoGrid
              jobId={job.id}
              orgId={orgId}
              userId={session?.user.id}
              attachments={job.attachments ?? []}
              editable={can('jobs.update')}
              onChange={() => qc.invalidateQueries({ queryKey: ['jobs', id] })}
            />
          </Card>
        ) : null}

        {!isDone ? (
          <View className="gap-3 pt-2">
            <Input
              label="Completion notes (optional)"
              value={notes}
              onChangeText={setNotes}
              placeholder="What was done, anything to flag…"
              multiline
              numberOfLines={4}
              style={{ height: 100, textAlignVertical: 'top', paddingTop: 12 }}
            />
            {!isActive ? (
              <Button
                title="Start job"
                onPress={() => startMut.mutate()}
                loading={startMut.isPending}
              />
            ) : null}
            <Button
              title="Mark complete"
              variant={isActive ? 'primary' : 'secondary'}
              onPress={() => completeMut.mutate()}
              loading={completeMut.isPending}
            />
          </View>
        ) : (
          <Card className="bg-emerald-50 border-emerald-200">
            <Text className="text-emerald-700 font-semibold">
              Completed {formatDateTime(job.completed_at)}
            </Text>
          </Card>
        )}
      </View>
    </ScrollView>
  );
}
