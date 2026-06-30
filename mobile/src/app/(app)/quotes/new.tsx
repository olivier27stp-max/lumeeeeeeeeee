import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ClientPicker, PickedClient } from '@/components/ClientPicker';
import { LineItemsEditor } from '@/components/LineItemsEditor';
import { createQuote, markQuoteSent, quoteShareLink, LineItemInput } from '@/lib/api/billing';
import { getClient } from '@/lib/api/clients';
import { getCompany } from '@/lib/api/org';
import { findOrCreateConversation } from '@/lib/api/messaging';
import { sendEmail } from '@/lib/email';
import { htmlToPdf, shareHtmlAsPdf } from '@/lib/pdf';
import { sendSmsViaServer } from '@/lib/api/server';
import { depositNote, deviceLanguage, packTemplate, quoteNiceMessage, unpackTemplate } from '@/lib/contact';
import { formatCurrencyCents } from '@/lib/format';
import { buildQuotePreviewHtml } from '@/lib/invoicePreview';
import { useAuth } from '@/lib/auth';
import { useMembership } from '@/lib/membership-context';
import { usePermissions } from '@/lib/usePermissions';

const DEFAULT_TAX = '14.975';

function SectionLabel({ children }: { children: string }) {
  return <Text className="px-1 text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{children}</Text>;
}

