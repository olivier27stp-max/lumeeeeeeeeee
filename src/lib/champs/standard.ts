/**
 * Champs SYSTÈME — les champs réellement affichés par les formulaires de
 * création (audit du 2026-09-28, AUDIT_FORMULAIRES_CHAMPS_2026-09-28.md),
 * rangés dans la section où ils apparaissent. Chaque section est un dossier
 * système de l'objet (custom_field_folders.cle_systeme) : un champ
 * personnalisé rangé dans ce dossier s'affiche à la fin de la section.
 *
 * Formulaires de référence : Nouveau client, Nouvelle job, Nouveau devis,
 * Facture (création / modification), Nouveau deal, Propriétés de la fiche client.
 *
 * Ils vivent dans le code, pas en base : on ne les crée ni ne les supprime, on
 * les affiche (source « Standard », cadenas) et on réserve leur clé. Les
 * attributs sans section (créé le, statut…) ne sont dans aucun formulaire :
 * leur clé reste seulement réservée.
 *
 * Recopiés en SQL : clés dans cf_cles_standard(), sections dans
 * cf_sections_systeme() — tests/champs-perso-parite.test.ts compare.
 */
import type { ObjetChamp, TypeChamp } from './types';

export interface SectionSysteme {
  cle: string;
  nom: { fr: string; en: string };
}

export interface ChampStandard {
  key: string;
  label: { fr: string; en: string };
  field_type: TypeChamp;
  /** Toujours couvert par la recherche globale (search_global). */
  cherchable: boolean;
  /** Section du formulaire (clé du dossier système) ; absente = pas dans le formulaire. */
  section?: string;
}

/** Sections des formulaires, dans l'ordre de l'écran. */
export const SECTIONS_SYSTEME: Record<ObjetChamp, SectionSysteme[]> = {
  client: [
    { cle: 'coordonnees', nom: { fr: 'Coordonnées', en: 'Contact details' } },
    { cle: 'lead', nom: { fr: 'Informations du lead', en: 'Lead information' } },
    { cle: 'adresse', nom: { fr: 'Adresse de la propriété', en: 'Property address' } },
  ],
  deal: [
    { cle: 'depart', nom: { fr: 'Deal', en: 'Deal' } },
    { cle: 'contact', nom: { fr: 'Contact', en: 'Contact' } },
    { cle: 'previsions', nom: { fr: 'Prévisions', en: 'Forecast' } },
  ],
  job: [
    { cle: 'details', nom: { fr: 'Détails', en: 'Details' } },
    { cle: 'client', nom: { fr: 'Client', en: 'Client' } },
    { cle: 'type', nom: { fr: 'Type de job', en: 'Job type' } },
    { cle: 'visites', nom: { fr: 'Visites', en: 'Visits' } },
    { cle: 'assignation', nom: { fr: 'Assignation', en: 'Assignment' } },
    { cle: 'facturation', nom: { fr: 'Facturation et paiement', en: 'Billing & payment' } },
    { cle: 'produits', nom: { fr: 'Produits / Services', en: 'Products / Services' } },
    { cle: 'contrat', nom: { fr: 'Contrat', en: 'Agreement' } },
    { cle: 'notes', nom: { fr: 'Notes', en: 'Notes' } },
  ],
  quote: [
    { cle: 'contact', nom: { fr: 'Contact', en: 'Contact' } },
    { cle: 'details', nom: { fr: 'Détails du devis', en: 'Quote details' } },
    { cle: 'photos', nom: { fr: 'Photos', en: 'Photos' } },
    { cle: 'introduction', nom: { fr: 'Introduction', en: 'Introduction' } },
    { cle: 'produits', nom: { fr: 'Produit / Service', en: 'Product / Service' } },
    { cle: 'contrat', nom: { fr: 'Contrat / Clause', en: 'Contract / Disclaimer' } },
    { cle: 'message', nom: { fr: 'Message au client', en: 'Client message' } },
    { cle: 'notes', nom: { fr: 'Notes', en: 'Notes' } },
    { cle: 'resume', nom: { fr: 'Résumé', en: 'Summary' } },
    { cle: 'acompte', nom: { fr: 'Acompte et paiement', en: 'Deposit & payment' } },
  ],
  invoice: [
    { cle: 'client', nom: { fr: 'Client', en: 'Client' } },
    { cle: 'details', nom: { fr: 'Détails', en: 'Details' } },
    { cle: 'articles', nom: { fr: 'Articles', en: 'Line items' } },
    { cle: 'totaux', nom: { fr: 'Totaux', en: 'Totals' } },
    { cle: 'notes', nom: { fr: 'Notes', en: 'Notes' } },
  ],
  property: [
    { cle: 'propriete', nom: { fr: 'Propriété', en: 'Property' } },
  ],
};

