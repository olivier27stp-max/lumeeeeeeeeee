/* ═══════════════════════════════════════════════════════════════
   « QUI EST CIBLÉ » — le cœur PUR, partagé par l'éditeur et le moteur.

   Une automatisation s'adresse par défaut à tous les clients. Un ciblage
   la restreint : « seulement les clients VIP ou Commercial, jamais ceux
   marqués Ne pas relancer ». Il vit dans `automation_rules.conditions.ciblage`
   (là où le moteur lit ce qui décide « cette règle part-elle ? ») :

     "ciblage": {
       "inclure": { "mode": "une",            // "toutes" = ET · "une" = OU
         "regles": [
           { "type": "etiquette", "valeur": "VIP" },
           { "type": "fiche", "cle": "genre", "op": "is", "value": "entreprise" },
           { "type": "champ", "field_id": "<champ personnalisé CLIENT>", "op": "is", "value": "Commercial" }
         ] },
       "exclure": [ { "type": "etiquette", "valeur": "Ne pas relancer" } ]   // prioritaire
     }

   UNE règle porte TOUJOURS sur la fiche du CLIENT de l'entité (le client de
   la facture, du devis, du rendez-vous…), jamais sur la fiche de l'événement :
   c'est ce qui permet « type de client » sur une automatisation de facture.

   AUCUN nouveau moteur de conditions : une étiquette se compare sans casse
   (comme `conditionsEtiquettesOk`), un champ personnalisé et un champ de la
   fiche sont jugés par `evaluerCondition` (src/lib/champs/filtres.ts, le moteur
   des listes et de la pipeline).

   LA MÊME FONCTION sert au compteur « Touche X clients » (sur tout le carnet)
   et à l'exécution (sur le client de l'entité) : l'écran ne peut pas annoncer
   autre chose que ce que le moteur fera.

   COMPATIBILITÉ, sans migration : les deux clés d'avant — `client_a_etiquette`
   et `client_sans_etiquette` — sont lues comme une règle exigée et une
   exclusion (`lireCiblage`). L'éditeur réécrit au nouveau format au premier
   enregistrement de la section (`ecrireCiblage`).

   Imports : `src/lib/champs/` et `sequenceTypes.ts` seulement — ce fichier est lu
   par le serveur (ligne COPY du Dockerfile).
   ═══════════════════════════════════════════════════════════════ */

import {
  evaluerCondition, familleDuType, OPERATEURS_PAR_FAMILLE, LIBELLES_OPERATEUR, OPERATEURS_DUREE,
  type Condition, type Operateur,
} from './champs/filtres';
import type { TypeChamp, ValeurChamp } from './champs/types';
import { estFormatOrigine } from './sequenceTypes';

/** La clé réservée de `conditions`. */
export const CLE_CIBLAGE = 'ciblage';
/** Les deux clés d'avant, toujours lues. */
export const CLES_ETIQUETTES_HERITEES = ['client_a_etiquette', 'client_sans_etiquette'] as const;

/** Bornes : 10 règles d'inclusion, 10 d'exclusion. */
export const CIBLAGE_MAX_INCLURE = 10;
export const CIBLAGE_MAX_EXCLURE = 10;
/** Longueur d'une étiquette ou d'une valeur de fiche (comme les conditions du moteur). */
export const CIBLAGE_VALEUR_MAX = 200;

/** Champs de la fiche client offerts au ciblage. */
export const CLES_FICHE = ['status', 'genre', 'company', 'city', 'lead_source', 'source'] as const;
export type CleFiche = (typeof CLES_FICHE)[number];

export const OPERATEURS_FICHE = ['is', 'is_not', 'contains', 'not_contains', 'is_empty', 'is_not_empty'] as const;
export type OperateurFiche = (typeof OPERATEURS_FICHE)[number];

export type RegleEtiquette = { type: 'etiquette'; valeur: string };
/** Un champ personnalisé de la fiche CLIENT (jamais de l'entité de l'événement). */
export type RegleChamp = { type: 'champ' } & Condition;
/** Un champ de la fiche client ; `genre` = « entreprise » si un nom de compagnie est saisi, sinon « particulier ». */
export type RegleFiche = { type: 'fiche'; cle: CleFiche; op: OperateurFiche; value?: string | null };
export type RegleCiblage = RegleEtiquette | RegleChamp | RegleFiche;

export type ModeCiblage = 'toutes' | 'une';

export interface Ciblage {
  /** Absent ou vide = tous les clients. `toutes` = ET, `une` = OU. */
  inclure?: { mode: ModeCiblage; regles: RegleCiblage[] };
  /** Prioritaire : UNE seule règle vraie suffit à exclure. */
  exclure?: RegleCiblage[];
}

