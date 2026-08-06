// Rep profile — port of the web `src/pages/RepProfile.tsx`: same stats (11
// KPIs merged from leaderboard + real DB stats), sales by quarter, details /
// contact cards and closes list. The web page's commission history lives in
// the Commissions tab, which mirrors the web Commissions page (and replaces
// the old Badges tab). Mobile keeps its avatar upload affordance.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';

import PayrollSummaryCard from '@/components/commissions/PayrollSummaryCard';
import PersonalCommissionView from '@/components/commissions/PersonalCommissionView';
import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import { captureAvatar, clearMyAvatar, pickAvatar, uploadMyAvatar } from '@/lib/api/avatars';
import { listCommissions } from '@/lib/api/commissions';
import { EMPTY_PERFORMANCE, getRealtimeStats, getRepPerformance } from '@/lib/api/leaderboard';
import { getMember } from '@/lib/api/org';
import {
  EMPTY_REAL_STATS,
  getRepRealStats,
  getTeamMemberDetails,
  listRepDeals,
} from '@/lib/api/repStats';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

type SalesT = ReturnType<typeof useTranslation>['t']['mobileSales'];

const ROLE_KEY: Record<string, keyof SalesT> = {
  owner: 'roleOwner',
  admin: 'roleAdmin',
  sales_rep: 'roleSalesRep',
  technician: 'roleTechnician',
  member: 'roleMember',
};

const CARD = { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } } as const;

