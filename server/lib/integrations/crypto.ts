/* ═══════════════════════════════════════════════════════════════
   Integration Crypto
   Wraps the existing crypto module for integration-specific use.
   Never expose decrypted secrets to the frontend.
   ═══════════════════════════════════════════════════════════════ */

import { encryptSecret, decryptSecret } from '../crypto';
import type { DecryptedCredentials } from './types';

export { encryptSecret, decryptSecret };

/**
 * Encrypt all fields of a credentials object.
 */
export function encryptCredentials(creds: Record<string, string>): Record<string, string> {
  const encrypted: Record<string, string> = {};
  for (const [key, value] of Object.entries(creds)) {
    if (value) {
      encrypted[key] = encryptSecret(value);
    }
  }
  return encrypted;
}

/**
 * Decrypt all fields of an encrypted credentials object.
 */
export function decryptCredentials(encrypted: Record<string, string>): Record<string, string> {
  const decrypted: Record<string, string> = {};
  for (const [key, value] of Object.entries(encrypted)) {
    if (value) {
      try {
        decrypted[key] = decryptSecret(value);
      } catch {
        decrypted[key] = ''; // corrupt or invalid
      }
    }
  }
  return decrypted;
}

/**
 * Build DecryptedCredentials from a DB connection record.
 */
export function buildDecryptedCredentials(record: {
  encrypted_access_token?: string | null;
  encrypted_refresh_token?: string | null;
  encrypted_credentials?: Record<string, unknown> | null;
}): DecryptedCredentials {
  const result: DecryptedCredentials = {};

  if (record.encrypted_access_token) {
    result.access_token = decryptSecret(record.encrypted_access_token);
  }

  if (record.encrypted_refresh_token) {
    result.refresh_token = decryptSecret(record.encrypted_refresh_token);
  }

  if (record.encrypted_credentials && typeof record.encrypted_credentials === 'object') {
    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(record.encrypted_credentials)) {
      if (typeof value === 'string' && value) {
        try {
          extra[key] = decryptSecret(value);
        } catch {
          extra[key] = '';
        }
      }
    }
    if (Object.keys(extra).length > 0) {
      result.extra = extra;
      // Map common keys
      if (extra.api_key) result.api_key = extra.api_key;
      if (extra.api_secret) result.api_secret = extra.api_secret;
    }
  }

  return result;
}