/**
 * Un ciblage tel que le moteur le LIT : `exiger` porte l'ancienne clé
 * `client_a_etiquette`, exigée EN PLUS de `inclure` (elle se combinait par ET
 * avec le reste) ; `illisible` compte les règles écrites à la main que rien ne
 * sait juger — jamais ignorées en silence (voir `evaluerCiblage`).
 */
export interface CiblageLu extends Ciblage {
  exiger?: RegleCiblage[];
  illisible?: { inclure: number; exclure: number };
}

/** La fiche d'un client, telle que le ciblage la juge. */
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
  /** Types des champs connus : un champ jamais rempli se juge quand même (« est vide », « pas cochée »). */
  typesChamps?: Record<string, TypeChamp>;
}

export interface ContexteCiblage {
  /** Fuseau de l'entreprise (les dates se comparent en heure locale). */
  fuseau?: string;
  maintenant?: Date;
  /** Langue de la raison rendue (français par défaut : c'est celle du journal). */
  fr?: boolean;
}

export interface VerdictCiblage {
  cible: boolean;
  /** Pourquoi le client n'est pas ciblé — `null` quand il l'est. */
  raison: string | null;
}

// ── Libellés ────────────────────────────────────────────────

export const LIBELLES_FICHE: Record<CleFiche, { fr: string; en: string }> = {
  genre: { fr: 'Type de client', en: 'Client type' },
  status: { fr: 'Statut', en: 'Status' },
  company: { fr: 'Nom de la compagnie', en: 'Company name' },
  city: { fr: 'Ville', en: 'City' },
  lead_source: { fr: 'Source du lead', en: 'Lead source' },
  source: { fr: 'Source', en: 'Source' },
};

/** Les champs de la fiche à valeurs fermées : la valeur stockée → ce qu'on lit. */
export const VALEURS_FICHE: Partial<Record<CleFiche, Array<{ cle: string; fr: string; en: string }>>> = {
  genre: [
    { cle: 'entreprise', fr: 'Entreprise', en: 'Business' },
    { cle: 'particulier', fr: 'Particulier', en: 'Individual' },
  ],
  status: [
    { cle: 'lead', fr: 'Prospect', en: 'Lead' },
    { cle: 'active', fr: 'Client actif', en: 'Active client' },
    { cle: 'inactive', fr: 'Client inactif', en: 'Inactive client' },
  ],
};

/** Les opérateurs offerts pour un champ de la fiche (une liste fermée ne se « contient » pas). */
export function operateursDeLaFiche(cle: CleFiche): OperateurFiche[] {
  return VALEURS_FICHE[cle] ? ['is', 'is_not'] : [...OPERATEURS_FICHE];
}

const guillemets = (t: string, fr: boolean) => (fr ? `« ${t} »` : `“${t}”`);

/** Le nom de ce sur quoi porte une règle : « l’étiquette « VIP » », « le champ « Référé par » ». */
export function decrireRegle(r: RegleCiblage, libelles: Record<string, string> = {}, fr = true): string {
  if (r.type === 'etiquette') return fr ? `l’étiquette ${guillemets(r.valeur, true)}` : `the tag ${guillemets(r.valeur, false)}`;
  if (r.type === 'fiche') {
    const nom = LIBELLES_FICHE[r.cle]?.[fr ? 'fr' : 'en'] ?? r.cle;
    return fr ? `la condition sur ${guillemets(nom, true)}` : `the condition on ${guillemets(nom, false)}`;
  }
  const nom = libelles[r.field_id] ?? (fr ? 'un champ personnalisé' : 'a custom field');
  return libelles[r.field_id]
    ? (fr ? `la condition sur ${guillemets(nom, true)}` : `the condition on ${guillemets(nom, false)}`)
    : (fr ? `la condition sur ${nom}` : `the condition on ${nom}`);
}

