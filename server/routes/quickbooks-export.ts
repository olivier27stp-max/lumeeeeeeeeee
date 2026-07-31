/**
 * QuickBooks-compatible CSV exports.
 *
 * One-shot exports (NOT real-time OAuth sync) — generates CSV files that can be
 * imported into QuickBooks Online or QuickBooks Desktop (via IIF conversion).
 *
 * The QBO Customer / Invoice / Payment / Item CSV import templates are followed
 * here. The same CSV layout is broadly compatible with Wave Accounting imports
 * (customers + items in particular). Xero uses a different schema — out of
 * scope for V1.
 *
 * Caveats:
 *  - QBO doesn't accept a per-line tax_rate on import — it expects pre-configured
 *    Tax Codes. We export the tax amount on the line and leave TaxableSalesAmount /
 *    TaxAmount as best-effort. Users may need to assign a Tax Code per item in QBO.
 *  - Clients store a single `address` text field; we map it to BillingAddress Line 1
 *    and leave City / State / Postal / Country blank.
 *  - All exports are tenant-scoped via `org_id` and limited to 50k rows.
 */
import { Router, type Response } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { csvEscape } from '../lib/payments';
import { sendSafeError } from '../lib/error-handler';
import { logDataExport } from '../lib/data-export-log';

const router = Router();

const MAX_ROWS = 50_000;

// ── CSV helpers ────────────────────────────────────────────────────────────

/**
 * Defensive cell encoder.
 *  - Reuses csvEscape() (handles commas/quotes/newlines).
 *  - Mitigates CSV formula injection: cells whose first char is `=`, `+`, `-`, `@`
 *    are prefixed with a single quote so Excel/Sheets/QB don't evaluate them.
 *  - Empty/null → empty quoted string.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return csvEscape('');
  const text = String(value);
  if (text.length === 0) return csvEscape('');
  const first = text.charCodeAt(0);
  // = + - @ → prefix with apostrophe
  if (first === 0x3d || first === 0x2b || first === 0x2d || first === 0x40 || first === 0x09 || first === 0x0d) {
    return csvEscape(`'${text}`);
  }
  return csvEscape(text);
}

function rowLine(cells: unknown[]): string {
  return cells.map(cell).join(',') + '\r\n';
}

function setCsvHeaders(res: Response, filename: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  // Hint to clients that this is a streaming download
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function centsToAmount(cents: number | null | undefined): string {
  const n = Number(cents || 0);
  return (n / 100).toFixed(2);
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return '';
  // QBO accepts YYYY-MM-DD
  return String(value).slice(0, 10);
}

async function logExport(orgId: string, userId: string, kind: string, rows: number, req?: any) {
  try {
    const svc = getServiceClient();
    await svc.from('audit_events').insert({
      org_id: orgId,
      actor_id: userId,
      action: 'quickbooks_export',
      entity_type: 'export',
      entity_id: kind,
      metadata: { rows, format: 'csv' },
    });
  } catch {
    // audit_events may be absent in some envs — swallow silently
  }

  // N7.7 — alimenter aussi data_export_log, qui est la table consultee par
  // l'ecran de conformite (GET /api/security/export-log). audit_events seul
  // laissait cet ecran vide alors que des exports avaient bien eu lieu.
  if (req) {
    await logDataExport({
      orgId,
      userId,
      exportType: 'accounting',
      entityType: kind,
      recordCount: rows,
      req,
    });
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/quickbooks-export/customers.csv
 * QBO Customer Import format.
 */
router.get('/quickbooks-export/customers.csv', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const svc = getServiceClient();

    const filename = `lume-quickbooks-customers-${todayStamp()}.csv`;
    setCsvHeaders(res, filename);

    // Header row (QBO Customer Import column names)
    res.write(rowLine([
      'Name',
      'Company',
      'Email',
      'Phone',
      'BillingAddress Line 1',
      'BillingAddress City',
      'BillingAddress Province/State',
      'BillingAddress Postal Code',
      'BillingAddress Country',
      'Notes',
      'Customer Type',
    ]));

    let total = 0;
    const pageSize = 1000;
    let offset = 0;

    while (total < MAX_ROWS) {
      const { data, error } = await svc
        .from('clients')
        .select('id, first_name, last_name, company, email, phone, address, status, deleted_at')
        .eq('org_id', auth.orgId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const c of data) {
        const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.company || c.email || c.id;
        res.write(rowLine([
          fullName,
          c.company || '',
          c.email || '',
          c.phone || '',
          c.address || '',
          '',
          '',
          '',
          '',
          '',
          c.status || '',
        ]));
        total++;
        if (total >= MAX_ROWS) break;
      }
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    await logExport(auth.orgId, auth.user.id, 'customers', total, req);
    return res.end();
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to export customers.', '[quickbooks-export/customers]');
  }
});

/**
 * GET /api/quickbooks-export/invoices.csv?from=YYYY-MM-DD&to=YYYY-MM-DD
 * QBO Invoice Import format — one row per line item, header repeated.
 */
