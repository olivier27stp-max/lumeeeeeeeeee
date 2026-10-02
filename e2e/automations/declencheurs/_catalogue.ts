/**
 * Le catalogue ATTENDU des déclencheurs — recopié à la main de la carte
 * (`map-editeur.md`, § 3a), PAS importé du produit : si le produit dérive
 * (libellé changé, champ retiré, déclencheur ajouté), les tests le voient.
 *
 * 28 déclencheurs (DEC-01 à DEC-28), dont 3 sous drapeau ; 15 champs propres ;
 * 2 filtres d'étiquettes communs (sauf « Devis ouvert », qui a le sien, et
 * « Appel reçu de l'extérieur », qui n'a pas de client).
 */

export type TypeChampDecl = 'choix' | 'nombre' | 'service' | 'etape_pipeline' | 'etiquette' | 'champ_date';

export interface ChampAttendu {
  cle: string;
  fr: string;
  en: string;
  type: TypeChampDecl;
  obligatoire: boolean;
  /** Options d'un champ « choix » : clé → libellés. */
  options?: Array<{ cle: string; fr: string; en: string }>;
  aide_fr?: string;
}

export interface DeclencheurAttendu {
  id: string;
  cle: string;
  fr: string;
  en: string;
  aide_fr: string;
  aide_en: string;
  famille: 'devis' | 'facture' | 'rendezvous' | 'job' | 'client' | 'vente';
  /** Champs PROPRES (hors filtres d'étiquettes communs). */
  champs: ChampAttendu[];
  /** Les 2 filtres d'étiquettes communs sont-ils ajoutés ? */
  filtresEtiquettes: boolean;
  /** `conditions` posées d'office au choix du déclencheur. */
  defaut: Record<string, unknown>;
  /** Drapeau d'entreprise (`org_features`) sans lequel il n'est pas offert. */
  drapeau?: string;
  /** Objet des champs personnalisés de la fiche (section « Filtres ») ; null = aucun. */
  objet: 'Client' | 'Devis' | 'Facture' | 'Job' | 'Pipeline' | null;
  objet_en: 'Client' | 'Quote' | 'Invoice' | 'Job' | 'Pipeline' | null;
}

export const FAMILLES: Array<{ cle: DeclencheurAttendu['famille']; fr: string; en: string }> = [
  { cle: 'devis', fr: 'Devis', en: 'Quotes' },
  { cle: 'facture', fr: 'Factures', en: 'Invoices' },
  { cle: 'rendezvous', fr: 'Rendez-vous', en: 'Appointments' },
  { cle: 'job', fr: 'Jobs', en: 'Jobs' },
  { cle: 'client', fr: 'Clients et prospects', en: 'Clients and leads' },
  { cle: 'vente', fr: 'Pipeline de ventes', en: 'Sales pipeline' },
];

export const FILTRE_A = { cle: 'client_a_etiquette', fr: 'Seulement si le client a l’étiquette', en: 'Only if the client has tag' };
export const FILTRE_SANS = { cle: 'client_sans_etiquette', fr: 'Seulement si le client n’a PAS l’étiquette', en: 'Only if the client does NOT have tag' };

const OUVERTURE_DEVIS: ChampAttendu = {
  cle: 'ouverture', fr: 'Quand déclencher', en: 'When to trigger', type: 'choix', obligatoire: false,
  options: [
    { cle: 'premiere', fr: 'Première ouverture seulement', en: 'First open only' },
    { cle: 'chaque', fr: 'Chaque ouverture', en: 'Every open' },
  ],
  aide_fr: 'Une même visite ne compte qu’une fois par 30 minutes.',
};
const OUVERTURE_FACTURE: ChampAttendu = {
  cle: 'ouverture', fr: 'Quand déclencher', en: 'When to trigger', type: 'choix', obligatoire: false,
  options: [
    { cle: 'premiere', fr: 'Première consultation seulement', en: 'First view only' },
    { cle: 'chaque', fr: 'Chaque consultation', en: 'Every view' },
  ],
  aide_fr: 'Une même visite ne compte qu’une fois par 30 minutes.',
};
const QUELLE_ETIQUETTE: ChampAttendu = { cle: 'tag', fr: 'Quelle étiquette', en: 'Which tag', type: 'etiquette', obligatoire: false, aide_fr: 'Vide = n’importe quelle étiquette.' };
const QUELLE_ETAPE: ChampAttendu = { cle: 'stage_id', fr: 'Quelle étape', en: 'Which stage', type: 'etape_pipeline', obligatoire: false };

