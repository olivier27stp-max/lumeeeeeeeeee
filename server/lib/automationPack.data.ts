/* ═══════════════════════════════════════════════════════════════
   Le PACK DE BASE — les automatisations prêtes pour toute entreprise
   qui s'abonne (décidé avec Rafba le 2026-09-28).

   Au lieu de 38 règles séparées publiées d'office (mesuré en prod : 21 à 27
   publiées qui n'ont jamais tourné, par entreprise), chaque famille devient
   UN parcours en étapes qui s'arrête tout seul :

     · Rendez-vous       : confirmation → 7 j avant → la veille → 2 h avant
     · Relance de devis  : 1 j, 2 j, 5 j, 10 j, 30 j — par le MÊME canal que
                           l'envoi du devis ; s'arrête dès que le devis n'est
                           plus « sans réponse » ou que le client répond
     · Relance de facture: 3 j, 7 j, 14 j, 30 j ; s'arrête dès qu'elle est payée
     · Suivi de prospect : bienvenue → 1 j → 3 j → 14 j ; s'arrête s'il répond
     · Dépôt             : demande (1 h) → rappel 2 j

   Les textes sont ceux des préréglages éprouvés (FR + EN), repris par leur
   clé — seuls trois ont été réécrits parce qu'ils ne collaient plus aux
   nouveaux délais (« dernière relance » à 10 j alors qu'il en reste une à
   30 j ; « depuis 7 jours », « après 21 jours »).

   Les autres préréglages restent disponibles dans l'onglet Modèles.
   ═══════════════════════════════════════════════════════════════ */

import { AUTOMATION_PRESETS, type AutomationPresetDef } from './automationPresets.data';

type Action = { type: string; config: Record<string, unknown> };
type Etape = Record<string, unknown>;

const JOUR = 86_400;

/**
 * Les actions d'un préréglage éprouvé, sans la trace interne `log_activity`.
 * Une tâche portait `description`, que les parcours n'acceptent pas : elle
 * devient `body` (« Détail »), le champ prévu.
 */
function actionsDe(cle: string): Action[] {
  const p = AUTOMATION_PRESETS.find((x) => x.preset_key === cle);
  if (!p) throw new Error(`pack de base : préréglage source introuvable (${cle})`);
  return p.actions.filter((a) => a.type !== 'log_activity').map((a) => {
    if (!('description' in a.config)) return a;
    const { description, ...reste } = a.config;
    return { ...a, config: { ...reste, ...(reste.body ? {} : { body: description }) } };
  });
}
const une = (cle: string, type: string): Action => {
  const a = actionsDe(cle).find((x) => x.type === type);
  if (!a) throw new Error(`pack de base : ${type} absent de ${cle}`);
  return a;
};

/** Construit une suite d'étapes aux identifiants e1, e2… en avant seulement. */
class Parcours {
  etapes: Etape[] = [];
  private n = 0;
  id(): string { return `e${++this.n}`; }
  /** Réserve un identifiant sans poser l'étape (pour pointer en avant). */
  prochain(): string { return `e${this.n + 1}`; }
  ajouter(e: Etape): string { this.etapes.push(e); return e.id as string; }
  /** Relie la dernière étape « libre » à `vers` (champ suivant). */
  static lier(e: Etape | undefined, vers: string | null) { if (e && !('suivant' in e) && e.type !== 'si') e.suivant = vers; }
}

/** Plusieurs actions à la suite ; la dernière reste ouverte vers la suite. */
function enchainer(p: Parcours, actions: Action[], nom?: string): Etape[] {
  const posees: Etape[] = [];
  for (const a of actions) {
    const e: Etape = { id: p.id(), type: 'action', action: a, ...(nom ? { nom } : {}) };
    if (posees.length) posees[posees.length - 1].suivant = e.id;
    posees.push(e); p.ajouter(e);
  }
  return posees;
}