export default function NewQuote() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const { current } = useMembership();
  const { orgId, can, canSeePricing } = usePermissions();

  // After a quote is created, offer to text the client the accept link (Twilio).
  const lang = deviceLanguage();
  const quoteKey = `lume_quote_tmpl_${session?.user.id ?? ''}`;
  const [showSend, setShowSend] = useState(false);
  const [sentQuote, setSentQuote] = useState<{ id: string; viewToken: string | null } | null>(null);
  const [quoteNice, setQuoteNice] = useState('');
  const [sendingQuote, setSendingQuote] = useState(false);

  const prefill = useLocalSearchParams<{ title?: string }>();
  const [client, setClient] = useState<PickedClient | null>(null);
  const [title, setTitle] = useState(typeof prefill.title === 'string' ? prefill.title : '');
  const [validDays, setValidDays] = useState('30');
  const [items, setItems] = useState<LineItemInput[]>([]);
  const [taxRate, setTaxRate] = useState(DEFAULT_TAX);
  const [discountOn, setDiscountOn] = useState(false);
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [depositOn, setDepositOn] = useState(false);
  const [depositType, setDepositType] = useState<'percentage' | 'fixed'>('percentage');
  const [depositValue, setDepositValue] = useState('');
  const [notes, setNotes] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  // Company brand (logo + name) — set in the desktop company settings, read from
  // the same company_settings row so it shows up here automatically.
  const { data: company } = useQuery({
    queryKey: ['company', orgId],
    queryFn: () => getCompany(String(orgId)),
    enabled: !!orgId,
  });

  const totals = useMemo(() => {
    const subtotal = items.reduce((s, i) => s + Math.round(i.qty * i.unit_price_cents), 0);
    let discount = 0;
    if (discountOn) {
      discount = discountType === 'percentage'
        ? Math.round((subtotal * (parseFloat(discountValue) || 0)) / 100)
        : Math.round((parseFloat(discountValue) || 0) * 100);
    }
    discount = Math.min(discount, subtotal);
    const tax = Math.round(((subtotal - discount) * (parseFloat(taxRate) || 0)) / 100);
    return { subtotal, discount, tax, total: subtotal - discount + tax };
  }, [items, taxRate, discountOn, discountType, discountValue]);

  const saveMut = useMutation({
    mutationFn: () =>
      createQuote({
        orgId: orgId ?? '',
        clientId: client!.id,
        userId: session?.user.id ?? '',
        title: title.trim() || `Quote for ${client!.name}`,
        items,
        taxRatePct: parseFloat(taxRate) || 0,
        validDays: parseInt(validDays, 10) || 30,
        discountType: discountOn ? discountType : null,
        discountValue: discountOn ? parseFloat(discountValue) || 0 : 0,
        notes: notes.trim() || null,
        depositRequired: depositOn,
        depositType: depositOn ? depositType : null,
        depositValue: depositOn ? parseFloat(depositValue) || 0 : 0,
      }),
    onSuccess: async (quote) => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      setSentQuote(quote);
      const saved = await AsyncStorage.getItem(quoteKey).catch(() => null);
      setQuoteNice(
        unpackTemplate(saved, current?.companyName, lang) ??
          quoteNiceMessage(current?.companyName, client?.name ?? null, lang),
      );
      setShowSend(true);
    },
    onError: (e: Error) => Alert.alert('Impossible de créer la soumission', e.message),
  });

  // Deposit amount (cents) from the form, for the message note.
  const depositCents = depositOn
    ? depositType === 'percentage'
      ? Math.round((totals.total * (parseFloat(depositValue) || 0)) / 100)
      : Math.round((parseFloat(depositValue) || 0) * 100)
    : 0;

  // In-app quote preview (logo + name + items + totals), built live from the
  // form — shows exactly what the quote will look like before sending.
  const validUntilPreview = useMemo(() => {
    const days = parseInt(validDays, 10) || 30;
    return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  }, [validDays]);
  const previewHtml = useMemo(
    () =>
      buildQuotePreviewHtml({
        company: company ?? null,
        companyName: company?.company_name ?? current?.companyName ?? null,
        companyLogoUrl: company?.logo_url ?? null,
        title: title.trim() || null,
        validUntil: validUntilPreview,
        clientName: client?.name ?? null,
        items,
        subtotalCents: totals.subtotal,
        discountCents: totals.discount,
        taxCents: totals.tax,
        totalCents: totals.total,
        depositCents,
        currency: 'CAD',
      }),
    [company?.company_name, company?.logo_url, current?.companyName, title, validUntilPreview, client?.name, items, totals, depositCents],
  );

  // The full message: nice greeting + accept link + (optional) deposit note.
  const quoteBody = () => {
    const link = sentQuote?.viewToken ? quoteShareLink(sentQuote.viewToken) : '';
    const dep = depositOn && depositCents > 0 ? depositNote(formatCurrencyCents(depositCents, 'CAD'), lang) : '';
    return `${quoteNice.trim()}\n${link}${dep}`;
  };

  const goBack = () => {
    setShowSend(false);
    router.back();
  };

  // Text the client the accept link via Twilio, mark the quote sent, open thread.
  const sendQuote = async () => {
    if (!orgId || !client?.id || !sentQuote) return;
    if (!sentQuote.viewToken) {
      Alert.alert('Soumission', "Impossible de générer le lien (view_token manquant).");
      return;
    }
    setSendingQuote(true);
    try {
      const full = await getClient(client.id);
      const phone = full?.phone ?? null;
      if (!phone) {
        Alert.alert('Soumission', "Ce client n'a pas de numéro de téléphone.");
        setSendingQuote(false);
        return;
      }
      await sendSmsViaServer({ phone, text: quoteBody(), clientId: client.id, clientName: client.name });
      await markQuoteSent(sentQuote.id);
      AsyncStorage.setItem(quoteKey, packTemplate(quoteNice.trim(), current?.companyName)).catch(() => {});
      qc.invalidateQueries({ queryKey: ['quotes'] });
      const cid = await findOrCreateConversation({ orgId, phone, clientId: client.id, clientName: client.name });
      setShowSend(false);
      router.replace(
        `/(app)/conversation/${cid}?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(client.name)}&clientId=${encodeURIComponent(client.id)}` as any,
      );
    } catch (e) {
      Alert.alert('Soumission', (e as Error).message);
    } finally {
      setSendingQuote(false);
    }
  };

  // Email the quote (with the PDF attached) via the native composer — the server
  // can't email mobile quotes, so this is the mobile path. Falls back to mailto.
  const emailQuote = async () => {
    if (!sentQuote) return;
    setSendingQuote(true);
    try {
      const full = client?.id ? await getClient(client.id) : null;
      let attachments: string[] | undefined;
      try {
        attachments = previewHtml ? [await htmlToPdf(previewHtml, `Soumission-${sentQuote.id}`)] : undefined;
      } catch {
        attachments = undefined;
      }
      const res = await sendEmail({
        to: full?.email ?? null,
        subject: `Soumission — ${company?.company_name ?? current?.companyName ?? 'Lume'}`,
        body: quoteBody(),
        attachments,
      });
      if (res === 'unavailable') {
        Alert.alert('Courriel', 'Aucune app de courriel configurée sur cet appareil.');
        return;
      }
      await markQuoteSent(sentQuote.id);
      qc.invalidateQueries({ queryKey: ['quotes'] });
      setShowSend(false);
      router.replace('/(app)/(tabs)');
    } catch (e) {
      Alert.alert('Courriel', (e as Error).message);
    } finally {
      setSendingQuote(false);
    }
  };

  const pdfQuote = async () => {
    try {
      if (previewHtml) await shareHtmlAsPdf(previewHtml, `Soumission-${sentQuote?.id ?? 'devis'}`);
    } catch (e) {
      Alert.alert('PDF', (e as Error).message);
    }
  };

  if (!(can('quotes.create') || canSeePricing)) return <Redirect href="/(app)/(tabs)" />;

  return (
    <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 20, gap: 14 }}>
      <View className="gap-2">
        <SectionLabel>Client</SectionLabel>
        <ClientPicker value={client} onChange={setClient} />
      </View>

      <View className="flex-row gap-3">
        <View className="flex-1"><Input label="Titre" value={title} onChangeText={setTitle} placeholder="Remplacement climatisation" /></View>
        <View className="w-28"><Input label="Validité (jours)" value={validDays} onChangeText={setValidDays} keyboardType="number-pad" /></View>
      </View>

      <LineItemsEditor onChange={setItems} />

      {/* Discount */}
      <Pressable onPress={() => setDiscountOn((d) => !d)} className="flex-row items-center justify-between rounded-2xl bg-white px-4 py-3">
        <Text className="text-sm text-ink">Ajouter un rabais</Text>
        <Text className="text-lg">{discountOn ? '☑️' : '⬜️'}</Text>
      </Pressable>
      {discountOn ? (
        <View className="flex-row gap-2">
          <View className="flex-row rounded-2xl bg-surface-sunken p-1">
            {(['percentage', 'fixed'] as const).map((t) => (
              <Pressable key={t} onPress={() => setDiscountType(t)} className={`items-center rounded-xl px-4 py-2 ${discountType === t ? 'bg-white' : ''}`}>
                <Text className={`text-sm font-semibold ${discountType === t ? 'text-ink' : 'text-ink-muted'}`}>{t === 'percentage' ? '%' : '$'}</Text>
              </Pressable>
            ))}
          </View>
          <View className="flex-1"><Input label="Rabais" value={discountValue} onChangeText={setDiscountValue} keyboardType="decimal-pad" /></View>
        </View>
      ) : null}

      <Input label="Taux de taxe (%)" value={taxRate} onChangeText={setTaxRate} keyboardType="decimal-pad" placeholder={DEFAULT_TAX} />

      {/* Deposit */}
      <Pressable onPress={() => setDepositOn((d) => !d)} className="flex-row items-center justify-between rounded-2xl bg-white px-4 py-3">
        <Text className="text-sm text-ink">Exiger un dépôt</Text>
        <Text className="text-lg">{depositOn ? '☑️' : '⬜️'}</Text>
      </Pressable>
      {depositOn ? (
        <View className="flex-row gap-2">
          <View className="flex-row rounded-2xl bg-surface-sunken p-1">
            {(['percentage', 'fixed'] as const).map((t) => (
              <Pressable key={t} onPress={() => setDepositType(t)} className={`items-center rounded-xl px-4 py-2 ${depositType === t ? 'bg-white' : ''}`}>
                <Text className={`text-sm font-semibold ${depositType === t ? 'text-ink' : 'text-ink-muted'}`}>{t === 'percentage' ? '%' : '$'}</Text>
              </Pressable>
            ))}
          </View>
          <View className="flex-1"><Input label="Dépôt" value={depositValue} onChangeText={setDepositValue} keyboardType="decimal-pad" /></View>
        </View>
      ) : null}

      <Input label="Notes (visibles au client)" value={notes} onChangeText={setNotes} multiline numberOfLines={3} style={{ height: 80, textAlignVertical: 'top', paddingTop: 12 }} />

      {/* Totals */}
      <View className="gap-1 rounded-2xl bg-white p-4">
        <Row label="Sous-total" value={formatCurrencyCents(totals.subtotal, 'CAD')} />
        {totals.discount > 0 ? <Row label="Rabais" value={`- ${formatCurrencyCents(totals.discount, 'CAD')}`} /> : null}
        <Row label="Taxe" value={formatCurrencyCents(totals.tax, 'CAD')} />
        <Row label="Total" value={formatCurrencyCents(totals.total, 'CAD')} bold />
      </View>

      <Button
        title="Aperçu"
        variant="secondary"
        onPress={() => setShowPreview(true)}
        disabled={items.length === 0}
      />
      <Button title="Créer la soumission" onPress={() => saveMut.mutate()} loading={saveMut.isPending} disabled={!client || items.length === 0 || !orgId} />

      {/* Full-screen in-app preview of the quote (logo + name + items + totals). */}
      <Modal visible={showPreview} animationType="slide" onRequestClose={() => setShowPreview(false)}>
        <View className="flex-1 bg-surface-alt">
          <View className="flex-row items-center justify-between border-b border-surface-border bg-white px-4 py-3">
            <Text className="text-base font-bold text-ink">Aperçu de la soumission</Text>
            <Pressable onPress={() => setShowPreview(false)} hitSlop={10}>
              <Text className="text-sm font-semibold text-brand">Fermer</Text>
            </Pressable>
          </View>
          <WebView
            originWhitelist={['*']}
            source={{ html: previewHtml }}
            startInLoadingState
            style={{ flex: 1, backgroundColor: '#FFFFFF' }}
          />
        </View>
      </Modal>

      {/* Send-quote popup — texts the client the public accept link via Twilio. */}
      <Modal visible={showSend} transparent animationType="fade" onRequestClose={goBack}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-end bg-black/40"
        >
          <Pressable className="absolute inset-0" onPress={() => Keyboard.dismiss()} />
          <View className="rounded-t-3xl bg-white p-5 gap-4" style={{ paddingBottom: 28 }}>
            <View className="gap-0.5">
              <Text className="text-lg font-bold text-ink">Envoyer la soumission 📄</Text>
              <Text className="text-xs text-ink-muted">
                Le client reçoit le lien pour la consulter, l&apos;accepter et signer
                {depositOn && depositCents > 0 ? ' (avec le dépôt)' : ''}.
              </Text>
            </View>

            <View className="gap-1.5">
              <Text className="text-xs uppercase text-ink-muted">Message</Text>
              <TextInput
                value={quoteNice}
                onChangeText={setQuoteNice}
                multiline
                scrollEnabled
                textAlignVertical="top"
                placeholderTextColor="#A3A3A3"
                style={{
                  height: 120,
                  borderWidth: 1,
                  borderColor: '#E5E5E5',
                  borderRadius: 12,
                  backgroundColor: '#F5F5F5',
                  paddingHorizontal: 14,
                  paddingTop: 12,
                  paddingBottom: 12,
                  fontSize: 16,
                  lineHeight: 22,
                  color: '#171717',
                }}
              />
              <Text className="text-xs italic text-ink-subtle">
                + le lien d&apos;acceptation{depositOn && depositCents > 0 ? ` + dépôt de ${formatCurrencyCents(depositCents, 'CAD')}` : ''} (ajoutés automatiquement)
              </Text>
            </View>

            <View className="flex-row gap-2 pt-1">
              <View className="flex-1">
                <Button title="Passer" variant="secondary" onPress={goBack} disabled={sendingQuote} />
              </View>
              <View className="flex-1">
                <Button title="Envoyer" onPress={sendQuote} loading={sendingQuote} />
              </View>
            </View>
            <View className="flex-row items-center justify-center gap-4 pt-2">
              <Pressable onPress={emailQuote} disabled={sendingQuote}>
                <Text className="text-sm text-brand">Courriel…</Text>
              </Pressable>
              <Text className="text-ink-subtle">·</Text>
              <Pressable onPress={pdfQuote}>
                <Text className="text-sm text-brand">PDF…</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View className="flex-row justify-between">
      <Text className={bold ? 'text-base font-bold text-ink' : 'text-sm text-ink-muted'}>{label}</Text>
      <Text className={bold ? 'text-base font-bold text-ink' : 'text-sm text-ink'}>{value}</Text>
    </View>
  );
}
