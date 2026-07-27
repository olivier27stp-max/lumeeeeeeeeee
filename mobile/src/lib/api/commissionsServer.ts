// Server-backed commissions client — the same authed routes the web
// `src/lib/commissionsApi.ts` uses (server/routes/commissions.ts). The server
// scopes entries: a rep only ever gets their own rows; owner/admin get the org.
// The direct-Supabase reader in `./commissions` stays for lightweight summaries.

import { serverGet, serverPost, serverPut } from './server';

export type CommissionEntryStatus = 'pending' | 'approved' | 'paid' | 'reversed';

export interface FsCommissionEntry {
  id: string;
  org_id: string;
  user_id: string;
  rule_id: string | null;
  lead_id: string | null;
  job_id: string | null;
  invoice_id: string | null;
  status: CommissionEntryStatus;
  amount: number;
  base_amount: number;
  description: string | null;
  approved_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  // Relations (resolved server-side when available)
  rep_name?: string;
  rep_avatar?: string | null;
}

export interface CommissionPayrollPreview {
  total: number;
  pending: number;
  approved: number;
  paid: number;
  reversed: number;
  count: number;
  entries: FsCommissionEntry[];
}

export interface FsCommissionRule {
  id: string;
  name: string;
  type: string;
  percentage: number | null;
  applies_to_user_id: string | null;
  priority: number;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') p.set(k, String(v));
  }
  const str = p.toString();
  return str ? `?${str}` : '';
}

export function getCommissionEntries(options?: {
  userId?: string;
  status?: string;
  from?: string;
  to?: string;
}): Promise<FsCommissionEntry[]> {
  return serverGet(
    `/commissions${qs({
      userId: options?.userId,
      status: options?.status,
      from: options?.from,
      to: options?.to,
    })}`,
  );
}

export function getPayrollPreview(from: string, to: string, userId?: string): Promise<CommissionPayrollPreview> {
  return serverGet(`/commissions/payroll-preview${qs({ from, to, userId })}`);
}

export function approveCommission(entryId: string): Promise<FsCommissionEntry> {
  return serverPost(`/commissions/${entryId}/approve`, {});
}

export function reverseCommission(entryId: string, reason?: string): Promise<FsCommissionEntry> {
  return serverPost(`/commissions/${entryId}/reverse`, { reason });
}

export function getCommissionRules(): Promise<FsCommissionRule[]> {
  return serverGet('/commissions/rules');
}

export function createCommissionRule(data: Partial<FsCommissionRule>): Promise<FsCommissionRule> {
  return serverPost('/commissions/rules', data);
}

export function updateCommissionRule(id: string, data: Partial<FsCommissionRule>): Promise<FsCommissionRule> {
  return serverPut(`/commissions/rules/${id}`, data);
}
