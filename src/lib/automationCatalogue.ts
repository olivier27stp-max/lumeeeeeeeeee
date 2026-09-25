/* ═══════════════════════════════════════════════════════════════
   Catalogue des automatisations personnalisables

   Ce que l'utilisateur a le droit de choisir quand il crée sa propre
   automatisation : les déclencheurs, les actions, et les champs de
   chacune.

   POURQUOI UNE LISTE COURTE. Le moteur sait recevoir 29 types
   d'événements (`eventBus.ts`) et exécuter 8 types d'actions
   (`actions/index.ts`). Tous ne sont pas offerts ici :

   · certains déclencheurs sont DÉCLARÉS mais jamais émis
     (`lead.updated`, `client.archived`, `invoice.created`…) — les
     proposer donnerait une automatisation qui ne part jamais, sans que
     personne comprenne pourquoi ;
   · `log_activity` est une écriture interne du moteur, pas une action
     que quelqu'un choisit ;
   · `send_notification` est un alias de `create_notification` — offrir
     les deux ne ferait qu'embrouiller.

   C'est la friction n°1 relevée chez GoHighLevel : 90 déclencheurs à
   plat, où un paysagiste se noie. On en offre 16, tous vérifiés comme
   réellement émis, tous nommés dans les mots du métier.

   CE CATALOGUE EST LA SOURCE DE VÉRITÉ. La validation serveur
   (`server/lib/validation.ts`) et l'interface en dérivent toutes les
   deux : un déclencheur absent d'ici est refusé à l'enregistrement.

   Il vit sous `src/lib/` parce que `src/` n'a pas le droit d'importer
   `server/` (`tests/frontiere-serveur-client.test.ts`) — le partage se
   fait donc dans l'autre sens, comme `src/lib/permissions.ts` que le
   serveur importe déjà. `tests/automatisations-catalogue.test.ts` vérifie
   que chaque clé existe bien dans `CRMEventType` et dans le dispatch des
   actions, pour que la liste ne puisse pas dériver du moteur.
   ═══════════════════════════════════════════════════════════════ */

// ── Déclencheurs ────────────────────────────────────────────

export interface DeclencheurCatalogue {
  /** Le `trigger_event` stocké en base. */
  cle: string;
  fr: string;
  en: string;
  /** Ce qui déclenche vraiment, en une phrase — affiché sous le nom. */
  aide_fr: string;
  aide_en: string;
  /** Regroupement dans le sélecteur. */
  famille: 'devis' | 'facture' | 'rendezvous' | 'job' | 'client' | 'vente';
  /**
   * L'entité que les variables du message décriront (`[client_name]`,
   * `[invoice_total]`…). Sert à proposer les bonnes variables.
   */
  entite: 'quote' | 'invoice' | 'appointment' | 'job' | 'lead' | 'deal' | 'agreement';
  /**
   * Un délai négatif a-t-il un sens ? Seuls les événements qui portent une
   * date FUTURE permettent « 2 jours AVANT » (`resolveExecuteAt` dans
   * automationEngine.ts ne sait le faire que pour les rendez-vous).
   */
  accepte_delai_negatif?: boolean;
}

/**
 * Les 17 déclencheurs offerts. Chacun a été vérifié comme réellement émis
 * par le serveur — voir la cartographie du 2026-09-23.
 */
