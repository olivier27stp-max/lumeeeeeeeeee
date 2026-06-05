import { Text, View } from 'react-native';

import { Job } from '@/types/db';
import { formatCurrencyCents, formatTime } from '@/lib/format';
import { Card } from './ui/Card';
import { StatusPill } from './ui/StatusPill';

type Props = {
  job: Job;
  onPress?: () => void;
};

export function JobCard({ job, onPress }: Props) {
  const when = job.scheduled_at ?? job.start_at ?? null;
  return (
    <Card onPress={onPress} className="gap-2">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-xs text-ink-muted">#{job.job_number}</Text>
          <Text className="text-base font-semibold text-ink" numberOfLines={1}>
            {job.title}
          </Text>
        </View>
        <StatusPill status={job.status} />
      </View>

      {job.client_name ? (
        <Text className="text-sm text-ink-muted" numberOfLines={1}>
          {job.client_name}
        </Text>
      ) : null}

      <View className="flex-row items-center justify-between pt-1">
        <Text className="text-sm text-ink-muted">{formatTime(when)}</Text>
        <Text className="text-sm font-medium text-ink">
          {formatCurrencyCents(job.total_cents, job.currency)}
        </Text>
      </View>
    </Card>
  );
}
