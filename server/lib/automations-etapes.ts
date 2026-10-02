/* ═══════════════════════════════════════════════════════════════
   LES ÉTAPES D'UNE AUTOMATISATION — un seul accès, pour tous les lecteurs.

   Une ligne `automation_rules` porte ce qu'elle fait sous DEUX formes :
     · `steps`   — le parcours de l'éditeur (étapes chaînées) ; dès qu'il
                   existe, c'est LUI que le moteur exécute ;
     · `actions` + `delay_seconds` — le format d'origine, à plat.
   Chaque lecteur choisissait sa copie. Résultat (mission finale, constats
   A-02, A-07, A-11) : Lumi terminait une job sans carte alors qu'un parcours
   allait texter le client (il ne lisait que `actions`), et un message réécrit
   dans `steps` laissait l'ancien texte dans `actions`.

   Ici, UNE réponse à « que fait cette règle ? » :
     · `etapesDeLaRegle`   — le parcours : `steps` s'il existe, sinon la
                             projection d'`actions` + `delay_seconds` (la
                             MÊME que celle de l'éditeur : `projeterFormatOrigine`,
                             partagée, jamais réécrite) ;
     · `messagesDeLaRegle` — les textos et courriels, dans l'ordre ;
     · `actionsDepuisEtapes` — `actions` RE-DÉRIVÉ du parcours, pour qu'une
                             écriture dans `steps` ne laisse aucune copie périmée ;
     · `resumeDeLaRegle`   — ce que fait l'automatisation, en clair (jamais
                             `quote.sent` brut), écrit par du code : c'est ce
                             que Lumi lit, cite et montre.

   Lecture seule : ce module n'écrit jamais en base.
   ═══════════════════════════════════════════════════════════════ */

import { estFormatOrigine, projeterFormatOrigine, type Etape } from '../../src/lib/sequenceTypes';
import { trouverAction, trouverDeclencheur } from '../../src/lib/automationCatalogue';
import { htmlVersTexte } from '../../src/lib/emailBodyText';
import { segmentsSms } from '../../src/lib/smsSegments';
import { localizeAutomationName } from '../../src/lib/automationNames';
import { bloquantsPublication } from '../../src/lib/publicationAutomatisation';

/** Ce qu'on lit d'une ligne `automation_rules` — tout est facultatif : chaque appelant sélectionne ce qu'il a. */
export interface RegleLue {
  id?: string | null;
  name?: string | null;
  trigger_event?: string | null;
  conditions?: Record<string, unknown> | null;
  steps?: unknown;
  actions?: unknown;
  delay_seconds?: number | null;
  settings?: Record<string, unknown> | null;
  is_active?: boolean | null;
  is_preset?: boolean | null;
  deleted_at?: string | null;
}

/** Les colonnes à sélectionner pour tout ce que ce module sait lire. */
export const COLONNES_REGLE_LUE = 'id, name, trigger_event, conditions, steps, actions, delay_seconds, settings, is_active, is_preset, deleted_at';

type Langue = 'fr' | 'en';

/** La règle a-t-elle un parcours (c'est alors `steps` que le moteur exécute) ? */
export function aUnParcours(regle: RegleLue): boolean {
  return Array.isArray(regle.steps) && regle.steps.length > 0;
}

/**
 * Le parcours de la règle : `steps` s'il existe, sinon la projection du format
 * d'origine. Une règle NEUVE (action provisoire « À compléter », aucune étape)
 * n'a pas de parcours : liste vide.
 */
export function etapesDeLaRegle(regle: RegleLue): Etape[] {
  if (aUnParcours(regle)) return regle.steps as Etape[];
  if (!estFormatOrigine({ steps: regle.steps, actions: regle.actions })) return [];
  return projeterFormatOrigine({ actions: regle.actions, delay_seconds: regle.delay_seconds });
}

