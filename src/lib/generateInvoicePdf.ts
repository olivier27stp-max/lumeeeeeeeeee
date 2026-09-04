import { jsPDF } from 'jspdf';
import { versDate } from './dateSeule';
import type { InvoiceDetail } from './invoicesApi';
import { formatMoneyFromCents, toClientDisplayName } from './invoicesApi';

export interface PdfCompanyInfo {
  company_name?: string | null;
  company_email?: string | null;
  company_phone?: string | null;
  company_address?: string | null;
}

export interface PdfTaxLine {
  name: string;
  rate: number;
  amount_cents: number;
  registration_number?: string | null;
}

const isFr = (): boolean => (typeof localStorage !== 'undefined' && localStorage.getItem('lume-language') === 'fr');

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '--';
  const d = versDate(iso); // date seule -> minuit local, pas la veille
  if (Number.isNaN(d.getTime())) return '--';
  const locale = isFr() ? 'fr-CA' : 'en-CA';
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusLabel(status: string): string {
  const en: Record<string, string> = {
    draft: 'Draft', sent: 'Sent', partial: 'Partially Paid', paid: 'Paid', void: 'Void', overdue: 'Overdue',
  };
  const fr: Record<string, string> = {
    draft: 'Brouillon', sent: 'Envoyée', partial: 'Partiellement payée', paid: 'Payée', void: 'Annulée', overdue: 'En retard',
  };
  const map = isFr() ? fr : en;
  return map[status] || status;
}

function L(en: string, fr: string): string { return isFr() ? fr : en; }

/**
 * Generate and trigger download of a professional invoice PDF.
 */
