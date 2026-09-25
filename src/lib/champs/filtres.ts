/**
 * Moteur de filtres partagé — évaluation EN MÉMOIRE.
 *
 * Même vocabulaire et mêmes sémantiques que le moteur SQL (cf_condition_sql,
 * migration 20260926100000) : le SQL filtre les gros volumes (pipeline,
 * listes), celui-ci sert là où les données sont déjà chargées (page de
 * réglages, conditions d'automatisation). tests/champs-perso-filtres.test.ts
 * fige les deux sur les mêmes cas.
 *
 * Les DATES se comparent en heure LOCALE de l'entreprise (défaut
 * America/Toronto), jamais en UTC : « aujourd'hui » à 23 h 30 à Montréal
 * est encore aujourd'hui, même s'il est 3 h 30 le lendemain en UTC.
 * L'arithmétique se fait sur l'heure murale (comme `now() at time zone tz
 * - interval` en SQL), donc un changement d'heure ne décale pas les jours.
 */
import type { TypeChamp } from './types';

export const FUSEAU_PAR_DEFAUT = 'America/Toronto';

export type OperateurTexte = 'is' | 'is_not' | 'contains' | 'not_contains';
export type OperateurNombre = 'eq' | 'neq' | 'gt' | 'lt' | 'between';
export type OperateurListe = 'any_of' | 'none_of';
export type OperateurDate = 'today' | 'yesterday' | 'in_last' | 'more_than_ago' | 'less_than_ago' | 'before' | 'after' | 'between';
export type OperateurVide = 'is_empty' | 'is_not_empty';
export type Operateur = OperateurTexte | OperateurNombre | OperateurListe | OperateurDate | OperateurVide;
export type UniteDuree = 'days' | 'weeks' | 'months';

export interface Condition {
  /** id du champ personnalisé, ou clé d'un champ standard. */
  field_id: string;
  op: Operateur;
  value?: string | number | string[] | null;
  value2?: string | number | null;
  n?: number;
  unit?: UniteDuree;
}

export type FamilleType = 'texte' | 'nombre' | 'liste' | 'date';

export function familleDuType(type: TypeChamp): FamilleType {
  if (type === 'number' || type === 'monetary') return 'nombre';
  if (type === 'dropdown_single' || type === 'dropdown_multi') return 'liste';
  if (type === 'date') return 'date';
  return 'texte';
}

export const OPERATEURS_PAR_FAMILLE: Record<FamilleType, Operateur[]> = {
  texte: ['is', 'is_not', 'contains', 'not_contains', 'is_empty', 'is_not_empty'],
  nombre: ['eq', 'neq', 'gt', 'lt', 'between', 'is_empty', 'is_not_empty'],
  liste: ['any_of', 'none_of', 'is_empty', 'is_not_empty'],
  date: ['today', 'yesterday', 'in_last', 'more_than_ago', 'less_than_ago', 'before', 'after', 'between', 'is_empty', 'is_not_empty'],
};

export const LIBELLES_OPERATEUR: Record<Operateur, { fr: string; en: string }> = {
  is: { fr: 'est', en: 'is' },
  is_not: { fr: 'n’est pas', en: 'is not' },
  contains: { fr: 'contient', en: 'contains' },
  not_contains: { fr: 'ne contient pas', en: 'doesn’t contain' },
  eq: { fr: '=', en: '=' },
  neq: { fr: '≠', en: '≠' },
  gt: { fr: 'plus grand que', en: 'greater than' },
  lt: { fr: 'plus petit que', en: 'less than' },
  between: { fr: 'entre', en: 'between' },
  any_of: { fr: 'est l’un de', en: 'is any of' },
  none_of: { fr: 'n’est aucun de', en: 'is none of' },
  today: { fr: 'aujourd’hui', en: 'today' },
  yesterday: { fr: 'hier', en: 'yesterday' },
  in_last: { fr: 'dans les derniers', en: 'in the last' },
  more_than_ago: { fr: 'il y a plus de', en: 'more than … ago' },
  less_than_ago: { fr: 'il y a moins de', en: 'less than … ago' },
  before: { fr: 'avant le', en: 'before' },
  after: { fr: 'après le', en: 'after' },
  is_empty: { fr: 'est vide', en: 'is empty' },
  is_not_empty: { fr: 'n’est pas vide', en: 'is not empty' },
};

