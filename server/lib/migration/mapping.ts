// Correspondance déterministe colonne source → champ Lume.
// Aucune dépendance externe, aucun accès DB : tout est pur et testable.
// Le vocabulaire des synonymes couvre les exports Jobber / Housecall Pro /
// ServiceTitan / GoHighLevel / QuickBooks, en anglais et en français.

import type {
  AnalyzedColumn,
  FieldDef,
  MappingSuggestion,
  MigrationCategory,
  TargetEntity,
} from './types';

/** minuscule, accents retirés (NFD), non-alphanumérique → espace, trim. */
export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ── Catalogue des champs cibles ──

export const FIELD_CATALOG: Record<TargetEntity, FieldDef[]> = {
  client: [
    {
      field: 'first_name',
      labelFr: 'Prénom',
      labelEn: 'First name',
      types: ['name', 'text'],
      synonyms: [
        'first name', 'first', 'fname', 'given name', 'prenom', 'prénom',
        'contact first name', 'customer first name', 'client first name', 'prenom du client',
      ],
    },
    {
      field: 'last_name',
      labelFr: 'Nom de famille',
      labelEn: 'Last name',
      types: ['name', 'text'],
      synonyms: [
        'last name', 'last', 'lname', 'surname', 'family name', 'nom de famille',
        'contact last name', 'customer last name', 'client last name', 'nom de famille du client',
      ],
    },
    {
      field: 'full_name',
      labelFr: 'Nom complet',
      labelEn: 'Full name',
      types: ['name', 'text'],
      synonyms: [
        'customer name', 'client name', 'contact name', 'full name', 'display name', 'name',
        'customer', 'client', 'contact', 'customer full name', 'billing name', 'account name',
        'nom', 'nom complet', 'nom du client', 'nom client', 'nom et prenom', 'nom du contact',
      ],
    },
    {
      field: 'company',
      labelFr: 'Entreprise',
      labelEn: 'Company',
      types: ['name', 'text'],
      synonyms: [
        'company', 'company name', 'business name', 'business', 'organization', 'organisation',
        'entreprise', 'compagnie', 'nom d entreprise', 'nom de l entreprise', 'societe', 'raison sociale',
      ],
    },
    {
      field: 'email',
      labelFr: 'Courriel',
      labelEn: 'Email',
      types: ['email', 'text'],
      synonyms: [
        'email', 'e mail', 'email address', 'main email', 'primary email', 'contact email',
        'customer email', 'client email', 'courriel', 'adresse courriel', 'adresse email',
        'adresse electronique', 'courriel principal',
      ],
    },
    {
      field: 'phone',
      labelFr: 'Téléphone',
      labelEn: 'Phone',
      types: ['phone', 'text'],
      synonyms: [
        'phone', 'phone number', 'telephone', 'tel', 'main phone', 'primary phone', 'phone numbers',
        'mobile', 'mobile phone', 'cell', 'cell phone', 'cellulaire', 'home phone',
        'numero de telephone', 'telephone principal', 'portable',
      ],
    },
    {
      field: 'phone_secondary',
      labelFr: 'Téléphone secondaire',
      labelEn: 'Secondary phone',
      types: ['phone', 'text'],
      synonyms: [
        'secondary phone', 'phone 2', 'phone2', 'alt phone', 'alternate phone', 'other phone',
        'work phone', 'office phone', 'mobile phone number', 'second phone', 'business phone',
        'telephone secondaire', 'autre telephone', 'telephone travail', 'telephone bureau', 'deuxieme telephone',
      ],
    },
    {
      field: 'address',
      labelFr: 'Adresse',
      labelEn: 'Address',
      types: ['address', 'text'],
      synonyms: [
        'address', 'street', 'street 1', 'street address', 'address 1', 'address line 1',
        'billing address', 'billing street', 'mailing address', 'bill to', 'address1', 'street1',
        'adresse', 'rue', 'adresse de facturation', 'adresse postale', 'no civique et rue',
      ],
    },
    {
      field: 'city',
      labelFr: 'Ville',
      labelEn: 'City',
      types: ['name', 'text'],
      synonyms: ['city', 'town', 'billing city', 'ville', 'municipalite', 'localite'],
    },
    {
      field: 'province',
      labelFr: 'Province',
      labelEn: 'Province',
      types: ['text', 'status'],
      synonyms: ['province', 'state', 'state province', 'prov', 'billing state', 'etat', 'region'],
    },
    {
      field: 'postal_code',
      labelFr: 'Code postal',
      labelEn: 'Postal code',
      types: ['postal_code', 'text', 'number'],
      synonyms: [
        'postal code', 'zip', 'zip code', 'zip postal code', 'postal', 'billing zip',
        'code postal', 'cp',
      ],
    },
    {
      field: 'country',
      labelFr: 'Pays',
      labelEn: 'Country',
      types: ['name', 'text', 'status'],
      synonyms: ['country', 'billing country', 'pays'],
    },
    {
      field: 'notes',
      labelFr: 'Notes',
      labelEn: 'Notes',
      types: ['text'],
      synonyms: [
        'notes', 'note', 'description', 'comments', 'comment', 'memo', 'remarks',
        'commentaires', 'remarques', 'details', 'details du client',
      ],
    },
    {
      field: 'lead_source',
      labelFr: 'Source du lead',
      labelEn: 'Lead source',
      types: ['text', 'status'],
      synonyms: [
        'lead source', 'source', 'referral source', 'acquisition source', 'how did you hear',
        'how did you hear about us', 'campaign', 'source du lead', 'source du client',
        'provenance', 'canal', 'origine',
      ],
    },
    {
      field: 'status',
      labelFr: 'Statut',
      labelEn: 'Status',
      types: ['status', 'text', 'boolean'],
      synonyms: [
        'status', 'customer status', 'client status', 'stage', 'pipeline stage', 'lifecycle stage',
        'statut', 'statut du client', 'etape', 'etat du client', 'type de client', 'customer type',
      ],
    },
    {
      field: 'external_id',
      labelFr: 'Identifiant externe',
      labelEn: 'External ID',
      types: ['id', 'number', 'text'],
      synonyms: [
        'id', 'customer id', 'client id', 'contact id', 'external id', 'record id', 'account id',
        'account number', 'customer number', 'client number', 'uuid',
        'identifiant', 'no client', 'numero de client', 'no de compte', 'numero de compte',
      ],
    },
    {
      field: 'created_date',
      labelFr: 'Date de création',
      labelEn: 'Created date',
      types: ['date', 'datetime', 'text'],
      synonyms: [
        'created', 'created date', 'created at', 'date created', 'date added', 'signup date',
        'client since', 'customer since', 'client depuis',
        'date de creation', 'cree le', 'date d ajout', 'date d inscription',
      ],
    },
  ],

  property: [
    {
      field: 'address',
      labelFr: 'Adresse',
      labelEn: 'Address',
      types: ['address', 'text'],
      required: true,
      synonyms: [
        'address', 'street', 'street 1', 'street address', 'address 1', 'address line 1',
        'service address', 'property address', 'location address', 'site address', 'job address',
        'adresse', 'rue', 'adresse de service', 'adresse de la propriete', 'adresse du site', 'emplacement',
      ],
    },
    {
      field: 'city',
      labelFr: 'Ville',
      labelEn: 'City',
      types: ['name', 'text'],
      synonyms: ['city', 'town', 'service city', 'ville', 'municipalite', 'localite'],
    },
    {
      field: 'province',
      labelFr: 'Province',
      labelEn: 'Province',
      types: ['text', 'status'],
      synonyms: ['province', 'state', 'state province', 'prov', 'service state', 'etat', 'region'],
    },
    {
      field: 'postal_code',
      labelFr: 'Code postal',
      labelEn: 'Postal code',
      types: ['postal_code', 'text', 'number'],
      synonyms: ['postal code', 'zip', 'zip code', 'zip postal code', 'postal', 'code postal', 'cp'],
    },
    {
      field: 'country',
      labelFr: 'Pays',
      labelEn: 'Country',
      types: ['name', 'text', 'status'],
      synonyms: ['country', 'pays'],
    },
    {
      field: 'name',
      labelFr: 'Nom de la propriété',
      labelEn: 'Property name',
      types: ['name', 'text'],
      synonyms: [
        'property name', 'location name', 'site name', 'nickname', 'location nickname', 'location',
        'nom de la propriete', 'nom de l emplacement', 'nom du site', 'surnom',
      ],
    },
    {
      field: 'client_ref',
      labelFr: 'Client associé',
      labelEn: 'Client reference',
      types: ['id', 'name', 'number', 'text'],
      synonyms: [
        'customer', 'client', 'customer name', 'client name', 'customer id', 'client id',
        'account', 'parent customer', 'contact', 'contact name',
        'nom du client', 'no client', 'numero de client', 'client associe',
      ],
    },
    {
      field: 'notes',
      labelFr: 'Notes',
      labelEn: 'Notes',
      types: ['text'],
      synonyms: ['notes', 'note', 'description', 'comments', 'memo', 'commentaires', 'remarques', 'details'],
    },
  ],

  service: [
    {
      field: 'name',
      labelFr: 'Nom du service',
      labelEn: 'Service name',
      types: ['name', 'text'],
      required: true,
      synonyms: [
        'name', 'item', 'item name', 'service', 'service name', 'product', 'product name',
        'product service', 'product service name', 'item title',
        'nom', 'nom du service', 'produit', 'article', 'libelle', 'nom du produit',
      ],
    },
    {
      field: 'description',
      labelFr: 'Description',
      labelEn: 'Description',
      types: ['text'],
      synonyms: [
        'description', 'details', 'sales description', 'memo', 'notes', 'note',
        'commentaires', 'description du service',
      ],
    },
    {
      field: 'price',
      labelFr: 'Prix',
      labelEn: 'Price',
      types: ['money', 'number', 'text'],
      synonyms: [
        'price', 'rate', 'unit price', 'sales price', 'sale price', 'list price', 'default price',
        'amount', 'prix', 'prix unitaire', 'prix de vente', 'tarif', 'montant',
      ],
    },
    {
      field: 'cost',
      labelFr: 'Coût',
      labelEn: 'Cost',
      types: ['money', 'number', 'text'],
      synonyms: [
        'cost', 'unit cost', 'purchase cost', 'cost price', 'cout', 'cout unitaire', 'prix coutant',
      ],
    },
    {
      field: 'category',
      labelFr: 'Catégorie',
      labelEn: 'Category',
      types: ['text', 'status', 'name'],
      synonyms: [
        'category', 'item category', 'service category', 'class', 'group',
        'categorie', 'type de service', 'classe', 'groupe', 'famille',
      ],
    },
    {
      field: 'taxable',
      labelFr: 'Taxable',
      labelEn: 'Taxable',
      types: ['boolean', 'text', 'status'],
      synonyms: [
        'taxable', 'tax', 'taxed', 'is taxable', 'charge tax', 'taxable item',
        'assujetti', 'assujetti aux taxes', 'taxes applicables',
      ],
    },
    {
      field: 'item_type',
      labelFr: "Type d'article",
      labelEn: 'Item type',
      types: ['status', 'text'],
      synonyms: [
        'type', 'item type', 'product or service', 'kind',
        'type d article', 'produit ou service', 'nature',
      ],
    },
  ],

  quote: [
    {
      field: 'quote_number',
      labelFr: 'Numéro de soumission',
      labelEn: 'Quote number',
      types: ['id', 'number', 'text'],
      synonyms: [
        'quote number', 'quote', 'quote id', 'quote no', 'estimate number', 'estimate', 'estimate id',
        'estimate no', 'proposal number', 'proposal',
        'numero de soumission', 'no de soumission', 'soumission', 'numero de devis', 'no de devis', 'devis',
      ],
    },
    {
      field: 'title',
      labelFr: 'Titre',
      labelEn: 'Title',
      types: ['name', 'text'],
      synonyms: ['title', 'quote title', 'subject', 'name', 'titre', 'objet', 'nom'],
    },
    {
      field: 'status',
      labelFr: 'Statut',
      labelEn: 'Status',
      types: ['status', 'text'],
      synonyms: ['status', 'quote status', 'estimate status', 'statut', 'etat', 'statut de la soumission'],
    },
    {
      field: 'total',
      labelFr: 'Total',
      labelEn: 'Total',
      types: ['money', 'number', 'text'],
      synonyms: [
        'total', 'quote total', 'estimate total', 'amount', 'total amount', 'grand total',
        'montant', 'montant total',
      ],
    },
    {
      field: 'subtotal',
      labelFr: 'Sous-total',
      labelEn: 'Subtotal',
      types: ['money', 'number', 'text'],
      synonyms: [
        'subtotal', 'sub total', 'net amount', 'total before tax',
        'sous total', 'montant avant taxes', 'total avant taxes',
      ],
    },
    {
      field: 'tax',
      labelFr: 'Taxes',
      labelEn: 'Tax',
      types: ['money', 'number', 'text'],
      synonyms: [
        'tax', 'taxes', 'tax amount', 'sales tax', 'gst', 'qst', 'hst', 'pst', 'vat',
        'tps', 'tvq', 'tva', 'taxe', 'montant des taxes',
      ],
    },
    {
      field: 'client_ref',
      labelFr: 'Client associé',
      labelEn: 'Client reference',
      types: ['id', 'name', 'number', 'text'],
      synonyms: [
        'customer', 'client', 'customer name', 'client name', 'customer id', 'client id', 'contact',
        'nom du client', 'no client', 'numero de client',
      ],
    },
    {
      field: 'created_date',
      labelFr: 'Date de création',
      labelEn: 'Created date',
      types: ['date', 'datetime', 'text'],
      synonyms: [
        'created', 'created date', 'date', 'quote date', 'estimate date', 'sent date', 'issued',
        'date de creation', 'date de soumission', 'date d envoi', 'cree le',
      ],
    },
    {
      field: 'valid_until',
      labelFr: "Valide jusqu'au",
      labelEn: 'Valid until',
      types: ['date', 'datetime', 'text'],
      synonyms: [
        'valid until', 'expires', 'expiry date', 'expiration', 'expiration date', 'good until',
        'valide jusqu au', 'date d expiration', 'echeance de validite',
      ],
    },
  ],

  job: [
    {
      field: 'job_number',
      labelFr: 'Numéro de job',
      labelEn: 'Job number',
      types: ['id', 'number', 'text'],
      synonyms: [
        'job number', 'job no', 'job', 'work order', 'work order number', 'wo number', 'wo',
        'ticket number', 'project number',
        'numero de job', 'no de job', 'numero de travail', 'numero de contrat', 'no de contrat',
      ],
    },
    {
      field: 'title',
      labelFr: 'Titre',
      labelEn: 'Title',
      types: ['name', 'text'],
      synonyms: [
        'job title', 'title', 'job name', 'subject', 'name', 'job type',
        'titre', 'objet', 'nom', 'type de job', 'type de travail',
      ],
    },
    {
      field: 'description',
      labelFr: 'Description',
      labelEn: 'Description',
      types: ['text'],
      synonyms: [
        'description', 'job description', 'details', 'scope of work', 'work description',
        'instructions', 'notes', 'note', 'memo',
        'description des travaux', 'commentaires', 'remarques',
      ],
    },
    {
      field: 'status',
      labelFr: 'Statut',
      labelEn: 'Status',
      types: ['status', 'text'],
      synonyms: [
        'status', 'job status', 'work status', 'stage',
        'statut', 'statut du job', 'etat', 'etape',
      ],
    },
    {
      field: 'client_ref',
      labelFr: 'Client associé',
      labelEn: 'Client reference',
      types: ['id', 'name', 'number', 'text'],
      synonyms: [
        'customer', 'client', 'customer name', 'client name', 'customer id', 'client id', 'contact',
        'nom du client', 'no client', 'numero de client',
      ],
    },
    {
      field: 'property_ref',
      labelFr: 'Propriété associée',
      labelEn: 'Property reference',
      types: ['id', 'address', 'name', 'number', 'text'],
      synonyms: [
        'property', 'property id', 'location', 'location name', 'location id', 'service address',
        'site', 'job address',
        'propriete', 'adresse de service', 'emplacement', 'site de service',
      ],
    },
    {
      field: 'total',
      labelFr: 'Total',
      labelEn: 'Total',
      types: ['money', 'number', 'text'],
      synonyms: [
        'total', 'job total', 'amount', 'total amount', 'grand total', 'job value', 'value',
        'revenue', 'price',
        'montant', 'montant total', 'valeur', 'prix',
      ],
    },
    {
      field: 'subtotal',
      labelFr: 'Sous-total',
      labelEn: 'Subtotal',
      types: ['money', 'number', 'text'],
      synonyms: [
        'subtotal', 'sub total', 'net amount', 'total before tax',
        'sous total', 'montant avant taxes', 'total avant taxes',
      ],
    },
    {
      field: 'tax',
      labelFr: 'Taxes',
      labelEn: 'Tax',
      types: ['money', 'number', 'text'],
      synonyms: [
        'tax', 'taxes', 'tax amount', 'sales tax', 'gst', 'qst', 'hst', 'pst', 'vat',
        'tps', 'tvq', 'tva', 'taxe', 'montant des taxes',
      ],
    },
    {
      field: 'sale_date',
      labelFr: 'Date de vente',
      labelEn: 'Sale date',
      types: ['date', 'datetime', 'text'],
      synonyms: [
        'sale date', 'sold date', 'date sold', 'closed date', 'won date', 'conversion date',
        'date de vente', 'vendu le', 'date de conclusion',
      ],
    },
    {
      field: 'start_date',
      labelFr: 'Date de début',
      labelEn: 'Start date',
      types: ['date', 'datetime', 'text'],
      synonyms: [
        'start date', 'start', 'scheduled start', 'scheduled date', 'schedule date', 'begin date',
        'date de debut', 'debut', 'date planifiee', 'date prevue', 'date de commencement',
      ],
    },
    {
      field: 'end_date',
      labelFr: 'Date de fin',
      labelEn: 'End date',
      types: ['date', 'datetime', 'text'],
      synonyms: [
        'end date', 'end', 'completion date', 'completed date', 'finished date', 'close date',
        'date de fin', 'fin', 'date de completion', 'termine le', 'date terminee',
      ],
    },
    {
      field: 'salesperson',
      labelFr: 'Vendeur',
      labelEn: 'Salesperson',
      types: ['name', 'text'],
      synonyms: [
        'salesperson', 'sales person', 'sales rep', 'rep', 'sold by', 'account manager',
        'vendeur', 'representant', 'vendu par', 'commercial', 'conseiller',
      ],
    },
    {
      field: 'tags',
      labelFr: 'Étiquettes',
      labelEn: 'Tags',
      types: ['text', 'status'],
      synonyms: ['tags', 'tag', 'labels', 'etiquettes', 'etiquette', 'mots cles'],
    },
    {
      field: 'external_id',
      labelFr: 'Identifiant externe',
      labelEn: 'External ID',
      types: ['id', 'number', 'text'],
      synonyms: [
        'id', 'job id', 'external id', 'record id', 'work order id', 'uuid', 'identifiant',
      ],
    },
  ],

  visit: [
    {
      field: 'job_ref',
      labelFr: 'Job associée',
      labelEn: 'Job reference',
      types: ['id', 'number', 'text'],
      synonyms: [
        'job', 'job number', 'job id', 'job no', 'work order', 'work order number', 'ticket',
        'no de job', 'numero de job', 'numero de travail',
      ],
    },
    {
      field: 'title',
      labelFr: 'Titre',
      labelEn: 'Title',
      types: ['name', 'text'],
      synonyms: [
        'title', 'visit title', 'visit name', 'subject', 'summary', 'event', 'event title', 'name',
        'titre', 'objet', 'resume', 'nom',
      ],
    },
    {
      field: 'start_at',
      labelFr: 'Début (date et heure)',
      labelEn: 'Start (datetime)',
      types: ['datetime', 'date', 'text'],
      synonyms: [
        'start', 'start at', 'starts at', 'start date time', 'scheduled start', 'appointment start',
        'arrival window start',
        'debut', 'date et heure de debut', 'debut planifie',
      ],
    },
    {
      field: 'end_at',
      labelFr: 'Fin (date et heure)',
      labelEn: 'End (datetime)',
      types: ['datetime', 'date', 'text'],
      synonyms: [
        'end', 'end at', 'ends at', 'end date time', 'scheduled end', 'appointment end',
        'arrival window end',
        'fin', 'date et heure de fin', 'fin planifiee',
      ],
    },
    {
      field: 'date',
      labelFr: 'Date',
      labelEn: 'Date',
      types: ['date', 'datetime', 'text'],
      synonyms: [
        'date', 'visit date', 'appointment date', 'scheduled date', 'service date', 'schedule date',
        'date de visite', 'date du rendez vous', 'date planifiee', 'date de service',
      ],
    },
    {
      field: 'start_time',
      labelFr: 'Heure de début',
      labelEn: 'Start time',
      types: ['text', 'datetime', 'number'],
      synonyms: [
        'start time', 'arrival time', 'appointment time', 'time',
        'heure de debut', 'heure d arrivee', 'heure',
      ],
    },
    {
      field: 'end_time',
      labelFr: 'Heure de fin',
      labelEn: 'End time',
      types: ['text', 'datetime', 'number'],
      synonyms: [
        'end time', 'finish time', 'departure time',
        'heure de fin', 'heure de depart',
      ],
    },
    {
      field: 'assigned_to',
      labelFr: 'Assigné à',
      labelEn: 'Assigned to',
      types: ['name', 'text'],
      synonyms: [
        'assigned to', 'assignee', 'technician', 'tech', 'employee', 'team member', 'crew',
        'dispatched to', 'worker', 'resource',
        'assigne a', 'technicien', 'employe', 'equipe', 'ressource', 'affecte a',
      ],
    },
    {
      field: 'status',
      labelFr: 'Statut',
      labelEn: 'Status',
      types: ['status', 'text', 'boolean'],
      synonyms: [
        'status', 'visit status', 'appointment status', 'confirmed',
        'statut', 'etat', 'statut de la visite', 'confirme',
      ],
    },
    {
      field: 'notes',
      labelFr: 'Notes',
      labelEn: 'Notes',
      types: ['text'],
      synonyms: [
        'notes', 'note', 'description', 'instructions', 'memo', 'commentaires', 'remarques', 'details',
      ],
    },
  ],

  invoice: [
    {
      field: 'invoice_number',
      labelFr: 'Numéro de facture',
      labelEn: 'Invoice number',
      types: ['id', 'number', 'text'],
      synonyms: [
        'invoice number', 'invoice', 'invoice no', 'invoice id', 'inv no', 'inv number', 'number', 'no',
        'numero de facture', 'no de facture', 'facture', 'num facture', 'numero',
      ],
    },
    {
      field: 'status',
      labelFr: 'Statut',
      labelEn: 'Status',
      types: ['status', 'text', 'boolean'],
      synonyms: [
        'status', 'invoice status', 'payment status',
        'statut', 'etat', 'statut de la facture', 'statut de paiement',
      ],
    },
    {
      field: 'issued_date',
      labelFr: "Date d'émission",
      labelEn: 'Issued date',
      types: ['date', 'datetime', 'text'],
      synonyms: [
        'invoice date', 'date', 'issued', 'issue date', 'issued date', 'billed date', 'created date',
        'created', 'txn date', 'transaction date',
        'date de facture', 'date de facturation', 'date d emission', 'emise le',
      ],
    },
    {
      field: 'due_date',
      labelFr: "Date d'échéance",
      labelEn: 'Due date',
      types: ['date', 'datetime', 'text'],
      synonyms: [
        'due date', 'due', 'due on', 'payment due',
        'echeance', 'date d echeance', 'date limite', 'payable avant',
      ],
    },
    {
      field: 'subtotal',
      labelFr: 'Sous-total',
      labelEn: 'Subtotal',
      types: ['money', 'number', 'text'],
      synonyms: [
        'subtotal', 'sub total', 'net amount', 'total before tax',
        'sous total', 'montant avant taxes', 'total avant taxes',
      ],
    },
    {
      field: 'tax',
      labelFr: 'Taxes',
      labelEn: 'Tax',
      types: ['money', 'number', 'text'],
      synonyms: [
        'tax', 'taxes', 'tax amount', 'sales tax', 'gst', 'qst', 'hst', 'pst', 'vat',
        'tps', 'tvq', 'tva', 'taxe', 'montant des taxes',
      ],
    },
    {
      field: 'total',
      labelFr: 'Total',
      labelEn: 'Total',
      types: ['money', 'number', 'text'],
      synonyms: [
        'total', 'invoice total', 'amount', 'total amount', 'grand total', 'invoice amount',
        'montant', 'montant total', 'montant de la facture',
      ],
    },
    {
      field: 'paid_amount',
      labelFr: 'Montant payé',
      labelEn: 'Paid amount',
      types: ['money', 'number', 'text'],
      synonyms: [
        'paid', 'amount paid', 'paid amount', 'total paid', 'payments', 'payments applied', 'paid to date',
        'montant paye', 'paye', 'total paye',
      ],
    },
    {
      field: 'balance',
      labelFr: 'Solde',
      labelEn: 'Balance',
      types: ['money', 'number', 'text'],
      synonyms: [
        'balance', 'open balance', 'balance due', 'amount due', 'outstanding', 'amount outstanding',
        'remaining balance',
        'solde', 'solde du', 'montant du', 'solde a payer',
      ],
    },
    {
      field: 'client_ref',
      labelFr: 'Client associé',
      labelEn: 'Client reference',
      types: ['id', 'name', 'number', 'text'],
      synonyms: [
        'customer', 'client', 'customer name', 'client name', 'customer id', 'client id', 'contact',
        'bill to', 'nom du client', 'no client', 'numero de client',
      ],
    },
    {
      field: 'job_ref',
      labelFr: 'Job associée',
      labelEn: 'Job reference',
      types: ['id', 'number', 'text'],
      synonyms: [
        'job', 'job number', 'job id', 'job no', 'work order', 'work order number',
        'no de job', 'numero de job',
      ],
    },
    {
      field: 'notes',
      labelFr: 'Notes',
      labelEn: 'Notes',
      types: ['text'],
      synonyms: [
        'notes', 'note', 'memo', 'message', 'message on invoice', 'description', 'comments',
        'commentaires', 'remarques',
      ],
    },
    {
      field: 'external_id',
      labelFr: 'Identifiant externe',
      labelEn: 'External ID',
      types: ['id', 'number', 'text'],
      synonyms: [
        'id', 'external id', 'record id', 'uuid', 'identifiant',
        'po number', 'po', 'purchase order', 'purchase order number', 'bon de commande',
      ],
    },
  ],

  line_item: [
    {
      field: 'item_name',
      labelFr: "Nom de l'article",
      labelEn: 'Item name',
      types: ['name', 'text'],
      required: true,
      synonyms: [
        'item', 'item name', 'product', 'service', 'product service', 'name', 'line item',
        'service name', 'product name',
        'article', 'produit', 'nom', 'libelle', 'nom du service', 'nom de l article',
      ],
    },
    {
      field: 'item_description',
      labelFr: 'Description',
      labelEn: 'Description',
      types: ['text'],
      synonyms: [
        'description', 'item description', 'line description', 'details', 'memo',
        'description de l article', 'description de la ligne',
      ],
    },
    {
      field: 'quantity',
      labelFr: 'Quantité',
      labelEn: 'Quantity',
      types: ['number', 'text'],
      synonyms: ['qty', 'quantity', 'units', 'count', 'quantite', 'qte', 'nombre'],
    },
    {
      field: 'unit_price',
      labelFr: 'Prix unitaire',
      labelEn: 'Unit price',
      types: ['money', 'number', 'text'],
      synonyms: [
        'unit price', 'rate', 'price', 'price each', 'each', 'sales price',
        'prix unitaire', 'prix', 'montant unitaire', 'taux',
      ],
    },
    {
      field: 'line_total',
      labelFr: 'Total de la ligne',
      labelEn: 'Line total',
      types: ['money', 'number', 'text'],
      synonyms: [
        'amount', 'total', 'line total', 'line amount', 'extended amount', 'ext amount',
        'montant', 'total ligne', 'montant de la ligne',
      ],
    },
    {
      field: 'job_ref',
      labelFr: 'Job associée',
      labelEn: 'Job reference',
      types: ['id', 'number', 'text'],
      synonyms: [
        'job', 'job number', 'job id', 'work order', 'no de job', 'numero de job',
      ],
    },
    {
      field: 'invoice_ref',
      labelFr: 'Facture associée',
      labelEn: 'Invoice reference',
      types: ['id', 'number', 'text'],
      synonyms: [
        'invoice', 'invoice number', 'invoice id', 'invoice no',
        'facture', 'no de facture', 'numero de facture',
      ],
    },
  ],

  payment: [
    {
      field: 'amount',
      labelFr: 'Montant',
      labelEn: 'Amount',
      types: ['money', 'number', 'text'],
      required: true,
      synonyms: [
        'amount', 'payment amount', 'total', 'amount paid', 'paid', 'applied amount',
        'montant', 'montant du paiement', 'montant paye',
      ],
    },
    {
      field: 'date',
      labelFr: 'Date',
      labelEn: 'Date',
      types: ['date', 'datetime', 'text'],
      synonyms: [
        'date', 'payment date', 'paid on', 'received date', 'txn date', 'transaction date',
        'date de paiement', 'paye le', 'date recue',
      ],
    },
    {
      field: 'method',
      labelFr: 'Mode de paiement',
      labelEn: 'Payment method',
      types: ['status', 'text'],
      synonyms: [
        'method', 'payment method', 'payment type', 'pay method', 'tender type',
        'mode de paiement', 'methode de paiement', 'type de paiement', 'moyen de paiement',
      ],
    },
    {
      field: 'invoice_ref',
      labelFr: 'Facture associée',
      labelEn: 'Invoice reference',
      types: ['id', 'number', 'text'],
      synonyms: [
        'invoice', 'invoice number', 'invoice id', 'invoice no',
        'facture', 'no de facture', 'numero de facture',
      ],
    },
    {
      field: 'client_ref',
      labelFr: 'Client associé',
      labelEn: 'Client reference',
      types: ['id', 'name', 'number', 'text'],
      synonyms: [
        'customer', 'client', 'customer name', 'client name', 'customer id', 'client id',
        'nom du client', 'no client', 'numero de client',
      ],
    },
    {
      field: 'reference',
      labelFr: 'Référence',
      labelEn: 'Reference',
      types: ['id', 'number', 'text'],
      synonyms: [
        'reference', 'ref', 'reference number', 'confirmation number', 'confirmation',
        'check number', 'cheque number', 'check no', 'transaction id',
        'numero de reference', 'no de reference', 'numero de confirmation', 'numero de cheque', 'no de cheque',
      ],
    },
  ],
};

