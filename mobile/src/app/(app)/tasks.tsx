import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  TaskPriority,
  TaskRow,
  createTask,
  deleteTask,
  listTasks,
  setTaskStatus,
} from '@/lib/api/tasks';
import { listMembers } from '@/lib/api/org';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/usePermissions';

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  high: '#DC2626',
  medium: '#D97706',
  low: '#16A34A',
};

const DUE_OPTIONS = [
  { key: 'none', label: 'Aucune' },
  { key: 'today', label: "Aujourd'hui" },
  { key: 'tomorrow', label: 'Demain' },
  { key: 'week', label: 'Cette semaine' },
];

function dueIso(key: string): string | null {
  const d = new Date();
  if (key === 'today') return d.toISOString().slice(0, 10);
  if (key === 'tomorrow') {
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (key === 'week') {
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

export default function Tasks() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const { orgId, role } = usePermissions();
  const userId = session?.user.id ?? '';
  const isManager = role === 'owner' || role === 'admin';

  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [showDone, setShowDone] = useState(false);
  const [creating, setCreating] = useState(false);

  // create form
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [due, setDue] = useState('none');
  const [assignee, setAssignee] = useState<string | null>(userId);

  const { data: tasks } = useQuery({
    queryKey: ['tasks', orgId, scope, userId],
    queryFn: () =>
      listTasks(String(orgId), {
        assigneeUserId: scope === 'mine' ? userId : undefined,
        status: 'all',
      }),
    enabled: !!orgId,
  });

  const { data: members } = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => listMembers(String(orgId)),
    enabled: !!orgId && isManager && creating,
  });

  const create = useMutation({
    mutationFn: () => {
      if (!title.trim()) throw new Error('Titre requis.');
      return createTask({
        orgId: String(orgId),
        createdBy: userId,
        title,
        description: desc || null,
        priority,
        dueDate: dueIso(due),
        assigneeUserId: assignee,
      });
    },
    onSuccess: () => {
      setCreating(false);
      setTitle('');
      setDesc('');
      setPriority('medium');
      setDue('none');
      setAssignee(userId);
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e: Error) => Alert.alert('Tâche', e.message),
  });

  const toggle = useMutation({
    mutationFn: (t: TaskRow) => setTaskStatus(t.id, t.status === 'done' ? 'open' : 'done'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const visible = (tasks ?? []).filter((t) => (showDone ? true : t.status === 'open'));
  const memberName = (uid: string | null) =>
    uid ? members?.find((m) => m.user_id === uid)?.full_name ?? null : null;

  return (
    <View className="flex-1 bg-surface-alt">
      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12 }}>
        {/* Scope + done toggle */}
        <View className="flex-row items-center justify-between">
          {isManager ? (
            <View className="flex-row rounded-2xl bg-surface-sunken p-1">
              {(['mine', 'all'] as const).map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setScope(s)}
                  className={`rounded-xl px-4 py-1.5 ${scope === s ? 'bg-white' : ''}`}
                >
                  <Text className={`text-sm font-semibold ${scope === s ? 'text-ink' : 'text-ink-muted'}`}>
                    {s === 'mine' ? 'Mes tâches' : 'Toutes'}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text className="text-base font-bold text-ink">Mes tâches</Text>
          )}
          <Pressable onPress={() => setShowDone((v) => !v)} className="flex-row items-center gap-1.5">
            <View className={`h-5 w-5 items-center justify-center rounded border ${showDone ? 'border-brand bg-brand' : 'border-surface-border'}`}>
              {showDone ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={12} /> : null}
            </View>
            <Text className="text-sm text-ink-muted">Voir terminées</Text>
          </Pressable>
        </View>

        {visible.length === 0 ? (
          <View className="items-center py-16">
            <Text className="text-sm text-ink-muted">Aucune tâche.</Text>
          </View>
        ) : (
          visible.map((t) => (
            <View key={t.id} className="flex-row items-start gap-3 rounded-2xl bg-white p-4">
              <Pressable onPress={() => toggle.mutate(t)} className="pt-0.5">
                <View
                  className={`h-6 w-6 items-center justify-center rounded-full border-2 ${t.status === 'done' ? 'border-status-completed bg-status-completed' : 'border-surface-border'}`}
                >
                  {t.status === 'done' ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={13} /> : null}
                </View>
              </Pressable>
              <View className="flex-1">
                <Text className={`text-base font-semibold ${t.status === 'done' ? 'text-ink-subtle line-through' : 'text-ink'}`}>
                  {t.title}
                </Text>
                {t.description ? <Text className="text-sm text-ink-muted">{t.description}</Text> : null}
                <View className="mt-1 flex-row flex-wrap items-center gap-2">
                  <View className="flex-row items-center gap-1">
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: PRIORITY_COLOR[t.priority] }} />
                    <Text className="text-xs text-ink-subtle">{t.priority}</Text>
                  </View>
                  {t.due_date ? <Text className="text-xs text-ink-subtle">· échéance {t.due_date}</Text> : null}
                  {scope === 'all' && memberName(t.assignee_user_id) ? (
                    <Text className="text-xs text-ink-subtle">· {memberName(t.assignee_user_id)}</Text>
                  ) : null}
                </View>
              </View>
              <Pressable onPress={() => del.mutate(t.id)} hitSlop={8}>
                <SymbolView name="trash" tintColor="#A3A3A3" size={16} />
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>

      {/* FAB */}
      <Pressable
        onPress={() => setCreating(true)}
        className="absolute bottom-8 right-6 h-14 w-14 items-center justify-center rounded-full bg-brand"
        style={{ shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}
      >
        <SymbolView name="plus" tintColor="#FFFFFF" size={24} />
      </Pressable>

      {/* Create modal */}
      <Modal visible={creating} transparent animationType="slide" onRequestClose={() => setCreating(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setCreating(false)}>
          <Pressable className="gap-3 rounded-t-3xl bg-white p-5" onPress={(e) => e.stopPropagation()}>
            <Text className="text-lg font-bold text-ink">Nouvelle tâche</Text>
            <Input label="Titre" value={title} onChangeText={setTitle} placeholder="Ex. Rappeler le client" />
            <Input label="Description" value={desc} onChangeText={setDesc} placeholder="Optionnel" multiline />

            <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">Priorité</Text>
            <View className="flex-row gap-2">
              {(['low', 'medium', 'high'] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPriority(p)}
                  className={`flex-1 items-center rounded-xl border py-2 ${priority === p ? 'border-ink bg-ink' : 'border-surface-border'}`}
                >
                  <Text className={`text-sm font-semibold ${priority === p ? 'text-white' : 'text-ink'}`}>{p}</Text>
                </Pressable>
              ))}
            </View>

            <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">Échéance</Text>
            <View className="flex-row flex-wrap gap-2">
              {DUE_OPTIONS.map((o) => (
                <Pressable
                  key={o.key}
                  onPress={() => setDue(o.key)}
                  className={`rounded-full border px-3.5 py-1.5 ${due === o.key ? 'border-ink bg-ink' : 'border-surface-border'}`}
                >
                  <Text className={`text-xs font-semibold ${due === o.key ? 'text-white' : 'text-ink'}`}>{o.label}</Text>
                </Pressable>
              ))}
            </View>

            {isManager ? (
              <>
                <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">Assigner à</Text>
                <View className="flex-row flex-wrap gap-2">
                  <Pressable
                    onPress={() => setAssignee(userId)}
                    className={`rounded-full border px-3.5 py-1.5 ${assignee === userId ? 'border-ink bg-ink' : 'border-surface-border'}`}
                  >
                    <Text className={`text-xs font-semibold ${assignee === userId ? 'text-white' : 'text-ink'}`}>Moi</Text>
                  </Pressable>
                  {(members ?? [])
                    .filter((m) => m.user_id !== userId)
                    .map((m) => (
                      <Pressable
                        key={m.user_id}
                        onPress={() => setAssignee(m.user_id)}
                        className={`rounded-full border px-3.5 py-1.5 ${assignee === m.user_id ? 'border-ink bg-ink' : 'border-surface-border'}`}
                      >
                        <Text className={`text-xs font-semibold ${assignee === m.user_id ? 'text-white' : 'text-ink'}`}>
                          {m.full_name ?? 'Membre'}
                        </Text>
                      </Pressable>
                    ))}
                </View>
              </>
            ) : null}

            <Button title="Créer la tâche" onPress={() => create.mutate()} loading={create.isPending} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
