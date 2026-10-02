/* ═══════════════════════════════════════════════════════════════
   Ce qu'une exécution d'automatisation est DEVENUE — en mots, et en comptes.

   La base range chaque événement (fonction SQL `automation_evenements`) :
   elle rend un code d'issue (`issue`) et une catégorie (`categorie`). Ce
   fichier dit ce que ces deux mots veulent dire à l'écran, dans les deux
   langues, pour la liste, la Vue d'ensemble, l'Historique et les Journaux.

   · le sens d'un code (catégorie, groupe, libellé) vient de
     `automationMotifs.ts` — la liste unique du coordinateur ;
   · les actions qui envoient un message au CLIENT viennent du catalogue
     (`vers_client`) — les autres actions réussies sont des « actions
     faites », jamais des « envois » (D-23) ;
   · les anciennes lignes du journal (phrases françaises sans code, motifs
     anglais du moteur) gardent une traduction de repli.

   Aucune dépendance au navigateur : le serveur l'importe aussi
   (à copier dans l'image — Dockerfile, à côté de `automationMotifs.ts`).
   ═══════════════════════════════════════════════════════════════ */

import { ACTIONS, ACTION_REGLE_ECARTEE, trouverAction } from './automationCatalogue';
import { MOTIFS, GROUPES_MOTIFS, groupeDuCode, libelleMotif, motifDuCode, type GroupeMotif } from './automationMotifs';

// ── Périodes ────────────────────────────────────────────────

/** Les périodes offertes partout où un chiffre s'affiche. Les journaux sont gardés 90 jours. */
export const PERIODES_JOURS = [7, 30, 90] as const;
export type PeriodeJours = (typeof PERIODES_JOURS)[number];
export const PERIODE_DEFAUT: PeriodeJours = 30;

export function periodeValide(n: unknown): PeriodeJours | null {
  const v = Number(n);
  return (PERIODES_JOURS as readonly number[]).includes(v) ? (v as PeriodeJours) : null;
}

export function libellePeriode(jours: number, fr: boolean): string {
  return fr ? `${jours} derniers jours` : `Last ${jours} days`;
}

// ── Ce que la base attend de nous ───────────────────────────

/** Les actions qui envoient un message au CLIENT (texto, courriel, demande d'avis, facture, devis). */
export const ACTIONS_MESSAGE_CLIENT: string[] = ACTIONS.filter((a) => a.vers_client).map((a) => a.cle);

/** code → catégorie, passé tel quel à la base (`p_categories`). */
export const CATEGORIES_PAR_CODE: Record<string, string> = Object.fromEntries(MOTIFS.map((m) => [m.code, m.categorie]));

// ── Catégories ──────────────────────────────────────────────

/**
 * Ce qu'on compte.
 *   envoyee   un message est réellement parti chez le client
 *   action    une action interne a été faite (tâche, étiquette, notification…)
 *   echouee   échec DÉFINITIF (une action reprise 4 fois compte une fois)
 *   ignoree   rien n'est parti, volontairement (désabonné, donnée manquante, hors ciblage…)
 *   annulee   un envoi prévu a été annulé (la situation a changé)
 *   reportee  l'envoi attend le prochain créneau (heures d'envoi, rafale)
 *   en_cours  en file, en reprise, ou en train de s'exécuter
 *   tentative un échec suivi d'une reprise : jamais compté
 */
export type CategorieEvenement = 'envoyee' | 'action' | 'echouee' | 'ignoree' | 'annulee' | 'reportee' | 'en_cours' | 'tentative';

const LIBELLES_CATEGORIES: Record<CategorieEvenement, [string, string]> = {
  envoyee: ['Envoyé', 'Sent'],
  action: ['Fait', 'Done'],
  echouee: ['Échec', 'Failed'],
  ignoree: ['Ignoré', 'Skipped'],
  annulee: ['Annulé', 'Cancelled'],
  reportee: ['Reporté', 'Postponed'],
  en_cours: ['En cours', 'In progress'],
  tentative: ['Tentative reprise', 'Retried attempt'],
};

