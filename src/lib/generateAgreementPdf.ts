import { jsPDF } from 'jspdf';
import { formatCents } from './jobCalc';
import type { AgreementDocData } from '../components/agreements/AgreementDocument';

const isFr = (): boolean => (typeof localStorage !== 'undefined' && localStorage.getItem('lume-language') === 'fr');
function L(en: string, fr: string): string { return isFr() ? fr : en; }

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  const locale = isFr() ? 'fr-CA' : 'en-CA';
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Same layout as the quote/invoice PDFs, adapted to the contract document. */
export function downloadAgreementPdf(data: AgreementDocData): void {
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

  // ── HEADER: company info left, CONTRAT right ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...black);
  doc.text(data.company.name, marginL, y);

  let companyY = y + 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...midGray);
  for (const line of [data.company.address, data.company.phone, data.company.email, data.company.website]) {
    if (!line) continue;
    doc.text(line, marginL, companyY);
    companyY += 11;
  }
  if (data.company.taxLines.length > 0) {
    doc.text(data.company.taxLines.join('  ·  '), marginL, companyY);
    companyY += 11;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(...black);
  doc.text(L('CONTRACT', 'CONTRAT'), pageW - marginR, y + 4, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...midGray);
  doc.text(data.agreementNumber, pageW - marginR, y + 20, { align: 'right' });
  doc.text(`${L('Created', 'Créé le')} ${fmtDate(data.createdAt)}`, pageW - marginR, y + 32, { align: 'right' });

  y = Math.max(companyY, y + 44) + 8;

  // ── Separator ──
  doc.setDrawColor(238, 238, 238);
  doc.setLineWidth(0.5);
  doc.line(marginL, y, pageW - marginR, y);
  y += 16;

  // ── PARTIES: client (left) + work address (right) ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...lightGray);
  doc.text('CLIENT', marginL, y);
  doc.text(L('WORK ADDRESS', 'ADRESSE DES TRAVAUX'), pageW - marginR, y, { align: 'right' });
  y += 12;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...black);
  doc.text(data.clientName || '--', marginL, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...darkGray);
  const addrLines = doc.splitTextToSize(data.propertyAddress || '--', contentW * 0.4);
  doc.text(addrLines, pageW - marginR, y, { align: 'right' });

  let leftY = y + 12;
  doc.setTextColor(...midGray);
  for (const line of [data.clientEmail, data.clientPhone]) {
    if (!line) continue;
    doc.text(line, marginL, leftY);
    leftY += 11;
  }
  y = Math.max(leftY, y + addrLines.length * 11) + 10;

  // ── Separator ──
  doc.setDrawColor(238, 238, 238);
  doc.line(marginL, y, pageW - marginR, y);
  y += 16;

  // ── SERVICES TABLE ──
  const colX = {
    desc: marginL,
    qty: marginL + contentW * 0.6,
    unit: marginL + contentW * 0.76,
    total: pageW - marginR,
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...lightGray);
  doc.text(L('SERVICE(S)', 'SERVICE(S)'), colX.desc, y);
  doc.text(L('QTY', 'QTÉ'), colX.qty, y, { align: 'center' });
  doc.text(L('UNIT PRICE', 'PRIX UNITAIRE'), colX.unit + 20, y, { align: 'right' });
  doc.text(L('AMOUNT', 'MONTANT'), colX.total, y, { align: 'right' });
  y += 6;
  doc.setDrawColor(229, 229, 229);
  doc.line(marginL, y, pageW - marginR, y);
  y += 12;

  doc.setFontSize(9);
  for (const item of data.items) {
    if (y > pageH - 120) {
      doc.addPage();
      y = 50;
    }
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(34, 34, 34);
    const nameLines = doc.splitTextToSize(item.name || '', contentW * 0.55);
    doc.text(nameLines, colX.desc, y);
    doc.setTextColor(...midGray);
    doc.text(String(item.qty), colX.qty, y, { align: 'center' });
    doc.text(formatCents(item.unit_price_cents), colX.unit + 20, y, { align: 'right' });
    doc.setTextColor(...black);
    doc.text(formatCents(item.total_cents), colX.total, y, { align: 'right' });
    y += (nameLines.length - 1) * 11 + 5;
    doc.setDrawColor(240, 240, 240);
    doc.line(marginL, y, pageW - marginR, y);
    y += 14;
  }
  if (data.items.length === 0) {
    doc.setTextColor(204, 204, 204);
    doc.text(L('No services', 'Aucun service'), marginL, y);
    y += 20;
  }

  // ── TOTALS ──
  y += 10;
  const totalsX = pageW - marginR;
  const labelsX = totalsX - 160;

  const totalsRows: [string, string][] = [
    [L('Subtotal', 'Sous-total'), formatCents(data.subtotalCents)],
    ...(data.discount && data.discount.amount_cents > 0
      ? [[
          `${L('Discount', 'Rabais')}${data.discount.percent ? ` (${data.discount.percent}%)` : ''}`,
          `-${formatCents(data.discount.amount_cents)}`,
        ] as [string, string]]
      : []),
    ...data.taxLines.map((tx): [string, string] => [`${tx.label} (${tx.rate}%)`, formatCents(tx.amount_cents)]),
  ];

  doc.setFontSize(9);
  for (const [label, value] of totalsRows) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...midGray);
    doc.text(label, labelsX, y);
    doc.setTextColor(...darkGray);
    doc.text(value, totalsX, y, { align: 'right' });
    y += 16;
  }

  doc.setDrawColor(...black);
  doc.setLineWidth(0.5);
  doc.line(labelsX, y - 6, totalsX, y - 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...black);
  doc.text('Total', labelsX, y + 4);
  doc.text(formatCents(data.totalCents), totalsX, y + 4, { align: 'right' });
  y += 26;

  // ── TERMS & CONDITIONS ──
  if (data.terms) {
    y += 6;
    if (y > pageH - 140) {
      doc.addPage();
      y = 50;
    }
    doc.setDrawColor(238, 238, 238);
    doc.line(marginL, y - 6, pageW - marginR, y - 6);
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...lightGray);
    doc.text(L('TERMS & CONDITIONS', 'TERMES ET CONDITIONS'), marginL, y);
    y += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...midGray);
    const termLines = doc.splitTextToSize(data.terms, contentW);
    for (const line of termLines) {
      if (y > pageH - 100) {
        doc.addPage();
        y = 50;
      }
      doc.text(line, marginL, y);
      y += 9;
    }
    y += 8;
  }

  // ── SIGNATURE ──
  if (data.requireSignature) {
    if (y > pageH - 120) {
      doc.addPage();
      y = 50;
    }
    doc.setDrawColor(238, 238, 238);
    doc.line(marginL, y, pageW - marginR, y);
    y += 16;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...darkGray);
    doc.text(
      L('I have read and accept the terms and conditions.', "J'ai lu et j'accepte les termes et conditions."),
      marginL, y,
    );
    y += 14;

    if (data.signature) {
      // Signature is a PNG data URL — embed it directly.
      try {
        doc.addImage(data.signature.signatureData, 'PNG', marginL, y, 140, 42);
      } catch { /* corrupted data URL — keep the line only */ }
      y += 50;
      doc.setDrawColor(153, 153, 153);
      doc.line(marginL, y, marginL + 180, y);
      y += 10;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...midGray);
      doc.text(
        `${L('Client signature', 'Signature du client')} — ${data.signature.signerName}`,
        marginL, y,
      );
      doc.text(
        `${L('Signed on', 'Signé le')} ${fmtDate(data.signature.signedAt)}`,
        pageW - marginR, y, { align: 'right' },
      );
    } else {
      y += 34;
      doc.setDrawColor(153, 153, 153);
      doc.line(marginL, y, marginL + 180, y);
      doc.line(pageW - marginR - 100, y, pageW - marginR, y);
      y += 10;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...midGray);
      doc.text(L('Client signature', 'Signature du client'), marginL, y);
      doc.text('Date', pageW - marginR - 100, y);
    }
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...midGray);
    doc.text(`${L('Contract issued on', 'Contrat émis le')} ${fmtDate(data.createdAt)}`, marginL, y);
  }

  // ── FOOTER ──
  const footerY = pageH - 30;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(187, 187, 187);
  doc.text(`${data.company.name} — Powered by Lume`, marginL, footerY);
  const fLocale = isFr() ? 'fr-CA' : 'en-CA';
  doc.text(
    `${L('Generated', 'Généré le')} ${new Date().toLocaleDateString(fLocale, { year: 'numeric', month: 'long', day: 'numeric' })}`,
    pageW - marginR,
    footerY,
    { align: 'right' },
  );

  const filename = `Contract_${data.agreementNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
  doc.save(filename);
}
