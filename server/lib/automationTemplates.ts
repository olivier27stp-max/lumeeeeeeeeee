/* ══════════════════════════════════════════════════════════════
   Catalogue de la bibliothèque de modèles (« Partir d'un modèle »).

   Les modèles SONT les préréglages qui existent déjà — ceux que chaque
   entreprise reçoit à l'inscription (automationPresets.data.ts) et les
   parcours du pack de base (automationPack.data.ts). Rien n'est recopié : on
   lit leurs déclencheurs, conditions, actions et étapes tels quels, et ce
   fichier n'ajoute que ce qui leur manquait pour une bibliothèque — la
   catégorie, un nom et une description en français ET en anglais, la date
   d'ajout.

   Un préréglage absent de META n'apparaît pas : c'est volontaire pour
   `estimate_followup`, branché sur `estimate.sent`, un événement que le moteur
   n'émet pas (voir automationPresetSeeder.ts) — un modèle qui ne se
   déclenche jamais n'a rien à faire dans une bibliothèque.

   Global et en lecture seule : aucune table, aucune écriture. Utiliser un
   modèle crée une COPIE dans l'entreprise (routes/automation-rules.ts).
   ═════════════════════════════════════════════════════════════ */

import { AUTOMATION_PRESETS } from './automationPresets.data';
import { PACK_PARCOURS } from './automationPack.data';
import {
  canauxDe, nbEtapes,
  type CategorieModele, type ModeleAutomatisation,
} from '../../src/lib/automationTemplates';
import type { Etape } from '../../src/lib/sequenceTypes';
import { configParDefaut } from '../../src/lib/automationCatalogue';

interface Meta {
  categorie: CategorieModele;
  nom: [string, string];
  description: [string, string];
  ajoute_le: string;
}

const BASE = '2026-08-02';
const PACK = '2026-09-28';