export function libelleCategorie(categorie: string, fr: boolean): string {
  const l = LIBELLES_CATEGORIES[categorie as CategorieEvenement];
  return l ? (fr ? l[0] : l[1]) : (fr ? 'Inconnu' : 'Unknown');
}

/** Les statuts offerts par les filtres de l'Historique et des Journaux → catégories lues en base. */
export const FILTRES_STATUT = {
  reussis: ['envoyee', 'action'],
  ignores: ['ignoree', 'annulee'],
  reportes: ['reportee'],
  echoues: ['echouee'],
  en_cours: ['en_cours'],
  tentatives: ['tentative'],
} as const satisfies Record<string, readonly CategorieEvenement[]>;
export type FiltreStatut = keyof typeof FILTRES_STATUT;

export function libelleFiltreStatut(f: FiltreStatut, fr: boolean): string {
  const l: Record<FiltreStatut, [string, string]> = {
    reussis: ['Réussis', 'Succeeded'],
    ignores: ['Ignorés', 'Skipped'],
    reportes: ['Reportés', 'Postponed'],
    echoues: ['Échoués', 'Failed'],
    en_cours: ['En cours', 'In progress'],
    tentatives: ['Tentatives reprises', 'Retried attempts'],
  };
  return fr ? l[f][0] : l[f][1];
}

/** Le groupe (la raison montrée au propriétaire) d'une issue ignorée, annulée ou reportée. */
export function groupeDeLIssue(issue: string): GroupeMotif {
  // Une tâche annulée par l'ancien moteur n'a pas de code : la situation avait changé.
  if (issue === 'annulee') return 'condition_plus_valide';
  return groupeDuCode(issue);
}

export function libelleGroupe(groupe: GroupeMotif, fr: boolean): string {
  return fr ? GROUPES_MOTIFS[groupe].fr : GROUPES_MOTIFS[groupe].en;
}

// ── Libellés des actions et des statuts de la file ──────────

/** Le nom d'une action, en mots du métier. */
export function libelleAction(type: string, fr: boolean): string {
  const l: Record<string, [string, string]> = {
    send_sms: ['Texto', 'Text'],
    send_email: ['Courriel', 'Email'],
    create_notification: ['Notification', 'Notification'],
    send_notification: ['Notification', 'Notification'],
    create_task: ['Tâche', 'Task'],
    request_review: ['Demande d’avis', 'Review request'],
    log_activity: ['Journal', 'Activity log'],
    update_status: ['Changement de statut', 'Status change'],
    move_deal_stage: ['Déplacement dans le pipeline', 'Pipeline move'],
    // Pas une action : la règle a vu l'événement et ses conditions l'ont écartée.
    [ACTION_REGLE_ECARTEE]: ['Conditions', 'Conditions'],
    // Une étape du parcours sans action (attente, condition).
    __sequence__: ['Étape du parcours', 'Workflow step'],
  };
  const p = l[type];
  if (p) return fr ? p[0] : p[1];
  // Le catalogue de l'éditeur connaît toutes les autres : jamais la clé du moteur à l'écran.
  const a = trouverAction(type);
  if (a) return fr ? a.fr : a.en;
  return fr ? 'Action' : 'Action';
}

/** Le statut d'une tâche de la file, en mots du métier. */
export function libelleStatut(statut: string, fr: boolean): string {
  const l: Record<string, [string, string]> = {
    pending: ['En attente', 'Pending'],
    running: ['En cours', 'Running'],
    completed: ['Terminé', 'Completed'],
    failed: ['Échoué', 'Failed'],
    cancelled: ['Annulé', 'Cancelled'],
    // Envoi volontairement non fait (client désabonné) : le parcours continue.
    skipped: ['Sauté', 'Skipped'],
  };
  const p = l[statut];
  return p ? (fr ? p[0] : p[1]) : statut;
}

