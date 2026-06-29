import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Share, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { getReferralCode, getReferralSummary } from '@/lib/api/org';
import { formatCurrencyCents } from '@/lib/format';
import { useAuth } from '@/lib/auth';
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
    const tail = link ? `\n\n${link}` : code ? `\n\nCode : ${code}` : '';
    Share.share({
      message: `Rejoins-moi sur Lume — le CRM que j'utilise pour gérer mes jobs. Utilise mon code et on est récompensés tous les deux.${tail}`,
      ...(link ? { url: link } : {}),
    });
  };

  return (
    <ScreenContainer scroll>
      <View className="gap-5 py-6">
        <View>
          <Text className="text-2xl font-bold text-ink">Parrainer un ami</Text>
          <Text className="mt-1 text-sm text-ink-muted">
            Partage Lume avec une autre entreprise — vous gagnez tous les deux une récompense.
          </Text>
        </View>

        {/* Code + link */}
        <Card className="items-center gap-3 py-7">
          <Text className="text-xs uppercase text-ink-muted">Ton code de parrainage</Text>
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
              Astuce : configure EXPO_PUBLIC_WEB_URL pour partager un vrai lien d'affilié cliquable.
            </Text>
          )}
        </Card>

        <Button title="Partager mon lien" onPress={share} disabled={!code} />

        {/* Stats */}
        <Card className="gap-3">
          <Text className="text-xs uppercase text-ink-muted">Mes parrainages</Text>
          <View className="flex-row">
            <View className="flex-1 items-center">
              <Text className="text-2xl font-bold text-ink">{summary?.referrals ?? 0}</Text>
              <Text className="text-[11px] text-ink-muted">Inscrits</Text>
            </View>
            <View className="flex-1 items-center">
              <Text className="text-2xl font-bold text-ink">{summary?.subscribed ?? 0}</Text>
              <Text className="text-[11px] text-ink-muted">Abonnés</Text>
            </View>
            <View className="flex-1 items-center">
              <Text className="text-2xl font-bold text-status-completed">
                {formatCurrencyCents(summary?.rewardedCents ?? 0, summary?.currency ?? 'CAD')}
              </Text>
              <Text className="text-[11px] text-ink-muted">Gagné</Text>
            </View>
          </View>
          {(summary?.pendingCents ?? 0) > 0 ? (
            <Text className="text-center text-xs text-ink-muted">
              {formatCurrencyCents(summary!.pendingCents, summary?.currency ?? 'CAD')} en attente de versement
            </Text>
          ) : null}
        </Card>

        {/* How it works */}
        <Card className="gap-4">
          <Text className="text-xs uppercase text-ink-muted">Comment ça marche</Text>
          <Step n={1} title="Partage ton code" body="Envoie ton lien/code à une autre entreprise." />
          <Step n={2} title="Ton ami s'inscrit" body="Il crée son compte Lume avec ton code." />
          <Step n={3} title="Il s'abonne" body="Quand il devient client payant, ta récompense se débloque." />
          <Step n={4} title="Vous gagnez tous les deux" body="Récompense créditée sur votre abonnement." />
        </Card>
      </View>
    </ScreenContainer>
  );
}
