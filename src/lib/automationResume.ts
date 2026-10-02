/* ═══════════════════════════════════════════════════════════════
   LA PHRASE-RÉSUMÉ D'UNE AUTOMATISATION — écrite par du CODE, jamais par un
   modèle (mission, point 17).

     « Quand une facture est en retard de 7 jours → texto au client
       (sauf étiquette « VIP ») »

   Une phrase, en haut de chaque automatisation et dans la liste. Elle dit,
   dans l'ordre : QUAND (le déclencheur et l'occurrence visée), SI (les
   filtres), ALORS (les étapes, avec leurs délais), QUI (le ciblage). Elle est
   bâtie sur ce que la règle porte vraiment — `steps` s'il y a un parcours
   (c'est lui que le moteur exécute), sinon `actions` + `delay_seconds`.

   EXACTE PAR CONSTRUCTION : chaque déclencheur et chaque action du catalogue a
   sa formule ici, et un test (tests/automations-finale/p/resume.test.ts)
   parcourt tout le catalogue, tous les préréglages et le pack de base — il
   refuse une phrase vide, une clé technique (`invoice.overdue`, `send_sms`) ou
   une variable brute. Un déclencheur ou une action que le catalogue ne connaît
   plus donne une formule neutre, jamais sa clé.

   Le résumé DÉTAILLÉ (une ligne par étape, texte des messages cité) existe côté
   serveur pour Lumi : `resumeDeLaRegle` (server/lib/automations-etapes.ts).
   Celui-ci est sa version d'une phrase, partagée avec le navigateur.

   Imports : catalogue, ciblage, étapes — ce fichier peut être lu par le serveur.
   ═══════════════════════════════════════════════════════════════ */

import { trouverAction, trouverDeclencheur } from './automationCatalogue';
import { ciblageVide, lireCiblage, libelleRegle, type CiblageLu } from './automationCiblage';
import { estFormatOrigine, projeterFormatOrigine, type Etape } from './sequenceTypes';

export interface RegleAResumer {
  trigger_event?: string | null;
  conditions?: Record<string, unknown> | null;
  steps?: unknown;
  actions?: unknown;
  delay_seconds?: number | null;
}

export interface LibellesResume {
  /** Libellé d'un champ personnalisé, par id (ciblage, « Date atteinte », « Champ modifié »). */
  champs?: Record<string, { label: string; options?: Array<{ id: string; label: string }> }>;
  /** Nom d'une étape de pipeline, par id. */
  etapes?: Record<string, string>;
  /** Nom d'un service du catalogue, par id. */
  services?: Record<string, string>;
}

type Bi = [fr: string, en: string];
const g = (t: string, fr: boolean) => (fr ? `« ${t} »` : `“${t}”`);

/** « 3 jours », « 2 heures », « 30 minutes » — même découpage que le résumé détaillé du serveur. */
export function dureeCourte(secondes: number, fr: boolean): string {
  const s = Math.max(0, Math.round(Number(secondes) || 0));
  const dire = (n: number, un: Bi, plusieurs: Bi) => `${n} ${(n > 1 ? plusieurs : un)[fr ? 0 : 1]}`;
  if (s % 604_800 === 0 && s >= 1_209_600) return dire(s / 604_800, ['semaine', 'week'], ['semaines', 'weeks']);
  if (s % 86_400 === 0 && s > 0) return dire(s / 86_400, ['jour', 'day'], ['jours', 'days']);
  if (s % 3_600 === 0 && s > 0) return dire(s / 3_600, ['heure', 'hour'], ['heures', 'hours']);
  if (s % 60 === 0 && s > 0) return dire(s / 60, ['minute', 'minute'], ['minutes', 'minutes']);
  return dire(s, ['seconde', 'second'], ['secondes', 'seconds']);
}

// ── QUAND ───────────────────────────────────────────────────

/** La valeur d'un réglage : `{ eq: x }` et `x` disent la même chose. */
function reglage(conditions: Record<string, unknown> | null | undefined, cle: string): string {
  const brut = conditions?.[cle];
  const v = brut && typeof brut === 'object' && !Array.isArray(brut) ? (brut as { eq?: unknown }).eq : brut;
  return v === undefined || v === null ? '' : String(v).trim();
}

