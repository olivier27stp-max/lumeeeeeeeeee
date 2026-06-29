import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  CustomColumn,
  CustomValue,
  getCustomValues,
  listCustomColumns,
  saveCustomValue,
} from '@/lib/api/customFields';

/** Renders an org's custom fields for one record (job/client) and saves edits. */
export function CustomFieldsCard({
  orgId,
  entity,
  recordId,
}: {
  orgId: string;
  entity: CustomColumn['entity'];
  recordId: string;
}) {
  const qc = useQueryClient();
  const { data: columns } = useQuery({
    queryKey: ['custom-columns', orgId, entity],
    queryFn: () => listCustomColumns(orgId, entity),
    enabled: !!orgId,
  });
  const { data: values } = useQuery({
    queryKey: ['custom-values', orgId, recordId],
    queryFn: () => getCustomValues(orgId, recordId),
    enabled: !!orgId && !!recordId,
  });

  const [draft, setDraft] = useState<Record<string, CustomValue>>({});
  useEffect(() => {
    if (values) setDraft(values);
  }, [values]);

  const save = useMutation({
    mutationFn: async (col: CustomColumn) => {
      await saveCustomValue({
        orgId,
        columnId: col.id,
        recordId,
        colType: col.col_type,
        value: draft[col.id] ?? null,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-values', orgId, recordId] }),
    onError: (e: Error) => Alert.alert('Champ', e.message),
  });

  if (!columns || columns.length === 0) return null;

  return (
    <View className="gap-3 rounded-2xl bg-white p-4">
      <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">Champs personnalisés</Text>
      {columns.map((col) => {
        const v = draft[col.id];
        return (
          <View key={col.id} className="gap-1.5">
            <Text className="text-sm font-semibold text-ink">
              {col.name}
              {col.required ? <Text className="text-status-late"> *</Text> : null}
            </Text>

            {col.col_type === 'checkbox' ? (
              <Pressable
                onPress={() => {
                  setDraft((d) => ({ ...d, [col.id]: !v }));
                }}
                className="flex-row items-center gap-2"
              >
                <View className={`h-6 w-6 items-center justify-center rounded-md border ${v ? 'border-brand bg-brand' : 'border-surface-border'}`}>
                  {v ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={13} /> : null}
                </View>
                <Text className="text-ink-muted">{v ? 'Oui' : 'Non'}</Text>
              </Pressable>
            ) : col.col_type === 'dropdown' || col.col_type === 'status' ? (
              <View className="flex-row flex-wrap gap-2">
                {(col.config.options ?? []).map((opt) => (
                  <Pressable
                    key={opt}
                    onPress={() => setDraft((d) => ({ ...d, [col.id]: opt }))}
                    className={`rounded-full border px-3 py-1.5 ${v === opt ? 'border-ink bg-ink' : 'border-surface-border'}`}
                  >
                    <Text className={`text-xs font-semibold ${v === opt ? 'text-white' : 'text-ink'}`}>{opt}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Input
                value={v != null ? String(v) : ''}
                onChangeText={(t) => setDraft((d) => ({ ...d, [col.id]: t }))}
                placeholder={col.col_type === 'date' ? 'AAAA-MM-JJ' : '…'}
                keyboardType={
                  ['number', 'currency', 'rating'].includes(col.col_type)
                    ? 'numeric'
                    : col.col_type === 'phone'
                      ? 'phone-pad'
                      : col.col_type === 'email'
                        ? 'email-address'
                        : 'default'
                }
                autoCapitalize={['email', 'url'].includes(col.col_type) ? 'none' : 'sentences'}
                onBlur={() => save.mutate(col)}
              />
            )}

            {(col.col_type === 'checkbox' || col.col_type === 'dropdown' || col.col_type === 'status') ? (
              <Button title="Enregistrer" variant="secondary" onPress={() => save.mutate(col)} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