/** Opérateurs qui demandent N + unité. */
export const OPERATEURS_DUREE: readonly Operateur[] = ['in_last', 'more_than_ago', 'less_than_ago'];

// ─── Heure murale ────────────────────────────────────────────────

/** 'AAAA-MM-JJTHH:MM:SS' de l'instant, dans le fuseau — comparable en texte. */
export function heureMurale(instant: Date, fuseau: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '00';
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}`;
}

/** Jour civil local 'AAAA-MM-JJ'. */
export function jourLocal(instant: Date, fuseau: string): string {
  return heureMurale(instant, fuseau).slice(0, 10);
}

function joursDansMois(annee: number, mois: number): number {
  return new Date(Date.UTC(annee, mois, 0)).getUTCDate();
}

/**
 * Retire N jours / semaines / mois à une heure murale, comme Postgres :
 * '2026-03-31' - 1 mois = '2026-02-28' (fin de mois bornée).
 */
export function retirerDuree(mur: string, n: number, unite: UniteDuree): string {
  const [date, heure = '00:00:00'] = mur.split('T');
  let [a, m, j] = date.split('-').map(Number);
  if (unite === 'months') {
    const total = a * 12 + (m - 1) - n;
    a = Math.floor(total / 12);
    m = (total % 12) + 1;
    j = Math.min(j, joursDansMois(a, m));
  } else {
    const jours = unite === 'weeks' ? n * 7 : n;
    const d = new Date(Date.UTC(a, m - 1, j - jours));
    a = d.getUTCFullYear(); m = d.getUTCMonth() + 1; j = d.getUTCDate();
  }
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${a}-${pad(m)}-${pad(j)}T${heure}`;
}

function veille(jour: string): string {
  return retirerDuree(`${jour}T00:00:00`, 1, 'days').slice(0, 10);
}

// ─── Évaluation ──────────────────────────────────────────────────

export interface ContexteEvaluation {
  fuseau?: string;
  maintenant?: Date;
  /** Pour un champ date : la valeur porte-t-elle une heure ? */
  avecHeure?: boolean;
}