/**
 * Le déclencheur, en une proposition qui suit « Quand ». Une entrée par
 * déclencheur du catalogue (un test le vérifie) ; l'occurrence visée par les
 * réglages (jours de retard, étiquette, étape, première ouverture…) y est dite.
 */
const QUAND: Record<string, (c: Record<string, unknown> | null | undefined, fr: boolean, l: LibellesResume) => string> = {
  'quote.sent': (_c, fr) => (fr ? 'un devis est envoyé' : 'a quote is sent'),
  'quote.viewed': (c, fr) => {
    const chaque = reglage(c, 'ouverture') === 'chaque';
    return fr
      ? `le client ouvre son devis${chaque ? ' (à chaque ouverture)' : ' pour la première fois'}`
      : `the client opens their quote${chaque ? ' (every time)' : ' for the first time'}`;
  },
  'quote.approved': (_c, fr) => (fr ? 'un devis est accepté' : 'a quote is approved'),
  'quote.declined': (_c, fr) => (fr ? 'un devis est refusé' : 'a quote is declined'),
  'quote.changes_requested': (_c, fr) => (fr ? 'le client demande des modifications au devis' : 'the client requests changes to the quote'),
  'invoice.sent': (_c, fr) => (fr ? 'une facture est envoyée' : 'an invoice is sent'),
  'invoice.paid': (_c, fr) => (fr ? 'une facture est payée' : 'an invoice is paid'),
  'invoice.overdue': (c, fr) => {
    const n = Number(reglage(c, 'days_overdue'));
    if (!Number.isFinite(n) || n <= 0) return fr ? 'une facture est en retard' : 'an invoice is overdue';
    return fr ? `une facture est en retard de ${n} jour${n > 1 ? 's' : ''}` : `an invoice is ${n} day${n > 1 ? 's' : ''} overdue`;
  },
  'payment.failed': (_c, fr) => (fr ? 'un paiement échoue' : 'a payment fails'),
  'invoice.viewed': (c, fr) => {
    const chaque = reglage(c, 'ouverture') === 'chaque';
    return fr
      ? `le client consulte sa facture${chaque ? ' (à chaque consultation)' : ' pour la première fois'}`
      : `the client views their invoice${chaque ? ' (every time)' : ' for the first time'}`;
  },
  'appointment.created': (_c, fr) => (fr ? 'un rendez-vous est planifié' : 'an appointment is scheduled'),
  'appointment.cancelled': (_c, fr) => (fr ? 'un rendez-vous est annulé' : 'an appointment is cancelled'),
  'job.completed': (_c, fr) => (fr ? 'un job est terminé' : 'a job is completed'),
  'job.ready_for_invoicing': (_c, fr) => (fr ? 'un job est prêt à facturer' : 'a job is ready to invoice'),
  'lead.created': (_c, fr) => (fr ? 'un nouveau prospect arrive' : 'a new lead comes in'),
  'lead.status_changed': (_c, fr) => (fr ? 'le statut d’un prospect change' : 'a lead’s status changes'),
  'client.replied': (_c, fr) => (fr ? 'le client répond' : 'the client replies'),
  'client.tagged': (c, fr) => {
    const tag = reglage(c, 'tag');
    return tag
      ? (fr ? `l’étiquette ${g(tag, true)} est ajoutée à un client` : `the tag ${g(tag, false)} is added to a client`)
      : (fr ? 'une étiquette est ajoutée à un client' : 'a tag is added to a client');
  },
  'client.untagged': (c, fr) => {
    const tag = reglage(c, 'tag');
    return tag
      ? (fr ? `l’étiquette ${g(tag, true)} est retirée d’un client` : `the tag ${g(tag, false)} is removed from a client`)
      : (fr ? 'une étiquette est retirée d’un client' : 'a tag is removed from a client');
  },
  'client.inactive': (c, fr) => {
    const n = Number(reglage(c, 'mois')) || 6;
    return fr ? `un client n’a eu aucun job terminé depuis ${n} mois` : `a client has had no completed job for ${n} month${n > 1 ? 's' : ''}`;
  },
  'agreement.signed': (_c, fr) => (fr ? 'un contrat est signé' : 'an agreement is signed'),
  'task.completed': (_c, fr) => (fr ? 'une tâche est terminée' : 'a task is completed'),
  'note.added': (_c, fr) => (fr ? 'une note est ajoutée' : 'a note is added'),
  'webhook.received': (_c, fr) => (fr ? 'un appel arrive de l’extérieur' : 'an incoming webhook is received'),
  'date.reached': (c, fr, l) => {
    const champ = l.champs?.[reglage(c, 'champ_id')]?.label;
    const quoi = champ ? (fr ? `la date ${g(champ, true)}` : `the date ${g(champ, false)}`) : (fr ? 'une date surveillée' : 'a watched date');
    const n = Number(reglage(c, 'jours_avant'));
    if (!Number.isFinite(n) || n === 0) return fr ? `${quoi} arrive` : `${quoi} arrives`;
    const jours = Math.abs(n);
    return fr
      ? `${quoi} ${n > 0 ? 'arrive dans' : 'est passée depuis'} ${jours} jour${jours > 1 ? 's' : ''}`
      : `${quoi} ${n > 0 ? 'is' : 'was'} ${jours} day${jours > 1 ? 's' : ''} ${n > 0 ? 'away' : 'ago'}`;
  },
  'deal.stage_entered': (c, fr, l) => {
    const etape = l.etapes?.[reglage(c, 'stage_id')];
    return etape
      ? (fr ? `une opportunité entre dans l’étape ${g(etape, true)}` : `a deal enters the stage ${g(etape, false)}`)
      : (fr ? 'une opportunité entre dans une étape du pipeline' : 'a deal enters a pipeline stage');
  },
  'deal.stage_idle': (c, fr, l) => {
    const etape = l.etapes?.[reglage(c, 'stage_id')];
    return etape
      ? (fr ? `une opportunité dort dans l’étape ${g(etape, true)}` : `a deal goes stale in the stage ${g(etape, false)}`)
      : (fr ? 'une opportunité dort dans son étape' : 'a deal goes stale in its stage');
  },
  'custom_field.changed': (c, fr, l) => {
    const champ = l.champs?.[reglage(c, 'field_id')]?.label;
    return champ
      ? (fr ? `le champ ${g(champ, true)} est modifié` : `the field ${g(champ, false)} changes`)
      : (fr ? 'un champ personnalisé est modifié' : 'a custom field changes');
  },
};

