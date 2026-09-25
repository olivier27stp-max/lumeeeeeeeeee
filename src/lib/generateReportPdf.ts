/**
 * PDF d'un rapport (Réglages → Rapports) — jsPDF, même famille que les
 * factures, devis et rapports Lumi.
 *
 * Le PDF est un document qu'on envoie à un comptable ou qu'on imprime pour
 * une réunion : il porte l'identité de l'entreprise (logo, nom, accent),
 * le contexte de ce qui a été demandé (période, filtres en clair, auteur,
 * horodatage), des chiffres clés en tête, puis le tableau complet avec
 * en-tête répété, lignes alternées, totaux et pagination « Page X / Y ».
 *
 * Les valeurs sont formatées avec les MÊMES fonctions que l'écran
 * (reportFormat.ts) : ce qui est imprimé est ce qui était affiché.
 */
import { jsPDF } from 'jspdf';
import type { Lang, ReportColumn, ReportExportData } from './reportsApi';
import { formatCell, formatTotal, isNumericColumn } from './reportFormat';
import { getAgreementCompanyBranding, type AgreementCompanyBranding } from './agreementDoc';
import { resolveStorageUrl } from './storage';

type Rgb = [number, number, number];

const INK: Rgb = [23, 23, 23];
const INK_SOFT: Rgb = [107, 107, 107];
const INK_MUTED: Rgb = [163, 163, 163];
const ZEBRA: Rgb = [247, 247, 248];
const TOTAL_FILL: Rgb = [243, 244, 246];
const TILE_FILL: Rgb = [245, 245, 245];
const LINE: Rgb = [229, 231, 235];
const HEADER_FILL: Rgb = [23, 23, 23];
const WHITE: Rgb = [255, 255, 255];

const MARGIN = 40;
const FOOTER_H = 26;

export interface ReportPdfBranding {
  company: AgreementCompanyBranding | null;
  /** Logo en data URL PNG (déjà chargé), ou null. */
  logo: { dataUrl: string; width: number; height: number } | null;
}

/** Helvetica (police intégrée) n'a ni l'espace insécable étroite ni l'emoji. */
function clean(s: unknown): string {
  return String(s ?? '').replace(/[  ]/g, ' ').replace(/[\u{1F300}-\u{1FAFF}]/gu, '').trim();
}