/** Types d'action qui atteignent le CLIENT (texto, courriel, sondage d'avis). */
export const ACTIONS_VERS_LE_CLIENT: ReadonlySet<string> = new Set(['send_sms', 'send_email', 'request_review']);

/** Les types d'action de la règle, dans l'ordre, sans doublon (la note interne `log_activity` exclue). */
export function typesDActionDeLaRegle(regle: RegleLue): string[] {
  const types = etapesDeLaRegle(regle)
    .filter((e): e is Extract<Etape, { type: 'action' }> => e.type === 'action')
    .map((e) => String(e.action?.type ?? ''));
  return [...new Set(types.filter((t) => t && t !== 'log_activity'))];
}

/** La règle envoie-t-elle quelque chose au client ? */
export function regleAtteintLeClient(regle: RegleLue): boolean {
  return typesDActionDeLaRegle(regle).some((t) => ACTIONS_VERS_LE_CLIENT.has(t));
}

export interface MessageDeRegle {
  /** Identifiant de l'étape qui porte le message. */
  etape: string;
  /** Position de l'étape dans le parcours (base 0). */
  index: number;
  type: 'send_sms' | 'send_email';
  /** Rang parmi les messages du même type (1 = le premier texto, ou le premier courriel). */
  numero: number;
  /** Nom donné à l'étape par l'utilisateur, s'il y en a un. */
  nom: string | null;
  /** Objet du courriel (null pour un texto). */
  objet: string | null;
  /** Le corps tel qu'ENREGISTRÉ (HTML pour un courriel bâti dans l'éditeur). */
  corps: string;
  /** Le corps tel qu'on le LIT : texte brut (le HTML d'un courriel est déplié). */
  texte: string;
}

/** Les textos et courriels de la règle, dans l'ordre du parcours. */
export function messagesDeLaRegle(regle: RegleLue): MessageDeRegle[] {
  const rangs: Record<string, number> = {};
  const messages: MessageDeRegle[] = [];
  etapesDeLaRegle(regle).forEach((e, index) => {
    if (e.type !== 'action') return;
    const type = String(e.action?.type ?? '');
    if (type !== 'send_sms' && type !== 'send_email') return;
    const config = (e.action?.config ?? {}) as Record<string, unknown>;
    const corps = String(config.body ?? '');
    rangs[type] = (rangs[type] ?? 0) + 1;
    messages.push({
      etape: String(e.id), index, type, numero: rangs[type], nom: e.nom ?? null,
      objet: type === 'send_email' ? String(config.subject ?? '') : null,
      corps,
      texte: type === 'send_email' ? htmlVersTexte(corps) : corps,
    });
  });
  return messages;
}

/**
 * `actions` RE-DÉRIVÉ du parcours : les actions des étapes, dans l'ordre.
 * À écrire dans la MÊME mise à jour que `steps`, pour que la colonne d'origine
 * dise la même chose que le parcours (aucun texte que le parcours n'envoie plus).
 */
export function actionsDepuisEtapes(steps: unknown): Array<{ type: string; config: Record<string, unknown> }> {
  return (Array.isArray(steps) ? steps : [])
    .filter((e): e is { type: 'action'; action: { type?: unknown; config?: unknown } } => !!e && typeof e === 'object' && (e as { type?: unknown }).type === 'action' && !!(e as { action?: unknown }).action)
    .map((e) => ({
      type: String(e.action.type ?? ''),
      config: e.action.config && typeof e.action.config === 'object' ? { ...(e.action.config as Record<string, unknown>) } : {},
    }));
}

/** JSON à clés triées : deux parcours identiques rangés dans un autre ordre de clés sont le MÊME parcours. */
const trie = (v: unknown): string => JSON.stringify(v, (_cle, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
  : x));

