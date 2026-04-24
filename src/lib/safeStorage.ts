const isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

/**
 * SSR- and quota-safe wrapper around window.localStorage.
 *
 * Replace `try { localStorage.setItem(...) } catch {}` scattered across
 * the codebase with one of the methods below. Returns `null` / `false`
 * instead of throwing so call sites stay terse and linters stop
 * flagging empty catch blocks.
 */
export const safeLocalStorage = {
  getItem(key: string): string | null {
    if (!isBrowser) return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  setItem(key: string, value: string): boolean {
    if (!isBrowser) return false;
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },

  removeItem(key: string): boolean {
    if (!isBrowser) return false;
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },

  /** Parse a JSON-encoded value. Returns null on miss / invalid JSON. */
  getJSON<T = unknown>(key: string): T | null {
    const raw = this.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  /** Stringify and store a value. Returns false on quota / serialization failure. */
  setJSON(key: string, value: unknown): boolean {
    try {
      return this.setItem(key, JSON.stringify(value));
    } catch {
      return false;
    }
  },
};
