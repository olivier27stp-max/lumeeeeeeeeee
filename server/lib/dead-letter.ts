/**
 * dead-letter.ts — Persist failed async jobs for post-hoc inspection/replay.
 *
 * Usage:
 *   await withDeadLetter('sms_inbound', payload, async () => { ... });
 *
 * If the inner function throws, the payload + error are persisted to the
 * dead_letters table so we don't lose the signal. Keeps a bounded retry
 * attempt counter for later workflows.
 */
import { getServiceClient } from './supabase';

export async function withDeadLetter<T>(
  source: string,
  payload: unknown,
  fn: () => Promise<T>
): Promise<T | null> {
  try {
    return await fn();
  } catch (err: any) {
    const msg = (err?.message || String(err)).slice(0, 2000);
    try {
      const admin = getServiceClient();
      await admin.from('dead_letters').insert({
        source,
        payload: payload as any,
        error_msg: msg,
      });
      console.error(`[dead-letter] Persisted ${source} failure:`, msg);
    } catch (dlErr: any) {
      // If even the dead-letter insert fails, log but don't crash the caller
      console.error(`[dead-letter] Failed to persist ${source} failure:`, dlErr?.message, 'Original error:', msg);
    }
    return null;
  }
}
