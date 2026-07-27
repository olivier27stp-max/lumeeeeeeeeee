// Commissions — port of the web `src/pages/Commissions.tsx`, role-aware:
//  - technician / no role → access denied (same defense as the web route gate)
//  - sales_rep (any non-manager) → personal dashboard, scoped to self
//  - owner / admin → management dashboard with Overview / Reps / My / Rates tabs
// Data flows through the same authed server routes the web uses.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import AdminCommissionOverview from '@/components/commissions/AdminCommissionOverview';
import PayrollSummaryCard from '@/components/commissions/PayrollSummaryCard';
import PersonalCommissionView from '@/components/commissions/PersonalCommissionView';
import {
  createCommissionRule,
  getCommissionRules,
  updateCommissionRule,
  type FsCommissionRule,
} from '@/lib/api/commissionsServer';
import { listMembers } from '@/lib/api/org';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

type AdminTab = 'overview' | 'reps' | 'my' | 'rates';

const CARD = { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } } as const;

export default function Commissions() {
  const { role, can } = usePermissions();
  const { t } = useTranslation();
  const c = t.mobileCommissions;

  // Same gate as the web route: `commissions.read` (technicians are blocked).
  if (!can('commissions.read') || role === 'technician' || role == null) {
    return <AccessDenied />;
  }

  const isManager = role === 'owner' || role === 'admin';

  if (!isManager) {
    return (
      <ScrollView
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        className="flex-1 bg-surface-alt"
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
      >
        <View>
          <Text className="text-xl font-semibold text-ink">{c.myCommissions}</Text>
          <Text className="text-xs text-ink-subtle">{c.mySubtitle}</Text>
        </View>
        <PayrollSummaryCard metric="deals" />
        <PersonalCommissionView />
      </ScrollView>
    );
  }

  return <AdminCommissionsLayout />;
}

// ── Access denied (defense in depth) ────────────────────────────────────────

function AccessDenied() {
  const { t } = useTranslation();
  const c = t.mobileCommissions;
  return (
    <View className="flex-1 items-center justify-center bg-surface-alt px-8">
      <View className="h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: '#DC262615' }}>
        <SymbolView name="shield.slash" tintColor="#DC2626" size={28} resizeMode="scaleAspectFit" />
      </View>
      <Text className="mt-4 text-lg font-semibold text-ink">{c.accessDenied}</Text>
      <Text className="mt-1 text-center text-sm text-ink-muted">{c.accessDeniedBody}</Text>
      <Pressable
        onPress={() => router.back()}
        className="mt-6 rounded-xl border border-surface-border bg-white px-4 py-2 active:opacity-70"
      >
        <Text className="text-sm font-semibold text-ink">{c.backToDashboard}</Text>
      </Pressable>
    </View>
  );
}

// ── Admin / owner layout ────────────────────────────────────────────────────