// ── Catégorie → entité cible ──

export function entityForCategory(cat: MigrationCategory | null): TargetEntity | null {
  switch (cat) {
    case 'clients': return 'client';
    case 'properties': return 'property';
    case 'services': return 'service';
    case 'quotes': return 'quote';
    case 'jobs': return 'job';
    case 'visits': return 'visit';
    case 'invoices': return 'invoice';
    case 'payments': return 'payment';
    default:
      // notes, attachments, team_members, custom_fields : pas d'entité cible v1.
      return null;
  }
}

/** Repli sur le nom de fichier quand la catégorie n'a pas été détectée. Ordre spécifique → générique. */
function entityFromFileName(fileName: string): TargetEntity | null {
  const n = normalizeHeader(fileName);
  const has = (...words: string[]): boolean => words.some((w) => n.includes(w));
  if (has('line item', 'ligne de facture', 'lignes')) return 'line_item';
  if (has('invoice', 'facture')) return 'invoice';
  if (has('payment', 'paiement')) return 'payment';
  if (has('quote', 'estimate', 'proposal', 'soumission', 'devis')) return 'quote';
  if (has('visit', 'appointment', 'schedule', 'rendez vous', 'visite', 'event')) return 'visit';
  if (has('service address', 'propert', 'location', 'emplacement')) return 'property';
  if (has('job', 'work order', 'travaux', 'workorder')) return 'job';
  if (has('client', 'customer', 'contact', 'lead')) return 'client';
  if (has('product', 'service', 'item', 'catalog', 'price list', 'article')) return 'service';
  return null;
}

