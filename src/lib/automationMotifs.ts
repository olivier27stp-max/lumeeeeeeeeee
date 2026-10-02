/* ═══════════════════════════════════════════════════════════════
   Les ISSUES d'une exécution d'automatisation — une seule liste.

   Avant ce fichier, chaque écran traduisait à sa façon ce que le moteur
   écrivait : la liste reconnaissait 23 motifs par sous-chaîne, l'onglet
   Journaux rendait la phrase française telle quelle (même en anglais), Lumi
   comptait autrement, et le plafond de fréquence s'affichait comme un échec
   avec le numéro du client dedans. Les statistiques ne pouvaient donc pas dire
   « ignorées, et pourquoi ».

   Ici : chaque issue a un CODE stable, une CATÉGORIE (ce qu'on compte), un
   GROUPE (la raison montrée au propriétaire) et son libellé en français et en
   anglais. Le moteur écrit le code (`result_data.saute_code`, ou
   `action_config.motif_code` sur une tâche annulée ou reportée) ; tout écran,
   les statistiques et Lumi lisent ce fichier.

   Copié dans l'image du serveur (Dockerfile) : aucune dépendance.
   ═══════════════════════════════════════════════════════════════ */

/** Ce que les statistiques comptent. */
export type CategorieIssue = 'envoyee' | 'ignoree' | 'reportee' | 'annulee' | 'echouee';

/** La raison montrée au propriétaire, celle du tableau « Ignorées ». */
export type GroupeMotif =
  | 'doublon'
  | 'desabonne'
  | 'hors_ciblage'
  | 'donnee_manquante'
  | 'condition_plus_valide'
  | 'hors_heures'
  | 'plafond'
  | 'autre';

export interface Motif {
  code: string;
  categorie: Exclude<CategorieIssue, 'envoyee' | 'echouee'>;
  groupe: GroupeMotif;
  fr: string;
  en: string;
}

export const GROUPES_MOTIFS: Record<GroupeMotif, { fr: string; en: string }> = {
  doublon: { fr: 'Doublon', en: 'Duplicate' },
  desabonne: { fr: 'Désabonné ou sans consentement', en: 'Unsubscribed or no consent' },
  hors_ciblage: { fr: 'Hors ciblage', en: 'Not targeted' },
  donnee_manquante: { fr: 'Donnée manquante', en: 'Missing information' },
  condition_plus_valide: { fr: 'Condition plus valide', en: 'No longer applies' },
  hors_heures: { fr: 'Hors heures d’envoi', en: 'Outside sending hours' },
  plafond: { fr: 'Limite d’envois atteinte', en: 'Sending limit reached' },
  autre: { fr: 'Autre', en: 'Other' },
};

/**
 * Tous les motifs. L'ordre est celui de l'affichage dans un groupe.
 * Ajouter un motif = l'ajouter ICI d'abord ; un test garde le moteur et cette
 * liste d'accord.
 */