function AdminCommissionsLayout() {
  const { t } = useTranslation();
  const c = t.mobileCommissions;
  const [tab, setTab] = useState<AdminTab>('overview');
  const [drilldownRep, setDrilldownRep] = useState<{ id: string; name: string } | null>(null);
  const { orgId } = usePermissions();

  // Resolve names once for the drilldown header (the composite views resolve
  // their own as well; this is just for the back-link label).
  const membersQ = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => listMembers(String(orgId)),
    enabled: !!orgId,
  });
  const profileMap: Record<string, string> = {};
  for (const m of membersQ.data ?? []) profileMap[m.user_id] = m.full_name ?? m.user_id;

  const TABS: { key: AdminTab; label: string }[] = [
    { key: 'overview', label: c.tabOverview },
    { key: 'reps', label: c.tabReps },
    { key: 'my', label: c.tabMy },
    { key: 'rates', label: c.tabRates },
  ];

  const handleSelectRep = (userId: string) => {
    setDrilldownRep({ id: userId, name: profileMap[userId] || userId });
  };

  return (
    <ScrollView
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      className="flex-1 bg-surface-alt"
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
    >
      <View>
        <Text className="text-xl font-semibold text-ink">{c.title}</Text>
        <Text className="text-xs text-ink-subtle">{c.subtitleAdmin}</Text>
      </View>

      {/* Tabs */}
      <View className="flex-row rounded-2xl bg-surface-sunken p-1">
        {TABS.map((tb) => (
          <Pressable
            key={tb.key}
            onPress={() => {
              setTab(tb.key);
              setDrilldownRep(null);
            }}
            className={`flex-1 items-center rounded-xl py-2 ${tab === tb.key ? 'bg-white' : ''}`}
          >
            <Text className={`text-xs font-semibold ${tab === tb.key ? 'text-ink' : 'text-ink-muted'}`}>{tb.label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'overview' ? (
        <AdminCommissionOverview
          onSelectRep={(uid) => {
            setTab('reps');
            handleSelectRep(uid);
          }}
        />
      ) : null}

      {tab === 'reps' && !drilldownRep ? <AdminCommissionOverview onSelectRep={handleSelectRep} /> : null}

      {tab === 'reps' && drilldownRep ? (
        <View className="gap-4">
          <Pressable onPress={() => setDrilldownRep(null)} className="flex-row items-center gap-1 active:opacity-70">
            <SymbolView name="chevron.left" tintColor="#525252" size={13} resizeMode="scaleAspectFit" />
            <Text className="text-sm font-medium text-ink-muted">{c.backToReps}</Text>
          </Pressable>
          <PersonalCommissionView
            userId={drilldownRep.id}
            title={c.drilldownTitle.replace('{name}', drilldownRep.name)}
            subtitle={c.drilldownSubtitle}
          />
        </View>
      ) : null}

      {tab === 'my' ? (
        <View className="gap-4">
          <PayrollSummaryCard metric="deals" />
          <PersonalCommissionView title={c.tabMy} />
        </View>
      ) : null}

      {tab === 'rates' ? <RatesPanel /> : null}
    </ScrollView>
  );
}

// ── Rates panel — per-rep commission % rules (owner/admin) ──────────────────

function RatesPanel() {
  const { t } = useTranslation();
  const c = t.mobileCommissions;
  const { orgId } = usePermissions();
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftPct, setDraftPct] = useState('');

  const membersQ = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => listMembers(String(orgId)),
    enabled: !!orgId,
  });
  const rulesQ = useQuery({ queryKey: ['commission-rules'], queryFn: getCommissionRules });

  const members = (membersQ.data ?? []).filter((m) => (m.status ?? 'active') === 'active');
  const rules = rulesQ.data ?? [];

  const rateForUser = (userId: string): FsCommissionRule | undefined =>
    rules.find((r) => r.applies_to_user_id === userId && r.type === 'percentage');

  const saveMut = useMutation({
    mutationFn: async ({ userId, pct }: { userId: string; pct: number }) => {
      const existing = rateForUser(userId);
      if (existing) {
        await updateCommissionRule(existing.id, { percentage: pct });
      } else {
        await createCommissionRule({
          name: `Rate for ${userId.slice(0, 8)}`,
          type: 'percentage',
          percentage: pct,
          applies_to_user_id: userId,
          priority: 10,
        });
      }
    },
    onSuccess: () => {
      setEditingId(null);
      setDraftPct('');
      qc.invalidateQueries({ queryKey: ['commission-rules'] });
    },
    onError: (e: Error) => Alert.alert(c.tabRates, e.message || c.saveFailed),
  });

  const handleSave = (userId: string) => {
    const pct = parseFloat(draftPct);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      Alert.alert(c.tabRates, c.invalidPct);
      return;
    }
    saveMut.mutate({ userId, pct });
  };

  if (membersQ.isLoading || rulesQ.isLoading) {
    return (
      <View className="items-center py-12">
        <ActivityIndicator color="#171717" />
      </View>
    );
  }

  return (
    <View className="overflow-hidden rounded-2xl bg-white" style={CARD}>
      <View className="border-b border-surface-border px-4 py-3">
        <Text className="text-sm font-bold text-ink">{c.ratesTitle}</Text>
      </View>
      {members.length === 0 ? (
        <View className="items-center py-8">
          <Text className="text-sm text-ink-muted">{c.noMembers}</Text>
        </View>
      ) : (
        members.map((m, i) => {
          const rule = rateForUser(m.user_id);
          const pct = rule?.percentage ?? null;
          const isEditing = editingId === m.user_id;
          const isSaving = saveMut.isPending && editingId === m.user_id;
          return (
            <View
              key={m.user_id}
              className={`flex-row items-center gap-3 px-4 py-3 ${i === 0 ? '' : 'border-t border-surface-border'}`}
            >
              <View className="flex-1">
                <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
                  {m.full_name ?? m.user_id}
                </Text>
                <Text className="text-xs capitalize text-ink-subtle">{m.role}</Text>
              </View>
              {isEditing ? (
                <View className="flex-row items-center gap-2">
                  <TextInput
                    value={draftPct}
                    onChangeText={setDraftPct}
                    keyboardType="decimal-pad"
                    autoFocus
                    className="w-16 rounded-xl border border-surface-border bg-white px-2 py-1.5 text-right text-sm text-ink"
                  />
                  <Text className="text-sm text-ink-muted">%</Text>
                  <Pressable
                    onPress={() => handleSave(m.user_id)}
                    disabled={isSaving}
                    className="rounded-xl bg-ink px-3 py-1.5 active:opacity-70"
                  >
                    {isSaving ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text className="text-xs font-semibold text-white">{c.save}</Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setEditingId(null);
                      setDraftPct('');
                    }}
                    disabled={isSaving}
                    className="rounded-xl border border-surface-border px-3 py-1.5 active:opacity-70"
                  >
                    <Text className="text-xs font-semibold text-ink-muted">{c.cancel}</Text>
                  </Pressable>
                </View>
              ) : (
                <View className="flex-row items-center gap-3">
                  <Text className="text-sm font-semibold text-ink">{pct != null ? `${pct}%` : '—'}</Text>
                  <Pressable
                    onPress={() => {
                      setEditingId(m.user_id);
                      setDraftPct(pct != null ? String(pct) : '');
                    }}
                    className="rounded-xl border border-surface-border px-3 py-1.5 active:opacity-70"
                  >
                    <Text className="text-xs font-semibold text-ink">{c.edit}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}
