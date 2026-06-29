// Builds self-contained HTML documents for the in-app invoice/quote previews,
// rendered in a WebView on the Send screens. They use our own data (no network,
// no Stripe), so the preview ALWAYS shows — even when the business hasn't
// connected payments yet and the client-facing web page refuses to render.

import type { InvoiceRow, InvoiceItemRow } from './api/billing';
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

function clientAddress(c: ClientRecord | null): string {
  if (!c) return '';
  const lines = [
    c.company && [c.first_name, c.last_name].filter(Boolean).length ? c.company : null,
    c.address,
    [c.city, c.province, c.postal_code].filter(Boolean).join(', '),
    c.email,
    c.phone,
  ].filter(Boolean);
  return lines.map((l) => `<div>${esc(l)}</div>`).join('');
}

/** Company brand block: logo (if set in desktop company settings) with the name
 * underneath — falls back to just the name when no logo is configured. */
function brandBlock(companyName: string | null | undefined, companyLogoUrl: string | null | undefined): string {
  const logo = typeof companyLogoUrl === 'string' && /^https?:\/\//i.test(companyLogoUrl) ? companyLogoUrl : null;
  const name = `<div class="company">${esc(companyName || 'Your company')}</div>`;
  return logo ? `<img class="logo" src="${esc(logo)}" alt="" />${name}` : name;
}

