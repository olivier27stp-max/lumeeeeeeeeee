/**
 * Le catalogue ATTENDU des actions (carte de l'éditeur, § 3.c) : 21 actions,
 * 40 champs, avec pour chacun ce qu'on saisit et ce qui doit être enregistré.
 *
 * Écrit À LA MAIN d'après la carte, et non importé du produit : c'est
 * l'attente. Un test (02-catalogue) le compare ensuite au catalogue du code,
 * pour qu'une action ou un champ ajouté sans test se voie tout de suite.
 */
import type { Donnees } from './_aides';

export type TypeChampAttendu =
  | 'texte' | 'zone' | 'nombre' | 'choix' | 'bascule' | 'membre' | 'etiquette' | 'url' | 'automatisation'
  /** Un menu des étapes des pipelines du bureau (« Déplacer l’opportunité → L’étape visée », depuis #859). */
  | 'etape_pipeline'
  /** « Mettre à jour un champ personnalisé » : le menu des champs, puis la valeur selon le type du champ. */
  | 'champ_perso' | 'valeur_champ';

export interface Saisie {
  /** Ce qui doit être ENREGISTRÉ dans `config[cle]` (toujours du texte). */
  valeur: string;
  /** Pour un menu : le libellé qu'on choisit et qu'on doit relire à l'écran. */
  affiche?: string;
}

export interface ChampAttendu {
  id: string;
  cle: string;
  fr: string;
  en: string;
  type: TypeChampAttendu;
  obligatoire: boolean;
  /** Longueur maximale annoncée par la carte (champs de texte). */
  max?: number;
  /** Ce que le test saisit ; `null` = on n'y touche pas dans le parcours « tout remplir ». */
  saisie: (d: Donnees) => Saisie | null;
  /** Valeur proposée à la création (champ obligatoire avec défaut). */
  defaut_fr?: string;
  defaut_en?: string;
  /** Champ sous drapeau d'entreprise. */
  drapeau?: string;
}

export interface ActionAttendue {
  id: string;
  cle: string;
  fr: string;
  en: string;
  aide_fr: string;
  aide_en: string;
  famille_fr: string;
  famille_en: string;
  /** Un déclencheur avec lequel l'action est compatible (là où le test l'ajoute). */
  declencheur: string;
  indisponible?: { fr: string; en: string };
  champs: ChampAttendu[];
}

const TEXTE_COURRIEL = 'Bonjour [client_name],\n\nVoici un suivi de votre devis — n’hésitez pas à répondre.\n\nÀ bientôt,\nL’équipe « Nettoyage Test »';
const TEXTE_TEXTO = 'Bonjour [client_name], c’est [company_name] : votre devis est prêt 👍 Répondez OUI pour confirmer.';

const TYPE_ENVOI = (id: string, valeur: 'marketing' | 'transactionnel'): ChampAttendu => ({
  id, cle: 'type_envoi', fr: 'Type d’envoi', en: 'Message type', type: 'choix', obligatoire: false, drapeau: 'auto_desabonnement_canal',
  saisie: () => (valeur === 'marketing'
    ? { valeur, affiche: 'Marketing — pas envoyé à un client désabonné' }
    : { valeur, affiche: 'Transactionnel — part même si le client s’est désabonné' }),
});