const s = (key: string, fr: string, en: string, field_type: TypeChamp, section?: string, cherchable = false): ChampStandard =>
  ({ key, label: { fr, en }, field_type, cherchable, ...(section ? { section } : {}) });

export const CHAMPS_STANDARD: Record<ObjetChamp, ChampStandard[]> = {
  client: [
    s('first_name', 'Prénom', 'First name', 'single_line', 'coordonnees', true),
    s('last_name', 'Nom de famille', 'Last name', 'single_line', 'coordonnees', true),
    s('client_number', 'Numéro de client', 'Client number', 'single_line', 'coordonnees', true),
    s('company', 'Nom de la compagnie', 'Company name', 'single_line', 'coordonnees', true),
    s('display_as_company', 'Utiliser le nom de la compagnie comme nom du client', 'Use company name as client name', 'checkbox', 'coordonnees'),
    s('phone', 'Numéro de téléphone', 'Phone number', 'phone', 'coordonnees', true),
    s('email', 'Courriel', 'Email', 'email', 'coordonnees', true),
    s('lead_source', 'Source du lead', 'Lead source', 'dropdown_single', 'lead'),
    s('address', 'Adresse', 'Address', 'single_line', 'adresse', true),
    s('taxes', 'Taxes', 'Taxes', 'dropdown_multi', 'adresse'),
    s('billing_same_as_service', 'L’adresse de facturation est identique à l’adresse de la propriété', 'Billing address is the same as property address', 'checkbox', 'adresse'),
    s('billing_address', 'Adresse de facturation', 'Billing address', 'single_line', 'adresse'),
    s('name', 'Nom complet', 'Full name', 'single_line', undefined, true),
    s('city', 'Ville', 'City', 'single_line'),
    s('province', 'Province', 'Province', 'single_line'),
    s('postal_code', 'Code postal', 'Postal code', 'single_line'),
    s('status', 'Statut', 'Status', 'dropdown_single'),
    s('source', 'Source', 'Source', 'dropdown_single'),
    s('notes', 'Notes', 'Notes', 'multi_line'),
    s('created_at', 'Créé le', 'Created', 'date'),
    s('updated_at', 'Modifié le', 'Updated', 'date'),
  ],
  deal: [
    s('pipeline', 'Pipeline', 'Pipeline', 'dropdown_single', 'depart'),
    s('client', 'Client existant, devis ou nouveau contact', 'Existing client, quote or new contact', 'dropdown_single', 'contact'),
    s('first_name', 'Prénom', 'First name', 'single_line', 'contact'),
    s('last_name', 'Nom', 'Last name', 'single_line', 'contact'),
    s('email', 'Courriel', 'Email', 'email', 'contact'),
    s('phone', 'Téléphone', 'Phone', 'phone', 'contact'),
    s('address', 'Adresse', 'Address', 'single_line', 'contact'),
    s('amount', 'Montant estimé', 'Estimated amount', 'monetary', 'previsions'),
    s('expected_close_date', 'Fermeture visée', 'Expected close', 'date', 'previsions'),
    s('assigned_user', 'Responsable', 'Assignee', 'dropdown_single', 'previsions'),
    s('source', 'Source', 'Source', 'dropdown_single', 'previsions'),
    s('title', 'Titre', 'Title', 'single_line'),
    s('stage', 'Étape', 'Stage', 'dropdown_single'),
    s('probability', 'Probabilité', 'Probability', 'number'),
    s('lost_reason', 'Raison de perte', 'Lost reason', 'single_line'),
    s('status', 'Statut', 'Status', 'dropdown_single'),
    s('created_at', 'Créé le', 'Created', 'date'),
    s('updated_at', 'Modifié le', 'Updated', 'date'),
  ],
  job: [
    s('title', 'Titre', 'Title', 'single_line', 'details', true),
    s('job_number', 'Job #', 'Job #', 'single_line', 'details', true),
    s('salesperson', 'Vendeur', 'Salesperson', 'dropdown_single', 'details'),
    s('sale_date', 'Date de création', 'Date of creation', 'date', 'details'),
    s('show_on_leaderboard', 'Afficher sur le leaderboard', 'Show on leaderboard', 'checkbox', 'details'),
    s('ask_for_review', 'Demander un avis', 'Ask for a review', 'checkbox', 'details'),
    s('client', 'Client', 'Client', 'dropdown_single', 'client', true),
    s('property', 'Propriété', 'Property', 'dropdown_single', 'client'),
    s('job_type', 'Service ponctuel ou forfait de service', 'One-off or service plan', 'dropdown_single', 'type'),
    s('visits', 'Visites', 'Visits', 'date', 'visites'),
    s('team', 'Équipe', 'Team', 'dropdown_single', 'assignation'),
    s('requires_invoicing', 'Me rappeler de facturer', 'Remind me to invoice', 'checkbox', 'facturation'),
    s('billing_split', 'Diviser en plusieurs factures', 'Split into multiple invoices', 'checkbox', 'facturation'),
    s('deposit_required', 'Exiger un dépôt', 'Require deposit', 'checkbox', 'facturation'),
    s('deposit_type', 'Type de dépôt', 'Deposit type', 'dropdown_single', 'facturation'),
    s('deposit_value', 'Valeur du dépôt', 'Deposit value', 'number', 'facturation'),
    s('require_payment_method', 'Demander un moyen de paiement au dossier', 'Request a payment method on file', 'checkbox', 'facturation'),
    s('line_items', 'Produits et services', 'Products and services', 'multi_line', 'produits'),
    s('taxes', 'Taxes', 'Taxes', 'dropdown_multi', 'produits'),
    s('agreement', 'Créer un contrat', 'Create agreement', 'checkbox', 'contrat'),
    s('notes', 'Notes', 'Notes', 'multi_line', 'notes'),
    s('status', 'Statut', 'Status', 'dropdown_single'),
    s('address', 'Adresse', 'Address', 'single_line'),
    s('scheduled_at', 'Planifié le', 'Scheduled', 'date'),
    s('total', 'Total', 'Total', 'monetary'),
    s('created_at', 'Créé le', 'Created', 'date'),
    s('updated_at', 'Modifié le', 'Updated', 'date'),
  ],
  quote: [
    s('client', 'Client', 'Client', 'dropdown_single', 'contact', true),
    s('quote_type', 'Devis ponctuel ou plan de service', 'One-off quote or service plan', 'dropdown_single', 'details'),
    s('title', 'Titre', 'Title', 'single_line', 'details', true),
    s('property', 'Propriété', 'Property', 'dropdown_single', 'details'),
    s('quote_number', 'Devis #', 'Quote #', 'single_line', 'details', true),
    s('salesperson', 'Vendeur', 'Salesperson', 'dropdown_single', 'details'),
    s('valid_days', 'Valide pendant (jours)', 'Valid for (days)', 'number', 'details'),
    s('photos', 'Photos', 'Photos', 'file', 'photos'),
    s('introduction', 'Introduction', 'Introduction', 'multi_line', 'introduction'),
    s('line_items', 'Produits et services', 'Products and services', 'multi_line', 'produits'),
    s('contract_disclaimer', 'Contrat / Clause', 'Contract / Disclaimer', 'multi_line', 'contrat'),
    s('client_message', 'Message au client', 'Client message', 'multi_line', 'message'),
    s('notes', 'Notes', 'Notes', 'multi_line', 'notes'),
    s('discount', 'Rabais', 'Discount', 'monetary', 'resume'),
    s('tax', 'Taxe', 'Tax', 'monetary', 'resume'),
    s('deposit_required', 'Exiger un acompte', 'Require deposit', 'checkbox', 'acompte'),
    s('deposit_type', 'Type d’acompte', 'Deposit type', 'dropdown_single', 'acompte'),
    s('deposit_value', 'Montant de l’acompte', 'Deposit amount', 'number', 'acompte'),
    s('require_payment_method', 'Exiger un moyen de paiement enregistré', 'Require payment method on file', 'checkbox', 'acompte'),
    s('status', 'Statut', 'Status', 'dropdown_single'),
    s('total', 'Total', 'Total', 'monetary'),
    s('valid_until', 'Valide jusqu’au', 'Valid until', 'date'),
    s('created_at', 'Créé le', 'Created', 'date'),
    s('updated_at', 'Modifié le', 'Updated', 'date'),
  ],
  invoice: [
    s('client', 'Client', 'Client', 'dropdown_single', 'client', true),
    s('subject', 'Sujet', 'Subject', 'single_line', 'details'),
    s('invoice_date', 'Date de création', 'Date of creation', 'date', 'details'),
    s('due_date', 'Date d’échéance', 'Due date', 'date', 'details'),
    s('salesperson', 'Vendeur', 'Salesperson', 'dropdown_single', 'details'),
    s('line_items', 'Articles', 'Line items', 'multi_line', 'articles'),
    s('discount', 'Remise', 'Discount', 'monetary', 'totaux'),
    s('tax', 'Taxe', 'Tax', 'monetary', 'totaux'),
    s('notes', 'Notes (visible au client)', 'Notes (visible to client)', 'multi_line', 'notes'),
    s('internal_notes', 'Notes internes', 'Internal notes', 'multi_line', 'notes'),
    s('invoice_number', 'Numéro', 'Number', 'single_line', undefined, true),
    s('status', 'Statut', 'Status', 'dropdown_single'),
    s('total', 'Total', 'Total', 'monetary'),
    s('balance', 'Solde', 'Balance', 'monetary'),
    s('created_at', 'Créé le', 'Created', 'date'),
    s('updated_at', 'Modifié le', 'Updated', 'date'),
  ],
  property: [
    s('name', 'Nom', 'Name', 'single_line', 'propriete', true),
    s('address', 'Adresse', 'Address', 'single_line', 'propriete', true),
    s('city', 'Ville', 'City', 'single_line'),
    s('province', 'Province', 'Province', 'single_line'),
    s('postal_code', 'Code postal', 'Postal code', 'single_line'),
    s('country', 'Pays', 'Country', 'single_line'),
    s('client', 'Client', 'Client', 'single_line', undefined, true),
    s('kind', 'Type d’adresse', 'Address kind', 'dropdown_single'),
    s('is_primary', 'Principale', 'Primary', 'checkbox'),
    s('created_at', 'Créé le', 'Created', 'date'),
    s('updated_at', 'Modifié le', 'Updated', 'date'),
  ],
};

export function clesStandard(objet: ObjetChamp): string[] {
  return CHAMPS_STANDARD[objet].map((c) => c.key);
}

/** Les champs système visibles dans les formulaires (ceux qui ont une section). */
export function champsSysteme(objet: ObjetChamp): ChampStandard[] {
  return CHAMPS_STANDARD[objet].filter((c) => c.section);
}

/** Nom affiché d'un dossier système (la base garde le nom français). */
export function nomSection(objet: ObjetChamp, cle: string, fr: boolean): string | null {
  const s = SECTIONS_SYSTEME[objet].find((x) => x.cle === cle);
  return s ? (fr ? s.nom.fr : s.nom.en) : null;
}

/** Nom affiché d'un dossier : traduit s'il est système, tel quel sinon. */
export function nomDossier(d: { object_type: ObjetChamp; name: string; cle_systeme?: string | null }, fr: boolean): string {
  return (d.cle_systeme && nomSection(d.object_type, d.cle_systeme, fr)) || d.name;
}