// ── Index préparé par entité (normalisations pré-calculées) ──

interface PreparedField {
  def: FieldDef;
  exactKeys: Set<string>;
  synonymKeys: Set<string>;
  phrases: string[][]; // jeux de tokens pour le recouvrement partiel
}

const preparedCache = new Map<TargetEntity, PreparedField[]>();

function prepareEntity(entity: TargetEntity): PreparedField[] {
  const cached = preparedCache.get(entity);
  if (cached) return cached;
  const prepared = FIELD_CATALOG[entity].map((def) => {
    const exactKeys = new Set<string>(
      [def.field, def.labelFr, def.labelEn].map(normalizeHeader).filter((k) => k.length > 0),
    );
    const synonymKeys = new Set<string>(
      def.synonyms.map(normalizeHeader).filter((k) => k.length > 0),
    );
    const phrases: string[][] = [];
    const seen = new Set<string>();
    for (const key of [...exactKeys, ...synonymKeys]) {
      if (seen.has(key)) continue;
      seen.add(key);
      phrases.push(key.split(' '));
    }
    return { def, exactKeys, synonymKeys, phrases };
  });
  preparedCache.set(entity, prepared);
  return prepared;
}

function isSubset(small: string[], big: Set<string>): boolean {
  return small.every((t) => big.has(t));
}

