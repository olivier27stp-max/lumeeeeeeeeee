// Native contact actions (call / SMS / "on my way"). Sending real CRM-logged
// SMS requires the web backend (Twilio + A2P compliance), so on mobile we use
// the device's native dialer/SMS composer — the text comes from the tech's
// phone, Jobber-style, with zero backend dependency.

import * as SMS from 'expo-sms';
import { Alert, Linking, Platform } from 'react-native';

export function callNumber(phone: string): void {
  const tel = phone.replace(/[^+\d]/g, '');
  Linking.openURL(`tel:${tel}`);
}

/**
 * Show a pop-up with the client's phone number, then call on confirm.
 * Used on the home job card so a tap surfaces the number before dialing.
 */
export function promptCall(name: string | null | undefined, phone: string): void {
  Alert.alert(name?.trim() || 'Client', phone, [
    { text: 'Appeler', onPress: () => callNumber(phone) },
    { text: 'Annuler', style: 'cancel' },
  ]);
}

/**
 * Open turn-by-turn driving directions in the platform's default maps app
 * (Apple Maps on iOS, Google Maps on Android). Falls back to the address
 * string when coordinates are unavailable.
 */
export function openDirections(dest: {
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
}): void {
  const hasCoords = dest.latitude != null && dest.longitude != null;
  const target = hasCoords
    ? `${dest.latitude},${dest.longitude}`
    : encodeURIComponent(dest.address ?? '');
  if (!target) return;
  const url =
    Platform.OS === 'ios'
      ? `https://maps.apple.com/?daddr=${target}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${target}`;
  Linking.openURL(url);
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

/** The device's language (fr/en), used so the client text goes out in the right
 * language. The web stores its language in localStorage (unreadable from mobile),
 * so we follow the phone's locale — the practical equivalent for the same user. */
export function deviceLanguage(): 'fr' | 'en' {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale || '';
    return loc.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  } catch {
    return 'en';
  }
}

/** The editable greeting part (the bit a user customizes + we persist). The
 * company name is pulled from the org so a real company shows up automatically. */
export function onMyWayGreeting(companyName?: string | null, lang: 'fr' | 'en' = 'en'): string {
  if (lang === 'fr') {
    const who = companyName ? ` de ${companyName}` : '';
    return `Bonjour! C'est votre technicien${who}. Je suis en route vers votre rendez-vous.`;
  }
  const who = companyName ? ` from ${companyName}` : '';
  return `Hi! This is your technician${who}. I'm on my way to your appointment.`;
}

/** The dynamic ETA sentence — the ONE part that changes per send (the minutes). */
export function etaSentence(etaMinutes?: number | null, lang: 'fr' | 'en' = 'en'): string {
  if (!etaMinutes) return '';
  return lang === 'fr'
    ? ` Je devrais arriver dans environ ${etaMinutes} minutes.`
    : ` I should arrive in about ${etaMinutes} minutes.`;
}

/** The full "on my way" body = greeting + ETA (exported so callers can log it). */
export function onMyWayMessage(
  companyName?: string | null,
  etaMinutes?: number | null,
  lang: 'fr' | 'en' = 'en',
): string {
  return onMyWayGreeting(companyName, lang) + etaSentence(etaMinutes, lang);
}

// Saved message templates must NOT freeze the company name — otherwise renaming
// the company later still texts the old name. Same for the CLIENT name: the
// default greetings say « Bonjour {client}! », so a saved template would greet
// every future client with the first client's name. We persist the text
// together with the company AND client names in effect at save time (JSON),
// then swap both for the LIVE values when loading. Legacy saves that predate a
// token (name baked in, unknown) can't be migrated → the caller regenerates
// the default instead.

/** Serialize a template for storage: the edited text + company/client at save time. */
export function packTemplate(text: string, companyName?: string | null, clientName?: string | null): string {
  const o: Record<string, string> = { text, company: (companyName ?? '').trim() };
  if (clientName !== undefined) o.client = (clientName ?? '').trim();
  return JSON.stringify(o);
}

