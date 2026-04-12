import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
// Version byte: allows future key rotation detection
// Version 0x01 = current key, 0x02+ = future rotated keys
const KEY_VERSION = 0x01;

function getEncryptionKey(): Buffer {
  const keyB64 = process.env.PAYMENTS_ENCRYPTION_KEY || '';
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('PAYMENTS_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

/**
 * Get the previous encryption key for rotation decryption.
 * Set PAYMENTS_ENCRYPTION_KEY_PREVIOUS when rotating keys.
 * This allows decrypting secrets encrypted with the old key
 * and re-encrypting them with the new key.
 */
function getPreviousEncryptionKey(): Buffer | null {
  const keyB64 = process.env.PAYMENTS_ENCRYPTION_KEY_PREVIOUS || '';
  if (!keyB64) return null;
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) return null;
  return key;
}

export function encryptSecret(plainText: string): string {
  const input = String(plainText || '').trim();
  if (!input) {
    throw new Error('Secret value is required.');
  }

  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: [version(1)] [iv(12)] [tag(16)] [ciphertext(N)]
  return Buffer.concat([Buffer.from([KEY_VERSION]), iv, tag, encrypted]).toString('base64');
}

export function decryptSecret(payloadB64: string): string {
  const payload = Buffer.from(String(payloadB64 || ''), 'base64');

  // Detect versioned vs legacy format
  // Legacy format: [iv(12)] [tag(16)] [ciphertext] — min length IV+TAG+1 = 29
  // Versioned:     [ver(1)] [iv(12)] [tag(16)] [ciphertext] — min length 1+IV+TAG+1 = 30

  let key: Buffer;
  let iv: Buffer;
  let tag: Buffer;
  let ciphertext: Buffer;

  if (payload.length > 0 && payload[0] === KEY_VERSION) {
    // Versioned format — encrypted with current key
    if (payload.length <= 1 + IV_LENGTH + TAG_LENGTH) {
      throw new Error('Encrypted payload is invalid.');
    }
    key = getEncryptionKey();
    iv = payload.subarray(1, 1 + IV_LENGTH);
    tag = payload.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
    ciphertext = payload.subarray(1 + IV_LENGTH + TAG_LENGTH);
  } else {
    // Legacy format (no version byte) — try current key first, then previous
    if (payload.length <= IV_LENGTH + TAG_LENGTH) {
      throw new Error('Encrypted payload is invalid.');
    }
    iv = payload.subarray(0, IV_LENGTH);
    tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    ciphertext = payload.subarray(IV_LENGTH + TAG_LENGTH);

    // Try current key
    key = getEncryptionKey();
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      // Current key failed — try previous key (rotation scenario)
      const prevKey = getPreviousEncryptionKey();
      if (!prevKey) {
        throw new Error('Decryption failed. If you rotated PAYMENTS_ENCRYPTION_KEY, set PAYMENTS_ENCRYPTION_KEY_PREVIOUS to the old key.');
      }
      key = prevKey;
    }
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Re-encrypt a secret with the current key.
 * Used during key rotation to upgrade legacy-encrypted secrets.
 */
export function reEncryptSecret(payloadB64: string): string {
  const plainText = decryptSecret(payloadB64);
  return encryptSecret(plainText);
}

/**
 * Check if a payload is encrypted with the current key version.
 * Returns false if it's legacy format (needs re-encryption).
 */
export function isCurrentKeyVersion(payloadB64: string): boolean {
  const payload = Buffer.from(String(payloadB64 || ''), 'base64');
  return payload.length > 0 && payload[0] === KEY_VERSION;
}
