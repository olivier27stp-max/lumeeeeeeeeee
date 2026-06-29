// Lume Payments — self-serve Stripe Connect onboarding, per company.
// An owner/admin connects their OWN (Express) account so the org can collect
// card payments on the client pay page. Lume is the platform: a per-transaction
// application fee (server-side, see server/lib/stripe-connect.ts) is Lume's
// margin. The Stripe API lives entirely server-side; this screen just drives the
// authed /api/connect/* endpoints and opens Stripe's hosted onboarding.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { Button } from '@/components/ui/Button';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { usePermissions } from '@/lib/usePermissions';
import {
  activateConnectedAccount,
  getConnectOnboardingLink,
  getConnectStatus,
  serverConfigured,
} from '@/lib/api/server';

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

export default function PaymentsSetup() {
  const qc = useQueryClient();
  const { orgId, role } = usePermissions();
  const isManager = role === 'owner' || role === 'admin';

  const statusQ = useQuery({
    queryKey: ['connect', 'status', orgId],
    queryFn: () => getConnectStatus(orgId ?? ''),
    enabled: !!orgId && isManager && serverConfigured(),
  });

  const account = statusQ.data?.account ?? null;
  const fullyConnected = !!account?.charges_enabled && !!account?.onboarding_complete;
  const pending = !!statusQ.data?.connected && !fullyConnected;

  // Open Stripe's hosted onboarding in an in-app browser, then refetch status
  // when the owner returns (the server reads the real Stripe state).
  const openOnboarding = async (refresh: boolean) => {
    const { url } = await getConnectOnboardingLink(orgId ?? '', refresh);
    await WebBrowser.openBrowserAsync(url);
    await qc.invalidateQueries({ queryKey: ['connect', 'status', orgId] });
  };

  const activateMut = useMutation({
    mutationFn: async () => {
      await activateConnectedAccount(orgId ?? '');
      await openOnboarding(false);
    },
    onError: (e: Error) => Alert.alert('Lume Payments', e.message),
  });

  const continueMut = useMutation({
    mutationFn: () => openOnboarding(true),
    onError: (e: Error) => Alert.alert('Lume Payments', e.message),
  });

  const busy = activateMut.isPending || continueMut.isPending;

  if (!serverConfigured()) {
    return (
      <ScreenContainer>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-base text-ink-muted">
            Les paiements ne sont pas disponibles : l’URL du serveur Lume n’est pas configurée.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!isManager) {
    return (
      <ScreenContainer>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-base text-ink-muted">
            Seul le propriétaire ou un administrateur peut configurer les paiements.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  if (statusQ.isLoading) {
    return (
      <ScreenContainer>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll>
      {/* Status card */}
      <View className="rounded-3xl bg-white p-5">
        <View className="flex-row items-center gap-2">
          <View
            style={{ width: 10, height: 10, borderRadius: 5 }}
            className={fullyConnected ? 'bg-status-completed' : pending ? 'bg-status-inProgress' : 'bg-surface-border'}
          />
          <Text className="text-base font-bold text-ink">
            {fullyConnected ? 'Paiements activés' : pending ? 'Configuration à terminer' : 'Paiements non activés'}
          </Text>
        </View>
        <Text className="mt-2 text-sm text-ink-muted">
          {fullyConnected
            ? 'Tes clients peuvent payer leurs factures par carte. L’argent arrive directement dans ton compte.'
            : pending
              ? 'Ton compte de paiement est créé, mais Stripe a besoin de quelques infos de plus (identité, compte bancaire) pour l’activer.'
              : 'Connecte ton compte pour encaisser les paiements par carte directement depuis tes factures.'}
        </Text>

        {statusQ.data?.warning ? (
          <Text className="mt-3 text-xs text-status-late">{statusQ.data.warning}</Text>
        ) : null}

        <View className="mt-5">
          {fullyConnected ? (
            <Button title="Gérer mon compte" variant="secondary" loading={busy} onPress={() => continueMut.mutate()} />
          ) : pending ? (
            <Button title="Terminer la configuration" loading={busy} onPress={() => continueMut.mutate()} />
          ) : (
            <Button title="Activer Lume Payments" loading={busy} onPress={() => activateMut.mutate()} />
          )}
        </View>
      </View>

      {/* How it works */}
      <View className="mt-5 gap-4 rounded-3xl bg-white p-5">
        <Text className="text-sm font-semibold text-ink">Comment ça marche</Text>
        <Step n={1} title="Tu connectes ton compte" body="Quelques minutes via Stripe — identité et compte bancaire." />
        <Step n={2} title="Tu envoies une facture" body="Depuis l’app, le client reçoit un lien de paiement par SMS." />
        <Step n={3} title="Le client paie par carte" body="Sur une page sécurisée, en quelques secondes." />
        <Step n={4} title="Tu reçois l’argent" body="Les fonds arrivent directement dans ton compte bancaire." />
      </View>

      {fullyConnected && account ? (
        <View className="mt-5 gap-2 rounded-3xl bg-white p-5">
          <Text className="text-sm font-semibold text-ink">Détails du compte</Text>
          <View className="flex-row justify-between">
            <Text className="text-sm text-ink-muted">Encaissement</Text>
            <Text className="text-sm text-ink">{account.charges_enabled ? 'Activé' : 'En attente'}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-ink-muted">Versements</Text>
            <Text className="text-sm text-ink">{account.payouts_enabled ? 'Activés' : 'En attente'}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-ink-muted">Devise</Text>
            <Text className="text-sm text-ink">{(account.default_currency ?? 'cad').toUpperCase()}</Text>
          </View>
        </View>
      ) : null}
    </ScreenContainer>
  );
}
