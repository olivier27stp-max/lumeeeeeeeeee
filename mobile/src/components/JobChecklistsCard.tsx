import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, Text, View } from 'react-native';

import {
  attachChecklist,
  listChecklistTemplates,
  listJobChecklists,
} from '@/lib/api/checklists';

/** On-site checklists/forms for a job. Templates are configured on desktop. */
export function JobChecklistsCard({
  jobId,
  orgId,
  jobType,
}: {
  jobId: string;
  orgId: string;
  jobType?: string | null;
}) {
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: checklists, isLoading } = useQuery({
    queryKey: ['job-checklists', jobId],
    queryFn: () => listJobChecklists(jobId),
    enabled: !!jobId,
  });

  const { data: templates } = useQuery({
    queryKey: ['checklist-templates', orgId, jobType],
    queryFn: () => listChecklistTemplates(orgId, jobType),
    enabled: pickerOpen && !!orgId,
  });

  const attach = useMutation({
    mutationFn: (tplId: string) => {
      const tpl = (templates ?? []).find((t) => t.id === tplId)!;
      return attachChecklist({ orgId, jobId, template: tpl });
    },
    onSuccess: (created) => {
      setPickerOpen(false);
      qc.invalidateQueries({ queryKey: ['job-checklists', jobId] });
      router.push(`/(app)/checklist/${created.id}` as any);
    },
    onError: (e: Error) => Alert.alert('Checklist', e.message),
  });

  const progress = (c: { items: any[]; responses: Record<string, unknown>; completed_at: string | null }) => {
    if (c.completed_at) return 'Complétée ✓';
    const total = c.items?.length ?? 0;
    const filled = c.items?.filter((it) => {
      const v = c.responses?.[it.id];
      return v != null && v !== '' && v !== false;
    }).length ?? 0;
    return `${filled}/${total}`;
  };

  return (
    <View className="gap-2 rounded-2xl bg-white p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">Checklists</Text>
        <Pressable onPress={() => setPickerOpen(true)} className="flex-row items-center gap-1 active:opacity-60">
          <SymbolView name="plus.circle.fill" tintColor="#2563EB" size={18} />
          <Text className="text-sm font-semibold text-brand">Ajouter</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#171717" />
      ) : (checklists?.length ?? 0) === 0 ? (
        <Text className="text-sm text-ink-muted">Aucune checklist. Touchez « Ajouter ».</Text>
      ) : (
        checklists!.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => router.push(`/(app)/checklist/${c.id}` as any)}
            className="flex-row items-center justify-between border-t border-surface-border pt-2 active:opacity-60"
          >
            <Text className="flex-1 text-base text-ink">{c.name ?? 'Checklist'}</Text>
            <Text className={`text-sm font-semibold ${c.completed_at ? 'text-status-completed' : 'text-ink-muted'}`}>
              {progress(c)}
            </Text>
          </Pressable>
        ))
      )}

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setPickerOpen(false)}>
          <Pressable className="gap-2 rounded-t-3xl bg-white p-5" onPress={(e) => e.stopPropagation()}>
            <Text className="text-lg font-bold text-ink">Choisir un modèle</Text>
            {(templates ?? []).length === 0 ? (
              <Text className="py-4 text-sm text-ink-muted">
                Aucun modèle pour ce type de job. Créez-en sur le bureau (Réglages → Checklists).
              </Text>
            ) : (
              (templates ?? []).map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => attach.mutate(t.id)}
                  className="rounded-xl border border-surface-border p-3 active:opacity-60"
                >
                  <Text className="text-base font-semibold text-ink">{t.name}</Text>
                  {t.description ? <Text className="text-sm text-ink-muted">{t.description}</Text> : null}
                  <Text className="mt-0.5 text-xs text-ink-subtle">{t.items.length} éléments</Text>
                </Pressable>
              ))
            )}
            <Pressable onPress={() => setPickerOpen(false)} className="items-center py-2">
              <Text className="text-sm text-ink-muted">Annuler</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