export const ACTIONS_ATTENDUES: ActionAttendue[] = [
  {
    id: 'ACT-01', cle: 'send_email', fr: 'Envoyer un courriel', en: 'Send an email',
    aide_fr: 'Part à l’adresse du client, au nom de l’entreprise.', aide_en: 'Goes to the client’s address, from the company.',
    famille_fr: 'Communication', famille_en: 'Communication', declencheur: 'quote.sent',
    champs: [
      { id: 'CHA-01', cle: 'from_name', fr: 'Nom de l’expéditeur', en: 'From name', type: 'texte', obligatoire: false, max: 100, saisie: () => ({ valeur: 'Équipe Nettoyage Test' }) },
      { id: 'CHA-02', cle: 'reply_to', fr: 'Répondre à', en: 'Reply to', type: 'texte', obligatoire: false, max: 200, saisie: () => ({ valeur: 'reponses@lume-qa.test' }) },
      { id: 'CHA-03', cle: 'subject', fr: 'Objet', en: 'Subject', type: 'texte', obligatoire: true, max: 200, saisie: () => ({ valeur: 'Votre devis — un mot de suivi' }), defaut_fr: 'Un message de [company_name]', defaut_en: 'A message from [company_name]' },
      { id: 'CHA-04', cle: 'preheader', fr: 'Aperçu', en: 'Preview text', type: 'texte', obligatoire: false, max: 200, saisie: () => ({ valeur: 'On reste disponibles pour vos questions' }) },
      {
        id: 'CHA-05', cle: 'body', fr: 'Message', en: 'Message', type: 'zone', obligatoire: true, max: 10000, saisie: () => ({ valeur: TEXTE_COURRIEL }),
        defaut_fr: 'Bonjour [client_name],\n\nMerci de faire affaire avec [company_name].\n\nAu plaisir,\n[company_name]',
        defaut_en: 'Hi [client_name],\n\nThank you for choosing [company_name].\n\nBest,\n[company_name]',
      },
      TYPE_ENVOI('CHA-06', 'marketing'),
    ],
  },
  {
    id: 'ACT-02', cle: 'send_sms', fr: 'Envoyer un texto', en: 'Send a text message',
    aide_fr: 'Part au téléphone du client. Jamais entre 20 h et 8 h.', aide_en: 'Goes to the client’s phone. Never between 8 p.m. and 8 a.m.',
    famille_fr: 'Communication', famille_en: 'Communication', declencheur: 'quote.sent',
    champs: [
      {
        id: 'CHA-07', cle: 'body', fr: 'Texte du message', en: 'Message text', type: 'zone', obligatoire: true, max: 1600, saisie: () => ({ valeur: TEXTE_TEXTO }),
        defaut_fr: 'Bonjour [client_name], c’est [company_name]. Merci !', defaut_en: 'Hi [client_name], this is [company_name]. Thank you!',
      },
      TYPE_ENVOI('CHA-08', 'transactionnel'),
    ],
  },
  {
    id: 'ACT-03', cle: 'create_notification', fr: 'Notifier l’équipe', en: 'Notify the team',
    aide_fr: 'Reste à l’interne. Le client ne voit rien.', aide_en: 'Stays internal. The client sees nothing.',
    famille_fr: 'Communication', famille_en: 'Communication', declencheur: 'lead.created',
    champs: [
      // Le défaut attendu est en bon français : « à faire », avec l'accent (piste S-29 de la carte).
      { id: 'CHA-09', cle: 'title', fr: 'Titre', en: 'Title', type: 'texte', obligatoire: true, max: 200, saisie: () => ({ valeur: 'Nouveau prospect à rappeler : [client_name]' }), defaut_fr: 'Suivi à faire pour [client_name]', defaut_en: 'Follow up on [client_name]' },
      { id: 'CHA-10', cle: 'body', fr: 'Détail', en: 'Details', type: 'zone', obligatoire: false, max: 2000, saisie: () => ({ valeur: 'Rappeler d’ici 24 h.\nSource : formulaire du site.' }) },
      { id: 'CHA-11', cle: 'destinataire', fr: 'Pour qui', en: 'For whom', type: 'choix', obligatoire: false, saisie: () => ({ valeur: 'membre', affiche: 'Un membre précis' }) },
      { id: 'CHA-12', cle: 'membre_id', fr: 'Le membre', en: 'The member', type: 'membre', obligatoire: false, saisie: (d) => ({ valeur: d.membres.tech.id, affiche: d.membres.tech.nom }) },
      { id: 'CHA-13', cle: 'par_courriel', fr: 'Aussi par courriel', en: 'Also by email', type: 'bascule', obligatoire: false, saisie: () => ({ valeur: 'true' }) },
    ],
  },
  {
    id: 'ACT-04', cle: 'request_review', fr: 'Demander un avis', en: 'Ask for a review',
    aide_fr: 'Envoie au client le sondage d’avis. Les textes (texto et courriel) et le lien Google ou Facebook se règlent dans Paramètres › Avis clients.',
    aide_en: 'Sends the client the review survey. The texts (text and email) and the Google or Facebook link are set in Settings › Customer reviews.',
    famille_fr: 'Communication', famille_en: 'Communication', declencheur: 'job.completed',
    champs: [],
  },
  {
    id: 'ACT-05', cle: 'envoyer_slack', fr: 'Envoyer dans Slack', en: 'Send to Slack',
    aide_fr: 'Publie dans le canal Slack de votre entreprise.', aide_en: 'Posts to your company’s Slack channel.',
    famille_fr: 'Communication', famille_en: 'Communication', declencheur: 'lead.created',
    indisponible: { fr: 'Bientôt : la connexion à votre Slack n’existe pas encore.', en: 'Coming soon: connecting your Slack is not available yet.' },
    champs: [
      { id: 'CHA-14', cle: 'body', fr: 'Message', en: 'Message', type: 'zone', obligatoire: true, max: 3000, saisie: () => null, defaut_fr: '[client_name] — suivi à faire', defaut_en: '[client_name] — follow-up needed' },
    ],
  },
  {
    id: 'ACT-06', cle: 'ajouter_etiquette', fr: 'Ajouter une étiquette', en: 'Add a tag',
    aide_fr: 'Marque le client, pour le retrouver ou déclencher autre chose.', aide_en: 'Marks the client, to find them later or trigger something else.',
    famille_fr: 'Client', famille_en: 'Client', declencheur: 'lead.created',
    champs: [
      { id: 'CHA-15', cle: 'etiquette', fr: 'L’étiquette', en: 'The tag', type: 'etiquette', obligatoire: true, max: 60, saisie: () => ({ valeur: 'VIP QA' }) },
    ],
  },
  {
    id: 'ACT-07', cle: 'retirer_etiquette', fr: 'Retirer une étiquette', en: 'Remove a tag',
    aide_fr: 'Enlève une étiquette du client, ou toutes.', aide_en: 'Removes a tag from the client, or all of them.',
    famille_fr: 'Client', famille_en: 'Client', declencheur: 'client.tagged',
    champs: [
      // « Toutes » décoché ici (l'étiquette doit rester visible) ; coché dans 03-champs-types.
      { id: 'CHA-16', cle: 'toutes', fr: 'Retirer toutes les étiquettes', en: 'Remove all tags', type: 'bascule', obligatoire: false, saisie: () => null },
      { id: 'CHA-17', cle: 'etiquette', fr: 'L’étiquette', en: 'The tag', type: 'etiquette', obligatoire: false, max: 60, saisie: () => ({ valeur: 'Ne pas relancer QA' }) },
    ],
  },
  {
    id: 'ACT-08', cle: 'modifier_client', fr: 'Modifier le client', en: 'Update the client',
    aide_fr: 'Change le statut, la source ou la valeur estimée.', aide_en: 'Changes the status, source or estimated value.',
    famille_fr: 'Client', famille_en: 'Client', declencheur: 'lead.created',
    champs: [
      { id: 'CHA-18', cle: 'statut', fr: 'Statut', en: 'Status', type: 'choix', obligatoire: false, saisie: () => ({ valeur: 'active', affiche: 'Client actif' }) },
      { id: 'CHA-19', cle: 'source', fr: 'Source', en: 'Source', type: 'texte', obligatoire: false, max: 60, saisie: () => ({ valeur: 'Référence d’un client' }) },
      { id: 'CHA-20', cle: 'valeur', fr: 'Valeur estimée ($)', en: 'Estimated value ($)', type: 'nombre', obligatoire: false, saisie: () => ({ valeur: '2500' }) },
    ],
  },
  {
    id: 'ACT-09', cle: 'assigner_responsable', fr: 'Assigner un responsable', en: 'Assign an owner',
    aide_fr: 'Donne le client à un membre de l’équipe.', aide_en: 'Gives the client to a team member.',
    famille_fr: 'Client', famille_en: 'Client', declencheur: 'lead.created',
    champs: [
      { id: 'CHA-21', cle: 'membre_id', fr: 'Le membre', en: 'The member', type: 'membre', obligatoire: false, saisie: (d) => ({ valeur: d.membres.admin.id, affiche: d.membres.admin.nom }) },
      { id: 'CHA-22', cle: 'seulement_si_vide', fr: 'Seulement si personne n’est assigné', en: 'Only if unassigned', type: 'bascule', obligatoire: false, saisie: () => ({ valeur: 'true' }) },
    ],
  },
  {
    id: 'ACT-10', cle: 'ajouter_note', fr: 'Ajouter une note', en: 'Add a note',
    aide_fr: 'Écrit une note dans la fiche du client.', aide_en: 'Writes a note on the client record.',
    famille_fr: 'Client', famille_en: 'Client', declencheur: 'note.added',
    champs: [
      { id: 'CHA-23', cle: 'body', fr: 'La note', en: 'The note', type: 'zone', obligatoire: true, max: 4000, saisie: () => ({ valeur: 'Note posée par l’automatisation.\nÀ vérifier au prochain appel.' }), defaut_fr: 'Note automatique pour [client_name].', defaut_en: 'Automatic note for [client_name].' },
    ],
  },
  {
    id: 'ACT-11', cle: 'update_custom_field', fr: 'Mettre à jour un champ personnalisé', en: 'Update a custom field',
    aide_fr: 'Écrit une valeur dans un champ de la fiche concernée. Reste à l’interne.', aide_en: 'Writes a value into a field of the record concerned. Stays internal.',
    famille_fr: 'Client', famille_en: 'Client', declencheur: 'lead.created',
    champs: [
      { id: 'CHA-24', cle: 'field_id', fr: 'Champ', en: 'Field', type: 'champ_perso', obligatoire: true, saisie: (d) => ({ valeur: d.champs.qa_type_client.id, affiche: d.champs.qa_type_client.label }) },
      { id: 'CHA-25', cle: 'value', fr: 'Nouvelle valeur', en: 'New value', type: 'valeur_champ', obligatoire: false, saisie: (d) => ({ valeur: d.champs.qa_type_client.options[1].id, affiche: d.champs.qa_type_client.options[1].label }) },
    ],
  },
  {
    id: 'ACT-12', cle: 'create_task', fr: 'Créer une tâche', en: 'Create a task',
    aide_fr: 'Ajoute une tâche à faire dans Lume. Reste à l’interne.', aide_en: 'Adds a to-do in Lume. Stays internal.',
    famille_fr: 'Travail', famille_en: 'Work', declencheur: 'lead.created',
    champs: [
      { id: 'CHA-26', cle: 'title', fr: 'Titre de la tâche', en: 'Task title', type: 'texte', obligatoire: true, max: 200, saisie: () => ({ valeur: 'Rappeler [client_name] avant vendredi' }), defaut_fr: 'Rappeler [client_name]', defaut_en: 'Call [client_name] back' },
      { id: 'CHA-27', cle: 'body', fr: 'Détail', en: 'Details', type: 'zone', obligatoire: false, max: 2000, saisie: () => ({ valeur: 'Vérifier l’adresse et la disponibilité.' }) },
      { id: 'CHA-28', cle: 'priorite', fr: 'Priorité', en: 'Priority', type: 'choix', obligatoire: false, saisie: () => ({ valeur: 'high', affiche: 'Haute' }) },
      { id: 'CHA-29', cle: 'echeance_jours', fr: 'À faire dans (jours)', en: 'Due in (days)', type: 'nombre', obligatoire: false, saisie: () => ({ valeur: '3' }) },
      { id: 'CHA-30', cle: 'membre_id', fr: 'Assignée à', en: 'Assigned to', type: 'membre', obligatoire: false, saisie: (d) => ({ valeur: d.membres.tech.id, affiche: d.membres.tech.nom }) },
    ],
  },
  {
    id: 'ACT-13', cle: 'modifier_statut_rendezvous', fr: 'Changer le statut du rendez-vous', en: 'Change appointment status',
    aide_fr: 'Confirme, annule ou marque la visite comme faite.', aide_en: 'Confirms, cancels or marks the visit as done.',
    famille_fr: 'Travail', famille_en: 'Work', declencheur: 'appointment.created',
    champs: [
      { id: 'CHA-31', cle: 'statut', fr: 'Nouveau statut', en: 'New status', type: 'choix', obligatoire: true, saisie: () => ({ valeur: 'completed', affiche: 'Terminé' }) },
    ],
  },
  {
    id: 'ACT-14', cle: 'move_deal_stage', fr: 'Déplacer l’opportunité', en: 'Move the deal',
    aide_fr: 'Change l’étape de l’opportunité dans son pipeline.', aide_en: 'Moves the deal to another stage of its pipeline.',
    famille_fr: 'Ventes', famille_en: 'Sales', declencheur: 'quote.sent',
    champs: [
      { id: 'CHA-32', cle: 'cible', fr: 'Vers', en: 'To', type: 'choix', obligatoire: false, saisie: () => ({ valeur: 'etape', affiche: 'Une étape précise' }) },
      // Depuis #859 (S-10 corrigé) : un MENU des étapes du bureau (« Pipeline · Étape »), plus un champ de
      // texte où taper un identifiant — donc plus de longueur maximale. On choisit l'étape par son nom ;
      // c'est son identifiant qui est enregistré, et relu par son nom.
      {
        id: 'CHA-33', cle: 'stage_id', fr: 'L’étape visée', en: 'Target stage', type: 'etape_pipeline', obligatoire: true,
        saisie: (d) => ({ valeur: d.etapes[1].id, affiche: `${d.pipeline.name} · ${d.etapes[1].name_fr}` }),
      },
    ],
  },
  {
    id: 'ACT-15', cle: 'modifier_deal', fr: 'Modifier l’opportunité', en: 'Update the deal',
    aide_fr: 'Change la source de l’opportunité.', aide_en: 'Changes the deal’s source.',
    famille_fr: 'Ventes', famille_en: 'Sales', declencheur: 'deal.stage_entered',
    champs: [
      { id: 'CHA-34', cle: 'source', fr: 'Source', en: 'Source', type: 'texte', obligatoire: false, max: 60, saisie: () => ({ valeur: 'Salon de l’habitation' }) },
    ],
  },
  {
    id: 'ACT-16', cle: 'assigner_deal', fr: 'Assigner l’opportunité', en: 'Assign the deal',
    aide_fr: 'Donne l’opportunité à un membre de l’équipe.', aide_en: 'Gives the deal to a team member.',
    famille_fr: 'Ventes', famille_en: 'Sales', declencheur: 'deal.stage_entered',
    champs: [
      { id: 'CHA-35', cle: 'membre_id', fr: 'Le membre', en: 'The member', type: 'membre', obligatoire: false, saisie: (d) => ({ valeur: d.membres.proprio.id, affiche: d.membres.proprio.nom }) },
    ],
  },
  {
    id: 'ACT-17', cle: 'envoyer_facture', fr: 'Envoyer la facture', en: 'Send the invoice',
    aide_fr: 'Envoie au client la facture liée, par courriel.', aide_en: 'Emails the linked invoice to the client.',
    famille_fr: 'Argent', famille_en: 'Money', declencheur: 'invoice.sent',
    champs: [
      { id: 'CHA-36', cle: 'body', fr: 'Mot d’accompagnement', en: 'Cover note', type: 'zone', obligatoire: false, max: 2000, saisie: () => ({ valeur: 'Bonjour [client_name],\nvoici votre facture. Merci de votre confiance !' }) },
    ],
  },
  {
    id: 'ACT-18', cle: 'envoyer_soumission', fr: 'Envoyer le devis', en: 'Send the quote',
    aide_fr: 'Envoie au client le devis lié, par courriel.', aide_en: 'Emails the linked quote to the client.',
    famille_fr: 'Argent', famille_en: 'Money', declencheur: 'quote.sent',
    champs: [
      { id: 'CHA-37', cle: 'body', fr: 'Mot d’accompagnement', en: 'Cover note', type: 'zone', obligatoire: false, max: 2000, saisie: () => ({ valeur: 'Bonjour [client_name],\nvoici votre devis mis à jour.' }) },
    ],
  },
  {
    id: 'ACT-19', cle: 'webhook', fr: 'Appeler un webhook', en: 'Call a webhook',
    aide_fr: 'Envoie les données de l’événement à une adresse externe.', aide_en: 'Posts the event data to an external address.',
    famille_fr: 'Technique', famille_en: 'Technical', declencheur: 'lead.created',
    champs: [
      { id: 'CHA-38', cle: 'url', fr: 'L’adresse', en: 'The address', type: 'url', obligatoire: true, max: 500, saisie: () => ({ valeur: 'https://crochets.lume-qa.test/entrant?source=lume&bureau=a' }) },
    ],
  },
  {
    id: 'ACT-20', cle: 'demarrer_automatisation', fr: 'Démarrer une automatisation', en: 'Start an automation',
    aide_fr: 'Fait entrer le client dans un autre parcours — celui-ci continue.', aide_en: 'Enrolls the client in another journey — this one carries on.',
    famille_fr: 'Technique', famille_en: 'Technical', declencheur: 'lead.created',
    champs: [
      { id: 'CHA-39', cle: 'rule_id', fr: 'Laquelle', en: 'Which one', type: 'automatisation', obligatoire: true, saisie: (d) => ({ valeur: d.reglePubliee.id, affiche: d.reglePubliee.nom }) },
    ],
  },
  {
    id: 'ACT-21', cle: 'arreter_automatisation', fr: 'Arrêter une automatisation', en: 'Stop an automation',
    aide_fr: 'Sort le client des parcours en cours.', aide_en: 'Takes the client out of running journeys.',
    famille_fr: 'Technique', famille_en: 'Technical', declencheur: 'lead.created',
    champs: [
      { id: 'CHA-40', cle: 'portee', fr: 'Laquelle', en: 'Which one', type: 'choix', obligatoire: false, saisie: () => ({ valeur: 'toutes', affiche: 'Toutes' }) },
    ],
  },
];

