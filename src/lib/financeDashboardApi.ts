import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

/* ── Types ──────────────────────────────────────────────────── */

export interface RecentTransaction {
  id: string;
  label: string;
  date: string;
  type: 'income' | 'expense' | 'refund';
  amount_cents: number;
  initials: string;
  color: string;
}

export interface LumePaymentClient {
  client_id: string;
  client_name: string;
  total_paid_cents: number;
  last_paid_at: string | null;
  invoice_count: number;
}

/* ── Helpers ────────────────────────────────────────────────── */

const AVATAR_COLORS = [
  '#171717', '#059669', '#dc2626', '#2563eb',
  '#d97706', '#7c3aed', '#0891b2', '#334155',
];

function initialsFrom(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

/* ── Fetchers ───────────────────────────────────────────────── */

export async function fetchRecentTransactions(limit = 8): Promise<RecentTransaction[]> {
  const orgId = await getCurrentOrgIdOrThrow();

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, total_cents, paid_at, issued_at, client_id')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .in('status', ['paid', 'sent', 'partial', 'draft'])
    .order('updated_at', { ascending: false })
    .limit(limit);

  // Fetch client names separately to avoid PostgREST JOIN ambiguity
  const clientIds = [...new Set((invoices || []).map((i: any) => i.client_id).filter(Boolean))];
  const clientMap: Record<string, { first_name: string; last_name: string; company_name: string }> = {};
  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, first_name, last_name, company_name')
      .in('id', clientIds);
    for (const c of clients || []) {
      clientMap[(c as any).id] = c as any;
    }
  }

  return (invoices || []).map((inv: any, idx: number) => {
    const c = clientMap[inv.client_id];
    const name = c
      ? `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company_name || 'Client'
      : `Invoice #${inv.invoice_number}`;
    const isPaid = inv.status === 'paid';

    return {
      id: inv.id,
      label: name,
      date: inv.paid_at || inv.issued_at || new Date().toISOString(),
      type: isPaid ? ('income' as const) : ('expense' as const),
      amount_cents: inv.total_cents || 0,
      initials: initialsFrom(name),
      color: AVATAR_COLORS[idx % AVATAR_COLORS.length],
    };
  });
}

export async function fetchLumePaymentClients(limit = 6): Promise<LumePaymentClient[]> {
  try {
    const orgId = await getCurrentOrgIdOrThrow();

    // Only show clients with REAL payments (Stripe/PayPal/card transactions),
    // not just invoiced clients. Group by client_id to aggregate totals.
    const { data: payments, error } = await supabase
      .from('payments')
      .select('client_id, amount_cents, paid_at')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .not('client_id', 'is', null)
      .order('paid_at', { ascending: false });

    if (error) throw error;
    if (!payments || payments.length === 0) return [];

    // Aggregate by client
    const clientMap = new Map<string, { total: number; lastPaid: string | null; count: number }>();
    for (const p of payments) {
      if (!p.client_id) continue;
      const existing = clientMap.get(p.client_id);
      if (existing) {
        existing.total += Number(p.amount_cents || 0);
        existing.count += 1;
        if (p.paid_at && (!existing.lastPaid || p.paid_at > existing.lastPaid)) {
          existing.lastPaid = p.paid_at;
        }
      } else {
        clientMap.set(p.client_id, {
          total: Number(p.amount_cents || 0),
          lastPaid: p.paid_at || null,
          count: 1,
        });
      }
    }

    // Sort by total paid descending, take top N
    const sorted = [...clientMap.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, limit);

    if (sorted.length === 0) return [];

    // Fetch client names
    const clientIds = sorted.map(([id]) => id);
    const { data: clients } = await supabase
      .from('clients')
      .select('id, first_name, last_name, company')
      .in('id', clientIds);

    const nameMap = new Map<string, string>();
    for (const c of clients || []) {
      const name = `${(c as any).first_name || ''} ${(c as any).last_name || ''}`.trim() || (c as any).company || 'Client';
      nameMap.set((c as any).id, name);
    }

    return sorted.map(([clientId, agg]) => ({
      client_id: clientId,
      client_name: nameMap.get(clientId) || 'Unknown',
      total_paid_cents: agg.total,
      last_paid_at: agg.lastPaid,
      invoice_count: agg.count,
    }));
  } catch {
    return [];
  }
}