/**
 * Ce qu'une modification du parcours doit écrire EN PLUS pour que `actions` le
 * redise (A-02). L'éditeur n'envoie que `{ name, steps }` : `actions` gardait le
 * texto provisoire « À compléter » posé à la création — une 2e copie du message,
 * fausse, dans la même ligne (36 parcours en prod).
 *
 * Seulement quand le parcours CHANGE : réenregistrer le même parcours ne touche à
 * rien d'autre. Rien non plus si la modification écrit elle-même `actions`, ou
 * vide le parcours. C'est un reflet, pas une saisie : à poser APRÈS les contrôles
 * (deux messages identiques y sont légitimes).
 */
export function refletDesActions(patch: { steps?: unknown; actions?: unknown }, etapesEnregistrees: unknown): { actions?: ReturnType<typeof actionsDepuisEtapes> } {
  if (!Array.isArray(patch.steps) || patch.steps.length === 0 || 'actions' in patch) return {};
  if (trie(patch.steps) === trie(etapesEnregistrees)) return {};
  return { actions: actionsDepuisEtapes(patch.steps) };
}

/* ── En clair ─────────────────────────────────────────────────── */

/** « 3 jours », « 2 heures », « 30 minutes ». */
export function dureeEnClair(secondes: number, fr: boolean): string {
  const s = Math.max(0, Math.round(Number(secondes) || 0));
  const dire = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;
  if (s === 0) return fr ? 'aucun délai' : 'no delay';
  if (s % 604_800 === 0 && s >= 1_209_600) return fr ? dire(s / 604_800, 'semaine', 'semaines') : dire(s / 604_800, 'week', 'weeks');
  if (s % 86_400 === 0) return fr ? dire(s / 86_400, 'jour', 'jours') : dire(s / 86_400, 'day', 'days');
  if (s % 3_600 === 0) return fr ? dire(s / 3_600, 'heure', 'heures') : dire(s / 3_600, 'hour', 'hours');
  if (s % 60 === 0) return fr ? dire(s / 60, 'minute', 'minutes') : dire(s / 60, 'minute', 'minutes');
  return fr ? dire(s, 'seconde', 'secondes') : dire(s, 'second', 'seconds');
}

/** Le déclencheur, sous le nom que l'écran lui donne — jamais sa clé technique. */
export function declencheurEnClair(cle: string | null | undefined, fr: boolean): string {
  const d = cle ? trouverDeclencheur(cle) : undefined;
  if (d) return fr ? d.fr : d.en;
  return fr ? 'un déclencheur qui n’est plus offert' : 'a trigger that is no longer offered';
}

const STATUTS: Record<string, [string, string]> = {
  sent: ['toujours sans réponse', 'still unanswered'],
  approved: ['accepté', 'accepted'],
  declined: ['refusé', 'declined'],
  paid: ['payé', 'paid'],
  unpaid: ['toujours impayé', 'still unpaid'],
  overdue: ['en retard', 'overdue'],
};
const OPERATEURS: Record<string, [string, string]> = {
  eq: ['est', 'is'], neq: ['n’est pas', 'is not'],
  gt: ['dépasse', 'is over'], gte: ['est d’au moins', 'is at least'],
  lt: ['est sous', 'is under'], lte: ['est d’au plus', 'is at most'],
  in: ['est parmi', 'is one of'], not_in: ['n’est pas parmi', 'is none of'],
};

