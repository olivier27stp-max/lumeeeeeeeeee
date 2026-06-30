import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Button } from '@/components/ui/Button';
import { getInvoice, getOrCreatePaymentLink, listInvoiceItems, markInvoiceSent } from '@/lib/api/billing';
import { getClient } from '@/lib/api/clients';
import { getCompany } from '@/lib/api/org';
import { findOrCreateConversation, logOutboundMessage } from '@/lib/api/messaging';
import { sendInvoiceEmailViaServer, sendSmsViaServer, isSmsUnavailable } from '@/lib/api/server';
import { collectInvoicePayment } from '@/lib/payments';
import { textNumber } from '@/lib/contact';
import { clientFullName, formatCurrencyCents } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useMembership } from '@/lib/membership-context';
import { usePermissions } from '@/lib/usePermissions';
import { buildInvoicePreviewHtml } from '@/lib/invoicePreview';
import { shareHtmlAsPdf } from '@/lib/pdf';

export default function SendInvoice() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { session } = useAuth();
  const { orgId } = usePermissions();
  const { current } = useMembership();
  const [sent, setSent] = useState(false);

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoices', id],
    queryFn: () => getInvoice(String(id)),
    enabled: !!id,
  });
  const { data: client } = useQuery({
    queryKey: ['clients', invoice?.client_id],
    queryFn: () => getClient(String(invoice?.client_id)),
    enabled: !!invoice?.client_id,
  });
  const { data: items } = useQuery({
    queryKey: ['invoice-items', id],
    queryFn: () => listInvoiceItems(String(id)),
    enabled: !!id,
  });
  // Company brand (logo + name) — set in the desktop company settings, read from
  // the same company_settings row, so it shows up here automatically.
  const { data: company } = useQuery({
    queryKey: ['company', orgId],
    queryFn: () => getCompany(String(orgId)),
    enabled: !!orgId,
  });

  const amount = invoice?.balance_cents ?? invoice?.total_cents ?? 0;

  // In-app invoice preview — rendered from our own data so it ALWAYS shows,
  // even when the business hasn't connected Stripe (the client pay page refuses
  // to render until payments are set up).
  const previewHtml = useMemo(
    () =>
      invoice
        ? buildInvoicePreviewHtml({
            company: company ?? null,
            companyName: company?.company_name ?? current?.companyName ?? null,
            companyLogoUrl: company?.logo_url ?? null,
            invoice,
            items: items ?? [],
            client: client ?? null,
          })
        : '',
    [invoice, items, client, company?.company_name, company?.logo_url, current?.companyName],
  );

  const { data: payUrl } = useQuery({
    queryKey: ['pay-link', id, amount],
    queryFn: () => getOrCreatePaymentLink({ orgId: orgId ?? '', invoiceId: String(id), amountCents: amount, currency: 'CAD' }),
    enabled: !!id && !!orgId && amount > 0,
    retry: false,
  });

  const buildBody = () => {
    const who = client ? clientFullName(client) : 'there';
    const amt = formatCurrencyCents(amount, 'CAD');
    const link = payUrl ? `\n\nView and pay it here: ${payUrl}` : '';
    return `Hi ${who}, here's your invoice ${invoice?.invoice_number ? `#${invoice.invoice_number}` : ''} for ${amt}.${link}`;
  };

  const markSent = () => {
    if (!id) return;
    markInvoiceSent(String(id)).catch((e) => console.warn('[invoices/send] markInvoiceSent failed:', e?.message ?? e));
    qc.invalidateQueries({ queryKey: ['invoices'] });
    setSent(true);
  };

  const sendText = useMutation({
    mutationFn: async () => {
      const phone = client?.phone;
      if (!phone) throw new Error('This client has no phone number on file. Use Share instead.');
      const body = buildBody();
      const name = client ? clientFullName(client) : null;
      // Send through Lume (the org's number via the server) so it lands in the
      // in-app conversation — the same path as the chat and the reschedule
      // message. Only fall back to the device's native composer if the server
      // genuinely can't send (number not provisioned, unreachable…).
      try {
        await sendSmsViaServer({ phone, text: body, clientId: invoice?.client_id ?? null, clientName: name });
      } catch (e) {
        if (!isSmsUnavailable(e)) throw e;
        await textNumber(phone, body);
        if (session?.user.id) {
          await logOutboundMessage({
            orgId: orgId ?? '',
            phone,
            text: body,
            userId: session.user.id,
            clientId: invoice?.client_id ?? null,
            clientName: name,
          });
        }
      }
    },
    onSuccess: async () => {
      markSent();
      // Open the in-app conversation thread so the invoice shows up there,
      // exactly like every other message in Lume.
      const phone = client?.phone;
      if (orgId && phone) {
        try {
          const cid = await findOrCreateConversation({
            orgId,
            phone,
            clientId: invoice?.client_id ?? null,
            clientName: client ? clientFullName(client) : null,
          });
          router.push(
            `/(app)/conversation/${cid}?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(
              client ? clientFullName(client) : '',
            )}&clientId=${encodeURIComponent(invoice?.client_id ?? '')}` as any,
          );
        } catch {
          // staying on the send screen (now marked Sent) is fine
        }
      }
    },
    onError: (e: Error) => Alert.alert('Envoyer par message', e.message),
  });

  const sendEmail = useMutation({
    mutationFn: async () => {
      if (!client?.email) throw new Error('This client has no email on file.');
      await sendInvoiceEmailViaServer({ invoiceId: String(id) });
    },
    onSuccess: markSent,
    onError: (e: Error) => Alert.alert('Envoyer par courriel', e.message),
  });

  // Collect the payment right now, in person, with the native Stripe sheet
  // (tap card / Apple Pay). The money goes to the company's connected account;
  // our platform fee is taken automatically. Needs Stripe Connect onboarding done.
  const collect = useMutation({
    mutationFn: () =>
      collectInvoicePayment({
        orgId: orgId ?? '',
        invoiceId: String(id),
        amountCents: amount,
        currency: invoice?.currency ?? 'CAD',
        companyName: company?.company_name ?? current?.companyName ?? null,
      }),
    onSuccess: (res) => {
      if (res.status === 'paid') {
        qc.invalidateQueries({ queryKey: ['invoices'] });
        qc.invalidateQueries({ queryKey: ['invoices', id] });
        qc.invalidateQueries({ queryKey: ['pay-link', id] });
        Alert.alert('Paiement reçu', 'Le paiement a été encaissé. ✅');
        setSent(true);
      } else if (res.status === 'not_ready') {
        Alert.alert(
          'Paiements pas encore actifs',
          "Termine d'abord la configuration Stripe (Plus → Paiements) pour pouvoir encaisser des cartes.",
        );
      } else if (res.status === 'error') {
        Alert.alert('Paiement', res.message);
      }
      // 'canceled' → silent
    },
    onError: (e: Error) => Alert.alert('Paiement', e.message),
  });

  const shareIt = async () => {
    try {
      await Share.share(payUrl ? { message: buildBody(), url: payUrl } : { message: buildBody() });
      markSent();
    } catch {
      // user cancelled
    }
  };

  const exportPdf = async () => {
    try {
      if (previewHtml) await shareHtmlAsPdf(previewHtml, `Facture-${invoice?.invoice_number ?? id}`);
    } catch (e) {
      Alert.alert('PDF', (e as Error).message);
    }
  };

  if (isLoading || !invoice) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <Text className="text-ink-muted">Chargement…</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface-alt">
      {/* Top: compact summary + send actions (Message first, then Email) */}
      <View className="gap-3 p-4">
        <View className="flex-row items-center justify-between rounded-2xl bg-white p-4">
          <View className="flex-1 pr-3">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">
              Facture {invoice.invoice_number ? `#${invoice.invoice_number}` : ''}
            </Text>
            <Text className="text-2xl font-bold text-ink">{formatCurrencyCents(amount, 'CAD')}</Text>
            <Text className="text-sm text-ink-muted" numberOfLines={1}>
              {client ? `${clientFullName(client)} · ` : ''}{client?.phone ?? client?.email ?? 'Aucun contact'}
            </Text>
          </View>
          {sent ? (
            <View className="items-center">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-status-completed">
                <SymbolView name="checkmark" tintColor="#FFFFFF" size={20} resizeMode="scaleAspectFit" />
              </View>
              <Text className="mt-1 text-xs font-semibold text-status-completed">Envoyée ✓</Text>
            </View>
          ) : null}
        </View>

        {!sent ? (
          <View className="gap-2">
            <Button
              title={`Encaisser ${formatCurrencyCents(amount, invoice.currency ?? 'CAD')}`}
              onPress={() => collect.mutate()}
              loading={collect.isPending}
              disabled={amount <= 0}
            />
            <Text className="text-center text-[11px] text-ink-subtle">
              Paiement par carte dans l'app · ou envoyez la facture ci-dessous
            </Text>
            <Button
              title={client?.phone ? 'Envoyer par message' : 'Pas de numéro — Partager'}
              variant="secondary"
              onPress={() => sendText.mutate()}
              loading={sendText.isPending}
              disabled={!client?.phone}
            />
            <Button
              title={client?.email ? 'Envoyer par courriel' : 'Pas de courriel'}
              variant="secondary"
              onPress={() => sendEmail.mutate()}
              loading={sendEmail.isPending}
              disabled={!client?.email}
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

      {/* Preview: the invoice itself, rendered in-app so it always shows —
          independent of Stripe / the web pay page. */}
      <View className="flex-1 border-t border-surface-border bg-white">
        <Text className="px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-ink-subtle">
          Aperçu de la facture
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
            <Text className="text-center text-sm text-ink-subtle">Préparation de l&apos;aperçu…</Text>
          </View>
        )}
      </View>
    </View>
  );
}