const d = (
  id: string, cle: string, fr: string, en: string, aide_fr: string, aide_en: string,
  famille: DeclencheurAttendu['famille'], objet: DeclencheurAttendu['objet'], objet_en: DeclencheurAttendu['objet_en'],
  plus: Partial<DeclencheurAttendu> = {},
): DeclencheurAttendu => ({ id, cle, fr, en, aide_fr, aide_en, famille, objet, objet_en, champs: [], filtresEtiquettes: true, defaut: {}, ...plus });

export const DECLENCHEURS_ATTENDUS: DeclencheurAttendu[] = [
  d('DEC-01', 'quote.sent', 'Devis envoyé', 'Quote sent', 'Quand un devis part chez le client.', 'When a quote is sent to the client.', 'devis', 'Devis', 'Quote'),
  d('DEC-02', 'quote.viewed', 'Devis ouvert par le client', 'Quote opened by client',
    'Quand le client ouvre le lien de son devis. Les ouvertures par votre équipe, les aperçus et les robots de messagerie ne comptent pas.',
    'When the client opens their quote link. Opens by your team, previews and email scanners don’t count.', 'devis', 'Devis', 'Quote', {
      filtresEtiquettes: false,
      defaut: { ouverture: 'premiere' },
      champs: [
        OUVERTURE_DEVIS,
        { cle: 'montant__gte', fr: 'Montant minimum ($)', en: 'Minimum amount ($)', type: 'nombre', obligatoire: false, aide_fr: 'Total du devis, taxes comprises. Vide = aucun minimum.' },
        { cle: 'montant__lte', fr: 'Montant maximum ($)', en: 'Maximum amount ($)', type: 'nombre', obligatoire: false },
        { cle: 'service_id', fr: 'Contient le service', en: 'Includes service', type: 'service', obligatoire: false },
        { cle: 'stage_id', fr: 'L’opportunité est à l’étape', en: 'Deal is at stage', type: 'etape_pipeline', obligatoire: false },
        { cle: 'etiquette', fr: 'Le client a l’étiquette', en: 'Client has tag', type: 'etiquette', obligatoire: false },
      ],
    }),
  d('DEC-03', 'quote.approved', 'Devis accepté', 'Quote approved', 'Quand le client accepte le devis.', 'When the client approves the quote.', 'devis', 'Devis', 'Quote'),
  d('DEC-04', 'quote.declined', 'Devis refusé', 'Quote declined', 'Quand le client refuse le devis.', 'When the client declines the quote.', 'devis', 'Devis', 'Quote'),
  d('DEC-05', 'quote.changes_requested', 'Modifications demandées', 'Changes requested', 'Quand le client demande de modifier le devis.', 'When the client asks for changes to the quote.', 'devis', 'Devis', 'Quote'),
  d('DEC-06', 'invoice.sent', 'Facture envoyée', 'Invoice sent', 'Quand une facture part chez le client.', 'When an invoice is sent to the client.', 'facture', 'Facture', 'Invoice'),
  d('DEC-07', 'invoice.paid', 'Facture payée', 'Invoice paid', 'Quand le paiement d’une facture est encaissé.', 'When an invoice payment is received.', 'facture', 'Facture', 'Invoice'),
  d('DEC-08', 'invoice.overdue', 'Facture en retard', 'Invoice overdue', 'Quand une facture dépasse sa date d’échéance.', 'When an invoice passes its due date.', 'facture', 'Facture', 'Invoice'),
  d('DEC-09', 'payment.failed', 'Paiement échoué', 'Payment failed',
    'Quand le paiement d’une facture par votre client échoue (carte refusée, fonds insuffisants, carte expirée…), en ligne ou par carte au dossier.',
    'When your client’s payment on an invoice fails (card declined, insufficient funds, expired card…), online or with a card on file.',
    'facture', 'Facture', 'Invoice', { drapeau: 'auto_paiement_echoue' }),
  d('DEC-10', 'invoice.viewed', 'Facture consultée par le client', 'Invoice viewed by client',
    'Quand le client ouvre le lien de sa facture. Les ouvertures par votre équipe, les aperçus et les robots de messagerie ne comptent pas.',
    'When the client opens their invoice link. Opens by your team, previews and email scanners don’t count.',
    'facture', 'Facture', 'Invoice', { drapeau: 'auto_consultation_documents', defaut: { ouverture: 'premiere' }, champs: [OUVERTURE_FACTURE] }),
  d('DEC-11', 'appointment.created', 'Rendez-vous planifié', 'Appointment scheduled',
    'Quand une visite est mise à l’horaire. Permet aussi d’envoyer AVANT le rendez-vous.', 'When a visit is scheduled. Also allows sending BEFORE the appointment.', 'rendezvous', null, null),
  d('DEC-12', 'appointment.cancelled', 'Rendez-vous annulé', 'Appointment cancelled', 'Quand une visite est annulée.', 'When a visit is cancelled.', 'rendezvous', null, null),
  d('DEC-13', 'job.completed', 'Job terminé', 'Job completed', 'Quand un job est marqué terminé sur le terrain.', 'When a job is marked complete in the field.', 'job', 'Job', 'Job'),
  d('DEC-14', 'job.ready_for_invoicing', 'Job prêt à facturer', 'Job ready to invoice', 'Quand un job terminé attend sa facture.', 'When a completed job is waiting to be invoiced.', 'job', 'Job', 'Job'),
  d('DEC-15', 'lead.created', 'Nouveau prospect', 'New lead', 'Quand un prospect entre — formulaire web, appel, saisie manuelle.', 'When a lead comes in — web form, call, manual entry.', 'client', 'Client', 'Client'),
  d('DEC-16', 'lead.status_changed', 'Statut du prospect changé', 'Lead status changed', 'Quand un prospect change d’étape.', 'When a lead moves to another status.', 'client', 'Client', 'Client'),
  d('DEC-17', 'client.replied', 'Le client répond', 'Client replies', 'Quand un client répond par texto à un message de l’entreprise.', 'When a client texts back after a message from the company.', 'client', 'Client', 'Client'),
  d('DEC-18', 'client.tagged', 'Étiquette ajoutée', 'Tag added',
    'Quand une étiquette est posée sur un client — à la main ou par une autre automatisation.', 'When a tag is added to a client — by hand or by another automation.',
    'client', 'Client', 'Client', { champs: [QUELLE_ETIQUETTE] }),
  d('DEC-19', 'client.untagged', 'Étiquette retirée', 'Tag removed',
    'Quand une étiquette est retirée d’un client — à la main ou par une autre automatisation.', 'When a tag is removed from a client — by hand or by another automation.',
    'client', 'Client', 'Client', { champs: [QUELLE_ETIQUETTE] }),
  d('DEC-20', 'client.inactive', 'Client inactif', 'Inactive client',
    'Quand un ancien client n’a eu aucun job terminé depuis le délai choisi, et n’a rien de prévu. Une seule fois par période : un nouveau job terminé le réarme.',
    'When a past client has had no completed job for the chosen time and has nothing scheduled. Once per period: a new completed job re-arms it.',
    'client', 'Client', 'Client', {
      drapeau: 'auto_client_inactif', defaut: { mois: 6, max_par_heure: 25 },
      champs: [
        { cle: 'mois', fr: 'Aucun job terminé depuis (mois)', en: 'No completed job for (months)', type: 'nombre', obligatoire: true, aide_fr: '3, 6 ou 12 mois — ou toute autre valeur.' },
        { cle: 'max_par_heure', fr: 'Au plus, par heure', en: 'At most, per hour', type: 'nombre', obligatoire: false },
      ],
    }),
  d('DEC-21', 'agreement.signed', 'Contrat signé', 'Agreement signed', 'Quand le client signe un contrat.', 'When the client signs an agreement.', 'client', 'Job', 'Job'),
  d('DEC-22', 'task.completed', 'Tâche terminée', 'Task completed', 'Quand une tâche liée à un client est marquée terminée.', 'When a task linked to a client is marked done.', 'job', 'Client', 'Client'),
  d('DEC-23', 'note.added', 'Note ajoutée', 'Note added', 'Quand quelqu’un écrit une note sur un client ou un job.', 'When someone writes a note on a client or a job.', 'client', 'Client', 'Client'),
  d('DEC-24', 'webhook.received', 'Appel reçu de l’extérieur', 'Incoming webhook',
    'Quand un service extérieur appelle votre adresse Lume — formulaire de votre site, Zapier, Facebook Leads, fournisseur d’appels. L’adresse et sa clé se créent dans Réglages › Automatisations.',
    'When an outside service calls your Lume address — your website form, Zapier, Facebook Leads, a call provider. The address and its key are created in Settings › Automations.',
    'client', null, null, { filtresEtiquettes: false }),
  d('DEC-25', 'date.reached', 'Date atteinte', 'Date reached',
    'Quand une date d’un champ personnalisé arrive — fin de contrat, garantie, entretien annuel.', 'When a date from a custom field arrives — contract end, warranty, yearly service.',
    'client', 'Client', 'Client', {
      champs: [
        { cle: 'champ_id', fr: 'Quelle date surveiller', en: 'Which date to watch', type: 'champ_date', obligatoire: true },
        { cle: 'jours_avant', fr: 'Combien de jours avant', en: 'How many days before', type: 'nombre', obligatoire: false, aide_fr: '7 = une semaine avant la date. 0 = le jour même. -7 = une semaine après.' },
      ],
    }),
  d('DEC-26', 'deal.stage_entered', 'Opportunité entre dans une étape', 'Deal enters a stage',
    'Quand une opportunité arrive dans une étape du pipeline.', 'When a deal moves into a pipeline stage.', 'vente', 'Pipeline', 'Pipeline', { champs: [QUELLE_ETAPE] }),
  d('DEC-27', 'deal.stage_idle', 'Opportunité qui dort', 'Deal going stale',
    'Quand une opportunité stagne trop longtemps dans son étape.', 'When a deal sits too long in its stage.', 'vente', 'Pipeline', 'Pipeline', { champs: [QUELLE_ETAPE] }),
  d('DEC-28', 'custom_field.changed', 'Champ personnalisé modifié', 'Custom field changed',
    'Quand la valeur d’un champ personnalisé change sur une fiche.', 'When a custom field value changes on a record.', 'client', null, null),
];

export const SOUS_DRAPEAU = DECLENCHEURS_ATTENDUS.filter((x) => x.drapeau);
export const SANS_DRAPEAU = DECLENCHEURS_ATTENDUS.filter((x) => !x.drapeau);

/** Une clé technique de déclencheur (`quote.sent`) ne doit JAMAIS s'afficher. */
export const MOTIF_CLE_TECHNIQUE = /\b(quote|invoice|payment|appointment|job|lead|client|agreement|task|note|webhook|date|deal|custom_field)\.[a-z_]+\b/;