/** Une règle telle qu'on la lit à l'écran et dans le résumé : « étiquette VIP », « Type de client est Entreprise ». */
export function libelleRegle(
  r: RegleCiblage, fr = true,
  champs: Record<string, { label: string; options?: Array<{ id: string; label: string }> }> = {},
): string {
  if (r.type === 'etiquette') return fr ? `étiquette ${guillemets(r.valeur, true)}` : `tag ${guillemets(r.valeur, false)}`;
  const op = LIBELLES_OPERATEUR[r.op]?.[fr ? 'fr' : 'en'] ?? r.op;
  if (r.type === 'fiche') {
    const nom = LIBELLES_FICHE[r.cle]?.[fr ? 'fr' : 'en'] ?? r.cle;
    if (r.op === 'is_empty' || r.op === 'is_not_empty') return `${nom} ${op}`;
    const option = VALEURS_FICHE[r.cle]?.find((o) => o.cle === String(r.value ?? '').trim().toLowerCase());
    return `${nom} ${op} ${option ? (fr ? option.fr : option.en) : guillemets(String(r.value ?? ''), fr)}`;
  }
  const champ = champs[r.field_id];
  const nom = champ?.label ?? (fr ? 'Champ supprimé' : 'Deleted field');
  if (r.op === 'is_empty' || r.op === 'is_not_empty' || r.op === 'today' || r.op === 'yesterday') return `${nom} ${op}`;
  const dire = (v: unknown): string => {
    if (v === true || v === 'true') return fr ? 'oui' : 'yes';
    if (v === false || v === 'false') return fr ? 'non' : 'no';
    const option = champ?.options?.find((o) => o.id === v);
    return option ? option.label : String(v ?? '');
  };
  if (OPERATEURS_DUREE.includes(r.op)) {
    const unites: Record<string, [string, string]> = { days: ['jours', 'days'], weeks: ['semaines', 'weeks'], months: ['mois', 'months'] };
    return `${nom} ${op} ${r.n ?? 0} ${unites[r.unit ?? 'days'][fr ? 0 : 1]}`;
  }
  const valeur = Array.isArray(r.value) ? r.value.map(dire).join(', ') : dire(r.value);
  const seconde = r.op === 'between' ? ` ${fr ? 'et' : 'and'} ${dire(r.value2)}` : '';
  return `${nom} ${op} ${valeur}${seconde}`;
}

// ── Lecture ─────────────────────────────────────────────────

const estObjet = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const texte = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Une règle écrite en base, relue prudemment. `null` = rien n'en est lisible. */
export function lireRegle(brut: unknown): RegleCiblage | null {
  if (!estObjet(brut)) return null;
  if (brut.type === 'etiquette') {
    const valeur = texte(brut.valeur);
    return valeur ? { type: 'etiquette', valeur } : null;
  }
  if (brut.type === 'fiche') {
    if (!(CLES_FICHE as readonly string[]).includes(String(brut.cle))) return null;
    if (!(OPERATEURS_FICHE as readonly string[]).includes(String(brut.op))) return null;
    return {
      type: 'fiche', cle: brut.cle as CleFiche, op: brut.op as OperateurFiche,
      ...(brut.value === undefined || brut.value === null ? {} : { value: String(brut.value) }),
    };
  }
  if (brut.type === 'champ') {
    if (typeof brut.field_id !== 'string' || !brut.field_id || typeof brut.op !== 'string') return null;
    if (!(brut.op in LIBELLES_OPERATEUR)) return null;
    const { type: _t, ...condition } = brut;
    return { type: 'champ', ...(condition as unknown as Condition) };
  }
  return null;
}

/**
 * Le ciblage d'une règle, lu depuis ses `conditions` — nouvelle forme ET
 * anciennes clés d'étiquette. `null` = aucun ciblage : tous les clients, et le
 * moteur n'a rien à lire.
 */
export function lireCiblage(conditions: Record<string, unknown> | null | undefined): CiblageLu | null {
  if (!estObjet(conditions)) return null;
  const brut = estObjet(conditions[CLE_CIBLAGE]) ? (conditions[CLE_CIBLAGE] as Record<string, unknown>) : null;
  const sortie: CiblageLu = {};
  const illisible = { inclure: 0, exclure: 0 };

  if (brut) {
    const inclure = estObjet(brut.inclure) ? brut.inclure : null;
    const brutes = Array.isArray(inclure?.regles) ? (inclure.regles as unknown[]) : [];
    const regles = brutes.map(lireRegle);
    illisible.inclure = regles.filter((r) => !r).length;
    const lues = regles.filter((r): r is RegleCiblage => !!r);
    if (lues.length > 0 || illisible.inclure > 0) {
      // Mode absent ou inconnu : le plus STRICT (« toutes »), jamais le plus large.
      sortie.inclure = { mode: inclure?.mode === 'une' ? 'une' : 'toutes', regles: lues };
    }
    const exclusions = (Array.isArray(brut.exclure) ? (brut.exclure as unknown[]) : []).map(lireRegle);
    illisible.exclure = exclusions.filter((r) => !r).length;
    const exclure = exclusions.filter((r): r is RegleCiblage => !!r);
    if (exclure.length > 0) sortie.exclure = exclure;
  }

  // Les deux clés d'avant : « a l'étiquette » était exigée (ET), « n'a pas » excluait.
  const a = texte(conditions.client_a_etiquette);
  const sans = texte(conditions.client_sans_etiquette);
  if (a) sortie.exiger = [{ type: 'etiquette', valeur: a }];
  if (sans) sortie.exclure = [...(sortie.exclure ?? []), { type: 'etiquette', valeur: sans }];

  if (illisible.inclure > 0 || illisible.exclure > 0) sortie.illisible = illisible;
  const vide = !sortie.inclure && !sortie.exclure?.length && !sortie.exiger?.length && !sortie.illisible;
  return vide ? null : sortie;
}

