/* Client-facing activity tracking.
 *
 * "Last activity" on the Clients list reflects the most recent time a client
 * engaged with the business — including when they OPEN any client-facing link
 * (portal, quote/invoice view). Those entry points are anonymous, so the stamp
 * is written server-side via the service-role client from each public route.
 */

import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Best-effort: stamp clients.last_client_activity_at = now() for the given
 * client. Never throws and never blocks the caller's response — failures are
 * logged and swallowed (e.g. if the column hasn't been migrated yet).
 */
export async function recordClientActivity(
  service: SupabaseClient,
  clientId: string | null | undefined,
): Promise<void> {
  if (!clientId) return;
  try {
    const { error } = await service
      .from('clients')
      .update({ last_client_activity_at: new Date().toISOString() })
      .eq('id', clientId);
    if (error) console.warn('[clientActivity] failed to record:', error.message);
  } catch (err) {
    console.warn('[clientActivity] failed to record:', (err as Error)?.message);
  }
}