/** Une condition, en mots : `{ montant: { gt: 500 } }` → « le montant dépasse 500 $ ». */
function conditionEnClair(cle: string, valeur: unknown, cleDeclencheur: string | null | undefined, fr: boolean): string | null {
  if (valeur === '' || valeur === null || valeur === undefined) return null;
  const i = fr ? 0 : 1;
  if (cle === 'client_a_etiquette') return fr ? `le client a l’étiquette « ${String(valeur)} »` : `the client has the tag “${String(valeur)}”`;
  if (cle === 'client_sans_etiquette') return fr ? `le client n’a PAS l’étiquette « ${String(valeur)} »` : `the client does NOT have the tag “${String(valeur)}”`;
  if (cle === 'champs_perso') {
    const n = Array.isArray(valeur) ? valeur.length : 0;
    return fr ? `${n} condition${n > 1 ? 's' : ''} sur des champs personnalisés` : `${n} custom-field condition${n > 1 ? 's' : ''}`;
  }
  const paires: Array<[string, unknown]> = valeur && typeof valeur === 'object' && !Array.isArray(valeur)
    ? Object.entries(valeur as Record<string, unknown>)
    : [['eq', valeur]];
  const morceaux = paires.map(([op, v]) => {
    const liste = Array.isArray(v) ? v.map(String).join(', ') : String(v);
    if (cle === 'status') {
      const s = STATUTS[String(v)]?.[i] ?? liste;
      return op === 'neq' ? (fr ? `n’est pas ${s}` : `is not ${s}`) : (fr ? `est ${s}` : `is ${s}`);
    }
    if (cle === 'montant') return `${fr ? 'le montant' : 'the amount'} ${OPERATEURS[op]?.[i] ?? op} ${fr ? `${liste} $` : `$${liste}`}`;
    if (cle === 'tag') return fr ? `l’étiquette ${OPERATEURS[op]?.[i] ?? op} « ${liste} »` : `the tag ${OPERATEURS[op]?.[i] ?? op} “${liste}”`;
    // Un réglage du déclencheur (« Montant minimum », « Première ouverture seulement »…) : son libellé d'écran.
    const base = cle.replace(/__(gte|lte|gt|lt)$/, '');
    const champ = (cleDeclencheur ? trouverDeclencheur(cleDeclencheur)?.champs : undefined)?.find((c) => c.cle === cle || c.cle === base);
    if (champ) {
      const option = champ.options?.find((o) => o.cle === String(v));
      const dit = option ? (fr ? option.fr : option.en) : liste;
      return `${fr ? champ.fr : champ.en} : ${dit}`;
    }
    return fr ? `un filtre réglé dans l’éditeur (${liste})` : `a filter set in the editor (${liste})`;
  });
  if (cle === 'status') return `${fr ? 'le devis ou la facture' : 'the quote or invoice'} ${morceaux.join(fr ? ' et ' : ' and ')}`;
  return morceaux.join(fr ? ' et ' : ' and ');
}

/** Les conditions (du déclencheur ou d'une étape « si »), une phrase par condition. */
export function conditionsEnClair(conditions: unknown, cleDeclencheur: string | null | undefined, fr: boolean): string[] {
  if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) return [];
  return Object.entries(conditions as Record<string, unknown>)
    .map(([cle, valeur]) => conditionEnClair(cle, valeur, cleDeclencheur, fr))
    .filter((t): t is string => !!t);
}

const POUR_QUI: Record<string, [string, string]> = {
  proprietaire: ['au propriétaire', 'to the owner'],
  responsable: ['au responsable du client', 'to the client owner'],
  equipe_du_deal: ['au rep assigné, aux propriétaires et aux admins', 'to the assigned rep, owners and admins'],
  membre: ['à un membre précis', 'to a specific member'],
};

const couper = (t: string, max: number) => (max > 0 && t.length > max ? `${t.slice(0, max - 1)}…` : t);