/** Ce qui est parti, pour une action réussie : « Texto envoyé », « Tâche créée ». */
export function libelleFait(actionType: string, fr: boolean): string {
  const l: Record<string, [string, string]> = {
    send_sms: ['Texto envoyé', 'Text sent'],
    send_email: ['Courriel envoyé', 'Email sent'],
    request_review: ['Demande d’avis envoyée', 'Review request sent'],
    envoyer_facture: ['Facture envoyée', 'Invoice sent'],
    envoyer_soumission: ['Devis envoyé', 'Quote sent'],
    create_notification: ['Équipe notifiée', 'Team notified'],
    send_notification: ['Équipe notifiée', 'Team notified'],
    create_task: ['Tâche créée', 'Task created'],
    ajouter_etiquette: ['Étiquette ajoutée', 'Tag added'],
    retirer_etiquette: ['Étiquette retirée', 'Tag removed'],
    ajouter_note: ['Note ajoutée', 'Note added'],
    move_deal_stage: ['Opportunité déplacée', 'Opportunity moved'],
    webhook: ['Webhook appelé', 'Webhook called'],
  };
  const p = l[actionType];
  if (p) return fr ? p[0] : p[1];
  return fr ? `${libelleAction(actionType, true)} : fait` : `${libelleAction(actionType, false)}: done`;
}

// ── Raisons : les anciennes lignes, et les motifs du moteur ─

const minuscule = (t: string) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const majuscule = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const sansPoint = (t: string) => t.replace(/[.\s]+$/, '');

/** Un texte a-t-il l'air français ? (jamais montré tel quel dans l'interface anglaise) */
function aLAirFrancais(t: string): boolean {
  return /[àâçéèêëîïôùûœ’«»]|\b(le|la|les|une?|des|du|pas|est|été|envoi|aucune?|déjà|pour|sans|rien|introuvable|invalide|manquante?)\b/i.test(t);
}

/**
 * Les phrases FRANÇAISES que le moteur écrit dans `last_error` (annulation, report) ou
 * `result_error`, ramenées à leur code : c'est le repli des lignes d'avant les codes.
 * L'ordre compte : le plus précis d'abord (« Étape supprimée » avant « supprimé »).
 */
const PHRASES_VERS_CODE: Array<[RegExp, string]> = [
  [/étape supprimée|étape retirée/i, 'etape_retiree'],
  [/automatisation (en brouillon|dépubliée|supprimée|à la corbeille)/i, 'regle_inactive'],
  [/client a répondu/i, 'client_a_repondu'],
  [/(client|fiche|entité|devis|facture|job) a été supprimée?|supprimée? : envoi annulé/i, 'entite_supprimee'],
  [/fusionn/i, 'fiche_fusionnee'],
  [/condition d.arrêt|situation a changé|n.est plus (valide|vraie)/i, 'condition_plus_valide'],
  [/rappel périmé/i, 'rappel_perime'],
  [/rafale de textos/i, 'rafale'],
  [/hors des heures d.envoi|heures calmes|prochaine fenêtre/i, 'hors_heures'],
  [/frequency cap|plafond de messages/i, 'plafond_frequence'],
];

/** Le code d'un motif écrit en phrase par le moteur, ou `null` si on ne le reconnaît pas. */
export function codeDeLaPhrase(texte: string | null | undefined): string | null {
  if (!texte) return null;
  for (const [motif, code] of PHRASES_VERS_CODE) if (motif.test(texte)) return code;
  return null;
}

/**
 * La raison d'un échec ou d'une annulation, traduite.
 *
 * « No recipient phone » ne dit rien à un entrepreneur ; « ce client n'a pas
 * de numéro » lui dit quoi faire. En français, une cause inconnue reste
 * affichée telle quelle — mieux vaut un message technique qu'un silence. En
 * anglais, une phrase française du moteur n'est JAMAIS rendue telle quelle
 * (D-12) : son code, sa traduction, ou une phrase neutre — le texte exact
 * reste lisible dans le détail technique des Journaux.
 */
