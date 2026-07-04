import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { getJob, updateJob } from '@/lib/api/jobs';
import { usePermissions } from '@/lib/usePermissions';
import { useTranslation } from '@/lib/i18n';

export default function EditJob() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = usePermissions();
  const { t } = useTranslation();

  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');

  const { data: job, isLoading } = useQuery({
    queryKey: ['jobs', id],
    queryFn: () => getJob(String(id)),
    enabled: !!id,
  });

  useEffect(() => {
    if (job) {
      setTitle(job.title ?? '');
      setAddress(job.property_address ?? '');
      setDescription(job.description ?? '');
    }
  }, [job]);

  const saveMut = useMutation({
    mutationFn: () =>
      updateJob(String(id), {
        title: title.trim(),
        property_address: address.trim(),
        description: description.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      router.back();
    },
    onError: (e: Error) => Alert.alert(t.mobileJobs.couldNotSave, e.message),
  });

  if (!can('jobs.update')) return <Redirect href="/(app)/(tabs)" />;
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <ActivityIndicator color="#171717" />
      </View>
    );
  }

  return (
    <ScreenContainer scroll>
      <View className="gap-3 py-4">
        <Input label={t.mobileJobs.title} value={title} onChangeText={setTitle} />
        <Input label={t.mobileJobs.address} value={address} onChangeText={setAddress} />
        <Input
          label={t.mobileJobs.description}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          style={{ height: 80, textAlignVertical: 'top', paddingTop: 12 }}
        />
        <Button
          title={t.mobileJobs.saveChanges}
          onPress={() => saveMut.mutate()}
          loading={saveMut.isPending}
          disabled={!title.trim()}
        />
      </View>
    </ScreenContainer>
  );
}