function hexToRgb(hex: string | null | undefined): Rgb | null {
  const m = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Un accent trop clair sur du blanc ne se voit pas : on garde l'encre dans ce cas. */
function accentOf(company: AgreementCompanyBranding | null): Rgb {
  const rgb = hexToRgb(company?.brand_color);
  if (!rgb) return INK;
  const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  return luminance > 0.82 ? INK : rgb;
}

/**
 * Charge le logo en PNG via un canvas (accepte PNG, JPEG, WebP, SVG). Sans
 * CORS ou si l'image ne répond pas en 4 s, on rend le PDF sans logo — jamais
 * d'échec d'export pour une image.
 */
export async function loadLogoForPdf(url: string | null | undefined): Promise<ReportPdfBranding['logo']> {
  if (!url || typeof document === 'undefined') return null;
  try {
    const resolved = await resolveStorageUrl(url);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      const timer = setTimeout(() => reject(new Error('logo timeout')), 4000);
      el.onload = () => { clearTimeout(timer); resolve(el); };
      el.onerror = () => { clearTimeout(timer); reject(new Error('logo load failed')); };
      el.src = resolved;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const scale = Math.min(1, 400 / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
}

/** Largeur « naturelle » d'une colonne (points), selon son type et sa largeur d'écran. */
function naturalWidth(col: ReportColumn): number {
  switch (col.type) {
    case 'money': return 66;
    case 'date': return 58;
    case 'datetime': return 84;
    case 'integer': case 'number': case 'hours': case 'percent': return 50;
    case 'enum': return 66;
    default: {
      const w = String(col.width || '');
      if (w.endsWith('fr')) return Math.max(80, Math.min(190, Math.round(Number(w.slice(0, -2)) * 110)));
      if (w.endsWith('px')) return Math.max(44, Math.min(190, Math.round(Number(w.slice(0, -2)) * 0.6)));
      return 100;
    }
  }
}

/** Répartit la largeur utile entre les colonnes ; les colonnes texte absorbent le surplus. */
export function layoutColumns(columns: ReportColumn[], contentW: number): { widths: number[]; fontSize: number } {
  const natural = columns.map(naturalWidth);
  const sum = natural.reduce((a, b) => a + b, 0);
  if (sum <= contentW) {
    const textIdx = columns.map((c, i) => (isNumericColumn(c) || c.type === 'date' || c.type === 'datetime' ? -1 : i)).filter((i) => i >= 0);
    const extra = contentW - sum;
    const widths = [...natural];
    if (textIdx.length) for (const i of textIdx) widths[i] += extra / textIdx.length;
    else for (let i = 0; i < widths.length; i++) widths[i] += extra / widths.length;
    return { widths, fontSize: 8 };
  }
  const scale = contentW / sum;
  const widths = natural.map((w) => Math.max(30, w * scale));
  const fontSize = scale < 0.6 ? 6.2 : scale < 0.8 ? 7 : 7.6;
  return { widths, fontSize };
}

function truncate(doc: jsPDF, text: string, maxW: number): string {
  let t = text;
  if (doc.getTextWidth(t) <= maxW) return t;
  while (t.length > 1 && doc.getTextWidth(`${t}…`) > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function kpiTiles(data: ReportExportData, lang: Lang): Array<{ label: string; value: string }> {
  const fr = lang === 'fr';
  const tiles: Array<{ label: string; value: string }> = [
    { label: fr ? 'Lignes' : 'Rows', value: data.rows.length.toLocaleString(fr ? 'fr-CA' : 'en-CA') },
  ];
  if (data.totals) {
    for (const c of data.columns) {
      if (c.total !== 'sum' || data.totals[c.key] === undefined) continue;
      tiles.push({ label: c.label[lang], value: formatTotal(c, data.totals[c.key], lang) });
      if (tiles.length >= 6) break;
    }
  }
  return tiles;
}

/**
 * Construit le document. Pur : pas d'accès réseau, pas de téléchargement —
 * `downloadReportPdf` s'occupe du chargement de l'identité et de l'enregistrement.
 */
export function buildReportPdf(data: ReportExportData, branding: ReportPdfBranding): jsPDF {
  const lang = data.meta.lang;
  const fr = lang === 'fr';
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  const accent = accentOf(branding.company);
  const companyName = clean(branding.company?.company_name || data.meta.company);
  const columns = data.columns;
  const { widths, fontSize } = layoutColumns(columns, contentW);
  const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const rowH = fontSize + 8.5;
  const headerH = fontSize + 11;
  const bottomLimit = pageH - MARGIN - FOOTER_H;

  doc.setProperties({
    title: `${data.meta.title} — ${companyName || 'Lume'}`,
    subject: data.meta.period,
    author: clean(data.meta.generatedBy || companyName || 'Lume CRM'),
    creator: 'Lume CRM',
  });

  let y = MARGIN;

  // ── Bandeau d'identité ─────────────────────────────────────────
  let leftX = MARGIN;
  if (branding.logo) {
    const maxH = 30; const maxW = 110;
    const ratio = Math.min(maxH / branding.logo.height, maxW / branding.logo.width);
    const w = branding.logo.width * ratio; const h = branding.logo.height * ratio;
    try {
      doc.addImage(branding.logo.dataUrl, 'PNG', MARGIN, y - 4, w, h);
      leftX = MARGIN + w + 10;
    } catch {
      leftX = MARGIN;
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  if (companyName) doc.text(truncate(doc, companyName, contentW * 0.5), leftX, y + 8);
  const contactBits = [branding.company?.phone, branding.company?.email, branding.company?.website].filter(Boolean).map(clean);
  if (contactBits.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...INK_SOFT);
    doc.text(truncate(doc, contactBits.join('  ·  '), contentW * 0.5), leftX, y + 19);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...INK_SOFT);
  const genLine = `${fr ? 'Généré le' : 'Generated'} ${clean(data.meta.generatedAtLabel)}${data.meta.generatedBy ? ` ${fr ? 'par' : 'by'} ${clean(data.meta.generatedBy)}` : ''}`;
  doc.text(genLine, pageW - MARGIN, y + 8, { align: 'right' });
  doc.text(fr ? 'Lume CRM · Rapport' : 'Lume CRM · Report', pageW - MARGIN, y + 19, { align: 'right' });
  y += 46;

  // ── Titre, description, contexte ───────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...INK);
  doc.text(clean(data.meta.title), MARGIN, y);
  y += 15;
  if (data.meta.description) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK_SOFT);
    doc.text(truncate(doc, clean(data.meta.description), contentW), MARGIN, y);
    y += 13;
  }
  const context = [`${fr ? 'Période' : 'Period'} : ${clean(data.meta.period)}`, ...data.meta.filters.map((f) => `${clean(f.label)} : ${clean(f.value)}`)];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text(truncate(doc, context.join('   ·   '), contentW), MARGIN, y);
  y += 8;
  doc.setDrawColor(...accent);
  doc.setLineWidth(1.6);
  doc.line(MARGIN, y, MARGIN + contentW, y);
  y += 14;

  // ── Chiffres clés ──────────────────────────────────────────────
  const tiles = kpiTiles(data, lang);
  if (tiles.length) {
    const gap = 8;
    const tileW = (contentW - gap * (tiles.length - 1)) / tiles.length;
    const tileH = 38;
    tiles.forEach((t, i) => {
      const x = MARGIN + i * (tileW + gap);
      doc.setFillColor(...TILE_FILL);
      doc.roundedRect(x, y, tileW, tileH, 4, 4, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(...INK_SOFT);
      doc.text(truncate(doc, clean(t.label).toUpperCase(), tileW - 16), x + 9, y + 13);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12.5);
      doc.setTextColor(...INK);
      doc.text(truncate(doc, clean(t.value), tileW - 16), x + 9, y + 29);
    });
    y += tileH + 16;
  }

  // ── Tableau ────────────────────────────────────────────────────
  const drawHeader = () => {
    doc.setFillColor(...HEADER_FILL);
    doc.rect(MARGIN, y, contentW, headerH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    doc.setTextColor(...WHITE);
    columns.forEach((c, i) => {
      const right = isNumericColumn(c);
      const label = truncate(doc, clean(c.label[lang]), widths[i] - 8);
      doc.text(label, right ? xs[i] + widths[i] - 4 : xs[i] + 4, y + headerH - (fontSize * 0.35) - 3, { align: right ? 'right' : 'left' });
    });
    y += headerH;
  };

  const newPage = () => {
    doc.addPage();
    y = MARGIN;
    drawHeader();
  };

  drawHeader();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(fontSize);
  if (data.rows.length === 0) {
    doc.setTextColor(...INK_MUTED);
    doc.text(fr ? 'Aucune ligne pour ces filtres.' : 'No rows for these filters.', MARGIN + 4, y + rowH - 6);
    y += rowH;
  }
  data.rows.forEach((row, idx) => {
    if (y + rowH > bottomLimit) newPage();
    if (idx % 2 === 1) {
      doc.setFillColor(...ZEBRA);
      doc.rect(MARGIN, y, contentW, rowH, 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(...INK);
    columns.forEach((c, i) => {
      const text = clean(formatCell(c, row[c.key], lang));
      if (!text) return;
      const right = isNumericColumn(c);
      doc.text(truncate(doc, text, widths[i] - 8), right ? xs[i] + widths[i] - 4 : xs[i] + 4, y + rowH - (fontSize * 0.35) - 3, { align: right ? 'right' : 'left' });
    });
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y + rowH, MARGIN + contentW, y + rowH);
    y += rowH;
  });

  // ── Totaux ─────────────────────────────────────────────────────
  const hasTotals = !!data.totals && columns.some((c) => c.total === 'sum');
  if (hasTotals && data.rows.length > 0) {
    if (y + rowH + 2 > bottomLimit) newPage();
    doc.setFillColor(...TOTAL_FILL);
    doc.rect(MARGIN, y, contentW, rowH + 2, 'F');
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.8);
    doc.line(MARGIN, y, MARGIN + contentW, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    doc.setTextColor(...INK);
    columns.forEach((c, i) => {
      const right = isNumericColumn(c);
      const text = c.total === 'sum' ? clean(formatTotal(c, data.totals?.[c.key], lang)) : i === 0 ? (fr ? 'Totaux' : 'Totals') : '';
      if (!text) return;
      doc.text(truncate(doc, text, widths[i] - 8), right ? xs[i] + widths[i] - 4 : xs[i] + 4, y + rowH - (fontSize * 0.35) - 2, { align: right ? 'right' : 'left' });
    });
    y += rowH + 2;
  }

  // ── Pieds de page (après coup : on connaît le nombre de pages) ─
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const fy = pageH - MARGIN + 6;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, fy - 10, MARGIN + contentW, fy - 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...INK_MUTED);
    const left = [companyName, clean(data.meta.title), clean(data.meta.period)].filter(Boolean).join('  ·  ');
    doc.text(truncate(doc, left, contentW * 0.7), MARGIN, fy);
    doc.text(`${fr ? 'Page' : 'Page'} ${p} / ${pages}`, pageW - MARGIN, fy, { align: 'right' });
  }

  return doc;
}

/** Charge l'identité de l'entreprise (nom, coordonnées, logo, accent) puis enregistre le PDF. */
export async function downloadReportPdf(data: ReportExportData): Promise<number> {
  let company: AgreementCompanyBranding | null = null;
  try { company = await getAgreementCompanyBranding(); } catch { company = null; }
  const logo = await loadLogoForPdf(company?.logo_url);
  const doc = buildReportPdf(data, { company, logo });
  doc.save(data.fileName || `rapport-${data.meta.reportId}.pdf`);
  return data.rows.length;
}
