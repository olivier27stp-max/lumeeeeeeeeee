// Push notifications — full wiring. Registers the device with Expo Push and
// stores the token in push_tokens; the server/Supabase sends via that token.
//
// iOS REALITY: remote push requires a PAID Apple Developer account (APNs key).
// On a free account, token registration fails — handled gracefully (no crash),
// and everything lights up once the paid account + APNs key + EAS projectId are
// in place. Local notifications (scheduleNotificationAsync) work regardless.

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '../supabase';

// Show alerts even when the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function savePushToken(input: {
  orgId: string;
  userId: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
}): Promise<void> {
  const { error } = await supabase.from('push_tokens').upsert(
    {
      org_id: input.orgId,
      user_id: input.userId,
      token: input.token,
      platform: input.platform,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,token' },
  );
  if (error) throw new Error(error.message);
}

/**
 * Send a push to one or more teammates by user id. Looks up their stored Expo
 * push tokens (org-scoped, RLS-gated) and posts to Expo's public push endpoint —
 * no server round-trip needed. Best-effort: never throws, so a failed/undelivered
 * push (e.g. no APNs key yet on a free Apple account) never blocks the action.
 */
export async function sendPushToUsers(
  orgId: string,
  userIds: string[],
  message: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  try {
    const ids = Array.from(new Set(userIds.filter(Boolean)));
    if (!orgId || ids.length === 0) return;

    const { data } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('org_id', orgId)
      .in('user_id', ids);

    const tokens = (data ?? []).map((r: any) => r.token).filter(Boolean);
    if (tokens.length === 0) return;

    const messages = tokens.map((to: string) => ({
      to,
      title: message.title,
      body: message.body,
      data: message.data ?? {},
      sound: 'default',
    }));

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch {
    // Never let a failed push break the calling action.
  }
}

/**
 * Ask permission, get the Expo push token, and store it. Safe to call on every
 * app start — no-ops on simulators/free accounts. Never throws.
 */
export async function registerForPush(orgId: string, userId: string): Promise<void> {
  try {
    if (!Device.isDevice || !orgId || !userId) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Notifications',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return;

    // projectId is required by getExpoPushTokenAsync on SDK 48+. Local builds
    // have none → fall back to the raw device (APNs/FCM) token.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;

    let token: string | null = null;
    try {
      if (projectId) {
        token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      } else {
        token = (await Notifications.getDevicePushTokenAsync()).data as string;
      }
    } catch {
      // No APNs entitlement (free account) / not provisioned — nothing to store yet.
      return;
    }

    if (token) {
      await savePushToken({ orgId, userId, token, platform: Platform.OS as 'ios' | 'android' });
    }
  } catch {
    // Never let push setup break the app.
  }
}