/** Les actions qu'on peut réellement ajouter (tout sauf Slack, annoncée « Bientôt »). */
export const ACTIONS_DISPONIBLES = ACTIONS_ATTENDUES.filter((a) => !a.indisponible);

/** Les étiquettes d'ID d'une action et de ses champs, pour le titre d'un test. */
export function idsDe(a: ActionAttendue): string {
  return `[${a.id}]${a.champs.map((c) => `[${c.id}]`).join('')}`;
}

/** Les options de menu attendues, par champ (clé enregistrée → libellé FR / EN), option vide comprise. */
/**
 * `vide` : le libellé attendu de l'option vide quand la carte le fixe ;
 * `videTrompeur` : là où « vide » veut dire autre chose que « inchangé »
 * (toute l'équipe, celle-ci, aucun choix fait) — l'option ne doit pas dire « — Inchangé — ».
 */
export const OPTIONS_ATTENDUES: Record<string, { vide?: { fr: string; en: string }; videTrompeur?: boolean; options: Array<{ cle: string; fr: string; en: string }> }> = {
  'CHA-06': {
    vide: { fr: 'Automatique (selon l’usage)', en: 'Automatic (based on use)' },
    options: [
      { cle: 'transactionnel', fr: 'Transactionnel — part même si le client s’est désabonné', en: 'Transactional — sent even if the client unsubscribed' },
      { cle: 'marketing', fr: 'Marketing — pas envoyé à un client désabonné', en: 'Marketing — not sent to an unsubscribed client' },
    ],
  },
  'CHA-11': {
    videTrompeur: true,
    options: [
      { cle: 'proprietaire', fr: 'Le propriétaire', en: 'The owner' },
      { cle: 'responsable', fr: 'Le responsable du client', en: 'The client owner' },
      { cle: 'equipe_du_deal', fr: 'Le rep assigné + propriétaires et admins', en: 'Assigned rep + owners and admins' },
      { cle: 'membre', fr: 'Un membre précis', en: 'A specific member' },
    ],
  },
  'CHA-18': {
    vide: { fr: '— Inchangé —', en: '— Unchanged —' },
    options: [
      { cle: 'lead', fr: 'Prospect', en: 'Lead' },
      { cle: 'active', fr: 'Client actif', en: 'Active client' },
      { cle: 'inactive', fr: 'Inactif', en: 'Inactive' },
    ],
  },
  'CHA-28': {
    videTrompeur: true,
    options: [
      { cle: 'low', fr: 'Basse', en: 'Low' },
      { cle: 'medium', fr: 'Moyenne', en: 'Medium' },
      { cle: 'high', fr: 'Haute', en: 'High' },
    ],
  },
  'CHA-31': {
    videTrompeur: true,
    options: [
      { cle: 'scheduled', fr: 'Planifié', en: 'Scheduled' },
      { cle: 'completed', fr: 'Terminé', en: 'Completed' },
      { cle: 'cancelled', fr: 'Annulé', en: 'Cancelled' },
    ],
  },
  'CHA-32': {
    videTrompeur: true,
    options: [
      { cle: 'etape', fr: 'Une étape précise', en: 'A specific stage' },
      { cle: 'role_envoyee', fr: 'L’étape « Soumission envoyée »', en: 'The “Quote sent” stage' },
      { cle: 'role', fr: 'L’étape « Soumission ouverte » (depuis « Soumission envoyée »)', en: 'The “Quote opened” stage (from “Quote sent”)' },
      { cle: 'gagne', fr: 'L’étape « Gagné »', en: 'The “Won” stage' },
    ],
  },
  'CHA-40': {
    videTrompeur: true,
    options: [
      { cle: 'courante', fr: 'Celle-ci', en: 'This one' },
      { cle: 'toutes', fr: 'Toutes', en: 'All of them' },
    ],
  },
};