/** Meilleur recouvrement de tokens champ ↔ en-tête, en proportion 0..1 (0 si aucun). */
function bestCoverage(headerTokens: string[], field: PreparedField): number {
  const headerSet = new Set(headerTokens);
  let best = 0;
  for (const phrase of field.phrases) {
    const phraseSet = new Set(phrase);
    let shared = 0;
    if (isSubset(phrase, headerSet)) {
      shared = phraseSet.size;
    } else if (isSubset(headerTokens, phraseSet)) {
      shared = headerSet.size;
    } else {
      continue;
    }
    const coverage = shared / Math.max(headerSet.size, phraseSet.size);
    if (coverage > best) best = coverage;
  }
  return best;
}

function suggestionFor(
  entity: TargetEntity,
  prepared: PreparedField[],
  column: AnalyzedColumn,
): MappingSuggestion {
  const base = { columnPosition: column.position, header: column.header, targetEntity: entity };
  const norm = normalizeHeader(column.header);

  if (norm.length > 0) {
    // (1) exact : nom du champ ou libellé fr/en
    for (const f of prepared) {
      if (f.exactKeys.has(norm)) {
        return { ...base, targetField: f.def.field, confidence: 100, reason: 'exact', needsReview: false };
      }
    }
    // (2) synonyme exact
    for (const f of prepared) {
      if (f.synonymKeys.has(norm)) {
        return { ...base, targetField: f.def.field, confidence: 95, reason: 'synonym', needsReview: false };
      }
    }
    // (3) recouvrement de tokens (l'en-tête contient un synonyme, ou l'inverse)
    const headerTokens = norm.split(' ');
    let bestField: PreparedField | null = null;
    let bestCov = 0;
    for (const f of prepared) {
      const cov = bestCoverage(headerTokens, f);
      if (cov > bestCov) {
        bestCov = cov;
        bestField = f;
      }
    }
    if (bestField && bestCov > 0) {
      const confidence = Math.min(88, 78 + Math.round(10 * bestCov));
      return {
        ...base,
        targetField: bestField.def.field,
        confidence,
        reason: 'partial',
        needsReview: confidence < 70,
      };
    }
  }

  // (4) compatibilité de type seule : uniquement si un seul champ candidat
  if (column.detectedType !== 'text') {
    const typeMatches = prepared.filter((f) => f.def.types.includes(column.detectedType));
    if (typeMatches.length === 1) {
      return { ...base, targetField: typeMatches[0].def.field, confidence: 60, reason: 'type', needsReview: true };
    }
  }

  return { ...base, targetField: null, confidence: 0, reason: 'unmatched', needsReview: true };
}

