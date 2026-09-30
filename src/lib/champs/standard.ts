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
  /**
   * Toujours affiché dans le formulaire (cadenas dans « Gérer les champs »). Tous les
   * champs des formulaires de base le sont : seuls les champs personnalisés se
   * décochent (décision de Rafba, 2026-09-28, qui remplace « décochables par défaut »).
   */
  verrouille?: boolean;
  /**
   * Morceau d'un autre champ du formulaire (ville, code postal… remplis par l'adresse) :
   * a sa clé et son dossier, mais s'affiche et se retire avec ce champ-là.
   */
  suit?: string;
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

// Un champ rangé dans une section du formulaire est verrouillé d'office.
const s = (key: string, fr: string, en: string, field_type: TypeChamp, section?: string, cherchable = false): ChampStandard =>
  ({ key, label: { fr, en }, field_type, cherchable, ...(section ? { section, verrouille: true } : {}) });
const verrou = (c: ChampStandard): ChampStandard => ({ ...c, verrouille: true });
const suit = (parent: string, c: ChampStandard): ChampStandard => ({ ...c, suit: parent });

export const CHAMPS_STANDARD: Record<ObjetChamp, ChampStandard[]> = {
  client: [
    verrou(s('first_name', 'Prénom', 'First name', 'single_line', 'coordonnees', true)),
    verrou(s('last_name', 'Nom de famille', 'Last name', 'single_line', 'coordonnees', true)),
    s('client_number', 'Numéro de client', 'Client number', 'single_line', 'coordonnees', true),
    s('company', 'Nom de la compagnie', 'Company name', 'single_line', 'coordonnees', true),
    s('display_as_company', 'Utiliser le nom de la compagnie comme nom du client', 'Use company name as client name', 'checkbox', 'coordonnees'),
    s('phone', 'Numéro de téléphone', 'Phone number', 'phone', 'coordonnees', true),
    s('phone_label', 'Type de numéro', 'Phone type', 'dropdown_single', 'coordonnees'),
    s('other_phones', 'Autres numéros de téléphone', 'Other phone numbers', 'multi_line', 'coordonnees'),
    s('email', 'Courriel', 'Email', 'email', 'coordonnees', true),
    s('email_label', 'Type de courriel', 'Email type', 'dropdown_single', 'coordonnees'),
    s('lead_source', 'Source du lead', 'Lead source', 'dropdown_single', 'lead'),
    s('address', 'Adresse', 'Address', 'single_line', 'adresse', true),
    suit('address', s('street', 'Numéro et rue', 'Street', 'single_line', 'adresse')),
    suit('address', s('city', 'Ville', 'City', 'single_line', 'adresse')),
    suit('address', s('province', 'Province', 'Province', 'single_line', 'adresse')),
    suit('address', s('postal_code', 'Code postal', 'Postal code', 'single_line', 'adresse')),
    suit('address', s('country', 'Pays', 'Country', 'single_line', 'adresse')),
    s('taxes', 'Taxes', 'Taxes', 'dropdown_multi', 'adresse'),
    s('billing_same_as_service', 'L’adresse de facturation est identique à l’adresse de la propriété', 'Billing address is the same as property address', 'checkbox', 'adresse'),
    s('billing_address', 'Adresse de facturation', 'Billing address', 'single_line', 'adresse'),
    s('name', 'Nom complet', 'Full name', 'single_line', undefined, true),
    s('status', 'Statut', 'Status', 'dropdown_single'),
    s('source', 'Source', 'Source', 'dropdown_single'),
    s('notes', 'Notes', 'Notes', 'multi_line'),
    s('created_at', 'Créé le', 'Created', 'date'),
    s('updated_at', 'Modifié le', 'Updated', 'date'),
  ],
  deal: [
    verrou(s('pipeline', 'Pipeline', 'Pipeline', 'dropdown_single', 'depart')),
    verrou(s('client', 'Client existant, devis ou nouveau contact', 'Existing client, quote or new contact', 'dropdown_single', 'contact')),
    verrou(s('first_name', 'Prénom', 'First name', 'single_line', 'contact')),
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
    verrou(s('title', 'Titre', 'Title', 'single_line', 'details', true)),
    s('job_number', 'Job #', 'Job #', 'single_line', 'details', true),
    s('salesperson', 'Vendeur', 'Salesperson', 'dropdown_single', 'details'),
    s('sale_date', 'Date de création', 'Date of creation', 'date', 'details'),
    s('show_on_leaderboard', 'Afficher sur le leaderboard', 'Show on leaderboard', 'checkbox', 'details'),
    s('ask_for_review', 'Demander un avis', 'Ask for a review', 'checkbox', 'details'),
    verrou(s('client', 'Client', 'Client', 'dropdown_single', 'client', true)),
    // La job exige une propriété (NewJobModal refuse sans) : verrouillée.
    verrou(s('property', 'Propriété', 'Property', 'dropdown_single', 'client')),
    s('job_type', 'Service ponctuel ou forfait de service', 'One-off or service plan', 'dropdown_single', 'type'),
    verrou(s('visits', 'Visites — date de début', 'Visits — start date', 'date', 'visites')),
    verrou(s('visit_start_time', 'Heure de début', 'Start time', 'single_line', 'visites')),
    verrou(s('visit_end_time', 'Heure de fin', 'End time', 'single_line', 'visites')),
    verrou(s('team', 'Équipe', 'Team', 'dropdown_single', 'assignation')),
    s('requires_invoicing', 'Me rappeler de facturer', 'Remind me to invoice', 'checkbox', 'facturation'),
    s('billing_split', 'Diviser en plusieurs factures', 'Split into multiple invoices', 'checkbox', 'facturation'),
    s('deposit_required', 'Exiger un dépôt', 'Require deposit', 'checkbox', 'facturation'),
    s('deposit_type', 'Type de dépôt', 'Deposit type', 'dropdown_single', 'facturation'),
    s('deposit_value', 'Valeur du dépôt', 'Deposit value', 'number', 'facturation'),
    s('require_payment_method', 'Demander un moyen de paiement au dossier', 'Request a payment method on file', 'checkbox', 'facturation'),
    verrou(s('line_items', 'Produits et services', 'Products and services', 'multi_line', 'produits')),
    verrou(s('taxes', 'Taxes', 'Taxes', 'dropdown_multi', 'produits')),
    verrou(s('subtotal', 'Sous-total', 'Subtotal', 'monetary', 'produits')),
    s('agreement', 'Créer un contrat', 'Create agreement', 'checkbox', 'contrat'),
    s('notes', 'Notes', 'Notes', 'multi_line', 'notes'),
    s('status', 'Statut', 'Status', 'dropdown_single'),
    s('address', 'Adresse', 'Address', 'single_line'),
    s('scheduled_at', 'Planifié le', 'Scheduled', 'date'),
    verrou(s('total', 'Total', 'Total', 'monetary', 'produits')),
    s('created_at', 'Créé le', 'Created', 'date'),
    s('updated_at', 'Modifié le', 'Updated', 'date'),
  ],
  quote: [
    verrou(s('client', 'Client', 'Client', 'dropdown_single', 'contact', true)),
    s('quote_type', 'Devis ponctuel ou plan de service', 'One-off quote or service plan', 'dropdown_single', 'details'),
    s('title', 'Titre', 'Title', 'single_line', 'details', true),
    s('property', 'Propriété', 'Property', 'dropdown_single', 'details'),
    s('quote_number', 'Devis #', 'Quote #', 'single_line', 'details', true),
    s('salesperson', 'Vendeur', 'Salesperson', 'dropdown_single', 'details'),
    s('valid_days', 'Valide pendant (jours)', 'Valid for (days)', 'number', 'details'),
    s('photos', 'Photos', 'Photos', 'file', 'photos'),
    s('introduction', 'Introduction', 'Introduction', 'multi_line', 'introduction'),
    verrou(s('line_items', 'Produits et services', 'Products and services', 'multi_line', 'produits')),
    s('contract_disclaimer', 'Contrat / Clause', 'Contract / Disclaimer', 'multi_line', 'contrat'),
    s('client_message', 'Message au client', 'Client message', 'multi_line', 'message'),
    s('notes', 'Notes', 'Notes', 'multi_line', 'notes'),
    s('specific_notes', 'Notes spécifiques', 'Specific notes', 'multi_line', 'notes'),
    verrou(s('subtotal', 'Sous-total', 'Subtotal', 'monetary', 'resume')),
    s('discount', 'Rabais', 'Discount', 'monetary', 'resume'),
    verrou(s('tax', 'Taxe', 'Tax', 'monetary', 'resume')),
    s('deposit_required', 'Exiger un acompte', 'Require deposit', 'checkbox', 'acompte'),
    s('deposit_type', 'Type d’acompte', 'Deposit type', 'dropdown_single', 'acompte'),
    s('deposit_value', 'Montant de l’acompte', 'Deposit amount', 'number', 'acompte'),
    s('require_payment_method', 'Exiger un moyen de paiement enregistré', 'Require payment method on file', 'checkbox', 'acompte'),
    s('status', 'Statut', 'Status', 'dropdown_single'),
    verrou(s('total', 'Total', 'Total', 'monetary', 'resume')),
    s('valid_until', 'Valide jusqu’au', 'Valid until', 'date'),
    s('created_at', 'Créé le', 'Created', 'date'),
    s('updated_at', 'Modifié le', 'Updated', 'date'),
  ],
  invoice: [
    verrou(s('client', 'Client', 'Client', 'dropdown_single', 'client', true)),
    s('subject', 'Sujet', 'Subject', 'single_line', 'details'),
    s('invoice_date', 'Date de création', 'Date of creation', 'date', 'details'),
    s('due_date', 'Date d’échéance', 'Due date', 'date', 'details'),
    s('salesperson', 'Vendeur', 'Salesperson', 'dropdown_single', 'details'),
    verrou(s('line_items', 'Articles', 'Line items', 'multi_line', 'articles')),
    verrou(s('subtotal', 'Sous-total', 'Subtotal', 'monetary', 'totaux')),
    s('discount', 'Remise', 'Discount', 'monetary', 'totaux'),
    verrou(s('tax', 'Taxe', 'Tax', 'monetary', 'totaux')),
    s('notes', 'Notes (visible au client)', 'Notes (visible to client)', 'multi_line', 'notes'),
    s('internal_notes', 'Notes internes', 'Internal notes', 'multi_line', 'notes'),
    s('invoice_number', 'Numéro', 'Number', 'single_line', undefined, true),
    s('status', 'Statut', 'Status', 'dropdown_single'),
    verrou(s('total', 'Total', 'Total', 'monetary', 'totaux')),
    s('balance', 'Solde', 'Balance', 'monetary'),
    s('created_at', 'Créé le', 'Created', 'date'),
    s('updated_at', 'Modifié le', 'Updated', 'date'),
  ],
  property: [
    verrou(s('name', 'Nom', 'Name', 'single_line', 'propriete', true)),
    verrou(s('address', 'Adresse', 'Address', 'single_line', 'propriete', true)),
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

/**
 * Rangées des formulaires de base, dans l'ordre de l'écran : les champs d'une même
 * ligne (prénom + nom, numéro + type…) forment une rangée. Une custom key se glisse
 * APRÈS une rangée (`config.apres` = 1re clé de la rangée) ; chaque formulaire pose
 * un emplacement `apres(clé)` sous chaque rangée qui n'est pas la dernière de sa
 * section (après la dernière = fin de section, déjà couvert par `section()`).
 * Objet absent : une rangée par section (on ne place qu'en fin de section).
 */
export const RANGEES_FORMULAIRE: Partial<Record<ObjetChamp, string[][]>> = {
  client: [
    ['first_name', 'last_name'], ['client_number'], ['company', 'display_as_company'],
    ['phone', 'phone_label', 'other_phones'], ['email', 'email_label'],
    ['lead_source'],
    ['address'], ['taxes'], ['billing_same_as_service', 'billing_address'],
  ],
  quote: [
    ['client'],
    ['quote_type', 'title'], ['property', 'quote_number', 'salesperson', 'valid_days'],
    ['photos'], ['introduction'], ['line_items'], ['contract_disclaimer'], ['client_message'],
    ['notes'], ['specific_notes'],
    ['subtotal', 'discount', 'tax', 'total'],
    ['deposit_required', 'deposit_type', 'deposit_value', 'require_payment_method'],
  ],
  job: [
    ['title'], ['job_number', 'salesperson'], ['sale_date', 'show_on_leaderboard'], ['ask_for_review'],
    ['client'], ['property'],
    ['job_type'],
    ['visits', 'visit_start_time', 'visit_end_time'],
    ['team'],
    ['requires_invoicing'], ['billing_split'], ['deposit_required', 'deposit_type', 'deposit_value'], ['require_payment_method'],
    ['line_items', 'taxes', 'subtotal', 'total'],
    ['agreement'],
    ['notes'],
  ],
};

export interface RangeeFormulaire { section: string; cles: string[] }

/** Rangées d'un formulaire (champs de base, hors morceaux d'un autre champ), par section. */
export function rangeesFormulaire(objet: ObjetChamp): RangeeFormulaire[] {
  const base = champsSysteme(objet).filter((c) => !c.suit);
  const declarees = RANGEES_FORMULAIRE[objet];
  if (declarees) {
    const sectionDe = new Map(base.map((c) => [c.key, c.section as string]));
    return declarees.map((cles) => ({ section: sectionDe.get(cles[0]) ?? '', cles }));
  }
  return SECTIONS_SYSTEME[objet].flatMap((s) => {
    const cles = base.filter((c) => c.section === s.cle).map((c) => c.key);
    return cles.length ? [{ section: s.cle, cles }] : [];
  });
}

/** Ancres posées dans les formulaires : 1re clé de chaque rangée qui n'est pas la dernière de sa section. */
export function ancresFormulaire(objet: ObjetChamp): Set<string> {
  const r = rangeesFormulaire(objet);
  return new Set(r.filter((x, i) => r.slice(i + 1).some((y) => y.section === x.section)).map((x) => x.cles[0]));
}

/** Nom affiché d'un dossier système (la base garde le nom français). */
export function nomSection(objet: ObjetChamp, cle: string, fr: boolean): string | null {
  const s = SECTIONS_SYSTEME[objet].find((x) => x.cle === cle);
  return s ? (fr ? s.nom.fr : s.nom.en) : null;
}

/**
 * Dossier système « Dépenses » des jobs (migration 20261003470000) : chaque champ
 * MONTANT qu'il contient est compté comme dépense par la rentabilité
 * (server/lib/rentabilite). Ce n'est pas une section du formulaire : il se
 * renomme, mais ne se supprime pas.
 */
export const CLE_DOSSIER_DEPENSES = 'depenses';
const NOM_DEPENSES = { fr: 'Dépenses', en: 'Expenses' };

/** Le dossier peut-il être renommé ? (Les sections du formulaire, non.) */
export const dossierRenommable = (d: { cle_systeme?: string | null }) => !d.cle_systeme || d.cle_systeme === CLE_DOSSIER_DEPENSES;

/** Nom affiché d'un dossier : traduit s'il est système, tel quel sinon. */
export function nomDossier(d: { object_type: ObjetChamp; name: string; cle_systeme?: string | null }, fr: boolean): string {
  if (d.cle_systeme === CLE_DOSSIER_DEPENSES) {
    // Traduit tant qu'il porte son nom d'origine ; renommé, c'est le nom choisi par l'entreprise.
    const n = d.name.trim().toLowerCase();
    return n === NOM_DEPENSES.fr.toLowerCase() || n === NOM_DEPENSES.en.toLowerCase() ? (fr ? NOM_DEPENSES.fr : NOM_DEPENSES.en) : d.name;
  }
  return (d.cle_systeme && nomSection(d.object_type, d.cle_systeme, fr)) || d.name;
}