/** Les déclencheurs qui ont leur formule (le test les compare au catalogue). */
export const DECLENCHEURS_RESUMES: readonly string[] = Object.keys(QUAND);

/** Les réglages déjà dits par la proposition « Quand » : à ne pas redire comme filtres. */
const REGLAGES_DITS: Record<string, readonly string[]> = {
  'invoice.overdue': ['days_overdue'], 'quote.viewed': ['ouverture'], 'invoice.viewed': ['ouverture'],
  'client.tagged': ['tag'], 'client.untagged': ['tag'], 'client.inactive': ['mois', 'max_par_heure'],
  'date.reached': ['champ_id', 'jours_avant'], 'deal.stage_entered': ['stage_id', 'pipeline_id'], 'deal.stage_idle': ['stage_id', 'pipeline_id'],
  'custom_field.changed': ['field_id'], 'webhook.received': ['webhook_id'],
};
const CLES_DU_CIBLAGE = ['ciblage', 'client_a_etiquette', 'client_sans_etiquette'];

function quand(regle: RegleAResumer, fr: boolean, l: LibellesResume): string {
  const formule = regle.trigger_event ? QUAND[regle.trigger_event] : undefined;
  if (formule) return formule(regle.conditions, fr, l);
  // Un déclencheur que le catalogue offre mais sans formule ici : son nom d'écran, jamais sa clé.
  const decl = regle.trigger_event ? trouverDeclencheur(regle.trigger_event) : undefined;
  if (decl) return fr ? `« ${decl.fr} » se produit` : `“${decl.en}” happens`;
  return regle.trigger_event
    ? (fr ? 'un événement qui n’est plus offert se produit' : 'an event that is no longer offered happens')
    : (fr ? 'un déclencheur reste à choisir' : 'a trigger is still to be picked');
}

