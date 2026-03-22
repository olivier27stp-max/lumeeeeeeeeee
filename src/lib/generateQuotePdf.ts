import { jsPDF } from 'jspdf';
import type { QuoteDetail } from './quotesApi';
import { formatQuoteMoney } from './quotesApi';
import type { PdfCompanyInfo } from './generateInvoicePdf';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: 'Draft',
    action_required: 'Action Required',
    sent: 'Sent',
    awaiting_response: 'Awaiting Response',
    approved: 'Approved',
    declined: 'Declined',
    expired: 'Expired',
    converted: 'Converted',
  };
  return map[status] || status;
}

export function downloadQuotePdf(detail: QuoteDetail, company?: PdfCompanyInfo | null): void {
  const { quote, client, lead, line_items } = detail;
  const currency = quote.currency || 'CAD';
  const fmt = (cents: number) => formatQuoteMoney(cents, currency);
  const contact = client || lead;

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginL = 50;
  const marginR = 50;
  const contentW = pageW - marginL - marginR;
  let y = 50;

  const black = [17, 17, 17] as const;
  const darkGray = [51, 51, 51] as const;
  const midGray = [136, 136, 136] as const;
  const lightGray = [170, 170, 170] as const;

  // ── HEADER: Company info left, QUOTE right ──
  // Company name + contact
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...black);
  const companyName = company?.company_name || 'Business';
  doc.text(companyName, marginL, y);

  let companyY = y + 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...midGray);
  if (company?.company_address) {
    doc.text(company.company_address, marginL, companyY);
    companyY += 11;
  }
  if (company?.company_phone) {
    doc.text(company.company_phone, marginL, companyY);
    companyY += 11;
  }
  if (company?.company_email) {
    doc.text(company.company_email, marginL, companyY);
    companyY += 11;
  }

  // "QUOTE" title on the right
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(...black);
  doc.text('QUOTE', pageW - marginR, y + 4, { align: 'right' });

  // Quote number
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...midGray);
  doc.text(`#${quote.quote_number}`, pageW - marginR, y + 20, { align: 'right' });

  y = Math.max(companyY, y + 32) + 8;

  // ── Separator ──
  doc.setDrawColor(238, 238, 238);
  doc.setLineWidth(0.5);
  doc.line(marginL, y, pageW - marginR, y);
  y += 16;

  // ── META ROW: Prepared For (left) + Details (right) ──
  const metaLeftX = marginL;
  const metaRightX = pageW - marginR;

  // Left: Prepared For
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...lightGray);
  doc.text('PREPARED FOR', metaLeftX, y);
  y += 12;

  if (contact) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...black);
    const contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
    doc.text(contactName, metaLeftX, y);
    let contactY = y + 13;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...midGray);
    if ((contact as any).company) {
      doc.text((contact as any).company, metaLeftX, contactY);
      contactY += 11;
    }
    if (contact.email) {
      doc.text(contact.email, metaLeftX, contactY);
      contactY += 11;
    }
    if (contact.phone) {
      doc.text(contact.phone, metaLeftX, contactY);
    }
  }

  // Right: Details
  const detailsStartY = y - 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...lightGray);
  doc.text('DETAILS', metaRightX - 120, detailsStartY);

  const detailRows: [string, string][] = [];
  if (quote.created_at) detailRows.push(['Date', fmtDate(quote.created_at)]);
  if (quote.valid_until) detailRows.push(['Valid Until', fmtDate(quote.valid_until)]);
  detailRows.push(['Status', statusLabel(quote.status)]);

  let detailY = detailsStartY + 12;
  doc.setFontSize(8);
  for (const [label, value] of detailRows) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...midGray);
    doc.text(label, metaRightX - 120, detailY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...darkGray);
    doc.text(value, metaRightX, detailY, { align: 'right' });
    detailY += 13;
  }

  y = Math.max(y + 40, detailY + 4);

  // ── Title ──
  if (quote.title) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...darkGray);
    doc.text(quote.title, marginL, y);
    y += 14;
  }

  // ── Separator ──
  doc.setDrawColor(238, 238, 238);
  doc.line(marginL, y, pageW - marginR, y);
  y += 16;

  // ── LINE ITEMS TABLE ──
  const colX = {
    desc: marginL,
    qty: marginL + contentW * 0.6,
    unit: marginL + contentW * 0.76,
    total: pageW - marginR,
  };

  // Header row
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...lightGray);
  doc.text('DESCRIPTION', colX.desc, y);
  doc.text('QTY', colX.qty, y, { align: 'center' });
  doc.text('PRICE', colX.unit + 20, y, { align: 'right' });
  doc.text('TOTAL', colX.total, y, { align: 'right' });
  y += 6;
  doc.setDrawColor(229, 229, 229);
  doc.line(marginL, y, pageW - marginR, y);
  y += 12;

  const requiredItems = line_items.filter(i => !i.is_optional && i.item_type !== 'text');
  const optionalItems = line_items.filter(i => i.is_optional);

  doc.setFontSize(9);

  for (const item of requiredItems) {
    if (y > pageH - 120) {
      doc.addPage();
      y = 50;
    }

    if (item.item_type === 'heading') {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...black);
      doc.text(item.name, colX.desc, y);
      doc.setFont('helvetica', 'normal');
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(34, 34, 34);
      doc.text(item.name || '', colX.desc, y, { maxWidth: contentW * 0.55 });
      doc.setTextColor(...midGray);
      doc.text(String(item.quantity), colX.qty, y, { align: 'center' });
      doc.text(fmt(item.unit_price_cents), colX.unit + 20, y, { align: 'right' });
      doc.setTextColor(...black);
      doc.setFont('helvetica', 'normal');
      doc.text(fmt(item.total_cents), colX.total, y, { align: 'right' });

      // Description subtitle
      if (item.description) {
        y += 11;
        doc.setFontSize(7);
        doc.setTextColor(153, 153, 153);
        const descLines = doc.splitTextToSize(item.description, contentW * 0.55);
        doc.text(descLines, colX.desc, y);
        y += (descLines.length - 1) * 9;
        doc.setFontSize(9);
      }
    }

    y += 5;
    doc.setDrawColor(240, 240, 240);
    doc.line(marginL, y, pageW - marginR, y);
    y += 14;
  }

  // Optional items
  if (optionalItems.length > 0) {
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...lightGray);
    doc.text('OPTIONAL ITEMS', marginL, y);
    y += 12;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...midGray);

    for (const item of optionalItems) {
      if (y > pageH - 120) {
        doc.addPage();
        y = 50;
      }
      doc.text(item.name || '', colX.desc, y, { maxWidth: contentW * 0.55 });
      doc.text(String(item.quantity), colX.qty, y, { align: 'center' });
      doc.text(fmt(item.unit_price_cents), colX.unit + 20, y, { align: 'right' });
      doc.text(fmt(item.total_cents), colX.total, y, { align: 'right' });
      y += 5;
      doc.setDrawColor(245, 245, 245);
      doc.line(marginL, y, pageW - marginR, y);
      y += 14;
    }
    doc.setFont('helvetica', 'normal');
  }

  if (requiredItems.length === 0 && optionalItems.length === 0) {
    doc.setTextColor(204, 204, 204);
    doc.text('No line items', marginL, y);
    y += 20;
  }

  // ── TOTALS ──
  y += 10;
  const totalsX = pageW - marginR;
  const labelsX = totalsX - 160;

  const totalsRows: [string, string][] = [
    ['Subtotal', fmt(quote.subtotal_cents)],
  ];
  if (quote.discount_cents > 0) {
    totalsRows.push(['Discount', `-${fmt(quote.discount_cents)}`]);
  }
  if (quote.tax_cents > 0) {
    totalsRows.push([quote.tax_rate_label || 'Tax', fmt(quote.tax_cents)]);
  }

  doc.setFontSize(9);
  for (const [label, value] of totalsRows) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...midGray);
    doc.text(label, labelsX, y);
    doc.setTextColor(...darkGray);
    doc.text(value, totalsX, y, { align: 'right' });
    y += 16;
  }

  // Total line
  doc.setDrawColor(...black);
  doc.setLineWidth(0.5);
  doc.line(labelsX, y - 6, totalsX, y - 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...black);
  doc.text('Total', labelsX, y + 4);
  doc.text(fmt(quote.total_cents), totalsX, y + 4, { align: 'right' });
  y += 22;

  // Deposit info
  if (quote.deposit_required && quote.deposit_value > 0) {
    const depositCents = Number(quote.deposit_cents || 0) > 0
      ? Number(quote.deposit_cents)
      : quote.deposit_type === 'percentage'
        ? Math.round(quote.total_cents * Number(quote.deposit_value) / 100)
        : Math.round(Number(quote.deposit_value) * 100);

    // Light gray background
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(labelsX - 4, y - 10, totalsX - labelsX + 8, 32, 3, 3, 'F');

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(102, 102, 102);

    const depositLabel = quote.deposit_type === 'percentage'
      ? `Deposit required (${quote.deposit_value}%)`
      : 'Deposit required';
    doc.text(depositLabel, labelsX + 4, y + 2);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...black);
    doc.text(fmt(depositCents), totalsX - 4, y + 2, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...midGray);
    doc.text('Due upon acceptance', labelsX + 4, y + 14);

    y += 36;
  }

  // ── NOTES ──
  if (quote.notes) {
    y += 10;
    if (y > pageH - 80) {
      doc.addPage();
      y = 50;
    }
    doc.setDrawColor(238, 238, 238);
    doc.line(marginL, y - 6, pageW - marginR, y - 6);
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...lightGray);
    doc.text('NOTES', marginL, y);
    y += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(85, 85, 85);
    const noteLines = doc.splitTextToSize(quote.notes, contentW);
    doc.text(noteLines, marginL, y);
    y += noteLines.length * 11;
  }

  // ── TERMS & CONDITIONS ──
  if (quote.contract_disclaimer) {
    y += 10;
    if (y > pageH - 80) {
      doc.addPage();
      y = 50;
    }
    doc.setDrawColor(238, 238, 238);
    doc.line(marginL, y - 6, pageW - marginR, y - 6);
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...lightGray);
    doc.text('TERMS & CONDITIONS', marginL, y);
    y += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...midGray);
    const termLines = doc.splitTextToSize(quote.contract_disclaimer, contentW);
    doc.text(termLines, marginL, y);
  }

  // ── FOOTER ──
  const footerY = pageH - 30;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(187, 187, 187);
  doc.text(`${companyName} — Powered by Lume`, marginL, footerY);
  doc.text(
    `Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    pageW - marginR,
    footerY,
    { align: 'right' },
  );

  // ── Download ──
  const filename = `Quote_${quote.quote_number.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
  doc.save(filename);
}
