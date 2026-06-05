import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useAuth } from '@/lib/auth';

export default function SignUp() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setInfo(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    const { error: e } = await signUp(email.trim(), password);
    setLoading(false);
    if (e) {
      setError(e);
      return;
    }
    setInfo('Check your inbox to verify your email.');
    setTimeout(() => router.replace('/(auth)/sign-in'), 2000);
  };

  return (
    <ScreenContainer scroll>
      <View className="flex-1 justify-center gap-8 py-12">
        <View className="gap-2">
          <Text className="text-3xl font-bold text-ink">Create your account</Text>
          <Text className="text-base text-ink-muted">
            Start managing your service business on the go.
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
            placeholder="At least 6 characters"
            secureTextEntry
            autoComplete="password-new"
          />
          <Input
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            placeholder="••••••••"
            secureTextEntry
          />
          {error ? <Text className="text-sm text-status-late">{error}</Text> : null}
          {info ? <Text className="text-sm text-emerald-600">{info}</Text> : null}
          <Button title="Create account" onPress={onSubmit} loading={loading} />
        </View>

        <View className="flex-row justify-center gap-1">
          <Text className="text-sm text-ink-muted">Already have an account?</Text>
          <Link href="/(auth)/sign-in" asChild>
            <Text className="text-sm font-semibold text-brand">Sign in</Text>
          </Link>
        </View>
      </View>
    </ScreenContainer>
  );
}
