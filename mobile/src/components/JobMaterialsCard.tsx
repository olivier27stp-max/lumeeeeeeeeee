import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { addJobMaterial, deleteJobMaterial, listJobMaterials } from '@/lib/api/materials';
import { useAuth } from '@/lib/auth';

/** Tech-facing log of materials/supplies used on a job. */
export function JobMaterialsCard({
  jobId,
  orgId,
  canSeePricing,
}: {
  jobId: string;
  orgId: string;
  canSeePricing: boolean;
}) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('');
  const [cost, setCost] = useState('');

  const { data: materials } = useQuery({
    queryKey: ['job-materials', jobId],
    queryFn: () => listJobMaterials(jobId),
    enabled: !!jobId,
  });

  const add = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error('Nom du matériel requis.');
      return addJobMaterial({
        orgId,
        jobId,
        createdBy: userId,
        name,
        quantity: parseFloat(qty) || 1,
        unit: unit.trim() || null,
        unitCostCents: canSeePricing && cost ? Math.round(parseFloat(cost) * 100) : null,
      });
    },
    onSuccess: () => {
      setName('');
      setQty('1');
      setUnit('');
      setCost('');
      setAdding(false);
      qc.invalidateQueries({ queryKey: ['job-materials', jobId] });
    },
    onError: (e: Error) => Alert.alert('Matériel', e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteJobMaterial(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-materials', jobId] }),
  });

  return (
    <View className="gap-3 rounded-2xl bg-white p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">Matériel utilisé</Text>
        <Pressable onPress={() => setAdding((v) => !v)} className="flex-row items-center gap-1">
          <SymbolView name={adding ? 'minus.circle.fill' : 'plus.circle.fill'} tintColor="#2563EB" size={18} />
          <Text className="text-sm font-semibold text-brand">{adding ? 'Fermer' : 'Ajouter'}</Text>
        </Pressable>
      </View>

      {adding ? (
        <View className="gap-2">
          <Input value={name} onChangeText={setName} placeholder="Ex. Tuyau PVC 1/2''" />
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Input value={qty} onChangeText={setQty} placeholder="Qté" keyboardType="numeric" />
            </View>
            <View className="flex-1">
              <Input value={unit} onChangeText={setUnit} placeholder="Unité (pi, kg…)" />
            </View>
            {canSeePricing ? (
              <View className="flex-1">
                <Input value={cost} onChangeText={setCost} placeholder="$/u" keyboardType="numeric" />
              </View>
            ) : null}
          </View>
          <Button title="Enregistrer le matériel" onPress={() => add.mutate()} loading={add.isPending} />
        </View>
      ) : null}

      {(materials?.length ?? 0) === 0 ? (
        <Text className="text-sm text-ink-muted">Aucun matériel enregistré.</Text>
      ) : (
        materials!.map((m) => (
          <View key={m.id} className="flex-row items-center justify-between border-t border-surface-border pt-2">
            <View className="flex-1">
              <Text className="text-base text-ink">{m.name}</Text>
              <Text className="text-xs text-ink-subtle">
                {m.quantity}
                {m.unit ? ` ${m.unit}` : ''}
                {canSeePricing && m.unit_cost_cents != null ? ` · ${(m.unit_cost_cents / 100).toFixed(2)} $/u` : ''}
              </Text>
            </View>
            <Pressable onPress={() => del.mutate(m.id)} hitSlop={8}>
              <SymbolView name="trash" tintColor="#A3A3A3" size={15} />
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}
