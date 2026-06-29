import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { StatusPill } from '@/components/ui/StatusPill';
import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import { CustomFieldsCard } from '@/components/CustomFieldsCard';
import { getClient, updateClient } from '@/lib/api/clients';
import { listJobsForClient } from '@/lib/api/jobs';
import { listInvoicesForClient, listQuotesForClient } from '@/lib/api/billing';
import { findOrCreateConversation, listRecentMessages } from '@/lib/api/messaging';
import { getClientLeadSource } from '@/lib/api/leads';
import { listActivityLog, activityLabel } from '@/lib/api/activity';
import { deviceLanguage } from '@/lib/contact';
import { clientFullName, formatCurrencyCents, formatDateTime } from '@/lib/format';
import { usePermissions } from '@/lib/usePermissions';

function Row({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const Inner = (
    <View className="gap-1">
      <Text className="text-xs text-ink-muted uppercase">{label}</Text>
      <Text className={`text-base ${onPress ? 'text-brand underline' : 'text-ink'}`}>
        {value}
      </Text>
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{Inner}</Pressable> : Inner;
}

export default function ClientDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can, canSeePricing, teamId, scope, permissions, role, orgId } = usePermissions();
  const { data: client, isLoading, error } = useQuery({
    queryKey: ['clients', id],
    queryFn: () => getClient(String(id)),
    enabled: !!id,
  });

  const { data: jobs } = useQuery({
    queryKey: ['jobs', 'client', id, role],
    queryFn: () => listJobsForClient(String(id), { teamId, scope, permissions, role }),
    enabled: !!id,
  });
  const { data: quotes } = useQuery({
    queryKey: ['quotes', 'client', id],
    queryFn: () => listQuotesForClient(String(id)),
    enabled: !!id && canSeePricing,
  });
  const { data: invoices } = useQuery({
    queryKey: ['invoices', 'client', id],
    queryFn: () => listInvoicesForClient(String(id)),
    enabled: !!id && canSeePricing,
  });

  // Recent SMS thread with this client (read from conversations/messages).
  const { data: messages } = useQuery({
    queryKey: ['client-messages', orgId, client?.phone],
    queryFn: () => listRecentMessages(String(orgId), String(client?.phone)),
    enabled: !!orgId && !!client?.phone,
  });

  // Lead source (from the linked lead) + full activity history.
  const { data: leadSource } = useQuery({
    queryKey: ['client-source', id],
    queryFn: () => getClientLeadSource(String(id)),
    enabled: !!id,
  });
  const { data: activity } = useQuery({
    queryKey: ['client-activity', orgId, id],
    queryFn: () => listActivityLog(String(orgId), 'client', String(id)),
    enabled: !!orgId && !!id,
  });
  const lang = deviceLanguage();

  // Billing rollup from the client's invoices.
  const invoiced = (invoices ?? []).reduce((s, i) => s + (i.total_cents ?? 0), 0);
  const balance = (invoices ?? []).reduce((s, i) => s + (i.balance_cents ?? 0), 0);
  const paid = invoiced - balance;

  // Editable notes (saved on blur).
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (client) setNotes(client.notes ?? '');
  }, [client?.id]);
  const saveNotesMut = useMutation({
    mutationFn: () => updateClient(String(id), { notes: notes.trim() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients', id] }),
    onError: (e: Error) => Alert.alert('Notes', e.message),
  });

  // Open (or create) the in-app Twilio conversation with this client.
  const openThread = async () => {
    if (!orgId || !client?.phone) return;
    try {
      const cid = await findOrCreateConversation({
        orgId: String(orgId),
        phone: client.phone,
        clientId: client.id,
        clientName: clientFullName(client),
      });
      router.push(
        `/(app)/conversation/${cid}?phone=${encodeURIComponent(client.phone)}&name=${encodeURIComponent(clientFullName(client))}&clientId=${encodeURIComponent(client.id)}` as any,
      );
    } catch (e) {
      Alert.alert('Message', (e as Error).message);
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <Text className="text-ink-muted">Loading…</Text>
      </View>
    );
  }
  if (error || !client) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt p-6">
        <Text className="text-ink-muted text-center">
          {error ? (error as Error).message : 'Client not found.'}
        </Text>
      </View>
    );
  }

  const address = [client.address, client.city, client.province, client.postal_code]
    .filter(Boolean)
    .join(', ');

  return (
    <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" className="flex-1 bg-surface-alt">
      <View className="p-5 gap-4">
        <View className="flex-row items-center gap-3">
          <UnifiedAvatar id={client.id} name={clientFullName(client)} size={56} />
          <View className="flex-1 gap-1">
            <Text className="text-2xl font-bold text-ink">{clientFullName(client)}</Text>
            {client.company ? (
              <Text className="text-base text-ink-muted">{client.company}</Text>
            ) : null}
          </View>
        </View>

        <Card className="gap-4">
          {client.phone ? (
            <Row
              label="Phone"
              value={client.phone}
              onPress={() => Linking.openURL(`tel:${client.phone}`)}
            />
          ) : null}
          {client.email ? (
            <Row
              label="Email"
              value={client.email}
              onPress={() => Linking.openURL(`mailto:${client.email}`)}
            />
          ) : null}
          {address ? (
            <Row
              label="Address"
              value={address}
              onPress={() =>
                Linking.openURL(`https://maps.apple.com/?q=${encodeURIComponent(address)}`)
              }
            />
          ) : null}
        </Card>

        {/* Status · lead source · client since */}
        <Card className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs text-ink-muted uppercase">Statut</Text>
            <StatusPill status={client.status} />
          </View>
          <View className="flex-row items-center justify-between border-t border-surface-border pt-3">
            <Text className="text-xs text-ink-muted uppercase">Source</Text>
            <Text className="text-sm text-ink">{leadSource || 'Non spécifiée'}</Text>
          </View>
          <View className="flex-row items-center justify-between border-t border-surface-border pt-3">
            <Text className="text-xs text-ink-muted uppercase">Client depuis</Text>
            <Text className="text-sm text-ink">{formatDateTime(client.created_at)}</Text>
          </View>
        </Card>

        {/* Billing rollup (admin) */}
        {canSeePricing && (invoices?.length ?? 0) > 0 ? (
          <Card>
            <Text className="text-xs text-ink-muted uppercase mb-2">Facturation</Text>
            <View className="flex-row justify-between">
              <View className="items-center flex-1">
                <Text className="text-[10px] uppercase text-ink-subtle">Facturé</Text>
                <Text className="text-base font-bold text-ink">{formatCurrencyCents(invoiced, 'CAD')}</Text>
              </View>
              <View className="items-center flex-1">
                <Text className="text-[10px] uppercase text-ink-subtle">Payé</Text>
                <Text className="text-base font-bold text-emerald-600">{formatCurrencyCents(paid, 'CAD')}</Text>
              </View>
              <View className="items-center flex-1">
                <Text className="text-[10px] uppercase text-ink-subtle">Solde</Text>
                <Text className={`text-base font-bold ${balance > 0 ? 'text-status-late' : 'text-ink'}`}>
                  {formatCurrencyCents(balance, 'CAD')}
                </Text>
              </View>
            </View>
          </Card>
        ) : null}

        {/* Quick actions */}
        {client.phone ? (
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button title="Appeler" variant="secondary" onPress={() => Linking.openURL(`tel:${client.phone}`)} />
            </View>
            <View className="flex-1">
              <Button title="Texter" variant="secondary" onPress={openThread} />
            </View>
          </View>
        ) : null}

        {/* Notes — editable on the spot (saves on blur) */}
        {can('clients.update') ? (
          <Card>
            <Text className="text-xs text-ink-muted uppercase mb-1">Notes</Text>
            <Input
              value={notes}
              onChangeText={setNotes}
              placeholder="Ajouter une note…"
              multiline
              onBlur={() => saveNotesMut.mutate()}
              style={{ height: 90, textAlignVertical: 'top', paddingTop: 10 }}
            />
          </Card>
        ) : client.notes ? (
          <Card>
            <Text className="text-xs text-ink-muted uppercase mb-1">Notes</Text>
            <Text className="text-base text-ink leading-6">{client.notes}</Text>
          </Card>
        ) : null}

        {/* Communications — recent SMS thread */}
        {client.phone ? (
          <Card className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-ink-muted uppercase">Communications</Text>
              <Pressable onPress={openThread}>
                <Text className="text-xs font-semibold text-brand">Ouvrir le fil</Text>
              </Pressable>
            </View>
            {(messages?.length ?? 0) === 0 ? (
              <Text className="text-sm text-ink-muted">Aucun message pour l&apos;instant.</Text>
            ) : (
              messages!.slice(-5).map((m) => (
                <View key={m.id} className="border-t border-surface-border pt-2">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-[11px] font-semibold uppercase text-ink-subtle">
                      {m.direction === 'outbound' ? 'Envoyé' : 'Reçu'}
                    </Text>
                    <Text className="text-[11px] text-ink-subtle">{formatDateTime(m.created_at)}</Text>
                  </View>
                  <Text className="text-sm text-ink leading-5" numberOfLines={3}>
                    {m.message_text}
                  </Text>
                </View>
              ))
            )}
          </Card>
        ) : null}

        {/* Jobs */}
        {(jobs?.length ?? 0) > 0 ? (
          <Card className="gap-2">
            <Text className="text-xs text-ink-muted uppercase">Jobs ({jobs!.length})</Text>
            {jobs!.map((j) => (
              <Pressable
                key={j.id}
                onPress={() => router.push(`/(app)/jobs/${j.id}`)}
                className="flex-row items-center justify-between border-t border-surface-border py-2.5"
              >
                <Text className="flex-1 text-sm text-ink" numberOfLines={1}>
                  {j.title}
                </Text>
                <StatusPill status={j.status} />
              </Pressable>
            ))}
          </Card>
        ) : null}

        {/* Quotes (admin) */}
        {canSeePricing && (quotes?.length ?? 0) > 0 ? (
          <Card className="gap-2">
            <Text className="text-xs text-ink-muted uppercase">Quotes ({quotes!.length})</Text>
            {quotes!.map((q) => (
              <View key={q.id} className="flex-row items-center justify-between border-t border-surface-border py-2.5">
                <Text className="text-sm text-ink">Quote {q.quote_number ?? ''} · {q.status ?? '—'}</Text>
                <Text className="text-sm font-medium text-ink">
                  {formatCurrencyCents(q.total_cents ?? 0, 'CAD')}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}

        {/* Invoices (admin) */}
        {canSeePricing && (invoices?.length ?? 0) > 0 ? (
          <Card className="gap-2">
            <Text className="text-xs text-ink-muted uppercase">Invoices ({invoices!.length})</Text>
            {invoices!.map((inv) => (
              <View key={inv.id} className="flex-row items-center justify-between border-t border-surface-border py-2.5">
                <Text className="text-sm text-ink">
                  Invoice {inv.invoice_number ?? ''} · {inv.status ?? '—'}
                </Text>
                <Text className="text-sm font-medium text-ink">
                  {formatCurrencyCents(inv.total_cents ?? 0, 'CAD')}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}

        {/* Activity timeline */}
        {(activity?.length ?? 0) > 0 ? (
          <Card className="gap-2">
            <Text className="text-xs text-ink-muted uppercase">Activité</Text>
            {activity!.map((a) => (
              <View key={a.id} className="flex-row items-start justify-between border-t border-surface-border pt-2">
                <Text className="flex-1 text-sm text-ink" numberOfLines={2}>
                  {activityLabel(a.event_type, lang)}
                </Text>
                <Text className="ml-2 text-[11px] text-ink-subtle">{formatDateTime(a.created_at)}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        {orgId ? <CustomFieldsCard orgId={orgId} entity="clients" recordId={client.id} /> : null}

        {can('clients.update') ? (
          <Button
            title="Edit client"
            variant="secondary"
            onPress={() => router.push(`/(app)/clients/edit?id=${client.id}`)}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}
