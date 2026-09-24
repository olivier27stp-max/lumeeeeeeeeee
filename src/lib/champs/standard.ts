/**
 * Champs STANDARD — les champs natifs de chaque objet, dans le même
 * vocabulaire que les champs personnalisés. Ils vivent dans le code, pas en
 * base : on ne les crée ni ne les supprime, on les affiche (source
 * « Standard », lecture seule) et on les réserve (une clé personnalisée ne
 * peut pas porter leur nom).
 *
 * La liste des clés est recopiée dans la fonction SQL cf_cles_standard() ;
 * tests/champs-perso-standard-parite.test.ts compare les deux.
 */
import type { ObjetChamp, TypeChamp } from './types';

export interface ChampStandard {
  key: string;
  label: { fr: string; en: string };
  field_type: TypeChamp;
  /** Toujours couvert par la recherche globale (search_global). */
  cherchable: boolean;
}

const s = (key: string, fr: string, en: string, field_type: TypeChamp, cherchable = false): ChampStandard =>
  ({ key, label: { fr, en }, field_type, cherchable });

export const CHAMPS_STANDARD: Record<ObjetChamp, ChampStandard[]> = {
  client: [
    s('first_name', 'Prénom', 'First name', 'single_line', true),
    s('last_name', 'Nom', 'Last name', 'single_line', true),
    s('name', 'Nom complet', 'Full name', 'single_line', true),
    s('company', 'Entreprise', 'Company', 'single_line', true),
    s('email', 'Courriel', 'Email', 'email', true),
    s('phone', 'Téléphone', 'Phone', 'phone', true),
    s('address', 'Adresse', 'Address', 'single_line', true),
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
    s('title', 'Titre', 'Title', 'single_line'),
    s('stage', 'Étape', 'Stage', 'dropdown_single'),
    s('pipeline', 'Pipeline', 'Pipeline', 'dropdown_single'),
    s('source', 'Source', 'Source', 'dropdown_single'),
    s('assigned_user', 'Responsable', 'Owner', 'dropdown_single'),
    s('amount', 'Montant', 'Amount', 'monetary'),
    s('probability', 'Probabilité', 'Probability', 'number'),
    s('expected_close_date', 'Fermeture prévue', 'Expected close', 'date'),
    s('lost_reason', 'Raison de perte', 'Lost reason', 'single_line'),
    s('status', 'Statut', 'Status', 'dropdown_single'),
    s('created_at', 'Créé le', 'Created', 'date'),
    s('updated_at', 'Modifié le', 'Updated', 'date'),
  ],
  job: [
    s('title', 'Titre', 'Title', 'single_line', true),
    s('job_number', 'Numéro', 'Number', 'single_line', true),
    s('status', 'Statut', 'Status', 'dropdown_single'),
    s('client', 'Client', 'Client', 'single_line', true),
    s('address', 'Adresse', 'Address', 'single_line'),
    s('scheduled_at', 'Planifié le', 'Scheduled', 'date'),
    s('total', 'Total', 'Total', 'monetary'),
    s('notes', 'Notes', 'Notes', 'multi_line'),
    s('created_at', 'Créé le', 'Created', 'date'),
    s('updated_at', 'Modifié le', 'Updated', 'date'),
  ],
  quote: [
    s('title', 'Titre', 'Title', 'single_line', true),
    s('quote_number', 'Numéro', 'Number', 'single_line', true),
    s('status', 'Statut', 'Status', 'dropdown_single'),
    s('client', 'Client', 'Client', 'single_line', true),
    s('total', 'Total', 'Total', 'monetary'),
    s('valid_until', 'Valide jusqu’au', 'Valid until', 'date'),
    s('notes', 'Notes', 'Notes', 'multi_line'),
    s('created_at', 'Créé le', 'Created', 'date'),
    s('updated_at', 'Modifié le', 'Updated', 'date'),
  ],
  invoice: [
    s('invoice_number', 'Numéro', 'Number', 'single_line', true),
    s('status', 'Statut', 'Status', 'dropdown_single'),
    s('client', 'Client', 'Client', 'single_line', true),
    s('total', 'Total', 'Total', 'monetary'),
    s('due_date', 'Échéance', 'Due date', 'date'),
    s('balance', 'Solde', 'Balance', 'monetary'),
    s('notes', 'Notes', 'Notes', 'multi_line'),
    s('created_at', 'Créé le', 'Created', 'date'),
    s('updated_at', 'Modifié le', 'Updated', 'date'),
  ],
};

export function clesStandard(objet: ObjetChamp): string[] {
  return CHAMPS_STANDARD[objet].map((c) => c.key);
}
