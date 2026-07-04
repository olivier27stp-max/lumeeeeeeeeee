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
import { sendPushToUsers } from '@/lib/api/pushNotifications';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  high: '#DC2626',
  medium: '#D97706',
  low: '#16A34A',
};

const DUE_KEYS = ['none', 'today', 'tomorrow', 'week'] as const;

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
  const { t: tr } = useTranslation();
  const qc = useQueryClient();
  const { session } = useAuth();
  const { orgId, role } = usePermissions();
  const userId = session?.user.id ?? '';
  const isManager = role === 'owner' || role === 'admin';

  const dueLabel: Record<(typeof DUE_KEYS)[number], string> = {
    none: tr.mobileMisc.dueNone,
    today: tr.mobileMisc.dueToday,
    tomorrow: tr.mobileMisc.dueTomorrow,
    week: tr.mobileMisc.dueThisWeek,
  };
  const priorityLabel: Record<TaskPriority, string> = {
    low: tr.mobileMisc.priorityLow,
    medium: tr.mobileMisc.priorityMedium,
    high: tr.mobileMisc.priorityHigh,
  };

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
    mutationFn: async () => {
      if (!title.trim()) throw new Error(tr.mobileMisc.titleRequired);
      const assignedTo = assignee;
      const taskTitle = title.trim();
      const res = await createTask({
        orgId: String(orgId),
        createdBy: userId,
        title,
        description: desc || null,
        priority,
        dueDate: dueIso(due),
        assigneeUserId: assignee,
      });
      // Notify the assignee (push) when assigning to someone other than yourself.
      if (assignedTo && assignedTo !== userId) {
        sendPushToUsers(String(orgId), [assignedTo], {
          title: tr.mobileMisc.newTaskAssigned,
          body: taskTitle,
          data: { type: 'task' },
        });
      }
      return res;
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
    onError: (e: Error) => Alert.alert(tr.mobileMisc.taskAlertTitle, e.message),
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
                    {s === 'mine' ? tr.mobileMisc.myTasks : tr.mobileMisc.allTasks}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text className="text-base font-bold text-ink">{tr.mobileMisc.myTasks}</Text>
          )}
          <Pressable onPress={() => setShowDone((v) => !v)} className="flex-row items-center gap-1.5">
            <View className={`h-5 w-5 items-center justify-center rounded border ${showDone ? 'border-brand bg-brand' : 'border-surface-border'}`}>
              {showDone ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={12} /> : null}
            </View>
            <Text className="text-sm text-ink-muted">{tr.mobileMisc.showCompleted}</Text>
          </Pressable>
        </View>

        {visible.length === 0 ? (
          <View className="items-center py-16">
            <Text className="text-sm text-ink-muted">{tr.mobileMisc.noTasks}</Text>
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
                    <Text className="text-xs text-ink-subtle">{priorityLabel[t.priority]}</Text>
                  </View>
                  {t.due_date ? <Text className="text-xs text-ink-subtle">{tr.mobileMisc.dueOn.replace('{date}', t.due_date)}</Text> : null}
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
            <Text className="text-lg font-bold text-ink">{tr.mobileMisc.newTask}</Text>
            <Input label={tr.mobileMisc.taskTitleLabel} value={title} onChangeText={setTitle} placeholder={tr.mobileMisc.taskTitlePlaceholder} />
            <Input label={tr.mobileMisc.descriptionLabel} value={desc} onChangeText={setDesc} placeholder={tr.mobileMisc.optional} multiline />

            <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{tr.mobileMisc.priorityLabel}</Text>
            <View className="flex-row gap-2">
              {(['low', 'medium', 'high'] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPriority(p)}
                  className={`flex-1 items-center rounded-xl border py-2 ${priority === p ? 'border-ink bg-ink' : 'border-surface-border'}`}
                >
                  <Text className={`text-sm font-semibold ${priority === p ? 'text-white' : 'text-ink'}`}>{priorityLabel[p]}</Text>
                </Pressable>
              ))}
            </View>

            <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{tr.mobileMisc.dueLabel}</Text>
            <View className="flex-row flex-wrap gap-2">
              {DUE_KEYS.map((k) => (
                <Pressable
                  key={k}
                  onPress={() => setDue(k)}
                  className={`rounded-full border px-3.5 py-1.5 ${due === k ? 'border-ink bg-ink' : 'border-surface-border'}`}
                >
                  <Text className={`text-xs font-semibold ${due === k ? 'text-white' : 'text-ink'}`}>{dueLabel[k]}</Text>
                </Pressable>
              ))}
            </View>

            {isManager ? (
              <>
                <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{tr.mobileMisc.assignToLabel}</Text>
                <View className="flex-row flex-wrap gap-2">
                  <Pressable
                    onPress={() => setAssignee(userId)}
                    className={`rounded-full border px-3.5 py-1.5 ${assignee === userId ? 'border-ink bg-ink' : 'border-surface-border'}`}
                  >
                    <Text className={`text-xs font-semibold ${assignee === userId ? 'text-white' : 'text-ink'}`}>{tr.mobileMisc.assignMe}</Text>
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
                          {m.full_name ?? tr.mobileMisc.memberFallback}
                        </Text>
                      </Pressable>
                    ))}
                </View>
              </>
            ) : null}

            <Button title={tr.mobileMisc.createTask} onPress={() => create.mutate()} loading={create.isPending} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
