/* ═══════════════════════════════════════════════════════════════
   Les refus de validation d'une automatisation, en mots d'entrepreneur.

   L'éditeur affiche tel quel le champ `error` de la réponse 400
   (automationBuilderApi.ts, `erreurDe`). Avant ce module, un propriétaire
   lisait « Invalid input: expected string, received null », « Unrecognized
   key: "to" » ou simplement « Invalid input » (audit de la suite
   automatisations, 2026-09-30) — sans savoir quel champ corriger.

   Chaque problème Zod devient une phrase française qui NOMME le champ
   (« Action 2 (« Envoyer un texto »), champ « Texte du message » :
   obligatoire. »), avec sa version anglaise dans `params.en` :
   `repondreDansLaLangue` (automations-langue.ts) la sert à une interface
   anglaise.
   ═══════════════════════════════════════════════════════════════ */
import type { z } from 'zod';
import { trouverAction } from '../../src/lib/automationCatalogue';

type Chemin = ReadonlyArray<PropertyKey>;

/** Ce que ce module lit d'un problème Zod (v4). */
interface Probleme {
  code: string;
  message: string;
  path: Chemin;
  expected?: string;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  keys?: string[];
  values?: unknown[];
  note?: string;
  errors?: Probleme[][];
  /** Posé par les raffinements du schéma : la version anglaise du message. */
  params?: { en?: unknown };
}

export interface MessageClair { fr: string; en: string; path: PropertyKey[] }

/** Messages écrits en anglais dans les schémas → français clair / anglais. */
const MESSAGES_FIXES: Array<[RegExp, (m: RegExpExecArray) => [string, string]]> = [
  [/^Name is required\.$/, () => ['Donnez un nom à l’automatisation.', 'Give the automation a name.']],
  [/^Unknown trigger\.$/, () => ['Déclencheur inconnu : choisissez-en un dans la liste.', 'Unknown trigger: pick one from the list.']],
  [/^Unknown action\.$/, () => ['Action inconnue : choisissez-en une dans la liste.', 'Unknown action: pick one from the list.']],
  [/^Add at least one action\.$/, () => ['Ajoutez au moins une action.', 'Add at least one action.']],
  [/^Too many actions\.$/, () => ['Trop d’actions (20 au plus).', 'Too many actions (20 at most).']],
  [/^An automation carries at most (\d+) actions\.$/, (m) => [
    `Une automatisation simple compte au plus ${m[1]} actions : au-delà, faites-en un parcours.`,
    `A simple automation carries at most ${m[1]} actions: beyond that, make it a journey.`]],
  [/^The delay must be a whole number of seconds\.$/, () => ['Le délai doit être un nombre entier de secondes.', 'The delay must be a whole number of seconds.']],
  [/^Cannot send more than 30 days before\.$/, () => ['On ne peut pas envoyer plus de 30 jours avant.', 'Cannot send more than 30 days before.']],
  [/^Cannot wait more than a year\.$/, () => ['On ne peut pas attendre plus d’un an.', 'Cannot wait more than a year.']],
  [/^Empty condition\.$/, () => ['Condition vide : choisissez un opérateur et une valeur.', 'Empty condition: pick an operator and a value.']],
  [/^Too many conditions \(10 max\)\.$/, () => ['Trop de conditions (10 au plus).', 'Too many conditions (10 at most).']],
  [/^Invalid step id\.$/, () => ['identifiant d’étape invalide (lettres, chiffres, - et _ seulement).', 'invalid step id (letters, digits, - and _ only).']],
  [/^A wait cannot be negative\.$/, () => ['Une attente ne peut pas être négative.', 'A wait cannot be negative.']],
  [/^At most 30 days before\.$/, () => ['Au plus 30 jours avant.', 'At most 30 days before.']],
  [/^A « before the date » wait needs how long before\.$/, () => [
    'Une attente « avant la date » doit dire combien de temps avant.', 'A “before the date” wait needs how long before.']],
  [/^A sequence needs at least one step\.$/, () => ['Un parcours a besoin d’au moins une étape.', 'A journey needs at least one step.']],
  [/^A sequence carries at most (\d+) steps\.$/, (m) => [`Un parcours compte au plus ${m[1]} étapes.`, `A journey carries at most ${m[1]} steps.`]],
  [/^Nothing to update\.$/, () => ['Rien à modifier.', 'Nothing to change.']],
  [/^Dossier invalide\.$/, () => ['Dossier invalide.', 'Invalid folder.']],
];