/** Le ciblage ne restreint-il rien (tous les clients) ? */
export function ciblageVide(c: Ciblage | CiblageLu | null | undefined): boolean {
  if (!c) return true;
  const lu = c as CiblageLu;
  return !(c.inclure?.regles.length) && !(c.exclure?.length) && !(lu.exiger?.length) && !lu.illisible;
}

/**
 * Le ciblage tel que l'ÉDITEUR le montre : les anciennes clés d'étiquette y
 * deviennent des lignes ordinaires. `exiger` rejoint les inclusions — et impose
 * le mode « toutes » s'il y avait déjà plusieurs inclusions en mode « une »
 * (cas qu'aucun écran ne produit ; on garde alors le sens le plus STRICT).
 */
export function ciblagePourEditeur(conditions: Record<string, unknown> | null | undefined): Ciblage {
  const lu = lireCiblage(conditions);
  if (!lu) return {};
  const regles = [...(lu.exiger ?? []), ...(lu.inclure?.regles ?? [])];
  const mode: ModeCiblage = lu.exiger?.length && (lu.inclure?.regles.length ?? 0) > 0 ? 'toutes' : (lu.inclure?.mode ?? 'toutes');
  return {
    ...(regles.length ? { inclure: { mode: regles.length === 1 ? 'toutes' : mode, regles } } : {}),
    ...(lu.exclure?.length ? { exclure: lu.exclure } : {}),
  };
}

/** Une règle est-elle complète (prête à être enregistrée et jugée) ? */
export function regleComplete(r: RegleCiblage): boolean {
  if (r.type === 'etiquette') return r.valeur.trim() !== '';
  if (r.type === 'fiche') return r.op === 'is_empty' || r.op === 'is_not_empty' || String(r.value ?? '').trim() !== '';
  if (!r.field_id) return false;
  if (r.op === 'is_empty' || r.op === 'is_not_empty' || r.op === 'today' || r.op === 'yesterday') return true;
  if (OPERATEURS_DUREE.includes(r.op)) return (r.n ?? 0) > 0;
  if (r.op === 'any_of' || r.op === 'none_of') return Array.isArray(r.value) && r.value.length > 0;
  if (r.op === 'between') return r.value != null && r.value !== '' && r.value2 != null && r.value2 !== '';
  return r.value != null && r.value !== '';
}

/** Le ciblage sans ses lignes incomplètes ni ses doublons — ce qu'on enregistre. */
export function nettoyerCiblage(c: Ciblage | null | undefined): Ciblage {
  const propres = (regles: RegleCiblage[] | undefined): RegleCiblage[] => {
    const vues = new Set<string>();
    return (regles ?? []).filter(regleComplete).filter((r) => {
      const cle = JSON.stringify(r.type === 'etiquette' ? { ...r, valeur: r.valeur.trim().toLowerCase() } : r);
      if (vues.has(cle)) return false;
      vues.add(cle);
      return true;
    }).map((r) => (r.type === 'etiquette' ? { ...r, valeur: r.valeur.trim() } : r));
  };
  const inclure = propres(c?.inclure?.regles);
  const exclure = propres(c?.exclure);
  return {
    ...(inclure.length ? { inclure: { mode: c?.inclure?.mode === 'une' ? 'une' as const : 'toutes' as const, regles: inclure } } : {}),
    ...(exclure.length ? { exclure } : {}),
  };
}

/**
 * Les `conditions` d'une règle une fois le ciblage enregistré : la clé
 * `ciblage` (retirée quand il ne restreint rien), et les deux anciennes clés
 * d'étiquette retirées — elles sont désormais des lignes du ciblage.
 */
export function ecrireCiblage(
  conditions: Record<string, unknown> | null | undefined, ciblage: Ciblage | null | undefined,
): Record<string, unknown> {
  const { [CLE_CIBLAGE]: _ancien, client_a_etiquette: _a, client_sans_etiquette: _sans, ...reste } = conditions ?? {};
  const propre = nettoyerCiblage(ciblage);
  return ciblageVide(propre) ? reste : { ...reste, [CLE_CIBLAGE]: propre };
}

export interface FauteCiblage { fr: string; en: string }

/**
 * Ce qui empêche d'enregistrer ce ciblage : trop de règles, une ligne
 * incomplète, un champ qui n'est pas un champ de la fiche client, un opérateur
 * qui n'a pas de sens pour le type du champ. `champsClient` : les champs
 * personnalisés CLIENT du bureau (par id) quand l'appelant les connaît.
 */
