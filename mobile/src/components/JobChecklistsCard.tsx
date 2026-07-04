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
import { useTranslation } from '@/lib/i18n';

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
  const { t } = useTranslation();
  const c = t.mobileComp;
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
      const tpl = (templates ?? []).find((x) => x.id === tplId)!;
      return attachChecklist({ orgId, jobId, template: tpl });
    },
    onSuccess: (created) => {
      setPickerOpen(false);
      qc.invalidateQueries({ queryKey: ['job-checklists', jobId] });
      router.push(`/(app)/checklist/${created.id}` as any);
    },
    onError: (e: Error) => Alert.alert(c.checklist, e.message),
  });

  const progress = (cl: { items: any[]; responses: Record<string, unknown>; completed_at: string | null }) => {
    if (cl.completed_at) return c.completed;
    const total = cl.items?.length ?? 0;
    const filled = cl.items?.filter((it) => {
      const v = cl.responses?.[it.id];
      return v != null && v !== '' && v !== false;
    }).length ?? 0;
    return `${filled}/${total}`;
  };

  return (
    <View className="gap-2 rounded-2xl bg-white p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{c.checklists}</Text>
        <Pressable onPress={() => setPickerOpen(true)} className="flex-row items-center gap-1 active:opacity-60">
          <SymbolView name="plus.circle.fill" tintColor="#2563EB" size={18} />
          <Text className="text-sm font-semibold text-brand">{c.add}</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#171717" />
      ) : (checklists?.length ?? 0) === 0 ? (
        <Text className="text-sm text-ink-muted">{c.noChecklists}</Text>
      ) : (
        checklists!.map((cl) => (
          <Pressable
            key={cl.id}
            onPress={() => router.push(`/(app)/checklist/${cl.id}` as any)}
            className="flex-row items-center justify-between border-t border-surface-border pt-2 active:opacity-60"
          >
            <Text className="flex-1 text-base text-ink">{cl.name ?? c.checklist}</Text>
            <Text className={`text-sm font-semibold ${cl.completed_at ? 'text-status-completed' : 'text-ink-muted'}`}>
              {progress(cl)}
            </Text>
          </Pressable>
        ))
      )}

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setPickerOpen(false)}>
          <Pressable className="gap-2 rounded-t-3xl bg-white p-5" onPress={(e) => e.stopPropagation()}>
            <Text className="text-lg font-bold text-ink">{c.chooseTemplate}</Text>
            {(templates ?? []).length === 0 ? (
              <Text className="py-4 text-sm text-ink-muted">
                {c.noTemplateForJobType}
              </Text>
            ) : (
              (templates ?? []).map((tpl) => (
                <Pressable
                  key={tpl.id}
                  onPress={() => attach.mutate(tpl.id)}
                  className="rounded-xl border border-surface-border p-3 active:opacity-60"
                >
                  <Text className="text-base font-semibold text-ink">{tpl.name}</Text>
                  {tpl.description ? <Text className="text-sm text-ink-muted">{tpl.description}</Text> : null}
                  <Text className="mt-0.5 text-xs text-ink-subtle">{c.itemsCount.replace('{count}', String(tpl.items.length))}</Text>
                </Pressable>
              ))
            )}
            <Pressable onPress={() => setPickerOpen(false)} className="items-center py-2">
              <Text className="text-sm text-ink-muted">{c.cancel}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
