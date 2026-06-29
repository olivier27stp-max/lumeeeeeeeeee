import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Lead, LEAD_STAGES, createLead, listLeads, updateLeadStatus } from '@/lib/api/leads';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/usePermissions';

export default function Leads() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const { orgId, role } = usePermissions();
  const userId = session?.user.id ?? '';
  const isManager = role === 'owner' || role === 'admin';

  const [scope, setScope] = useState<'mine' | 'all'>(isManager ? 'all' : 'mine');
  const [creating, setCreating] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);

  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const { data: leads } = useQuery({
    queryKey: ['leads', orgId, scope, userId],
    queryFn: () => listLeads(String(orgId), { assignedTo: scope === 'mine' ? userId : undefined }),
    enabled: !!orgId,
  });

  const create = useMutation({
    mutationFn: () => {
      if (!first.trim() && !phone.trim()) throw new Error('Nom ou téléphone requis.');
      return createLead({
        orgId: String(orgId),
        firstName: first || 'Lead',
        lastName: last,
        phone: phone || null,
        email: email || null,
        assignedTo: userId,
      });
    },
    onSuccess: () => {
      setCreating(false);
      setFirst('');
      setLast('');
      setPhone('');
      setEmail('');
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (e: Error) => Alert.alert('Lead', e.message),
  });

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateLeadStatus(id, status),
    onSuccess: () => {
      setEditLead(null);
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });

  // Group leads by stage in stage order.
  const byStage = LEAD_STAGES.map((s) => ({
    ...s,
    leads: (leads ?? []).filter((l) => (l.status || 'new') === s.key),
  })).filter((g) => g.leads.length > 0);

  return (
    <View className="flex-1 bg-surface-alt">
      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 14 }}>
        {isManager ? (
          <View className="flex-row self-start rounded-2xl bg-surface-sunken p-1">
            {(['mine', 'all'] as const).map((s) => (
              <Pressable key={s} onPress={() => setScope(s)} className={`rounded-xl px-4 py-1.5 ${scope === s ? 'bg-white' : ''}`}>
                <Text className={`text-sm font-semibold ${scope === s ? 'text-ink' : 'text-ink-muted'}`}>
                  {s === 'mine' ? 'Mes leads' : 'Tous'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {byStage.length === 0 ? (
          <View className="items-center py-16">
            <Text className="text-sm text-ink-muted">Aucun lead. Touchez « + » pour en ajouter.</Text>
          </View>
        ) : (
          byStage.map((g) => (
            <View key={g.key} className="gap-2">
              <Text className="text-[11px] font-bold uppercase tracking-widest text-ink-subtle">
                {g.label} · {g.leads.length}
              </Text>
              {g.leads.map((l) => (
                <Pressable
                  key={l.id}
                  onPress={() => setEditLead(l)}
                  className="flex-row items-center justify-between rounded-2xl bg-white p-4 active:opacity-70"
                >
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-ink">
                      {[l.first_name, l.last_name].filter(Boolean).join(' ') || 'Lead'}
                    </Text>
                    <Text className="text-sm text-ink-muted">{l.phone ?? l.email ?? l.company ?? '—'}</Text>
                  </View>
                  {l.value ? <Text className="text-sm font-semibold text-ink-muted">{l.value}$</Text> : null}
                  <SymbolView name="chevron.right" tintColor="#A3A3A3" size={13} />
                </Pressable>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      <Pressable
        onPress={() => setCreating(true)}
        className="absolute bottom-8 right-6 h-14 w-14 items-center justify-center rounded-full bg-brand"
        style={{ shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}
      >
        <SymbolView name="plus" tintColor="#FFFFFF" size={24} />
      </Pressable>

      {/* Create */}
      <Modal visible={creating} transparent animationType="slide" onRequestClose={() => setCreating(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setCreating(false)}>
          <Pressable className="gap-3 rounded-t-3xl bg-white p-5" onPress={(e) => e.stopPropagation()}>
            <Text className="text-lg font-bold text-ink">Nouveau lead</Text>
            <Input label="Prénom" value={first} onChangeText={setFirst} placeholder="Jean" />
            <Input label="Nom" value={last} onChangeText={setLast} placeholder="Tremblay" />
            <Input label="Téléphone" value={phone} onChangeText={setPhone} placeholder="(514)…" keyboardType="phone-pad" />
            <Input label="Courriel" value={email} onChangeText={setEmail} placeholder="optionnel" keyboardType="email-address" autoCapitalize="none" />
            <Button title="Créer le lead" onPress={() => create.mutate()} loading={create.isPending} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Move stage */}
      <Modal visible={!!editLead} transparent animationType="slide" onRequestClose={() => setEditLead(null)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setEditLead(null)}>
          <Pressable className="gap-2 rounded-t-3xl bg-white p-5" onPress={(e) => e.stopPropagation()}>
            <Text className="text-lg font-bold text-ink">
              {editLead ? [editLead.first_name, editLead.last_name].filter(Boolean).join(' ') : ''}
            </Text>
            <Text className="text-sm text-ink-muted">Changer l’étape</Text>
            {LEAD_STAGES.map((s) => {
              const sel = editLead?.status === s.key;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => editLead && move.mutate({ id: editLead.id, status: s.key })}
                  className={`flex-row items-center justify-between rounded-xl border p-3 ${sel ? 'border-ink bg-ink' : 'border-surface-border'}`}
                >
                  <Text className={`text-base font-semibold ${sel ? 'text-white' : 'text-ink'}`}>{s.label}</Text>
                  {sel ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={14} /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