export function fautesDuCiblage(
  c: Ciblage | null | undefined,
  champsClient?: Record<string, { label: string; type: TypeChamp }>,
): FauteCiblage[] {
  const fautes: FauteCiblage[] = [];
  const inclure = c?.inclure?.regles ?? [];
  const exclure = c?.exclure ?? [];
  if (inclure.length > CIBLAGE_MAX_INCLURE) {
    fautes.push({
      fr: `Au plus ${CIBLAGE_MAX_INCLURE} conditions d’inclusion (il y en a ${inclure.length}).`,
      en: `At most ${CIBLAGE_MAX_INCLURE} include conditions (there are ${inclure.length}).`,
    });
  }
  if (exclure.length > CIBLAGE_MAX_EXCLURE) {
    fautes.push({
      fr: `Au plus ${CIBLAGE_MAX_EXCLURE} exclusions (il y en a ${exclure.length}).`,
      en: `At most ${CIBLAGE_MAX_EXCLURE} exclusions (there are ${exclure.length}).`,
    });
  }
  [...inclure, ...exclure].forEach((r) => {
    const quoi = libelleRegle(r, true, Object.fromEntries(Object.entries(champsClient ?? {}).map(([id, x]) => [id, { label: x.label }])));
    const what = libelleRegle(r, false, Object.fromEntries(Object.entries(champsClient ?? {}).map(([id, x]) => [id, { label: x.label }])));
    if (!regleComplete(r)) {
      fautes.push({ fr: `Une condition est incomplète (${quoi.trim()}) : choisissez une valeur.`, en: `A condition is incomplete (${what.trim()}): pick a value.` });
      return;
    }
    if (r.type === 'etiquette' && r.valeur.length > CIBLAGE_VALEUR_MAX) {
      fautes.push({ fr: 'Une étiquette est trop longue.', en: 'A tag is too long.' });
    }
    if (r.type === 'fiche' && String(r.value ?? '').length > CIBLAGE_VALEUR_MAX) {
      fautes.push({ fr: `${LIBELLES_FICHE[r.cle].fr} : la valeur est trop longue.`, en: `${LIBELLES_FICHE[r.cle].en}: the value is too long.` });
    }
    if (r.type === 'fiche' && VALEURS_FICHE[r.cle] && r.op !== 'is_empty' && r.op !== 'is_not_empty'
      && !VALEURS_FICHE[r.cle]!.some((o) => o.cle === String(r.value ?? '').trim().toLowerCase())) {
      fautes.push({
        fr: `${LIBELLES_FICHE[r.cle].fr} : choisissez une valeur dans la liste.`,
        en: `${LIBELLES_FICHE[r.cle].en}: pick a value from the list.`,
      });
    }
    if (r.type === 'champ' && champsClient) {
      const champ = champsClient[r.field_id];
      if (!champ) {
        fautes.push({
          fr: 'Une condition porte sur un champ qui n’est pas (ou plus) un champ de la fiche client.',
          en: 'A condition uses a field that is not (or no longer) a client field.',
        });
      } else if (!OPERATEURS_PAR_FAMILLE[familleDuType(champ.type)].includes(r.op)) {
        fautes.push({
          fr: `« ${champ.label} » : cette comparaison n’a pas de sens pour ce type de champ.`,
          en: `“${champ.label}”: this comparison makes no sense for this field type.`,
        });
      }
    }
  });
  return fautes;
}

/** Les ids des champs personnalisés cités — les SEULES valeurs que le moteur a besoin de lire. */
export function champsCites(c: Ciblage | CiblageLu | null | undefined): string[] {
  const toutes = [...(c?.inclure?.regles ?? []), ...(c?.exclure ?? []), ...((c as CiblageLu | null | undefined)?.exiger ?? [])];
  return [...new Set(toutes.flatMap((r) => (r.type === 'champ' ? [r.field_id] : [])))];
}

/** Le ciblage cite-t-il au moins une étiquette (faut-il lire `client_tags`) ? */
export function citeDesEtiquettes(c: Ciblage | CiblageLu | null | undefined): boolean {
  const toutes = [...(c?.inclure?.regles ?? []), ...(c?.exclure ?? []), ...((c as CiblageLu | null | undefined)?.exiger ?? [])];
  return toutes.some((r) => r.type === 'etiquette');
}

// ── Évaluation ──────────────────────────────────────────────

function valeurFiche(f: FicheClient, cle: CleFiche): string | null {
  if (cle === 'genre') return (f.company ?? '').trim() ? 'entreprise' : 'particulier';
  return f[cle];
}

