/**
 * Champs personnalisés DE BASE (migration 20261003520000_champs_de_base) :
 * posés d\'office dans chaque entreprise, rangés dans les dossiers système
 * (sections du formulaire). Recopie EXACTE de cf_champs_base() —
 * tests/champs-de-base.test.ts compare les deux.
 *
 * Les 12 types de champ y figurent. Même clé + même type sur devis / job /
 * facture = la valeur suit toute seule (numero_bon_commande).
 * config.masque_creation : retiré de la fenêtre de création (reste sur la fiche) ;
 * config.show_on_documents : imprimé sur le devis / la facture remis au client.
 */
import type { ConfigChamp, ObjetChamp, TypeChamp } from './types';

export interface ChampDeBase {
  objet: ObjetChamp;
  /** cle_systeme du dossier (SECTIONS_SYSTEME). */
  dossier: string;
  cle: string;
  fr: string;
  en: string;
  type: TypeChamp;
  config?: ConfigChamp;
  options?: Array<{ fr: string; en: string; color?: string }>;
}

export const CHAMPS_DE_BASE: ChampDeBase[] = [
  { objet: 'client', dossier: 'coordonnees', cle: 'langue_communication', fr: 'Langue de communication', en: 'Communication language', type: 'dropdown_single', options: [{ fr: 'Français', en: 'French', color: '#2563eb' }, { fr: 'Anglais', en: 'English', color: '#dc2626' }] },
  { objet: 'client', dossier: 'coordonnees', cle: 'contact_prefere', fr: 'Moyen de contact préféré', en: 'Preferred contact method', type: 'dropdown_single', options: [{ fr: 'Texto', en: 'Text', color: '#16a34a' }, { fr: 'Appel', en: 'Call', color: '#2563eb' }, { fr: 'Courriel', en: 'Email', color: '#7c3aed' }] },
  { objet: 'client', dossier: 'coordonnees', cle: 'disponibilites', fr: 'Meilleurs moments pour joindre', en: 'Best times to reach', type: 'dropdown_multi', config: { masque_creation: true }, options: [{ fr: 'Matin', en: 'Morning' }, { fr: 'Après-midi', en: 'Afternoon' }, { fr: 'Soir', en: 'Evening' }, { fr: 'Fin de semaine', en: 'Weekend' }] },
  { objet: 'client', dossier: 'coordonnees', cle: 'telephone_secondaire', fr: 'Téléphone secondaire', en: 'Secondary phone', type: 'phone', config: { masque_creation: true } },
  { objet: 'client', dossier: 'coordonnees', cle: 'courriel_facturation', fr: 'Courriel de facturation', en: 'Billing email', type: 'email', config: { masque_creation: true } },
  { objet: 'client', dossier: 'lead', cle: 'refere_par', fr: 'Référé par', en: 'Referred by', type: 'single_line' },
  { objet: 'client', dossier: 'lead', cle: 'budget_estime', fr: 'Budget estimé', en: 'Estimated budget', type: 'monetary', config: { currency: 'CAD' } },
  { objet: 'client', dossier: 'lead', cle: 'date_souhaitee', fr: 'Date souhaitée des travaux', en: 'Desired work date', type: 'date' },
  { objet: 'client', dossier: 'adresse', cle: 'code_acces', fr: 'Code d\'accès', en: 'Access code', type: 'single_line' },
  { objet: 'client', dossier: 'adresse', cle: 'type_batiment', fr: 'Type de bâtiment', en: 'Building type', type: 'dropdown_single', options: [{ fr: 'Résidentiel', en: 'Residential', color: '#2563eb' }, { fr: 'Commercial', en: 'Commercial', color: '#d97706' }, { fr: 'Multilogement', en: 'Multi-unit', color: '#7c3aed' }] },
  { objet: 'client', dossier: 'adresse', cle: 'stationnement', fr: 'Stationnement', en: 'Parking', type: 'dropdown_single', config: { masque_creation: true }, options: [{ fr: 'Dans l\'entrée', en: 'Driveway', color: '#16a34a' }, { fr: 'Dans la rue', en: 'Street', color: '#2563eb' }, { fr: 'Payant', en: 'Paid', color: '#d97706' }, { fr: 'Aucun', en: 'None', color: '#dc2626' }] },
  { objet: 'client', dossier: 'adresse', cle: 'animaux', fr: 'Animaux sur place', en: 'Pets on site', type: 'dropdown_multi', config: { masque_creation: true }, options: [{ fr: 'Chien', en: 'Dog', color: '#d97706' }, { fr: 'Chat', en: 'Cat', color: '#7c3aed' }, { fr: 'Autre', en: 'Other' }] },
  { objet: 'client', dossier: 'adresse', cle: 'instructions_acces', fr: 'Instructions d\'accès', en: 'Access instructions', type: 'multi_line', config: { masque_creation: true } },
  { objet: 'deal', dossier: 'previsions', cle: 'urgence', fr: 'Urgence', en: 'Urgency', type: 'dropdown_single', options: [{ fr: 'Basse', en: 'Low', color: '#94a3b8' }, { fr: 'Moyenne', en: 'Medium', color: '#d97706' }, { fr: 'Haute', en: 'High', color: '#dc2626' }] },
  { objet: 'deal', dossier: 'previsions', cle: 'concurrent', fr: 'Concurrent en lice', en: 'Competitor', type: 'single_line', config: { masque_creation: true } },
  { objet: 'job', dossier: 'details', cle: 'priorite', fr: 'Priorité', en: 'Priority', type: 'dropdown_single', options: [{ fr: 'Normale', en: 'Normal', color: '#94a3b8' }, { fr: 'Haute', en: 'High', color: '#d97706' }, { fr: 'Urgente', en: 'Urgent', color: '#dc2626' }] },
  { objet: 'job', dossier: 'visites', cle: 'duree_estimee_h', fr: 'Durée estimée (h)', en: 'Estimated duration (h)', type: 'number', config: { decimals: 1, min: 0, max: 1000 } },
  { objet: 'job', dossier: 'visites', cle: 'plage_arrivee', fr: 'Plage d\'arrivée', en: 'Arrival window', type: 'dropdown_single', options: [{ fr: 'Matin (8 h – 12 h)', en: 'Morning (8 am – 12 pm)' }, { fr: 'Après-midi (12 h – 17 h)', en: 'Afternoon (12 – 5 pm)' }, { fr: 'Toute la journée', en: 'All day' }] },
  { objet: 'job', dossier: 'assignation', cle: 'nb_techniciens', fr: 'Techniciens requis', en: 'Technicians needed', type: 'number', config: { decimals: 0, min: 1, max: 50 } },
  { objet: 'job', dossier: 'facturation', cle: 'numero_bon_commande', fr: 'N° de bon de commande', en: 'Purchase order no.', type: 'single_line', config: { masque_creation: true } },
  { objet: 'job', dossier: 'notes', cle: 'instructions_speciales', fr: 'Instructions spéciales', en: 'Special instructions', type: 'multi_line' },
  { objet: 'job', dossier: 'notes', cle: 'lien_photos', fr: 'Lien vers les photos', en: 'Photos link', type: 'url', config: { masque_creation: true } },
  { objet: 'job', dossier: 'notes', cle: 'photo_travaux', fr: 'Photo / document des travaux', en: 'Work photo / document', type: 'file', config: { masque_creation: true } },
  { objet: 'job', dossier: 'notes', cle: 'inspection_finale', fr: 'Inspection finale faite', en: 'Final inspection done', type: 'checkbox', config: { masque_creation: true } },
  { objet: 'quote', dossier: 'details', cle: 'date_evaluation', fr: 'Date de la visite d\'évaluation', en: 'Assessment visit date', type: 'date' },
  { objet: 'quote', dossier: 'details', cle: 'numero_bon_commande', fr: 'N° de bon de commande', en: 'Purchase order no.', type: 'single_line', config: { masque_creation: true, show_on_documents: true } },
  { objet: 'quote', dossier: 'details', cle: 'motif_refus', fr: 'Motif de refus', en: 'Reason declined', type: 'dropdown_single', config: { masque_creation: true }, options: [{ fr: 'Prix', en: 'Price', color: '#dc2626' }, { fr: 'Délai', en: 'Timing', color: '#d97706' }, { fr: 'Concurrent', en: 'Competitor', color: '#7c3aed' }, { fr: 'Projet annulé', en: 'Project cancelled', color: '#94a3b8' }, { fr: 'Autre', en: 'Other' }] },
  { objet: 'invoice', dossier: 'details', cle: 'numero_bon_commande', fr: 'N° de bon de commande', en: 'Purchase order no.', type: 'single_line', config: { show_on_documents: true } },
  { objet: 'property', dossier: 'propriete', cle: 'superficie_pi2', fr: 'Superficie (pi²)', en: 'Area (sq ft)', type: 'number', config: { decimals: 0, min: 0, max: 10000000 } },
  { objet: 'property', dossier: 'propriete', cle: 'nb_etages', fr: 'Nombre d\'étages', en: 'Number of floors', type: 'number', config: { decimals: 0, min: 1, max: 200 } },
  { objet: 'property', dossier: 'propriete', cle: 'annee_construction', fr: 'Année de construction', en: 'Year built', type: 'number', config: { decimals: 0, min: 1600, max: 2100 } },
];