/** Combien de filtres (hors occurrence et hors ciblage) la règle pose. */
function nbFiltres(regle: RegleAResumer): number {
  const dits = new Set([...(REGLAGES_DITS[regle.trigger_event ?? ''] ?? []), ...CLES_DU_CIBLAGE]);
  return Object.entries(regle.conditions ?? {}).reduce((n, [cle, valeur]) => {
    if (dits.has(cle) || valeur === '' || valeur === null || valeur === undefined) return n;
    return n + (cle === 'champs_perso' && Array.isArray(valeur) ? valeur.length : 1);
  }, 0);
}

// ── ALORS ───────────────────────────────────────────────────

const POUR_QUI: Record<string, Bi> = {
  proprietaire: ['au propriétaire', 'to the owner'],
  responsable: ['au responsable du client', 'to the client owner'],
  equipe_du_deal: ['au rep et aux gestionnaires', 'to the rep and managers'],
  membre: ['à un membre', 'to a member'],
};

/**
 * Chaque action, en quelques mots. Une entrée par action du catalogue (un test
 * le vérifie), plus `log_activity` (note interne du moteur, tue dans la phrase).
 */
const ACTION: Record<string, (config: Record<string, unknown>, fr: boolean) => string | null> = {
  send_sms: (_c, fr) => (fr ? 'texto au client' : 'text to the client'),
  send_email: (_c, fr) => (fr ? 'courriel au client' : 'email to the client'),
  create_notification: (c, fr) => {
    const pour = POUR_QUI[String(c.destinataire ?? '')]?.[fr ? 0 : 1] ?? (fr ? 'à l’équipe' : 'to the team');
    return fr ? `notification ${pour}` : `notification ${pour}`;
  },
  request_review: (_c, fr) => (fr ? 'demande d’avis au client' : 'review request to the client'),
  envoyer_slack: (_c, fr) => (fr ? 'message dans Slack' : 'message in Slack'),
  ajouter_etiquette: (c, fr) => {
    const tag = String(c.etiquette ?? c.tag ?? '').trim();
    return tag ? (fr ? `ajouter l’étiquette ${g(tag, true)}` : `add the tag ${g(tag, false)}`) : (fr ? 'ajouter une étiquette' : 'add a tag');
  },
  retirer_etiquette: (c, fr) => {
    if (String(c.toutes ?? '') === 'true') return fr ? 'retirer toutes les étiquettes' : 'remove all tags';
    const tag = String(c.etiquette ?? c.tag ?? '').trim();
    return tag ? (fr ? `retirer l’étiquette ${g(tag, true)}` : `remove the tag ${g(tag, false)}`) : (fr ? 'retirer une étiquette' : 'remove a tag');
  },
  modifier_client: (_c, fr) => (fr ? 'modifier la fiche du client' : 'update the client record'),
  assigner_responsable: (_c, fr) => (fr ? 'assigner un responsable' : 'assign an owner'),
  ajouter_note: (_c, fr) => (fr ? 'ajouter une note' : 'add a note'),
  create_task: (_c, fr) => (fr ? 'créer une tâche' : 'create a task'),
  modifier_statut_rendezvous: (_c, fr) => (fr ? 'changer le statut du rendez-vous' : 'change the appointment status'),
  move_deal_stage: (_c, fr) => (fr ? 'déplacer l’opportunité' : 'move the deal'),
  modifier_deal: (_c, fr) => (fr ? 'modifier l’opportunité' : 'update the deal'),
  assigner_deal: (_c, fr) => (fr ? 'assigner l’opportunité' : 'assign the deal'),
  envoyer_facture: (_c, fr) => (fr ? 'envoyer la facture au client' : 'send the invoice to the client'),
  envoyer_soumission: (_c, fr) => (fr ? 'envoyer le devis au client' : 'send the quote to the client'),
  webhook: (_c, fr) => (fr ? 'appeler un webhook' : 'call a webhook'),
  demarrer_automatisation: (_c, fr) => (fr ? 'démarrer une autre automatisation' : 'start another automation'),
  arreter_automatisation: (_c, fr) => (fr ? 'arrêter une automatisation' : 'stop an automation'),
  update_custom_field: (_c, fr) => (fr ? 'mettre à jour un champ personnalisé' : 'update a custom field'),
  // Écriture interne du moteur (historique du client) : hors de la phrase.
  log_activity: () => null,
};

