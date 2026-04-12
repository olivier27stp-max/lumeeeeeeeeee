/* ═══════════════════════════════════════════════════════════════
   AI Tools — Invoices
   ═══════════════════════════════════════════════════════════════ */

import type { ToolDefinition } from '../types';
import { listInvoices, getInvoiceById, fetchInvoicesKpis30d, type InvoiceStatusFilter } from '../../invoicesApi';

const STATUS_MAP: Record<string, InvoiceStatusFilter> = {
  draft: 'draft',
  sent: 'sent_not_due',
  paid: 'paid',
  overdue: 'past_due',
};

export const invoiceTools: ToolDefinition[] = [
  {
    id: 'invoices.search',
    label: 'Search Invoices',
    description: 'Search and list invoices by client name, invoice number, or status. Returns paginated results.',
    category: 'read',
    requiredPermissions: ['invoices.read'],
    parameters: [
      { name: 'query', type: 'string', description: 'Search term (client name, invoice number)', required: false },
      { name: 'status', type: 'string', description: 'Filter by status', required: false, enum: ['all', 'draft', 'sent', 'paid', 'overdue'] },
      { name: 'page', type: 'number', description: 'Page number (default 1)', required: false, default: 1 },
      { name: 'pageSize', type: 'number', description: 'Results per page (default 10, max 50)', required: false, default: 10 },
    ],
    execute: async (params) => {
      try {
        const statusKey = (params.status as string) || 'all';
        const result = await listInvoices({
          q: (params.query as string) || '',
          status: STATUS_MAP[statusKey] || 'all',
          range: 'all',
          sort: 'due_date_asc',
          page: Math.max(1, (params.page as number) || 1),
          pageSize: Math.min(50, Math.max(1, (params.pageSize as number) || 10)),
        });
        return {
          success: true,
          data: {
            invoices: result.rows.map((inv) => ({
              id: inv.id,
              invoice_number: inv.invoice_number,
              client_name: inv.client_name,
              status: inv.status,
              total_cents: inv.total_cents,
              currency: inv.currency,
              due_date: inv.due_date,
              issued_at: inv.issued_at,
            })),
            total: result.total,
          },
          summary: `Found ${result.total} invoice(s)${params.status ? ` with status "${params.status}"` : ''}.`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to search invoices' };
      }
    },
  },
  {
    id: 'invoices.get',
    label: 'Get Invoice Details',
    description: 'Get full details for a specific invoice by ID, including line items.',
    category: 'read',
    requiredPermissions: ['invoices.read'],
    parameters: [
      { name: 'invoiceId', type: 'string', description: 'The invoice UUID', required: true },
    ],
    execute: async (params) => {
      try {
        const detail = await getInvoiceById(params.invoiceId as string);
        if (!detail) {
          return { success: false, error: 'Invoice not found' };
        }
        return {
          success: true,
          data: detail,
          summary: `Invoice #${detail.invoice.invoice_number} — ${detail.invoice.client_name}`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to get invoice' };
      }
    },
  },
  {
    id: 'invoices.kpis',
    label: 'Invoice KPIs (30 days)',
    description: 'Get invoice statistics for the last 30 days: totals, paid, pending, overdue amounts.',
    category: 'read',
    requiredPermissions: ['invoices.read'],
    parameters: [],
    execute: async () => {
      try {
        const kpis = await fetchInvoicesKpis30d();
        return {
          success: true,
          data: kpis,
          summary: 'Invoice KPIs (30-day) retrieved.',
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to get invoice KPIs' };
      }
    },
  },
];