// ── Rendez-vous ─────────────────────────────────────────────
function parcoursRendezVous(): Etape[] {
  const p = new Parcours();
  const conf = enchainer(p, actionsDe('appointment_confirmation'), 'Confirmation');
  const rappels: Array<[string, number, Action[]]> = [
    ['Rappel — 1 semaine avant', 7 * JOUR, actionsDe('job_reminder_7d')],
    ['Rappel — la veille', JOUR, actionsDe('job_reminder_1d')],
    ['Rappel — 2 h avant', 2 * 3600, actionsDe('job_reminder_2h')],
  ];
  let precedentes = conf;
  rappels.forEach(([nom, avant, acts], i) => {
    const attente: Etape = { id: p.id(), type: 'attendre', mode: 'avant_date', delai_secondes: 0, secondes_avant: avant };
    precedentes[precedentes.length - 1].suivant = attente.id;
    p.ajouter(attente);
    const posees = enchainer(p, acts, nom);
    attente.suivant = posees[0].id;
    // Moment dépassé (rendez-vous pris moins d'une semaine avant) : on passe
    // directement à l'attente du rappel suivant, sans envoyer celui-ci.
    attente.si_depasse = i < rappels.length - 1 ? p.prochain() : null;
    precedentes = posees;
  });
  precedentes[precedentes.length - 1].suivant = null;
  return p.etapes;
}

// ── Relances « tant que » (devis, facture) ──────────────────
interface Relance { apres: number; nom: string; sms?: Action; courriel?: Action; equipe?: Action[] }

/**
 * attendre → [si canal = texto → texto | courriel] → actions d'équipe →
 * relance suivante.
 *
 * Pas de « si toujours sans réponse / impayée » : l'ARRÊT AUTOMATIQUE du
 * moteur (CASE_SORTIE, actif par défaut) retire déjà les étapes en attente
 * quand le devis est accepté, refusé ou annulé, et quand la facture est
 * payée ou annulée. Le répéter coûterait une étape par relance.
 */
function parcoursRelances(relances: Relance[], parCanal: boolean): Etape[] {
  const p = new Parcours();
  let precedente: Etape | null = null;
  let delaiDejaEcoule = 0;
  for (const r of relances) {
    const attente: Etape = { id: p.id(), type: 'attendre', delai_secondes: r.apres - delaiDejaEcoule };
    delaiDejaEcoule = r.apres;
    if (precedente) precedente.suivant = attente.id;
    p.ajouter(attente);

    const finales: Etape[] = [];
    if (parCanal && r.sms && r.courriel) {
      const canal: Etape = { id: p.id(), type: 'si', conditions: { channel: { eq: 'sms' } } };
      attente.suivant = canal.id;
      p.ajouter(canal);
      const [texto] = enchainer(p, [r.sms], `${r.nom} (texto)`);
      const [courriel] = enchainer(p, [r.courriel], `${r.nom} (courriel)`);
      canal.alors = texto.id; canal.sinon = courriel.id;
      finales.push(texto, courriel);
    } else {
      const acts = [r.courriel, r.sms].filter(Boolean) as Action[];
      const posees = enchainer(p, acts, r.nom);
      attente.suivant = posees[0].id;
      finales.push(posees[posees.length - 1]);
    }
    if (r.equipe?.length) {
      const equipe = enchainer(p, r.equipe, `${r.nom} (équipe)`);
      for (const f of finales) f.suivant = equipe[0].id;
      precedente = equipe[equipe.length - 1];
    } else if (finales.length === 1) {
      precedente = finales[0];
    } else {
      // Deux branches (texto / courriel) : elles se rejoignent sur l'attente suivante.
      const suite = p.prochain();
      for (const f of finales) f.suivant = suite;
      precedente = null;
    }
  }
  if (precedente) precedente.suivant = null;
  // Des branches rejointes en fin de parcours pointeraient vers une étape
  // qui n'existe pas : on les termine.
  const ids = new Set(p.etapes.map((e) => e.id));
  for (const e of p.etapes) if (typeof e.suivant === 'string' && !ids.has(e.suivant)) e.suivant = null;
  return p.etapes;
}

const notif = (title: string, title_en: string): Action => ({ type: 'create_notification', config: { title, title_en } });
const tache = (title: string, title_en: string): Action => ({ type: 'create_task', config: { title, title_en } });

