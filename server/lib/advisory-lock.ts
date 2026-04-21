/**
 * advisory-lock.ts — Postgres advisory locks for cron-like jobs.
 * Ensures at-most-one instance runs a given job across replicas.
 *
 * Calls public.try_advisory_lock(bigint) / public.release_advisory_lock(bigint)
 * (thin SECURITY DEFINER wrappers defined in the 20260624000001 migration).
 */
import { getServiceClient } from './supabase';

export async function withAdvisoryLock<T>(
  lockName: string,
  fn: () => Promise<T>
): Promise<{ acquired: boolean; result?: T }> {
  const admin = getServiceClient();
  const key = hashLockName(lockName);

  const { data: acquired, error: acquireErr } = await admin.rpc('try_advisory_lock', { p_key: key });
  if (acquireErr) {
    console.error(`[advisory-lock] try_advisory_lock(${lockName}) failed:`, acquireErr.message);
    return { acquired: false };
  }
  if (!acquired) return { acquired: false };

  try {
    const result = await fn();
    return { acquired: true, result };
  } finally {
    const { error: releaseErr } = await admin.rpc('release_advisory_lock', { p_key: key });
    if (releaseErr) console.error(`[advisory-lock] release(${lockName}) failed:`, releaseErr.message);
  }
}

function hashLockName(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
