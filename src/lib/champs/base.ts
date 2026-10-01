/**
 * Champs personnalisés DE BASE (migration 20261005400000_menage_champs_de_base,
 * qui a réduit la liste de 20261003520000 : 31 → 8, demande de Rafba) : posés
 * d\'office dans chaque entreprise, rangés dans les dossiers système (sections
 * du formulaire). Recopie EXACTE de cf_champs_base() — tests/champs-de-base.test.ts
 * compare les deux. Les dépenses (Carburant, Sous-traitance, Autres) sont dans
 * cf_depenses_champs_base().
 *
 * Garder la liste COURTE : un champ que personne ne remplit encombre chaque
 * formulaire. Les champs par métier (modeles.ts) restent l'extra.
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
  { objet: 'client', dossier: 'coordonnees', cle: 'courriel_facturation', fr: 'Courriel de facturation', en: 'Billing email', type: 'email', config: { masque_creation: true } },
  { objet: 'client', dossier: 'lead', cle: 'refere_par', fr: 'Référé par', en: 'Referred by', type: 'single_line' },
  { objet: 'client', dossier: 'adresse', cle: 'code_acces', fr: 'Code d\'accès', en: 'Access code', type: 'single_line' },
  { objet: 'client', dossier: 'adresse', cle: 'instructions_acces', fr: 'Instructions d\'accès', en: 'Access instructions', type: 'multi_line', config: { masque_creation: true } },
  { objet: 'job', dossier: 'notes', cle: 'instructions_speciales', fr: 'Instructions spéciales', en: 'Special instructions', type: 'multi_line' },
  { objet: 'quote', dossier: 'details', cle: 'motif_refus', fr: 'Motif de refus', en: 'Reason declined', type: 'dropdown_single', config: { masque_creation: true }, options: [{ fr: 'Prix', en: 'Price', color: '#dc2626' }, { fr: 'Délai', en: 'Timing', color: '#d97706' }, { fr: 'Concurrent', en: 'Competitor', color: '#7c3aed' }, { fr: 'Projet annulé', en: 'Project cancelled', color: '#94a3b8' }, { fr: 'Autre', en: 'Other' }] },
  { objet: 'property', dossier: 'propriete', cle: 'superficie_pi2', fr: 'Superficie (pi²)', en: 'Area (sq ft)', type: 'number', config: { decimals: 0, min: 0, max: 10000000 } },
  { objet: 'property', dossier: 'propriete', cle: 'nb_etages', fr: 'Nombre d\'étages', en: 'Number of floors', type: 'number', config: { decimals: 0, min: 1, max: 200 } },
];