const META: Record<string, Meta> = {
  // ── Suivi de soumissions ──
  pack_relance_devis: { categorie: 'soumissions', ajoute_le: PACK,
    nom: ['Relance de devis — 1, 2, 5, 10 et 30 jours', 'Quote follow-up — 1, 2, 5, 10 and 30 days'],
    description: ['Relance par le même canal que l’envoi ; s’arrête dès que le devis est accepté, refusé ou que le client répond.', 'Follows up on the channel the quote went out on; stops as soon as it is accepted, declined or the client replies.'] },
  quote_followup_1d: { categorie: 'soumissions', ajoute_le: BASE,
    nom: ['Suivi de devis — 1 jour', 'Quote follow-up — 1 day'],
    description: ['Un mot amical le lendemain de l’envoi du devis.', 'A friendly note the day after the quote is sent.'] },
  quote_followup_3d: { categorie: 'soumissions', ajoute_le: BASE,
    nom: ['Suivi de devis — 3 jours', 'Quote follow-up — 3 days'],
    description: ['Rappel doux 3 jours après l’envoi du devis.', 'Gentle reminder 3 days after the quote is sent.'] },
  quote_followup_7d: { categorie: 'soumissions', ajoute_le: BASE,
    nom: ['Suivi de devis — 7 jours', 'Quote follow-up — 7 days'],
    description: ['Relance une semaine après l’envoi, avec une alerte à l’équipe.', 'Follow-up one week after sending, with a heads-up to the team.'] },
  quote_followup_14d: { categorie: 'soumissions', ajoute_le: BASE,
    nom: ['Suivi de devis — 14 jours', 'Quote follow-up — 14 days'],
    description: ['Dernière chance à 14 jours, avec une tâche d’appel pour le vendeur.', 'Last-chance follow-up at 14 days, with a call task for the rep.'] },
  quote_followup_21d: { categorie: 'soumissions', ajoute_le: BASE,
    nom: ['Suivi de devis — 21 jours (final)', 'Quote follow-up — 21 days (final)'],
    description: ['Dernier suivi avant de fermer le dossier.', 'Final follow-up before closing the file.'] },
  quote_opened_notify: { categorie: 'soumissions', ajoute_le: PACK,
    nom: ['Me notifier quand un client ouvre sa soumission', 'Notify me when a client opens their quote'],
    description: ['Cloche et courriel au vendeur dès la première ouverture — le bon moment pour appeler.', 'Bell and email to the rep on first open — the right time to call.'] },

  // ── Bienvenue / nouveaux clients ──
  welcome_new_lead: { categorie: 'bienvenue', ajoute_le: BASE,
    nom: ['Prospect — Bienvenue', 'Lead — Welcome'],
    description: ['Message de bienvenue immédiat au nouveau prospect.', 'Instant welcome message to a new lead.'] },
  agreement_signed: { categorie: 'bienvenue', ajoute_le: BASE,
    nom: ['Contrat signé', 'Contract signed'],
    description: ['Confirme au client que son contrat est bien signé.', 'Confirms to the client that their contract is signed.'] },

  // ── Rendez-vous et rappels ──
  pack_rendez_vous: { categorie: 'rendez_vous', ajoute_le: PACK,
    nom: ['Rendez-vous — confirmation et rappels', 'Appointment — confirmation and reminders'],
    description: ['Confirmation à la réservation, puis rappels 7 jours avant, la veille et 2 h avant.', 'Confirmation on booking, then reminders 7 days before, the day before and 2 h before.'] },
  appointment_confirmation: { categorie: 'rendez_vous', ajoute_le: BASE,
    nom: ['Confirmation de rendez-vous', 'Appointment confirmation'],
    description: ['Confirme le rendez-vous au client dès qu’il est pris.', 'Confirms the appointment to the client as soon as it is booked.'] },
  job_reminder_7d: { categorie: 'rendez_vous', ajoute_le: BASE,
    nom: ['Rappel de rendez-vous — 7 jours avant', 'Appointment reminder — 7 days before'],
    description: ['Texto et courriel une semaine avant le rendez-vous.', 'Text and email one week before the appointment.'] },
  job_reminder_1d: { categorie: 'rendez_vous', ajoute_le: BASE,
    nom: ['Rappel de rendez-vous — la veille', 'Appointment reminder — day before'],
    description: ['Texto et courriel la veille du rendez-vous.', 'Text and email the day before the appointment.'] },
  job_reminder_2h: { categorie: 'rendez_vous', ajoute_le: BASE,
    nom: ['Rappel de rendez-vous — 2 h avant', 'Appointment reminder — 2 h before'],
    description: ['Texto 2 heures avant l’arrivée de l’équipe.', 'Text 2 hours before the crew arrives.'] },
  no_show_followup: { categorie: 'rendez_vous', ajoute_le: BASE,
    nom: ['Suivi après rendez-vous annulé', 'Follow-up after a cancelled appointment'],
    description: ['Propose de reprendre un rendez-vous annulé ou manqué, et prévient l’équipe.', 'Offers to rebook a cancelled or missed appointment and alerts the team.'] },

  // ── Facturation et paiements ──
  pack_relance_facture: { categorie: 'facturation', ajoute_le: PACK,
    nom: ['Relance de facture — 3, 7, 14 et 30 jours', 'Invoice follow-up — 3, 7, 14 and 30 days'],
    description: ['Rappels par courriel et texto ; s’arrête dès que la facture est payée.', 'Email and text reminders; stops as soon as the invoice is paid.'] },
  invoice_sent_reminder_1d: { categorie: 'facturation', ajoute_le: BASE,
    nom: ['Rappel de facture — 1 jour', 'Invoice reminder — 1 day'],
    description: ['Rappel doux le lendemain de l’envoi de la facture.', 'Gentle reminder the day after the invoice is sent.'] },
  invoice_sent_reminder_3d: { categorie: 'facturation', ajoute_le: BASE,
    nom: ['Rappel de facture — 3 jours', 'Invoice reminder — 3 days'],
    description: ['Rappel 3 jours après l’envoi de la facture.', 'Reminder 3 days after the invoice is sent.'] },
  invoice_sent_reminder_7d: { categorie: 'facturation', ajoute_le: BASE,
    nom: ['Rappel de facture — 7 jours', 'Invoice reminder — 7 days'],
    description: ['Rappel plus ferme à 7 jours, avec une alerte à l’équipe.', 'Firmer reminder at 7 days, with a heads-up to the team.'] },
  invoice_sent_reminder_14d: { categorie: 'facturation', ajoute_le: BASE,
    nom: ['Rappel de facture — 14 jours', 'Invoice reminder — 14 days'],
    description: ['Rappel urgent à 14 jours et tâche de suivi pour l’équipe.', 'Urgent reminder at 14 days and a follow-up task for the team.'] },
  invoice_sent_reminder_30d: { categorie: 'facturation', ajoute_le: BASE,
    nom: ['Dernier rappel de facture — 30 jours', 'Final invoice reminder — 30 days'],
    description: ['Dernier rappel à 30 jours, avec tâche et alerte.', 'Final reminder at 30 days, with a task and an alert.'] },
  payment_confirmation: { categorie: 'facturation', ajoute_le: BASE,
    nom: ['Confirmation de paiement', 'Payment confirmation'],
    description: ['Remercie le client dès que son paiement est reçu.', 'Thanks the client as soon as their payment comes in.'] },
  pack_depot: { categorie: 'facturation', ajoute_le: PACK,
    nom: ['Dépôt — demande et rappel', 'Deposit — request and reminder'],
    description: ['Demande de dépôt une heure après l’acceptation du devis, rappel 2 jours plus tard.', 'Deposit request one hour after the quote is accepted, reminder 2 days later.'] },
  deposit_reminder: { categorie: 'facturation', ajoute_le: BASE,
    nom: ['Rappel de dépôt — devis accepté', 'Deposit reminder — quote accepted'],
    description: ['Rappelle le dépôt demandé une heure après l’acceptation du devis.', 'Reminds the client of the deposit one hour after the quote is accepted.'] },
  deposit_followup_2d: { categorie: 'facturation', ajoute_le: BASE,
    nom: ['Suivi de dépôt — 2 jours', 'Deposit follow-up — 2 days'],
    description: ['Relance si le dépôt n’est pas payé 2 jours après l’acceptation.', 'Follows up if the deposit is unpaid 2 days after acceptance.'] },
  deposit_received: { categorie: 'facturation', ajoute_le: BASE,
    nom: ['Confirmation de dépôt reçu', 'Deposit received confirmation'],
    description: ['Confirme le dépôt au client et prévient l’équipe que le projet peut commencer.', 'Confirms the deposit to the client and tells the team the project can start.'] },

  // ── Après la job ──
  thank_you_after_job: { categorie: 'apres_job', ajoute_le: BASE,
    nom: ['Merci après la job', 'Thank you after the job'],
    description: ['Texto de remerciement une heure après la fin de la job.', 'Thank-you text one hour after the job is done.'] },
  google_review: { categorie: 'apres_job', ajoute_le: BASE,
    nom: ['Demande d’avis — après la job', 'Review request — after the job'],
    description: ['Demande d’avis à la fin de la job : chaque client choisit Google ou Facebook (sauf les clients « noreview »).', 'Review request when the job ends: every client picks Google or Facebook (except “noreview” clients).'] },
  review_reminder_7d: { categorie: 'apres_job', ajoute_le: BASE,
    nom: ['Rappel d’avis — 7 jours', 'Review reminder — 7 days'],
    description: ['Rappel doux une semaine après la job pour laisser un avis.', 'Gentle reminder a week after the job to leave a review.'] },
  post_appointment_survey: { categorie: 'apres_job', ajoute_le: BASE,
    nom: ['Satisfaction le lendemain du service', 'Next-day satisfaction check'],
    description: ['Texto le lendemain pour s’assurer que tout s’est bien passé.', 'Next-day text to make sure everything went well.'] },

  // ── Relance / réactivation ──
  cross_sell_30d: { categorie: 'relance_clients', ajoute_le: BASE,
    nom: ['Vente croisée — 30 jours après la job', 'Cross-sell — 30 days after the job'],
    description: ['Présente vos autres services un mois après la job (sollicitation : consentement requis).', 'Presents your other services a month after the job (marketing: consent required).'] },
  seasonal_reminder_6m: { categorie: 'relance_clients', ajoute_le: BASE,
    nom: ['Rappel saisonnier — 6 mois après la job', 'Seasonal reminder — 6 months after the job'],
    description: ['Propose l’entretien de saison six mois plus tard (sollicitation : consentement requis).', 'Offers seasonal upkeep six months later (marketing: consent required).'] },
  reengagement_90d: { categorie: 'relance_clients', ajoute_le: BASE,
    nom: ['Réengagement — 90 jours', 'Re-engagement — 90 days'],
    description: ['Reprend contact avec un client 90 jours après sa dernière job (sollicitation : consentement requis).', 'Reconnects with a client 90 days after their last job (marketing: consent required).'] },
  client_anniversary: { categorie: 'relance_clients', ajoute_le: BASE,
    nom: ['Anniversaire client — 1 an', 'Client anniversary — 1 year'],
    description: ['Souligne l’anniversaire d’un an de la première job (sollicitation : consentement requis).', 'Marks one year since the first job (marketing: consent required).'] },
  lost_lead_reengagement: { categorie: 'relance_clients', ajoute_le: BASE,
    nom: ['Réengagement d’un prospect perdu — 90 jours', 'Lost lead re-engagement — 90 days'],
    description: ['Recontacte un prospect marqué perdu, 90 jours plus tard (sollicitation : consentement requis).', 'Reaches back to a lead marked lost, 90 days later (marketing: consent required).'] },

  // ── Pipeline / leads ──
  pack_suivi_prospect: { categorie: 'pipeline', ajoute_le: PACK,
    nom: ['Nouveau prospect — bienvenue et suivis', 'New lead — welcome and follow-ups'],
    description: ['Bienvenue immédiate, puis suivis à 1, 3 et 14 jours ; s’arrête dès que le prospect répond.', 'Instant welcome, then follow-ups at 1, 3 and 14 days; stops as soon as the lead replies.'] },
  lead_followup_1d: { categorie: 'pipeline', ajoute_le: BASE,
    nom: ['Suivi prospect — 1 jour', 'Lead follow-up — 1 day'],
    description: ['Texto de suivi le lendemain de l’arrivée du prospect.', 'Follow-up text the day after the lead comes in.'] },
  lead_followup_3d: { categorie: 'pipeline', ajoute_le: BASE,
    nom: ['Suivi prospect — 3 jours', 'Lead follow-up — 3 days'],
    description: ['Courriel de présentation des services 3 jours après.', 'Services introduction email 3 days later.'] },
  lead_followup_14d: { categorie: 'pipeline', ajoute_le: BASE,
    nom: ['Dernier suivi prospect — 14 jours', 'Final lead follow-up — 14 days'],
    description: ['Dernière tentative à 14 jours, avec une tâche pour le vendeur.', 'Last attempt at 14 days, with a task for the rep.'] },
  stale_lead_7d: { categorie: 'pipeline', ajoute_le: BASE,
    nom: ['Alerte prospect — 7 jours sans suite', 'Lead alert — 7 days with no follow-up'],
    description: ['Relance le prospect et alerte l’équipe au bout de 7 jours.', 'Nudges the lead and alerts the team after 7 days.'] },
  quote_sent_move_deal: { categorie: 'pipeline', ajoute_le: PACK,
    nom: ['Avancer le deal quand la soumission est envoyée', 'Move the deal when the quote is sent'],
    description: ['Le deal passe à « Soumission envoyée » ; jamais en arrière.', 'The deal moves to “Quote sent”; never backwards.'] },
  quote_opened_move_deal: { categorie: 'pipeline', ajoute_le: PACK,
    nom: ['Avancer le deal quand le client ouvre sa soumission', 'Move the deal when the client opens the quote'],
    description: ['Le deal passe de « Soumission envoyée » à « Soumission ouverte ».', 'The deal moves from “Quote sent” to “Quote opened”.'] },
  quote_approved_move_deal: { categorie: 'pipeline', ajoute_le: '2026-09-30',
    nom: ['Passer le deal à « Gagné » quand la soumission est acceptée', 'Mark the deal “Won” when the quote is accepted'],
    description: ['Un devis fait après l’entrée du deal et accepté fait passer le deal à « Gagné ».', 'A quote made after the deal entered the pipeline, once accepted, moves the deal to “Won”.'] },
};