export function downloadInvoicePdf(detail: InvoiceDetail, company?: PdfCompanyInfo | null, taxBreakdown?: PdfTaxLine[] | null): void {
  const { invoice, client, items } = detail;
  const currency = invoice.currency || 'CAD';
  const fmt = (cents: number) => formatMoneyFromCents(cents, currency);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const marginL = 50;
  const marginR = 50;
  const contentW = pageW - marginL - marginR;
  let y = 50;

  // ── Company header ──────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(30, 30, 30);
  doc.text(L('INVOICE', 'FACTURE'), marginL, y);

  // Company name under INVOICE
  if (company?.company_name) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    const companyLines = [company.company_name];
    if (company.company_address) companyLines.push(company.company_address);
    if (company.company_email) companyLines.push(company.company_email);
    if (company.company_phone) companyLines.push(company.company_phone);
    let companyY = y + 16;
    for (const line of companyLines) {
      doc.text(line, marginL, companyY);
      companyY += 12;
    }
  }

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(invoice.invoice_number, pageW - marginR, y, { align: 'right' });

  y += 30;

  // ── Invoice meta ────────────────────────────────────────────────
  const metaLeft = [
    [L('Status', 'Statut'), statusLabel(invoice.status)],
    [L('Date', 'Date'), fmtDate(invoice.created_at)],
    [L('Due Date', 'Échéance'), fmtDate(invoice.due_date)],
    [L('Issued', 'Émise'), fmtDate(invoice.issued_at)],
  ];

  doc.setFontSize(9);
  for (const [label, value] of metaLeft) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 100, 100);
    doc.text(`${label}:`, marginL, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    doc.text(value, marginL + 70, y);
    y += 14;
  }

  // ── Client info (right column, same vertical area) ──────────────
  const clientStartY = y - metaLeft.length * 14;
  const rightCol = pageW - marginR;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(L('Bill To:', 'Facturer à :'), rightCol - 180, clientStartY);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 30, 30);
  const clientName = client ? toClientDisplayName(client) : invoice.client_name;
  doc.text(clientName, rightCol - 180, clientStartY + 14);

  let cY = clientStartY + 28;
  if (client?.email) {
    doc.text(client.email, rightCol - 180, cY);
    cY += 14;
  }
  if (client?.phone) {
    doc.text(client.phone, rightCol - 180, cY);
    cY += 14;
  }

  if (invoice.subject) {
    y += 6;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text(`${L('Subject', 'Objet')}: ${invoice.subject}`, marginL, y);
  }

  y += 24;

  // ── Line items table ────────────────────────────────────────────
  const colX = {
    desc: marginL,
    qty: marginL + contentW * 0.55,
    unit: marginL + contentW * 0.7,
    total: pageW - marginR,
  };

  // Table header
  doc.setFillColor(245, 245, 245);
  doc.rect(marginL, y - 12, contentW, 18, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text(L('DESCRIPTION', 'DESCRIPTION'), colX.desc + 6, y);
  doc.text(L('QTY', 'QTÉ'), colX.qty, y, { align: 'right' });
  doc.text(L('UNIT PRICE', 'PRIX UNIT.'), colX.unit + 40, y, { align: 'right' });
  doc.text(L('TOTAL', 'TOTAL'), colX.total, y, { align: 'right' });

  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 30);

  for (const item of items) {
    // Check if we need a new page
    if (y > doc.internal.pageSize.getHeight() - 120) {
      doc.addPage();
      y = 50;
    }

    doc.text(item.description || '', colX.desc + 6, y, { maxWidth: contentW * 0.5 });
    doc.text(String(item.qty), colX.qty, y, { align: 'right' });
    doc.text(fmt(item.unit_price_cents), colX.unit + 40, y, { align: 'right' });
    doc.text(fmt(item.line_total_cents), colX.total, y, { align: 'right' });

    // Light separator
    y += 4;
    doc.setDrawColor(230, 230, 230);
    doc.line(marginL, y, pageW - marginR, y);
    y += 16;
  }

  if (items.length === 0) {
    doc.setTextColor(150, 150, 150);
    doc.text(L('No line items', 'Aucun élément'), marginL + 6, y);
    y += 20;
  }

  // ── Totals ──────────────────────────────────────────────────────
  y += 10;
  const totalsX = pageW - marginR;
  const labelsX = totalsX - 140;

  const discountCents = (invoice as any).discount_cents || 0;
  const totalsRows: [string, string][] = [
    [L('Subtotal', 'Sous-total'), fmt(invoice.subtotal_cents)],
  ];
  if (discountCents > 0) {
    totalsRows.push([L('Discount', 'Rabais'), `-${fmt(discountCents)}`]);
  }
  // Show individual taxes if breakdown available, otherwise single total
  if (taxBreakdown && taxBreakdown.length > 0) {
    for (const tax of taxBreakdown) {
      totalsRows.push([`${tax.name} (${tax.rate}%)`, fmt(tax.amount_cents)]);
    }
  } else {
    totalsRows.push([L('Tax', 'Taxes'), fmt(invoice.tax_cents)]);
  }

  doc.setFontSize(9);
  for (const [label, value] of totalsRows) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(label, labelsX, y);
    doc.setTextColor(30, 30, 30);
    doc.text(value, totalsX, y, { align: 'right' });
    y += 16;
  }

  // Total (bold, larger)
  doc.setDrawColor(30, 30, 30);
  doc.line(labelsX, y - 6, totalsX, y - 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);
  doc.text(L('Total', 'Total'), labelsX, y + 4);
  doc.text(fmt(invoice.total_cents), totalsX, y + 4, { align: 'right' });
  y += 22;

  // Paid & Balance
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(L('Paid', 'Payé'), labelsX, y);
  doc.setTextColor(30, 30, 30);
  doc.text(fmt(invoice.paid_cents), totalsX, y, { align: 'right' });
  y += 16;

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(invoice.balance_cents > 0 ? 180 : 80, invoice.balance_cents > 0 ? 40 : 140, invoice.balance_cents > 0 ? 40 : 80);
  doc.text(L('Balance Due', 'Solde dû'), labelsX, y);
  doc.text(fmt(invoice.balance_cents), totalsX, y, { align: 'right' });

  // ── Notes ──────────────────────────────────────────────────────
  const invoiceNotes = (invoice as any).notes;
  if (invoiceNotes) {
    y += 20;
    if (y > doc.internal.pageSize.getHeight() - 80) {
      doc.addPage();
      y = 50;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(L('NOTES', 'NOTES'), marginL, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    const noteLines = doc.splitTextToSize(invoiceNotes, contentW);
    doc.text(noteLines, marginL, y);
  }

  // ── Tax Registration Numbers ────────────────────────────────────
  const regNums = (taxBreakdown || []).filter(t => t.registration_number);
  if (regNums.length > 0) {
    y += 20;
    if (y > doc.internal.pageSize.getHeight() - 80) {
      doc.addPage();
      y = 50;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    for (const tax of regNums) {
      doc.text(`${tax.name} ${L('No', 'Nº')}: ${tax.registration_number}`, marginL, y);
      y += 11;
    }
  }

  // ── Footer ──────────────────────────────────────────────────────
  const footerY = doc.internal.pageSize.getHeight() - 30;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(160, 160, 160);
  const footerLocale = isFr() ? 'fr-CA' : 'en-CA';
  const footerDate = new Date().toLocaleDateString(footerLocale, { year: 'numeric', month: 'long', day: 'numeric' });
  const footerLabel = L('Generated on', 'Généré le');
  doc.text(`${footerLabel} ${footerDate}`, marginL, footerY);

  // ── Download ────────────────────────────────────────────────────
  const filename = `${invoice.invoice_number.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
  doc.save(filename);
}
