import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';

import { Input } from '@/components/ui/Input';
import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import { listClients } from '@/lib/api/clients';
import {
  ConversationRow,
  findOrCreateConversation,
  listConversations,
  logOutboundMessage,
  normalizePhone,
} from '@/lib/api/messaging';
import { isSmsUnavailable, sendSmsViaServer } from '@/lib/api/server';
import { textNumber } from '@/lib/contact';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/usePermissions';
import { usePlanFeature } from '@/lib/usePlanFeature';

export default function Messages() {
  const { t } = useTranslation();
  const { orgId } = usePermissions();
  const qc = useQueryClient();
  const hasSms = usePlanFeature('includes_sms').hasFeature;
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  // Render-pure clock for the relative timestamps; ticks every minute so
  // "now"/"3m" labels stay fresh without re-rendering on every paint.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(iv);
  }, []);

  const timeAgo = (iso: string | null): string => {
    if (!iso) return '';
    const diff = now - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return t.mobileMisc.timeNow;
    if (m < 60) return t.mobileMisc.timeMinutes.replace('{n}', String(m));
    const h = Math.floor(m / 60);
    if (h < 24) return t.mobileMisc.timeHours.replace('{n}', String(h));
    return t.mobileMisc.timeDays.replace('{n}', String(Math.floor(h / 24)));
  };

  const { data, isLoading } = useQuery({
    queryKey: ['conversations', orgId, q.trim()],
    queryFn: () => listConversations(orgId ?? '', q),
    enabled: !!orgId,
  });

  // Live updates — same Supabase Realtime wiring as the web Messages page:
  // incoming/outgoing messages and conversation changes refresh the list (and
  // any open thread) instantly instead of waiting for a poll.
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`messages-live-${orgId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `org_id=eq.${orgId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['conversations'] });
          qc.invalidateQueries({ queryKey: ['messages'] });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `org_id=eq.${orgId}` },
        () => qc.invalidateQueries({ queryKey: ['conversations'] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, qc]);

  const open = (c: ConversationRow) => {
    const name = c.client_name || c.phone_number;
    router.push(
      `/(app)/conversation/${c.id}?phone=${encodeURIComponent(c.phone_number)}&name=${encodeURIComponent(
        name,
      )}&clientId=${encodeURIComponent(c.client_id ?? '')}`,
    );
  };

  // SMS messaging is a paid feature (parity with the web `includes_sms` gate).
  if (!hasSms) return <Redirect href="/(app)/(tabs)/profile" />;

  return (
    <View className="flex-1 bg-surface-alt">
      <View className="flex-row items-center gap-2 px-5 pb-2 pt-3">
        <View className="flex-1">
          <Input
            value={q}
            onChangeText={setQ}
            placeholder={t.mobileMisc.searchClientOrConversation}
            autoCapitalize="none"
          />
        </View>
        {/* New conversation — parity with the web "+" button */}
        <Pressable
          onPress={() => setShowNew(true)}
          className="h-11 w-11 items-center justify-center rounded-2xl bg-ink active:opacity-80"
        >
          <SymbolView name="plus" tintColor="#FFFFFF" size={18} resizeMode="scaleAspectFit" />
        </Pressable>
      </View>

      <FlatList
        data={data ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        renderItem={({ item }) => {
          const name = item.client_name || item.phone_number;
          const unread = item.unread_count ?? 0;
          return (
            <Pressable
              onPress={() => open(item)}
              className="flex-row items-center gap-3 rounded-2xl bg-white p-3"
              style={{ shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}
            >
              <UnifiedAvatar id={item.client_id || item.id} name={name} size={44} />
              <View className="flex-1">
                <View className="flex-row items-center justify-between">
                  <Text className={`text-base ${unread > 0 ? 'font-bold' : 'font-semibold'} text-ink`} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text className="text-xs text-ink-muted">{timeAgo(item.last_message_at)}</Text>
                </View>
                <Text className={`text-sm ${unread > 0 ? 'text-ink' : 'text-ink-muted'}`} numberOfLines={1}>
                  {item.last_message_text || t.mobileMisc.noLastMessage}
                </Text>
              </View>
              {unread > 0 ? (
                <View
                  className="min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5"
                  style={{ backgroundColor: '#22C55E' }}
                >
                  <Text className="text-[11px] font-bold text-white">{unread}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          !isLoading ? (
            <View className="items-center py-16">
              <Text className="text-sm text-ink-muted">{t.mobileMisc.noConversations}</Text>
            </View>
          ) : null
        }
      />

      <NewMessageModal visible={showNew} onClose={() => setShowNew(false)} />
    </View>
  );
}

// ─── New conversation modal (port of the web NewConversationModal) ──────────

function NewMessageModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { orgId } = usePermissions();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [clientSearch, setClientSearch] = useState('');
  const [selected, setSelected] = useState<{ id: string; name: string; phone: string | null } | null>(null);
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const searchQ = useQuery({
    queryKey: ['client-search', clientSearch.trim()],
    queryFn: () => listClients(clientSearch, 8),
    enabled: visible && clientSearch.trim().length >= 2 && !selected,
  });

  const reset = () => {
    setClientSearch('');
    setSelected(null);
    setPhone('');
    setMessage('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const targetPhone = selected?.phone || phone;

  const handleSend = async () => {
    const body = message.trim();
    if (!body || !targetPhone.trim() || !orgId) return;
    setSending(true);
    try {
      // Same dual path as the thread: real SMS via the org's Twilio number
      // through the server (which also logs it), else the native composer +
      // manual log so the CRM thread stays truthful.
      try {
        await sendSmsViaServer({
          phone: targetPhone,
          text: body,
          clientId: selected?.id ?? null,
          clientName: selected?.name ?? null,
        });
      } catch (e) {
        if (!isSmsUnavailable(e)) throw e;
        await textNumber(targetPhone, body);
        if (session?.user.id) {
          await logOutboundMessage({
            orgId,
            phone: targetPhone,
            text: body,
            userId: session.user.id,
            clientId: selected?.id ?? null,
            clientName: selected?.name ?? null,
          });
        }
      }
      const conversationId = await findOrCreateConversation({
        orgId,
        phone: targetPhone,
        clientId: selected?.id ?? null,
        clientName: selected?.name ?? null,
      });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      const displayName = selected?.name || normalizePhone(targetPhone);
      close();
      router.push(
        `/(app)/conversation/${conversationId}?phone=${encodeURIComponent(normalizePhone(targetPhone))}&name=${encodeURIComponent(
          displayName,
        )}&clientId=${encodeURIComponent(selected?.id ?? '')}`,
      );
    } catch (e) {
      Alert.alert(t.mobileMisc.messageAlertTitle, (e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardAvoidingView className="flex-1 bg-surface-alt" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View className="flex-row items-center justify-between border-b border-surface-border bg-white px-5 py-4">
          <Text className="text-base font-bold text-ink">{t.mobileMisc.newMessage}</Text>
          <Pressable onPress={close} className="h-8 w-8 items-center justify-center rounded-full bg-surface-sunken active:opacity-70">
            <SymbolView name="xmark" tintColor="#525252" size={13} resizeMode="scaleAspectFit" />
          </Pressable>
        </View>

        <View className="flex-1 gap-4 p-5">
          {/* Client search */}
          <View className="gap-1.5">
            <Text className="text-xs font-semibold text-ink-muted">{t.mobileMisc.searchClientLabel}</Text>
            <Input
              value={clientSearch}
              onChangeText={(v) => {
                setClientSearch(v);
                setSelected(null);
              }}
              placeholder={t.mobileMisc.nameOrPhonePlaceholder}
              autoCapitalize="words"
            />
            {searchQ.data && searchQ.data.length > 0 && !selected ? (
              <View className="overflow-hidden rounded-2xl bg-white">
                {searchQ.data.map((c: any, i: number) => {
                  const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.company || '—';
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => {
                        setSelected({ id: c.id, name, phone: c.phone ?? null });
                        setPhone(c.phone ?? '');
                        setClientSearch(name);
                      }}
                      className={`flex-row items-center justify-between px-4 py-3 active:bg-surface-sunken ${i === 0 ? '' : 'border-t border-surface-border'}`}
                    >
                      <Text className="text-sm font-medium text-ink" numberOfLines={1}>
                        {name}
                      </Text>
                      <Text className="text-xs text-ink-subtle">{c.phone || '—'}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>

          {/* Phone number (manual, or missing on the selected client) */}
          {!selected?.phone ? (
            <View className="gap-1.5">
              <Text className="text-xs font-semibold text-ink-muted">{t.mobileMisc.phoneNumberLabel}</Text>
              <Input value={phone} onChangeText={setPhone} placeholder="+1 (514) 123-4567" keyboardType="phone-pad" />
            </View>
          ) : null}

          {/* Message */}
          <View className="gap-1.5">
            <Text className="text-xs font-semibold text-ink-muted">{t.mobileMisc.messageAlertTitle}</Text>
            <Input
              value={message}
              onChangeText={setMessage}
              placeholder={t.mobileMisc.writeMessagePlaceholder}
              multiline
            />
          </View>

          <Pressable
            onPress={handleSend}
            disabled={sending || !message.trim() || !targetPhone.trim()}
            className={`mt-1 flex-row items-center justify-center gap-2 rounded-2xl py-3.5 ${
              sending || !message.trim() || !targetPhone.trim() ? 'bg-surface-border' : 'bg-ink'
            }`}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <SymbolView name="paperplane.fill" tintColor="#FFFFFF" size={14} resizeMode="scaleAspectFit" />
            )}
            <Text className="text-sm font-semibold text-white">{t.mobileMisc.send}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
