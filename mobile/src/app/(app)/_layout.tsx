import { Redirect, Stack, router } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';

import { OfflineBanner } from '@/components/OfflineBanner';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth';
import { useMembership } from '@/lib/membership-context';
import { ViewModeProvider } from '@/lib/view-mode';
import { LiveTrackingController } from '@/lib/live-tracking';
import { useTranslation } from '@/lib/i18n';

export default function AppLayout() {
  const { session, loading, signOut } = useAuth();
  const { loading: membershipLoading, hasNoCompany } = useMembership();
  const { t } = useTranslation();

  // Block render until both auth and the role/permission layer have resolved,
  // so no screen ever renders with an unknown role (which could leak pricing).
  if (loading || (session && membershipLoading)) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <ActivityIndicator color="#171717" />
      </View>
    );
  }
  if (!session) return <Redirect href="/(auth)/sign-in" />;

  // Authenticated but not a member of any company yet (e.g. fresh self-signup).
  // Avoid dropping them into an empty app with no data.
  if (hasNoCompany) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-surface-alt p-8">
        <Text className="text-2xl font-bold text-ink text-center">{t.mobileNav.noCompanyYet}</Text>
        <Text className="text-base text-ink-muted text-center">
          {t.mobileNav.noCompanyExplain.replace('{email}', session.user.email ?? '')}
        </Text>
        <Button
          title={t.mobileNav.signOut}
          variant="secondary"
          onPress={async () => {
            await signOut();
            router.replace('/(auth)/sign-in');
          }}
        />
      </View>
    );
  }

  return (
    <ViewModeProvider>
    <View className="flex-1">
      <OfflineBanner />
      <LiveTrackingController />
      <View className="flex-1">
        <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="jobs/[id]"
        options={{
          headerShown: true,
          headerTitle: t.mobileNav.job,
          presentation: 'modal',
          gestureEnabled: true,
          // Modal presentation has no back chevron on iOS — give it a close button.
          headerLeft: () => (
            <Text onPress={() => router.back()} className="text-base font-medium text-brand">
              {t.mobileNav.done}
            </Text>
          ),
        }}
      />
      <Stack.Screen
        name="jobs/new"
        options={{ headerShown: true, headerTitle: t.mobileNav.newJob, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="checklist/[id]"
        options={{ headerShown: true, headerTitle: t.mobileNav.checklist, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="tasks"
        options={{ headerShown: true, headerTitle: t.mobileNav.tasks, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="commissions"
        options={{ headerShown: true, headerTitle: t.mobileNav.commissions, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="leads"
        options={{ headerShown: true, headerTitle: t.mobileNav.leads, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="payroll"
        options={{ headerShown: true, headerTitle: t.mobileNav.myPay, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="payments-setup"
        options={{ headerShown: true, headerTitle: t.mobileNav.payments, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="gamification"
        options={{ headerShown: true, headerTitle: t.mobileNav.challengesBadges, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="leaderboard"
        options={{ headerShown: true, headerTitle: t.mobileNav.leaderboard, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="rep/[id]"
        options={{ headerShown: true, headerTitle: t.mobileNav.profile, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="sales-settings"
        options={{ headerShown: true, headerTitle: t.mobileNav.salesSettings, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="quotes/new"
        options={{ headerShown: true, headerTitle: t.mobileNav.newQuote, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="quotes/send"
        options={{ headerShown: true, headerTitle: t.mobileNav.sendQuote, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="invoices/new"
        options={{ headerShown: true, headerTitle: t.mobileNav.newInvoice, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="invoices/send"
        options={{ headerShown: true, headerTitle: t.mobileNav.sendInvoice, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="jobs/edit"
        options={{ headerShown: true, headerTitle: t.mobileNav.editJob, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="clients/index"
        options={{ headerShown: true, headerTitle: t.mobileNav.clientRecords, headerBackTitle: t.mobileNav.backMore }}
      />
      <Stack.Screen
        name="clients/[id]"
        options={{ headerShown: true, headerTitle: t.mobileNav.client, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="clients/new"
        options={{ headerShown: true, headerTitle: t.mobileNav.newClient, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="clients/edit"
        options={{ headerShown: true, headerTitle: t.mobileNav.editClient, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="schedule"
        options={{ headerShown: true, headerTitle: t.mobileNav.schedule, headerBackTitle: t.mobileNav.backBack }}
      />
      <Stack.Screen
        name="d2d-house/[id]"
        options={{ headerShown: true, headerTitle: t.mobileNav.house, headerBackTitle: t.mobileNav.backMap }}
      />
      <Stack.Screen
        name="course/[id]"
        options={{ headerShown: true, headerTitle: t.mobileNav.course, headerBackTitle: t.mobileNav.backLearn }}
      />
      <Stack.Screen name="search" options={{ headerShown: true, headerTitle: t.mobileNav.search, headerBackTitle: t.mobileNav.backMore }} />
      <Stack.Screen name="global-search" options={{ headerShown: true, headerTitle: t.mobileNav.globalSearch, headerBackTitle: t.mobileNav.backMore }} />
      <Stack.Screen name="dashboard" options={{ headerShown: true, headerTitle: t.mobileNav.dashboard, headerBackTitle: t.mobileNav.backMore }} />
      <Stack.Screen name="tech-history" options={{ headerShown: true, headerTitle: t.mobileNav.team, headerBackTitle: t.mobileNav.backTime }} />
      <Stack.Screen name="tech-history/[id]" options={{ headerShown: true, headerTitle: t.mobileNav.profile, headerBackTitle: t.mobileNav.backTeam }} />
      <Stack.Screen name="refer" options={{ headerShown: true, headerTitle: t.mobileNav.referAFriend, headerBackTitle: t.mobileNav.backMore }} />
      <Stack.Screen name="manage-team" options={{ headerShown: true, headerTitle: t.mobileNav.manageTeam, headerBackTitle: t.mobileNav.backMore }} />
      <Stack.Screen name="member/[id]" options={{ headerShown: true, headerTitle: t.mobileNav.member, headerBackTitle: t.mobileNav.backTeam }} />
      <Stack.Screen name="company" options={{ headerShown: true, headerTitle: t.mobileNav.companyDetails, headerBackTitle: t.mobileNav.backMore }} />
      <Stack.Screen name="messages" options={{ headerShown: true, headerTitle: t.mobileNav.messages, headerBackTitle: t.mobileNav.backHome }} />
      <Stack.Screen name="conversation/[id]" options={{ headerShown: true, headerTitle: t.mobileNav.conversation, headerBackTitle: t.mobileNav.messages }} />
      <Stack.Screen name="notifications" options={{ headerShown: true, headerTitle: t.mobileNav.notifications, headerBackTitle: t.mobileNav.backHome }} />
        </Stack>
      </View>
    </View>
    </ViewModeProvider>
  );
}