/** Les actions qui ont leur formule (le test les compare au catalogue). */
export const ACTIONS_RESUMEES: readonly string[] = Object.keys(ACTION);

function action(type: string, config: Record<string, unknown>, fr: boolean): string | null {
  const formule = ACTION[type];
  if (formule) return formule(config, fr);
  const modele = trouverAction(type);
  if (modele) return (fr ? modele.fr : modele.en).replace(/^./, (c) => c.toLowerCase());
  return fr ? 'une action qui n’est plus offerte' : 'an action that is no longer offered';
}

function attente(e: Extract<Etape, { type: 'attendre' }>, fr: boolean): string {
  if (e.mode === 'avant_date') {
    const d = dureeCourte(Number(e.secondes_avant ?? 0), fr);
    return fr ? `attendre jusqu’à ${d} avant le rendez-vous` : `wait until ${d} before the appointment`;
  }
  if (e.mode === 'reponse') {
    const d = dureeCourte(e.delai_secondes, fr);
    return fr ? `attendre la réponse du client (${d} au plus)` : `wait for the client’s reply (${d} at most)`;
  }
  return `${fr ? 'attendre' : 'wait'} ${dureeCourte(e.delai_secondes, fr)}`;
}

/** Le parcours que la règle exécute : `steps`, sinon la projection du format d'origine. */
function etapesDe(regle: RegleAResumer): Etape[] {
  const steps = Array.isArray(regle.steps) ? (regle.steps as Etape[]) : [];
  if (steps.length > 0) return steps;
  if (!estFormatOrigine({ steps, actions: regle.actions })) return [];
  return projeterFormatOrigine({ actions: regle.actions, delay_seconds: regle.delay_seconds });
}

/** Au-delà, la phrase finit par « … (N étapes en tout) » : un résumé ne se lit pas sur trois lignes. */
export const MORCEAUX_MAX = 6;

/**
 * Le fil principal du parcours, en morceaux : on suit `suivant`, et la branche
 * « alors » d'une condition (la branche « sinon » est dite entre parenthèses).
 */
function morceaux(etapes: Etape[], fr: boolean): { textes: string[]; total: number } {
  const parId = new Map(etapes.map((e) => [e.id, e]));
  const textes: string[] = [];
  const vues = new Set<string>();
  const premiere = (id: string | null | undefined): string | null => {
    const e = id ? parId.get(id) : undefined;
    if (!e) return null;
    if (e.type === 'action') return action(String(e.action?.type ?? ''), (e.action?.config ?? {}) as Record<string, unknown>, fr);
    if (e.type === 'attendre') return attente(e, fr);
    if (e.type === 'arreter') return fr ? 'fin' : 'end';
    return fr ? 'une autre condition' : 'another condition';
  };
  let courante: Etape | undefined = etapes[0];
  while (courante && !vues.has(courante.id)) {
    vues.add(courante.id);
    if (courante.type === 'arreter') break;
    if (courante.type === 'action') {
      const t = action(String(courante.action?.type ?? ''), (courante.action?.config ?? {}) as Record<string, unknown>, fr);
      if (t) textes.push(t);
      courante = courante.suivant ? parId.get(courante.suivant) : undefined;
    } else if (courante.type === 'attendre') {
      textes.push(attente(courante, fr));
      courante = courante.suivant ? parId.get(courante.suivant) : undefined;
    } else {
      const sinon = premiere(courante.sinon);
      textes.push(fr
        ? `si la condition est remplie${sinon ? ` (sinon : ${sinon})` : ''}`
        : `if the condition is met${sinon ? ` (otherwise: ${sinon})` : ''}`);
      courante = courante.alors ? parId.get(courante.alors) : undefined;
    }
  }
  // Le nombre d'étapes qui FONT quelque chose (hors notes internes et « arrêter »).
  const total = etapes.filter((e) => e.type !== 'arreter' && !(e.type === 'action' && e.action?.type === 'log_activity')).length;
  return { textes, total };
}

