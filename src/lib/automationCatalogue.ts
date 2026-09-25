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
  /**
   * Déclaré au bus mais AUCUN code ne l'émet encore.
   *
   * Une automatisation posée dessus ne partirait jamais — et c'est le pire
   * des échecs : silencieux. L'interface le grise et dit pourquoi, au lieu
   * de laisser quelqu'un bâtir un parcours mort.
   */
  bientot?: boolean;
  /**
   * Les réglages du DÉCLENCHEUR lui-même, stockés dans `conditions`.
   *
   * La plupart des déclencheurs n'en ont pas : « facture payée » se suffit
   * à elle-même. Mais « date atteinte » ne veut rien dire sans savoir QUELLE
   * date surveiller ni combien de jours avant — sans ces deux réponses, le
   * balayage quotidien passe son chemin et l'automatisation ne part jamais,
   * en silence.
   *
   * Même modèle que les champs d'action (`ChampAction`), donc le même
   * composant les affiche et la même validation les contrôle.
   */
  champs?: ChampAction[];
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
    cle: 'client.replied', fr: 'Le client répond', en: 'Client replies',
    aide_fr: 'Quand un client répond par texto à un message de l’entreprise.',
    aide_en: 'When a client texts back after a message from the company.',
    famille: 'client', entite: 'lead',
  },
  {
    cle: 'client.tagged', fr: 'Étiquette ajoutée', en: 'Tag added',
    aide_fr: 'Quand une étiquette est posée sur un client — le passage de relais manuel.',
    aide_en: 'When a tag is added to a client — the manual handoff.',
    famille: 'client', entite: 'lead',
  },
  {
    cle: 'agreement.signed', fr: 'Contrat signé', en: 'Agreement signed',
    aide_fr: 'Quand le client signe un contrat.',
    aide_en: 'When the client signs an agreement.',
    famille: 'client', entite: 'agreement',
  },

  // ── Travail ──
  {
    cle: 'task.completed', fr: 'Tâche terminée', en: 'Task completed',
    aide_fr: 'Quand une tâche liée à un client est marquée terminée.',
    aide_en: 'When a task linked to a client is marked done.',
    famille: 'job', entite: 'lead',
  },

  {
    cle: 'note.added', fr: 'Note ajoutée', en: 'Note added',
    aide_fr: 'Quand quelqu’un écrit une note sur un client ou un job.',
    aide_en: 'When someone writes a note on a client or a job.',
    famille: 'client', entite: 'lead',
  },

  {
    cle: 'date.reached', fr: 'Date atteinte', en: 'Date reached',
    aide_fr: 'Quand une date d’un champ personnalisé arrive — fin de contrat, garantie, entretien annuel.',
    aide_en: 'When a date from a custom field arrives — contract end, warranty, yearly service.',
    famille: 'client', entite: 'lead',
    /*
     * Les deux réponses sans lesquelles le balayage quotidien
     * (`server/lib/rappels-dates.ts`) ne peut rien faire : QUELLE date
     * surveiller, et combien de jours avant. Elles vivent dans
     * `conditions`, que le balayage relit à chaque passage.
     *
     * `champ_id` est OBLIGATOIRE : sans lui la règle ne partirait jamais,
     * en silence. `problemesAvantPublication()` refuse donc de publier.
     */
    champs: [
      {
        cle: 'champ_id', fr: 'Quelle date surveiller', en: 'Which date to watch',
        obligatoire: true, type: 'champ_date',
        aide_fr: 'Un champ date de la fiche client — fin de contrat, garantie, entretien annuel.',
        aide_en: 'A date field on the client record — contract end, warranty, yearly service.',
      },
      {
        cle: 'jours_avant', fr: 'Combien de jours avant', en: 'How many days before',
        obligatoire: false, type: 'nombre', min_valeur: -365, max_valeur: 365,
        aide_fr: '7 = une semaine avant la date. 0 = le jour même. -7 = une semaine après.',
        aide_en: '7 = one week before the date. 0 = on the day. -7 = one week after.',
      },
    ],
  },

  // ── Pipeline de ventes ──
  {
    cle: 'deal.stage_entered', fr: 'Opportunité entre dans une étape', en: 'Deal enters a stage',
    aide_fr: 'Quand une opportunité arrive dans une étape du pipeline.',
    aide_en: 'When a deal moves into a pipeline stage.',
    famille: 'vente', entite: 'deal',
    /*
     * BRANCHÉ. Vérifié en production le 2026-09-25 : 34 événements
     * `deal.stage_entered` déjà émis et traités. La chaîne complète est
     * en place — un trigger SQL remplit `pipeline_events`, le
     * planificateur appelle `traiterEvenementsPipeline`, et le moteur
     * résout le client d'une opportunité (`automationEngine.ts:1328`).
     *
     * Le marqueur `bientot` posé ici était une ERREUR de ma part : je
     * l'avais déduit du code au lieu de regarder la base.
     */
  },
  {
    cle: 'deal.stage_idle', fr: 'Opportunité qui dort', en: 'Deal going stale',
    aide_fr: 'Quand une opportunité stagne trop longtemps dans son étape.',
    aide_en: 'When a deal sits too long in its stage.',
    famille: 'vente', entite: 'deal',
    // BRANCHÉ : `pipeline_detecter_stagnation()` (présente en prod,
    // vérifiée le 2026-09-25) remplit la file, que le planificateur vide.
    // Aucun événement en prod à ce jour, simplement parce qu'aucune
    // opportunité n'a encore stagné assez longtemps.
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

/**
 * Les familles de déclencheurs, dans l'ordre d'affichage du tiroir.
 *
 * Ici et pas dans un composant : le tiroir « Ajouter un déclencheur » et
 * l'ancien formulaire s'en servent tous les deux, et deux listes qui
 * divergent afficheraient des groupes différents selon l'écran.
 */
export const FAMILLES_DECLENCHEURS: Array<{ cle: string; fr: string; en: string }> = [
  { cle: 'devis', fr: 'Soumissions', en: 'Quotes' },
  { cle: 'facture', fr: 'Factures', en: 'Invoices' },
  { cle: 'rendezvous', fr: 'Rendez-vous', en: 'Appointments' },
  { cle: 'job', fr: 'Jobs', en: 'Jobs' },
  { cle: 'client', fr: 'Clients et prospects', en: 'Clients and leads' },
  { cle: 'vente', fr: 'Pipeline de ventes', en: 'Sales pipeline' },
];

export function trouverDeclencheur(cle: string): DeclencheurCatalogue | undefined {
  return DECLENCHEURS.find((d) => d.cle === cle);
}

// ── Actions ─────────────────────────────────────────────────

/**
 * Le type d'un champ de configuration — ce qui décide du contrôle affiché
 * dans le panneau d'édition.
 *
 * `texte` / `zone` sont les deux seuls qui acceptent des variables
 * (`[client_name]`). Les autres portent une valeur fermée, choisie dans une
 * liste ou cochée : y interpoler une variable donnerait une valeur que le
 * serveur ne saurait pas valider.
 */
export type TypeChamp =
  | 'texte'
  | 'zone'
  | 'choix'
  | 'nombre'
  | 'bascule'
  | 'membre'
  | 'etiquette'
  | 'url'
  /**
   * Un champ personnalisé de type DATE, sur la fiche client.
   *
   * La liste vient de l'organisation (`custom_fields`, object_type
   * « client », field_type « date »), pas d'une constante : chaque
   * entreprise a les siens — fin de contrat, garantie, entretien annuel.
   */
  | 'champ_date'
  /**
   * Une AUTRE automatisation de l'organisation.
   *
   * La liste vient du serveur : les règles publiées, moins celle qu'on est
   * en train d'éditer (une règle qui se démarre elle-même boucle).
   */
  | 'automatisation';

export interface ChampAction {
  cle: string;
  fr: string;
  en: string;
  obligatoire: boolean;
  type: TypeChamp;
  /** Longueur max pour les champs texte. Un SMS trop long coûte des segments. */
  max?: number;
  /** Bornes pour `nombre`. */
  min_valeur?: number;
  max_valeur?: number;
  /** Options d'un `choix`. La valeur stockée est `cle`. */
  options?: Array<{ cle: string; fr: string; en: string }>;
  /** Aide sous le champ — la phrase qui évite une question au support. */
  aide_fr?: string;
  aide_en?: string;
  /**
   * N'afficher ce champ que si un autre porte l'une de ces valeurs.
   * Reproduit les champs conditionnels de GHL (« Remove all tags » qui
   * désactive le sélecteur d'étiquettes).
   */
  visible_si?: { champ: string; valeurs: string[] };
}

/** Le regroupement des actions dans le sélecteur, comme les sections de GHL. */
export type FamilleAction = 'communication' | 'client' | 'travail' | 'vente' | 'argent' | 'technique';

export interface ActionCatalogue {
  cle: string;
  fr: string;
  en: string;
  aide_fr: string;
  aide_en: string;
  famille: FamilleAction;
  /** Le message part-il chez le CLIENT ? Décide des gardes de consentement. */
  vers_client: boolean;
  /**
   * L'action ÉCRIT-elle dans les données (statut, étiquette, assignation) ?
   * Ces actions-là sont exclues des règles simples tant qu'elles n'ont pas
   * été confirmées dans un parcours — une écriture qui part en rafale sur
   * 200 clients ne se rattrape pas.
   */
  ecriture?: boolean;
  /**
   * Les entités sur lesquelles cette action SAIT travailler.
   *
   * Absent = elle marche partout (les actions « client » remontent toujours
   * à une fiche client, quelle que soit l'entité de départ).
   *
   * Présent = le serveur REFUSE les autres (`ctx.entityType !== 'deal'`…).
   * Le déclarer ici permet à l'interface de ne pas proposer « changer le
   * statut du rendez-vous » sur « facture payée » : sinon l'utilisateur
   * publie, et découvre l'échec dans un journal, trois essais plus tard.
   */
  entites?: string[];
  champs: ChampAction[];
}

/** Les rôles de destinataire d'une notification interne. */
const DESTINATAIRES_NOTIF = [
  { cle: 'proprietaire', fr: 'Le propriétaire', en: 'The owner' },
  { cle: 'responsable', fr: 'Le responsable du client', en: 'The client owner' },
  { cle: 'membre', fr: 'Un membre précis', en: 'A specific member' },
];

/**
 * Les 18 actions offertes.
 *
 * CHAQUE CHAMP EST EXÉCUTÉ. Un champ n'entre dans cette liste que si
 * `server/lib/actions/index.ts` sait le lire : un champ décoratif fait
 * promettre à l'interface ce que le moteur ne fait pas, et c'est exactement
 * le reproche fait au menu de GoHighLevel, où des options grisées côtoient
 * des options mortes.
 *
 * Absentes volontairement : `log_activity` (écriture interne du moteur),
 * `send_notification` (alias de `create_notification`).
 *
 * AUCUNE action ne laisse choisir le destinataire d'un message CLIENT : voir
 * `DESTINATAIRE_IMPOSE` dans `actions/index.ts`. Le client visé est toujours
 * celui de l'entité. Les notifications INTERNES, elles, choisissent parmi
 * les membres de l'org — jamais une adresse libre.
 */
export const ACTIONS: ActionCatalogue[] = [
  // ══ Communication ══════════════════════════════════════════
  {
    cle: 'send_email', fr: 'Envoyer un courriel', en: 'Send an email',
    aide_fr: 'Part à l’adresse du client, au nom de l’entreprise.',
    aide_en: 'Goes to the client’s address, from the company.',
    famille: 'communication', vers_client: true,
    champs: [
      {
        cle: 'from_name', fr: 'Nom de l’expéditeur', en: 'From name',
        obligatoire: false, type: 'texte', max: 100,
        aide_fr: 'Vide = le nom de votre entreprise.',
        aide_en: 'Empty = your company name.',
      },
      {
        cle: 'reply_to', fr: 'Répondre à', en: 'Reply to',
        obligatoire: false, type: 'texte', max: 200,
        aide_fr: 'Vide = l’adresse de votre entreprise.',
        aide_en: 'Empty = your company address.',
      },
      { cle: 'subject', fr: 'Objet', en: 'Subject', obligatoire: true, type: 'texte', max: 200 },
      {
        cle: 'preheader', fr: 'Aperçu', en: 'Preview text',
        obligatoire: false, type: 'texte', max: 200,
        aide_fr: 'La ligne affichée après l’objet dans la boîte de réception.',
        aide_en: 'The line shown after the subject in the inbox.',
      },
      { cle: 'body', fr: 'Message', en: 'Message', obligatoire: true, type: 'zone', max: 10000 },
    ],
  },
  {
    cle: 'send_sms', fr: 'Envoyer un texto', en: 'Send a text message',
    aide_fr: 'Part au téléphone du client. Jamais entre 20 h et 8 h.',
    aide_en: 'Goes to the client’s phone. Never between 8 p.m. and 8 a.m.',
    famille: 'communication', vers_client: true,
    champs: [
      { cle: 'body', fr: 'Texte du message', en: 'Message text', obligatoire: true, type: 'zone', max: 1600 },
    ],
  },
  {
    cle: 'create_notification', fr: 'Notifier l’équipe', en: 'Notify the team',
    aide_fr: 'Reste à l’interne. Le client ne voit rien.',
    aide_en: 'Stays internal. The client sees nothing.',
    famille: 'communication', vers_client: false,
    champs: [
      { cle: 'title', fr: 'Titre', en: 'Title', obligatoire: true, type: 'texte', max: 200 },
      { cle: 'body', fr: 'Détail', en: 'Details', obligatoire: false, type: 'zone', max: 2000 },
      {
        cle: 'destinataire', fr: 'Pour qui', en: 'For whom',
        obligatoire: false, type: 'choix', options: DESTINATAIRES_NOTIF,
        aide_fr: 'Vide = le propriétaire.',
        aide_en: 'Empty = the owner.',
      },
      {
        cle: 'membre_id', fr: 'Le membre', en: 'The member',
        obligatoire: false, type: 'membre',
        visible_si: { champ: 'destinataire', valeurs: ['membre'] },
      },
    ],
  },
  {
    cle: 'request_review', fr: 'Demander un avis', en: 'Ask for a review',
    aide_fr: 'Envoie au client le lien pour laisser un avis.',
    aide_en: 'Sends the client a link to leave a review.',
    famille: 'communication', vers_client: true,
    champs: [
      { cle: 'body', fr: 'Texte du message', en: 'Message text', obligatoire: true, type: 'zone', max: 1600 },
    ],
  },
  {
    cle: 'envoyer_slack', fr: 'Envoyer dans Slack', en: 'Send to Slack',
    aide_fr: 'Publie dans le canal Slack de votre entreprise.',
    aide_en: 'Posts to your company’s Slack channel.',
    famille: 'communication', vers_client: false,
    champs: [
      { cle: 'body', fr: 'Message', en: 'Message', obligatoire: true, type: 'zone', max: 3000 },
    ],
  },

  // ══ Client ═════════════════════════════════════════════════
  {
    cle: 'ajouter_etiquette', fr: 'Ajouter une étiquette', en: 'Add a tag',
    aide_fr: 'Marque le client, pour le retrouver ou déclencher autre chose.',
    aide_en: 'Marks the client, to find them later or trigger something else.',
    famille: 'client', vers_client: false, ecriture: true,
    champs: [
      { cle: 'etiquette', fr: 'L’étiquette', en: 'The tag', obligatoire: true, type: 'etiquette', max: 60 },
    ],
  },
  {
    cle: 'retirer_etiquette', fr: 'Retirer une étiquette', en: 'Remove a tag',
    aide_fr: 'Enlève une étiquette du client, ou toutes.',
    aide_en: 'Removes a tag from the client, or all of them.',
    famille: 'client', vers_client: false, ecriture: true,
    champs: [
      {
        cle: 'toutes', fr: 'Retirer toutes les étiquettes', en: 'Remove all tags',
        obligatoire: false, type: 'bascule',
      },
      {
        cle: 'etiquette', fr: 'L’étiquette', en: 'The tag',
        obligatoire: false, type: 'etiquette', max: 60,
        visible_si: { champ: 'toutes', valeurs: ['', 'false'] },
      },
    ],
  },
  {
    cle: 'modifier_client', fr: 'Modifier le client', en: 'Update the client',
    aide_fr: 'Change le statut, la source ou la valeur estimée.',
    aide_en: 'Changes the status, source or estimated value.',
    famille: 'client', vers_client: false, ecriture: true,
    champs: [
      {
        cle: 'statut', fr: 'Statut', en: 'Status',
        obligatoire: false, type: 'choix',
        options: [
          { cle: 'lead', fr: 'Prospect', en: 'Lead' },
          { cle: 'active', fr: 'Client actif', en: 'Active client' },
          { cle: 'inactive', fr: 'Inactif', en: 'Inactive' },
        ],
        aide_fr: 'Vide = inchangé.',
        aide_en: 'Empty = unchanged.',
      },
      {
        cle: 'source', fr: 'Source', en: 'Source',
        obligatoire: false, type: 'texte', max: 60,
        aide_fr: 'D’où vient ce client. Vide = inchangé.',
        aide_en: 'Where this client came from. Empty = unchanged.',
      },
      {
        cle: 'valeur', fr: 'Valeur estimée ($)', en: 'Estimated value ($)',
        obligatoire: false, type: 'nombre', min_valeur: 0, max_valeur: 10000000,
        aide_fr: 'Vide = inchangée.',
        aide_en: 'Empty = unchanged.',
      },
    ],
  },
  {
    cle: 'assigner_responsable', fr: 'Assigner un responsable', en: 'Assign an owner',
    aide_fr: 'Donne le client à un membre de l’équipe.',
    aide_en: 'Gives the client to a team member.',
    famille: 'client', vers_client: false, ecriture: true,
    champs: [
      {
        cle: 'membre_id', fr: 'Le membre', en: 'The member',
        obligatoire: false, type: 'membre',
        aide_fr: 'Vide = retire le responsable actuel.',
        aide_en: 'Empty = removes the current owner.',
      },
      {
        cle: 'seulement_si_vide', fr: 'Seulement si personne n’est assigné', en: 'Only if unassigned',
        obligatoire: false, type: 'bascule',
      },
    ],
  },
  {
    cle: 'ajouter_note', fr: 'Ajouter une note', en: 'Add a note',
    aide_fr: 'Écrit une note dans la fiche du client.',
    aide_en: 'Writes a note on the client record.',
    famille: 'client', vers_client: false, ecriture: true,
    champs: [
      { cle: 'body', fr: 'La note', en: 'The note', obligatoire: true, type: 'zone', max: 4000 },
    ],
  },

  // ══ Travail ════════════════════════════════════════════════
  {
    cle: 'create_task', fr: 'Créer une tâche', en: 'Create a task',
    aide_fr: 'Ajoute une tâche à faire dans Lume. Reste à l’interne.',
    aide_en: 'Adds a to-do in Lume. Stays internal.',
    famille: 'travail', vers_client: false,
    champs: [
      { cle: 'title', fr: 'Titre de la tâche', en: 'Task title', obligatoire: true, type: 'texte', max: 200 },
      { cle: 'body', fr: 'Détail', en: 'Details', obligatoire: false, type: 'zone', max: 2000 },
      {
        cle: 'priorite', fr: 'Priorité', en: 'Priority',
        obligatoire: false, type: 'choix',
        options: [
          { cle: 'low', fr: 'Basse', en: 'Low' },
          { cle: 'medium', fr: 'Moyenne', en: 'Medium' },
          { cle: 'high', fr: 'Haute', en: 'High' },
        ],
      },
      {
        cle: 'echeance_jours', fr: 'À faire dans (jours)', en: 'Due in (days)',
        obligatoire: false, type: 'nombre', min_valeur: 0, max_valeur: 365,
        aide_fr: 'Vide = pas d’échéance.',
        aide_en: 'Empty = no due date.',
      },
      { cle: 'membre_id', fr: 'Assignée à', en: 'Assigned to', obligatoire: false, type: 'membre' },
    ],
  },
  {
    cle: 'modifier_statut_rendezvous', fr: 'Changer le statut du rendez-vous', en: 'Change appointment status',
    aide_fr: 'Confirme, annule ou marque la visite comme faite.',
    aide_en: 'Confirms, cancels or marks the visit as done.',
    famille: 'travail', vers_client: false, ecriture: true,
    entites: ['schedule_event'],
    champs: [
      {
        cle: 'statut', fr: 'Nouveau statut', en: 'New status',
        obligatoire: true, type: 'choix',
        /*
         * TROIS statuts, pas les six de GoHighLevel.
         *
         * `schedule_events.status` ne porte AUCUNE contrainte CHECK : on
         * peut y écrire n'importe quoi, et c'est bien le danger. Seules
         * ces trois valeurs sont comprises par le produit —
         * `isClosedVisit()` (src/lib/scheduleApi.ts) reconnaît
         * « completed » et « cancelled », le reste s'affiche comme
         * planifié. Offrir « Confirmé » ou « Absent » comme chez eux
         * écrirait une valeur que RIEN ne lit : l'automatisation
         * réussirait et l'écran ne changerait pas.
         */
        options: [
          { cle: 'scheduled', fr: 'Planifié', en: 'Scheduled' },
          { cle: 'completed', fr: 'Terminé', en: 'Completed' },
          { cle: 'cancelled', fr: 'Annulé', en: 'Cancelled' },
        ],
      },
    ],
  },

  // ══ Ventes ═════════════════════════════════════════════════
  {
    cle: 'move_deal_stage', fr: 'Déplacer l’opportunité', en: 'Move the deal',
    aide_fr: 'Change l’étape de l’opportunité dans son pipeline.',
    aide_en: 'Moves the deal to another stage of its pipeline.',
    famille: 'vente', vers_client: false, ecriture: true,
    entites: ['deal'],
    champs: [
      { cle: 'stage_id', fr: 'L’étape visée', en: 'Target stage', obligatoire: true, type: 'texte', max: 40 },
    ],
  },
  {
    cle: 'modifier_deal', fr: 'Modifier l’opportunité', en: 'Update the deal',
    aide_fr: 'Change la source de l’opportunité.',
    aide_en: 'Changes the deal’s source.',
    famille: 'vente', vers_client: false, ecriture: true,
    entites: ['deal'],
    champs: [
      {
        cle: 'source', fr: 'Source', en: 'Source',
        obligatoire: false, type: 'texte', max: 60,
        aide_fr: 'Vide = inchangée.',
        aide_en: 'Empty = unchanged.',
      },
    ],
  },
  {
    cle: 'assigner_deal', fr: 'Assigner l’opportunité', en: 'Assign the deal',
    aide_fr: 'Donne l’opportunité à un membre de l’équipe.',
    aide_en: 'Gives the deal to a team member.',
    famille: 'vente', vers_client: false, ecriture: true,
    entites: ['deal'],
    champs: [
      {
        cle: 'membre_id', fr: 'Le membre', en: 'The member',
        obligatoire: false, type: 'membre',
        aide_fr: 'Vide = retire le responsable actuel.',
        aide_en: 'Empty = removes the current owner.',
      },
    ],
  },

  // ══ Argent ═════════════════════════════════════════════════
  {
    cle: 'envoyer_facture', fr: 'Envoyer la facture', en: 'Send the invoice',
    aide_fr: 'Envoie au client la facture liée, par courriel.',
    aide_en: 'Emails the linked invoice to the client.',
    famille: 'argent', vers_client: true,
    entites: ['invoice'],
    champs: [
      {
        cle: 'body', fr: 'Mot d’accompagnement', en: 'Cover note',
        obligatoire: false, type: 'zone', max: 2000,
        aide_fr: 'Vide = le texte habituel de vos factures.',
        aide_en: 'Empty = your usual invoice wording.',
      },
    ],
  },
  {
    cle: 'envoyer_soumission', fr: 'Envoyer la soumission', en: 'Send the quote',
    aide_fr: 'Envoie au client la soumission liée, par courriel.',
    aide_en: 'Emails the linked quote to the client.',
    famille: 'argent', vers_client: true,
    entites: ['quote'],
    champs: [
      {
        cle: 'body', fr: 'Mot d’accompagnement', en: 'Cover note',
        obligatoire: false, type: 'zone', max: 2000,
        aide_fr: 'Vide = le texte habituel de vos soumissions.',
        aide_en: 'Empty = your usual quote wording.',
      },
    ],
  },

  // ══ Technique ══════════════════════════════════════════════
  {
    cle: 'webhook', fr: 'Appeler un webhook', en: 'Call a webhook',
    aide_fr: 'Envoie les données de l’événement à une adresse externe.',
    aide_en: 'Posts the event data to an external address.',
    famille: 'technique', vers_client: false,
    champs: [
      {
        cle: 'url', fr: 'L’adresse', en: 'The address',
        obligatoire: true, type: 'url', max: 500,
        aide_fr: 'Doit commencer par https://',
        aide_en: 'Must start with https://',
      },
    ],
  },
  {
    cle: 'demarrer_automatisation', fr: 'Démarrer une automatisation', en: 'Start an automation',
    aide_fr: 'Fait entrer le client dans un autre parcours — celui-ci continue.',
    aide_en: 'Enrolls the client in another journey — this one carries on.',
    famille: 'technique', vers_client: false,
    champs: [
      {
        cle: 'rule_id', fr: 'Laquelle', en: 'Which one',
        obligatoire: true, type: 'automatisation',
        aide_fr: 'Seules les automatisations PUBLIÉES sont proposées : un brouillon n’enverrait rien.',
        aide_en: 'Only PUBLISHED automations are offered: a draft would send nothing.',
      },
    ],
  },
  {
    cle: 'arreter_automatisation', fr: 'Arrêter une automatisation', en: 'Stop an automation',
    aide_fr: 'Sort le client des parcours en cours.',
    aide_en: 'Takes the client out of running journeys.',
    famille: 'technique', vers_client: false,
    champs: [
      {
        cle: 'portee', fr: 'Laquelle', en: 'Which one',
        obligatoire: false, type: 'choix',
        options: [
          { cle: 'courante', fr: 'Celle-ci', en: 'This one' },
          { cle: 'toutes', fr: 'Toutes', en: 'All of them' },
        ],
        aide_fr: 'Vide = celle-ci.',
        aide_en: 'Empty = this one.',
      },
    ],
  },
  {
    // Garde dédiée (server/lib/champs/automatisations.ts) : n'écrit que sur
    // l'entité de l'événement, et seulement un champ de SON objet.
    cle: 'update_custom_field', fr: 'Mettre à jour un champ personnalisé', en: 'Update a custom field',
    aide_fr: 'Écrit une valeur dans un champ de la fiche concernée. Reste à l’interne.',
    aide_en: 'Writes a value into a field of the record concerned. Stays internal.',
    famille: 'client', vers_client: false, ecriture: true,
    champs: [
      { cle: 'field_id', fr: 'Champ', en: 'Field', obligatoire: true, type: 'texte', max: 36 },
      {
        cle: 'value', fr: 'Nouvelle valeur', en: 'New value',
        obligatoire: false, type: 'texte', max: 5000,
        aide_fr: 'Vide = effacer le champ.',
        aide_en: 'Empty = clear the field.',
      },
    ],
  },
];

export const CLES_ACTIONS = ACTIONS.map((a) => a.cle);

/**
 * L'entité que chaque déclencheur fait arriver au moteur.
 *
 * Relevé dans le serveur (les `emit('x.y', { entityType })`), pas deviné —
 * `tests/automatisations-coherence-declencheur-action.test.ts` compare cette
 * table au code et échoue si l'un des deux bouge.
 *
 * Deux surprises qui méritent d'être écrites : un RENDEZ-VOUS arrive comme
 * `schedule_event` (pas `appointment`), et un CONTRAT SIGNÉ arrive porté par
 * son job (`agreement.signed` émet `entityType: 'job'`).
 */
export const ENTITE_PAR_DECLENCHEUR: Record<string, string> = {
  'quote.sent': 'quote',
  'quote.approved': 'quote',
  'quote.declined': 'quote',
  'quote.changes_requested': 'quote',
  'invoice.sent': 'invoice',
  'invoice.paid': 'invoice',
  'invoice.overdue': 'invoice',
  'appointment.created': 'schedule_event',
  'appointment.cancelled': 'schedule_event',
  'job.completed': 'job',
  'job.ready_for_invoicing': 'job',
  'lead.created': 'lead',
  'lead.status_changed': 'lead',
  'agreement.signed': 'job',
  // L'objet du champ modifié : client, deal, job, quote ou invoice
  // (`server/lib/champs/service.ts`). Variable par nature — voir
  // `actionCompatible`.
  'custom_field.changed': '*',
  'client.replied': 'client',
  'client.tagged': 'client',
  'task.completed': 'client',
  'note.added': 'client',
  'date.reached': 'client',
  'deal.stage_entered': 'deal',
  'deal.stage_idle': 'deal',
};

/**
 * Cette action peut-elle suivre ce déclencheur ?
 *
 * C'est la question qui décide si un parcours marchera. « Envoyer la
 * facture » n'a aucun sens après « soumission envoyée » : l'entité qui
 * arrive est un devis, et le serveur refusera.
 *
 * Répondre AVANT la publication, dans le menu, plutôt qu'après, dans un
 * journal d'échec que personne ne lit.
 */
export function actionCompatible(action: ActionCatalogue, cleDeclencheur: string): boolean {
  if (!action.entites) return true;
  const entite = ENTITE_PAR_DECLENCHEUR[cleDeclencheur];
  // Déclencheur inconnu : on n'invente pas de refus, le serveur tranchera.
  if (!entite) return true;
  /*
   * `'*'` = l'entité dépend de la donnée, pas du déclencheur.
   *
   * « Champ personnalisé modifié » émet l'objet du champ : un client, un
   * deal, un job, un devis ou une facture. On ne peut donc rien exclure
   * d'avance — c'est le serveur qui tranchera à l'exécution, avec un
   * message clair. Interdire au catalogue priverait l'utilisateur d'actions
   * parfaitement valides selon le champ qu'il a choisi.
   */
  if (entite === '*') return true;
  return action.entites.includes(entite);
}

/** Les actions utilisables avec ce déclencheur, dans l'ordre du catalogue. */
export function actionsPour(cleDeclencheur: string): ActionCatalogue[] {
  return ACTIONS.filter((a) => actionCompatible(a, cleDeclencheur));
}

export function trouverAction(cle: string): ActionCatalogue | undefined {
  return ACTIONS.find((a) => a.cle === cle);
}

/** Toutes les clés de champ connues, tous types d'action confondus. */
export const CLES_CHAMPS_ACTION = Array.from(
  new Set(ACTIONS.flatMap((a) => a.champs.map((c) => c.cle))),
).sort();

/**
 * Un champ est-il visible, compte tenu de ce qui est déjà rempli ?
 *
 * Partagé entre le panneau (qui l'affiche ou non) et la validation (qui
 * n'exige pas un champ obligatoire caché) : les deux DOIVENT répondre la
 * même chose, sinon on refuse d'enregistrer un formulaire dont le champ
 * fautif n'est pas à l'écran — une impasse.
 */
export function champVisible(
  champ: ChampAction,
  config: Record<string, unknown>,
): boolean {
  if (!champ.visible_si) return true;
  const valeur = config[champ.visible_si.champ];
  const texte = valeur === undefined || valeur === null ? '' : String(valeur);
  return champ.visible_si.valeurs.includes(texte);
}

/** Les familles, dans l'ordre d'affichage du sélecteur. */
export const FAMILLES_ACTIONS: Array<{ cle: FamilleAction; fr: string; en: string }> = [
  { cle: 'communication', fr: 'Communication', en: 'Communication' },
  { cle: 'client', fr: 'Client', en: 'Client' },
  { cle: 'travail', fr: 'Travail', en: 'Work' },
  { cle: 'vente', fr: 'Ventes', en: 'Sales' },
  { cle: 'argent', fr: 'Argent', en: 'Money' },
  { cle: 'technique', fr: 'Technique', en: 'Technical' },
];

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

// ── Avant de publier ────────────────────────────────────────

export interface ProblemePublication {
  /** Ce qui ne va pas, en une phrase, dans les mots du métier. */
  message: string;
  /** L'étape fautive, pour l'ouvrir d'un clic. */
  etapeId?: string;
  /**
   * `bloquant` : la publication est refusée — l'automatisation ne pourrait
   * pas fonctionner. `avertissement` : elle marchera, mais quelque chose
   * mérite un coup d'œil.
   */
  gravite: 'bloquant' | 'avertissement';
}

/**
 * Ce qui empêche de publier une automatisation — ou mérite d'être vu avant.
 *
 * POURQUOI CETTE VÉRIFICATION EXISTE. L'audit du 23 septembre sur un vrai
 * compte GoHighLevel a trouvé CINQ erreurs bloquantes dans un workflow
 * publiable : une action sans pipeline, un segment non résolu, un jeton
 * d'exemple, une condition indéfinie. Leur builder laisse publier un
 * parcours cassé, et l'entreprise ne s'en aperçoit qu'en constatant que
 * personne n'a rien reçu.
 *
 * On refuse donc AVANT, avec la raison en clair et l'étape fautive — une
 * erreur qu'on peut cliquer se corrige, une erreur qu'on doit chercher se
 * contourne.
 *
 * Volontairement dans le catalogue, et non dans la page : la même fonction
 * sert au bouton « Publier » et aux tests, sans qu'une copie puisse dériver.
 */
export function problemesAvantPublication(regle: {
  trigger_event?: string | null;
  steps?: unknown;
  actions?: unknown;
  /** Les réglages du déclencheur — voir `DeclencheurCatalogue.champs`. */
  conditions?: Record<string, unknown> | null;
  fr?: boolean;
}): ProblemePublication[] {
  const fr = regle.fr !== false;
  const out: ProblemePublication[] = [];
  const dire = (frTxt: string, enTxt: string, gravite: ProblemePublication['gravite'], etapeId?: string) =>
    out.push({ message: fr ? frTxt : enTxt, gravite, etapeId });

  // ── Le déclencheur ──
  const decl = regle.trigger_event ? trouverDeclencheur(regle.trigger_event) : undefined;
  if (!decl) {
    dire(
      'Choisissez ce qui déclenche cette automatisation.',
      'Pick what triggers this automation.',
      'bloquant',
    );
  } else if (decl.bientot) {
    // Le piège le plus coûteux : publier sur un événement que rien n'émet.
    // L'automatisation ne partirait JAMAIS, sans le moindre message.
    dire(
      `« ${decl.fr} » n’est pas encore branché : l’automatisation ne partirait jamais.`,
      `“${decl.en}” is not wired yet: the automation would never run.`,
      'bloquant',
    );
  } else if (decl.champs?.length) {
    /*
     * Un déclencheur peut avoir ses propres réglages obligatoires.
     *
     * « Date atteinte » sans champ date choisi est le cas type : le
     * balayage quotidien lit `conditions.champ_id`, ne trouve rien, et
     * passe son chemin. L'automatisation est publiée, affichée comme
     * active, et ne part JAMAIS — l'échec le plus coûteux, parce qu'il ne
     * se voit nulle part.
     */
    const conditions = (regle.conditions ?? {}) as Record<string, unknown>;
    for (const champ of decl.champs) {
      if (!champ.obligatoire) continue;
      const v = conditions[champ.cle];
      if (v === undefined || v === null || String(v).trim() === '') {
        dire(
          `« ${decl.fr} » : « ${champ.fr} » doit être rempli, sinon l’automatisation ne partirait jamais.`,
          `“${decl.en}”: “${champ.en}” is required, otherwise the automation would never run.`,
          'bloquant',
        );
      }
    }
  }

  const steps = Array.isArray(regle.steps) ? (regle.steps as Array<Record<string, any>>) : null;
  const actions = Array.isArray(regle.actions) ? (regle.actions as Array<Record<string, any>>) : [];

  // ── Il faut quelque chose à faire ──
  if ((!steps || steps.length === 0) && actions.length === 0) {
    dire(
      'Ajoutez au moins une étape : pour l’instant, cette automatisation ne fait rien.',
      'Add at least one step: right now this automation does nothing.',
      'bloquant',
    );
    return out;
  }

  /** Vérifie une action : son existence, ses champs, sa compatibilité. */
  const verifierAction = (
    action: { type?: string; config?: Record<string, unknown> } | undefined,
    etapeId?: string,
    rang?: number,
  ) => {
    const ou = etapeId ? '' : fr ? ` (action ${(rang ?? 0) + 1})` : ` (action ${(rang ?? 0) + 1})`;
    const modele = action?.type ? trouverAction(action.type) : undefined;
    if (!modele) {
      dire(
        `Une étape utilise une action inconnue${ou}.`,
        `A step uses an unknown action${ou}.`,
        'bloquant', etapeId,
      );
      return;
    }

    // L'action peut-elle seulement partir sur ce déclencheur ?
    if (regle.trigger_event && !actionCompatible(modele, regle.trigger_event)) {
      dire(
        `« ${modele.fr} » ne peut pas suivre ce déclencheur${ou}.`,
        `“${modele.en}” cannot follow this trigger${ou}.`,
        'bloquant', etapeId,
      );
    }

    const config = (action?.config ?? {}) as Record<string, string | undefined>;
    for (const champ of modele.champs) {
      if (!champ.obligatoire) continue;
      if (!champVisible(champ, config)) continue;
      if (!config[champ.cle]?.trim()) {
        dire(
          `« ${modele.fr} » : « ${champ.fr} » est vide${ou}.`,
          `“${modele.en}”: “${champ.en}” is empty${ou}.`,
          'bloquant', etapeId,
        );
      }
    }
  };

  if (steps && steps.length > 0) {
    const ids = new Set(steps.map((e) => String(e.id)));
    let messageVersClient = false;

    for (const etape of steps) {
      const id = String(etape.id);
      if (etape.type === 'action') {
        verifierAction(etape.action, id);
        const modele = etape.action?.type ? trouverAction(etape.action.type) : undefined;
        if (modele?.vers_client) messageVersClient = true;
      }

      // Les renvois. `problemesDuGraphe` les vérifie déjà côté serveur, mais
      // le dire ICI évite un aller-retour et nomme l'étape fautive.
      for (const cle of ['suivant', 'alors', 'sinon', 'si_reponse']) {
        const cible = etape[cle];
        if (cible && !ids.has(String(cible))) {
          dire(
            `Une étape renvoie vers une étape supprimée.`,
            `A step points to a deleted step.`,
            'bloquant', id,
          );
        }
      }

      if (etape.type === 'si' && Object.keys(etape.conditions ?? {}).length === 0) {
        dire(
          'Une condition est vide : le parcours suivrait toujours le même chemin.',
          'A condition is empty: the journey would always take the same path.',
          'avertissement', id,
        );
      }
    }

    // Une séquence qui finit sur une attente : le client attend, et rien ne
    // vient. C'est déjà refusé côté serveur ; on le dit plus tôt.
    const derniere = steps[steps.length - 1];
    if (derniere?.type === 'attendre' && !derniere.suivant) {
      dire(
        'Le parcours se termine par une attente : rien ne se passera après.',
        'The journey ends on a wait: nothing will happen afterwards.',
        'bloquant', String(derniere.id),
      );
    }

    if (!messageVersClient) {
      dire(
        'Aucun message ne part au client : cette automatisation ne fait que du travail interne.',
        'No message goes to the client: this automation only does internal work.',
        'avertissement',
      );
    }
  } else {
    actions.forEach((a, i) => verifierAction(a as { type?: string; config?: Record<string, unknown> }, undefined, i));
  }

  return out;
}
