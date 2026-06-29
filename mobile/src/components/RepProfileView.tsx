import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';

import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import { getDoorStats, getMonthlySales } from '@/lib/api/salesRep';
import { listMyBadges } from '@/lib/api/gamification';
import { listCommissions, summarize } from '@/lib/api/commissions';
import { getPeerPayoutsVisible } from '@/lib/api/fieldSales';
import { getMember } from '@/lib/api/org';
import { captureAvatar, pickAvatar, uploadMyAvatar, clearMyAvatar } from '@/lib/api/avatars';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/usePermissions';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  sales_rep: 'Représentant',
  technician: 'Technicien',
  member: 'Membre',
};

const money = (n: number) =>
  new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n || 0);

function startOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const CARD = { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } } as const;

function SectionLabel({ children }: { children: string }) {
  return <Text className="text-xs font-bold uppercase tracking-wider text-ink-subtle">{children}</Text>;
}

export function RepProfileView({ userId, name }: { userId: string; name?: string }) {
  const qc = useQueryClient();
  const { orgId, role } = usePermissions();
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const isManager = role === 'owner' || role === 'admin';
  const isSelf = userId === me;
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<'stats' | 'badges'>('stats');

  const memberQ = useQuery({ queryKey: ['member', orgId, userId], queryFn: () => getMember(userId, String(orgId)), enabled: !!orgId && !!userId });
  const statsQ = useQuery({ queryKey: ['rep-stats', orgId, userId], queryFn: () => getDoorStats(String(orgId), userId, startOfMonth()), enabled: !!orgId });
  const badgesQ = useQuery({ queryKey: ['rep-badges', orgId, userId], queryFn: () => listMyBadges(String(orgId), userId), enabled: !!orgId });
  const monthsQ = useQuery({ queryKey: ['rep-months', orgId, userId], queryFn: () => getMonthlySales(String(orgId), userId, 6), enabled: !!orgId });
  const peerVisQ = useQuery({ queryKey: ['peer-payouts-visible', orgId], queryFn: () => getPeerPayoutsVisible(String(orgId)), enabled: !!orgId && !isSelf && !isManager });
  const canSeePayout = isSelf || isManager || peerVisQ.data === true;
  const commQ = useQuery({ queryKey: ['rep-comm', orgId, userId], queryFn: () => listCommissions(String(orgId), userId), enabled: !!orgId && canSeePayout });

  const member = memberQ.data;
  const displayName = member?.full_name || name || 'Représentant';
  const s = statsQ.data ?? { knocks: 0, leads: 0, sales: 0, total: 0 };
  const conv = s.knocks > 0 ? Math.round((s.sales / s.knocks) * 100) : 0;
  const badges = badgesQ.data ?? [];
  const months = monthsQ.data ?? [];
  const maxMonth = Math.max(1, ...months.map((m) => m.sales));
  const comm = summarize(commQ.data ?? []);

  const doUpload = async (uri: string) => {
    setUploading(true);
    try {
      await uploadMyAvatar(me, uri);
      qc.invalidateQueries({ queryKey: ['member'] });
      qc.invalidateQueries({ queryKey: ['members'] });
    } catch (e) {
      Alert.alert('Photo', (e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const choosePhoto = () => {
    Alert.alert('Photo de profil', undefined, [
      { text: 'Prendre une photo', onPress: async () => { const uri = await captureAvatar().catch(() => null); if (uri) doUpload(uri); } },
      { text: 'Choisir dans la galerie', onPress: async () => { const uri = await pickAvatar().catch(() => null); if (uri) doUpload(uri); } },
      ...(member?.avatar_url ? [{ text: 'Avatar généré', onPress: async () => { setUploading(true); try { await clearMyAvatar(me); qc.invalidateQueries({ queryKey: ['member'] }); } finally { setUploading(false); } } }] : []),
      { text: 'Annuler', style: 'cancel' as const },
    ]);
  };

  if (memberQ.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <ActivityIndicator color="#171717" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-surface-alt" contentContainerStyle={{ paddingBottom: 36 }}>
      {/* ── Cover banner (ink + decorative accents) ── */}
      <View className="h-28 bg-ink">
        <View className="absolute -right-6 -top-8 h-32 w-32 rounded-full" style={{ backgroundColor: '#FF6B6B', opacity: 0.18 }} />
        <View className="absolute -left-4 top-6 h-20 w-20 rounded-full" style={{ backgroundColor: '#FFFFFF', opacity: 0.06 }} />
      </View>

      {/* ── Avatar overlapping the cover ── */}
      <View className="-mt-12 items-center">
        <View className="relative">
          <View className="rounded-full border-4 border-surface-alt bg-surface-alt">
            {uploading ? (
              <View className="h-24 w-24 items-center justify-center rounded-full bg-surface-sunken">
                <ActivityIndicator color="#171717" />
              </View>
            ) : (
              <UnifiedAvatar id={userId} name={displayName} url={member?.avatar_url} size={96} />
            )}
          </View>
          {isSelf ? (
            <Pressable onPress={choosePhoto} className="absolute bottom-0 right-0 h-8 w-8 items-center justify-center rounded-full border-2 border-surface-alt bg-ink">
              <SymbolView name="camera.fill" tintColor="#FFFFFF" size={14} resizeMode="scaleAspectFit" />
            </Pressable>
          ) : null}
        </View>
        <Text className="mt-2 text-2xl font-bold text-ink">{displayName}</Text>
        <View className="mt-1.5 flex-row items-center gap-2">
          <View className="rounded-full bg-surface-sunken px-3 py-1">
            <Text className="text-xs font-semibold text-ink-muted">{ROLE_LABEL[member?.role ?? ''] ?? 'Représentant'}</Text>
          </View>
          {s.sales > 0 ? <Text className="text-xs text-ink-subtle">· {s.sales} ventes ce mois</Text> : null}
        </View>
      </View>

      {/* ── Tabs ── */}
      <View className="mx-4 mt-5 flex-row rounded-2xl bg-surface-sunken p-1">
        {(['stats', 'badges'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} className={`flex-1 items-center rounded-xl py-2 ${tab === t ? 'bg-white' : ''}`}>
            <Text className={`text-sm font-semibold ${tab === t ? 'text-ink' : 'text-ink-muted'}`}>{t === 'stats' ? 'Stats' : 'Badges'}</Text>
          </Pressable>
        ))}
      </View>

      <View className="gap-4 px-4 pt-4">
        {tab === 'stats' ? (
          <>
            {/* KPI strip */}
            <View className="flex-row rounded-2xl bg-white py-4" style={CARD}>
              <Kpi label="Portes" value={String(s.knocks)} />
              <Divider />
              <Kpi label="Leads" value={String(s.leads)} tint="#CA8A04" />
              <Divider />
              <Kpi label="Ventes" value={String(s.sales)} tint="#16A34A" />
              <Divider />
              <Kpi label="Conv." value={`${conv}%`} />
            </View>

            {/* Next payout */}
            {canSeePayout ? (
              <View className="overflow-hidden rounded-2xl bg-white" style={CARD}>
                <View className="flex-row items-center gap-3 px-5 pb-4 pt-4">
                  <View className="h-11 w-11 items-center justify-center rounded-2xl bg-status-completed/10">
                    <SymbolView name="dollarsign.circle.fill" tintColor="#16A34A" size={24} resizeMode="scaleAspectFit" />
                  </View>
                  <View className="flex-1">
                    <SectionLabel>Prochain versement</SectionLabel>
                    <Text className="text-2xl font-bold text-ink">{money(comm.approved)}</Text>
                  </View>
                </View>
                <View className="flex-row border-t border-surface-border">
                  <View className="flex-1 items-center py-2.5">
                    <Text className="text-[11px] uppercase tracking-wide text-ink-subtle">En attente</Text>
                    <Text className="text-sm font-semibold text-ink">{money(comm.pending)}</Text>
                  </View>
                  <View className="w-px bg-surface-border" />
                  <View className="flex-1 items-center py-2.5">
                    <Text className="text-[11px] uppercase tracking-wide text-ink-subtle">Déjà payé</Text>
                    <Text className="text-sm font-semibold text-ink">{money(comm.paid)}</Text>
                  </View>
                </View>
              </View>
            ) : null}

            {/* Sales by month */}
            <View className="gap-3 rounded-2xl bg-white p-5" style={CARD}>
              <View className="flex-row items-center gap-2">
                <SymbolView name="chart.bar.fill" tintColor="#A3A3A3" size={14} resizeMode="scaleAspectFit" />
                <SectionLabel>Ventes par mois</SectionLabel>
              </View>
              {months.every((m) => m.sales === 0) ? (
                <Text className="py-1 text-sm text-ink-muted">Aucune vente sur la période.</Text>
              ) : (
                months.map((m) => (
                  <View key={m.label} className="flex-row items-center gap-3">
                    <Text className="w-8 text-xs font-medium text-ink-muted">{m.label}</Text>
                    <View className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                      <View className="h-2.5 rounded-full" style={{ width: `${Math.round((m.sales / maxMonth) * 100)}%`, backgroundColor: '#171717' }} />
                    </View>
                    <Text className="w-5 text-right text-sm font-bold text-ink">{m.sales}</Text>
                  </View>
                ))
              )}
            </View>

            {/* Rep details */}
            <View className="rounded-2xl bg-white px-5 py-2" style={CARD}>
              <View className="py-2"><SectionLabel>Détails</SectionLabel></View>
              <DetailRow label="Rôle" value={ROLE_LABEL[member?.role ?? ''] ?? '—'} />
              <DetailRow label="Statut" value={member?.status === 'pending' ? 'Invitation en attente' : 'Actif'} />
              {member?.email ? <DetailRow label="Courriel" value={member.email} last /> : null}
            </View>
          </>
        ) : (
          /* Badges tab */
          <View className="gap-3 rounded-2xl bg-white p-5" style={CARD}>
            {badges.length === 0 ? (
              <View className="items-center py-8">
                <SymbolView name="rosette" tintColor="#D4D4D4" size={40} resizeMode="scaleAspectFit" />
                <Text className="mt-2 text-sm text-ink-muted">Aucun badge gagné pour l&apos;instant.</Text>
              </View>
            ) : (
              <View className="flex-row flex-wrap gap-y-4">
                {badges.map((b) => {
                  const color = b.color || '#FF6B6B';
                  return (
                    <View key={b.id} className="w-1/3 items-center gap-1.5 px-1">
                      <View className="h-16 w-16 items-center justify-center rounded-2xl" style={{ backgroundColor: color + '1F' }}>
                        <Text className="text-3xl">{b.icon && b.icon.length <= 3 ? b.icon : '🏅'}</Text>
                      </View>
                      <Text numberOfLines={2} className="text-center text-[11px] font-medium leading-tight text-ink">{b.name}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function Kpi({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View className="flex-1 items-center">
      <Text className="text-xl font-bold" style={{ color: tint ?? '#171717' }}>{value}</Text>
      <Text className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</Text>
    </View>
  );
}
function Divider() {
  return <View className="w-px self-stretch bg-surface-border" />;
}
function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View className={`flex-row items-center justify-between py-3 ${last ? '' : 'border-b border-surface-border'}`}>
      <Text className="text-sm text-ink-muted">{label}</Text>
      <Text className="text-sm font-semibold text-ink">{value}</Text>
    </View>
  );
}
