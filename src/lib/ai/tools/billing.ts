/* ═══════════════════════════════════════════════════════════════
   AI Tools — Billing & Revenue Analytics
   Advanced AI connectors for invoices, payments, revenue.
   Targeted queries — never loads all data into memory.
   ═══════════════════════════════════════════════════════════════ */

import type { ToolDefinition } from '../types';
import { supabase } from '../../supabase';
import { formatMoneyFromCents } from '../../invoicesApi';
import { getCurrentOrgIdOrThrow } from '../../orgApi';

export const billingTools: ToolDefinition[] = [
  // ─── Invoice Summary ─────────────────────────────────────
  {
    id: 'billing.summary',
    label: 'Invoice Summary',
    description: 'Get a complete summary of all invoices: total revenue, paid, open, past due, draft counts and amounts.',
    category: 'read',
    requiredPermissions: ['invoices.read'],
    parameters: [],
    execute: async () => {
      try {
        const orgId = await getCurrentOrgIdOrThrow();
        const { data, error } = await supabase
          .from('invoices')
          .select('status, total_cents, balance_cents, paid_cents, due_date')
          .eq('org_id', orgId)
          .is('deleted_at', null);

        if (error) throw error;

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        let total_revenue = 0;
        let paid_total = 0;
        let paid_count = 0;
        let open_total = 0;
        let open_count = 0;
        let past_due_total = 0;
        let past_due_count = 0;
        let draft_total = 0;
        let draft_count = 0;
        let total_count = 0;

        for (const inv of data || []) {
          total_count++;
          const totalCents = Number(inv.total_cents || 0);
          total_revenue += totalCents;

          if (inv.status === 'paid') {
            paid_total += totalCents;
            paid_count++;
          } else if (inv.status === 'draft') {
            draft_total += totalCents;
            draft_count++;
          } else if (
            (inv.status === 'sent' || inv.status === 'partial') &&
            inv.due_date && new Date(inv.due_date) < today &&
            Number(inv.balance_cents || 0) > 0
          ) {
            past_due_total += totalCents;
            past_due_count++;
          } else if (inv.status === 'sent' || inv.status === 'partial') {
            open_total += totalCents;
            open_count++;
          }
        }

        const summary = {
          total_invoices: total_count,
          total_revenue: formatMoneyFromCents(total_revenue),
          total_revenue_cents: total_revenue,
          paid_invoices: paid_count,
          paid_total: formatMoneyFromCents(paid_total),
          paid_total_cents: paid_total,
          open_invoices: open_count,
          open_total: formatMoneyFromCents(open_total),
          open_total_cents: open_total,
          past_due_invoices: past_due_count,
          past_due_total: formatMoneyFromCents(past_due_total),
          past_due_total_cents: past_due_total,
          draft_invoices: draft_count,
          draft_total: formatMoneyFromCents(draft_total),
          draft_total_cents: draft_total,
        };

        return {
          success: true,
          data: summary,
          summary: `Invoice summary: ${total_count} total, ${paid_count} paid (${formatMoneyFromCents(paid_total)}), ${open_count} open, ${past_due_count} past due, ${draft_count} draft.`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to get invoice summary' };
      }
    },
  },

  // ─── Revenue by Period ────────────────────────────────────
  {
    id: 'billing.revenue',
    label: 'Revenue Analytics',
    description: 'Get revenue data for today, this week, this month, and this year. Only counts paid invoices.',
    category: 'read',
    requiredPermissions: ['invoices.read'],
    parameters: [],
    execute: async () => {
      try {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const dayOfWeek = now.getDay();
        const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();

        // Fetch paid invoices for the year
        const orgId = await getCurrentOrgIdOrThrow();
        const { data, error } = await supabase
          .from('invoices')
          .select('paid_at, paid_cents')
          .eq('org_id', orgId)
          .eq('status', 'paid')
          .is('deleted_at', null)
          .gte('paid_at', startOfYear);

        if (error) throw error;

        let revenue_today = 0;
        let revenue_this_week = 0;
        let revenue_this_month = 0;
        let revenue_this_year = 0;

        for (const inv of data || []) {
          const paidAt = inv.paid_at ? new Date(inv.paid_at) : null;
          const amount = Number(inv.paid_cents || 0);
          if (!paidAt) continue;

          revenue_this_year += amount;
          if (paidAt >= new Date(startOfMonth)) revenue_this_month += amount;
          if (paidAt >= startOfWeek) revenue_this_week += amount;
          if (paidAt >= new Date(startOfDay)) revenue_today += amount;
        }

        // Previous month for growth
        const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
        const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString();

        const { data: prevData } = await supabase
          .from('invoices')
          .select('paid_cents')
          .eq('org_id', orgId)
          .eq('status', 'paid')
          .is('deleted_at', null)
          .gte('paid_at', prevMonthStart)
          .lte('paid_at', prevMonthEnd);

        let revenue_last_month = 0;
        for (const inv of prevData || []) {
          revenue_last_month += Number(inv.paid_cents || 0);
        }

        const growth = revenue_last_month > 0
          ? ((revenue_this_month - revenue_last_month) / revenue_last_month * 100).toFixed(1)
          : null;

        const result = {
          revenue_today: formatMoneyFromCents(revenue_today),
          revenue_today_cents: revenue_today,
          revenue_this_week: formatMoneyFromCents(revenue_this_week),
          revenue_this_week_cents: revenue_this_week,
          revenue_this_month: formatMoneyFromCents(revenue_this_month),
          revenue_this_month_cents: revenue_this_month,
          revenue_this_year: formatMoneyFromCents(revenue_this_year),
          revenue_this_year_cents: revenue_this_year,
          revenue_last_month: formatMoneyFromCents(revenue_last_month),
          revenue_growth_pct: growth ? `${growth}%` : 'N/A',
        };

        return {
          success: true,
          data: result,
          summary: `Revenue: today ${formatMoneyFromCents(revenue_today)}, this week ${formatMoneyFromCents(revenue_this_week)}, this month ${formatMoneyFromCents(revenue_this_month)}, this year ${formatMoneyFromCents(revenue_this_year)}.${growth ? ` Month-over-month growth: ${growth}%.` : ''}`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to get revenue' };
      }
    },
  },

  // ─── Top Paying Clients ───────────────────────────────────
  {
    id: 'billing.top_clients',
    label: 'Top Paying Clients',
    description: 'Get the top paying clients ranked by total paid amount. Returns top 10 by default.',
    category: 'read',
    requiredPermissions: ['invoices.read'],
    parameters: [
      { name: 'limit', type: 'number', description: 'Number of clients to return (default 10, max 25)', required: false, default: 10 },
    ],
    execute: async (params) => {
      try {
        const limit = Math.min(25, Math.max(1, (params.limit as number) || 10));
        const orgId = await getCurrentOrgIdOrThrow();

        const { data, error } = await supabase
          .from('invoices')
          .select('client_id, paid_cents')
          .eq('org_id', orgId)
          .eq('status', 'paid')
          .is('deleted_at', null);

        if (error) throw error;

        // Aggregate by client
        const clientTotals: Record<string, number> = {};
        for (const inv of data || []) {
          if (!inv.client_id) continue;
          clientTotals[inv.client_id] = (clientTotals[inv.client_id] || 0) + Number(inv.paid_cents || 0);
        }

        // Sort and take top N
        const sorted = Object.entries(clientTotals)
          .sort(([, a], [, b]) => b - a)
          .slice(0, limit);

        if (sorted.length === 0) {
          return { success: true, data: [], summary: 'No paid invoices found.' };
        }

        // Fetch client names
        const clientIds = sorted.map(([id]) => id);
        const { data: clients } = await supabase
          .from('clients')
          .select('id, first_name, last_name, company, email')
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .in('id', clientIds);

        const clientMap: Record<string, { name: string; email: string | null }> = {};
        for (const c of clients || []) {
          const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company || 'Unknown';
          clientMap[c.id] = { name, email: c.email || null };
        }

        const result = sorted.map(([id, cents], i) => ({
          rank: i + 1,
          client_id: id,
          client_name: clientMap[id]?.name || 'Unknown',
          client_email: clientMap[id]?.email || null,
          total_paid: formatMoneyFromCents(cents),
          total_paid_cents: cents,
        }));

        return {
          success: true,
          data: result,
          summary: `Top ${result.length} paying clients: ${result.slice(0, 3).map((c) => `${c.client_name} (${c.total_paid})`).join(', ')}.`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to get top clients' };
      }
    },
  },

  // ─── Invoices by Status ───────────────────────────────────
  {
    id: 'billing.by_status',
    label: 'Invoices by Status',
    description: 'Get a list of invoices filtered by status (draft, open, paid, past_due). Returns up to 20 most recent.',
    category: 'read',
    requiredPermissions: ['invoices.read'],
    parameters: [
      { name: 'status', type: 'string', description: 'Status to filter by', required: true, enum: ['draft', 'open', 'paid', 'past_due'] },
      { name: 'limit', type: 'number', description: 'Max results (default 20)', required: false, default: 20 },
    ],
    execute: async (params) => {
      try {
        const statusParam = params.status as string;
        const limit = Math.min(50, Math.max(1, (params.limit as number) || 20));
        const orgId = await getCurrentOrgIdOrThrow();

        let query = supabase
          .from('invoices')
          .select('id, invoice_number, client_id, status, total_cents, balance_cents, due_date, issued_at, subject')
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (statusParam === 'paid') {
          query = query.eq('status', 'paid');
        } else if (statusParam === 'draft') {
          query = query.eq('status', 'draft');
        } else if (statusParam === 'open') {
          query = query.in('status', ['sent', 'partial']).gt('balance_cents', 0);
        } else if (statusParam === 'past_due') {
          query = query.in('status', ['sent', 'partial']).gt('balance_cents', 0)
            .lt('due_date', new Date().toISOString().slice(0, 10));
        }

        const { data, error } = await query;
        if (error) throw error;

        // Fetch client names
        const clientIds = [...new Set((data || []).map((i: any) => i.client_id).filter(Boolean))];
        const { data: clients } = await supabase
          .from('clients')
          .select('id, first_name, last_name, company')
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .in('id', clientIds.length > 0 ? clientIds : ['00000000-0000-0000-0000-000000000000']);

        const nameMap: Record<string, string> = {};
        for (const c of clients || []) {
          nameMap[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company || 'Unknown';
        }

        const result = (data || []).map((inv: any) => ({
          id: inv.id,
          invoice_number: inv.invoice_number,
          client_name: nameMap[inv.client_id] || 'Unknown',
          status: inv.status,
          amount: formatMoneyFromCents(Number(inv.total_cents || 0)),
          balance: formatMoneyFromCents(Number(inv.balance_cents || 0)),
          due_date: inv.due_date || null,
          subject: inv.subject || null,
        }));

        return {
          success: true,
          data: result,
          summary: `Found ${result.length} ${statusParam} invoice(s).`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to get invoices by status' };
      }
    },
  },

  // ─── Average Invoice Value ────────────────────────────────
  {
    id: 'billing.average',
    label: 'Average Invoice Value',
    description: 'Get the average invoice value overall and for the last 30 days.',
    category: 'read',
    requiredPermissions: ['invoices.read'],
    parameters: [],
    execute: async () => {
      try {
        const orgId = await getCurrentOrgIdOrThrow();
        const { data, error } = await supabase
          .from('invoices')
          .select('total_cents, created_at')
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .neq('status', 'void');

        if (error) throw error;

        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        let allTotal = 0;
        let allCount = 0;
        let recentTotal = 0;
        let recentCount = 0;

        for (const inv of data || []) {
          const cents = Number(inv.total_cents || 0);
          allTotal += cents;
          allCount++;
          if (new Date(inv.created_at) >= thirtyDaysAgo) {
            recentTotal += cents;
            recentCount++;
          }
        }

        return {
          success: true,
          data: {
            average_all_time: formatMoneyFromCents(allCount > 0 ? Math.round(allTotal / allCount) : 0),
            average_30d: formatMoneyFromCents(recentCount > 0 ? Math.round(recentTotal / recentCount) : 0),
            total_invoices: allCount,
            invoices_last_30d: recentCount,
          },
          summary: `Average invoice: ${formatMoneyFromCents(allCount > 0 ? Math.round(allTotal / allCount) : 0)} (all time), ${formatMoneyFromCents(recentCount > 0 ? Math.round(recentTotal / recentCount) : 0)} (last 30 days).`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to get average invoice value' };
      }
    },
  },

  // ─── Weekly Invoice Activity ──────────────────────────────
  {
    id: 'billing.this_week',
    label: 'Invoices This Week',
    description: 'Get all invoices created or paid this week.',
    category: 'read',
    requiredPermissions: ['invoices.read'],
    parameters: [],
    execute: async () => {
      try {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);

        const orgId = await getCurrentOrgIdOrThrow();
        const { data, error } = await supabase
          .from('invoices')
          .select('id, invoice_number, client_id, status, total_cents, balance_cents, created_at, paid_at')
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .gte('created_at', startOfWeek.toISOString())
          .order('created_at', { ascending: false });

        if (error) throw error;

        const clientIds = [...new Set((data || []).map((i: any) => i.client_id).filter(Boolean))];
        const { data: clients } = await supabase
          .from('clients')
          .select('id, first_name, last_name, company')
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .in('id', clientIds.length > 0 ? clientIds : ['00000000-0000-0000-0000-000000000000']);

        const nameMap: Record<string, string> = {};
        for (const c of clients || []) {
          nameMap[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company || 'Unknown';
        }

        let created_total = 0;
        let paid_total = 0;

        const result = (data || []).map((inv: any) => {
          const cents = Number(inv.total_cents || 0);
          created_total += cents;
          if (inv.status === 'paid') paid_total += cents;
          return {
            id: inv.id,
            invoice_number: inv.invoice_number,
            client_name: nameMap[inv.client_id] || 'Unknown',
            status: inv.status,
            amount: formatMoneyFromCents(cents),
            created_at: inv.created_at,
          };
        });

        return {
          success: true,
          data: {
            invoices: result,
            created_count: result.length,
            created_total: formatMoneyFromCents(created_total),
            paid_total: formatMoneyFromCents(paid_total),
          },
          summary: `This week: ${result.length} invoices created (${formatMoneyFromCents(created_total)}), ${formatMoneyFromCents(paid_total)} paid.`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to get weekly invoices' };
      }
    },
  },

  // ─── Payment Analytics ────────────────────────────────────
  {
    id: 'billing.payments',
    label: 'Payment Analytics',
    description: 'Get payment statistics: total collected, methods breakdown, recent payments.',
    category: 'read',
    requiredPermissions: ['invoices.read'],
    parameters: [
      { name: 'period', type: 'string', description: 'Time period', required: false, enum: ['30d', 'this_month', 'this_year', 'all'], default: '30d' },
    ],
    execute: async (params) => {
      try {
        const period = (params.period as string) || '30d';
        const now = new Date();
        let startDate: string | null = null;

        if (period === '30d') {
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        } else if (period === 'this_month') {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        } else if (period === 'this_year') {
          startDate = new Date(now.getFullYear(), 0, 1).toISOString();
        }

        const orgId = await getCurrentOrgIdOrThrow();
        let query = supabase
          .from('payments')
          .select('id, amount_cents, method, status, payment_date, client_id')
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .eq('status', 'succeeded');

        if (startDate) {
          query = query.gte('payment_date', startDate);
        }

        const { data, error } = await query;
        if (error) throw error;

        let total = 0;
        const byMethod: Record<string, { count: number; total: number }> = {};

        for (const p of data || []) {
          const amt = Number(p.amount_cents || 0);
          total += amt;
          const method = p.method || 'other';
          if (!byMethod[method]) byMethod[method] = { count: 0, total: 0 };
          byMethod[method].count++;
          byMethod[method].total += amt;
        }

        return {
          success: true,
          data: {
            period,
            total_collected: formatMoneyFromCents(total),
            total_collected_cents: total,
            payment_count: (data || []).length,
            by_method: Object.entries(byMethod).map(([method, d]) => ({
              method,
              count: d.count,
              total: formatMoneyFromCents(d.total),
            })),
          },
          summary: `Payments (${period}): ${(data || []).length} payments, ${formatMoneyFromCents(total)} collected.`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to get payment analytics' };
      }
    },
  },
];
