/**
 * invoice-numbering.ts — per-org concurrent-safe invoice numbering.
 *
 * Uses the DB RPC claim_next_invoice_number(uuid) (added in the 20260624000001
 * migration). Falls back to a timestamp suffix if the RPC is not yet deployed
 * so older environments keep working.
 */
import { getServiceClient } from './supabase';

const PAD = 6;
const PREFIX = 'INV-';

export async function claimNextInvoiceNumber(orgId: string): Promise<string> {
  const admin = getServiceClient();
  const { data, error } = await admin.rpc('claim_next_invoice_number', { p_org: orgId });
  if (!error && data != null) {
    return `${PREFIX}${String(data).padStart(PAD, '0')}`;
  }

  // Fallback — legacy deploys without the sequence table/RPC.
  console.warn('[invoice-numbering] RPC unavailable, using timestamp fallback:', error?.message);
  const ts = Date.now().toString(36).toUpperCase();
  return `${PREFIX}${ts}`;
}

export function formatInvoiceNumber(seq: number): string {
  return `${PREFIX}${String(seq).padStart(PAD, '0')}`;
}
