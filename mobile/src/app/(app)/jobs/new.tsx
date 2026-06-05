import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { createJob, JobInput } from '@/lib/api/jobs';
import { listClients } from '@/lib/api/clients';
import { clientFullName } from '@/lib/format';
import { usePermissions } from '@/lib/usePermissions';

export default function NewJob() {
  const qc = useQueryClient();
  const { orgId, teamId, canCreateJobs } = usePermissions();

  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [scheduleToday, setScheduleToday] = useState(true);

  const { data: clientResults } = useQuery({
    queryKey: ['clients', 'search', clientSearch],
    queryFn: () => listClients(clientSearch),
    enabled: !client && clientSearch.trim().length >= 2,
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const input: JobInput = {
        title: title.trim(),
        description: description.trim() || null,
        property_address: address.trim() || null,
        client_id: client?.id ?? null,
        client_name: client?.name ?? null,
        team_id: teamId ?? null,
        scheduled_at: scheduleToday ? new Date().toISOString() : null,
      };
      return createJob(orgId ?? '', input);
    },
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      router.replace(`/(app)/jobs/${job.id}`);
    },
    onError: (e: Error) => Alert.alert('Could not create job', e.message),
  });

  if (!canCreateJobs) return <Redirect href="/(app)/(tabs)" />;

  return (
    <ScrollView className="flex-1 bg-surface-alt">
      <View className="p-5 gap-3">
        <Input label="Title" value={title} onChangeText={setTitle} placeholder="e.g. AC maintenance" />

        {/* Client picker */}
        {client ? (
          <Card className="flex-row items-center justify-between">
            <Text className="text-base text-ink">{client.name}</Text>
            <Pressable onPress={() => setClient(null)}>
              <Text className="text-sm text-brand">Change</Text>
            </Pressable>
          </Card>
        ) : (
          <View className="gap-2">
            <Input
              label="Client (optional)"
              value={clientSearch}
              onChangeText={setClientSearch}
              placeholder="Search a client…"
            />
            {(clientResults ?? []).slice(0, 5).map((c) => (
              <Pressable
                key={c.id}
                onPress={() => {
                  setClient({ id: c.id, name: clientFullName(c) });
                  setClientSearch('');
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <Text className="text-sm text-ink">{clientFullName(c)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Input label="Address" value={address} onChangeText={setAddress} placeholder="Job site address" />
        <Input
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Scope of work…"
          multiline
          numberOfLines={3}
          style={{ height: 80, textAlignVertical: 'top', paddingTop: 12 }}
        />

        <Pressable
          onPress={() => setScheduleToday((s) => !s)}
          className="flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
        >
          <Text className="text-sm text-ink">Schedule for today</Text>
          <Text className="text-lg">{scheduleToday ? '☑️' : '⬜️'}</Text>
        </Pressable>

        <Button
          title="Create job"
          onPress={() => saveMut.mutate()}
          loading={saveMut.isPending}
          disabled={!title.trim() || !orgId}
        />
      </View>
    </ScrollView>
  );
}
