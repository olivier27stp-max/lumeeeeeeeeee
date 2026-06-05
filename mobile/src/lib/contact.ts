// Native contact actions (call / SMS / "on my way"). Sending real CRM-logged
// SMS requires the web backend (Twilio + A2P compliance), so on mobile we use
// the device's native dialer/SMS composer — the text comes from the tech's
// phone, Jobber-style, with zero backend dependency.

import * as SMS from 'expo-sms';
import { Linking, Platform } from 'react-native';

export function callNumber(phone: string): void {
  const tel = phone.replace(/[^+\d]/g, '');
  Linking.openURL(`tel:${tel}`);
}

/** Open the native SMS composer prefilled with `body` (sent from the tech's number). */
export async function textNumber(phone: string, body?: string): Promise<void> {
  const num = phone.replace(/[^+\d]/g, '');
  const available = await SMS.isAvailableAsync().catch(() => false);
  if (available) {
    await SMS.sendSMSAsync([num], body ?? '');
    return;
  }
  // Fallback to sms: URL (separator differs by platform).
  const sep = Platform.OS === 'ios' ? '&' : '?';
  const url = body ? `sms:${num}${sep}body=${encodeURIComponent(body)}` : `sms:${num}`;
  await Linking.openURL(url);
}

/** Compose an "on my way" text to the client. */
export async function sendOnMyWay(params: {
  phone: string;
  companyName?: string | null;
  etaMinutes?: number | null;
}): Promise<void> {
  const { phone, companyName, etaMinutes } = params;
  const who = companyName ? ` from ${companyName}` : '';
  const eta = etaMinutes ? ` I should arrive in about ${etaMinutes} minutes.` : '';
  const body = `Hi! This is your technician${who}. I'm on my way to your appointment.${eta}`;
  await textNumber(phone, body);
}
