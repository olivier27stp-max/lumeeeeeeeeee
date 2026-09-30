import { useQuery } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { CustomFieldsCard } from '@/components/CustomFieldsCard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getQuote, listQuoteItems } from '@/lib/api/billing';
import { getClient } from '@/lib/api/clients';
import { clientFullName, formatCurrencyCents } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

function Ligne({ label, value, fort }: { label: string; value: string; fort?: boolean }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className={fort ? 'text-sm font-semibold text-ink' : 'text-sm text-ink-muted'}>{label}</Text>
      <Text className={fort ? 'text-base font-bold text-ink' : 'text-sm text-ink'}>{value}</Text>
    </View>
  );
}

/**
 * Fiche d'un devis. Elle existe surtout pour donner un toit aux champs
 * personnalisés du devis : avant, toucher un devis menait droit à l'écran
 * d'envoi, donc rien ne pouvait afficher ses champs. Aucune capacité que le web
 * n'a pas — l'envoi reste l'écran d'envoi existant.
 */
export default function QuoteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const c = t.mobileQuoteDetail;
  const { can, canSeePricing } = usePermissions();

  const { data: devis, isLoading, error } = useQuery({
    queryKey: ['quotes', id],
    queryFn: () => getQuote(String(id)),
    enabled: !!id,
  });
  const { data: lignes } = useQuery({
    queryKey: ['quote-items', id],
    queryFn: () => listQuoteItems(String(id)),
    enabled: !!id && canSeePricing,
  });
  const { data: client } = useQuery({
    queryKey: ['clients', devis?.client_id],
    queryFn: () => getClient(String(devis?.client_id)),
    enabled: !!devis?.client_id,
  });

  if (!(can('quotes.read') || canSeePricing)) return <Redirect href="/(app)/(tabs)" />;

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt p-6">
        <Text className="text-ink-muted">{c.loading}</Text>
      </View>
    );
  }
  if (error || !devis) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt p-6">
        <Text className="text-center text-ink-muted">{error ? (error as Error).message : c.notFound}</Text>
      </View>
    );
  }

  const devise = devis.currency ?? 'CAD';
  const argent = (cents: number | null) => formatCurrencyCents(cents ?? 0, devise);
  const statut = devis.status ?? '';
  // Le dictionnaire `status` couvre les statuts de devis, ce que la pastille
  // partagée ne fait pas (elle retomberait sur le slug anglais brut).
  const statutLisible = (t.status as Record<string, string>)[statut] ?? statut;

  return (
    <ScrollView className="flex-1 bg-surface-alt">
      <View className="gap-4 p-5">
        <View className="gap-1">
          <Text className="text-2xl font-bold text-ink">
            {devis.quote_number ? c.number.replace('{number}', devis.quote_number) : c.quote}
          </Text>
          {devis.title ? <Text className="text-base text-ink-muted">{devis.title}</Text> : null}
          <Text className="text-sm font-semibold text-ink-muted">{statutLisible}</Text>
        </View>

        {client ? (
          <Card onPress={() => router.push(`/(app)/clients/${client.id}` as never)} className="gap-1">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{c.client}</Text>
            <Text className="text-base font-medium text-ink">{clientFullName(client)}</Text>
          </Card>
        ) : null}

        {canSeePricing ? (
          <Card className="gap-2.5">
            <Text className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{c.items}</Text>
            {(lignes ?? []).length === 0 ? (
              <Text className="text-sm text-ink-muted">{c.noItems}</Text>
            ) : (
              (lignes ?? []).map((l) => (
                <View key={l.id} className="flex-row items-start justify-between border-t border-surface-border pt-2.5">
                  <View className="flex-1 pr-3">
                    <Text className="text-sm font-medium text-ink">{l.name ?? '—'}</Text>
                    <Text className="text-xs text-ink-muted">
                      {`${l.quantity ?? 1} × ${argent(l.unit_price_cents)}`}
                    </Text>
                  </View>
                  <Text className="text-sm text-ink">{argent(l.total_cents)}</Text>
                </View>
              ))
            )}

            <View className="mt-1 gap-1.5 border-t border-surface-border pt-2.5">
              <Ligne label={c.subtotal} value={argent(devis.subtotal_cents)} />
              {devis.discount_cents ? <Ligne label={c.discount} value={`− ${argent(devis.discount_cents)}`} /> : null}
              <Ligne label={c.tax} value={argent(devis.tax_cents)} />
              <Ligne label={c.total} value={argent(devis.total_cents)} fort />
            </View>
          </Card>
        ) : null}

        <CustomFieldsCard objet="quote" recordId={devis.id} />

        {can('quotes.send') ? (
          <Button title={c.send} onPress={() => router.push(`/(app)/quotes/send?id=${devis.id}` as never)} />
        ) : null}
      </View>
    </ScrollView>
  );
}
