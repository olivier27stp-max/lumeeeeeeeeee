// Lignes des factures et soumissions importées.
//
// Les exports de facture et de soumission ne portent que les totaux, sauf Jobber qui résume les
// services dans une colonne « Line items » : « Nom (qté, $total de la ligne), … ».
// Sans lignes, une facture importée s'ouvrait à 0 $ dans l'éditeur (un brouillon
// enregistré perdait son montant), son PDF n'avait aucun détail, et l'invariant
// invoice_totals_balance la signalait (638 fois pour Vision Lavage, 2026-09-24).
//
// Règle : les lignes lues ne sont gardées que si leur somme égale EXACTEMENT le
// sous-total importé ; sinon — ou sans colonne — une seule ligne « Montant
// importé » égale au sous-total. Le total de la facture ne bouge jamais.
// Même règle en SQL pour le rattrapage : migrations 20260926100700 (factures)
// et 20260926100800 (soumissions).
import type { SupabaseClient } from '@supabase/supabase-js';

export interface LigneImportee {
  description: string;
  qty: number;
  unit_price_cents: number;
}

export const LIBELLE_MONTANT_IMPORTE = 'Montant importé';

/** « Nom (qté, $total de la ligne) », séparés par « , ». null si le texte ne suit pas ce format d'un bout à l'autre. */
export function lireLignesExport(texte: string): Array<{ nom: string; qte: number; totalCents: number }> | null {
  const t = texte.trim();
  if (!t) return null;
  const motif = /(.*?) \((\d+(?:\.\d+)?), \$(-?[\d,]*\.\d{2})\)(?:, |$)/gy;
  const lignes: Array<{ nom: string; qte: number; totalCents: number }> = [];
  while (motif.lastIndex < t.length) {
    const m = motif.exec(t);
    if (!m || m[0] === '') return null;
    const nom = m[1].trim();
    const qte = Number(m[2]);
    const totalCents = Math.round(Number(m[3].replace(/,/g, '')) * 100);
    if (!nom || !Number.isFinite(qte) || qte <= 0 || !Number.isFinite(totalCents) || totalCents < 0) return null;
    lignes.push({ nom, qte, totalCents });
  }
  return lignes.length ? lignes : null;
}

/** Le texte « Line items » d'une rangée normalisée (champ mappé, ou colonne restée non mappée). */
export function texteLignes(n: Record<string, unknown>): string {
  if (typeof n.line_items === 'string') return n.line_items;
  const nonMappes = n._unmapped;
  if (nonMappes && typeof nonMappes === 'object') {
    for (const [entete, v] of Object.entries(nonMappes as Record<string, unknown>)) {
      if (typeof v === 'string' && entete.trim().toLowerCase().replace(/[^a-z]+/g, ' ').trim() === 'line items') return v;
    }
  }
  return '';
}

/** Les lignes à créer pour une facture importée : leur somme vaut toujours le sous-total. */
export function lignesPourFacture(texte: string, sousTotalCents: number): LigneImportee[] {
  const lues = lireLignesExport(texte);
  if (lues && lues.reduce((s, l) => s + l.totalCents, 0) === sousTotalCents) {
    return lues.map((l) => (Number.isInteger(l.qte) && l.totalCents % l.qte === 0
      ? { description: l.nom.slice(0, 20000), qty: l.qte, unit_price_cents: l.totalCents / l.qte }
      // Prix unitaire non entier en cents : une ligne au total exact plutôt qu'un sou d'écart.
      : { description: `${l.nom} (× ${l.qte})`.slice(0, 20000), qty: 1, unit_price_cents: l.totalCents }));
  }
  return sousTotalCents > 0 ? [{ description: LIBELLE_MONTANT_IMPORTE, qty: 1, unit_price_cents: sousTotalCents }] : [];
}

/**
 * Crée les lignes des factures importées. Rejouable : une facture qui a déjà
 * des lignes (import rejoué après une annulation, mêmes identifiants) est
 * sautée. Toutes les lignes d'une facture partent dans la MÊME instruction :
 * le recalcul (trigger par ligne, exécuté en fin d'instruction) voit la somme
 * complète — égale au sous-total — donc la facture ne bouge pas, même émise.
 * Jamais bloquant pour l'import : un échec est journalisé et compté.
 */
