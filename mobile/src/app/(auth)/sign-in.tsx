import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';

export default function SignIn() {
  const { t } = useTranslation();
  const { signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

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

  const onGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    const { error: e } = await signInWithGoogle();
    setGoogleLoading(false);
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
          <Text className="text-3xl font-bold text-ink">{t.mobileComp.signInWelcome}</Text>
          <Text className="text-base text-ink-muted">
            {t.mobileComp.signInSubtitle}
          </Text>
        </View>

        <View className="gap-4">
          <Input
            label={t.mobileComp.emailLabel}
            value={email}
            onChangeText={setEmail}
            placeholder={t.mobileComp.emailPlaceholder}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <Input
            label={t.mobileComp.passwordLabel}
            value={password}
            onChangeText={setPassword}
            placeholder={t.mobileComp.passwordPlaceholder}
            secureTextEntry
            autoComplete="password"
          />
          {error ? <Text className="text-sm text-status-late">{error}</Text> : null}
          <Button title={t.mobileComp.signIn} onPress={onSubmit} loading={loading} />

          <View className="flex-row items-center gap-3 py-1">
            <View className="h-px flex-1 bg-surface-border" />
            <Text className="text-xs text-ink-muted">{t.mobileComp.or}</Text>
            <View className="h-px flex-1 bg-surface-border" />
          </View>
          <Button
            title={t.mobileComp.continueWithGoogle}
            variant="secondary"
            onPress={onGoogle}
            loading={googleLoading}
          />

          <Link href="/(auth)/forgot-password" asChild>
            <Text className="text-center text-sm text-brand">{t.mobileComp.forgotPassword}</Text>
          </Link>
        </View>

        <View className="flex-row justify-center gap-1">
          <Text className="text-sm text-ink-muted">{t.mobileComp.noAccount}</Text>
          <Link href="/(auth)/sign-up" asChild>
            <Text className="text-sm font-semibold text-brand">{t.mobileComp.signUp}</Text>
          </Link>
        </View>
      </View>
    </ScreenContainer>
  );
}