const estVide = (v: unknown) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** Même normalisation que value_normalized pour le texte. */
export function normaliserTexte(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Téléphone → E.164 (Canada par défaut), null si ce n'est pas un numéro.
 *  Miroir de cf_normaliser_telephone(). */
export function normaliserTelephone(brut: string): string | null {
  const chiffres = String(brut ?? '').replace(/[^0-9]/g, '');
  if (String(brut ?? '').trim().startsWith('+')) {
    return chiffres.length >= 8 && chiffres.length <= 15 ? `+${chiffres}` : null;
  }
  if (chiffres.length === 10) return `+1${chiffres}`;
  if (chiffres.length === 11 && chiffres.startsWith('1')) return `+${chiffres}`;
  return null;
}

/**
 * La valeur satisfait-elle la condition ?
 * `valeur` suit ValeurChamp : texte, nombre (cents pour un montant),
 * 'AAAA-MM-JJ' ou ISO, id d'option ou liste d'ids.
 * Lève une erreur sur un opérateur qui n'a pas de sens pour le type.
 */
export function evaluerCondition(type: TypeChamp, valeur: unknown, c: Condition, ctx: ContexteEvaluation = {}): boolean {
  const famille = familleDuType(type);
  if (!OPERATEURS_PAR_FAMILLE[famille].includes(c.op)) {
    throw new Error(`Opérateur « ${c.op} » invalide pour un champ ${type}.`);
  }
  if (c.op === 'is_empty') return estVide(valeur);
  if (c.op === 'is_not_empty') return !estVide(valeur);

  if (famille === 'texte') {
    const norme = (x: unknown) => (type === 'phone' ? normaliserTelephone(String(x ?? '')) ?? normaliserTexte(x) : normaliserTexte(x));
    const v = estVide(valeur) ? null : norme(valeur);
    const cible = norme(c.value);
    switch (c.op) {
      case 'is': return v === cible;
      case 'is_not': return v !== cible;
      case 'contains': return v !== null && v.includes(cible);
      case 'not_contains': return v === null || !v.includes(cible);
    }
  }

  if (famille === 'nombre') {
    const a = Number(c.value);
    if (c.value === undefined || c.value === null || c.value === '' || !Number.isFinite(a)) throw new Error(`Valeur manquante pour « ${c.op} ».`);
    const v = estVide(valeur) ? null : Number(valeur);
    switch (c.op) {
      case 'eq': return v === a;
      case 'neq': return v === null || v !== a;
      case 'gt': return v !== null && v > a;
      case 'lt': return v !== null && v < a;
      case 'between': {
        const b = Number(c.value2);
        if (!Number.isFinite(b)) throw new Error('Valeur manquante pour « between ».');
        return v !== null && v >= Math.min(a, b) && v <= Math.max(a, b);
      }
    }
  }

  if (famille === 'liste') {
    const cibles = new Set((Array.isArray(c.value) ? c.value : [c.value]).filter((x) => x != null).map(String));
    if (cibles.size === 0) throw new Error('Aucune option choisie.');
    const choisies = (Array.isArray(valeur) ? valeur : estVide(valeur) ? [] : [valeur]).map(String);
    const touche = choisies.some((x) => cibles.has(x));
    return c.op === 'any_of' ? touche : !touche;
  }

  // Dates
  const fuseau = ctx.fuseau || FUSEAU_PAR_DEFAUT;
  const maintenant = heureMurale(ctx.maintenant ?? new Date(), fuseau);
  const aujourdhui = maintenant.slice(0, 10);
  if (estVide(valeur)) return false;
  // Valeur ramenée à l'heure murale locale (une date seule est un jour civil).
  const texte = String(valeur);
  const avecHeure = ctx.avecHeure ?? texte.length > 10;
  const mur = avecHeure ? heureMurale(new Date(texte), fuseau) : `${texte.slice(0, 10)}T00:00:00`;
  const jour = mur.slice(0, 10);
  const n = Math.max(0, Math.floor(Number(c.n ?? 0)));
  const unite: UniteDuree = c.unit ?? 'days';
  const borne = retirerDuree(avecHeure ? maintenant : `${aujourdhui}T00:00:00`, n, unite);
  const exigerDate = (x: unknown) => {
    if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(x)) throw new Error(`Date manquante pour « ${c.op} ».`);
    return x.slice(0, 10);
  };
  switch (c.op) {
    case 'today': return jour === aujourdhui;
    case 'yesterday': return jour === veille(aujourdhui);
    case 'in_last': return avecHeure ? mur >= borne && mur <= maintenant : jour >= borne.slice(0, 10) && jour <= aujourdhui;
    case 'more_than_ago': return avecHeure ? mur < borne : jour < borne.slice(0, 10);
    case 'less_than_ago': return avecHeure ? mur >= borne : jour >= borne.slice(0, 10);
    case 'before': return jour < exigerDate(c.value);
    case 'after': return jour > exigerDate(c.value);
    case 'between': {
      const a = exigerDate(c.value);
      const b = exigerDate(c.value2);
      return jour >= (a < b ? a : b) && jour <= (a < b ? b : a);
    }
  }
  return false;
}

/** Toutes les conditions (ET logique). */
export function evaluerConditions(
  conditions: Condition[],
  lire: (fieldId: string) => { type: TypeChamp; valeur: unknown; avecHeure?: boolean } | null,
  ctx: ContexteEvaluation = {},
): boolean {
  return conditions.every((c) => {
    const champ = lire(c.field_id);
    if (!champ) return false;
    return evaluerCondition(champ.type, champ.valeur, c, { ...ctx, avecHeure: champ.avecHeure });
  });
}
