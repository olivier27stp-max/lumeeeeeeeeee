import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useQuery } from '@tanstack/react-query';

import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import { getMember } from '@/lib/api/org';
import { useViewMode } from '@/lib/view-mode';
import { IDLE_LIMIT_OPTIONS, useIdleLimit } from '@/lib/session-timeout';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { useMembership } from '@/lib/membership-context';
import { ROLE_LABELS } from '@/lib/permissions';
import { usePermissions } from '@/lib/usePermissions';

function Row({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 border-b border-surface-border px-4 py-4 active:bg-surface-sunken"
    >
      <SymbolView name={icon as any} tintColor={danger ? '#DC2626' : '#171717'} size={20} resizeMode="scaleAspectFit" />
      <Text className={`flex-1 text-base ${danger ? 'text-status-late' : 'text-ink'}`}>{label}</Text>
      {!danger ? <SymbolView name="chevron.right" tintColor="#A3A3A3" size={14} resizeMode="scaleAspectFit" /> : null}
    </Pressable>
  );
}

export default function More() {
  const insets = useSafeAreaInsets();
  const { session, signOut } = useAuth();
  const { current } = useMembership();
  const { can, orgId } = usePermissions();
  const { mode, setMode, canSwitch } = useViewMode();
  const { t, language, setLanguage } = useTranslation();
  const { limit: idleLimit, setLimit: setIdleLimit } = useIdleLimit();
  const me = session?.user.id ?? '';
  const { data: meMember } = useQuery({
    queryKey: ['member', orgId, me],
    queryFn: () => getMember(me, String(orgId)),
    enabled: !!orgId && !!me,
  });

  const isManager = can('team.update') || current?.role === 'owner' || current?.role === 'admin';
  // The More menu adapts to the active persona (mode), not the raw role — a
  // manager toggling tech↔sales sees each persona's menu. Team/company admin is
  // hidden in the sales persona (reps don't manage); the dashboard is shown to
  // reps. Everything else (commissions, pay, sales settings) is available in
  // both personas.
  const salesPersona = mode === 'sales';
  const roleLabel = current ? ROLE_LABELS[current.role]?.en ?? current.role : null;

  const onSignOut = async () => {
    await signOut();
    router.replace('/(auth)/sign-in');
  };

  return (
    <View className="flex-1 bg-surface-alt" style={{ paddingTop: insets.top }}>
      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}>
        <Text className="text-2xl font-bold text-ink">{t.mobileProfile.more}</Text>

        {/* Profile header */}
        <View className="flex-row items-center gap-3 rounded-3xl bg-white p-4">
          <UnifiedAvatar id={session?.user.id ?? 'me'} name={current?.fullName ?? session?.user.email ?? 'Me'} size={56} url={meMember?.avatar_url} />
          <View className="flex-1">
            <Text className="text-base font-bold text-ink">{current?.fullName ?? session?.user.email}</Text>
            <Text className="text-xs text-ink-muted">
              {roleLabel}
              {current?.companyName ? ` · ${current.companyName}` : ''}
            </Text>
            {session?.user.email ? (
              <Text className="text-xs text-ink-subtle">{session.user.email}</Text>
            ) : null}
          </View>
        </View>

        {/* Global search bar */}
        <Pressable
          onPress={() => router.push('/(app)/global-search' as any)}
          className="flex-row items-center gap-2 rounded-2xl bg-white px-4 py-3"
        >
          <SymbolView name="magnifyingglass" tintColor="#A3A3A3" size={18} resizeMode="scaleAspectFit" />
          <Text className="text-base text-ink-subtle">{t.mobileProfile.searchPlaceholder}</Text>
        </Pressable>

        {/* App mode switcher (owner/admin) — Technician vs Sales reps */}
        {canSwitch ? (
          <View className="gap-2">
            <Text className="px-1 text-[11px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileProfile.displayMode}</Text>
            <View className="flex-row rounded-2xl bg-surface-sunken p-1">
              {(['tech', 'sales'] as const).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  className={`flex-1 items-center rounded-xl py-2.5 ${mode === m ? 'bg-white' : ''}`}
                >
                  <Text className={`text-sm font-semibold ${mode === m ? 'text-ink' : 'text-ink-muted'}`}>
                    {m === 'tech' ? t.mobileProfile.technician : t.mobileProfile.salesReps}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* Gestion — tech persona drops Réglages vente; sales persona keeps it.
            Dashboard/team/company stay manager-gated in both personas. */}
        {isManager || salesPersona ? (
          <View className="overflow-hidden rounded-3xl bg-white">
            <Row icon="chart.bar.xaxis" label={t.mobileProfile.dashboard} onPress={() => router.push('/(app)/dashboard' as any)} />
            {isManager ? (
              <>
                <Row icon="person.2" label={t.mobileProfile.manageTeam} onPress={() => router.push('/(app)/manage-team')} />
                <Row icon="building.2" label={t.mobileProfile.companyDetails} onPress={() => router.push('/(app)/company')} />
                <Row icon="creditcard" label={t.mobileProfile.payments} onPress={() => router.push('/(app)/payments-setup' as any)} />
              </>
            ) : null}
            {isManager && salesPersona ? (
              <Row icon="slider.horizontal.3" label={t.mobileProfile.salesSettings} onPress={() => router.push('/(app)/sales-settings' as any)} />
            ) : null}
          </View>
        ) : null}

        {/* Paie & commissions — sales persona only (techs don't see them) */}
        {salesPersona ? (
          <View className="overflow-hidden rounded-3xl bg-white">
            <Row icon="dollarsign.circle" label={t.mobileProfile.commissions} onPress={() => router.push('/(app)/commissions' as any)} />
            <Row icon="banknote" label={t.mobileProfile.myPay} onPress={() => router.push('/(app)/payroll' as any)} />
          </View>
        ) : null}

        {/* General — everyone */}
        <View className="overflow-hidden rounded-3xl bg-white">
          {can('clients.read') ? (
            <Row icon="folder" label={t.mobileProfile.clientRecords} onPress={() => router.push('/(app)/clients' as any)} />
          ) : null}
          <Row icon="bell" label={t.mobileProfile.notifications} onPress={() => router.push('/(app)/notifications' as any)} />
          <Row icon="bubble.left.and.bubble.right" label={t.mobileProfile.messages} onPress={() => router.push('/(app)/messages' as any)} />
          {/* Parrainage : entrée cachée tant que la récompense (crédit Stripe
              au parrain) n'est pas validée par un vrai paiement — même règle
              que le web (route retirée, API 404). L'écran refer.tsx est
              conservé. Réactivation : REFERRALS_ENABLED. */}
        </View>

        {/* Langue / Language */}
        <View className="rounded-3xl bg-white p-4 gap-2">
          <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">Langue · Language</Text>
          <View className="flex-row rounded-2xl bg-surface-sunken p-1">
            {(['fr', 'en'] as const).map((l) => (
              <Pressable
                key={l}
                onPress={() => setLanguage(l)}
                className={`flex-1 items-center rounded-xl py-2 ${language === l ? 'bg-white' : ''}`}
              >
                <Text className={`text-sm font-semibold ${language === l ? 'text-ink' : 'text-ink-muted'}`}>
                  {l === 'fr' ? 'Français' : 'English'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Session — auto sign-out after chosen inactivity ('forever' = never) */}
        <View className="rounded-3xl bg-white p-4 gap-2">
          <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileProfile.stayLoggedIn}</Text>
          <Text className="text-xs text-ink-muted">{t.mobileProfile.stayLoggedInHint}</Text>
          <View className="flex-row flex-wrap gap-1 rounded-2xl bg-surface-sunken p-1">
            {IDLE_LIMIT_OPTIONS.map((opt) => (
              <Pressable
                key={opt}
                onPress={() => setIdleLimit(opt)}
                className={`min-w-[31%] flex-1 items-center rounded-xl py-2 ${idleLimit === opt ? 'bg-white' : ''}`}
              >
                <Text className={`text-sm font-semibold ${idleLimit === opt ? 'text-ink' : 'text-ink-muted'}`}>
                  {
                    {
                      '1h': t.mobileProfile.idle1h,
                      '8h': t.mobileProfile.idle8h,
                      '24h': t.mobileProfile.idle24h,
                      '7d': t.mobileProfile.idle7d,
                      '30d': t.mobileProfile.idle30d,
                      forever: t.mobileProfile.idleForever,
                    }[opt]
                  }
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View className="overflow-hidden rounded-3xl bg-white">
          <Row icon="rectangle.portrait.and.arrow.right" label={t.mobileProfile.logOut} onPress={onSignOut} danger />
        </View>

        <Text className="pt-2 text-center text-xs text-ink-subtle">{t.mobileProfile.version}</Text>
      </ScrollView>
    </View>
  );
}
