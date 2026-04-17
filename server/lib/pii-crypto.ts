/**
 * LUME CRM — PII Field Encryption
 * =================================
 * AES-256-GCM encryption for personally identifiable information (PII).
 * Used to encrypt emails, phone numbers, and addresses at rest.
 *
 * Uses a SEPARATE key from payments (PII_ENCRYPTION_KEY).
 * Falls back to PAYMENTS_ENCRYPTION_KEY if PII_ENCRYPTION_KEY is not set,
 * so existing deployments work without config changes.
 *
 * Encrypted values are prefixed with "enc:" to distinguish from plaintext.
 * This allows gradual migration — reads handle both formats transparently.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ENC_PREFIX = 'enc:';

function getPiiKey(): Buffer | null {
  const keyB64 = process.env.PII_ENCRYPTION_KEY || process.env.PAYMENTS_ENCRYPTION_KEY || '';
  if (!keyB64) return null;
  try {
    const key = Buffer.from(keyB64, 'base64');
    if (key.length !== 32) return null;
    return key;
  } catch {
    return null;
  }
}

let _keyCache: Buffer | null | undefined;
function getKey(): Buffer | null {
  if (_keyCache === undefined) {
    _keyCache = getPiiKey();
    if (_keyCache) {
      console.log('[pii-crypto] PII encryption key loaded (32 bytes)');
    } else {
      console.warn('[pii-crypto] No PII_ENCRYPTION_KEY set — PII stored in plaintext');
    }
  }
  return _keyCache;
}

/**
 * Encrypt a PII field value. Returns prefixed base64 string.
 * If no key is configured, returns plaintext (graceful degradation).
 * Null/empty values pass through unchanged.
 */
export function encryptPii(plaintext: string | null | undefined): string | null {
  if (!plaintext) return plaintext as null;

  const key = getKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: enc:[iv(12)][tag(16)][ciphertext(N)] as base64
  const payload = Buffer.concat([iv, tag, encrypted]).toString('base64');
  return `${ENC_PREFIX}${payload}`;
}

/**
 * Decrypt a PII field value. Handles both encrypted (enc: prefix) and plaintext.
 * This makes migration gradual — old plaintext rows still work.
 */
export function decryptPii(value: string | null | undefined): string | null {
  if (!value) return value as null;

  // Not encrypted — return as-is
  if (!value.startsWith(ENC_PREFIX)) return value;

  const key = getKey();
  if (!key) {
    console.error('[pii-crypto] Cannot decrypt — no encryption key configured');
    return '[ENCRYPTED]';
  }

  try {
    const payload = Buffer.from(value.slice(ENC_PREFIX.length), 'base64');
    if (payload.length <= IV_LENGTH + TAG_LENGTH) {
      return '[INVALID]';
    }

    const iv = payload.subarray(0, IV_LENGTH);
    const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = payload.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err: any) {
    console.error('[pii-crypto] Decryption failed:', err?.message);
    return '[DECRYPT_ERROR]';
  }
}

/**
 * Check if a value is already encrypted.
 */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

/**
 * Encrypt PII fields in an object. Only encrypts specified field names.
 * Returns a new object with encrypted values (does not mutate input).
 */
export function encryptPiiFields<T extends Record<string, any>>(
  obj: T,
  fields: (keyof T)[],
): T {
  const result = { ...obj };
  for (const field of fields) {
    const val = result[field];
    if (typeof val === 'string' && val && !isEncrypted(val)) {
      (result as any)[field] = encryptPii(val);
    }
  }
  return result;
}

/**
 * Decrypt PII fields in an object. Only decrypts specified field names.
 * Returns a new object with decrypted values (does not mutate input).
 */
export function decryptPiiFields<T extends Record<string, any>>(
  obj: T,
  fields: (keyof T)[],
): T {
  const result = { ...obj };
  for (const field of fields) {
    const val = result[field];
    if (typeof val === 'string' && isEncrypted(val)) {
      (result as any)[field] = decryptPii(val);
    }
  }
  return result;
}

/**
 * Decrypt PII fields in an array of objects.
 */
export function decryptPiiRows<T extends Record<string, any>>(
  rows: T[],
  fields: (keyof T)[],
): T[] {
  if (!rows || rows.length === 0) return rows;
  return rows.map(row => decryptPiiFields(row, fields));
}

/** Standard PII fields used across the CRM */
export const CLIENT_PII_FIELDS = ['email', 'phone', 'address'] as const;
export const LEAD_PII_FIELDS = ['email', 'phone', 'address'] as const;