export function raisonLisible(erreur: string | null, fr: boolean): string | null {
  if (!erreur) return null;
  const e = erreur.toLowerCase();
  // La réservation du moteur : l'action n'a pas encore de résultat.
  if (e === 'en cours') return fr ? 'en cours d’exécution' : 'still running';

  // « … — reprise 1/4 dans 5 min » : la reprise prévue, dite dans la langue de l'écran.
  const reprise = /^(.*?)\s+—\s+reprise (\d+)\/(\d+) dans (\d+) ?(min|h)\b/i.exec(erreur);
  if (reprise) {
    const cause = raisonLisible(reprise[1], fr) ?? '';
    const quand = fr
      ? `nouvelle tentative ${reprise[2]} sur ${reprise[3]} dans ${reprise[4]} ${reprise[5]}`
      : `retry ${reprise[2]} of ${reprise[3]} in ${reprise[4]} ${reprise[5]}`;
    return cause ? `${sansPoint(cause)} — ${quand}` : quand;
  }

  // Annulations et reports écrits en phrases par le moteur : leur code.
  const code = codeDeLaPhrase(erreur);
  if (code && code !== 'plafond_frequence') {
    const m = motifDuCode(code);
    if (m) return minuscule(fr ? m.fr : m.en);
  }

  const paires: Array<[string, string, string]> = [
    // Causes de M1 (audit 2026-09-28) encore portées par les anciens journaux.
    ['no sms number', 'aucun numéro texto n’est configuré pour ce bureau', 'no texting number is set up for this office'],
    ['no active twilio sms number', 'aucun numéro texto n’est configuré pour ce bureau', 'no texting number is set up for this office'],
    // Le plus précis d'abord : « ni courriel ni téléphone » contient « no email address ».
    ['no email address or phone number', 'ce client n’a ni adresse courriel ni numéro de téléphone', 'this client has neither an email address nor a phone number'],
    ['no phone number', 'ce client n’a pas de numéro de téléphone', 'this client has no phone number'],
    ['no email address', 'ce client n’a pas d’adresse courriel', 'this client has no email address'],
    // Demandes d'avis (relevé en prod le 2026-10-01 : ces deux causes sortaient en anglais brut).
    ['review requests are disabled', 'les demandes d’avis sont désactivées dans Paramètres › Avis clients', 'review requests are turned off in Settings › Customer reviews'],
    ['already sent to this client', 'une demande d’avis a déjà été envoyée à ce client dans les 7 derniers jours', 'this client already got a review request in the last 7 days'],
    ['could not be sent', 'la demande d’avis n’a pas pu être envoyée', 'the review request did not go out'],
    ['no org owner', 'aucun propriétaire trouvé pour ce bureau : la tâche n’a pas pu être créée', 'no owner was found for this office, so the task could not be created'],
    ['row matched', 'l’élément visé n’existe plus dans ce bureau', 'the targeted item no longer exists in this office'],
    ['table not allowed', 'cette étape ne s’applique pas à ce type d’élément', 'this step does not apply to this kind of item'],
    ['unknown action type', 'cette étape n’est pas prise en charge par cette version', 'this step is not supported by this version'],
    ['injoignable', 'l’adresse courriel de ce client est injoignable', 'this client’s email address bounces'],
    ['review link', 'aucun lien d’avis Google ou Facebook n’est configuré', 'no Google or Facebook review link is set up'],
    ['no recipient phone', 'ce client n’a pas de numéro de téléphone', 'this client has no phone number'],
    ['no recipient email', 'ce client n’a pas d’adresse courriel', 'this client has no email address'],
    ['opted out', 'ce client s’est désabonné', 'this client opted out'],
    ['not configured', 'l’envoi n’est pas configuré dans les réglages', 'sending is not configured in settings'],
    ['frequency cap', 'la limite de messages pour ce client est atteinte', 'message limit reached for this client'],
    ['consentement', 'le consentement de ce client n’est pas enregistré', 'this client’s consent is not on file'],
    ['consent', 'le consentement de ce client n’est pas enregistré', 'this client’s consent is not on file'],
    // Motifs écrits en FRANÇAIS par le moteur : traduits pour l'interface anglaise (D-12).
    ['aucune étiquette à', 'aucune étiquette à ajouter ou à retirer', 'no tag to add or remove'],
    ['aucun client rattaché', 'aucun client n’est rattaché à cette fiche', 'no client is linked to this record'],
    ['automatisation introuvable', 'l’automatisation à démarrer est introuvable', 'the automation to start was not found'],
    ['adresse refusée', 'l’adresse du webhook a été refusée (adresse non publique)', 'the webhook address was refused (not a public address)'],
    ['lecture du carnet de clients impossible', 'le carnet de clients n’a pas pu être lu : envoi suspendu', 'the client list could not be read: sending is on hold'],
    ['vérification « déjà envoyé » impossible', 'impossible de vérifier si le message était déjà parti : envoi reporté', 'could not check whether the message already went out: sending postponed'],
    ['pas encore disponible', 'cette action n’est pas encore disponible : rien n’a été fait', 'this action is not available yet: nothing was done'],
    ['n’a pas répondu en 5 s', 'l’action n’a pas répondu en 5 secondes', 'the action did not answer within 5 seconds'],
    ["n'a pas répondu en 5 s", 'l’action n’a pas répondu en 5 secondes', 'the action did not answer within 5 seconds'],
    ['fournisseur simulé en panne', 'le fournisseur d’envoi (bac à sable) était en panne', 'the sending provider (sandbox) was down'],
    ['étape suivante non planifiée', 'l’étape suivante n’a pas pu être planifiée : le parcours s’est arrêté', 'the next step could not be scheduled: the workflow stopped'],
  ];
  for (const [motif, fra, eng] of paires) {
    if (e.includes(motif)) return fr ? fra : eng;
  }
  if (!fr && aLAirFrancais(erreur)) return 'the step could not be completed (exact text in the logs)';
  return erreur;
}

