/* ═══════════════════════════════════════════════════════════════
   Email Provider Registry
   Lookup for the two email providers (Gmail, Outlook).
   ═══════════════════════════════════════════════════════════════ */

import type { EmailProviderDefinition, EmailProviderSlug } from '../types';
import { gmailProvider } from './gmail';
import { outlookProvider } from './outlook';

const providers = new Map<EmailProviderSlug, EmailProviderDefinition>([
  [gmailProvider.slug, gmailProvider],
  [outlookProvider.slug, outlookProvider],
]);

export function getEmailProvider(slug: string): EmailProviderDefinition | undefined {
  return providers.get(slug as EmailProviderSlug);
}

export function getAllEmailProviders(): EmailProviderDefinition[] {
  return Array.from(providers.values());
}

export function isEmailProvider(slug: string): slug is EmailProviderSlug {
  return providers.has(slug as EmailProviderSlug);
}
