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

const MONTH_ABBR_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_ABBR_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
const MONTH_FULL_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_FULL_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

/** "YYYY-MM-DD" → "15 avr" / "Apr 15", parsed from the parts (no timezone drift). */
function fmtVisitShort(date: string): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return date;
  const abbr = (isFr() ? MONTH_ABBR_FR : MONTH_ABBR_EN)[Number(m[2]) - 1] || '';
  const day = Number(m[3]);
  return isFr() ? `${day} ${abbr.toLowerCase()}` : `${abbr} ${day}`;
}

/** "YYYY-MM-DD" → "mercredi 12 août 2026" (local date parts, no timezone drift). */
function fmtVisitFull(date: string): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return date;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(isFr() ? 'fr-CA' : 'en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
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

  // ── SERVICE PLAN: one 12-month grid per planned year ──
  if (data.servicePlan && data.servicePlan.visits.length > 0) {
    const plan = data.servicePlan;
    // Group visits by year — legacy plans carry no per-visit year (all in plan.year).
    const byYear = new Map<number, Record<number, string[]>>();
    for (const v of plan.visits) {
      const yr = v.year ?? plan.year;
      if (!byYear.has(yr)) byYear.set(yr, {});
      const months = byYear.get(yr)!;
      (months[v.month] = months[v.month] || []).push(v.date);
    }
    const planYears = [...byYear.keys()].sort((a, b) => a - b);
    const multiYearPlan = planYears.length > 1;

    const gap = 6;
    const boxW = (contentW - gap * 3) / 4;
    const boxH = 26;
    const abbrs = isFr() ? MONTH_ABBR_FR : MONTH_ABBR_EN;

    for (const planYear of planYears) {
      const datesByMonth = byYear.get(planYear)!;
      const yearCount = Object.values(datesByMonth).reduce((sum, list) => sum + list.length, 0);
      // Keep the year's header + grid on one page.
      if (y > pageH - (3 * boxH + 2 * gap + 40)) {
        doc.addPage();
        y = 50;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...lightGray);
      doc.text(`${L('SERVICE PLAN', 'PLAN DE SERVICE')} — ${planYear}`, marginL, y);
      doc.text(
        `${yearCount} ${yearCount > 1 ? L('VISITS', 'VISITES') : L('VISIT', 'VISITE')}`,
        pageW - marginR, y, { align: 'right' },
      );
      y += 8;

      for (let i = 0; i < 12; i++) {
        const x = marginL + (i % 4) * (boxW + gap);
        const boxY = y + Math.floor(i / 4) * (boxH + gap);
        const dates = [...(datesByMonth[i + 1] || [])].sort();
        const selected = dates.length > 0;
        if (selected) {
          doc.setFillColor(250, 250, 250);
          doc.setDrawColor(...black);
        } else {
          doc.setFillColor(255, 255, 255);
          doc.setDrawColor(229, 231, 235);
        }
        doc.setLineWidth(0.75);
        doc.roundedRect(x, boxY, boxW, boxH, 4, 4, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        if (selected) doc.setTextColor(...black); else doc.setTextColor(209, 213, 219);
        doc.text(abbrs[i].toUpperCase(), x + 7, boxY + 10);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        if (selected) doc.setTextColor(...black); else doc.setTextColor(229, 231, 235);
        const cellText = selected
          ? fmtVisitShort(dates[0]) + (dates.length > 1 ? ` +${dates.length - 1}` : '')
          : '—';
        doc.text(cellText, x + 7, boxY + 20);
      }
      y += 3 * boxH + 2 * gap + 18;
    }

    // Visits with their full dates, below the grids (chronological, all years)
    const sortedVisits = [...plan.visits].sort((a, b) => a.date.localeCompare(b.date));
    const monthNames = isFr() ? MONTH_FULL_FR : MONTH_FULL_EN;
    doc.setLineWidth(0.5);
    for (let i = 0; i < sortedVisits.length; i++) {
      if (y > pageH - 60) {
        doc.addPage();
        y = 50;
      }
      const v = sortedVisits[i];
      const monthLabel = (monthNames[v.month - 1] || '') + (multiYearPlan ? ` ${v.year ?? plan.year}` : '');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(34, 34, 34);
      doc.text(`${L('Visit', 'Visite')} ${i + 1} · ${monthLabel}`, marginL, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(85, 85, 85);
      doc.text(fmtVisitFull(v.date), pageW - marginR, y, { align: 'right' });
      y += 6;
      if (i < sortedVisits.length - 1) {
        doc.setDrawColor(240, 240, 240);
        doc.line(marginL, y, pageW - marginR, y);
      }
      y += 10;
    }

    doc.setDrawColor(238, 238, 238);
    doc.setLineWidth(0.5);
    doc.line(marginL, y - 6, pageW - marginR, y - 6);
    y += 10;
  }

  // ── SERVICES TABLE ──
  // Service plan: state explicitly that prices are the plan total, not per visit.
  if (data.servicePlan && data.servicePlan.visits.length > 1) {
    if (y > pageH - 120) {
      doc.addPage();
      y = 50;
    }
    const n = data.servicePlan.visits.length;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...midGray);
    const noteLines = doc.splitTextToSize(
      L(
        `The prices below cover all ${n} planned visits of the plan — this is not a price charged per visit.`,
        `Les prix ci-dessous couvrent la totalité des ${n} visites prévues au plan — il ne s'agit pas d'un prix facturé à chaque visite.`,
      ),
      contentW,
    );
    doc.text(noteLines, marginL, y);
    y += noteLines.length * 10 + 8;
  }
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

  // ── PAYMENT TERMS ──
  if (data.paymentTerms && (data.paymentTerms.deposit_required || data.paymentTerms.require_payment_method)) {
    const pt = data.paymentTerms;
    y += 6;
    if (y > pageH - 120) {
      doc.addPage();
      y = 50;
    }
    doc.setDrawColor(238, 238, 238);
    doc.line(marginL, y - 6, pageW - marginR, y - 6);
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...lightGray);
    doc.text(L('PAYMENT TERMS', 'MODALITÉS DE PAIEMENT'), marginL, y);
    y += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...darkGray);
    if (pt.deposit_required) {
      const pct = pt.deposit_type === 'percentage' ? L(` (${pt.deposit_value}% of the total)`, ` (${pt.deposit_value} % du total)`) : '';
      doc.text(
        L(
          `A deposit of ${formatCents(pt.deposit_cents)}${pct} is required to confirm this contract.`,
          `Un dépôt de ${formatCents(pt.deposit_cents)}${pct} est requis pour confirmer ce contrat.`,
        ),
        marginL,
        y,
      );
      y += 12;
    }
    if (pt.require_payment_method) {
      doc.text(
        L('A payment method on file is required.', 'Une méthode de paiement au dossier est requise.'),
        marginL,
        y,
      );
      y += 12;
    }
    y += 4;
  }

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