export const DECLENCHEURS: DeclencheurCatalogue[] = [
  // ── Devis ──
  {
    cle: 'quote.sent', fr: 'Soumission envoyée', en: 'Quote sent',
    aide_fr: 'Quand une soumission part chez le client.',
    aide_en: 'When a quote is sent to the client.',
    famille: 'devis', entite: 'quote',
  },
  {
    cle: 'quote.approved', fr: 'Soumission acceptée', en: 'Quote approved',
    aide_fr: 'Quand le client accepte la soumission.',
    aide_en: 'When the client approves the quote.',
    famille: 'devis', entite: 'quote',
  },
  {
    cle: 'quote.declined', fr: 'Soumission refusée', en: 'Quote declined',
    aide_fr: 'Quand le client refuse la soumission.',
    aide_en: 'When the client declines the quote.',
    famille: 'devis', entite: 'quote',
  },
  {
    cle: 'quote.changes_requested', fr: 'Modifications demandées', en: 'Changes requested',
    aide_fr: 'Quand le client demande de modifier la soumission.',
    aide_en: 'When the client asks for changes to the quote.',
    famille: 'devis', entite: 'quote',
  },

  // ── Factures ──
  {
    cle: 'invoice.sent', fr: 'Facture envoyée', en: 'Invoice sent',
    aide_fr: 'Quand une facture part chez le client.',
    aide_en: 'When an invoice is sent to the client.',
    famille: 'facture', entite: 'invoice',
  },
  {
    cle: 'invoice.paid', fr: 'Facture payée', en: 'Invoice paid',
    aide_fr: 'Quand le paiement d\'une facture est encaissé.',
    aide_en: 'When an invoice payment is received.',
    famille: 'facture', entite: 'invoice',
  },
  {
    cle: 'invoice.overdue', fr: 'Facture en retard', en: 'Invoice overdue',
    aide_fr: 'Quand une facture dépasse sa date d\'échéance.',
    aide_en: 'When an invoice passes its due date.',
    famille: 'facture', entite: 'invoice',
  },

  // ── Rendez-vous ──
  {
    cle: 'appointment.created', fr: 'Rendez-vous planifié', en: 'Appointment scheduled',
    aide_fr: 'Quand une visite est mise à l\'horaire. Permet aussi d\'envoyer AVANT le rendez-vous.',
    aide_en: 'When a visit is scheduled. Also allows sending BEFORE the appointment.',
    famille: 'rendezvous', entite: 'appointment', accepte_delai_negatif: true,
  },
  {
    cle: 'appointment.cancelled', fr: 'Rendez-vous annulé', en: 'Appointment cancelled',
    aide_fr: 'Quand une visite est annulée.',
    aide_en: 'When a visit is cancelled.',
    famille: 'rendezvous', entite: 'appointment',
  },

  // ── Jobs ──
  {
    cle: 'job.completed', fr: 'Job terminé', en: 'Job completed',
    aide_fr: 'Quand un job est marqué terminé sur le terrain.',
    aide_en: 'When a job is marked complete in the field.',
    famille: 'job', entite: 'job',
  },
  {
    cle: 'job.ready_for_invoicing', fr: 'Job prêt à facturer', en: 'Job ready to invoice',
    aide_fr: 'Quand un job terminé attend sa facture.',
    aide_en: 'When a completed job is waiting to be invoiced.',
    famille: 'job', entite: 'job',
  },

  // ── Clients et prospects ──
  {
    cle: 'lead.created', fr: 'Nouveau prospect', en: 'New lead',
    aide_fr: 'Quand un prospect entre — formulaire web, appel, saisie manuelle.',
    aide_en: 'When a lead comes in — web form, call, manual entry.',
    famille: 'client', entite: 'lead',
  },
  {
    cle: 'lead.status_changed', fr: 'Statut du prospect changé', en: 'Lead status changed',
    aide_fr: 'Quand un prospect change d\'étape.',
    aide_en: 'When a lead moves to another status.',
    famille: 'client', entite: 'lead',
  },
  {
    cle: 'agreement.signed', fr: 'Contrat signé', en: 'Agreement signed',
    aide_fr: 'Quand le client signe un contrat.',
    aide_en: 'When the client signs an agreement.',
    famille: 'client', entite: 'agreement',
  },

  // ── Pipeline de ventes ──
  {
    cle: 'deal.stage_entered', fr: 'Opportunité entre dans une étape', en: 'Deal enters a stage',
    aide_fr: 'Quand une opportunité arrive dans une étape du pipeline.',
    aide_en: 'When a deal moves into a pipeline stage.',
    famille: 'vente', entite: 'deal',
  },
  {
    cle: 'deal.stage_idle', fr: 'Opportunité qui dort', en: 'Deal going stale',
    aide_fr: 'Quand une opportunité stagne trop longtemps dans son étape.',
    aide_en: 'When a deal sits too long in its stage.',
    famille: 'vente', entite: 'deal',
  },

  // ── Champs personnalisés ──
  // Émis par customFieldsService (server/lib/champs/service.ts) quand une
  // valeur change VRAIMENT — jamais sur un rejeu identique, jamais pour une
  // écriture faite par une automatisation (pas de boucle). Le champ visé se
  // choisit dans le builder et devient la condition {field_id: {eq}}.
  {
    cle: 'custom_field.changed', fr: 'Champ personnalisé modifié', en: 'Custom field changed',
    aide_fr: 'Quand la valeur d’un champ personnalisé change sur une fiche.',
    aide_en: 'When a custom field value changes on a record.',
    famille: 'client', entite: 'lead',
  },
];

export const CLES_DECLENCHEURS = DECLENCHEURS.map((d) => d.cle);

export function trouverDeclencheur(cle: string): DeclencheurCatalogue | undefined {
  return DECLENCHEURS.find((d) => d.cle === cle);
}

// ── Actions ─────────────────────────────────────────────────

export interface ActionCatalogue {
  cle: 'send_sms' | 'send_email' | 'create_notification' | 'create_task' | 'request_review' | 'update_custom_field';
  fr: string;
  en: string;
  aide_fr: string;
  aide_en: string;
  /** Le message part-il chez le CLIENT ? Décide des gardes de consentement. */
  vers_client: boolean;
  /** Champs que l'utilisateur remplit. */
  champs: Array<{
    cle: 'body' | 'subject' | 'title' | 'field_id' | 'value';
    fr: string;
    en: string;
    obligatoire: boolean;
    /** Longueur max — un SMS trop long coûte plusieurs segments. */
    max: number;
    multiligne: boolean;
  }>;
}

/**
 * Les 6 actions offertes.
 *
 * Absentes volontairement : `log_activity` (écriture interne du moteur),
 * `send_notification` (alias de `create_notification`), `update_status` et
 * `move_deal_stage` (agissent sur les données — réservées aux préréglages
 * tant qu'il n'y a pas de garde dédiée).
 *
 * AUCUNE action ne laisse choisir le destinataire : voir `DESTINATAIRE_IMPOSE`
 * dans `actions/index.ts`. Le client visé est toujours celui de l'entité.
 */
