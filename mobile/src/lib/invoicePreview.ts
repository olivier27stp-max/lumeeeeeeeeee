// Builds self-contained HTML documents for the in-app invoice/quote previews,
// rendered in a WebView on the Send screens. They use our own data (no network,
// no Stripe), so the preview ALWAYS shows — even when the business hasn't
// connected payments yet and the client-facing web page refuses to render.
//
// The look mirrors the desktop "Business Pro" invoice template
// (src/components/invoice/templates/BusinessProTemplate.tsx): dark branded
// header, status badge, zebra item table, paid/balance totals. Every field is
// wired to real data (company contact + client contact + invoice status/balance).

import type { InvoiceRow, InvoiceItemRow } from './api/billing';
import type { CompanySettings } from './api/org';
import { formatCurrencyCents } from './format';
import type { ClientRecord } from '@/types/db';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "2026-07-14" or an ISO date → "July 14, 2026" (falls back gracefully). */
function prettyDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return esc(value);
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

function clientName(c: ClientRecord | null): string {
  if (!c) return 'Client';
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return name || c.company || 'Client';
}

/** Light-grey contact lines for the bill-to block (company, address, email, phone). */
function clientLines(c: ClientRecord | null): string {
  if (!c) return '';
  const hasName = [c.first_name, c.last_name].filter(Boolean).length > 0;
  const lines = [
    hasName && c.company ? c.company : null,
    c.address,
    [c.city, c.province, c.postal_code].filter(Boolean).join(', '),
    c.email,
    c.phone,
  ].filter(Boolean);
  return lines.map((l) => `<div>${esc(l)}</div>`).join('');
}

/** White/60 contact lines for the dark header (company address, email, phone). */
function companyLines(co: CompanySettings | null | undefined): string {
  if (!co) return '';
  const lines = [
    [co.street1, co.street2].filter(Boolean).join(', '),
    [co.city, co.province, co.postal_code].filter(Boolean).join(', '),
    co.email,
    co.phone,
  ].filter(Boolean);
  return lines.map((l) => `<div>${esc(l)}</div>`).join('');
}

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  draft: { label: 'Draft', bg: '#f1f5f9', fg: '#475569' },
  sent: { label: 'Open', bg: '#dbeafe', fg: '#1d4ed8' },
  sent_not_due: { label: 'Open', bg: '#dbeafe', fg: '#1d4ed8' },
  partial: { label: 'Partial', bg: '#fef3c7', fg: '#a16207' },
  paid: { label: 'Paid', bg: '#dcfce7', fg: '#15803d' },
  void: { label: 'Void', bg: '#fecaca', fg: '#b91c1c' },
  overdue: { label: 'Overdue', bg: '#fecaca', fg: '#b91c1c' },
};

function statusBadge(status: string | null | undefined): string {
  const st = STATUS[String(status ?? 'sent')] || STATUS.sent;
  return `<span class="badge" style="background:${st.bg};color:${st.fg}">
    <span class="dot" style="background:${st.fg}"></span>${esc(st.label)}</span>`;
}