const DOC_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
    color: #171717;
    background: #f5f5f5;
    -webkit-text-size-adjust: 100%;
  }
  .sheet {
    background: #ffffff;
    margin: 16px;
    padding: 24px 22px 28px;
    border-radius: 16px;
    box-shadow: 0 6px 24px rgba(0,0,0,0.06);
  }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .brand { max-width: 60%; }
  .logo { max-width: 160px; max-height: 64px; width: auto; height: auto; object-fit: contain; display: block; margin-bottom: 6px; }
  .company { font-size: 18px; font-weight: 800; letter-spacing: -0.2px; }
  .tag { text-transform: uppercase; letter-spacing: 1.5px; font-size: 11px; font-weight: 700; color: #8a8a8a; }
  .doc-no { font-size: 14px; font-weight: 700; margin-top: 2px; }
  .meta { text-align: right; font-size: 12px; color: #555; line-height: 1.5; }
  .meta b { color: #171717; }
  .billto { margin-top: 22px; font-size: 13px; line-height: 1.5; }
  .billto .label { text-transform: uppercase; letter-spacing: 1.2px; font-size: 10px; font-weight: 700; color: #8a8a8a; margin-bottom: 4px; }
  .billto .name { font-weight: 700; font-size: 14px; }
  .subject { margin-top: 18px; font-size: 14px; font-weight: 600; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 13px; }
  table.items th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #8a8a8a; padding: 8px 6px; border-bottom: 1px solid #eaeaea; }
  table.items th.num, table.items td.num { text-align: right; white-space: nowrap; }
  table.items td { padding: 11px 6px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  table.items td.desc { width: 52%; }
  table.items td.empty { text-align: center; color: #9a9a9a; padding: 22px 6px; }
  .totals { width: 100%; margin-top: 16px; }
  .totals table { margin-left: auto; border-collapse: collapse; font-size: 13px; min-width: 220px; }
  .totals td { padding: 6px 4px; }
  .totals td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  .totals tr.total td { font-size: 16px; font-weight: 800; border-top: 2px solid #171717; padding-top: 10px; }
  .totals tr.balance td { font-weight: 700; color: #b00020; }
  .footer { margin-top: 24px; font-size: 11px; color: #9a9a9a; text-align: center; }
`;

/** Shared document shell: brand + meta header, bill-to, line-item table, totals. */
function docShell(args: {
  brand: string;
  docType: string;
  number: string;
  metaRows: string;
  billToName: string;
  billToExtra?: string;
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
  <div class="sheet">
    <div class="top">
      <div class="brand">
        ${args.brand}
        <div class="tag" style="margin-top:8px;">${esc(args.docType)}</div>
        <div class="doc-no">${args.number ? `#${esc(args.number)}` : ''}</div>
      </div>
      <div class="meta">${args.metaRows}</div>
    </div>

    <div class="billto">
      <div class="label">Bill to</div>
      <div class="name">${esc(args.billToName)}</div>
      ${args.billToExtra ?? ''}
    </div>

    ${args.subject ? `<div class="subject">${esc(args.subject)}</div>` : ''}

    <table class="items">
      <thead>
        <tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>${args.itemRows}</tbody>
    </table>

    <div class="totals">
      <table>${args.totalsRows}</table>
    </div>

    <div class="footer">${esc(args.footer)}</div>
  </div>
</body>
</html>`;
}

export function buildInvoicePreviewHtml(args: {
  companyName: string | null;
  companyLogoUrl?: string | null;
  invoice: InvoiceRow;
  items: InvoiceItemRow[];
  client: ClientRecord | null;
}): string {
  const { companyName, companyLogoUrl, invoice, items, client } = args;
  const currency = invoice.currency ?? 'CAD';
  const money = (cents: number | null | undefined) => esc(formatCurrencyCents(cents ?? 0, currency));

  const subtotal = invoice.subtotal_cents ?? items.reduce((s, it) => s + (it.line_total_cents ?? 0), 0);
  const tax = invoice.tax_cents ?? 0;
  const total = invoice.total_cents ?? subtotal + tax;
  const balance = invoice.balance_cents;

  const itemRows = items.length
    ? items
        .map(
          (it) => `
        <tr>
          <td class="desc">${esc(it.description || 'Item')}</td>
          <td class="num">${esc(it.qty ?? 1)}</td>
          <td class="num">${money(it.unit_price_cents)}</td>
          <td class="num">${money(it.line_total_cents)}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td class="desc empty" colspan="4">No line items.</td></tr>`;

  const totalsRows = `
    <tr><td>Subtotal</td><td>${money(subtotal)}</td></tr>
    <tr><td>Tax</td><td>${money(tax)}</td></tr>
    <tr class="total"><td>Total</td><td>${money(total)}</td></tr>
    ${balance != null && balance !== total ? `<tr class="balance"><td>Balance due</td><td>${money(balance)}</td></tr>` : ''}`;

  return docShell({
    brand: brandBlock(companyName, companyLogoUrl),
    docType: 'Invoice',
    number: invoice.invoice_number ?? '',
    metaRows: `
      <div>Issued: <b>${prettyDate(invoice.created_at)}</b></div>
      <div>Due: <b>${prettyDate(invoice.due_date)}</b></div>`,
    billToName: clientName(client),
    billToExtra: clientAddress(client),
    subject: invoice.subject,
    itemRows,
    totalsRows,
    footer: 'Thank you for your business.',
  });
}

export function buildQuotePreviewHtml(args: {
  companyName: string | null;
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
  const currency = args.currency ?? 'CAD';
  const money = (cents: number | null | undefined) => esc(formatCurrencyCents(cents ?? 0, currency));

  const itemRows = args.items.length
    ? args.items
        .map(
          (it) => `
        <tr>
          <td class="desc">${esc(it.name || 'Item')}</td>
          <td class="num">${esc(it.qty ?? 1)}</td>
          <td class="num">${money(it.unit_price_cents)}</td>
          <td class="num">${money(Math.round((it.qty ?? 0) * (it.unit_price_cents ?? 0)))}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td class="desc empty" colspan="4">No line items.</td></tr>`;

  const discount = args.discountCents ?? 0;
  const deposit = args.depositCents ?? 0;
  const totalsRows = `
    <tr><td>Subtotal</td><td>${money(args.subtotalCents)}</td></tr>
    ${discount > 0 ? `<tr><td>Discount</td><td>- ${money(discount)}</td></tr>` : ''}
    <tr><td>Tax</td><td>${money(args.taxCents)}</td></tr>
    <tr class="total"><td>Total</td><td>${money(args.totalCents)}</td></tr>
    ${deposit > 0 ? `<tr class="balance"><td>Deposit due</td><td>${money(deposit)}</td></tr>` : ''}`;

  return docShell({
    brand: brandBlock(args.companyName, args.companyLogoUrl),
    docType: 'Quote',
    number: args.quoteNumber ?? '',
    metaRows: args.validUntil ? `<div>Valid until: <b>${prettyDate(args.validUntil)}</b></div>` : '',
    billToName: args.clientName || 'Client',
    subject: args.title,
    itemRows,
    totalsRows,
    footer: 'We look forward to working with you.',
  });
}