/** Une étape, en une ligne lisible. `max` borne le texte cité (0 = entier). */
function etapeEnClair(e: Etape, etapes: Etape[], cleDeclencheur: string | null | undefined, fr: boolean, max: number): string {
  const numero = (id: string | null | undefined): number => (id ? etapes.findIndex((x) => x.id === id) + 1 : 0);
  const vers = (id: string | null | undefined): string => {
    const n = numero(id);
    return n > 0 ? (fr ? `étape ${n}` : `step ${n}`) : (fr ? 'fin' : 'end');
  };
  const position = etapes.indexOf(e);
  // La suite n'est dite que si elle n'est pas « l'étape d'après » : un parcours droit se lit sans flèches.
  const suite = (id: string | null | undefined): string => {
    const dernier = position === etapes.length - 1;
    if (id && numero(id) === position + 2) return '';
    if (!id) return dernier ? '' : (fr ? ' — puis le parcours s’arrête' : ' — then the journey ends');
    return fr ? ` — puis ${vers(id)}` : ` — then ${vers(id)}`;
  };

  if (e.type === 'arreter') return fr ? 'Arrêter le parcours' : 'Stop the journey';
  if (e.type === 'attendre') {
    if (e.mode === 'avant_date') {
      return (fr
        ? `Attendre jusqu’à ${dureeEnClair(Number(e.secondes_avant ?? 0), true)} avant le rendez-vous`
        : `Wait until ${dureeEnClair(Number(e.secondes_avant ?? 0), false)} before the appointment`) + suite(e.suivant);
    }
    if (e.mode === 'reponse') {
      const siReponse = e.si_reponse ? vers(e.si_reponse) : (fr ? 'le parcours s’arrête' : 'the journey stops');
      return (fr
        ? `Attendre la réponse du client, au plus ${dureeEnClair(e.delai_secondes, true)} (s’il répond : ${siReponse})`
        : `Wait for the client’s reply, at most ${dureeEnClair(e.delai_secondes, false)} (if they reply: ${siReponse})`) + suite(e.suivant);
    }
    return `${fr ? 'Attendre' : 'Wait'} ${dureeEnClair(e.delai_secondes, fr)}${suite(e.suivant)}`;
  }
  if (e.type === 'si') {
    const quoi = conditionsEnClair(e.conditions, cleDeclencheur, fr).join(fr ? ' et ' : ' and ') || (fr ? 'une condition réglée dans l’éditeur' : 'a condition set in the editor');
    return fr
      ? `Si ${quoi} : ${vers(e.alors)} ; sinon : ${vers(e.sinon)}`
      : `If ${quoi}: ${vers(e.alors)}; otherwise: ${vers(e.sinon)}`;
  }

  const type = String(e.action?.type ?? '');
  const config = (e.action?.config ?? {}) as Record<string, unknown>;
  const nom = e.nom ? ` (« ${e.nom} »)` : '';
  let ligne: string;
  if (type === 'send_sms') {
    const corps = String(config.body ?? '');
    const seg = segmentsSms(corps);
    // La longueur est TOUJOURS dite : « plus court » se juge contre elle.
    const cout = seg.segments > 1
      ? (fr ? ` [${corps.length} caractères, facturé ${seg.segments} SMS]` : ` [${corps.length} characters, billed as ${seg.segments} SMS]`)
      : (fr ? ` [${corps.length} caractères]` : ` [${corps.length} characters]`);
    ligne = `${fr ? 'Texto au client' : 'Text to the client'}${nom} : « ${couper(corps, max)} »${cout}`;
  } else if (type === 'send_email') {
    const texte = htmlVersTexte(String(config.body ?? '')).replace(/\n{2,}/g, '\n');
    ligne = `${fr ? 'Courriel au client' : 'Email to the client'}${nom} — ${fr ? 'objet' : 'subject'} « ${String(config.subject ?? '')} » : « ${couper(texte, max)} »`;
  } else if (type === 'create_notification') {
    const pour = POUR_QUI[String(config.destinataire ?? '')]?.[fr ? 0 : 1] ?? (fr ? 'à toute l’équipe' : 'to the whole team');
    const texte = [config.title, config.body].filter((x) => typeof x === 'string' && x.trim()).join(' — ');
    ligne = `${fr ? `Notification dans Lume, ${pour}` : `Notification in Lume, ${pour}`}${nom} : « ${couper(String(texte), max)} »`;
  } else {
    const modele = trouverAction(type);
    const libelle = modele ? (fr ? modele.fr : modele.en) : (type === 'log_activity' ? (fr ? 'Note dans l’historique du client' : 'Note in the client history') : (fr ? 'Une action' : 'An action'));
    // Les champs de texte de l'action (titre d'une tâche, étiquette…), tels qu'enregistrés.
    const details = (modele?.champs ?? [])
      .filter((c) => ['texte', 'zone', 'etiquette'].includes(c.type) && typeof config[c.cle] === 'string' && String(config[c.cle]).trim())
      .map((c) => `« ${couper(String(config[c.cle]), max)} »`);
    ligne = `${libelle}${nom}${details.length ? ` : ${details.join(', ')}` : ''}`;
  }
  return ligne + suite(e.suivant);
}

