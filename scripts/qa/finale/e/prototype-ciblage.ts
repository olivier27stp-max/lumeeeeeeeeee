/**
 * Agent E — PROTOTYPE (enquête, pas du code produit) de l'évaluateur de ciblage proposé
 * dans D:/lume-final/notes/E-conception.md, « Conception 1 ».
 *
 * Il ne crée AUCUN nouveau moteur de conditions : il compose ce qui existe —
 *   · les étiquettes du client, comparées sans casse (comme `conditionsEtiquettesOk`
 *     et `correspondEtiquettes` de src/lib/etiquettesFiltre.ts) ;
 *   · les champs personnalisés, jugés par `evaluerCondition` (src/lib/champs/filtres.ts,
 *     le moteur partagé avec les listes et la pipeline) ;
 *   · les champs de la fiche client (statut, entreprise, ville, source), jugés par le
 *     même `evaluerCondition` en les traitant comme des champs texte.
 *
 * La MÊME fonction pure sert au compteur « Touche X clients » (sur toutes les fiches)
 * et à l'exécution (sur la fiche du client de l'entité) : les deux ne peuvent pas diverger.
 */
import { evaluerCondition, type Condition } from '../../../../src/lib/champs/filtres';
import type { TypeChamp, ValeurChamp } from '../../../../src/lib/champs/types';

/** Champs de la fiche client offerts au ciblage (libellés : voir E-conception.md). */
export const CLES_FICHE = ['status', 'genre', 'company', 'city', 'lead_source', 'source'] as const;
export type CleFiche = (typeof CLES_FICHE)[number];

export type RegleCiblage =
  | { type: 'etiquette'; valeur: string }
  /** Un champ personnalisé de la fiche CLIENT (jamais de l'entité de l'événement). */
  | ({ type: 'champ' } & Condition)
  /** Un champ de base de la fiche client ; `genre` = « entreprise » si un nom de compagnie est saisi, sinon « particulier ». */
  | { type: 'fiche'; cle: CleFiche; op: 'is' | 'is_not' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty'; value?: string };

export interface Ciblage {
  /** Absent ou vide = tous les clients. `toutes` = ET, `une` = OU. */
  inclure?: { mode: 'toutes' | 'une'; regles: RegleCiblage[] };
  /** Prioritaire : UNE seule règle vraie suffit à exclure. */
  exclure?: RegleCiblage[];
}

export interface FicheClient {
  id: string;
  status: string | null;
  company: string | null;
  city: string | null;
  lead_source: string | null;
  source: string | null;
  etiquettes: string[];
  /** Valeurs des champs personnalisés du client, par id de champ. */
  champs: Record<string, { type: TypeChamp; valeur: ValeurChamp; avecHeure?: boolean }>;
  /** Types des champs connus (un champ jamais rempli doit quand même être jugé : « est vide »). */
  typesChamps?: Record<string, TypeChamp>;
}

export interface Contexte { fuseau: string; maintenant?: Date }

function valeurFiche(f: FicheClient, cle: CleFiche): string | null {
  if (cle === 'genre') return (f.company ?? '').trim() ? 'entreprise' : 'particulier';
  return f[cle];
}

export function regleVraie(r: RegleCiblage, f: FicheClient, ctx: Contexte): boolean {
  if (r.type === 'etiquette') {
    const cherchee = r.valeur.trim().toLowerCase();
    return cherchee !== '' && f.etiquettes.some((t) => t.toLowerCase() === cherchee);
  }
  if (r.type === 'fiche') {
    return evaluerCondition('single_line', valeurFiche(f, r.cle), { field_id: r.cle, op: r.op, value: r.value }, ctx);
  }
  const type = f.champs[r.field_id]?.type ?? f.typesChamps?.[r.field_id];
  // Champ disparu (archivé, supprimé) : on ne cible pas sur ce qu'on ne peut pas vérifier.
  if (!type) return false;
  const { type: _t, ...condition } = r;
  return evaluerCondition(type, f.champs[r.field_id]?.valeur ?? null, condition as Condition,
    { ...ctx, avecHeure: !!f.champs[r.field_id]?.avecHeure });
}

/** Une ligne lisible pour le journal : « étiquette “Ne pas relancer” ». */
export function decrireRegle(r: RegleCiblage, libelles: Record<string, string> = {}): string {
  if (r.type === 'etiquette') return `étiquette « ${r.valeur} »`;
  if (r.type === 'fiche') return `fiche : ${r.cle}`;
  return `champ « ${libelles[r.field_id] ?? r.field_id} »`;
}

/**
 * Le client est-il ciblé ? Les exclusions passent AVANT les inclusions.
 * `raison` : pourquoi il ne l'est pas — ce que le journal affichera
 * (« Ignoré : hors ciblage — exclu par l'étiquette “Ne pas relancer” »).
 */
export function evaluerCiblage(
  c: Ciblage | null | undefined, f: FicheClient, ctx: Contexte, libelles: Record<string, string> = {},
): { cible: boolean; raison: string | null } {
  if (!c) return { cible: true, raison: null };
  const exclusion = (c.exclure ?? []).find((r) => regleVraie(r, f, ctx));
  if (exclusion) return { cible: false, raison: `exclu par ${decrireRegle(exclusion, libelles)}` };
  const regles = c.inclure?.regles ?? [];
  if (regles.length === 0) return { cible: true, raison: null };
  if (c.inclure!.mode === 'une') {
    return regles.some((r) => regleVraie(r, f, ctx))
      ? { cible: true, raison: null }
      : { cible: false, raison: 'ne remplit aucune des conditions' };
  }
  const manquante = regles.find((r) => !regleVraie(r, f, ctx));
  return manquante ? { cible: false, raison: `ne remplit pas : ${decrireRegle(manquante, libelles)}` } : { cible: true, raison: null };
}

/**
 * Deux ciblages peuvent-ils toucher un même client ? (avertissement de doublon, Conception 2)
 * Prudent : on répond « oui » sauf quand on PEUT prouver qu'ils sont disjoints —
 * l'un exige (mode « toutes ») une étiquette que l'autre exclut.
 */
export function ciblagesSeChevauchent(a: Ciblage | null | undefined, b: Ciblage | null | undefined): boolean {
  const exigees = (c: Ciblage | null | undefined) => (c?.inclure?.mode === 'toutes' || (c?.inclure?.regles.length ?? 0) === 1
    ? (c?.inclure?.regles ?? []) : []).filter((r): r is { type: 'etiquette'; valeur: string } => r.type === 'etiquette').map((r) => r.valeur.toLowerCase());
  const exclues = (c: Ciblage | null | undefined) => (c?.exclure ?? [])
    .filter((r): r is { type: 'etiquette'; valeur: string } => r.type === 'etiquette').map((r) => r.valeur.toLowerCase());
  const disjoint = (x: Ciblage | null | undefined, y: Ciblage | null | undefined) => exigees(x).some((t) => exclues(y).includes(t));
  return !(disjoint(a, b) || disjoint(b, a));
}