export const MOTIFS: readonly Motif[] = [
  // ── Doublon ──
  { code: 'deja_envoye', categorie: 'ignoree', groupe: 'doublon', fr: 'Déjà envoyé', en: 'Already sent' },
  { code: 'doublon', categorie: 'ignoree', groupe: 'doublon', fr: 'Le client a déjà reçu ce message d’une autre automatisation', en: 'The client already got this message from another automation' },
  { code: 'une_fois_par_client', categorie: 'ignoree', groupe: 'doublon', fr: 'Déjà passé par cette automatisation récemment', en: 'Already went through this automation recently' },

  // ── Désabonné / consentement ──
  { code: 'desabonne', categorie: 'ignoree', groupe: 'desabonne', fr: 'Client désabonné', en: 'Client unsubscribed' },
  { code: 'sans_consentement', categorie: 'ignoree', groupe: 'desabonne', fr: 'Consentement manquant', en: 'No consent on file' },
  { code: 'client_sans_avis', categorie: 'ignoree', groupe: 'desabonne', fr: 'Client marqué « aucune demande d’avis »', en: 'Client marked “no review requests”' },

  // ── Hors ciblage ──
  { code: 'conditions', categorie: 'ignoree', groupe: 'hors_ciblage', fr: 'Conditions non remplies', en: 'Conditions not met' },
  { code: 'hors_ciblage', categorie: 'ignoree', groupe: 'hors_ciblage', fr: 'Client hors ciblage', en: 'Client not targeted' },

  // ── Donnée manquante ──
  { code: 'sans_telephone', categorie: 'ignoree', groupe: 'donnee_manquante', fr: 'Aucun numéro de téléphone pour ce client', en: 'No phone number for this client' },
  { code: 'sans_courriel', categorie: 'ignoree', groupe: 'donnee_manquante', fr: 'Aucune adresse courriel pour ce client', en: 'No email address for this client' },
  { code: 'adresse_injoignable', categorie: 'ignoree', groupe: 'donnee_manquante', fr: 'Adresse courriel injoignable', en: 'Email address unreachable' },
  { code: 'sms_non_configure', categorie: 'ignoree', groupe: 'donnee_manquante', fr: 'Aucun numéro texto configuré pour le bureau', en: 'No texting number set up for this office' },
  { code: 'identite_manquante', categorie: 'ignoree', groupe: 'donnee_manquante', fr: 'Nom ou adresse de l’entreprise manquant', en: 'Company name or address missing' },
  { code: 'date_absente', categorie: 'ignoree', groupe: 'donnee_manquante', fr: 'Aucune date de rendez-vous', en: 'No appointment date' },
  { code: 'avis_desactives', categorie: 'ignoree', groupe: 'donnee_manquante', fr: 'Demandes d’avis désactivées', en: 'Review requests turned off' },
  { code: 'sans_lien_avis', categorie: 'ignoree', groupe: 'donnee_manquante', fr: 'Aucun lien d’avis configuré', en: 'No review link set up' },
  { code: 'sans_cible', categorie: 'ignoree', groupe: 'donnee_manquante', fr: 'Rien à modifier pour cette fiche', en: 'Nothing to change for this record' },

  // ── Condition plus valide (revalidation avant un envoi différé) ──
  { code: 'condition_plus_valide', categorie: 'annulee', groupe: 'condition_plus_valide', fr: 'La situation a changé depuis le déclenchement', en: 'The situation changed since it was triggered' },
  { code: 'entite_supprimee', categorie: 'annulee', groupe: 'condition_plus_valide', fr: 'La fiche a été supprimée', en: 'The record was deleted' },
  { code: 'fiche_fusionnee', categorie: 'annulee', groupe: 'condition_plus_valide', fr: 'La fiche a été fusionnée avec une autre', en: 'The record was merged into another' },
  { code: 'client_a_repondu', categorie: 'annulee', groupe: 'condition_plus_valide', fr: 'Le client a répondu', en: 'The client replied' },
  { code: 'etape_retiree', categorie: 'annulee', groupe: 'condition_plus_valide', fr: 'L’étape a été retirée du parcours', en: 'The step was removed from the workflow' },
  { code: 'regle_inactive', categorie: 'annulee', groupe: 'condition_plus_valide', fr: 'L’automatisation a été dépubliée ou supprimée', en: 'The automation was unpublished or deleted' },
  { code: 'rappel_perime', categorie: 'annulee', groupe: 'condition_plus_valide', fr: 'Le moment du rappel est passé', en: 'The reminder time has passed' },

  // ── Hors heures d'envoi (le message partira au prochain créneau) ──
  { code: 'hors_heures', categorie: 'reportee', groupe: 'hors_heures', fr: 'Reporté au prochain créneau d’envoi', en: 'Postponed to the next sending window' },

  // ── Limites d'envoi ──
  { code: 'plafond_frequence', categorie: 'ignoree', groupe: 'plafond', fr: 'Ce client a déjà reçu le maximum de messages commerciaux sur 24 h', en: 'This client already got the maximum number of marketing messages in 24 hours' },
  { code: 'rafale', categorie: 'reportee', groupe: 'plafond', fr: 'Envoi étalé (trop de textos en même temps)', en: 'Send spread out (too many texts at once)' },

  // ── Autre ──
  { code: 'boucle', categorie: 'ignoree', groupe: 'autre', fr: 'Boucle évitée entre automatisations', en: 'Loop between automations avoided' },
  { code: 'pause_bureau', categorie: 'ignoree', groupe: 'autre', fr: 'Automatisations arrêtées pour ce bureau', en: 'Automations paused for this office' },
];

const PAR_CODE = new Map(MOTIFS.map((m) => [m.code, m]));

/** Le motif d'un code, ou `undefined` si le code est inconnu de cette liste. */
export function motifDuCode(code: string | null | undefined): Motif | undefined {
  return code ? PAR_CODE.get(code) : undefined;
}

/**
 * Le libellé à montrer pour une issue. `detail` (une phrase du moteur, en
 * français) n'est ajouté qu'en français : en anglais on s'en tient au libellé
 * du code, jamais une phrase française dans une interface anglaise.
 */
export function libelleMotif(code: string | null | undefined, fr: boolean, detail?: string | null): string {
  const m = motifDuCode(code);
  if (!m) return detail || (fr ? 'Raison inconnue' : 'Unknown reason');
  if (fr && detail && detail !== m.fr) return detail;
  return fr ? m.fr : m.en;
}

/** La catégorie comptée par les statistiques pour un code. Inconnu → « ignorée ». */
export function categorieDuCode(code: string | null | undefined): CategorieIssue {
  return motifDuCode(code)?.categorie ?? 'ignoree';
}

/** Le groupe (la raison du tableau « Ignorées ») d'un code. Inconnu → « autre ». */
export function groupeDuCode(code: string | null | undefined): GroupeMotif {
  return motifDuCode(code)?.groupe ?? 'autre';
}