/** Message par défaut de Zod : jamais montré tel quel. */
const MESSAGE_ZOD = /^(Invalid input|Invalid (string|number|option|format|element|key|value|union)|Too (big|small)|Unrecognized key|Expected |Invalid UUID)/i;

const CHAMPS: Record<string, [string, string]> = {
  name: ['Nom', 'Name'], description: ['Description', 'Description'], trigger_event: ['Déclencheur', 'Trigger'],
  conditions: ['Conditions', 'Conditions'], delay_seconds: ['Délai', 'Delay'], actions: ['Actions', 'Actions'],
  is_active: ['Publication', 'Published'], settings: ['Réglages', 'Settings'], folder_id: ['Dossier', 'Folder'],
  steps: ['Parcours', 'Journey'],
};
const REGLAGES: Record<string, [string, string]> = {
  fenetre: ['fenêtre d’envoi', 'send window'], debut: ['début', 'start'], fin: ['fin', 'end'],
  jours_ouvrables: ['jours ouvrables', 'business days'], reentree: ['laisser le client repasser', 'let the client re-enter'],
  arret_sur_reponse: ['arrêter si le client répond', 'stop when the client replies'],
  delai_entre_passages_jours: ['délai entre deux passages (jours)', 'days between two passes'],
  arreter_si_resolu: ['arrêter si c’est réglé', 'stop when resolved'], marquer_lu: ['marquer comme lu', 'mark as read'],
};
const CHAMPS_ETAPE: Record<string, [string, string]> = {
  id: ['identifiant', 'id'], type: ['type', 'type'], delai_secondes: ['durée de l’attente', 'wait duration'],
  secondes_avant: ['délai avant la date', 'time before the date'], mode: ['type d’attente', 'wait type'],
  suivant: ['étape suivante', 'next step'], alors: ['étape « alors »', '“then” step'], sinon: ['étape « sinon »', '“else” step'],
  si_reponse: ['étape « si réponse »', '“if reply” step'], si_depasse: ['étape « si dépassé »', '“if passed” step'],
  nom: ['nom', 'name'], conditions: ['conditions', 'conditions'], action: ['action', 'action'],
};

const CHAMPS_CONDITION: Record<string, [string, string]> = {
  field_id: ['champ', 'field'], op: ['opérateur', 'operator'], value: ['valeur', 'value'],
  value2: ['2e valeur', 'second value'], n: ['durée', 'duration'], unit: ['unité', 'unit'],
};

const lire = (racine: unknown, chemin: Chemin): unknown => chemin.reduce<unknown>(
  (v, k) => (v !== null && typeof v === 'object' ? (v as Record<PropertyKey, unknown>)[k as string] : undefined), racine);

/** « Action 2 (« Envoyer un texto »), champ « Texte du message » » */
function lieuAction(action: unknown, rang: [string, string], reste: Chemin): [string, string] {
  const type = String((action as { type?: unknown } | null)?.type ?? '');
  const modele = trouverAction(type);
  let fr = modele ? `${rang[0]} (« ${modele.fr} »)` : rang[0];
  let en = modele ? `${rang[1]} (“${modele.en}”)` : rang[1];
  if (reste[0] === 'config') {
    if (typeof reste[1] === 'string') {
      const brute = reste[1];
      const cle = brute.endsWith('_en') ? brute.slice(0, -3) : brute;
      const champ = modele?.champs.find((c) => c.cle === cle);
      const anglais = brute !== cle;
      fr += `, champ « ${champ?.fr ?? brute} »${anglais && champ ? ' (anglais)' : ''}`;
      en += `, field “${champ?.en ?? brute}”${anglais && champ ? ' (English)' : ''}`;
    } else {
      fr += ', réglages'; en += ', settings';
    }
  }
  return [fr, en];
}

/**
 * « Étape 2 (« Créer une tâche ») » — l'étape (ou l'action d'une règle simple)
 * qui porte le champ fautif, sans le champ : le message le nomme déjà.
 * `null` quand le problème ne vise pas la configuration d'une action.
 */
