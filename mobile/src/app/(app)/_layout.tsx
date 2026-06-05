import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { useMembership } from '@/lib/membership-context';

export default function AppLayout() {
  const { session, loading } = useAuth();
  const { loading: membershipLoading } = useMembership();

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

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="jobs/[id]"
        options={{ headerShown: true, headerTitle: 'Job', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="clients/[id]"
        options={{ headerShown: true, headerTitle: 'Client', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="schedule"
        options={{ headerShown: true, headerTitle: 'Schedule', headerBackTitle: 'Back' }}
      />
    </Stack>
  );
}
