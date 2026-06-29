import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  getHouse,
  HouseEventType,
  HouseStatus,
  listHouseEvents,
  STATUS_COLOR,
  STATUS_LABEL,
} from '@/lib/api/fieldSales';
import { createLead } from '@/lib/api/leads';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/usePermissions';
import { MK } from '@/lib/offline/mutationKeys';

const QUICK_ACTIONS: { type: HouseEventType; label: string; status?: HouseStatus }[] = [
  { type: 'knock', label: 'Knock' },
  { type: 'no_answer', label: 'No answer' },
  { type: 'lead', label: 'Lead' },
  { type: 'callback', label: 'Callback' },
  { type: 'quote_sent', label: 'Quote sent' },
  { type: 'sale', label: 'Sale' },
  { type: 'status_change', label: 'Not interested', status: 'not_interested' },
  { type: 'do_not_knock', label: 'Do not knock' },
];

export default function HouseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { orgId, can } = usePermissions();

  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const { data: house } = useQuery({
    queryKey: ['d2d', 'house', id],
    queryFn: () => getHouse(String(id)),
    enabled: !!id,
  });
  const { data: events } = useQuery({
    queryKey: ['d2d', 'events', id],
    queryFn: () => listHouseEvents(String(id)),
    enabled: !!id,
  });

  // Offline-capable (shared key): a knock/lead logged with no signal is queued.
  const logMut = useMutation<
    unknown,
    Error,
    {
      orgId: string;
      houseId: string;
      userId: string;
      eventType: HouseEventType;
      statusOverride: HouseStatus | null;
      noteText: string | null;
      customer: { name?: string; phone?: string } | null;
    }
  >({
    mutationKey: MK.d2dLogEvent,
    onSuccess: () => setNote(''),
    onError: (e: Error) => Alert.alert('Could not log', e.message),
  });

  const logAction = (action: { type: HouseEventType; status?: HouseStatus }) => {
    logMut.mutate({
      orgId: orgId ?? '',
      houseId: String(id),
      userId: session?.user.id ?? '',
      eventType: action.type,
      statusOverride: action.status ?? null,
      noteText: note.trim() || null,
      customer: name || phone ? { name: name || undefined, phone: phone || undefined } : null,
    });

    // A door-side "Lead" with contact info also becomes a real CRM lead so it
    // shows up in the pipeline (best-effort; the house event is the source of truth).
    if (action.type === 'lead' && orgId && (name.trim() || phone.trim())) {
      const [firstName, ...rest] = name.trim().split(/\s+/);
      createLead({
        orgId,
        firstName: firstName || 'Lead',
        lastName: rest.join(' '),
        phone: phone.trim() || null,
        notes: note.trim() || null,
        assignedTo: session?.user.id ?? null,
        source: 'd2d',
      }).catch((e) => console.warn('[d2d-house] createLead failed:', e?.message ?? e));
    }
  };

  const status = house?.current_status ?? 'unknown';

  return (
    <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" className="flex-1 bg-surface-alt">
      <View className="p-5 gap-4">
        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            <View
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                backgroundColor: STATUS_COLOR[status] ?? '#3B82F6',
                borderWidth: 1,
                borderColor: '#CBD5E1',
              }}
            />
            <Text className="text-sm font-medium text-ink">
              {STATUS_LABEL[status] ?? status}
            </Text>
          </View>
          <Text className="text-xl font-bold text-ink">{house?.address ?? 'House'}</Text>
          <Text className="text-xs text-ink-muted">
            {house?.visit_count ?? 0} visits
          </Text>
        </View>

        <Card className="gap-3">
          <Text className="text-xs uppercase text-ink-muted">Customer (optional)</Text>
          <Input label="Name" value={name} onChangeText={setName} placeholder="Jane Doe" />
          <Input
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            placeholder="(555) 123-4567"
            keyboardType="phone-pad"
          />
          <Input
            label="Note"
            value={note}
            onChangeText={setNote}
            placeholder="Anything worth remembering…"
            multiline
            numberOfLines={3}
            style={{ height: 80, textAlignVertical: 'top', paddingTop: 12 }}
          />
        </Card>

        <View className="gap-2">
          <Text className="text-xs uppercase text-ink-muted">Log an interaction</Text>
          <View className="flex-row flex-wrap gap-2">
            {QUICK_ACTIONS.map((a) => (
              <Pressable
                key={a.type}
                disabled={logMut.isPending}
                onPress={() => logAction({ type: a.type, status: a.status })}
                className="rounded-full border border-slate-300 bg-white px-4 py-2"
              >
                <Text className="text-sm text-ink">{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {can('jobs.create') ? (
          <Button
            title="Planifier un RDV / une visite"
            variant="secondary"
            onPress={() =>
              router.push(
                `/(app)/jobs/new?address=${encodeURIComponent(house?.address ?? '')}&title=${encodeURIComponent('RDV — ' + (name || house?.address || ''))}` as any,
              )
            }
          />
        ) : null}

        <Card className="gap-2">
          <Text className="text-xs uppercase text-ink-muted">History</Text>
          {(events ?? []).length === 0 ? (
            <Text className="text-sm text-ink-subtle">No activity yet.</Text>
          ) : (
            (events ?? []).map((e) => (
              <View key={e.id} className="flex-row justify-between border-b border-slate-100 py-1">
                <Text className="text-sm text-ink">{STATUS_LABEL[e.event_type] ?? e.event_type}</Text>
                <Text className="text-xs text-ink-subtle">
                  {new Date(e.created_at).toLocaleDateString()}
                </Text>
              </View>
            ))
          )}
        </Card>
      </View>
    </ScrollView>
  );
}
