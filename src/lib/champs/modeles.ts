/**
 * Champs personnalisés suggérés par métier (industrie choisie à l'inscription,
 * company_settings.industry — clés de INDUSTRY_KEYS, WorkspaceForm).
 *
 * Une entreprise ne crée presque jamais ses champs seule : on les lui propose
 * (Réglages → Champs personnalisés) et on les pose d'office à l'inscription.
 * Les clés sont FIXES et identiques d'un objet à l'autre : un champ présent
 * sur le devis ET le job (même clé, même type) suit tout seul
 * devis → job → facture (cf_copier_valeurs). Partagé client + serveur.
 */
import type { ObjetChamp, TypeChamp } from './types';

export const INDUSTRIES_MODELES = [
  'landscaping', 'snow_removal', 'residential_cleaning', 'commercial_cleaning',
  'plumbing', 'electrical', 'roofing', 'hvac', 'window_cleaning', 'other',
] as const;
export type IndustrieModele = (typeof INDUSTRIES_MODELES)[number];

export interface ChampModele {
  /** Identifiant du champ dans le modèle (une ligne à cocher). */
  id: string;
  key: string;
  objets: ObjetChamp[];
  field_type: TypeChamp;
  fr: string;
  en: string;
  options?: Array<{ fr: string; en: string; color?: string }>;
  /** Affiché sur le devis / la facture remis au client. */
  document?: boolean;
}

const OUI_NON = [{ fr: 'Oui', en: 'Yes', color: '#16a34a' }, { fr: 'Non', en: 'No', color: '#94a3b8' }];
const code: ChampModele = { id: 'code_acces', key: 'code_acces', objets: ['client'], field_type: 'single_line', fr: 'Code d’accès', en: 'Access code' };
const animaux: ChampModele = {
  id: 'animaux', key: 'animaux', objets: ['client'], field_type: 'dropdown_multi', fr: 'Animaux sur place', en: 'Pets on site',
  options: [{ fr: 'Chien', en: 'Dog', color: '#d97706' }, { fr: 'Chat', en: 'Cat', color: '#7c3aed' }, { fr: 'Autre', en: 'Other' }],
};
const permis: ChampModele = { id: 'permis_requis', key: 'permis_requis', objets: ['job'], field_type: 'dropdown_single', fr: 'Permis requis', en: 'Permit required', options: OUI_NON };
const anneeConstruction: ChampModele = { id: 'annee_construction', key: 'annee_construction', objets: ['client'], field_type: 'number', fr: 'Année de construction', en: 'Year built' };