type Action = { type: string; config: Record<string, unknown> };

/**
 * Un préréglage peut laisser un champ obligatoire vide et compter sur le
 * moteur (la demande d'avis a `config: {}`) : la ligne semée est un
 * préréglage, exemptée de la vérification de publication. Sa COPIE, elle,
 * est une automatisation ordinaire — sans ce complément, l'entreprise ne
 * pourrait pas la publier. On pose le texte par défaut de l'éditeur (celui
 * qu'on obtient en partant de zéro), en français ET en anglais.
 */
function completer(a: Action): Action {
  const fr = configParDefaut(a.type, true);
  const en = configParDefaut(a.type, false);
  const config = { ...a.config };
  for (const [cle, valeur] of Object.entries(fr)) {
    if (config[cle] === undefined || config[cle] === '') {
      config[cle] = valeur;
      if (en[cle] && config[`${cle}_en`] === undefined) config[`${cle}_en`] = en[cle];
    }
  }
  return { ...a, config };
}

function completerEtapes(steps: Etape[]): Etape[] {
  return steps.map((e) => (e.type === 'action'
    ? { ...e, action: completer(e.action as Action) as typeof e.action }
    : e));
}

type Source = {
  preset_key: string; trigger_event: string; conditions: Record<string, unknown>; delay_seconds: number;
  actions: Array<{ type: string; config: Record<string, unknown> }>;
  steps?: unknown[]; settings?: Record<string, unknown> | null;
};

