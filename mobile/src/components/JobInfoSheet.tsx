// A slide-up pop-up that shows a job's full details on top of the current
// screen (no navigation). Works for both real jobs (fetches client + services
// from the DB) and the hard-coded demo jobs (renders straight from the object),
// so tapping any card on Home/Schedule always shows "what the job is".

import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { getClient } from '@/lib/api/clients';
import { listJobLineItems } from '@/lib/api/jobs';
import { callNumber, openDirections, promptCall } from '@/lib/contact';
import { useTranslation } from '@/lib/i18n';
import { clientFullName, formatCurrencyCents, formatDateTime } from '@/lib/format';
import { usePermissions } from '@/lib/usePermissions';
import { Job } from '@/types/db';

function Field({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const inner = (
    <View>
      <Text className="text-xs text-ink-muted uppercase mb-0.5">{label}</Text>
      <Text className={`text-base ${onPress ? 'text-brand underline' : 'text-ink'}`}>{value}</Text>
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{inner}</Pressable> : inner;
}

export function JobInfoSheet({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { canSeePricing, can } = usePermissions();
  const isDemo = !!job && (job.org_id === 'demo' || String(job.id).startsWith('demo'));

  const { data: client } = useQuery({
    queryKey: ['clients', job?.client_id],
    queryFn: () => getClient(String(job?.client_id)),
    enabled: !!job?.client_id && !isDemo,
  });

  const { data: lineItems } = useQuery({
    queryKey: ['jobs', job?.id, 'lineItems'],
    queryFn: () => listJobLineItems(String(job?.id)),
    enabled: !!job?.id && !isDemo,
  });

  if (!job) return null;

  const when = job.scheduled_at ?? job.start_at ?? null;
  const phone = client?.phone ?? (isDemo ? '+15145550123' : null);
  const clientAddress = client
    ? [client.address, client.city, client.province, client.postal_code].filter(Boolean).join(', ')
    : '';
  const address = job.property_address ?? clientAddress;
  const go = (path: string) => {
    onClose();
    router.push(path as any);
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      {/* Backdrop — tap to dismiss. Inline styles so layout never depends on nativewind resolution. */}
      <Pressable
        onPress={onClose}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}
      >
        {/* Sheet — explicit height so the inner ScrollView (flex:1) actually gets a size. */}
        <Pressable
          onPress={() => {}}
          style={{ height: '85%', backgroundColor: '#F5F5F4', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' }}
        >
          {/* Grabber + header */}
          <View className="items-center pt-3">
            <View className="h-1 w-10 rounded-full bg-surface-border" />
          </View>
          <View className="flex-row items-center justify-between px-5 pb-3 pt-3">
            <Text className="text-xs text-ink-muted">#{job.job_number}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text className="text-base font-medium text-brand">Fermer</Text>
            </Pressable>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 16 }}>
            <View className="gap-2">
              <Text className="text-2xl font-bold text-ink">{job.title}</Text>
              <StatusPill status={job.status} />
            </View>

            {/* When + where */}
            <View className="gap-3 rounded-2xl border border-surface-border bg-white p-4">
              <Field label="Scheduled" value={formatDateTime(when)} />
              {address ? (
                <Field
                  label="Adresse"
                  value={address}
                  onPress={() =>
                    openDirections({ latitude: job.latitude, longitude: job.longitude, address })
                  }
                />
              ) : null}
              {canSeePricing ? <Field label="Total" value={formatCurrencyCents(job.total_cents, job.currency)} /> : null}
            </View>

            {/* Services */}
            {lineItems && lineItems.length > 0 ? (
              <View className="gap-2 rounded-2xl border border-surface-border bg-white p-4">
                <Text className="text-xs text-ink-muted uppercase">Services</Text>
                {lineItems.map((li) => (
                  <View key={li.id} className="flex-row items-center justify-between border-t border-surface-border pt-2.5">
                    <Text className="flex-1 pr-3 text-base text-ink">
                      {li.qty > 1 ? `${li.qty}× ` : ''}
                      {li.name}
                    </Text>
                    {canSeePricing ? (
                      <Text className="text-base font-medium text-ink">
                        {formatCurrencyCents(li.total_cents, job.currency)}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}

            {/* Client */}
            {client || job.client_name ? (
              <View className="gap-3 rounded-2xl border border-surface-border bg-white p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="text-xs text-ink-muted uppercase">Client</Text>
                  {client && can('clients.update') ? (
                    <Pressable onPress={() => go(`/(app)/clients/edit?id=${client.id}`)}>
                      <Text className="text-sm font-medium text-brand">Modifier</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text className="text-base font-semibold text-ink">
                  {client ? clientFullName(client) : job.client_name}
                </Text>
                {client?.company ? <Text className="text-sm text-ink-muted">{client.company}</Text> : null}
                {clientAddress || address ? (
                  <Field
                    label="Adresse"
                    value={clientAddress || address!}
                    onPress={() =>
                      openDirections({ latitude: job.latitude, longitude: job.longitude, address: clientAddress || address })
                    }
                  />
                ) : null}
                {phone ? <Field label="Téléphone" value={phone} onPress={() => promptCall(job.client_name, phone)} /> : null}
                {client?.email ? (
                  <Field
                    label="Courriel"
                    value={client.email}
                    onPress={() => Linking.openURL(`mailto:${client.email}`)}
                  />
                ) : null}
              </View>
            ) : null}

            {/* Description / notes */}
            {job.description ? (
              <View className="gap-1 rounded-2xl border border-surface-border bg-white p-4">
                <Text className="text-xs text-ink-muted uppercase">Description</Text>
                <Text className="text-base text-ink leading-6">{job.description}</Text>
              </View>
            ) : null}

            {/* Actions */}
            <View className="gap-2">
              {job.client_name || job.client_id || client ? (
                <Button
                  title={t.mobileUi.viewClient}
                  onPress={() => {
                    const cid = client?.id ?? job.client_id;
                    if (cid) go(`/(app)/clients/${cid}`);
                    else Alert.alert(t.mobileUi.demoClientTitle, t.mobileUi.demoClientBody);
                  }}
                />
              ) : null}
              {address ? (
                <Button
                  title={t.mobileUi.directions}
                  variant="secondary"
                  onPress={() => openDirections({ latitude: job.latitude, longitude: job.longitude, address })}
                />
              ) : null}
              {phone ? (
                <Button title={t.mobileUi.callClient} variant="secondary" onPress={() => callNumber(phone)} />
              ) : null}
              {!isDemo ? (
                <Button
                  title={t.mobileUi.viewJob}
                  variant="secondary"
                  onPress={() => go(`/(app)/jobs/${job.id}`)}
                />
              ) : null}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