/** Les réglages qui changent ce qui part, en clair (vide = les réglages d'office). */
function reglagesEnClair(settings: Record<string, unknown> | null | undefined, fr: boolean): string[] {
  const s = settings ?? {};
  const lignes: string[] = [];
  const f = s.fenetre as { debut?: unknown; fin?: unknown } | undefined;
  if (f && Number.isFinite(Number(f.debut)) && Number.isFinite(Number(f.fin))) {
    lignes.push(fr ? `envois entre ${Number(f.debut)} h et ${Number(f.fin)} h` : `sends between ${Number(f.debut)}:00 and ${Number(f.fin)}:00`);
  }
  if (s.jours_ouvrables === true) lignes.push(fr ? 'du lundi au vendredi seulement' : 'Monday to Friday only');
  if (Number(s.delai_entre_passages_jours) > 0) {
    const n = Number(s.delai_entre_passages_jours);
    lignes.push(fr ? `une fois par client tous les ${n} jours` : `once per client every ${n} days`);
  }
  if (s.arret_sur_reponse === true) lignes.push(fr ? 's’arrête dès que le client répond' : 'stops as soon as the client replies');
  if (s.arreter_si_resolu === true) lignes.push(fr ? 's’arrête quand la fiche est réglée (devis accepté, facture payée…)' : 'stops once the record is settled (quote accepted, invoice paid…)');
  if (s.reentree === true) lignes.push(fr ? 'le même client peut y repasser' : 'the same client can re-enter');
  return lignes;
}

export interface ResumeAutomatisation {
  /** Le nom affiché (un préréglage porte son nom traduit). */
  nom: string;
  /** Publiée (elle part), en brouillon (rien ne part), ou à la corbeille. */
  etat: string;
  publiee: boolean;
  /** Le déclencheur, tel que l'écran le nomme. */
  declencheur: string;
  /** Ce qui déclenche vraiment, en une phrase. */
  quand: string;
  /** Les filtres posés sur le déclencheur (« seulement si… »). */
  filtres: string[];
  /** Les étapes, dans l'ordre : « 1. Attendre 3 jours », « 2. Texto au client : « … » ». */
  etapes: string[];
  /** Les réglages qui changent ce qui part. */
  reglages: string[];
  /** Les textos et courriels tels qu'ENREGISTRÉS, à citer mot pour mot. */
  messages: Array<{ etape: number; canal: string; numero: number; objet?: string; texte: string; caracteres: number; sms_factures?: number }>;
}

/**
 * Ce que fait l'automatisation, en clair et dans l'ordre. Écrit par du code :
 * Lumi le CITE, il ne le reformule pas de mémoire.
 *
 * `maxMessage` borne le texte cité DANS LES ÉTAPES (0 = entier) ; la liste
 * `messages` porte toujours le texte entier.
 */
