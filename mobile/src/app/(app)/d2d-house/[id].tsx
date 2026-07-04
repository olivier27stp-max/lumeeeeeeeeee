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
} from '@/lib/api/fieldSales';
import { createLead } from '@/lib/api/leads';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';
import { MK } from '@/lib/offline/mutationKeys';

// `labelKey` refs a key under t.mobileD2D; it is resolved at render time.
const QUICK_ACTIONS: { type: HouseEventType; labelKey: string; status?: HouseStatus }[] = [
  { type: 'knock', labelKey: 'actionKnock' },
  { type: 'no_answer', labelKey: 'actionNoAnswer' },
  { type: 'lead', labelKey: 'actionLead' },
  { type: 'callback', labelKey: 'actionCallback' },
  { type: 'quote_sent', labelKey: 'actionQuoteSent' },
  { type: 'sale', labelKey: 'actionSale' },
  { type: 'status_change', labelKey: 'actionNotInterested', status: 'not_interested' },
  { type: 'do_not_knock', labelKey: 'actionDoNotKnock' },
];

// Maps a house status / event slug to its t.mobileD2D key (label resolved in render).
const STATUS_LABEL_KEY: Record<string, string> = {
  unknown: 'statusUnknown',
  no_answer: 'statusNoAnswer',
  not_interested: 'statusNotInterested',
  lead: 'statusLead',
  quote_sent: 'statusQuoteSent',
  sale: 'statusSale',
  callback: 'statusCallback',
  do_not_knock: 'statusDoNotKnock',
  revisit: 'statusRevisit',
  knock: 'actionKnock',
};

export default function HouseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { orgId, can } = usePermissions();
  const { t } = useTranslation();

  const d2d = t.mobileD2D as Record<string, string>;
  const statusLabel = (slug: string) => {
    const key = STATUS_LABEL_KEY[slug];
    return key ? d2d[key] : slug;
  };

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
    onError: (e: Error) => Alert.alert(t.mobileD2D.couldNotLog, e.message),
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
        firstName: firstName || t.mobileD2D.leadFirstNameFallback,
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
              {statusLabel(status)}
            </Text>
          </View>
          <Text className="text-xl font-bold text-ink">{house?.address ?? t.mobileD2D.houseFallback}</Text>
          <Text className="text-xs text-ink-muted">
            {t.mobileD2D.visitsCount.replace('{count}', String(house?.visit_count ?? 0))}
          </Text>
        </View>

        <Card className="gap-3">
          <Text className="text-xs uppercase text-ink-muted">{t.mobileD2D.customerOptional}</Text>
          <Input label={t.mobileD2D.nameLabel} value={name} onChangeText={setName} placeholder={t.mobileD2D.namePlaceholder} />
          <Input
            label={t.mobileD2D.phoneLabel}
            value={phone}
            onChangeText={setPhone}
            placeholder={t.mobileD2D.phonePlaceholder}
            keyboardType="phone-pad"
          />
          <Input
            label={t.mobileD2D.noteLabel}
            value={note}
            onChangeText={setNote}
            placeholder={t.mobileD2D.notePlaceholder}
            multiline
            numberOfLines={3}
            style={{ height: 80, textAlignVertical: 'top', paddingTop: 12 }}
          />
        </Card>

        <View className="gap-2">
          <Text className="text-xs uppercase text-ink-muted">{t.mobileD2D.logInteraction}</Text>
          <View className="flex-row flex-wrap gap-2">
            {QUICK_ACTIONS.map((a) => (
              <Pressable
                key={a.type}
                disabled={logMut.isPending}
                onPress={() => logAction({ type: a.type, status: a.status })}
                className="rounded-full border border-slate-300 bg-white px-4 py-2"
              >
                <Text className="text-sm text-ink">{d2d[a.labelKey]}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {can('jobs.create') ? (
          <Button
            title={t.mobileD2D.scheduleVisit}
            variant="secondary"
            onPress={() =>
              router.push(
                `/(app)/jobs/new?address=${encodeURIComponent(house?.address ?? '')}&title=${encodeURIComponent(t.mobileD2D.appointmentPrefix + (name || house?.address || ''))}` as any,
              )
            }
          />
        ) : null}

        <Card className="gap-2">
          <Text className="text-xs uppercase text-ink-muted">{t.mobileD2D.history}</Text>
          {(events ?? []).length === 0 ? (
            <Text className="text-sm text-ink-subtle">{t.mobileD2D.noActivityYet}</Text>
          ) : (
            (events ?? []).map((e) => (
              <View key={e.id} className="flex-row justify-between border-b border-slate-100 py-1">
                <Text className="text-sm text-ink">{statusLabel(e.event_type)}</Text>
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
