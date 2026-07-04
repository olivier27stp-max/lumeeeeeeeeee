// Lume Payments — self-serve Stripe Connect onboarding, per company.
// An owner/admin connects their OWN (Express) account so the org can collect
// card payments on the client pay page. Lume is the platform: a per-transaction
// application fee (server-side, see server/lib/stripe-connect.ts) is Lume's
// margin. The Stripe API lives entirely server-side; this screen just drives the
// authed /api/connect/* endpoints and opens Stripe's hosted onboarding.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { Button } from '@/components/ui/Button';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';
import {
  activateConnectedAccount,
  getConnectOnboardingLink,
  getConnectStatus,
  serverConfigured,
} from '@/lib/api/server';

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <View className="flex-row gap-3">
      <View className="h-7 w-7 items-center justify-center rounded-full bg-ink">
        <Text className="text-sm font-bold text-white">{n}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-ink">{title}</Text>
        <Text className="text-sm text-ink-muted">{body}</Text>
      </View>
    </View>
  );
}

export default function PaymentsSetup() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { orgId, role } = usePermissions();
  const isManager = role === 'owner' || role === 'admin';

  const statusQ = useQuery({
    queryKey: ['connect', 'status', orgId],
    queryFn: () => getConnectStatus(orgId ?? ''),
    enabled: !!orgId && isManager && serverConfigured(),
  });

  const account = statusQ.data?.account ?? null;
  const fullyConnected = !!account?.charges_enabled && !!account?.onboarding_complete;
  const pending = !!statusQ.data?.connected && !fullyConnected;

  // Open Stripe's hosted onboarding in an in-app browser, then refetch status
  // when the owner returns (the server reads the real Stripe state).
  const openOnboarding = async (refresh: boolean) => {
    const { url } = await getConnectOnboardingLink(orgId ?? '', refresh);
    await WebBrowser.openBrowserAsync(url);
    await qc.invalidateQueries({ queryKey: ['connect', 'status', orgId] });
  };

  const activateMut = useMutation({
    mutationFn: async () => {
      await activateConnectedAccount(orgId ?? '');
      await openOnboarding(false);
    },
    onError: (e: Error) => Alert.alert(t.mobileTeam.lumePayments, e.message),
  });

  const continueMut = useMutation({
    mutationFn: () => openOnboarding(true),
    onError: (e: Error) => Alert.alert(t.mobileTeam.lumePayments, e.message),
  });

  const busy = activateMut.isPending || continueMut.isPending;

  if (!serverConfigured()) {
    return (
      <ScreenContainer>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-base text-ink-muted">
            {t.mobileTeam.paymentsUnavailableServer}
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!isManager) {
    return (
      <ScreenContainer>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-base text-ink-muted">
            {t.mobileTeam.onlyOwnerAdminPayments}
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  if (statusQ.isLoading) {
    return (
      <ScreenContainer>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll>
      {/* Status card */}
      <View className="rounded-3xl bg-white p-5">
        <View className="flex-row items-center gap-2">
          <View
            style={{ width: 10, height: 10, borderRadius: 5 }}
            className={fullyConnected ? 'bg-status-completed' : pending ? 'bg-status-inProgress' : 'bg-surface-border'}
          />
          <Text className="text-base font-bold text-ink">
            {fullyConnected
              ? t.mobileTeam.paymentsActivated
              : pending
                ? t.mobileTeam.setupToFinish
                : t.mobileTeam.paymentsNotActivated}
          </Text>
        </View>
        <Text className="mt-2 text-sm text-ink-muted">
          {fullyConnected
            ? t.mobileTeam.activatedBody
            : pending
              ? t.mobileTeam.pendingBody
              : t.mobileTeam.notActivatedBody}
        </Text>

        {statusQ.data?.warning ? (
          <Text className="mt-3 text-xs text-status-late">{statusQ.data.warning}</Text>
        ) : null}

        <View className="mt-5">
          {fullyConnected ? (
            <Button title={t.mobileTeam.manageMyAccount} variant="secondary" loading={busy} onPress={() => continueMut.mutate()} />
          ) : pending ? (
            <Button title={t.mobileTeam.finishSetup} loading={busy} onPress={() => continueMut.mutate()} />
          ) : (
            <Button title={t.mobileTeam.activateLumePayments} loading={busy} onPress={() => activateMut.mutate()} />
          )}
        </View>
      </View>

      {/* How it works */}
      <View className="mt-5 gap-4 rounded-3xl bg-white p-5">
        <Text className="text-sm font-semibold text-ink">{t.mobileTeam.howItWorks}</Text>
        <Step n={1} title={t.mobileTeam.step1Title} body={t.mobileTeam.step1Body} />
        <Step n={2} title={t.mobileTeam.step2Title} body={t.mobileTeam.step2Body} />
        <Step n={3} title={t.mobileTeam.step3Title} body={t.mobileTeam.step3Body} />
        <Step n={4} title={t.mobileTeam.step4Title} body={t.mobileTeam.step4Body} />
      </View>

      {fullyConnected && account ? (
        <View className="mt-5 gap-2 rounded-3xl bg-white p-5">
          <Text className="text-sm font-semibold text-ink">{t.mobileTeam.accountDetails}</Text>
          <View className="flex-row justify-between">
            <Text className="text-sm text-ink-muted">{t.mobileTeam.charges}</Text>
            <Text className="text-sm text-ink">{account.charges_enabled ? t.mobileTeam.enabled : t.mobileTeam.awaiting}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-ink-muted">{t.mobileTeam.payouts}</Text>
            <Text className="text-sm text-ink">{account.payouts_enabled ? t.mobileTeam.payoutsEnabled : t.mobileTeam.awaiting}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-ink-muted">{t.mobileTeam.currency}</Text>
            <Text className="text-sm text-ink">{(account.default_currency ?? 'cad').toUpperCase()}</Text>
          </View>
        </View>
      ) : null}
    </ScreenContainer>
  );
}
