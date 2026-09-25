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

// ── Jobs ────────────────────────────────────────────────────────────────────
//
// L'export « One-Off Jobs » de Jobber n'a que les NOMS des services (« Nettoyage des
// fenêtres, Nettoyage de revêtement »), parfois « Nom (qté) » (export Visits), jamais
// les montants. Un job importé n'avait donc aucune ligne : la fiche et la visite ne
// montraient que le total (Vision Lavage, 2026-09-24, 896 jobs sans lignes).
//
// Règle : (1) si le texte porte les montants (format facture) et somme au sous-total,
// lignes réelles ; (2) sinon UNE ligne dont le nom est la liste des services, au
// sous-total — rien d'inventé, le total ne bouge pas ; (3) sans texte, « Montant importé ».
// Puis, à l'import des factures, une facture du job dont les lignes réelles somment au
// sous-total du job REMPLACE cette ligne de repli par ses vraies lignes (prix unitaires).

/** Noms de services d'un texte « A, B (2), C » → ['A', 'B', 'C'] (les « (qté) » et montants sont retirés). */
export function nomsServices(texte: string): string[] {
  return texte
    .split(/,\s+(?=[^,()]*(?:\(|,|$))/)
    .map((t) => t.replace(/\s*\((?:\d+(?:\.\d+)?)(?:,\s*\$[\d,]*\.\d{2})?\)\s*$/, '').trim())
    .filter(Boolean);
}

/** Les lignes à créer pour un job importé : leur somme vaut toujours le sous-total. */
export function lignesPourJob(texte: string, sousTotalCents: number): LigneImportee[] {
  const lues = lireLignesExport(texte);
  if (lues && lues.reduce((s, l) => s + l.totalCents, 0) === sousTotalCents) return lignesPourFacture(texte, sousTotalCents);
  const noms = nomsServices(texte);
  if (noms.length === 0) return sousTotalCents > 0 ? [{ description: LIBELLE_MONTANT_IMPORTE, qty: 1, unit_price_cents: sousTotalCents }] : [];
  return [{ description: noms.join(', ').slice(0, 500), qty: 1, unit_price_cents: Math.max(0, sousTotalCents) }];
}

/**
 * Crée les lignes des jobs importés (table job_line_items : name, qty, unit_price_cents,
 * total_cents, created_by NOT NULL). Rejouable : un job qui a déjà des lignes est sauté.
 * Jamais bloquant pour l'import.
 */
export async function creerLignesJobsImportees(
  admin: SupabaseClient, orgId: string, createdBy: string, jobs: Array<{ id: string; lignes: LigneImportee[] }>,
): Promise<{ creees: number; echecs: number }> {
  const aFaire = jobs.filter((j) => j.lignes.length > 0);
  let creees = 0;
  let echecs = 0;
  const rangeesDe = (j: { id: string; lignes: LigneImportee[] }) => j.lignes.map((l, k) => ({
    org_id: orgId, job_id: j.id, name: l.description.slice(0, 500), qty: l.qty, unit_price_cents: l.unit_price_cents,
    total_cents: Math.round(l.qty * l.unit_price_cents), included: true, created_by: createdBy,
    // created_at décalé de k ms : l'app trie les lignes par created_at, sans ça l'ordre est perdu.
    created_at: new Date(Date.now() + k).toISOString(),
  }));
  for (let i = 0; i < aFaire.length; i += 200) {
    const lot = aFaire.slice(i, i + 200);
    const { data: deja, error: eLecture } = await admin.from('job_line_items').select('job_id').in('job_id', lot.map((j) => j.id)).is('deleted_at', null);
    if (eLecture) {
      console.error('[migration-importer] lignes de job : lecture impossible', eLecture.message);
      echecs += lot.length;
      continue;
    }
    const avecLignes = new Set((deja ?? []).map((r) => r.job_id as string));
    const restants = lot.filter((j) => !avecLignes.has(j.id));
    if (restants.length === 0) continue;
    const { error } = await admin.from('job_line_items').insert(restants.flatMap(rangeesDe));
    if (!error) { creees += restants.reduce((s, j) => s + j.lignes.length, 0); continue; }
    console.error('[migration-importer] lignes de job : lot refusé, reprise job par job', error.message);
    for (const j of restants) {
      const { error: e } = await admin.from('job_line_items').insert(rangeesDe(j));
      if (e) { echecs += 1; console.error('[migration-importer] lignes de job refusées', j.id, e.message); } else creees += j.lignes.length;
    }
  }
  return { creees, echecs };
}

/**
 * Une facture importée rattachée à un job, dont les lignes RÉELLES somment au sous-total
 * du job, donne ses lignes au job (prix unitaires) à la place de la ligne de repli.
 * Ne touche jamais un job qui a plus d'une ligne (lignes saisies ou déjà réelles).
 */
export async function raffinerLignesJobsDepuisFactures(
  admin: SupabaseClient, orgId: string, createdBy: string, factures: Array<{ jobId: string; lignes: LigneImportee[] }>,
): Promise<{ jobs: number }> {
  const reelles = factures.filter((f) => f.lignes.length > 0 && !(f.lignes.length === 1 && f.lignes[0].description === LIBELLE_MONTANT_IMPORTE));
  const parJob = new Map<string, LigneImportee[]>();
  for (const f of reelles) parJob.set(f.jobId, [...(parJob.get(f.jobId) ?? []), ...f.lignes]);
  let jobs = 0;
  const ids = Array.from(parJob.keys());
  for (let i = 0; i < ids.length; i += 200) {
    const lot = ids.slice(i, i + 200);
    const [{ data: jobsRows, error: eJobs }, { data: lignesRows, error: eLignes }] = await Promise.all([
      admin.from('jobs').select('id, subtotal_cents').in('id', lot),
      admin.from('job_line_items').select('id, job_id').in('job_id', lot).is('deleted_at', null),
    ]);
    if (eJobs || eLignes) { console.error('[migration-importer] raffinement lignes de job : lecture impossible', (eJobs ?? eLignes)?.message); continue; }
    const lignesParJob = new Map<string, string[]>();
    for (const l of (lignesRows ?? []) as { id: string; job_id: string }[]) lignesParJob.set(l.job_id, [...(lignesParJob.get(l.job_id) ?? []), l.id]);
    for (const j of (jobsRows ?? []) as { id: string; subtotal_cents: number | null }[]) {
      const lignes = parJob.get(j.id) ?? [];
      const somme = lignes.reduce((s, l) => s + Math.round(l.qty * l.unit_price_cents), 0);
      const actuelles = lignesParJob.get(j.id) ?? [];
      if (somme !== Number(j.subtotal_cents ?? 0) || actuelles.length > 1) continue;
      if (actuelles.length === 1) {
        const { error: eDel } = await admin.from('job_line_items').update({ deleted_at: new Date().toISOString() }).in('id', actuelles);
        if (eDel) { console.error('[migration-importer] ligne de repli non retirée', j.id, eDel.message); continue; }
      }
      const r = await creerLignesJobsImportees(admin, orgId, createdBy, [{ id: j.id, lignes }]);
      if (r.creees > 0) jobs += 1;
    }
  }
  return { jobs };
}
