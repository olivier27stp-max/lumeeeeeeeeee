/* ═══════════════════════════════════════════════════════════════
   Email Crypto
   Re-exports the app's AES-256-GCM crypto (src/lib/crypto.ts) so email
   OAuth tokens are encrypted at rest with the same key + versioning as
   the rest of the platform. Never expose decrypted tokens to the client.
   ═══════════════════════════════════════════════════════════════ */

import { encryptSecret, decryptSecret } from '../../../src/lib/crypto';

export { encryptSecret, decryptSecret };

/** Decrypt a token, returning '' if the payload is missing or corrupt. */
export function safeDecrypt(payload: string | null | undefined): string {
  if (!payload) return '';
  try {
    return decryptSecret(payload);
  } catch {
    return '';
  }
}
