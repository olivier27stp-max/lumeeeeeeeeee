import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth';

export default function AppLayout() {
  const { session, loading } = useAuth();

  if (loading) {
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
    </Stack>
  );
}
