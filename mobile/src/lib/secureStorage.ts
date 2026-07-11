import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Encrypted, chunked storage adapter for the Supabase auth session.
//
// The session (access token + refresh token + user metadata) is a secret: a
// leaked refresh token grants weeks of access. It must live in the OS keystore
// (iOS Keychain / Android Keystore) via expo-secure-store, NOT in the plaintext
// AsyncStorage file (which is readable from a device backup or a rooted phone).
//
// SecureStore historically rejects values over ~2048 BYTES on iOS, and a
// Supabase session routinely exceeds that. So large values are split into
// byte-bounded chunks. 640 UTF-16 code units is <=1920 bytes even in the worst
// case (a BMP char is at most 3 UTF-8 bytes per code unit), safely under the
// limit while still packing ASCII tokens efficiently.
const CHUNK = 640;
const COUNT_SUFFIX = '.chunks';

async function readChunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(key + COUNT_SUFFIX).catch(() => null);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function clearChunks(key: string): Promise<void> {
  const n = await readChunkCount(key);
  const deletions: Promise<void>[] = [SecureStore.deleteItemAsync(key + COUNT_SUFFIX)];
  for (let i = 0; i < n; i++) deletions.push(SecureStore.deleteItemAsync(`${key}.${i}`));
  await Promise.all(deletions.map((p) => p.catch(() => {})));
}

async function getItem(key: string): Promise<string | null> {
  const count = await readChunkCount(key);

  // Non-chunked (small value) path.
  if (count === 0) {
    const whole = await SecureStore.getItemAsync(key).catch(() => null);
    if (whole != null) return whole;

    // One-time migration: an earlier build stored the session in plaintext
    // AsyncStorage. If it's still there, move it into the keystore (and purge
    // the plaintext copy) so existing sessions aren't dropped on upgrade.
    const legacy = await AsyncStorage.getItem(key).catch(() => null);
    if (legacy != null) {
      await setItem(key, legacy);
      await AsyncStorage.removeItem(key).catch(() => {});
      return legacy;
    }
    return null;
  }

  // Chunked path — reassemble in order.
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(`${key}.${i}`).catch(() => null);
    if (part == null) return null; // partial/corrupt write → treat as absent (forces re-auth)
    parts.push(part);
  }
  return parts.join('');
}

async function setItem(key: string, value: string): Promise<void> {
  await clearChunks(key);

  if (value.length <= CHUNK) {
    await SecureStore.setItemAsync(key, value);
    return;
  }

  // Large value: clear any prior whole value, then write chunks + a sidecar count.
  await SecureStore.deleteItemAsync(key).catch(() => {});
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK) chunks.push(value.slice(i, i + CHUNK));
  for (let i = 0; i < chunks.length; i++) {
    await SecureStore.setItemAsync(`${key}.${i}`, chunks[i]);
  }
  await SecureStore.setItemAsync(key + COUNT_SUFFIX, String(chunks.length));
}

async function removeItem(key: string): Promise<void> {
  await clearChunks(key);
  await SecureStore.deleteItemAsync(key).catch(() => {});
  await AsyncStorage.removeItem(key).catch(() => {}); // also purge any legacy plaintext copy
}

// Shape expected by supabase-js `auth.storage`.
export const SecureStorageAdapter = { getItem, setItem, removeItem };