// ── QUI ─────────────────────────────────────────────────────

/** Le ciblage, entre parenthèses : « (sauf étiquette « VIP ») », « (clients avec étiquette « VIP ») ». */
function qui(conditions: Record<string, unknown> | null | undefined, fr: boolean, l: LibellesResume): string {
  const c: CiblageLu | null = lireCiblage(conditions);
  if (ciblageVide(c)) return '';
  const dire = (r: Parameters<typeof libelleRegle>[0]) => libelleRegle(r, fr, l.champs ?? {});
  const exigees = (c?.exiger ?? []).map(dire);
  const regles = (c?.inclure?.regles ?? []).map(dire);
  const liant = c?.inclure?.mode === 'une' ? (fr ? ' ou ' : ' or ') : (fr ? ' et ' : ' and ');
  const groupe = regles.length > 1 && exigees.length > 0 ? `(${regles.join(liant)})` : regles.join(liant);
  const inclus = [...exigees, ...(groupe ? [groupe] : [])].join(fr ? ' et ' : ' and ');
  const exclus = (c?.exclure ?? []).map(dire).join(fr ? ' ou ' : ' or ');
  if (inclus && exclus) return fr ? `clients avec ${inclus}, sauf ${exclus}` : `clients with ${inclus}, except ${exclus}`;
  if (inclus) return fr ? `clients avec ${inclus}` : `clients with ${inclus}`;
  if (exclus) return fr ? `sauf ${exclus}` : `except ${exclus}`;
  return fr ? 'ciblage à corriger' : 'targeting to fix';
}

// ── La phrase ───────────────────────────────────────────────

export interface ResumeEnMorceaux {
  /** « Quand une facture est en retard de 7 jours » */
  quand: string;
  /** « si 2 autres conditions sont remplies » — vide sans filtre. */
  si: string;
  /** « clients avec étiquette « VIP », sauf étiquette « Ne pas relancer » » — vide quand tous les clients sont visés. */
  qui: string;
  /** « texto au client → attendre 3 jours → courriel au client » — « rien pour l'instant » quand le parcours est vide. */
  alors: string;
  /** La phrase entière. */
  phrase: string;
}

/**
 * Le résumé, en ses quatre parties (« Quand… → Si… → Qui… → Alors… ») et en
 * une phrase. Toujours une phrase : une automatisation vide dit qu'elle est vide.
 */
export function resumeEnMorceaux(regle: RegleAResumer, fr = true, libelles: LibellesResume = {}): ResumeEnMorceaux {
  const debut = `${fr ? 'Quand' : 'When'} ${quand(regle, fr, libelles)}`;
  const n = nbFiltres(regle);
  const si = n === 0 ? '' : fr
    ? `si ${n === 1 ? 'une autre condition est remplie' : `${n} autres conditions sont remplies`}`
    : `if ${n === 1 ? 'one more condition is met' : `${n} more conditions are met`}`;
  const cible = qui(regle.conditions, fr, libelles);
  const { textes, total } = morceaux(etapesDe(regle), fr);
  const montres = textes.slice(0, MORCEAUX_MAX);
  const alors = textes.length === 0
    ? (fr ? 'rien pour l’instant (aucune étape)' : 'nothing yet (no step)')
    : montres.join(' → ') + (textes.length > MORCEAUX_MAX
      ? (fr ? ` → … (${total} étapes en tout)` : ` → … (${total} steps in all)`)
      : '');
  const phrase = `${debut}${si ? `, ${si}` : ''} → ${alors}${cible ? ` (${cible})` : ''}`;
  return { quand: debut, si, qui: cible, alors, phrase };
}

/** La phrase-résumé : « Quand une facture est en retard de 7 jours → texto au client (sauf étiquette « VIP ») ». */
export function resumeAutomatisation(regle: RegleAResumer, fr = true, libelles: LibellesResume = {}): string {
  return resumeEnMorceaux(regle, fr, libelles).phrase;
}