function construire(): ModeleAutomatisation[] {
  const sources: Source[] = [...AUTOMATION_PRESETS, ...PACK_PARCOURS];
  const out: ModeleAutomatisation[] = [];
  for (const p of sources) {
    const meta = META[p.preset_key];
    if (!meta) continue;
    const actions = p.actions.map(completer);
    const base = {
      steps: p.steps ? completerEtapes(p.steps as Etape[]) : null,
      actions,
      delai_secondes: p.steps ? 0 : p.delay_seconds,
    };
    out.push({
      id: p.preset_key,
      categorie: meta.categorie,
      nom: { fr: meta.nom[0], en: meta.nom[1] },
      description: { fr: meta.description[0], en: meta.description[1] },
      declencheur: p.trigger_event,
      conditions: p.conditions ?? {},
      delai_secondes: base.delai_secondes,
      actions,
      steps: base.steps,
      settings: p.settings ?? null,
      canaux: canauxDe(base),
      nb_etapes: nbEtapes(base),
      industrie: null,
      ajoute_le: meta.ajoute_le,
    });
  }
  return out;
}

/** Le catalogue, figé au démarrage (les préréglages ne changent qu'au déploiement). */
export const MODELES_AUTOMATISATION: readonly ModeleAutomatisation[] = Object.freeze(construire());

/** Les clés de META sans préréglage correspondant — doit rester vide (test). */
export const META_ORPHELINES: readonly string[] = Object.keys(META)
  .filter((k) => !MODELES_AUTOMATISATION.some((m) => m.id === k));

export function trouverModele(id: string): ModeleAutomatisation | undefined {
  return MODELES_AUTOMATISATION.find((m) => m.id === id);
}