export async function creerLignesImportees(
  admin: SupabaseClient, orgId: string, factures: Array<{ id: string; lignes: LigneImportee[] }>,
): Promise<{ creees: number; echecs: number }> {
  const aFaire = factures.filter((f) => f.lignes.length > 0);
  let creees = 0;
  let echecs = 0;
  const rangeesDe = (f: { id: string; lignes: LigneImportee[] }) => f.lignes.map((l, k) => ({
    org_id: orgId, invoice_id: f.id, description: l.description, qty: l.qty, unit_price_cents: l.unit_price_cents, sort_order: k,
  }));
  for (let i = 0; i < aFaire.length; i += 200) {
    const lot = aFaire.slice(i, i + 200);
    const { data: deja, error: eLecture } = await admin.from('invoice_items').select('invoice_id')
      .in('invoice_id', lot.map((f) => f.id)).is('deleted_at', null);
    if (eLecture) {
      console.error('[migration-importer] lignes de facture : lecture impossible', eLecture.message);
      echecs += lot.length;
      continue;
    }
    const avecLignes = new Set((deja ?? []).map((r) => r.invoice_id as string));
    const restantes = lot.filter((f) => !avecLignes.has(f.id));
    if (restantes.length === 0) continue;
    const { error } = await admin.from('invoice_items').insert(restantes.flatMap(rangeesDe));
    if (!error) {
      creees += restantes.reduce((s, f) => s + f.lignes.length, 0);
      continue;
    }
    console.error('[migration-importer] lignes de facture : lot refusé, reprise facture par facture', error.message);
    for (const f of restantes) {
      const { error: e } = await admin.from('invoice_items').insert(rangeesDe(f));
      if (e) {
        echecs += 1;
        console.error('[migration-importer] lignes de facture refusées', f.id, e.message);
      } else creees += f.lignes.length;
    }
  }
  return { creees, echecs };
}

/**
 * Soumissions : mêmes lignes, table quote_line_items. Une ligne de soumission
 * ne recalcule pas l'en-tête (l'app le fait à l'enregistrement) : pas de
 * contrainte d'instruction unique, mais même règle de somme et même reprise.
 */
export async function creerLignesDevisImportees(
  admin: SupabaseClient, orgId: string, devis: Array<{ id: string; lignes: LigneImportee[] }>,
): Promise<{ creees: number; echecs: number }> {
  const aFaire = devis.filter((d) => d.lignes.length > 0);
  let creees = 0;
  let echecs = 0;
  const rangeesDe = (d: { id: string; lignes: LigneImportee[] }) => d.lignes.map((l, k) => ({
    org_id: orgId, quote_id: d.id, name: l.description.slice(0, 500), quantity: l.qty, unit_price_cents: l.unit_price_cents, sort_order: k,
  }));
  for (let i = 0; i < aFaire.length; i += 200) {
    const lot = aFaire.slice(i, i + 200);
    const { data: deja, error: eLecture } = await admin.from('quote_line_items').select('quote_id').in('quote_id', lot.map((d) => d.id));
    if (eLecture) {
      console.error('[migration-importer] lignes de soumission : lecture impossible', eLecture.message);
      echecs += lot.length;
      continue;
    }
    const avecLignes = new Set((deja ?? []).map((r) => r.quote_id as string));
    const restantes = lot.filter((d) => !avecLignes.has(d.id));
    if (restantes.length === 0) continue;
    const { error } = await admin.from('quote_line_items').insert(restantes.flatMap(rangeesDe));
    if (!error) {
      creees += restantes.reduce((s, d) => s + d.lignes.length, 0);
      continue;
    }
    console.error('[migration-importer] lignes de soumission : lot refusé, reprise une par une', error.message);
    for (const d of restantes) {
      const { error: e } = await admin.from('quote_line_items').insert(rangeesDe(d));
      if (e) {
        echecs += 1;
        console.error('[migration-importer] lignes de soumission refusées', d.id, e.message);
      } else creees += d.lignes.length;
    }
  }
  return { creees, echecs };
}