/**
 * La cause d'un échec, pour la LISTE des automatisations : une phrase entière.
 *
 * La page affichait « 2 échecs » et s'arrêtait là : l'entrepreneur voyait que
 * ça n'avait pas marché, sans jamais savoir POURQUOI ni quoi faire. Les
 * messages bruts (« SMTP not configured », « Frequency cap reached for
 * +1514… ») sont en anglais, techniques, et ne doivent jamais sortir tels
 * quels.
 *
 * Une cause non reconnue est rendue `null` : dans la liste, on préfère
 * n'afficher que le compteur plutôt qu'un jargon qui n'aide personne (l'onglet
 * Journaux, lui, montre le texte du moteur — `raisonLisible`).
 *
 * Un même test (`tests/automation/raisons-echec-traduites`) vérifie que les deux
 * connaissent TOUS les messages anglais du moteur.
 */
export function raisonEchecListe(erreur: string | null, fr: boolean): string | null {
  const e = (erreur || '').toLowerCase();
  if (!e) return null;
  // Les causes de M1 (audit 2026-09-28), telles que la base les porte encore
  // pour les échecs d'avant le correctif du moteur.
  if (e.includes('no sms number') || e.includes('no active twilio sms number')) return fr ? 'Aucun numéro texto n’est configuré pour ce bureau.' : 'No texting number is set up for this office.';
  if (e.includes('no email address or phone number')) return fr ? 'Ce client n’a ni adresse courriel ni numéro de téléphone.' : 'This client has neither an email address nor a phone number.';
  if (e.includes('no recipient phone') || e.includes('no phone number')) return fr ? 'Ce client n’a pas de numéro de téléphone.' : 'This client has no phone number.';
  if (e.includes('no recipient email') || e.includes('no email address')) return fr ? 'Ce client n’a pas d’adresse courriel.' : 'This client has no email address.';
  if (e.includes('injoignable') || e.includes('bounce')) return fr ? 'L’adresse courriel de ce client est injoignable.' : 'This client’s email address bounces.';
  if (e.includes('review requests are disabled')) return fr ? 'Les demandes d’avis sont désactivées dans Paramètres › Avis clients.' : 'Review requests are turned off in Settings › Customer reviews.';
  if (e.includes('already sent to this client')) return fr ? 'Une demande d’avis a déjà été envoyée à ce client dans les 7 derniers jours.' : 'This client already got a review request in the last 7 days.';
  if (e.includes('review link')) return fr ? 'Aucun lien d’avis Google ou Facebook n’est configuré.' : 'No Google or Facebook review link is set up.';
  if (e.includes('opted out') || e.includes('unsubscribed')) return fr ? 'Ce client s’est désabonné.' : 'This client unsubscribed.';
  if (e.includes('frequency cap')) return fr ? 'Plafond atteint : ce client a déjà reçu plusieurs messages aujourd’hui.' : 'Cap reached: this client already got several messages today.';
  if (e.includes('consentement') || e.includes('consent')) return fr ? 'Le consentement de ce client n’est pas enregistré.' : 'This client’s consent is not recorded.';
  if (e.includes('smtp') && e.includes('not configured')) return fr ? 'Courriel non configuré : impossible d’envoyer.' : 'Email not configured: cannot send.';
  if (e.includes('twilio') && e.includes('not configured')) return fr ? 'Envoi de textos non configuré : impossible d’envoyer.' : 'SMS sending not configured: cannot send.';
  if (e.includes('not configured')) return fr ? 'Envoi non configuré dans les réglages.' : 'Sending is not configured in settings.';
  if (e.includes('plan does not include')) return fr ? 'Votre forfait n’inclut pas cet envoi.' : 'Your plan does not include this send.';
  if (e.includes('are disabled')) return fr ? 'Cette fonctionnalité est désactivée dans les réglages.' : 'This feature is disabled in settings.';
  if (e.includes('could not be sent')) return fr ? 'La demande d’avis n’a pas pu être envoyée.' : 'The review request did not go out.';
  if (e.includes('no org owner')) return fr ? 'Aucun propriétaire trouvé pour ce bureau : la tâche n’a pas pu être créée.' : 'No owner was found for this office, so the task could not be created.';
  if (e.includes('row matched')) return fr ? 'L’élément visé n’existe plus dans ce bureau.' : 'The targeted item no longer exists in this office.';
  if (e.includes('table not allowed')) return fr ? 'Cette étape ne s’applique pas à ce type d’élément.' : 'This step does not apply to this kind of item.';
  if (e.includes('unknown action type')) return fr ? 'Cette étape n’est pas prise en charge par cette version.' : 'This step is not supported by this version.';
  return null;
}