/**
 * Load a stored template with the LIVE company (and, for client-aware callers,
 * client) name swapped in for the ones in effect when it was saved. Returns
 * null for legacy/invalid data so the caller falls back to a freshly-generated
 * default (with the current names).
 */
export function unpackTemplate(
  raw: string | null | undefined,
  companyName?: string | null,
  lang: 'fr' | 'en' = 'en',
  clientName?: string | null,
): string | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && typeof o.text === 'string') {
      // Client-aware caller + save made before client tokenization: the old
      // client's name is baked in and unknown → regenerate the default.
      if (clientName !== undefined && typeof o.client !== 'string') return null;
      const live = companyName?.trim() || (lang === 'fr' ? 'nous' : 'us');
      const old = (o.company ?? '').trim();
      let out: string = old && old !== live ? o.text.split(old).join(live) : o.text;
      if (clientName !== undefined) {
        const oldClient = (o.client ?? '').trim();
        const liveClient = (clientName ?? '').trim();
        if (oldClient && oldClient !== liveClient) {
          out = out.split(` ${oldClient}`).join(liveClient ? ` ${liveClient}` : '');
          out = out.split(oldClient).join(liveClient);
        }
      }
      return out;
    }
  } catch {
    /* legacy plain string → fall through */
  }
  return null;
}

/** The editable "nice message" for a booking confirmation (persisted per user).
 * The appointment details (date / address / amount) are appended separately so
 * they always reflect the actual job. */
export function bookingNiceMessage(
  companyName?: string | null,
  clientName?: string | null,
  lang: 'fr' | 'en' = 'en',
): string {
  const name = clientName ? ` ${clientName}` : '';
  if (lang === 'fr') {
    return `Bonjour${name}! Votre rendez-vous avec ${companyName || 'nous'} est confirmé. Merci et à bientôt!`;
  }
  return `Hello${name}! Your appointment with ${companyName || 'us'} is confirmed. Thank you and see you soon!`;
}

/** The editable greeting for a quote-send message (the share link is appended). */
export function quoteNiceMessage(
  companyName?: string | null,
  clientName?: string | null,
  lang: 'fr' | 'en' = 'en',
): string {
  const name = clientName ? ` ${clientName}` : '';
  if (lang === 'fr') {
    return `Bonjour${name}! Voici votre soumission de ${companyName || 'nous'}. Vous pouvez la consulter et l'accepter ici :`;
  }
  return `Hello${name}! Here is your quote from ${companyName || 'us'}. You can review and accept it here:`;
}

/** The editable greeting for a reschedule confirmation (new time is appended). */
export function rescheduleNiceMessage(
  companyName?: string | null,
  clientName?: string | null,
  lang: 'fr' | 'en' = 'en',
): string {
  const name = clientName ? ` ${clientName}` : '';
  if (lang === 'fr') {
    return `Bonjour${name}! Votre rendez-vous avec ${companyName || 'nous'} a été déplacé.`;
  }
  return `Hello${name}! Your appointment with ${companyName || 'us'} has been rescheduled.`;
}

/** The "new time" line appended to a reschedule message. */
export function newTimeLine(whenText: string, lang: 'fr' | 'en' = 'en'): string {
  return lang === 'fr' ? `\n\nNouvelle heure : ${whenText}` : `\n\nNew time: ${whenText}`;
}

/** The deposit note appended to a quote message when a deposit is required. */
export function depositNote(amountText: string, lang: 'fr' | 'en' = 'en'): string {
  return lang === 'fr'
    ? `\n\nUn dépôt de ${amountText} est requis à l'acceptation.`
    : `\n\nA deposit of ${amountText} is required upon acceptance.`;
}

/** Compose an "on my way" text to the client. */
export async function sendOnMyWay(params: {
  phone: string;
  companyName?: string | null;
  etaMinutes?: number | null;
}): Promise<void> {
  await textNumber(params.phone, onMyWayMessage(params.companyName, params.etaMinutes));
}