function lieuDeLEtape(chemin: Chemin, brut: unknown): [string, string] | null {
  const [tete, rang, ...suite] = chemin;
  if (typeof rang !== 'number') return null;
  const n = rang + 1;
  if (tete === 'steps' && suite[0] === 'action' && suite[1] === 'config') {
    return lieuAction(lire(brut, ['steps', rang, 'action']), [`Étape ${n}`, `Step ${n}`], []);
  }
  if (tete === 'actions' && suite[0] === 'config') {
    return lieuAction(lire(brut, ['actions', rang]), [`Action ${n}`, `Action ${n}`], []);
  }
  return null;
}

/** Où se trouve le problème, en mots : [français, anglais]. */
function lieu(chemin: Chemin, brut: unknown): [string, string] {
  const [tete, ...reste] = chemin;
  if (tete === 'actions' && typeof reste[0] === 'number') {
    const n = reste[0] + 1;
    return lieuAction(lire(brut, ['actions', reste[0]]), [`Action ${n}`, `Action ${n}`], reste.slice(1));
  }
  if (tete === 'steps' && typeof reste[0] === 'number') {
    const n = reste[0] + 1;
    const suite = reste.slice(1);
    if (suite[0] === 'action' && suite.length > 1) {
      const [fr, en] = lieuAction(lire(brut, ['steps', reste[0], 'action']), [`Étape ${n}`, `Step ${n}`], suite.slice(1));
      return [fr, en];
    }
    if (suite[0] === 'conditions' && typeof suite[1] === 'string') {
      return [`Étape ${n}, condition « ${suite[1]} »`, `Step ${n}, condition “${suite[1]}”`];
    }
    const champ = typeof suite[0] === 'string' ? CHAMPS_ETAPE[suite[0]] : undefined;
    return champ ? [`Étape ${n}, ${champ[0]}`, `Step ${n}, ${champ[1]}`] : [`Étape ${n}`, `Step ${n}`];
  }
  if (tete === 'conditions' && typeof reste[0] === 'string') {
    if (reste[0] === 'champs_perso') {
      const n = typeof reste[1] === 'number' ? reste[1] + 1 : null;
      const sous = typeof reste[2] === 'string' ? CHAMPS_CONDITION[reste[2]] : undefined;
      if (!n) return ['Conditions sur les champs personnalisés', 'Custom field conditions'];
      return sous
        ? [`Condition sur champ personnalisé ${n}, ${sous[0]}`, `Custom field condition ${n}, ${sous[1]}`]
        : [`Condition sur champ personnalisé ${n}`, `Custom field condition ${n}`];
    }
    return [`Condition « ${reste[0]} »`, `Condition “${reste[0]}”`];
  }
  if (tete === 'settings' && reste.length) {
    const noms = reste.filter((k): k is string => typeof k === 'string').map((k) => REGLAGES[k] ?? [k, k]);
    return [`Réglages, ${noms.map((x) => x[0]).join(' — ')}`, `Settings, ${noms.map((x) => x[1]).join(' — ')}`];
  }
  const champ = typeof tete === 'string' ? CHAMPS[tete] : undefined;
  return champ ?? ['Automatisation', 'Automation'];
}

const TYPES: Record<string, [string, string]> = {
  string: ['doit être du texte', 'must be text'], number: ['doit être un nombre', 'must be a number'],
  int: ['doit être un nombre entier', 'must be a whole number'], boolean: ['doit valoir oui ou non', 'must be yes or no'],
  array: ['doit être une liste', 'must be a list'], object: ['est illisible', 'is unreadable'], record: ['est illisible', 'is unreadable'],
  never: ['n’est pas attendu ici', 'is not expected here'],
};

