// Send an email from the device. Prefers the native mail composer (so the user
// can review + attach a PDF), and falls back to a mailto: link when no mail
// account is set up. Used for quotes, which the server can't email (the server
// stores quotes in a different table than mobile) — so this is the mobile path.

import * as MailComposer from 'expo-mail-composer';
import { Linking } from 'react-native';

export type EmailResult = 'composed' | 'mailto' | 'unavailable';

export async function sendEmail(opts: {
  to?: string | null;
  subject: string;
  body: string;
  attachments?: string[]; // local file URIs
}): Promise<EmailResult> {
  const available = await MailComposer.isAvailableAsync().catch(() => false);
  if (available) {
    await MailComposer.composeAsync({
      recipients: opts.to ? [opts.to] : undefined,
      subject: opts.subject,
      body: opts.body,
      attachments: opts.attachments,
    });
    return 'composed';
  }

  // Fallback: mailto (no attachment support — body carries the link instead).
  const query = `subject=${encodeURIComponent(opts.subject)}&body=${encodeURIComponent(opts.body)}`;
  const url = `mailto:${opts.to ?? ''}?${query}`;
  if (await Linking.canOpenURL(url)) {
    await Linking.openURL(url);
    return 'mailto';
  }
  return 'unavailable';
}
