import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';

export default function SignUp() {
  const { t } = useTranslation();
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
      setError(t.mobileComp.passwordTooShort);
      return;
    }
    if (password !== confirm) {
      setError(t.mobileComp.passwordsDoNotMatch);
      return;
    }
    setLoading(true);
    const { error: e } = await signUp(email.trim(), password);
    setLoading(false);
    if (e) {
      setError(e);
      return;
    }
    setInfo(t.mobileComp.checkInboxVerify);
    setTimeout(() => router.replace('/(auth)/sign-in'), 2000);
  };

  return (
    <ScreenContainer scroll>
      <View className="flex-1 justify-center gap-8 py-12">
        <View className="gap-2">
          <Text className="text-3xl font-bold text-ink">{t.mobileComp.signUpTitle}</Text>
          <Text className="text-base text-ink-muted">
            {t.mobileComp.signUpSubtitle}
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
            placeholder={t.mobileComp.passwordMinChars}
            secureTextEntry
            autoComplete="password-new"
          />
          <Input
            label={t.mobileComp.confirmPasswordLabel}
            value={confirm}
            onChangeText={setConfirm}
            placeholder={t.mobileComp.passwordPlaceholder}
            secureTextEntry
          />
          {error ? <Text className="text-sm text-status-late">{error}</Text> : null}
          {info ? <Text className="text-sm text-emerald-600">{info}</Text> : null}
          <Button title={t.mobileComp.createAccount} onPress={onSubmit} loading={loading} />
        </View>

        <View className="flex-row justify-center gap-1">
          <Text className="text-sm text-ink-muted">{t.mobileComp.alreadyHaveAccount}</Text>
          <Link href="/(auth)/sign-in" asChild>
            <Text className="text-sm font-semibold text-brand">{t.mobileComp.signIn}</Text>
          </Link>
        </View>
      </View>
    </ScreenContainer>
  );
}