/**
 * La règle est-elle vraie pour ce client ? `null` = on ne peut pas le savoir
 * (champ disparu, règle incomplète, comparaison sans sens pour le type) :
 * l'appelant tranche — une inclusion invérifiable ne cible pas, une exclusion
 * invérifiable exclut. On n'écrit jamais à quelqu'un sur une règle qu'on ne
 * sait pas juger.
 */
export function regleVraie(r: RegleCiblage, f: FicheClient, ctx: ContexteCiblage = {}): boolean | null {
  if (r.type === 'etiquette') {
    const cherchee = r.valeur.trim().toLowerCase();
    if (cherchee === '') return null;
    return f.etiquettes.some((t) => t.trim().toLowerCase() === cherchee);
  }
  try {
    if (r.type === 'fiche') {
      return evaluerCondition('single_line', valeurFiche(f, r.cle), { field_id: r.cle, op: r.op, value: r.value ?? null }, ctx);
    }
    const type = f.champs[r.field_id]?.type ?? f.typesChamps?.[r.field_id];
    // Champ disparu (archivé, supprimé, d'une autre fiche) : invérifiable.
    if (!type) return null;
    const { type: _t, ...condition } = r;
    return evaluerCondition(type, f.champs[r.field_id]?.valeur ?? null, condition as Condition,
      { fuseau: ctx.fuseau, maintenant: ctx.maintenant, avecHeure: f.champs[r.field_id]?.avecHeure });
  } catch {
    // `evaluerCondition` lève sur une valeur manquante ou un opérateur étranger au type : invérifiable.
    return null;
  }
}

/**
 * Le client est-il ciblé ? Les EXCLUSIONS passent avant tout.
 * `raison` : pourquoi il ne l'est pas — ce que le journal affichera
 * (« Ignoré : hors ciblage — exclu par l’étiquette « Ne pas relancer » »).
 */
export function evaluerCiblage(
  c: Ciblage | CiblageLu | null | undefined, f: FicheClient, ctx: ContexteCiblage = {}, libelles: Record<string, string> = {},
): VerdictCiblage {
  if (!c) return { cible: true, raison: null };
  const fr = ctx.fr !== false;
  const lu = c as CiblageLu;
  const non = (frTxt: string, enTxt: string): VerdictCiblage => ({ cible: false, raison: fr ? frTxt : enTxt });

  for (const r of c.exclure ?? []) {
    const v = regleVraie(r, f, ctx);
    if (v === true) return non(`exclu par ${decrireRegle(r, libelles, true)}`, `excluded by ${decrireRegle(r, libelles, false)}`);
    if (v === null) {
      return non(
        `${decrireRegle(r, libelles, true)} ne peut pas être vérifiée (champ supprimé ou condition incomplète)`,
        `${decrireRegle(r, libelles, false)} cannot be checked (deleted field or incomplete condition)`,
      );
    }
  }
  if (lu.illisible?.exclure) return non('une exclusion du ciblage est illisible', 'a targeting exclusion cannot be read');

  const manque = (r: RegleCiblage): VerdictCiblage => (r.type === 'etiquette'
    ? non(`n’a pas ${decrireRegle(r, libelles, true)}`, `does not have ${decrireRegle(r, libelles, false)}`)
    : non(`ne remplit pas ${decrireRegle(r, libelles, true)}`, `does not meet ${decrireRegle(r, libelles, false)}`));

  for (const r of lu.exiger ?? []) if (regleVraie(r, f, ctx) !== true) return manque(r);

  const regles = c.inclure?.regles ?? [];
  if (lu.illisible?.inclure && (c.inclure?.mode !== 'une' || regles.length === 0)) {
    return non('une condition du ciblage est illisible', 'a targeting condition cannot be read');
  }
  if (regles.length === 0) return { cible: true, raison: null };
  if (c.inclure?.mode === 'une') {
    return regles.some((r) => regleVraie(r, f, ctx) === true)
      ? { cible: true, raison: null }
      : regles.length === 1 ? manque(regles[0]) : non('ne remplit aucune des conditions', 'meets none of the conditions');
  }
  const manquante = regles.find((r) => regleVraie(r, f, ctx) !== true);
  return manquante ? manque(manquante) : { cible: true, raison: null };
}

/** Le code de saut écrit au journal quand le ciblage écarte un client. */
export const CODE_HORS_CIBLAGE = 'hors_ciblage';

/** La phrase du journal : « Ignoré : hors ciblage — exclu par l’étiquette « Ne pas relancer » ». */
export function phraseHorsCiblage(raison: string | null | undefined, fr = true): string {
  const base = fr ? 'Ignoré : hors ciblage' : 'Skipped: not targeted';
  return raison ? `${base} — ${raison}` : base;
}

