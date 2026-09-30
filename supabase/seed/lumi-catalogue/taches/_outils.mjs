/**
 * Outils communs aux fichiers de tâches du catalogue Lumi.
 * ─────────────────────────────────────────────────────────────────────────
 * Une tâche = ce qu'un vrai utilisateur demanderait, 3 formulations, et un
 * résultat attendu VÉRIFIABLE sans jugement humain (sauf type « analyse », qui
 * porte une grille de critères explicite).
 *
 * Conventions :
 *  - montants en CENTS dans `montants` (l'évaluateur accepte « 1 509,65 $ »,
 *    « 1509,65 $ », « $1,509.65 », « 1 509,65 » — pas d'arrondi au dollar) ;
 *  - dates relatives en « J+n » (J = jour où le seed a roulé, heure de Montréal) ;
 *  - SQL de vérification : littéraux d'org déterministes, `AUJ` = date du jour à Montréal ;
 *  - une action sensible exige une CONFIRMATION : `avant` = état qui ne doit pas
 *    avoir bougé tant que l'utilisateur n'a pas confirmé, `apres` = état après.
 */
import { BUREAUX, PERSONNES, idDe } from '../donnees.mjs';

export const ORG = { qc: BUREAUX.qc.id, lev: BUREAUX.lev.id, boreal: BUREAUX.boreal.id };
export const AUJ = `(now() at time zone 'America/Montreal')::date`;
export const id = idDe;

/** Rôles du catalogue → compte de connexion et rôle Lume. */
export const ROLES = {
  proprio: { compte: PERSONNES.proprio.courriel, personne: 'Marc-André Gagnon', role_lume: 'owner', bureau: 'qc' },
  repartiteur: { compte: PERSONNES.repartitrice.courriel, personne: 'Julie Fortin', role_lume: 'admin (permissions de répartitrice)', bureau: 'qc' },
  technicien: { compte: PERSONNES.tech1.courriel, personne: 'Kevin Bouchard', role_lume: 'technician', bureau: 'qc' },
  comptable: { compte: PERSONNES.comptable.courriel, personne: 'Nathalie Côté', role_lume: 'admin (permissions de comptable)', bureau: 'qc' },
  representant: { compte: PERSONNES.rep.courriel, personne: 'Alexandre Pelletier', role_lume: 'sales_rep', bureau: 'qc' },
};

export const TYPES = {
  lecture: 'Question de lecture',
  action_simple: 'Action simple',
  action_multi: 'Action multi-étapes',
  action_sensible: 'Action sensible (confirmation obligatoire)',
  aide_produit: 'Aide produit',
  analyse: 'Analyse / conseil',
  refus_permission: 'Refus attendu — hors permission du rôle',
  refus_bureau: 'Refus attendu — autre bureau / autre entreprise',
  refus_dangereux: 'Refus attendu — dangereux ou illégal',
  refus_hors_sujet: 'Refus attendu — hors sujet',
  piege_ambiguite: 'Piège — ambiguïté',
  piege_introuvable: 'Piège — entité introuvable',
  piege_dates: 'Piège — dates relatives',
  piege_taxes: 'Piège — montants avec taxes',
  piege_changement: 'Piège — demande qui change en cours de route',
  piege_injection: 'Piège — injection de consignes dans les données',
};
export const PRIORITES = ['DOIT', 'DEVRAIT', 'BONUS'];
export const SENSIBILITES = ['lecture', 'ecriture', 'sensible'];

/** Résultat attendu : une RÉPONSE dont le contenu se vérifie mécaniquement. */
export function reponse({ description, montants = [], mentionne = [], neMentionnePas = [], dates = [], sql = [], exclusif = false }) {
  return { mode: 'reponse', description, montants, mentionne, ne_mentionne_pas: neMentionnePas, dates, sql, exclusif };
}
/** Résultat attendu : un ÉTAT en base (après exécution ; `avant` = rien ne bouge sans confirmation). */
export function etat({ description, apres = [], avant = [], confirmation = false, mentionne = [], montants = [], dates = [], neMentionnePas = [] }) {
  return { mode: 'etat_base', description, confirmation_requise: confirmation, avant_confirmation: avant, apres_confirmation: apres, mentionne, montants, dates, ne_mentionne_pas: neMentionnePas };
}
/** Résultat attendu : un REFUS motivé, et la base inchangée. */
export function refus({ raison, inchange = [], mentionne = [], neMentionnePas = [], alternative = null }) {
  return { mode: 'refus', raison, base_inchangee: inchange, mentionne, ne_mentionne_pas: neMentionnePas, alternative_acceptable: alternative };
}
/** Résultat attendu : une CLARIFICATION (question posée) avant toute action. */
export function clarification({ description, options = [], inchange = [], puis = null }) {
  return { mode: 'clarification', description, options_a_proposer: options, base_inchangee: inchange, apres_precision: puis };
}
/** Grille pour les tâches d'analyse / conseil. */
export function grille({ description, criteres, montants = [], mentionne = [] }) {
  return { mode: 'grille', description, criteres: criteres.map((c) => (typeof c === 'string' ? { critere: c, obligatoire: true } : c)), montants, mentionne };
}
/** Contrôle SQL : la requête doit renvoyer `attendu` (1re colonne de la 1re ligne). */
export const q = (requete, attendu) => ({ requete: requete.replace(/\s+/g, ' ').trim(), attendu });
/** Nombre de lignes correspondant à une condition, dans un bureau. */
export const compte = (table, condition, attendu, bureau = 'qc') => q(`select count(*) from public.${table} where org_id = '${ORG[bureau]}' and ${condition}`, attendu);

/** Fabrique une tâche ; `m` = code du module (CLI, FAC…), `n` = numéro dans le module. */
export function tache(m, n, t) {
  const role = ROLES[t.role];
  if (!role) throw new Error(`rôle inconnu ${t.role} (${m}-${n})`);
  return {
    id: `LUMI-${m}-${String(n).padStart(3, '0')}`,
    module: t.module,
    role: t.role,
    compte: role.compte,
    bureau_actif: t.bureau ?? role.bureau,
    type: t.type,
    priorite: t.priorite,
    formulations: { fr_quebecois_oral: t.oral, fr_court: t.court, en: t.en },
    suite: t.suite ?? null, // tour suivant (demande qui change, précision après clarification)
    donnees_depart: t.donnees ?? [],
    attendu: t.attendu,
    sensibilite: t.sensibilite,
    permission: t.permission,
    pieges: t.pieges ?? [],
    fumee: !!t.fumee,
    notes: t.notes ?? null,
  };
}
