/**
 * PDF d'un rapport Lumi (jsPDF, comme les factures et devis).
 *
 * Le rapport arrive DÉJÀ formaté du serveur (montants, dates, libellés) : ce
 * fichier ne fait que la mise en page — titre, chiffres clés en cases,
 * tableaux paginés avec en-tête répété, pied de page numéroté.
 */
import { jsPDF } from 'jspdf';
import type { RapportLumi, SectionRapportLumi } from './lumiApi';

const MARGE = 50;
const NOIR: [number, number, number] = [30, 30, 30];
const GRIS: [number, number, number] = [110, 110, 110];
const GRIS_CLAIR: [number, number, number] = [243, 244, 246];
const LIGNE: [number, number, number] = [225, 227, 231];

interface Cadre { doc: jsPDF; y: number; pageW: number; pageH: number; contentW: number; rapport: RapportLumi; }

function fr(r: RapportLumi): boolean { return r.langue === 'fr'; }

function nettoyer(s: string): string {
  // Helvetica (police intégrée) n'a ni l'espace insécable étroite ni l'emoji.
  return String(s ?? '').replace(/[  ]/g, ' ').replace(/[\u{1F300}-\u{1FAFF}]/gu, '').trim();
}

function nouvellePage(c: Cadre): void {
  c.doc.addPage();
  c.y = MARGE;
}

function assurerPlace(c: Cadre, hauteur: number): void {
  if (c.y + hauteur > c.pageH - MARGE - 20) nouvellePage(c);
}

function titreSection(c: Cadre, titre: string, hauteurSuivante = 70): void {
  // Le titre et le début de son contenu restent ensemble.
  assurerPlace(c, 40 + hauteurSuivante);
  c.y += 10;
  c.doc.setFont('helvetica', 'bold');
  c.doc.setFontSize(12);
  c.doc.setTextColor(...NOIR);
  c.doc.text(nettoyer(titre), MARGE, c.y);
  c.y += 6;
  c.doc.setDrawColor(...LIGNE);
  c.doc.setLineWidth(0.6);
  c.doc.line(MARGE, c.y, MARGE + c.contentW, c.y);
  c.y += 14;
}

function kpis(c: Cadre, items: NonNullable<SectionRapportLumi['kpis']>): void {
  const parLigne = 3;
  const ecart = 10;
  const largeur = (c.contentW - ecart * (parLigne - 1)) / parLigne;
  const hauteur = 46;
  for (let i = 0; i < items.length; i += parLigne) {
    assurerPlace(c, hauteur + 8);
    const rangee = items.slice(i, i + parLigne);
    rangee.forEach((k, j) => {
      const x = MARGE + j * (largeur + ecart);
      c.doc.setFillColor(...GRIS_CLAIR);
      c.doc.roundedRect(x, c.y, largeur, hauteur, 4, 4, 'F');
      c.doc.setFont('helvetica', 'normal');
      c.doc.setFontSize(8);
      c.doc.setTextColor(...GRIS);
      c.doc.text(nettoyer(k.label).slice(0, 40), x + 8, c.y + 13);
      c.doc.setFont('helvetica', 'bold');
      c.doc.setFontSize(13);
      c.doc.setTextColor(...NOIR);
      c.doc.text(nettoyer(k.valeur), x + 8, c.y + 30);
      if (k.detail) {
        c.doc.setFont('helvetica', 'normal');
        c.doc.setFontSize(7.5);
        c.doc.setTextColor(...GRIS);
        c.doc.text(nettoyer(k.detail).slice(0, 48), x + 8, c.y + 41);
      }
    });
    c.y += hauteur + 8;
  }
}

