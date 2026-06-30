import { Redirect, Stack, router } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';

import { OfflineBanner } from '@/components/OfflineBanner';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth';
import { useMembership } from '@/lib/membership-context';
import { ViewModeProvider } from '@/lib/view-mode';
import { LiveTrackingController } from '@/lib/live-tracking';

export default function AppLayout() {
  const { session, loading, signOut } = useAuth();
  const { loading: membershipLoading, hasNoCompany } = useMembership();

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
        <Text className="text-2xl font-bold text-ink text-center">No company yet</Text>
        <Text className="text-base text-ink-muted text-center">
          Your account isn’t part of a company. Ask your admin to invite{' '}
          {session.user.email}, then sign back in.
        </Text>
        <Button
          title="Sign out"
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
          headerTitle: 'Job',
          presentation: 'modal',
          gestureEnabled: true,
          // Modal presentation has no back chevron on iOS — give it a close button.
          headerLeft: () => (
            <Text onPress={() => router.back()} className="text-base font-medium text-brand">
              Done
            </Text>
          ),
        }}
      />
      <Stack.Screen
        name="jobs/new"
        options={{ headerShown: true, headerTitle: 'New job', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="checklist/[id]"
        options={{ headerShown: true, headerTitle: 'Checklist', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="tasks"
        options={{ headerShown: true, headerTitle: 'Tâches', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="commissions"
        options={{ headerShown: true, headerTitle: 'Commissions', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="leads"
        options={{ headerShown: true, headerTitle: 'Leads', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="payroll"
        options={{ headerShown: true, headerTitle: 'Ma paie', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="payments-setup"
        options={{ headerShown: true, headerTitle: 'Paiements', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="gamification"
        options={{ headerShown: true, headerTitle: 'Défis & badges', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="leaderboard"
        options={{ headerShown: true, headerTitle: 'Classement', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="rep/[id]"
        options={{ headerShown: true, headerTitle: 'Profil', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="sales-settings"
        options={{ headerShown: true, headerTitle: 'Réglages vente', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="quotes/new"
        options={{ headerShown: true, headerTitle: 'New quote', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="quotes/send"
        options={{ headerShown: true, headerTitle: 'Envoyer la soumission', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="invoices/new"
        options={{ headerShown: true, headerTitle: 'New invoice', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="invoices/send"
        options={{ headerShown: true, headerTitle: 'Send invoice', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="jobs/edit"
        options={{ headerShown: true, headerTitle: 'Edit job', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="clients/index"
        options={{ headerShown: true, headerTitle: 'Dossiers clients', headerBackTitle: 'More' }}
      />
      <Stack.Screen
        name="clients/[id]"
        options={{ headerShown: true, headerTitle: 'Client', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="clients/new"
        options={{ headerShown: true, headerTitle: 'New client', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="clients/edit"
        options={{ headerShown: true, headerTitle: 'Edit client', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="schedule"
        options={{ headerShown: true, headerTitle: 'Schedule', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="d2d-house/[id]"
        options={{ headerShown: true, headerTitle: 'House', headerBackTitle: 'Map' }}
      />
      <Stack.Screen
        name="course/[id]"
        options={{ headerShown: true, headerTitle: 'Course', headerBackTitle: 'Learn' }}
      />
      <Stack.Screen name="search" options={{ headerShown: true, headerTitle: 'Search', headerBackTitle: 'More' }} />
      <Stack.Screen name="global-search" options={{ headerShown: true, headerTitle: 'Recherche', headerBackTitle: 'More' }} />
      <Stack.Screen name="dashboard" options={{ headerShown: true, headerTitle: 'Tableau de bord', headerBackTitle: 'More' }} />
      <Stack.Screen name="tech-history" options={{ headerShown: true, headerTitle: 'Équipe', headerBackTitle: 'Time' }} />
      <Stack.Screen name="tech-history/[id]" options={{ headerShown: true, headerTitle: 'Profil', headerBackTitle: 'Équipe' }} />
      <Stack.Screen name="refer" options={{ headerShown: true, headerTitle: 'Refer a friend', headerBackTitle: 'More' }} />
      <Stack.Screen name="manage-team" options={{ headerShown: true, headerTitle: 'Manage team', headerBackTitle: 'More' }} />
      <Stack.Screen name="member/[id]" options={{ headerShown: true, headerTitle: 'Member', headerBackTitle: 'Team' }} />
      <Stack.Screen name="company" options={{ headerShown: true, headerTitle: 'Company details', headerBackTitle: 'More' }} />
      <Stack.Screen name="messages" options={{ headerShown: true, headerTitle: 'Messages', headerBackTitle: 'Home' }} />
      <Stack.Screen name="conversation/[id]" options={{ headerShown: true, headerTitle: 'Conversation', headerBackTitle: 'Messages' }} />
      <Stack.Screen name="notifications" options={{ headerShown: true, headerTitle: 'Notifications', headerBackTitle: 'Home' }} />
        </Stack>
      </View>
    </View>
    </ViewModeProvider>
  );
}