/**
 * Le motif d'un envoi IGNORÉ (`result_data.saute`), ou `null` si l'envoi est parti.
 * En anglais : le libellé du code, jamais la phrase française du moteur (D-12).
 */
export function motifSaut(
  ligne: { result_success: boolean; result_data?: Record<string, unknown> | null },
  fr = true,
): string | null {
  if (!ligne.result_success) return null;
  const phrase = ligne.result_data?.saute;
  const code = ligne.result_data?.saute_code;
  if (typeof phrase !== 'string' || !phrase) {
    return typeof code === 'string' && code ? libelleMotif(code, fr) : null;
  }
  return libelleIssue(typeof code === 'string' && code ? code : 'desabonne', fr, phrase);
}

/**
 * La phrase du moteur peut-elle être montrée telle quelle ? Jamais si elle cite un numéro de
 * téléphone ou une adresse (l'ancien « Frequency cap reached for +1514… », constat D-03b), ni si
 * c'est un texte anglais du moteur : le libellé du code suffit alors.
 */
function detailMontrable(detail: string | null | undefined): string | null {
  if (!detail) return null;
  if (/\+?\d[\d\s().-]{8,}\d/.test(detail) || /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(detail)) return null;
  if (/frequency cap|skipped to avoid/i.test(detail)) return null;
  return detail;
}

/**
 * Le libellé d'une issue ignorée, reportée ou annulée.
 * `detail` = la phrase du moteur (française) : ajoutée en français seulement.
 * En anglais, une condition non remplie garde le nom du champ (« Conditions not met: source »)
 * seulement si le moteur l'a donné à part (`condition`).
 */