function parcoursRelanceDevis(): Etape[] {
  return parcoursRelances([
    { apres: 1 * JOUR, nom: 'Relance 1 jour', sms: une('quote_followup_1d', 'send_sms'), courriel: une('quote_followup_1d', 'send_email') },
    { apres: 2 * JOUR, nom: 'Relance 2 jours', sms: une('quote_followup_3d', 'send_sms'), courriel: une('quote_followup_3d', 'send_email') },
    {
      apres: 5 * JOUR, nom: 'Relance 5 jours', sms: une('quote_followup_7d', 'send_sms'), courriel: une('quote_followup_7d', 'send_email'),
      equipe: [notif('[client_name] n’a pas répondu à sa soumission depuis 5 jours.', '[client_name] has not answered the quote for 5 days.')],
    },
    {
      apres: 10 * JOUR, nom: 'Relance 10 jours',
      sms: { type: 'send_sms', config: {
        body: 'Bonjour [client_first_name], on fait un suivi pour votre soumission de [company_name]. On peut en discuter ou l’ajuster à votre goût : répondez simplement à ce message.',
        body_en: 'Hi [client_first_name], following up on your quote from [company_name]. We can talk it over or adjust it: just reply to this message.',
      } },
      courriel: { type: 'send_email', config: {
        subject: '[company_name] — Votre soumission', subject_en: '[company_name] — Your quote',
        body: '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>On revient vers vous au sujet de votre soumission. Si un détail vous fait hésiter, on peut en discuter ou l’ajuster à votre goût.</p><p>Répondez simplement à ce courriel.</p><p>Au plaisir,<br/>[company_name]</p></div>',
        body_en: '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Hi [client_first_name],</h2><p>Following up on your quote. If anything gives you pause, we can talk it over or adjust it.</p><p>Just reply to this email.</p><p>Best,<br/>[company_name]</p></div>',
      } },
      equipe: [tache('Relancer la soumission — [client_name]', 'Follow up on the quote — [client_name]')],
    },
    {
      apres: 30 * JOUR, nom: 'Relance 30 jours',
      sms: { type: 'send_sms', config: {
        body: 'Bonjour [client_first_name], on garde votre dossier ouvert chez [company_name]. Si vous souhaitez aller de l’avant, répondez à ce message.',
        body_en: 'Hi [client_first_name], we are keeping your file open at [company_name]. If you would like to move forward, reply to this message.',
      } },
      courriel: une('quote_followup_21d', 'send_email'),
      equipe: [notif('[client_name] n’a jamais répondu après 30 jours. Le dossier est clos.', '[client_name] never answered after 30 days. The file is closed.')],
    },
  ], true);
}

function parcoursRelanceFacture(): Etape[] {
  const relance = (jours: number, cle: string, equipe?: Action[]): Relance => ({
    apres: jours * JOUR, nom: `Rappel ${jours} jours`, sms: une(cle, 'send_sms'), courriel: une(cle, 'send_email'),
    equipe: equipe ?? actionsDe(cle).filter((a) => a.type === 'create_notification' || a.type === 'create_task'),
  });
  return parcoursRelances([
    relance(3, 'invoice_sent_reminder_3d'),
    relance(7, 'invoice_sent_reminder_7d'),
    relance(14, 'invoice_sent_reminder_14d'),
    relance(30, 'invoice_sent_reminder_30d'),
  ], false);
}

function parcoursProspect(): Etape[] {
  const p = new Parcours();
  const blocs: Array<[string, number, Action[]]> = [
    ['Bienvenue', 0, actionsDe('welcome_new_lead')],
    ['Relance 1 jour', JOUR, actionsDe('lead_followup_1d')],
    ['Relance 3 jours', 2 * JOUR, actionsDe('lead_followup_3d')],
    ['Relance 14 jours', 11 * JOUR, actionsDe('lead_followup_14d')],
  ];
  let precedentes: Etape[] | null = null;
  for (const [nom, attente, acts] of blocs) {
    let entree: string;
    if (attente > 0) {
      const a: Etape = { id: p.id(), type: 'attendre', delai_secondes: attente };
      p.ajouter(a);
      entree = a.id as string;
      const posees = enchainer(p, acts, nom);
      a.suivant = posees[0].id;
      if (precedentes) precedentes[precedentes.length - 1].suivant = entree;
      precedentes = posees;
    } else {
      const posees = enchainer(p, acts, nom);
      if (precedentes) precedentes[precedentes.length - 1].suivant = posees[0].id;
      precedentes = posees;
    }
  }
  if (precedentes) precedentes[precedentes.length - 1].suivant = null;
  return p.etapes;
}

