import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Input } from '@/components/ui/Input';
import { LinkText } from '@/components/ui/LinkText';
import { textNumber } from '@/lib/contact';
import { listMessages, logOutboundMessage, markConversationRead, MessageRow } from '@/lib/api/messaging';
import { sendSmsViaServer, isSmsUnavailable } from '@/lib/api/server';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/usePermissions';

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Delivery status glyph for outbound messages (parity with the web thread). */
function StatusIcon({ status }: { status: string | null }) {
  switch (status) {
    case 'delivered':
      return <SymbolView name="checkmark.circle.fill" tintColor="#2563EB" size={11} resizeMode="scaleAspectFit" />;
    case 'sent':
      return <SymbolView name="checkmark" tintColor="#A3A3A3" size={10} resizeMode="scaleAspectFit" />;
    case 'failed':
      return <SymbolView name="exclamationmark.circle" tintColor="#DC2626" size={11} resizeMode="scaleAspectFit" />;
    case 'queued':
      return <SymbolView name="clock" tintColor="#A3A3A3" size={10} resizeMode="scaleAspectFit" />;
    default:
      return null;
  }
}

export default function Conversation() {
  const { t, language } = useTranslation();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { session } = useAuth();
  const { orgId } = usePermissions();
  const { id, phone, name, clientId } = useLocalSearchParams<{
    id: string;
    phone?: string;
    name?: string;
    clientId?: string;
  }>();

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  const { data: messages } = useQuery({
    queryKey: ['messages', id],
    queryFn: () => listMessages(String(id)),
    enabled: !!id,
    // Realtime below is the primary signal; this poll is just a safety net.
    refetchInterval: 30000,
  });

  // Live thread — new rows in THIS conversation appear instantly, and the
  // unread badge clears as they arrive since the thread is on screen.
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`conversation-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['messages', id] });
          markConversationRead(String(id))
            .then(() => qc.invalidateQueries({ queryKey: ['conversations'] }))
            .catch(() => {});
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, qc]);

  // Opening the thread clears its unread badge (here and on Home/Messages).
  useEffect(() => {
    if (!id) return;
    markConversationRead(String(id))
      .then(() => qc.invalidateQueries({ queryKey: ['conversations'] }))
      .catch(() => {});
  }, [id, qc]);

  const dateSeparator = (iso: string): string => {
    const d = new Date(iso);
    const today = new Date();
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000);
    if (diffDays === 0) return t.mobileMisc.msgToday;
    if (diffDays === 1) return t.mobileMisc.msgYesterday;
    return d.toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  };

  const send = async () => {
    const body = text.trim();
    if (!body || !phone) return;
    setSending(true);
    try {
      // Preferred path: send a real SMS from the org's own Twilio number through
      // the server, which also logs it to the thread. If the org hasn't set up a
      // number yet (or the server is unreachable), fall back to the device's
      // native composer and log the message ourselves.
      try {
        await sendSmsViaServer({
          phone: String(phone),
          text: body,
          clientId: clientId || null,
          clientName: name ? String(name) : null,
        });
      } catch (e) {
        if (!isSmsUnavailable(e)) throw e; // real error (opt-out, etc.) — surface it
        await textNumber(String(phone), body);
        if (orgId && session?.user.id) {
          await logOutboundMessage({
            orgId,
            phone: String(phone),
            text: body,
            userId: session.user.id,
            clientId: clientId || null,
            clientName: name ? String(name) : null,
          });
        }
      }
      setText('');
      qc.invalidateQueries({ queryKey: ['messages', id] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (e) {
      Alert.alert(t.mobileMisc.messageAlertTitle, (e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const rows = messages ?? [];

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-surface-alt"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        // Land on the newest messages when the thread opens, and keep pinned
        // to the bottom as messages arrive or are sent.
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item, index }: { item: MessageRow; index: number }) => {
          const out = item.direction === 'outbound';
          const prev = rows[index - 1];
          const showDate = !prev || new Date(prev.created_at).toDateString() !== new Date(item.created_at).toDateString();
          return (
            <>
              {showDate ? (
                <View className="my-1 items-center">
                  <View className="rounded-full border border-surface-border bg-white px-3 py-1">
                    <Text className="text-[11px] font-medium capitalize text-ink-muted">
                      {dateSeparator(item.created_at)}
                    </Text>
                  </View>
                </View>
              ) : null}
              <View className={`max-w-[80%] ${out ? 'self-end' : 'self-start'}`}>
                <View className={`rounded-2xl px-3.5 py-2.5 ${out ? 'bg-brand' : 'bg-white'}`}>
                  <LinkText
                    text={item.message_text}
                    className={out ? 'text-white' : 'text-ink'}
                    linkClassName={out ? 'underline text-white' : 'underline text-brand'}
                  />
                </View>
                <View className={`mt-0.5 flex-row items-center gap-1 ${out ? 'self-end' : 'self-start'}`}>
                  <Text className="text-[10px] text-ink-subtle">{fmtTime(item.created_at)}</Text>
                  {out ? <StatusIcon status={item.status} /> : null}
                </View>
              </View>
            </>
          );
        }}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-sm text-ink-muted">{t.mobileMisc.noMessagesInConversation}</Text>
          </View>
        }
      />

      <View
        className="flex-row items-end gap-2 border-t border-surface-border bg-white px-3 pt-2"
        style={{ paddingBottom: insets.bottom + 8 }}
      >
        <View className="flex-1">
          <Input value={text} onChangeText={setText} placeholder={t.mobileMisc.writeMessagePlaceholder} multiline />
        </View>
        <Pressable
          onPress={send}
          disabled={sending || !text.trim() || !phone}
          className={`mb-1 rounded-full px-4 py-2.5 ${sending || !text.trim() || !phone ? 'bg-surface-border' : 'bg-brand'}`}
        >
          <Text className="text-sm font-semibold text-white">{t.mobileMisc.send}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
