import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey() {
  const keyB64 = process.env.PAYMENTS_ENCRYPTION_KEY || '';
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('PAYMENTS_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

export function encryptSecret(plainText: string) {
  const input = String(plainText || '').trim();
  if (!input) {
    throw new Error('Secret value is required.');
  }

  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptSecret(payloadB64: string) {
  const payload = Buffer.from(String(payloadB64 || ''), 'base64');
  if (payload.length <= IV_LENGTH + TAG_LENGTH) {
    throw new Error('Encrypted payload is invalid.');
  }

  const key = getEncryptionKey();
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