/** La phrase du problème (sans le lieu) : [français, anglais]. */
function phrase(p: Probleme, valeur: unknown): [string, string] {
  const manquante = valeur === undefined || valeur === null;
  switch (p.code) {
    case 'invalid_type':
      if (manquante) return ['obligatoire', 'required'];
      return TYPES[p.expected ?? ''] ?? ['valeur illisible', 'unreadable value'];
    case 'too_small': {
      const min = Number(p.minimum);
      if (p.origin === 'string') return min <= 1 ? ['obligatoire', 'required'] : [`au moins ${min} caractères`, `at least ${min} characters`];
      if (p.origin === 'array' || p.origin === 'set') return [`la liste doit contenir au moins ${min} élément${min > 1 ? 's' : ''}`, `the list needs at least ${min} item${min > 1 ? 's' : ''}`];
      return [`doit valoir au moins ${min}`, `must be at least ${min}`];
    }
    case 'too_big': {
      const max = Number(p.maximum);
      if (p.origin === 'string') return [`${max} caractères au plus`, `${max} characters at most`];
      if (p.origin === 'array' || p.origin === 'set') return [`${max} éléments au plus`, `${max} items at most`];
      return [`doit valoir au plus ${max}`, `must be at most ${max}`];
    }
    case 'unrecognized_keys': {
      const cles = (p.keys ?? []).map((k) => `« ${k} »`).join(', ');
      const clesEn = (p.keys ?? []).map((k) => `“${k}”`).join(', ');
      return [`${cles} n’est pas un réglage reconnu ici`, `${clesEn} is not a known setting here`];
    }
    case 'invalid_value':
      if (manquante) return ['obligatoire', 'required'];
      return ['valeur non reconnue', 'unrecognized value'];
    case 'invalid_format':
      return ['format invalide', 'invalid format'];
    case 'not_multiple_of':
      return ['doit être un nombre entier', 'must be a whole number'];
    default:
      return ['valeur illisible', 'unreadable value'];
  }
}

const OPERATEURS = 'eq, neq, in, not_in, gt, gte, lt, lte';

/** Toutes les feuilles d'un problème d'union, chemins rendus absolus. */
function branches(p: Probleme): Probleme[][] {
  return (p.errors ?? []).map((b) => b.map((x) => ({ ...x, path: [...p.path, ...x.path] })));
}

