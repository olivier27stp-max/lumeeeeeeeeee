import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { usePermissions } from '@/lib/usePermissions';

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function Conversation() {
  const { t } = useTranslation();
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
    refetchInterval: 15000,
  });

  // Opening the thread clears its unread badge (here and on Home/Messages).
  useEffect(() => {
    if (!id) return;
    markConversationRead(String(id))
      .then(() => qc.invalidateQueries({ queryKey: ['conversations'] }))
      .catch(() => {});
  }, [id]);

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

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-surface-alt"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={listRef}
        data={messages ?? []}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        // Land on the newest messages when the thread opens, and keep pinned
        // to the bottom as messages arrive or are sent.
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }: { item: MessageRow }) => {
          const out = item.direction === 'outbound';
          return (
            <View className={`max-w-[80%] ${out ? 'self-end' : 'self-start'}`}>
              <View className={`rounded-2xl px-3.5 py-2.5 ${out ? 'bg-brand' : 'bg-white'}`}>
                <LinkText
                  text={item.message_text}
                  className={out ? 'text-white' : 'text-ink'}
                  linkClassName={out ? 'underline text-white' : 'underline text-brand'}
                />
              </View>
              <Text className={`mt-0.5 text-[10px] text-ink-subtle ${out ? 'text-right' : 'text-left'}`}>
                {fmtTime(item.created_at)}
              </Text>
            </View>
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
