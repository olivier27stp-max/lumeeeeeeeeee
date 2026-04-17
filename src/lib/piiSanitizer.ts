/**
 * PII Display Sanitizer — Frontend Safety Net
 * =============================================
 * Ensures encrypted values (enc:...) NEVER display in the UI.
 *
 * This is a defense-in-depth safety net, not the primary mechanism.
 * PII is stored as plaintext in the database (protected by Supabase
 * encryption at rest + RLS). This sanitizer catches edge cases where
 * stale encrypted data might still exist during migration.
 *
 * Rules:
 * - If value starts with "enc:" → return fallback (dash)
 * - If value is null/undefined/empty → return fallback
 * - Otherwise → return the value as-is
 */

const ENC_PREFIX = 'enc:';

/**
 * Sanitize a PII field for display. Never returns encrypted values.
 * @param value - The field value from the database
 * @param fallback - What to show if value is missing or encrypted (default: "—")
 */
export function displayPii(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback;
  if (value.startsWith(ENC_PREFIX)) return fallback;
  return value;
}

/**
 * Sanitize an email for display.
 */
export function displayEmail(value: string | null | undefined): string {
  return displayPii(value, '—');
}

/**
 * Sanitize a phone number for display.
 */
export function displayPhone(value: string | null | undefined): string {
  return displayPii(value, '—');
}

/**
 * Sanitize an address for display.
 */
export function displayAddress(value: string | null | undefined): string {
  return displayPii(value, '—');
}