/**
 * Suggestions déterministes pour toutes les colonnes d'un fichier.
 * Jamais deux colonnes à 90+ vers le même champ : la meilleure est conservée,
 * les autres sont rétrogradées en revue (reason 'duplicate_target').
 */
export function suggestMappings(
  category: MigrationCategory | null,
  columns: AnalyzedColumn[],
  fileName: string,
): MappingSuggestion[] {
  const entity = entityForCategory(category) ?? entityFromFileName(fileName);
  if (!entity) {
    return columns.map((c) => ({
      columnPosition: c.position,
      header: c.header,
      targetEntity: null,
      targetField: null,
      confidence: 0,
      reason: 'unmatched',
      needsReview: true,
    }));
  }

  const prepared = prepareEntity(entity);
  const suggestions = columns.map((c) => suggestionFor(entity, prepared, c));

  // Démotion des cibles dupliquées à confiance élevée.
  const byField = new Map<string, MappingSuggestion[]>();
  for (const s of suggestions) {
    if (!s.targetField) continue;
    const group = byField.get(s.targetField);
    if (group) group.push(s);
    else byField.set(s.targetField, [s]);
  }
  for (const group of byField.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(
      (a, b) => b.confidence - a.confidence || a.columnPosition - b.columnPosition,
    );
    for (const loser of sorted.slice(1)) {
      if (loser.confidence >= 90) {
        // 69 : juste sous le seuil d'application automatique (<70) → revue humaine.
        loser.confidence = 69;
        loser.reason = 'duplicate_target';
        loser.needsReview = true;
      }
    }
  }

  return suggestions;
}