/** Same compact currency as the web profile ($1.2k / $150k / $840). */
function fmtCurrency(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

/** Build quarter date ranges for the last 4 quarters from today (web port). */
function getQuarterRanges(): { label: string; from: string; to: string }[] {
  const now = new Date();
  const quarters: { label: string; from: string; to: string }[] = [];
  let year = now.getFullYear();
  let quarter = Math.ceil((now.getMonth() + 1) / 3);
  for (let i = 0; i < 4; i++) {
    const startMonth = (quarter - 1) * 3;
    const from = new Date(year, startMonth, 1);
    const to = new Date(year, startMonth + 3, 0);
    quarters.push({
      label: `Q${quarter} ${year}`,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
    quarter--;
    if (quarter === 0) {
      quarter = 4;
      year--;
    }
  }
  return quarters;
}

const TARGET_QUARTERLY = 90000;

function SectionLabel({ children }: { children: string }) {
  return <Text className="text-xs font-bold uppercase tracking-wider text-ink-subtle">{children}</Text>;
}

export function RepProfileView({ userId, name }: { userId: string; name?: string }) {
  const { t, language } = useTranslation();
  const locale = language === 'fr' ? 'fr-CA' : 'en-CA';
  const s9n = t.mobileSales;
  const roleLabel = (r?: string) => (r && ROLE_KEY[r] ? (s9n[ROLE_KEY[r]] as string) : undefined);
  const qc = useQueryClient();
  const { orgId, role } = usePermissions();
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const isManager = role === 'owner' || role === 'admin';
  const isSelf = userId === me;
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<'stats' | 'commissions'>('stats');

  // ── Data — the same sources the web profile aggregates ──
  const memberQ = useQuery({
    queryKey: ['member', orgId, userId],
    queryFn: () => getMember(userId, String(orgId)),
    enabled: !!orgId && !!userId,
  });
  const detailsQ = useQuery({
    queryKey: ['team-member-details', orgId, userId],
    queryFn: () => getTeamMemberDetails(userId, String(orgId)),
    enabled: !!orgId && !!userId,
  });
  const realtimeQ = useQuery({
    queryKey: ['rep-realtime', orgId, userId],
    queryFn: () => getRealtimeStats(userId).catch(() => EMPTY_PERFORMANCE),
    enabled: !!orgId && !!userId,
  });
  const realStatsQ = useQuery({
    queryKey: ['rep-real-stats', orgId, userId],
    queryFn: () => getRepRealStats(userId, String(orgId)).catch(() => EMPTY_REAL_STATS),
    enabled: !!orgId && !!userId,
  });
  const quartersQ = useQuery({
    queryKey: ['rep-quarters', orgId, userId],
    queryFn: async () => {
      const ranges = getQuarterRanges();
      const results = await Promise.all(
        ranges.map(async (q) => {
          try {
            const { performance } = await getRepPerformance(userId, q.from, q.to);
            return { label: q.label, revenue: performance.revenue };
          } catch {
            return { label: q.label, revenue: 0 };
          }
        }),
      );
      return results
        .filter((q) => q.revenue > 0)
        .map((q) => ({
          label: q.label,
          value: q.revenue,
          percent: Math.min(100, Math.round((q.revenue / TARGET_QUARTERLY) * 100)),
        }));
    },
    enabled: !!orgId && !!userId,
  });
  const dealsQ = useQuery({
    queryKey: ['rep-deals', orgId, userId],
    queryFn: () => listRepDeals(userId, String(orgId)),
    enabled: !!orgId && !!userId,
  });
  const commQ = useQuery({
    queryKey: ['rep-comm', orgId, userId],
    queryFn: () => listCommissions(String(orgId), userId),
    // Self/manager only — RLS returns nothing but empty rows for peers.
    enabled: !!orgId && (isSelf || isManager),
  });

  const member = memberQ.data;
  const details = detailsQ.data;
  const displayName = member?.full_name || name || s9n.salesRepFallback;

  // ── Merge exactly like the web: prefer real DB values when non-zero ──
  const lb = realtimeQ.data ?? EMPTY_PERFORMANCE;
  const real = realStatsQ.data ?? EMPTY_REAL_STATS;
  const commissionTotal = (commQ.data ?? []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const deals = dealsQ.data ?? [];
  // pipeline_deals.stage only ever holds the canonical slugs; 'won' matched nothing.
  const realCloses = deals.filter((d) => d.stage === 'closed_won').length;

  const stats = {
    revenue: real.totalRevenue || lb.revenue,
    closes: realCloses || lb.closes,
    conversion: lb.conversion_rate,
    avgDealValue: lb.average_ticket,
    commission: commissionTotal,
    activeLeads: lb.quotes_sent,
    jobsCompleted: real.jobsCompleted || lb.closes,
    jobsPending: real.jobsPending || lb.follow_ups_completed,
    contractsSigned: real.contractsSigned,
    hoursWorked: real.hoursWorked,
    daysWorked: real.daysWorked,
  };

  const location = details?.address
    ? [details.address.city, details.address.province].filter(Boolean).join(', ')
    : '';
  const hireDate = details?.created_at
    ? new Date(details.created_at).toLocaleDateString(locale, { month: 'short', year: 'numeric' })
    : '';
  const employeeId = details?.id ? `CLO-${String(details.id).slice(0, 4).toUpperCase()}` : '';
  const quarterSales = quartersQ.data ?? [];

  // ── Avatar upload (mobile-only affordance, kept from the previous view) ──
  const doUpload = async (uri: string) => {
    setUploading(true);
    try {
      await uploadMyAvatar(me, uri);
      qc.invalidateQueries({ queryKey: ['member'] });
      qc.invalidateQueries({ queryKey: ['members'] });
    } catch (e) {
      Alert.alert(s9n.photo, (e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const choosePhoto = () => {
    Alert.alert(s9n.profilePhoto, undefined, [
      { text: s9n.takePhoto, onPress: async () => { const uri = await captureAvatar().catch(() => null); if (uri) doUpload(uri); } },
      { text: s9n.chooseFromGallery, onPress: async () => { const uri = await pickAvatar().catch(() => null); if (uri) doUpload(uri); } },
      ...(member?.avatar_url
        ? [{ text: s9n.generatedAvatar, onPress: async () => { setUploading(true); try { await clearMyAvatar(me); qc.invalidateQueries({ queryKey: ['member'] }); } finally { setUploading(false); } } }]
        : []),
      { text: s9n.cancel, style: 'cancel' as const },
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
      {/* ── Cover banner (dark, like the web profile) ── */}
      <View className="h-28 overflow-hidden bg-ink">
        <View className="absolute -right-6 -top-8 h-32 w-32 rounded-full" style={{ backgroundColor: '#FFFFFF', opacity: 0.08 }} />
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
            <Pressable
              onPress={choosePhoto}
              className="absolute bottom-0 right-0 h-8 w-8 items-center justify-center rounded-full border-2 border-surface-alt bg-ink"
            >
              <SymbolView name="camera.fill" tintColor="#FFFFFF" size={14} resizeMode="scaleAspectFit" />
            </Pressable>
          ) : null}
        </View>
        <Text className="mt-2 text-2xl font-bold text-ink">{displayName}</Text>
        <View className="mt-1.5 flex-row items-center gap-2">
          <View className="rounded-full bg-surface-sunken px-3 py-1">
            <Text className="text-xs font-semibold text-ink-muted">{roleLabel(member?.role) ?? s9n.salesRepFallback}</Text>
          </View>
        </View>
      </View>

      {/* ── Tabs — Commissions replaces the old Badges tab ── */}
      <View className="mx-4 mt-5 flex-row rounded-2xl bg-surface-sunken p-1">
        {(['stats', 'commissions'] as const).map((tabId) => (
          <Pressable
            key={tabId}
            onPress={() => setTab(tabId)}
            className={`flex-1 items-center rounded-xl py-2 ${tab === tabId ? 'bg-white' : ''}`}
          >
            <Text className={`text-sm font-semibold ${tab === tabId ? 'text-ink' : 'text-ink-muted'}`}>
              {tabId === 'stats' ? s9n.stats : s9n.commissionsTab}
            </Text>
          </Pressable>
        ))}
      </View>

      <View className="gap-4 px-4 pt-4">
        {tab === 'stats' ? (
          <>
            {/* ── KPI grid — the web's 11 cards, same order ── */}
            <View className="flex-row flex-wrap gap-3">
              <KpiCard icon="banknote" label={s9n.totalRevenue} value={fmtCurrency(stats.revenue)} />
              <KpiCard icon="scope" label={s9n.dealsClosed} value={String(stats.closes)} />
              <KpiCard icon="percent" label={s9n.conversionLabel} value={`${stats.conversion}%`} />
              <KpiCard icon="chart.bar" label={s9n.avgDealValue} value={fmtCurrency(stats.avgDealValue)} />
              {/* Peers would only ever see $0 here (RLS blocks other reps' rows),
                  so the card is limited to self/managers rather than lying. */}
              <KpiCard icon="dollarsign.circle" label={s9n.commissionLabel} value={fmtCurrency(stats.commission)} hidden={!(isSelf || isManager)} />
              <KpiCard icon="doc.on.clipboard" label={s9n.activeLeads} value={String(stats.activeLeads)} />
              <KpiCard icon="checkmark.circle" label={s9n.jobsCompletedLabel} value={String(stats.jobsCompleted)} />
              <KpiCard icon="clock" label={s9n.jobsPendingLabel} value={String(stats.jobsPending)} />
              <KpiCard icon="signature" label={s9n.contractsSigned} value={String(stats.contractsSigned)} />
              <KpiCard icon="timer" label={s9n.hoursWorkedLabel} value={`${stats.hoursWorked}h`} />
              <KpiCard icon="calendar.badge.checkmark" label={s9n.daysWorkedLabel} value={String(stats.daysWorked)} />
            </View>

            {/* ── Sales by Quarter ── */}
            {quarterSales.length > 0 ? (
              <View className="gap-4 rounded-2xl bg-white p-5" style={CARD}>
                <SectionLabel>{s9n.salesByQuarter}</SectionLabel>
                {quarterSales.map((q) => (
                  <View key={q.label}>
                    <View className="mb-1.5 flex-row items-center justify-between">
                      <Text className="text-[13px] font-semibold text-ink">{q.label}</Text>
                      <View className="flex-row items-baseline gap-2">
                        <Text className="text-sm font-bold text-ink">{fmtCurrency(q.value)}</Text>
                        <Text className="text-[11px] font-semibold text-ink-subtle">{q.percent}%</Text>
                      </View>
                    </View>
                    <View className="h-3 overflow-hidden rounded-full bg-surface-sunken">
                      <View className="h-3 rounded-full bg-ink" style={{ width: `${q.percent}%` }} />
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {/* ── Details (web left column) ── */}
            <View className="gap-4 rounded-2xl bg-white p-5" style={CARD}>
              <SectionLabel>{s9n.detailsTitle}</SectionLabel>
              <InfoRow icon="mappin.and.ellipse" label={s9n.locationLabel} value={location || '—'} />
              <InfoRow icon="briefcase" label={s9n.departmentLabel} value="Sales" />
              <InfoRow icon="calendar" label={s9n.hireDate} value={hireDate || '—'} />
              <InfoRow icon="number" label={s9n.employeeId} value={employeeId || '—'} />
              <InfoRow
                icon="person.crop.circle"
                label={s9n.status}
                value={member?.status === 'pending' ? s9n.invitationPending : s9n.active}
              />
            </View>

            {/* ── Contact ── */}
            <View className="gap-3 rounded-2xl bg-white p-5" style={CARD}>
              <SectionLabel>{s9n.contactTitle}</SectionLabel>
              <ContactItem label={s9n.phoneLabel} value={details?.phone || '—'} />
              <ContactItem label={s9n.emailLabel} value={details?.email || member?.email || '—'} />
            </View>

            {/* ── Closes (auto-linked via pipeline_deals.rep_id) ── */}
            <View className="overflow-hidden rounded-2xl bg-white" style={CARD}>
              <View className="border-b border-surface-border px-5 py-3">
                <Text className="text-sm font-bold text-ink">{s9n.closesTitle.replace('{count}', String(deals.length))}</Text>
              </View>
              {deals.length === 0 ? (
                <View className="items-center py-8">
                  <Text className="px-6 text-center text-sm text-ink-muted">{s9n.noDealsLinked}</Text>
                </View>
              ) : (
                deals.slice(0, 15).map((d, i) => (
                  <View
                    key={d.id}
                    className={`flex-row items-center justify-between gap-3 px-5 py-3 ${i === 0 ? '' : 'border-t border-surface-border'}`}
                  >
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-ink" numberOfLines={1}>
                        {d.title}
                      </Text>
                      <Text className="text-xs capitalize text-ink-subtle">
                        {d.stage} · {new Date(d.won_at || d.created_at).toLocaleDateString(locale)}
                      </Text>
                    </View>
                    <Text className="text-sm font-bold text-ink">{fmtCurrency(d.value || 0)}</Text>
                  </View>
                ))
              )}
            </View>
          </>
        ) : (
          /* ── Commissions tab — the web Commissions page for this rep ── */
          <View className="gap-4">
            {isSelf || isManager ? (
              /* Always scope to the profile's user — without an explicit userId
                 the server returns the WHOLE org for owner/admin. Peers are
                 excluded entirely: the server would substitute the VIEWER's
                 entries for a non-admin, which would show wrong data. */
              <>
                {isSelf ? <PayrollSummaryCard metric="deals" /> : null}
                <PersonalCommissionView userId={userId} />
              </>
            ) : (
              <View className="items-center rounded-2xl bg-white py-10" style={CARD}>
                <SymbolView name="lock" tintColor="#D4D4D4" size={32} resizeMode="scaleAspectFit" />
                <Text className="mt-2 px-8 text-center text-sm text-ink-muted">{s9n.payoutsHidden}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// ── Sub-components (web KpiCard / InfoRow / ContactItem, RN flavour) ────────

function KpiCard({ icon, label, value, hidden }: { icon: string; label: string; value: string; hidden?: boolean }) {
  if (hidden) return null;
  return (
    <View className="min-w-[45%] flex-1 rounded-2xl bg-white px-4 py-4" style={CARD}>
      <View className="mb-3 h-8 w-8 items-center justify-center rounded-lg bg-surface-sunken">
        <SymbolView name={icon as any} tintColor="#525252" size={15} resizeMode="scaleAspectFit" />
      </View>
      <Text className="text-[22px] font-extrabold tracking-tight text-ink">{value}</Text>
      <Text className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{label}</Text>
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-surface-border bg-surface-sunken">
        <SymbolView name={icon as any} tintColor="#525252" size={15} resizeMode="scaleAspectFit" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[9px] font-bold uppercase tracking-widest text-ink-subtle">{label}</Text>
        <Text className="text-[13px] font-semibold text-ink" numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function ContactItem({ label, value }: { label: string; value: string }) {
  return (
    <View className="rounded-xl border border-surface-border bg-surface-sunken px-4 py-3">
      <Text className="text-[9px] font-bold uppercase tracking-widest text-ink-subtle">{label}</Text>
      <Text className="mt-1 text-[13px] font-semibold text-ink" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
