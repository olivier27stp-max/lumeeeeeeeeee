import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useAuth } from '@/lib/auth';

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    const { error: e } = await signIn(email.trim(), password);
    setLoading(false);
    if (e) {
      setError(e);
      return;
    }
    router.replace('/(app)/(tabs)');
  };

  return (
    <ScreenContainer scroll>
      <View className="flex-1 justify-center gap-8 py-12">
        <View className="gap-2">
          <Text className="text-3xl font-bold text-ink">Welcome back</Text>
          <Text className="text-base text-ink-muted">
            Sign in to your Lume CRM account.
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
            autoComplete="email"
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            autoComplete="password"
          />
          {error ? <Text className="text-sm text-status-late">{error}</Text> : null}
          <Button title="Sign in" onPress={onSubmit} loading={loading} />
          <Link href="/(auth)/forgot-password" asChild>
            <Text className="text-center text-sm text-brand">Forgot password?</Text>
          </Link>
        </View>

        <View className="flex-row justify-center gap-1">
          <Text className="text-sm text-ink-muted">No account?</Text>
          <Link href="/(auth)/sign-up" asChild>
            <Text className="text-sm font-semibold text-brand">Sign up</Text>
          </Link>
        </View>
      </View>
    </ScreenContainer>
  );
}