function parcoursDepot(): Etape[] {
  const p = new Parcours();
  const a1: Etape = { id: p.id(), type: 'attendre', delai_secondes: 3600 };
  p.ajouter(a1);
  const demande = enchainer(p, actionsDe('deposit_reminder'), 'Demande de dépôt');
  a1.suivant = demande[0].id;
  const a2: Etape = { id: p.id(), type: 'attendre', delai_secondes: 2 * JOUR };
  demande[demande.length - 1].suivant = a2.id;
  p.ajouter(a2);
  const rappel = enchainer(p, actionsDe('deposit_followup_2d'), 'Rappel de dépôt — 2 jours');
  a2.suivant = rappel[0].id;
  rappel[rappel.length - 1].suivant = null;
  return p.etapes;
}

/** Une automatisation du pack : un préréglage dont le moteur suit `steps`. */
export interface PresetParcours extends AutomationPresetDef {
  steps: Etape[];
  settings?: Record<string, unknown> | null;
}

function parcours(
  preset_key: string, name: string, description: string, trigger_event: string,
  steps: Etape[], conditions: Record<string, unknown> = {}, settings: Record<string, unknown> | null = null,
): PresetParcours {
  const premiere = steps.find((e) => e.type === 'action') as { action: Action } | undefined;
  return {
    preset_key, name, description, trigger_event, conditions, delay_seconds: 0,
    // Reflet de la première action (le moteur suit `steps`).
    actions: premiere ? [premiere.action] : [],
    steps, settings,
  };
}

/** Les parcours du pack, nouveaux préréglages (clés `pack_*`). */
export const PACK_PARCOURS: PresetParcours[] = [
  parcours('pack_rendez_vous', 'Rendez-vous — confirmation et rappels',
    'Confirmation à la réservation, puis rappels 7 jours avant, la veille et 2 h avant. Un rendez-vous déplacé replanifie les rappels ; annulé, tout s’arrête.',
    'appointment.created', parcoursRendezVous()),
  parcours('pack_relance_devis', 'Relance de devis — 1, 2, 5, 10 et 30 jours',
    'Relance par le même canal que l’envoi du devis. S’arrête dès que le devis est accepté, refusé ou que le client répond.',
    'quote.sent', parcoursRelanceDevis(), {}, { arret_sur_reponse: true }),
  parcours('pack_relance_facture', 'Relance de facture — 3, 7, 14 et 30 jours',
    'Rappels par courriel et texto. S’arrête dès que la facture est payée.',
    'invoice.sent', parcoursRelanceFacture()),
  parcours('pack_suivi_prospect', 'Nouveau prospect — bienvenue et suivis',
    'Bienvenue immédiate, puis suivis à 1, 3 et 14 jours. S’arrête dès que le prospect répond.',
    'lead.created', parcoursProspect(), { source: { neq: 'request_form' } }, { arret_sur_reponse: true }),
  parcours('pack_depot', 'Dépôt — demande et rappel',
    'Demande de dépôt une heure après l’acceptation du devis, rappel 2 jours plus tard.',
    'quote.approved', parcoursDepot()),
];

/**
 * Ce qui est PUBLIÉ à la création d'une entreprise : les parcours du pack, et
 * les préréglages d'un seul envoi qui en font partie tels quels.
 * Tout le reste naît en brouillon — donc dans l'onglet Modèles.
 * (La demande d'avis suit l'interrupteur des avis : voir PRESETS_ATTENDENT_AVIS.)
 */
export const PACK_ACTIF: ReadonlySet<string> = new Set([
  ...PACK_PARCOURS.map((p) => p.preset_key),
  'payment_confirmation',
  'deposit_received',
  'thank_you_after_job',
  'agreement_signed',
  // Internes à l'équipe (pipeline), déjà actifs par défaut.
  'quote_opened_notify',
  'quote_opened_move_deal',
  'quote_sent_move_deal',
]);
