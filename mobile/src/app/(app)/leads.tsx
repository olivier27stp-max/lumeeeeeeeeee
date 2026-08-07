import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Lead, LEAD_STAGES, createLead, listLeads, updateLeadStatus } from '@/lib/api/leads';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

// Maps a lead stage slug to its t.mobileD2D key (label resolved in render).
const STAGE_LABEL_KEY: Record<string, string> = {
  new: 'stageNew',
  contacted: 'stageContacted',
  follow_up_1: 'stageFollowUp1',
  follow_up_2: 'stageFollowUp2',
  quote_sent: 'stageQuoteSent',
  won: 'stageWon',
  lost: 'stageLost',
};

export default function Leads() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const { orgId, role, can } = usePermissions();
  const { t } = useTranslation();

  const d2d = t.mobileD2D as Record<string, string>;
  const stageLabel = (key: string) => d2d[STAGE_LABEL_KEY[key]] ?? key;
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
      if (!first.trim() && !phone.trim()) throw new Error(t.mobileD2D.nameOrPhoneRequired);
      return createLead({
        orgId: String(orgId),
        firstName: first || t.mobileD2D.leadFallback,
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
    onError: (e: Error) => Alert.alert(t.mobileD2D.leadAlertTitle, e.message),
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
    leads: (leads ?? []).filter((l) => (l.status || 'new_prospect') === s.key),
  })).filter((g) => g.leads.length > 0);

  // Same gate as the web (`permission="leads.read"`): technicians can't view the
  // pipeline. RLS scopes rows to the caller, but the screen is deep-linkable.
  if (!can('leads.read')) return <Redirect href="/(app)/(tabs)/profile" />;

  return (
    <View className="flex-1 bg-surface-alt">
      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 14 }}>
        {isManager ? (
          <View className="flex-row self-start rounded-2xl bg-surface-sunken p-1">
            {(['mine', 'all'] as const).map((s) => (
              <Pressable key={s} onPress={() => setScope(s)} className={`rounded-xl px-4 py-1.5 ${scope === s ? 'bg-white' : ''}`}>
                <Text className={`text-sm font-semibold ${scope === s ? 'text-ink' : 'text-ink-muted'}`}>
                  {s === 'mine' ? t.mobileD2D.scopeMine : t.mobileD2D.scopeAll}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {byStage.length === 0 ? (
          <View className="items-center py-16">
            <Text className="text-sm text-ink-muted">{t.mobileD2D.noLeadsHint}</Text>
          </View>
        ) : (
          byStage.map((g) => (
            <View key={g.key} className="gap-2">
              <Text className="text-[11px] font-bold uppercase tracking-widest text-ink-subtle">
                {stageLabel(g.key)} · {g.leads.length}
              </Text>
              {g.leads.map((l) => (
                <Pressable
                  key={l.id}
                  onPress={() => setEditLead(l)}
                  className="flex-row items-center justify-between rounded-2xl bg-white p-4 active:opacity-70"
                >
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-ink">
                      {[l.first_name, l.last_name].filter(Boolean).join(' ') || t.mobileD2D.leadFallback}
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
            <Text className="text-lg font-bold text-ink">{t.mobileD2D.newLead}</Text>
            <Input label={t.mobileD2D.firstNameLabel} value={first} onChangeText={setFirst} placeholder={t.mobileD2D.firstNamePlaceholder} />
            <Input label={t.mobileD2D.lastNameLabel} value={last} onChangeText={setLast} placeholder={t.mobileD2D.lastNamePlaceholder} />
            <Input label={t.mobileD2D.leadPhoneLabel} value={phone} onChangeText={setPhone} placeholder={t.mobileD2D.leadPhonePlaceholder} keyboardType="phone-pad" />
            <Input label={t.mobileD2D.emailLabel} value={email} onChangeText={setEmail} placeholder={t.mobileD2D.emailPlaceholder} keyboardType="email-address" autoCapitalize="none" />
            <Button title={t.mobileD2D.createLead} onPress={() => create.mutate()} loading={create.isPending} />
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
            <Text className="text-sm text-ink-muted">{t.mobileD2D.changeStage}</Text>
            {LEAD_STAGES.map((s) => {
              const sel = editLead?.status === s.key;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => editLead && move.mutate({ id: editLead.id, status: s.key })}
                  className={`flex-row items-center justify-between rounded-xl border p-3 ${sel ? 'border-ink bg-ink' : 'border-surface-border'}`}
                >
                  <Text className={`text-base font-semibold ${sel ? 'text-white' : 'text-ink'}`}>{stageLabel(s.key)}</Text>
                  {sel ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={14} /> : null}
                </Pressable>
              );
            })}

            {/* Convertir en job — c'est ce qui renseigne jobs.lead_id, et ce
                parcours n'existait pas sur mobile. Le lead EST le client. */}
            <Pressable
              onPress={() => {
                if (!editLead) return;
                const q = new URLSearchParams({
                  clientId: editLead.id,
                  leadId: editLead.id,
                  clientName: `${editLead.first_name ?? ''} ${editLead.last_name ?? ''}`.trim() || 'Client',
                  title: editLead.company || '',
                }).toString();
                setEditLead(null);
                router.push(`/(app)/jobs/new?${q}` as any);
              }}
              className="mt-2 items-center rounded-xl bg-ink py-3"
            >
              <Text className="text-base font-semibold text-white">{t.modals.convertToJob}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