function traduire(p: Probleme, brut: unknown, out: MessageClair[]): void {
  const chemin = [...p.path];
  const [ouFr, ouEn] = lieu(chemin, brut);
  const valeur = lire(brut, chemin);

  if (p.code === 'invalid_union') {
    const toutes = branches(p);
    // Aucun type d'étape ne correspond : « action, attendre, si, arreter ».
    if (p.note === 'No matching discriminator') {
      out.push({ fr: `${ouFr} : type d’étape inconnu (action, attendre, si ou arreter).`, en: `${ouEn}: unknown step type (action, attendre, si or arreter).`, path: chemin });
      return;
    }
    const estCondition = chemin[0] === 'conditions' || (chemin[0] === 'steps' && chemin[2] === 'conditions');
    const cleCondition = chemin[chemin.length - 1];
    if (estCondition && cleCondition === 'champs_perso') {
      // La branche « liste de conditions » : ses problèmes nomment la condition fautive.
      const liste = toutes.find((b) => b.length && typeof b[0].path[chemin.length] === 'number');
      if (liste) { liste.forEach((x) => traduire(x, brut, out)); return; }
    }
    if (estCondition) {
      const inconnus = toutes.flat().find((x) => x.code === 'unrecognized_keys');
      if (inconnus) {
        const ops = (inconnus.keys ?? []).map((k) => `« ${k} »`).join(', ');
        out.push({
          fr: `${ouFr} : opérateur ${ops} inconnu (possibles : ${OPERATEURS}).`,
          en: `${ouEn}: unknown operator ${(inconnus.keys ?? []).map((k) => `“${k}”`).join(', ')} (allowed: ${OPERATEURS}).`,
          path: chemin,
        });
        return;
      }
      const fixe = toutes.flat().find((x) => x.code === 'custom' && !MESSAGE_ZOD.test(x.message));
      if (fixe) { traduire(fixe, brut, out); return; }
      out.push({
        fr: `${ouFr} : illisible — indiquez une valeur (texte, nombre, oui/non) ou un opérateur (${OPERATEURS}) avec sa valeur.`,
        en: `${ouEn}: unreadable — give a value (text, number, yes/no) or an operator (${OPERATEURS}) with its value.`,
        path: chemin,
      });
      return;
    }
    // Autre union (parcours : « séquence » ou « tableau vide ») : la branche
    // qui décrit vraiment la donnée est celle qui n'attend pas « rien ».
    const utile = toutes.find((b) => b.length && !b.some((x) => x.expected === 'never'))
      ?? toutes.find((b) => b.length);
    if (utile) { utile.forEach((x) => traduire(x, brut, out)); return; }
    const [fr, en] = phrase(p, valeur);
    out.push({ fr: `${ouFr} : ${fr}.`, en: `${ouEn}: ${en}.`, path: chemin });
    return;
  }

  // Une valeur absente se dit « obligatoire », quel que soit le message fixé.
  const absente = (valeur === undefined || valeur === null) && (p.code === 'invalid_type' || p.code === 'invalid_value');
  if (!absente) {
    for (const [motif, rendre] of MESSAGES_FIXES) {
      const m = motif.exec(p.message);
      if (!m) continue;
      const [fr, en] = rendre(m);
      // Au premier niveau, la phrase se suffit ; plus bas, on dit où.
      out.push(chemin.length >= 2 ? { fr: `${ouFr} : ${fr}`, en: `${ouEn}: ${en}`, path: chemin } : { fr, en, path: chemin });
      return;
    }
    if (!MESSAGE_ZOD.test(p.message)) {
      // Message déjà écrit pour un humain (raffinements du schéma, graphe du
      // parcours) : gardé tel quel. Sa version anglaise vient de `params.en`
      // quand le schéma la donne ; sinon bilingue « fr / en » → séparé.
      const enDonne = typeof p.params?.en === 'string' ? p.params.en : null;
      const [fr, en] = enDonne !== null
        ? [p.message, enDonne]
        : p.message.includes(' / ') ? p.message.split(' / ') : [p.message, p.message];
      /*
       * … et il DÉSIGNE L'ÉTAPE (triage actions, ligne 8). « « À faire dans
       * (jours) » doit être au plus 365. » ne disait pas laquelle des quinze
       * étapes du parcours était fautive.
       */
      const etape = lieuDeLEtape(chemin, brut);
      out.push(etape ? { fr: `${etape[0]} : ${fr}`, en: `${etape[1]}: ${en}`, path: chemin } : { fr, en, path: chemin });
      return;
    }
  }
  // Clé inconnue dans la config d'une action : la phrase qui existait déjà
  // pour une clé d'un autre type d'action.
  if (p.code === 'unrecognized_keys' && (chemin[0] === 'actions' || chemin[0] === 'steps') && chemin[chemin.length - 1] === 'config') {
    const cles = (p.keys ?? []).map((k) => `« ${k} »`).join(', ');
    out.push({ fr: `${ouFr.replace(/, réglages$/, '')} n’utilise pas le champ ${cles}.`, en: `${ouEn.replace(/, settings$/, '')} does not use the field ${(p.keys ?? []).map((k) => `“${k}”`).join(', ')}.`, path: chemin });
    return;
  }
  const [fr, en] = phrase(p, valeur);
  out.push({ fr: `${ouFr} : ${fr}.`, en: `${ouEn}: ${en}.`, path: chemin });
}

/** Les problèmes d'un corps d'automatisation, en phrases claires (doublons retirés). */
export function messagesClairs(issues: ReadonlyArray<z.core.$ZodIssue>, brut: unknown): MessageClair[] {
  const out: MessageClair[] = [];
  /*
   * Dans un PARCOURS, `actions` n'est que le reflet des étapes (l'éditeur
   * l'envoie avec elles) : une valeur fautive y est donc refusée DEUX fois.
   * On ne garde que le refus de l'étape — c'est elle que l'écran montre.
   */
  const etapes = (brut as { steps?: unknown } | null)?.steps;
  const refusDesEtapes = Array.isArray(etapes) && etapes.length > 0 && issues.some((i) => i.path[0] === 'steps');
  for (const i of issues) {
    if (refusDesEtapes && i.path[0] === 'actions') continue;
    traduire(i as unknown as Probleme, brut, out);
  }
  const vus = new Set<string>();
  return out.filter((m) => (vus.has(m.fr) ? false : (vus.add(m.fr), true)));
}

/** Pose les messages clairs sur le contexte d'un `transform` Zod. */
export function signalerClairement(issues: ReadonlyArray<z.core.$ZodIssue>, brut: unknown, ctx: z.RefinementCtx): void {
  for (const m of messagesClairs(issues, brut)) {
    ctx.addIssue({ code: 'custom', message: m.fr, path: m.path, params: { en: m.en } });
  }
}
