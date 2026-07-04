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
import { useTranslation } from '@/lib/i18n';

export default function SendInvoice() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { t } = useTranslation();
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
    const who = client ? clientFullName(client) : 'bonjour';
    const amt = formatCurrencyCents(amount, 'CAD');
    const link = payUrl ? `\n\nConsultez-la et payez ici : ${payUrl}` : '';
    return `Bonjour ${who}, voici votre facture ${invoice?.invoice_number ? `#${invoice.invoice_number}` : ''} de ${amt}.${link}`;
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
    onError: (e: Error) => Alert.alert(t.mobileBilling.sendByMessage, e.message),
  });

  const sendEmail = useMutation({
    mutationFn: async () => {
      if (!client?.email) throw new Error('This client has no email on file.');
      await sendInvoiceEmailViaServer({ invoiceId: String(id) });
    },
    onSuccess: markSent,
    onError: (e: Error) => Alert.alert(t.mobileBilling.sendByEmail, e.message),
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
        Alert.alert(t.mobileBilling.paymentReceived, t.mobileBilling.paymentReceivedMsg);
        setSent(true);
      } else if (res.status === 'not_ready') {
        Alert.alert(
          t.mobileBilling.paymentsNotActive,
          t.mobileBilling.paymentsNotActiveMsg,
        );
      } else if (res.status === 'error') {
        Alert.alert(t.mobileBilling.payment, res.message);
      }
      // 'canceled' → silent
    },
    onError: (e: Error) => Alert.alert(t.mobileBilling.payment, e.message),
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
      Alert.alert(t.mobileBilling.pdf, (e as Error).message);
    }
  };

  if (isLoading || !invoice) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <Text className="text-ink-muted">{t.mobileBilling.loading}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface-alt">
      {/* Header — like the web invoice modal: title + invoice no. + status. */}
      <View className="flex-row items-center justify-between border-b border-surface-border bg-white px-4 py-3">
        <View className="flex-1 pr-3">
          <Text className="text-base font-bold text-ink">{t.mobileBilling.invoicePreviewTitle}</Text>
          <Text className="text-xs text-ink-muted" numberOfLines={1}>
            {t.mobileBilling.invoiceLineSummary
              .replace('{number}', invoice.invoice_number ? `#${invoice.invoice_number}` : '')
              .replace('{amount}', formatCurrencyCents(amount, 'CAD'))}
            {client ? ` · ${clientFullName(client)}` : ''}
          </Text>
        </View>
        {sent ? (
          <View className="flex-row items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1">
            <SymbolView name="checkmark.circle.fill" tintColor="#16A34A" size={13} resizeMode="scaleAspectFit" />
            <Text className="text-xs font-semibold text-emerald-700">{t.mobileBilling.sent}</Text>
          </View>
        ) : null}
      </View>

      {/* The invoice itself — the document (Business Pro), on a gray backdrop so it
          reads like a sheet of paper, exactly like the web preview. */}
      <View className="flex-1" style={{ backgroundColor: '#f1f5f9' }}>
        {previewHtml ? (
          <WebView
            originWhitelist={['*']}
            source={{ html: previewHtml }}
            startInLoadingState
            style={{ flex: 1, backgroundColor: '#f1f5f9' }}
          />
        ) : (
          <View className="flex-1 items-center justify-center p-6">
            <Text className="text-center text-sm text-ink-subtle">{t.mobileBilling.preparingPreview}</Text>
          </View>
        )}
      </View>

      {/* Options d'envoi — clean panel at the bottom (the web modal's sidebar). */}
      <View className="gap-2 border-t border-surface-border bg-white px-4 pb-7 pt-3">
        {!sent ? (
          <>
            <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">
              {t.mobileBilling.sendOptions}
            </Text>
            <Button
              title={t.mobileBilling.collect.replace('{amount}', formatCurrencyCents(amount, invoice.currency ?? 'CAD'))}
              onPress={() => collect.mutate()}
              loading={collect.isPending}
              disabled={amount <= 0}
            />
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button
                  title={client?.phone ? t.mobileBilling.message : t.mobileBilling.share}
                  variant="secondary"
                  onPress={() => sendText.mutate()}
                  loading={sendText.isPending}
                  disabled={!client?.phone}
                />
              </View>
              <View className="flex-1">
                <Button
                  title={t.mobileBilling.email}
                  variant="secondary"
                  onPress={() => sendEmail.mutate()}
                  loading={sendEmail.isPending}
                  disabled={!client?.email}
                />
              </View>
            </View>
          </>
        ) : (
          <Button title={t.mobileBilling.done} onPress={() => router.replace('/(app)/(tabs)')} />
        )}
      </View>
    </View>
  );
}
