/**
 * Trusted-device token (client side).
 *
 * After a successful SMS step-up the server issues a random device token that
 * keeps this device trusted for 30 days. We store it locally and send it as
 * `x-device-token` on requests so the server can recognize the device and skip
 * re-challenging. The raw token never leaves the device except as this header;
 * the server only stores its hash.
 */
const KEY = 'lume_device_token';

export function getDeviceToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setDeviceToken(token: string): void {
  try {
    if (token) localStorage.setItem(KEY, token);
  } catch {
    /* ignore storage failures */
  }
}

export function clearDeviceToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Header fragment to merge into authenticated requests. */
export function deviceTokenHeader(): Record<string, string> {
  const token = getDeviceToken();
  return token ? { 'x-device-token': token } : {};
}