function tableau(c: Cadre, t: NonNullable<SectionRapportLumi['tableau']>): void {
  const n = Math.max(1, t.colonnes.length);
  const avecEntete = t.colonnes.some((h) => h.trim());
  // Largeurs : la première colonne d'un tableau « clé/valeur » est étroite ; sinon, parts égales, colonnes de nombres plus fines.
  const poids = t.colonnes.map((_, i) => (n === 2 && !avecEntete ? (i === 0 ? 0.35 : 0.65) : (t.alignements?.[i] === 'd' ? 0.8 : 1.15)));
  const total = poids.reduce((a, b) => a + b, 0);
  const largeurs = poids.map((p) => (p / total) * c.contentW);
  const xs = largeurs.map((_, i) => MARGE + largeurs.slice(0, i).reduce((a, b) => a + b, 0));
  const ligneH = 16;

  const entete = () => {
    if (!avecEntete) return;
    c.doc.setFillColor(...GRIS_CLAIR);
    c.doc.rect(MARGE, c.y - 11, c.contentW, ligneH, 'F');
    c.doc.setFont('helvetica', 'bold');
    c.doc.setFontSize(8.5);
    c.doc.setTextColor(...GRIS);
    t.colonnes.forEach((h, i) => {
      const droite = t.alignements?.[i] === 'd';
      c.doc.text(nettoyer(h), droite ? xs[i] + largeurs[i] - 6 : xs[i] + 6, c.y, { align: droite ? 'right' : 'left' });
    });
    c.y += ligneH;
  };

  assurerPlace(c, ligneH * 3);
  entete();
  c.doc.setFont('helvetica', 'normal');
  c.doc.setFontSize(9);
  c.doc.setTextColor(...NOIR);
  for (const ligne of t.lignes) {
    if (c.y + ligneH > c.pageH - MARGE - 20) {
      nouvellePage(c);
      entete();
      c.doc.setFont('helvetica', 'normal');
      c.doc.setFontSize(9);
      c.doc.setTextColor(...NOIR);
    }
    ligne.forEach((cellule, i) => {
      if (i >= n) return;
      const droite = t.alignements?.[i] === 'd';
      const maxW = largeurs[i] - 12;
      let texte = nettoyer(cellule);
      while (texte.length > 1 && c.doc.getTextWidth(texte) > maxW) texte = `${texte.slice(0, -2)}…`;
      c.doc.text(texte, droite ? xs[i] + largeurs[i] - 6 : xs[i] + 6, c.y, { align: droite ? 'right' : 'left' });
    });
    c.y += 4;
    c.doc.setDrawColor(...LIGNE);
    c.doc.setLineWidth(0.3);
    c.doc.line(MARGE, c.y, MARGE + c.contentW, c.y);
    c.y += ligneH - 4;
  }
  c.y += 4;
}

function note(c: Cadre, texte: string): void {
  c.doc.setFont('helvetica', 'italic');
  c.doc.setFontSize(8.5);
  c.doc.setTextColor(...GRIS);
  const lignes = c.doc.splitTextToSize(nettoyer(texte), c.contentW) as string[];
  assurerPlace(c, lignes.length * 11 + 6);
  c.doc.text(lignes, MARGE, c.y);
  c.y += lignes.length * 11 + 6;
}

function piedsDePage(c: Cadre): void {
  const total = c.doc.getNumberOfPages();
  const genere = new Date(c.rapport.genere_le);
  const date = Number.isNaN(genere.getTime()) ? '' : genere.toLocaleString(fr(c.rapport) ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short' });
  for (let p = 1; p <= total; p++) {
    c.doc.setPage(p);
    c.doc.setFont('helvetica', 'normal');
    c.doc.setFontSize(8);
    c.doc.setTextColor(...GRIS);
    c.doc.text(`${fr(c.rapport) ? 'Généré par Lumi · Lume CRM' : 'Generated by Lumi · Lume CRM'}${date ? ` · ${date}` : ''}`, MARGE, c.pageH - 28);
    c.doc.text(`${p} / ${total}`, c.pageW - MARGE, c.pageH - 28, { align: 'right' });
  }
}

export function construireRapportPdf(rapport: RapportLumi): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const c: Cadre = {
    doc, y: MARGE, pageW: doc.internal.pageSize.getWidth(), pageH: doc.internal.pageSize.getHeight(), contentW: 0, rapport,
  };
  c.contentW = c.pageW - MARGE * 2;

  // En-tête
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...NOIR);
  doc.text(nettoyer(rapport.titre), MARGE, c.y + 8);
  c.y += 26;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...GRIS);
  doc.text(nettoyer(rapport.sous_titre), MARGE, c.y);
  c.y += 10;

  for (const s of rapport.sections) {
    titreSection(c, s.titre, s.kpis?.length ? 60 : s.tableau ? 50 : 20);
    if (s.kpis?.length) { kpis(c, s.kpis); c.y += 6; }
    if (s.tableau && s.tableau.lignes.length) tableau(c, s.tableau);
    if (s.note) note(c, s.note);
  }
  piedsDePage(c);
  return doc;
}

export function nomFichierRapport(rapport: RapportLumi): string {
  const base = nettoyer(rapport.titre).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const p = rapport.periode ? `-${rapport.periode.du}-${rapport.periode.au}` : `-${rapport.genere_le.slice(0, 10)}`;
  return `${base || 'rapport'}${p}.pdf`;
}

/** Génère et télécharge le PDF. */
export function telechargerRapportPdf(rapport: RapportLumi): void {
  construireRapportPdf(rapport).save(nomFichierRapport(rapport));
}
