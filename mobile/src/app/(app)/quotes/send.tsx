import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Button } from '@/components/ui/Button';
import { getQuote, listQuoteItems, markQuoteSent, quoteShareLink } from '@/lib/api/billing';
import { getClient } from '@/lib/api/clients';
import { getCompany } from '@/lib/api/org';
import { logOutboundMessage } from '@/lib/api/messaging';
import { sendSmsViaServer, isSmsUnavailable } from '@/lib/api/server';
import { textNumber } from '@/lib/contact';
import { sendEmail } from '@/lib/email';
import { htmlToPdf, shareHtmlAsPdf } from '@/lib/pdf';
import { clientFullName, formatCurrencyCents } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useMembership } from '@/lib/membership-context';
import { usePermissions } from '@/lib/usePermissions';
import { buildQuotePreviewHtml } from '@/lib/invoicePreview';

export default function SendQuote() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { session } = useAuth();
  const { orgId } = usePermissions();
  const { current } = useMembership();
  const [sent, setSent] = useState(false);

  const { data: quote, isLoading } = useQuery({
    queryKey: ['quotes', id],
    queryFn: () => getQuote(String(id)),
    enabled: !!id,
  });
  const { data: client } = useQuery({
    queryKey: ['clients', quote?.client_id],
    queryFn: () => getClient(String(quote?.client_id)),
    enabled: !!quote?.client_id,
  });
  const { data: items } = useQuery({
    queryKey: ['quote-items', id],
    queryFn: () => listQuoteItems(String(id)),
    enabled: !!id,
  });
  const { data: company } = useQuery({
    queryKey: ['company', orgId],
    queryFn: () => getCompany(String(orgId)),
    enabled: !!orgId,
  });

  const currency = quote?.currency ?? 'CAD';
  const amount = quote?.total_cents ?? 0;
  const depositCents =
    quote?.deposit_required && quote.deposit_value
      ? quote.deposit_type === 'percentage'
        ? Math.round((amount * quote.deposit_value) / 100)
        : Math.round(quote.deposit_value * 100)
      : 0;

  const previewHtml = useMemo(
    () =>
      quote
        ? buildQuotePreviewHtml({
            company: company ?? null,
            companyName: company?.company_name ?? current?.companyName ?? null,
            companyLogoUrl: company?.logo_url ?? null,
            title: quote.title,
            quoteNumber: quote.quote_number,
            validUntil: quote.valid_until,
            clientName: client ? clientFullName(client) : null,
            items: (items ?? []).map((it) => ({
              name: it.name,
              qty: it.quantity ?? 1,
              unit_price_cents: it.unit_price_cents ?? 0,
            })),
            subtotalCents: quote.subtotal_cents ?? 0,
            discountCents: quote.discount_cents ?? 0,
            taxCents: quote.tax_cents ?? 0,
            totalCents: amount,
            depositCents,
            currency,
          })
        : '',
    [quote, items, client, company, current?.companyName, amount, depositCents, currency],
  );

  const link = quote?.view_token ? quoteShareLink(quote.view_token) : '';
  const fileName = `Soumission-${quote?.quote_number ?? id}`;

  const buildBody = () => {
    const who = client ? clientFullName(client) : 'bonjour';
    const amt = formatCurrencyCents(amount, currency);
    const tail = link ? `\n\nConsultez et approuvez votre soumission ici : ${link}` : '';
    return `Bonjour ${who}, voici votre soumission ${quote?.quote_number ? `#${quote.quote_number}` : ''} de ${amt}.${tail}`;
  };

  const markSent = () => {
    if (!id) return;
    markQuoteSent(String(id)).catch((e) => console.warn('[quotes/send] markQuoteSent:', e?.message ?? e));
    qc.invalidateQueries({ queryKey: ['billing', 'quotes'] });
    setSent(true);
  };

  const sendText = useMutation({
    mutationFn: async () => {
      const phone = client?.phone;
      if (!phone) throw new Error("Ce client n'a pas de numéro. Utilisez Partager ou Courriel.");
      const body = buildBody();
      const name = client ? clientFullName(client) : null;
      try {
        await sendSmsViaServer({ phone, text: body, clientId: quote?.client_id ?? null, clientName: name });
      } catch (e) {
        if (!isSmsUnavailable(e)) throw e;
        await textNumber(phone, body);
        if (session?.user.id) {
          await logOutboundMessage({
            orgId: orgId ?? '',
            phone,
            text: body,
            userId: session.user.id,
            clientId: quote?.client_id ?? null,
            clientName: name,
          });
        }
      }
    },
    onSuccess: markSent,
    onError: (e: Error) => Alert.alert('Soumission', e.message),
  });

  const sendByEmail = useMutation({
    mutationFn: async () => {
      // Attach the quote as a PDF so the client gets a clean document, not just a link.
      let attachments: string[] | undefined;
      try {
        attachments = previewHtml ? [await htmlToPdf(previewHtml, fileName)] : undefined;
      } catch {
        attachments = undefined; // PDF optional — body still carries the link
      }
      const res = await sendEmail({
        to: client?.email ?? null,
        subject: `Soumission ${quote?.quote_number ? `#${quote.quote_number}` : ''} — ${
          company?.company_name ?? current?.companyName ?? 'Lume'
        }`.trim(),
        body: buildBody(),
        attachments,
      });
      if (res === 'unavailable') throw new Error('Aucune app de courriel configurée sur cet appareil.');
    },
    onSuccess: markSent,
    onError: (e: Error) => Alert.alert('Courriel', e.message),
  });

  const shareIt = async () => {
    try {
      await Share.share({ message: buildBody(), ...(link ? { url: link } : {}) });
    } catch {
      /* user cancelled */
    }
  };

  const exportPdf = async () => {
    try {
      if (previewHtml) await shareHtmlAsPdf(previewHtml, fileName);
    } catch (e) {
      Alert.alert('PDF', (e as Error).message);
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <Text className="text-sm text-ink-subtle">Chargement…</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface-alt">
      <View className="gap-3 p-4">
        <Text className="text-lg font-bold text-ink">
          Soumission {quote?.quote_number ?? ''} · {formatCurrencyCents(amount, currency)}
        </Text>

        {!sent ? (
          <View className="gap-2">
            <Button
              title={client?.phone ? 'Envoyer par message' : 'Pas de numéro'}
              onPress={() => sendText.mutate()}
              loading={sendText.isPending}
              disabled={!client?.phone}
            />
            <Button
              title={client?.email ? 'Envoyer par courriel' : 'Envoyer par courriel (choisir)'}
              variant="secondary"
              onPress={() => sendByEmail.mutate()}
              loading={sendByEmail.isPending}
            />
            <View className="flex-row items-center justify-center gap-4 pt-0.5">
              <Pressable onPress={exportPdf}><Text className="text-sm text-brand">PDF…</Text></Pressable>
              <Text className="text-ink-subtle">·</Text>
              <Pressable onPress={shareIt}><Text className="text-sm text-brand">Partager…</Text></Pressable>
              <Text className="text-ink-subtle">·</Text>
              <Pressable onPress={markSent}><Text className="text-sm text-ink-muted">Marquer envoyée</Text></Pressable>
            </View>
          </View>
        ) : (
          <Button title="Terminé" onPress={() => router.replace('/(app)/(tabs)')} />
        )}
      </View>

      <View className="flex-1 border-t border-surface-border bg-white">
        <Text className="px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-ink-subtle">
          Aperçu de la soumission
        </Text>
        {previewHtml ? (
          <WebView
            originWhitelist={['*']}
            source={{ html: previewHtml }}
            startInLoadingState
            style={{ flex: 1, backgroundColor: '#FFFFFF' }}
          />
        ) : (
          <View className="flex-1 items-center justify-center p-6">
            <Text className="text-center text-sm text-ink-subtle">Préparation de l'aperçu…</Text>
          </View>
        )}
      </View>
    </View>
  );
}
