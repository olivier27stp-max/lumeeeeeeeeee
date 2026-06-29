// Commission entries for the signed-in rep (read-only on mobile). RLS lets a rep
// SELECT their own rows; owner/admin see the whole org. Amounts are in dollars
// (numeric), not cents. Table: fs_commission_entries.

import { supabase } from '../supabase';

export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'reversed';

export interface CommissionEntry {
  id: string;
  user_id: string;
  status: CommissionStatus;
  amount: number;
  base_amount: number;
  description: string | null;
  job_id: string | null;
  lead_id: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface CommissionSummary {
  pending: number;
  approved: number;
  paid: number;
  reversed: number;
  total: number;
}

const COLS =
  'id, user_id, status, amount, base_amount, description, job_id, lead_id, approved_at, paid_at, created_at';

/** Commission entries for a user (or whole org if userId omitted, for managers). */
export async function listCommissions(
  orgId: string,
  userId?: string | null,
): Promise<CommissionEntry[]> {
  let q = supabase
    .from('fs_commission_entries')
    .select(COLS)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as CommissionEntry[];
}

export function summarize(entries: CommissionEntry[]): CommissionSummary {
  const s: CommissionSummary = { pending: 0, approved: 0, paid: 0, reversed: 0, total: 0 };
  for (const e of entries) {
    const amt = Number(e.amount) || 0;
    if (e.status === 'reversed') {
      s.reversed += amt;
      continue;
    }
    s[e.status] += amt;
    s.total += amt;
  }
  return s;
}