export function libelleIssue(issue: string, fr: boolean, brut?: string | null): string {
  const detail = detailMontrable(brut);
  if (issue === 'annulee') {
    // Ancien moteur : pas de code, une phrase dans `last_error`.
    const code = codeDeLaPhrase(detail);
    if (code) return libelleMotif(code, fr);
    if (fr && detail) return sansPoint(detail.replace(/^annulée?\s*:\s*/i, '')).replace(/^./, (c) => c.toUpperCase());
    return fr ? 'L’envoi prévu a été annulé' : 'The scheduled send was cancelled';
  }
  if (!motifDuCode(issue)) {
    // Code inconnu de la liste : la phrase du moteur en français, une phrase neutre en anglais.
    if (fr) return detail ? sansPoint(detail) : 'Raison non précisée';
    return 'Reason not specified';
  }
  return libelleMotif(issue, fr, detail);
}

// ── Le résultat d'un événement, en clair ────────────────────

export interface EvenementLisible {
  issue: string;
  categorie: string;
  action_type?: string | null;
  /** La phrase du moteur : `result_data.saute`, `result_error` ou `last_error`. */
  detail?: string | null;
}

/**
 * La cause d'un échec, pour une phrase lue par le PROPRIÉTAIRE (Historique, statut d'une ligne).
 * Une cause reconnue est traduite ; une phrase française du moteur est gardée ; tout le reste —
 * le texte brut d'un fournisseur, un message qui cite un numéro ou une adresse — devient une
 * phrase neutre : le texte exact se lit dans le détail technique des Journaux.
 */
function raisonEchecClaire(erreur: string | null, fr: boolean): string | null {
  if (!erreur) return null;
  const traduite = raisonLisible(erreur, fr);
  if (traduite && traduite !== erreur) return traduite;
  if (fr && aLAirFrancais(erreur) && detailMontrable(erreur)) return erreur;
  return fr ? 'erreur technique (texte exact dans les Journaux)' : 'technical error (exact text in the logs)';
}

/**
 * « Envoyé », « Ignoré : client désabonné », « Reporté au prochain créneau d'envoi »,
 * « Échec : ce client n'a pas de numéro de téléphone » — la phrase de l'Historique.
 */
export function resultatLisible(ev: EvenementLisible, fr: boolean): string {
  const action = ev.action_type ?? '';
  switch (ev.categorie) {
    case 'envoyee':
    case 'action':
      return libelleFait(action, fr);
    case 'echouee': {
      if (ev.issue === 'interrompue') {
        return fr ? 'Échec : l’action a été interrompue avant la fin' : 'Failed: the action was interrupted before it finished';
      }
      const raison = raisonEchecClaire(ev.detail ?? null, fr);
      return raison ? `${fr ? 'Échec' : 'Failed'}${fr ? ' : ' : ': '}${sansPoint(raison)}` : (fr ? 'Échec' : 'Failed');
    }
    case 'ignoree':
      return `${fr ? 'Ignoré' : 'Skipped'}${fr ? ' : ' : ': '}${minuscule(libelleIssue(ev.issue, fr, ev.detail))}`;
    case 'annulee':
      return `${fr ? 'Annulé' : 'Cancelled'}${fr ? ' : ' : ': '}${minuscule(libelleIssue(ev.issue, fr, ev.detail))}`;
    case 'reportee':
      // « Reporté au prochain créneau d'envoi », « Envoi étalé » : le libellé du code suffit.
      return majuscule(libelleIssue(ev.issue, fr));
    case 'en_cours':
      if (ev.issue === 'en_reprise') return fr ? 'Échec passager : nouvelle tentative prévue' : 'Temporary failure: a retry is scheduled';
      if (ev.issue === 'en_attente') return fr ? 'En attente' : 'Waiting';
      return fr ? 'En cours' : 'In progress';
    case 'tentative':
      return fr ? 'Tentative échouée, reprise ensuite' : 'Failed attempt, retried afterwards';
    default:
      return libelleCategorie(ev.categorie, fr);
  }
}
