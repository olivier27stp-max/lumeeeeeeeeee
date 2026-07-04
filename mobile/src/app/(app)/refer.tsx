import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Share, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { getReferralCode, getReferralSummary } from '@/lib/api/org';
import { formatCurrencyCents } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <View className="flex-row gap-3">
      <View className="h-7 w-7 items-center justify-center rounded-full bg-ink">
        <Text className="text-sm font-bold text-white">{n}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-ink">{title}</Text>
        <Text className="text-sm text-ink-muted">{body}</Text>
      </View>
    </View>
  );
}

export default function ReferFriend() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const { orgId } = usePermissions();
  const userId = session?.user.id ?? '';

  const { data: code, isLoading } = useQuery({
    queryKey: ['referral', userId],
    queryFn: () => getReferralCode(userId, orgId ?? ''),
    enabled: !!userId && !!orgId,
  });
  const { data: summary } = useQuery({
    queryKey: ['referral', 'summary', userId],
    queryFn: () => getReferralSummary(userId),
    enabled: !!userId,
  });

  const webUrl = process.env.EXPO_PUBLIC_WEB_URL;
  // Point straight at the contact / book-a-demo page so the ?ref code is captured there.
  const link = code && webUrl ? `${webUrl.replace(/\/$/, '')}/contact?ref=${code}` : null;

  const share = () => {
    const tail = link ? `\n\n${link}` : code ? `\n\n${t.mobileMisc.shareCodePrefix}${code}` : '';
    Share.share({
      message: `${t.mobileMisc.shareMessage}${tail}`,
      ...(link ? { url: link } : {}),
    });
  };

  return (
    <ScreenContainer scroll>
      <View className="gap-5 py-6">
        <View>
          <Text className="text-2xl font-bold text-ink">{t.mobileMisc.referTitle}</Text>
          <Text className="mt-1 text-sm text-ink-muted">
            {t.mobileMisc.referSubtitle}
          </Text>
        </View>

        {/* Code + link */}
        <Card className="items-center gap-3 py-7">
          <Text className="text-xs uppercase text-ink-muted">{t.mobileMisc.yourReferralCode}</Text>
          {isLoading ? (
            <ActivityIndicator color="#171717" />
          ) : (
            <Text className="text-3xl font-bold tracking-widest text-ink">{code ?? '—'}</Text>
          )}
          {link ? (
            <Text className="px-4 text-center text-xs text-ink-subtle" numberOfLines={1}>
              {link}
            </Text>
          ) : (
            <Text className="px-6 text-center text-[11px] text-ink-subtle">
              {t.mobileMisc.referLinkHint}
            </Text>
          )}
        </Card>

        <Button title={t.mobileMisc.shareMyLink} onPress={share} disabled={!code} />

        {/* Stats */}
        <Card className="gap-3">
          <Text className="text-xs uppercase text-ink-muted">{t.mobileMisc.myReferrals}</Text>
          <View className="flex-row">
            <View className="flex-1 items-center">
              <Text className="text-2xl font-bold text-ink">{summary?.referrals ?? 0}</Text>
              <Text className="text-[11px] text-ink-muted">{t.mobileMisc.referralsSignedUp}</Text>
            </View>
            <View className="flex-1 items-center">
              <Text className="text-2xl font-bold text-ink">{summary?.subscribed ?? 0}</Text>
              <Text className="text-[11px] text-ink-muted">{t.mobileMisc.referralsSubscribed}</Text>
            </View>
            <View className="flex-1 items-center">
              <Text className="text-2xl font-bold text-status-completed">
                {formatCurrencyCents(summary?.rewardedCents ?? 0, summary?.currency ?? 'CAD')}
              </Text>
              <Text className="text-[11px] text-ink-muted">{t.mobileMisc.referralsEarned}</Text>
            </View>
          </View>
          {(summary?.pendingCents ?? 0) > 0 ? (
            <Text className="text-center text-xs text-ink-muted">
              {t.mobileMisc.pendingPayout.replace('{amount}', formatCurrencyCents(summary!.pendingCents, summary?.currency ?? 'CAD'))}
            </Text>
          ) : null}
        </Card>

        {/* How it works */}
        <Card className="gap-4">
          <Text className="text-xs uppercase text-ink-muted">{t.mobileMisc.howItWorks}</Text>
          <Step n={1} title={t.mobileMisc.referStep1Title} body={t.mobileMisc.referStep1Body} />
          <Step n={2} title={t.mobileMisc.referStep2Title} body={t.mobileMisc.referStep2Body} />
          <Step n={3} title={t.mobileMisc.referStep3Title} body={t.mobileMisc.referStep3Body} />
          <Step n={4} title={t.mobileMisc.referStep4Title} body={t.mobileMisc.referStep4Body} />
        </Card>
      </View>
    </ScreenContainer>
  );
}
