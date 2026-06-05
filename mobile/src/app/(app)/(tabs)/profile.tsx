import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useAuth } from '@/lib/auth';
import { useMembership } from '@/lib/membership-context';
import { ROLE_LABELS } from '@/lib/permissions';

export default function Profile() {
  const { session, signOut } = useAuth();
  const { current } = useMembership();

  const onSignOut = async () => {
    await signOut();
    router.replace('/(auth)/sign-in');
  };

  const roleLabel = current ? ROLE_LABELS[current.role]?.en ?? current.role : null;

  return (
    <ScreenContainer scroll>
      <View className="gap-6 py-6">
        <Text className="text-3xl font-bold text-ink">Profile</Text>

        <Card className="gap-1">
          <Text className="text-xs text-ink-muted uppercase">Signed in as</Text>
          <Text className="text-base font-semibold text-ink">
            {current?.fullName ?? session?.user.email ?? '—'}
          </Text>
          {current?.fullName ? (
            <Text className="text-xs text-ink-subtle">{session?.user.email}</Text>
          ) : null}
        </Card>

        {current ? (
          <Card className="gap-3">
            <View>
              <Text className="text-xs text-ink-muted uppercase mb-1">Company</Text>
              <Text className="text-base text-ink">{current.companyName ?? '—'}</Text>
            </View>
            <View>
              <Text className="text-xs text-ink-muted uppercase mb-1">Role</Text>
              <Text className="text-base text-ink">{roleLabel}</Text>
            </View>
          </Card>
        ) : null}

        <Button title="Sign out" variant="danger" onPress={onSignOut} />
      </View>
    </ScreenContainer>
  );
}
