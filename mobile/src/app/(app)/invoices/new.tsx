import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ClientPicker, PickedClient } from '@/components/ClientPicker';
import { LineItemsEditor } from '@/components/LineItemsEditor';
import { createInvoice, getOrgTaxRatePct, LineItemInput } from '@/lib/api/billing';
import { getJob, listJobLineItems, listJobsInRange } from '@/lib/api/jobs';
import { Job } from '@/types/db';
import { formatCurrencyCents, formatTime } from '@/lib/format';
import { usePermissions } from '@/lib/usePermissions';
import { useTranslation } from '@/lib/i18n';

const DEFAULT_TAX = '14.975';

/** Default payment term: net-30 — due 30 days after the invoice is prepared today. */
function net30FromToday(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export default function NewInvoice() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { orgId, teamId, scope, permissions, role, can, canSeePricing } = usePermissions();
  const access = { teamId, scope, permissions, role };

  // Optional deep-link: /invoices/new?jobId=… (e.g. from the "Send invoice?"
  // prompt after a job is completed) preselects that job and prefills its items.
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();

  const [mode, setMode] = useState<'client' | 'job'>(jobId ? 'job' : 'client');
  const [client, setClient] = useState<PickedClient | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [jobSearch, setJobSearch] = useState('');
  const [subject, setSubject] = useState('');
  const [dueDate, setDueDate] = useState(net30FromToday);
  const [items, setItems] = useState<LineItemInput[]>([]);
  const [taxRate, setTaxRate] = useState(DEFAULT_TAX);

  // Use the org's tax rate configured on the desktop (Settings → Taxes) instead
  // of a hardcoded value, so mobile invoices match the web.
  const { data: orgTax } = useQuery({
    queryKey: ['org-tax', orgId],
    queryFn: () => getOrgTaxRatePct(String(orgId)),
    enabled: !!orgId,
  });
  useEffect(() => {
    if (orgTax != null) setTaxRate(String(orgTax));
  }, [orgTax]);

  // From-job mode: list recent jobs to pick from.
  const range = useMemo(() => {
    const s = new Date(); s.setDate(s.getDate() - 60);
    const e = new Date(); e.setDate(e.getDate() + 30);
    return { s: s.toISOString(), e: e.toISOString() };
  }, []);
  const { data: jobsList } = useQuery({
    queryKey: ['jobs', 'invoice-picker', orgId, role, teamId],
    queryFn: () => listJobsInRange(range.s, range.e, access),
    enabled: mode === 'job' && !job && !!orgId,
  });
  const filteredJobs = (jobsList ?? []).filter((j) =>
    (j.title + ' ' + (j.client_name ?? '')).toLowerCase().includes(jobSearch.toLowerCase()),
  );

  // Line items from the chosen job (to seed the editor).
  const { data: jobItems } = useQuery({
    queryKey: ['job-line-items', job?.id],
    queryFn: () => listJobLineItems(String(job?.id)),
    enabled: !!job?.id,
  });
  const seed: LineItemInput[] = (jobItems ?? []).map((it) => ({
    name: it.name,
    qty: it.qty,
    unit_price_cents: it.unit_price_cents,
  }));

  const pickJob = (j: Job) => {
    setJob(j);
    setClient(j.client_id ? { id: j.client_id, name: j.client_name ?? 'Client' } : null);
    setSubject(j.title ?? '');
  };

  // Arrived with ?jobId=… → fetch that job once and preselect it (prefills the
  // client + subject; line items seed from the job below).
  const { data: prefillJob } = useQuery({
    queryKey: ['job', 'invoice-prefill', jobId],
    queryFn: () => getJob(String(jobId), access),
    enabled: !!jobId && !!orgId && !job,
  });
  useEffect(() => {
    if (prefillJob && !job) pickJob(prefillJob);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillJob]);

  const totals = useMemo(() => {
    const subtotal = items.reduce((s, i) => s + Math.round(i.qty * i.unit_price_cents), 0);
    const tax = Math.round((subtotal * (parseFloat(taxRate) || 0)) / 100);
    return { subtotal, tax, total: subtotal + tax };
  }, [items, taxRate]);

  const saveMut = useMutation({
    mutationFn: () =>
      createInvoice({
        orgId: orgId ?? '',
        clientId: client!.id,
        subject: subject.trim(),
        dueDate: dueDate.trim() || null,
        items,
        taxRatePct: parseFloat(taxRate) || 0,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      // After creating → the send-confirmation page.
      router.replace(`/(app)/invoices/send?id=${data.id}`);
    },
    onError: (e: Error) => Alert.alert(t.mobileBilling.couldNotCreateInvoice, e.message),
  });

  if (!(can('invoices.create') || canSeePricing)) return <Redirect href="/(app)/(tabs)" />;

  return (
    <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 20, gap: 14 }}>
      {/* Mode toggle — like the web's "From a job / From a client" */}
      <View className="flex-row rounded-2xl bg-surface-sunken p-1">
        {(['client', 'job'] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => { setMode(m); setJob(null); setClient(null); }}
            className={`flex-1 items-center rounded-xl py-2 ${mode === m ? 'bg-white' : ''}`}
          >
            <Text className={`text-sm font-semibold ${mode === m ? 'text-ink' : 'text-ink-muted'}`}>
              {m === 'client' ? t.mobileBilling.fromClient : t.mobileBilling.fromJob}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* From job: pick a job (prefills client + items) */}
      {mode === 'job' && !job ? (
        <View className="gap-2">
          <Input label={t.mobileBilling.searchJob} value={jobSearch} onChangeText={setJobSearch} placeholder={t.mobileBilling.searchJobPlaceholder} />
          {filteredJobs.slice(0, 12).map((j) => (
            <Pressable key={j.id} onPress={() => pickJob(j)} className="rounded-xl border border-surface-border bg-white px-4 py-3">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-sm font-semibold text-ink" numberOfLines={1}>{j.title}</Text>
                {canSeePricing ? (
                  <Text className="text-sm font-bold text-ink">{formatCurrencyCents(j.total_cents, j.currency)}</Text>
                ) : null}
              </View>
              <Text className="text-xs text-ink-muted">
                {j.client_name ?? '—'} · {formatTime(j.scheduled_at)}
              </Text>
            </Pressable>
          ))}
          {filteredJobs.length === 0 ? <Text className="text-xs text-ink-subtle">{t.mobileBilling.noJobFound}</Text> : null}
        </View>
      ) : null}

      {/* Client (from-client mode, or the chosen job's client) */}
      {mode === 'client' ? (
        <>
          <Text className="px-1 text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.invoices.client}</Text>
          <ClientPicker value={client} onChange={setClient} />
        </>
      ) : job ? (
        <View className="flex-row items-center justify-between rounded-2xl bg-white p-4">
          <View>
            <Text className="text-[11px] uppercase text-ink-subtle">{t.mobileBilling.fromJob}</Text>
            <Text className="text-base font-semibold text-ink">{job.title}</Text>
            <Text className="text-xs text-ink-muted">{client?.name ?? t.mobileBilling.noClientOnJob}</Text>
          </View>
          <Pressable onPress={() => { setJob(null); setClient(null); }}>
            <Text className="text-sm text-brand">{t.mobileBilling.change}</Text>
          </Pressable>
        </View>
      ) : null}

      <Input label={t.mobileBilling.subject} value={subject} onChangeText={setSubject} placeholder={t.mobileBilling.subjectPlaceholder} />
      <Input
        label={t.mobileBilling.dueDateLabel}
        value={dueDate}
        onChangeText={setDueDate}
        placeholder={t.mobileBilling.dueDatePlaceholder}
        autoCapitalize="none"
      />

      <LineItemsEditor onChange={setItems} seed={seed} seedKey={job?.id} />

      <Input label={t.mobileBilling.taxRate} value={taxRate} onChangeText={setTaxRate} keyboardType="decimal-pad" placeholder={DEFAULT_TAX} />

      <View className="gap-1 rounded-2xl bg-white p-4">
        <Row label={t.mobileBilling.subtotal} value={formatCurrencyCents(totals.subtotal, 'CAD')} />
        <Row label={t.mobileBilling.tax} value={formatCurrencyCents(totals.tax, 'CAD')} />
        <Row label={t.mobileBilling.total} value={formatCurrencyCents(totals.total, 'CAD')} bold />
      </View>

      <Button
        title={t.mobileBilling.createInvoice}
        onPress={() => saveMut.mutate()}
        loading={saveMut.isPending}
        disabled={!client || items.length === 0 || !orgId}
      />
    </ScrollView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View className="flex-row justify-between">
      <Text className={bold ? 'text-base font-bold text-ink' : 'text-sm text-ink-muted'}>{label}</Text>
      <Text className={bold ? 'text-base font-bold text-ink' : 'text-sm text-ink'}>{value}</Text>
    </View>
  );
}
