import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SignaturePad } from '@/components/SignaturePad';
import {
  ChecklistItem,
  completeChecklist,
  getJobChecklist,
  saveChecklistResponses,
} from '@/lib/api/checklists';
import { capturePhoto, uploadJobPhoto, uploadJobSignature } from '@/lib/api/jobPhotos';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

export default function ChecklistFill() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { session } = useAuth();
  const { orgId } = usePermissions();
  const userId = session?.user.id ?? '';

  const { data: checklist, isLoading } = useQuery({
    queryKey: ['job-checklist', id],
    queryFn: () => getJobChecklist(String(id)),
    enabled: !!id,
  });

  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [sigItemId, setSigItemId] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const done = !!checklist?.completed_at;

  useEffect(() => {
    if (checklist) setResponses(checklist.responses ?? {});
  }, [checklist?.id]);

  const set = (itemId: string, value: unknown) =>
    setResponses((r) => ({ ...r, [itemId]: value }));

  const saveDraft = useMutation({
    mutationFn: () => saveChecklistResponses(String(id), responses),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-checklist', id] }),
  });

  const complete = useMutation({
    mutationFn: () => {
      const missing = (checklist?.items ?? []).filter(
        (it) => it.required && !hasValue(responses[it.id]),
      );
      if (missing.length)
        throw new Error(
          t.mobileComp.requiredFieldsMissing.replace('{fields}', missing.map((m) => m.label).join(', ')),
        );
      return completeChecklist(String(id), responses, userId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job-checklist', id] });
      qc.invalidateQueries({ queryKey: ['job-checklists', checklist?.job_id] });
      router.back();
    },
    onError: (e: Error) => Alert.alert(t.mobileComp.checklist, e.message),
  });

  const addPhoto = async (item: ChecklistItem) => {
    if (!checklist || !orgId) return;
    const img = await capturePhoto();
    if (!img) return;
    setBusyItem(item.id);
    try {
      const att = await uploadJobPhoto({ jobId: checklist.job_id, orgId, uri: img.uri, userId });
      set(item.id, att.url);
    } catch (e) {
      Alert.alert(t.mobileComp.photo, (e as Error).message);
    } finally {
      setBusyItem(null);
    }
  };

  const saveSig = async (base64Png: string) => {
    if (!checklist || !orgId || !sigItemId) return;
    const item = sigItemId;
    setSigItemId(null);
    setBusyItem(item);
    try {
      const att = await uploadJobSignature({ jobId: checklist.job_id, orgId, base64Png, userId });
      set(item, att.url);
    } catch (e) {
      Alert.alert(t.mobileJobs.signature, (e as Error).message);
    } finally {
      setBusyItem(null);
    }
  };

  if (isLoading || !checklist) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <ActivityIndicator color="#171717" />
      </View>
    );
  }

  return (
    <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 20, gap: 14 }}>
      <View>
        <Text className="text-xl font-bold text-ink">{checklist.name ?? t.mobileComp.checklist}</Text>
        {done ? (
          <Text className="mt-1 text-sm font-semibold text-status-completed">{t.mobileComp.completed}</Text>
        ) : null}
      </View>

      {(checklist.items ?? []).map((item) => {
        const val = responses[item.id];
        return (
          <View key={item.id} className="gap-2 rounded-2xl bg-white p-4">
            <Text className="text-sm font-semibold text-ink">
              {item.label}
              {item.required ? <Text className="text-status-late"> *</Text> : null}
            </Text>

            {item.type === 'checkbox' ? (
              <Pressable
                disabled={done}
                onPress={() => set(item.id, !val)}
                className="flex-row items-center gap-2"
              >
                <View
                  className={`h-6 w-6 items-center justify-center rounded-md border ${val ? 'border-brand bg-brand' : 'border-surface-border'}`}
                >
                  {val ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={14} /> : null}
                </View>
                <Text className="text-ink-muted">{val ? t.mobileComp.yes : t.mobileComp.no}</Text>
              </Pressable>
            ) : null}

            {item.type === 'text' ? (
              <Input
                value={String(val ?? '')}
                onChangeText={(txt) => set(item.id, txt)}
                editable={!done}
                placeholder="…"
                multiline
              />
            ) : null}

            {item.type === 'number' ? (
              <Input
                value={val != null ? String(val) : ''}
                onChangeText={(txt) => set(item.id, txt.replace(/[^0-9.]/g, ''))}
                editable={!done}
                keyboardType="numeric"
                placeholder="0"
              />
            ) : null}

            {item.type === 'photo' ? (
              <View className="gap-2">
                {typeof val === 'string' && val ? (
                  <Image source={{ uri: val }} className="h-40 w-full rounded-xl" resizeMode="cover" />
                ) : null}
                {!done ? (
                  <Button
                    title={val ? t.mobileComp.retakePhoto : t.mobileComp.takePhoto}
                    variant="secondary"
                    onPress={() => addPhoto(item)}
                    loading={busyItem === item.id}
                  />
                ) : null}
              </View>
            ) : null}

            {item.type === 'signature' ? (
              <View className="gap-2">
                {typeof val === 'string' && val ? (
                  <Image source={{ uri: val }} className="h-32 w-full rounded-xl bg-surface-sunken" resizeMode="contain" />
                ) : null}
                {!done ? (
                  <Button
                    title={val ? t.mobileComp.resign : t.mobileComp.sign}
                    variant="secondary"
                    onPress={() => setSigItemId(item.id)}
                    loading={busyItem === item.id}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}

      {!done ? (
        <View className="gap-3 pt-2">
          <Button title={t.mobileComp.finishChecklist} onPress={() => complete.mutate()} loading={complete.isPending} />
          <Button
            title={t.mobileComp.saveDraft}
            variant="secondary"
            onPress={() => saveDraft.mutate()}
            loading={saveDraft.isPending}
          />
        </View>
      ) : null}

      <SignaturePad visible={!!sigItemId} onClose={() => setSigItemId(null)} onSave={saveSig} />
    </ScrollView>
  );
}

function hasValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'boolean') return v === true;
  return true;
}