// ── Chevauchement de deux ciblages (avertissement de doublon) ──

/** Les règles qu'un client DOIT remplir : `exiger`, et `inclure` en mode « toutes » ou à une seule règle. */
function reglesExigees(c: CiblageLu | null | undefined): RegleCiblage[] {
  const inclure = c?.inclure?.regles ?? [];
  return [...(c?.exiger ?? []), ...(c?.inclure?.mode === 'toutes' || inclure.length === 1 ? inclure : [])];
}

const norme = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Deux ciblages peuvent-ils toucher un même client ? Prudent : « oui » sauf
 * quand on PEUT prouver le contraire —
 *   · l'un exige une étiquette que l'autre exclut ;
 *   · l'un exige « fiche = X » que l'autre exclut, ou les deux exigent deux
 *     valeurs différentes du même champ de la fiche (« Entreprise » d'un côté,
 *     « Particulier » de l'autre).
 * Un avertissement de trop se lit et s'ignore ; un avertissement manquant
 * laisse deux messages partir.
 */
export function ciblagesSeChevauchent(a: Ciblage | CiblageLu | null | undefined, b: Ciblage | CiblageLu | null | undefined): boolean {
  const etiquettes = (regles: RegleCiblage[]) => regles.filter((r): r is RegleEtiquette => r.type === 'etiquette').map((r) => norme(r.valeur));
  const fiches = (regles: RegleCiblage[]) => regles
    .filter((r): r is RegleFiche => r.type === 'fiche' && r.op === 'is')
    .map((r) => ({ cle: r.cle, valeur: norme(r.value) }));
  const disjoint = (x: CiblageLu | null | undefined, y: CiblageLu | null | undefined): boolean => {
    const exigees = reglesExigees(x);
    const exclues = y?.exclure ?? [];
    if (etiquettes(exigees).some((t) => etiquettes(exclues).includes(t))) return true;
    if (fiches(exigees).some((p) => fiches(exclues).some((q) => q.cle === p.cle && q.valeur === p.valeur))) return true;
    return fiches(exigees).some((p) => fiches(reglesExigees(y)).some((q) => q.cle === p.cle && q.valeur !== p.valeur));
  };
  return !(disjoint(a, b) || disjoint(b, a));
}

// ── En une phrase (résumé de l'automatisation, confirmation de publication) ──

/**
 * Le ciblage en quelques mots : « seulement les clients avec étiquette « VIP »
 * ou étiquette « Commercial », sauf étiquette « Ne pas relancer » ». Vide
 * quand tous les clients sont visés.
 */
export function ciblageEnClair(
  c: Ciblage | CiblageLu | null | undefined, fr = true,
  champs: Record<string, { label: string; options?: Array<{ id: string; label: string }> }> = {},
): string {
  if (ciblageVide(c)) return '';
  const lu = c as CiblageLu;
  const exigees = (lu.exiger ?? []).map((r) => libelleRegle(r, fr, champs));
  const regles = (c?.inclure?.regles ?? []).map((r) => libelleRegle(r, fr, champs));
  const liant = c?.inclure?.mode === 'une' ? (fr ? ' ou ' : ' or ') : (fr ? ' et ' : ' and ');
  const groupe = regles.length > 1 && exigees.length > 0 ? `(${regles.join(liant)})` : regles.join(liant);
  const inclus = [...exigees, ...(groupe ? [groupe] : [])].join(fr ? ' et ' : ' and ');
  const exclus = (c?.exclure ?? []).map((r) => libelleRegle(r, fr, champs)).join(fr ? ' ou ' : ' or ');
  if (inclus && exclus) return fr ? `seulement les clients avec ${inclus}, sauf ${exclus}` : `only clients with ${inclus}, except ${exclus}`;
  if (inclus) return fr ? `seulement les clients avec ${inclus}` : `only clients with ${inclus}`;
  if (exclus) return fr ? `tous les clients sauf ${exclus}` : `all clients except ${exclus}`;
  return fr ? 'ciblage à corriger' : 'targeting to fix';
}

/** Les opérateurs offerts pour un champ personnalisé de ce type (le vocabulaire du moteur partagé). */
export function operateursDuChamp(type: TypeChamp): Operateur[] {
  return OPERATEURS_PAR_FAMILLE[familleDuType(type)];
}

// ── Les actions d'une règle, ses canaux, les demandes d'avis ──

export interface ActionDeRegle {
  type: string;
  config: Record<string, unknown>;
  /** L'étape du parcours qui la porte (absente pour une règle au format d'origine). */
  etapeId?: string;
  nom?: string | null;
}

interface RegleAvecActions { steps?: unknown; actions?: unknown; preset_key?: string | null }

/**
 * Les actions qu'une règle exécute : celles de son parcours (`steps`) s'il en
 * a un — c'est lui que le moteur exécute —, sinon celles du format d'origine
 * (`actions`). Une automatisation neuve (action provisoire « À compléter »)
 * n'en a aucune.
 */
export function actionsDUneRegle(regle: RegleAvecActions | null | undefined): ActionDeRegle[] {
  const steps = Array.isArray(regle?.steps) ? (regle.steps as unknown[]) : [];
  if (steps.length > 0) {
    return steps.flatMap((e): ActionDeRegle[] => {
      if (!estObjet(e) || e.type !== 'action' || !estObjet(e.action) || typeof e.action.type !== 'string') return [];
      return [{
        type: e.action.type, config: estObjet(e.action.config) ? e.action.config : {},
        ...(typeof e.id === 'string' ? { etapeId: e.id } : {}), nom: typeof e.nom === 'string' ? e.nom : null,
      }];
    });
  }
  if (!estFormatOrigine({ steps, actions: regle?.actions })) return [];
  return (regle?.actions as unknown[]).flatMap((a): ActionDeRegle[] => (
    estObjet(a) && typeof a.type === 'string' ? [{ type: a.type, config: estObjet(a.config) ? a.config : {} }] : []
  ));
}

export type CanalClient = 'sms' | 'email';

/** Les canaux par lesquels la règle écrit au CLIENT. Une demande d'avis compte pour les deux. */
export function canauxDeLaRegle(regle: RegleAvecActions | null | undefined): CanalClient[] {
  const canaux = new Set<CanalClient>();
  for (const a of actionsDUneRegle(regle)) {
    if (a.type === 'send_sms') canaux.add('sms');
    if (a.type === 'send_email') canaux.add('email');
    if (a.type === 'request_review') { canaux.add('sms'); canaux.add('email'); }
  }
  return (['sms', 'email'] as const).filter((c) => canaux.has(c));
}

/** Les variables qui portent un lien d'avis ou de sondage. */
export const VARIABLES_D_AVIS = ['google_review_url', 'facebook_review_url', 'review_page_url', 'review_link', 'survey_url'] as const;
/** Les préréglages d'avis (miroir de `REVIEW_PRESET_KEYS`, server/lib/reviews.ts — un test les compare). */
export const PREREGLAGES_D_AVIS = ['google_review', 'review_reminder_7d'] as const;
/** La clé du champ personnalisé client « Aucune demande d'avis » (miroir de `NO_REVIEW_FIELD_KEY`). */
export const CLE_CHAMP_SANS_AVIS = 'noreview';

/** Une variable telle qu'on l'écrit : `[cle]`, `{cle}`, `{{cle}}`, avec ou sans `|valeur de remplacement`. */
const RE_VARIABLE_ECRITE = /[[{]\s*([A-Za-z]\w*)\s*(?:\|[^\]{}[]*)?[\]}]/g;

/** Ce texte cite-t-il un lien d'avis — `[google_review_url]`, `{review_link}`, `{{survey_url}}`, avec ou sans valeur de remplacement ? */
export function texteCiteUnAvis(texte: unknown): boolean {
  if (typeof texte !== 'string') return false;
  return [...texte.matchAll(RE_VARIABLE_ECRITE)].some((m) => (VARIABLES_D_AVIS as readonly string[]).includes(m[1]));
}

/**
 * Cette action est-elle une DEMANDE D'AVIS ? Oui si c'est « Demander un avis »,
 * si la règle est un préréglage d'avis, ou si un de ses textes (corps, objet,
 * aperçu, dans les deux langues) porte un lien d'avis. Dans ces trois cas un
 * client marqué « Aucune demande d'avis » est toujours exclu — exclusion
 * verrouillée, affichée dans « Qui est ciblé », jamais retirable.
 */
export function estDemandeDAvis(
  regle: { preset_key?: string | null } | null | undefined,
  action: { type?: string | null; config?: Record<string, unknown> | null } | null | undefined,
): boolean {
  if (!action) return false;
  if (action.type === 'request_review') return true;
  if (action.type !== 'send_sms' && action.type !== 'send_email') return false;
  if (regle?.preset_key && (PREREGLAGES_D_AVIS as readonly string[]).includes(regle.preset_key)) return true;
  return Object.values(action.config ?? {}).some(texteCiteUnAvis);
}

/** La règle porte-t-elle au moins une demande d'avis ? */
export function regleDemandeUnAvis(regle: RegleAvecActions | null | undefined): boolean {
  return actionsDUneRegle(regle).some((a) => estDemandeDAvis(regle, a));
}
