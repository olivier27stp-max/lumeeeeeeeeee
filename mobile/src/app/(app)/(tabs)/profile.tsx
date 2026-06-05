import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useAuth } from '@/lib/auth';

export default function Profile() {
  const { session, signOut } = useAuth();

  const onSignOut = async () => {
    await signOut();
    router.replace('/(auth)/sign-in');
  };

  return (
    <ScreenContainer scroll>
      <View className="gap-6 py-6">
        <Text className="text-3xl font-bold text-ink">Profile</Text>

        <Card className="gap-1">
          <Text className="text-xs text-ink-muted uppercase">Signed in as</Text>
          <Text className="text-base font-semibold text-ink">
            {session?.user.email ?? '—'}
          </Text>
          <Text className="text-xs text-ink-subtle">User ID: {session?.user.id}</Text>
        </Card>

        <Button title="Sign out" variant="danger" onPress={onSignOut} />
      </View>
    </ScreenContainer>
  );
}
