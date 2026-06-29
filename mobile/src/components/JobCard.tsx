import { Text, View } from 'react-native';

import { Job } from '@/types/db';
import { formatCurrencyCents, formatTime } from '@/lib/format';
import { Card } from './ui/Card';
import { StatusPill } from './ui/StatusPill';
import UnifiedAvatar from './ui/UnifiedAvatar';

type Props = {
  job: Job;
  onPress?: () => void;
  /**
   * Whether to show the job total. Defaults to false so pricing never leaks to
   * technicians. M1 wires this to `canSeePricing` from the permission layer.
   */
  showPricing?: boolean;
};

export function JobCard({ job, onPress, showPricing = false }: Props) {
  const when = job.scheduled_at ?? job.start_at ?? null;
  return (
    <Card onPress={onPress} className="gap-2">
      <View className="flex-row items-start gap-3">
        <UnifiedAvatar
          id={job.client_id || job.id}
          name={job.client_name || job.title}
          size={40}
        />
        <View className="flex-1">
          <Text className="text-xs text-ink-muted">#{job.job_number}</Text>
          <Text className="text-base font-semibold text-ink" numberOfLines={1}>
            {job.title}
          </Text>
          {job.client_name ? (
            <Text className="text-sm text-ink-muted" numberOfLines={1}>
              {job.client_name}
            </Text>
          ) : null}
        </View>
        <StatusPill status={job.status} />
      </View>

      <View className="flex-row items-center justify-between pt-1">
        <Text className="text-sm text-ink-muted">{formatTime(when)}</Text>
        {showPricing ? (
          <Text className="text-sm font-medium text-ink">
            {formatCurrencyCents(job.total_cents, job.currency)}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
