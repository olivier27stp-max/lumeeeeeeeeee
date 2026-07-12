/**
 * invoice-numbering.ts — per-org concurrent-safe invoice numbering.
 *
 * Numbers are digits only (« 42 ») and always the smallest free number of the
 * org — assignment lives in the DB function invoice_next_number(uuid)
 * (20260732 migration). Falls back to a numeric timestamp if the RPC is not
 * yet deployed so older environments keep working.
 */
import { getServiceClient } from './supabase';

export async function claimNextInvoiceNumber(orgId: string): Promise<string> {
  const admin = getServiceClient();
  const { data, error } = await admin.rpc('invoice_next_number', { p_org: orgId });
  if (!error && data != null) {
    return String(data);
  }

  // Fallback — legacy deploys without the numbering function.
  console.warn('[invoice-numbering] RPC unavailable, using timestamp fallback:', error?.message);
  return String(Date.now());
}

export function formatInvoiceNumber(seq: number): string {
  return String(seq);
}