export function resumeDeLaRegle(regle: RegleLue, langue: Langue, options: { maxMessage?: number } = {}): ResumeAutomatisation {
  const fr = langue === 'fr';
  const etapes = etapesDeLaRegle(regle);
  const decl = regle.trigger_event ? trouverDeclencheur(regle.trigger_event) : undefined;
  const publiee = regle.is_active === true && !regle.deleted_at;
  const max = options.maxMessage ?? 0;
  return {
    nom: localizeAutomationName(String(regle.name ?? ''), langue),
    etat: regle.deleted_at
      ? (fr ? 'à la corbeille (elle ne part plus)' : 'in the trash (it no longer runs)')
      : publiee ? (fr ? 'publiée (elle part)' : 'published (it runs)') : (fr ? 'en brouillon (rien ne part)' : 'draft (nothing is sent)'),
    publiee,
    declencheur: declencheurEnClair(regle.trigger_event, fr),
    quand: decl ? (fr ? decl.aide_fr : decl.aide_en) : '',
    filtres: conditionsEnClair(regle.conditions, regle.trigger_event, fr),
    etapes: etapes.map((e, i) => `${i + 1}. ${etapeEnClair(e, etapes, regle.trigger_event, fr, max)}`),
    reglages: reglagesEnClair(regle.settings, fr),
    messages: messagesDeLaRegle(regle).map((m) => {
      const seg = m.type === 'send_sms' ? segmentsSms(m.texte) : null;
      return {
        etape: m.index + 1,
        canal: m.type === 'send_sms' ? (fr ? 'texto' : 'text') : (fr ? 'courriel' : 'email'),
        numero: m.numero,
        ...(m.objet !== null ? { objet: m.objet } : {}),
        texte: m.texte,
        caracteres: m.texte.length,
        ...(seg && seg.segments > 1 ? { sms_factures: seg.segments } : {}),
      };
    }),
  };
}

/**
 * Ce qui EMPÊCHE de publier l'automatisation telle quelle (une étape qui porte
 * encore le texte d'exemple de l'éditeur, une étape incomplète) — les mêmes
 * contrôles que le bouton « Publier ». Vide pour une automatisation déjà
 * publiée ou à la corbeille. Donné à Lumi avec le contenu : sans ça, à « active-
 * la », il proposait « tu veux l'activer tel quel ? » pour un texte d'exemple
 * que le serveur allait refuser (C12).
 */
export function obstaclesAPublication(regle: RegleLue, fr: boolean): string[] {
  if (regle.is_active === true || regle.deleted_at) return [];
  try {
    return bloquantsPublication({
      trigger_event: regle.trigger_event, steps: regle.steps, actions: regle.actions,
      conditions: (regle.conditions ?? null) as Record<string, unknown> | null, is_preset: regle.is_preset, fr,
    }).map((p) => p.message);
  } catch {
    return [];
  }
}

/** Le résumé en quelques lignes de texte — la forme COMPACTE donnée au modèle comme contexte de page. */
export function texteDuResume(r: ResumeAutomatisation, langue: Langue): string {
  const fr = langue === 'fr';
  const lignes = [
    `« ${r.nom} » — ${r.etat}`,
    `${fr ? 'Déclencheur' : 'Trigger'} : ${r.declencheur}${r.filtres.length ? ` (${fr ? 'seulement si' : 'only if'} ${r.filtres.join(fr ? ' ; ' : '; ')})` : ''}`,
    ...(r.etapes.length ? r.etapes : [fr ? '(aucune étape pour l’instant)' : '(no step yet)']),
    ...(r.reglages.length ? [`${fr ? 'Réglages' : 'Settings'} : ${r.reglages.join(', ')}`] : []),
  ];
  return lignes.join('\n');
}

/**
 * Un texto dépasse-t-il un SMS ? Rend la phrase à dire (« 212 caractères :
 * facturé 2 SMS »), ou null s'il tient en un seul.
 */
export function avisSegments(texte: string, fr: boolean): string | null {
  const seg = segmentsSms(texte);
  if (seg.segments <= 1) return null;
  const pourquoi = seg.encodage === 'UCS-2'
    ? (fr ? ' (un accent spécial ou un émoji ramène la limite à 70 caractères par SMS)' : ' (a special accent or an emoji lowers the limit to 70 characters per SMS)')
    : '';
  return fr
    ? `Ce texto fait ${texte.length} caractères : il sera facturé ${seg.segments} SMS à chaque envoi${pourquoi}.`
    : `This text is ${texte.length} characters long: each send is billed as ${seg.segments} SMS${pourquoi}.`;
}
