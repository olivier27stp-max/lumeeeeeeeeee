import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { listInvoicesForJob, listQuotesForJob } from '@/lib/api/billing';
import { formatCurrencyCents } from '@/lib/format';

type Props = {
  jobId: string;
  currency: string;
};

/** Admin/owner billing summary for a job. Rendered only behind canSeePricing. */
export function JobBillingCard({ jobId, currency }: Props) {
  const { data: invoices } = useQuery({
    queryKey: ['billing', 'invoices', jobId],
    queryFn: () => listInvoicesForJob(jobId),
    enabled: !!jobId,
  });
  const { data: quotes } = useQuery({
    queryKey: ['billing', 'quotes', jobId],
    queryFn: () => listQuotesForJob(jobId),
    enabled: !!jobId,
  });

  const hasAny = (invoices?.length ?? 0) > 0 || (quotes?.length ?? 0) > 0;

  return (
    <Card className="gap-3">
      <Text className="text-xs uppercase text-ink-muted">Billing</Text>

      {!hasAny ? (
        <Text className="text-sm text-ink-subtle">No quotes or invoices yet.</Text>
      ) : null}

      {(quotes ?? []).map((q) => (
        <View key={q.id} className="flex-row items-center justify-between">
          <View>
            <Text className="text-sm font-medium text-ink">Quote {q.quote_number ?? ''}</Text>
            <Text className="text-xs text-ink-muted">{q.status ?? '—'}</Text>
          </View>
          <Text className="text-sm text-ink">
            {formatCurrencyCents(q.total_cents ?? 0, currency)}
          </Text>
        </View>
      ))}

      {(invoices ?? []).map((inv) => (
        <View key={inv.id} className="flex-row items-center justify-between">
          <View>
            <Text className="text-sm font-medium text-ink">
              Invoice {inv.invoice_number ?? ''}
            </Text>
            <Text className="text-xs text-ink-muted">
              {inv.status ?? '—'}
              {inv.balance_cents != null && inv.balance_cents > 0
                ? ` · ${formatCurrencyCents(inv.balance_cents, currency)} due`
                : ''}
            </Text>
          </View>
          <Text className="text-sm text-ink">
            {formatCurrencyCents(inv.total_cents ?? 0, currency)}
          </Text>
        </View>
      ))}
    </Card>
  );
}
