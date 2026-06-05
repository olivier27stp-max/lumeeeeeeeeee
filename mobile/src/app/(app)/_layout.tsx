import { Redirect, Stack, router } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';

import { OfflineBanner } from '@/components/OfflineBanner';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth';
import { useMembership } from '@/lib/membership-context';

export default function AppLayout() {
  const { session, loading, signOut } = useAuth();
  const { loading: membershipLoading, hasNoCompany } = useMembership();

  // Block render until both auth and the role/permission layer have resolved,
  // so no screen ever renders with an unknown role (which could leak pricing).
  if (loading || (session && membershipLoading)) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <ActivityIndicator color="#208AEF" />
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
    <View className="flex-1">
      <OfflineBanner />
      <View className="flex-1">
        <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="jobs/[id]"
        options={{ headerShown: true, headerTitle: 'Job', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="jobs/new"
        options={{ headerShown: true, headerTitle: 'New job', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="jobs/edit"
        options={{ headerShown: true, headerTitle: 'Edit job', headerBackTitle: 'Back' }}
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
        </Stack>
      </View>
    </View>
  );
}