export const MODELES_CHAMPS: Record<IndustrieModele, ChampModele[]> = {
  window_cleaning: [
    { id: 'type_batiment', key: 'type_batiment', objets: ['client'], field_type: 'dropdown_single', fr: 'Type de bâtiment', en: 'Building type',
      options: [{ fr: 'Résidentiel', en: 'Residential', color: '#2563eb' }, { fr: 'Commercial', en: 'Commercial', color: '#d97706' }, { fr: 'Multilogement', en: 'Multi-unit', color: '#7c3aed' }] },
    { id: 'nb_fenetres', key: 'nb_fenetres', objets: ['quote', 'job', 'invoice'], field_type: 'number', fr: 'Nombre de fenêtres', en: 'Number of windows', document: true },
    { id: 'nb_etages', key: 'nb_etages', objets: ['quote', 'job'], field_type: 'number', fr: 'Nombre d’étages', en: 'Number of floors' },
    { id: 'equipement', key: 'equipement', objets: ['job'], field_type: 'dropdown_multi', fr: 'Équipement requis', en: 'Equipment needed',
      options: [{ fr: 'Échelle', en: 'Ladder' }, { fr: 'Perche', en: 'Water-fed pole' }, { fr: 'Nacelle', en: 'Lift' }, { fr: 'Harnais', en: 'Harness' }] },
    code,
  ],
  landscaping: [
    { id: 'superficie_terrain', key: 'superficie_terrain', objets: ['client', 'quote'], field_type: 'number', fr: 'Superficie du terrain (pi²)', en: 'Lot size (sq ft)', document: true },
    { id: 'irrigation', key: 'irrigation', objets: ['client'], field_type: 'dropdown_single', fr: 'Système d’irrigation', en: 'Irrigation system', options: OUI_NON },
    { id: 'acces_machinerie', key: 'acces_machinerie', objets: ['client'], field_type: 'dropdown_single', fr: 'Accès pour la machinerie', en: 'Machine access',
      options: [{ fr: 'Facile', en: 'Easy', color: '#16a34a' }, { fr: 'Étroit', en: 'Narrow', color: '#d97706' }, { fr: 'Aucun', en: 'None', color: '#dc2626' }] },
    { id: 'equipement', key: 'equipement', objets: ['job'], field_type: 'dropdown_multi', fr: 'Équipement requis', en: 'Equipment needed',
      options: [{ fr: 'Tondeuse', en: 'Mower' }, { fr: 'Débroussailleuse', en: 'Trimmer' }, { fr: 'Souffleur', en: 'Blower' }, { fr: 'Remorque', en: 'Trailer' }] },
    code,
  ],
  snow_removal: [
    { id: 'longueur_entree', key: 'longueur_entree', objets: ['client', 'quote'], field_type: 'number', fr: 'Longueur de l’entrée (pi)', en: 'Driveway length (ft)', document: true },
    { id: 'nb_stationnements', key: 'nb_stationnements', objets: ['client', 'quote'], field_type: 'number', fr: 'Places de stationnement', en: 'Parking spots', document: true },
    { id: 'type_surface', key: 'type_surface', objets: ['client'], field_type: 'dropdown_single', fr: 'Type de surface', en: 'Surface type',
      options: [{ fr: 'Asphalte', en: 'Asphalt' }, { fr: 'Pavé uni', en: 'Pavers' }, { fr: 'Gravier', en: 'Gravel' }, { fr: 'Béton', en: 'Concrete' }] },
    { id: 'epandage', key: 'epandage', objets: ['client'], field_type: 'dropdown_single', fr: 'Épandage', en: 'De-icing',
      options: [{ fr: 'Sel', en: 'Salt' }, { fr: 'Abrasif', en: 'Grit' }, { fr: 'Aucun', en: 'None' }] },
    code,
  ],
  residential_cleaning: [
    { id: 'nb_chambres', key: 'nb_chambres', objets: ['client', 'quote'], field_type: 'number', fr: 'Nombre de chambres', en: 'Bedrooms', document: true },
    { id: 'nb_salles_bain', key: 'nb_salles_bain', objets: ['client', 'quote'], field_type: 'number', fr: 'Salles de bain', en: 'Bathrooms', document: true },
    { id: 'superficie', key: 'superficie', objets: ['client'], field_type: 'number', fr: 'Superficie (pi²)', en: 'Square footage' },
    animaux,
    code,
  ],
  commercial_cleaning: [
    { id: 'type_local', key: 'type_local', objets: ['client'], field_type: 'dropdown_single', fr: 'Type de local', en: 'Premises type',
      options: [{ fr: 'Bureau', en: 'Office' }, { fr: 'Commerce', en: 'Retail' }, { fr: 'Entrepôt', en: 'Warehouse' }, { fr: 'Restaurant', en: 'Restaurant' }, { fr: 'Autre', en: 'Other' }] },
    { id: 'superficie', key: 'superficie', objets: ['client', 'quote'], field_type: 'number', fr: 'Superficie (pi²)', en: 'Square footage', document: true },
    { id: 'heures_acces', key: 'heures_acces', objets: ['client'], field_type: 'single_line', fr: 'Heures d’accès', en: 'Access hours' },
    { id: 'code_alarme', key: 'code_alarme', objets: ['client'], field_type: 'single_line', fr: 'Code d’alarme', en: 'Alarm code' },
  ],
  plumbing: [
    anneeConstruction,
    { id: 'chauffe_eau', key: 'chauffe_eau', objets: ['client'], field_type: 'dropdown_single', fr: 'Type de chauffe-eau', en: 'Water heater type',
      options: [{ fr: 'Électrique', en: 'Electric' }, { fr: 'Gaz', en: 'Gas' }, { fr: 'Thermopompe', en: 'Heat pump' }, { fr: 'Sans réservoir', en: 'Tankless' }] },
    { id: 'entree_eau', key: 'entree_eau', objets: ['client'], field_type: 'single_line', fr: 'Emplacement de l’entrée d’eau', en: 'Water shut-off location' },
    permis,
  ],
  electrical: [
    anneeConstruction,
    { id: 'amperage_panneau', key: 'amperage_panneau', objets: ['client'], field_type: 'dropdown_single', fr: 'Ampérage du panneau', en: 'Panel amperage',
      options: [{ fr: '60 A', en: '60 A' }, { fr: '100 A', en: '100 A' }, { fr: '200 A', en: '200 A' }, { fr: '400 A', en: '400 A' }] },
    permis,
  ],
  roofing: [
    { id: 'type_toiture', key: 'type_toiture', objets: ['client'], field_type: 'dropdown_single', fr: 'Type de toiture', en: 'Roof type',
      options: [{ fr: 'Bardeaux d’asphalte', en: 'Asphalt shingles' }, { fr: 'Tôle', en: 'Metal' }, { fr: 'Membrane', en: 'Membrane' }, { fr: 'Autre', en: 'Other' }] },
    { id: 'pente', key: 'pente', objets: ['client'], field_type: 'dropdown_single', fr: 'Pente', en: 'Pitch',
      options: [{ fr: 'Plat', en: 'Flat' }, { fr: 'Faible', en: 'Low' }, { fr: 'Moyenne', en: 'Medium' }, { fr: 'Forte', en: 'Steep' }] },
    { id: 'superficie_toit', key: 'superficie_toit', objets: ['quote', 'job', 'invoice'], field_type: 'number', fr: 'Superficie du toit (pi²)', en: 'Roof area (sq ft)', document: true },
    { id: 'annee_toit', key: 'annee_toit', objets: ['client'], field_type: 'number', fr: 'Année du toit', en: 'Roof year' },
  ],
  hvac: [
    { id: 'type_systeme', key: 'type_systeme', objets: ['client'], field_type: 'dropdown_single', fr: 'Type de système', en: 'System type',
      options: [{ fr: 'Thermopompe', en: 'Heat pump' }, { fr: 'Fournaise', en: 'Furnace' }, { fr: 'Climatiseur', en: 'Air conditioner' }, { fr: 'Plinthes', en: 'Baseboards' }] },
    { id: 'marque_appareil', key: 'marque_appareil', objets: ['client'], field_type: 'single_line', fr: 'Marque de l’appareil', en: 'Unit brand' },
    { id: 'annee_installation', key: 'annee_installation', objets: ['client'], field_type: 'number', fr: 'Année d’installation', en: 'Install year' },
    { id: 'taille_filtre', key: 'taille_filtre', objets: ['client'], field_type: 'single_line', fr: 'Taille du filtre', en: 'Filter size' },
  ],
  other: [code, animaux],
};

export function estIndustrieModele(x: unknown): x is IndustrieModele {
  return typeof x === 'string' && (INDUSTRIES_MODELES as readonly string[]).includes(x);
}

/** Les champs d'un modèle, un par objet (ce que l'installation crée réellement). */
export function champsDuModele(industrie: IndustrieModele, ids?: string[]) {
  return MODELES_CHAMPS[industrie]
    .filter((c) => !ids || ids.includes(c.id))
    .flatMap((c) => c.objets.map((objet) => ({ modele: c, objet })));
}
