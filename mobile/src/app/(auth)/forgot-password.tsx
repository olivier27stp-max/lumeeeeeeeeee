import { Link } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useAuth } from '@/lib/auth';

export default function ForgotPassword() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setInfo(null);
    setLoading(true);
    const { error: e } = await resetPassword(email.trim());
    setLoading(false);
    if (e) {
      setError(e);
      return;
    }
    setInfo('Check your inbox for a reset link.');
  };

  return (
    <ScreenContainer scroll>
      <View className="flex-1 justify-center gap-8 py-12">
        <View className="gap-2">
          <Text className="text-3xl font-bold text-ink">Reset password</Text>
          <Text className="text-base text-ink-muted">
            We&apos;ll send a reset link to your email.
          </Text>
        </View>

        <View className="gap-4">
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@company.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />
          {error ? <Text className="text-sm text-status-late">{error}</Text> : null}
          {info ? <Text className="text-sm text-emerald-600">{info}</Text> : null}
          <Button title="Send reset link" onPress={onSubmit} loading={loading} />
        </View>

        <View className="items-center">
          <Link href="/(auth)/sign-in" asChild>
            <Text className="text-sm font-semibold text-brand">Back to sign in</Text>
          </Link>
        </View>
      </View>
    </ScreenContainer>
  );
}