router.get('/quickbooks-export/invoices.csv', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const svc = getServiceClient();

    const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
    const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;

    const filename = `lume-quickbooks-invoices-${todayStamp()}.csv`;
    setCsvHeaders(res, filename);

    res.write(rowLine([
      'Customer',
      'InvoiceNo',
      'InvoiceDate',
      'DueDate',
      'Terms',
      'ProductService',
      'ItemDescription',
      'ItemQuantity',
      'ItemRate',
      'ItemAmount',
      'TaxableSalesAmount',
      'TaxAmount',
      'Total',
    ]));

    let total = 0;
    const pageSize = 500;
    let offset = 0;

    while (total < MAX_ROWS) {
      let q = svc
        .from('invoices')
        .select(`
          id, invoice_number, status, issued_at, due_date,
          subtotal_cents, tax_cents, total_cents,
          clients:client_id ( first_name, last_name, company, email ),
          invoice_items ( description, qty, unit_price_cents, line_total_cents )
        `)
        .eq('org_id', auth.orgId)
        .is('deleted_at', null)
        .in('status', ['sent', 'paid', 'partial'])
        .order('issued_at', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (from) q = q.gte('issued_at', `${from}T00:00:00Z`);
      if (to) q = q.lte('issued_at', `${to}T23:59:59Z`);

      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const inv of data as any[]) {
        const client = Array.isArray(inv.clients) ? inv.clients[0] : inv.clients;
        const customer = client
          ? ([client.first_name, client.last_name].filter(Boolean).join(' ').trim() || client.company || client.email || 'Customer')
          : 'Customer';
        const issued = fmtDate(inv.issued_at);
        const due = fmtDate(inv.due_date);
        const totalAmt = centsToAmount(inv.total_cents);
        const taxAmt = centsToAmount(inv.tax_cents);
        const subAmt = centsToAmount(inv.subtotal_cents);

        const items: any[] = Array.isArray(inv.invoice_items) && inv.invoice_items.length > 0
          ? inv.invoice_items
          : [{ description: inv.subject || '', qty: 1, unit_price_cents: inv.total_cents, line_total_cents: inv.total_cents }];

        for (const it of items) {
          res.write(rowLine([
            customer,
            inv.invoice_number || inv.id,
            issued,
            due,
            '', // Terms — not modeled
            '', // ProductService — line item linked product (not modeled per-line)
            it.description || '',
            Number(it.qty || 0).toString(),
            centsToAmount(it.unit_price_cents),
            centsToAmount(it.line_total_cents),
            subAmt,
            taxAmt,
            totalAmt,
          ]));
          total++;
          if (total >= MAX_ROWS) break;
        }
        if (total >= MAX_ROWS) break;
      }
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    await logExport(auth.orgId, auth.user.id, 'invoices', total, req);
    return res.end();
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to export invoices.', '[quickbooks-export/invoices]');
  }
});

/**
 * GET /api/quickbooks-export/payments.csv?from=&to=
 * Payments with status='succeeded' in the org.
 */
router.get('/quickbooks-export/payments.csv', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const svc = getServiceClient();

    const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
    const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;

    const filename = `lume-quickbooks-payments-${todayStamp()}.csv`;
    setCsvHeaders(res, filename);

    res.write(rowLine([
      'Customer',
      'ReceivedFrom',
      'PaymentDate',
      'Amount',
      'PaymentMethod',
      'ReferenceNo',
      'AppliedToInvoice',
      'Memo',
    ]));

    let total = 0;
    const pageSize = 500;
    let offset = 0;

    while (total < MAX_ROWS) {
      let q = svc
        .from('payments')
        .select(`
          id, status, method, provider, provider_payment_id,
          amount_cents, currency, payment_date,
          clients:client_id ( first_name, last_name, company, email ),
          invoices:invoice_id ( invoice_number )
        `)
        .eq('org_id', auth.orgId)
        .is('deleted_at', null)
        .eq('status', 'succeeded')
        .order('payment_date', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (from) q = q.gte('payment_date', `${from}T00:00:00Z`);
      if (to) q = q.lte('payment_date', `${to}T23:59:59Z`);

      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const p of data as any[]) {
        const client = Array.isArray(p.clients) ? p.clients[0] : p.clients;
        const customer = client
          ? ([client.first_name, client.last_name].filter(Boolean).join(' ').trim() || client.company || client.email || 'Customer')
          : 'Customer';
        const invoice = Array.isArray(p.invoices) ? p.invoices[0] : p.invoices;
        res.write(rowLine([
          customer,
          customer,
          fmtDate(p.payment_date),
          centsToAmount(p.amount_cents),
          p.method || p.provider || '',
          p.provider_payment_id || p.id,
          invoice?.invoice_number || '',
          `Imported from Lume CRM (${p.provider || 'manual'})`,
        ]));
        total++;
        if (total >= MAX_ROWS) break;
      }
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    await logExport(auth.orgId, auth.user.id, 'payments', total, req);
    return res.end();
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to export payments.', '[quickbooks-export/payments]');
  }
});

/**
 * GET /api/quickbooks-export/items.csv
 * Products/Services — sourced from `predefined_services`.
 */
router.get('/quickbooks-export/items.csv', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const svc = getServiceClient();

    const filename = `lume-quickbooks-items-${todayStamp()}.csv`;
    setCsvHeaders(res, filename);

    res.write(rowLine([
      'Name',
      'SKU',
      'Description',
      'SalesPrice',
      'IncomeAccount',
      'TaxCode',
    ]));

    let total = 0;
    const pageSize = 1000;
    let offset = 0;

    while (total < MAX_ROWS) {
      const { data, error } = await svc
        .from('predefined_services')
        .select('id, name, description, default_price_cents, category, is_active')
        .eq('org_id', auth.orgId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const item of data) {
        res.write(rowLine([
          item.name || '',
          '', // SKU not modeled
          item.description || '',
          centsToAmount(item.default_price_cents),
          'Services', // default QBO income account — user can remap
          '', // TaxCode — must be configured in QBO
        ]));
        total++;
        if (total >= MAX_ROWS) break;
      }
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    await logExport(auth.orgId, auth.user.id, 'items', total, req);
    return res.end();
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to export items.', '[quickbooks-export/items]');
  }
});

export default router;
