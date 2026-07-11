import type { SupabaseClient } from '@supabase/supabase-js';

// Server-side Expo push delivery. The mobile app registers device tokens in
// `push_tokens` (org-scoped), but until now nothing on the server delivered a
// push when a notification was created — tokens were collected and never used.
// This posts to Expo's public push endpoint. Fire-and-forget by design: a push
// failure must never break the action that triggered the notification.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_MAX_PER_REQUEST = 100; // Expo accepts up to 100 messages per call.

export interface PushPayload {
  title: string;
  body: string;
  /** Optional data delivered to the app (e.g. { type, referenceId }) for deep-linking. */
  data?: Record<string, unknown>;
}

/**
 * Send an Expo push to every device registered for an org. Never throws.
 * Pass the service-role client so the `push_tokens` read bypasses RLS.
 */
export async function sendExpoPushToOrg(
  supabase: SupabaseClient,
  orgId: string,
  payload: PushPayload,
): Promise<void> {
  try {
    const { data: rows, error } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('org_id', orgId);
    if (error) {
      console.error('[push] token lookup failed:', error.message);
      return;
    }

    // De-dupe and keep only Expo tokens (the client may fall back to a raw
    // APNs/FCM token, which this endpoint can't deliver).
    const tokens = Array.from(
      new Set((rows ?? []).map((r: any) => r.token).filter((t: unknown): t is string => typeof t === 'string')),
    ).filter((t) => t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'));
    if (tokens.length === 0) return;

    for (let i = 0; i < tokens.length; i += EXPO_MAX_PER_REQUEST) {
      const messages = tokens.slice(i, i + EXPO_MAX_PER_REQUEST).map((to) => ({
        to,
        title: payload.title,
        body: payload.body,
        sound: 'default',
        ...(payload.data ? { data: payload.data } : {}),
      }));
      try {
        await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(messages),
        });
      } catch (err: any) {
        console.error('[push] Expo send failed:', err?.message);
      }
    }
  } catch (err: any) {
    console.error('[push] sendExpoPushToOrg failed:', err?.message);
  }
}