export const ACTIONS: ActionCatalogue[] = [
  {
    cle: 'send_sms', fr: 'Envoyer un texto', en: 'Send a text message',
    aide_fr: 'Part au téléphone du client. Jamais entre 20 h et 8 h.',
    aide_en: 'Goes to the client\'s phone. Never between 8 p.m. and 8 a.m.',
    vers_client: true,
    champs: [
      { cle: 'body', fr: 'Texte du message', en: 'Message text', obligatoire: true, max: 1600, multiligne: true },
    ],
  },
  {
    cle: 'send_email', fr: 'Envoyer un courriel', en: 'Send an email',
    aide_fr: 'Part à l\'adresse du client, au nom de l\'entreprise.',
    aide_en: 'Goes to the client\'s address, from the company.',
    vers_client: true,
    champs: [
      { cle: 'subject', fr: 'Objet', en: 'Subject', obligatoire: true, max: 200, multiligne: false },
      { cle: 'body', fr: 'Message', en: 'Message', obligatoire: true, max: 10000, multiligne: true },
    ],
  },
  {
    cle: 'create_notification', fr: 'Me notifier dans Lume', en: 'Notify me in Lume',
    aide_fr: 'Reste à l\'interne. Le client ne voit rien.',
    aide_en: 'Stays internal. The client sees nothing.',
    vers_client: false,
    champs: [
      { cle: 'title', fr: 'Titre', en: 'Title', obligatoire: true, max: 200, multiligne: false },
      { cle: 'body', fr: 'Détail', en: 'Details', obligatoire: false, max: 2000, multiligne: true },
    ],
  },
  {
    cle: 'create_task', fr: 'Créer une tâche', en: 'Create a task',
    aide_fr: 'Ajoute une tâche à faire dans Lume. Reste à l\'interne.',
    aide_en: 'Adds a to-do in Lume. Stays internal.',
    vers_client: false,
    champs: [
      { cle: 'title', fr: 'Titre de la tâche', en: 'Task title', obligatoire: true, max: 200, multiligne: false },
      { cle: 'body', fr: 'Détail', en: 'Details', obligatoire: false, max: 2000, multiligne: true },
    ],
  },
  {
    cle: 'request_review', fr: 'Demander un avis', en: 'Ask for a review',
    aide_fr: 'Envoie au client le lien pour laisser un avis.',
    aide_en: 'Sends the client a link to leave a review.',
    vers_client: true,
    champs: [
      { cle: 'body', fr: 'Texte du message', en: 'Message text', obligatoire: true, max: 1600, multiligne: true },
    ],
  },
  {
    // Garde dédiée (server/lib/champs/automatisations.ts) : n'écrit que sur
    // l'entité de l'événement, et seulement un champ de SON objet.
    cle: 'update_custom_field', fr: 'Mettre à jour un champ personnalisé', en: 'Update a custom field',
    aide_fr: 'Écrit une valeur dans un champ de la fiche concernée. Reste à l’interne.',
    aide_en: 'Writes a value into a field of the record concerned. Stays internal.',
    vers_client: false,
    champs: [
      { cle: 'field_id', fr: 'Champ', en: 'Field', obligatoire: true, max: 36, multiligne: false },
      { cle: 'value', fr: 'Nouvelle valeur (vide = effacer)', en: 'New value (empty = clear)', obligatoire: false, max: 5000, multiligne: false },
    ],
  },
];

export const CLES_ACTIONS = ACTIONS.map((a) => a.cle);

export function trouverAction(cle: string): ActionCatalogue | undefined {
  return ACTIONS.find((a) => a.cle === cle);
}

// ── Délais ──────────────────────────────────────────────────

/**
 * Un an, en secondes. Plafond du délai : au-delà, une tâche resterait en file
 * plus longtemps que la durée de vie utile de l'entité, et le message perdrait
 * tout sens ("votre soumission d'il y a 2 ans").
 */
export const DELAI_MAX_SECONDES = 366 * 24 * 3600;

/** Plafond du délai négatif : 30 jours avant le rendez-vous. */
export const DELAI_NEGATIF_MAX_SECONDES = 30 * 24 * 3600;

/** Nombre d'actions par automatisation — au-delà, c'est une séquence. */
export const ACTIONS_MAX = 5;

// ── Conditions ──────────────────────────────────────────────

/**
 * Opérateurs que `evaluateConditions` sait évaluer (`automationEngine.ts`).
 *
 * ATTENTION : un opérateur absent de cette liste fait échouer la règle
 * ENTIÈRE côté moteur, silencieusement. C'est pourquoi la validation refuse
 * tout ce qui n'est pas ici, au lieu de laisser passer et de produire une
 * automatisation qui ne part jamais.
 */
export const OPERATEURS_CONDITIONS = ['eq', 'neq', 'in', 'not_in'] as const;
export type OperateurCondition = typeof OPERATEURS_CONDITIONS[number];