const DOC_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
    color: #262626; background: #f1f5f9; font-size: 13px; line-height: 1.6;
    -webkit-text-size-adjust: 100%;
  }
  .doc { background: #fff; margin: 10px; border-radius: 12px; overflow: hidden; box-shadow: 0 6px 20px rgba(0,0,0,0.08); }
  .head { background: #171717; color: #fff; padding: 18px 16px 14px; display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .head .logo { height: 32px; max-width: 130px; object-fit: contain; filter: brightness(0) invert(1); display: block; }
  .head .cname { font-size: 17px; font-weight: 800; letter-spacing: -0.3px; }
  .head .caddr { margin-top: 6px; font-size: 10px; color: rgba(255,255,255,0.6); line-height: 1.45; }
  .head .right { text-align: right; flex-shrink: 0; }
  .head .right .lbl { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: rgba(255,255,255,0.5); }
  .head .right .no { font-size: 18px; font-weight: 800; letter-spacing: -0.3px; margin-top: 2px; }
  .body { padding: 16px; }
  .meta { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 10px; padding-bottom: 14px; border-bottom: 1px solid #e2e8f0; }
  .lbl { font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #94a3b8; }
  .billname { font-size: 15px; font-weight: 800; color: #171717; margin-top: 5px; }
  .billextra { font-size: 10px; color: #64748b; margin-top: 3px; line-height: 1.5; }
  .meta .right { text-align: right; }
  .badge { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 3px 8px; font-size: 9px; font-weight: 700; }
  .badge .dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; }
  .dates { font-size: 10px; color: #94a3b8; margin-top: 7px; line-height: 1.6; }
  .dates b { color: #475569; font-weight: 600; }
  .subject { padding: 12px 0; border-bottom: 1px solid #e2e8f0; font-size: 13px; font-weight: 700; color: #171717; }
  table.items { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 4px; }
  table.items thead th { background: #171717; color: #fff; font-size: 9px; font-weight: 600; letter-spacing: 0.3px; text-transform: uppercase; padding: 7px; text-align: left; }
  table.items th.num, table.items td.num { text-align: right; white-space: nowrap; width: 70px; }
  table.items th.qty, table.items td.qty { text-align: center; width: 30px; }
  table.items tbody td { padding: 8px 7px; font-size: 11px; border-bottom: 1px solid #f1f5f9; vertical-align: top; word-wrap: break-word; overflow-wrap: break-word; }
  table.items tbody tr:nth-child(even) { background: #f8fafc; }
  table.items td.amt { font-weight: 700; }
  table.items td.empty { text-align: center; color: #cbd5e1; padding: 26px 8px; }
  .tot { display: flex; justify-content: flex-end; padding: 12px 0 2px; border-bottom: 1px solid #e2e8f0; }
  .tot table { width: 64%; min-width: 0; border-collapse: collapse; font-size: 11px; }
  .tot td { padding: 5px 2px; }
  .tot td.k { color: #94a3b8; }
  .tot td.v { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .tot tr.total td { font-size: 14px; font-weight: 800; color: #171717; padding-top: 8px; }
  .tot tr.disc td { color: #dc2626; }
  .tot tr.paid td { color: #15803d; font-weight: 600; }
  .tot tr.bal td { font-weight: 800; color: #171717; border-top: 1px solid #e2e8f0; padding-top: 7px; }
  .foot { padding: 14px 16px 18px; text-align: center; font-size: 9px; color: #cbd5e1; line-height: 1.5; }
`;

/** The Business Pro shell — dark header, bill-to + status, items, totals. */
function businessProDoc(args: {
  brandHtml: string; // logo or company name (rendered white on dark)
  companyContact: string;
  docLabel: string; // "INVOICE" / "QUOTE"
  number: string;
  billToName: string;
  billToExtra?: string;
  statusHtml?: string;
  datesHtml: string;
  subject?: string | null;
  itemRows: string;
  totalsRows: string;
  footer: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<style>${DOC_CSS}</style>
</head>
<body>
  <div class="doc">
    <div class="head">
      <div>
        ${args.brandHtml}
        ${args.companyContact ? `<div class="caddr">${args.companyContact}</div>` : ''}
      </div>
      <div class="right">
        <div class="lbl">${esc(args.docLabel)}</div>
        <div class="no">${args.number ? `#${esc(args.number)}` : ''}</div>
      </div>
    </div>

    <div class="body">
      <div class="meta">
        <div>
          <div class="lbl">Bill to</div>
          <div class="billname">${esc(args.billToName)}</div>
          ${args.billToExtra ? `<div class="billextra">${args.billToExtra}</div>` : ''}
        </div>
        <div class="right">
          ${args.statusHtml ?? ''}
          <div class="dates">${args.datesHtml}</div>
        </div>
      </div>

      ${args.subject ? `<div class="subject">${esc(args.subject)}</div>` : ''}

      <table class="items">
        <thead>
          <tr>
            <th>Description</th>
            <th class="qty">Qty</th>
            <th class="num">Rate</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>${args.itemRows}</tbody>
      </table>

      <div class="tot"><table>${args.totalsRows}</table></div>

      <div class="foot">${esc(args.footer)}</div>
    </div>
  </div>
</body>
</html>`;
}

/** White logo (inverted) or company name for the dark header. */
function brandHtml(name: string | null | undefined, logoUrl: string | null | undefined): string {
  const logo = typeof logoUrl === 'string' && /^https?:\/\//i.test(logoUrl) ? logoUrl : null;
  return logo
    ? `<img class="logo" src="${esc(logo)}" alt="${esc(name ?? '')}" />`
    : `<div class="cname">${esc(name || 'Your company')}</div>`;
}

export function buildInvoicePreviewHtml(args: {
  company?: CompanySettings | null;
  companyName?: string | null;
  companyLogoUrl?: string | null;
  invoice: InvoiceRow;
  items: InvoiceItemRow[];
  client: ClientRecord | null;
}): string {
  const { company, invoice, items, client } = args;
  const name = company?.company_name ?? args.companyName ?? null;
  const logo = company?.logo_url ?? args.companyLogoUrl ?? null;
  const currency = invoice.currency ?? 'CAD';
  const money = (cents: number | null | undefined) => esc(formatCurrencyCents(cents ?? 0, currency));

  const subtotal = invoice.subtotal_cents ?? items.reduce((s, it) => s + (it.line_total_cents ?? 0), 0);
  const tax = invoice.tax_cents ?? 0;
  const total = invoice.total_cents ?? subtotal + tax;
  const balance = invoice.balance_cents;
  const paid = balance != null ? Math.max(total - balance, 0) : 0;

  const itemRows = items.length
    ? items
        .map(
          (it) => `
        <tr>
          <td>${esc(it.description || 'Item')}</td>
          <td class="qty">${esc(it.qty ?? 1)}</td>
          <td class="num">${money(it.unit_price_cents)}</td>
          <td class="num amt">${money(it.line_total_cents)}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td class="empty" colspan="4">No line items.</td></tr>`;

  const totalsRows = `
    <tr><td class="k">Subtotal</td><td class="v">${money(subtotal)}</td></tr>
    <tr><td class="k">Tax</td><td class="v">${money(tax)}</td></tr>
    <tr class="total"><td>Total</td><td class="v">${money(total)}</td></tr>
    ${paid > 0 ? `<tr class="paid"><td>Paid</td><td class="v">${money(paid)}</td></tr>` : ''}
    ${balance != null && balance !== total ? `<tr class="bal"><td>Balance due</td><td class="v">${money(balance)}</td></tr>` : ''}`;

  return businessProDoc({
    brandHtml: brandHtml(name, logo),
    companyContact: companyLines(company),
    docLabel: 'Invoice',
    number: invoice.invoice_number ?? '',
    billToName: clientName(client),
    billToExtra: clientLines(client),
    statusHtml: statusBadge(invoice.status),
    datesHtml: `Issued: <b>${prettyDate(invoice.created_at)}</b><br/>Due: <b>${prettyDate(invoice.due_date)}</b>`,
    subject: invoice.subject,
    itemRows,
    totalsRows,
    footer: `${name ?? ''}${company?.email ? ` · ${company.email}` : ''}${company?.phone ? ` · ${company.phone}` : ''}`.trim() || 'Thank you for your business.',
  });
}

export function buildQuotePreviewHtml(args: {
  company?: CompanySettings | null;
  companyName?: string | null;
  companyLogoUrl?: string | null;
  title?: string | null;
  quoteNumber?: string | null;
  validUntil?: string | null;
  clientName: string | null;
  items: { name?: string | null; qty: number; unit_price_cents: number }[];
  subtotalCents: number;
  discountCents?: number;
  taxCents: number;
  totalCents: number;
  depositCents?: number;
  currency?: string | null;
}): string {
  const name = args.company?.company_name ?? args.companyName ?? null;
  const logo = args.company?.logo_url ?? args.companyLogoUrl ?? null;
  const currency = args.currency ?? 'CAD';
  const money = (cents: number | null | undefined) => esc(formatCurrencyCents(cents ?? 0, currency));

  const itemRows = args.items.length
    ? args.items
        .map(
          (it) => `
        <tr>
          <td>${esc(it.name || 'Item')}</td>
          <td class="qty">${esc(it.qty ?? 1)}</td>
          <td class="num">${money(it.unit_price_cents)}</td>
          <td class="num amt">${money(Math.round((it.qty ?? 0) * (it.unit_price_cents ?? 0)))}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td class="empty" colspan="4">No line items.</td></tr>`;

  const discount = args.discountCents ?? 0;
  const deposit = args.depositCents ?? 0;
  const totalsRows = `
    <tr><td class="k">Subtotal</td><td class="v">${money(args.subtotalCents)}</td></tr>
    ${discount > 0 ? `<tr class="disc"><td>Discount</td><td class="v">- ${money(discount)}</td></tr>` : ''}
    <tr><td class="k">Tax</td><td class="v">${money(args.taxCents)}</td></tr>
    <tr class="total"><td>Total</td><td class="v">${money(args.totalCents)}</td></tr>
    ${deposit > 0 ? `<tr class="bal"><td>Deposit due</td><td class="v">${money(deposit)}</td></tr>` : ''}`;

  return businessProDoc({
    brandHtml: brandHtml(name, logo),
    companyContact: companyLines(args.company),
    docLabel: 'Quote',
    number: args.quoteNumber ?? '',
    billToName: args.clientName || 'Client',
    datesHtml: args.validUntil ? `Valid until: <b>${prettyDate(args.validUntil)}</b>` : '—',
    subject: args.title,
    itemRows,
    totalsRows,
    footer: `${name ?? ''}${args.company?.email ? ` · ${args.company.email}` : ''}`.trim() || 'We look forward to working with you.',
  });
}
