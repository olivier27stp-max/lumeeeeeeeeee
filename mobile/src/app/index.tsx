import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth';

export default function Index() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <ActivityIndicator color="#208AEF" />
      </View>
    );
  }

  return <Redirect href={session ? '/(app)/(tabs)' : '/(auth)/sign-in'} />;
}
