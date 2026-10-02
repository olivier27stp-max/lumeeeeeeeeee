/* ═══════════════════════════════════════════════════════════════
   SORTIE AUTOMATIQUE DU PARCOURS — la case par déclencheur (drapeau
   `auto_sortie_parcours`) et, plus bas, LA REVALIDATION de toute tâche
   différée (mission finale, point 9 — pour tous, drapeau ou pas).

   Avant chaque action qui suit un délai, le moteur relit l'entité source :
   si elle a changé d'état (soumission acceptée, facture payée, rendez-vous
   annulé, opportunité déplacée), le parcours s'arrête et le MOTIF est écrit
   dans la tâche annulée (onglet Historique).

   Ce n'est pas un moteur d'événements parallèles : c'est une relecture, au
   moment d'agir, de l'état qui compte pour CE déclencheur.

   ── Ce qui change par rapport à l'ancienne vérification ──
   1. Une case par déclencheur (`settings.arreter_si_resolu`), au lieu d'une
      règle en dur appliquée à tout.
   2. La vérification connaît le déclencheur. L'ancienne annulait toute tâche
      d'un devis `approved` — y compris celles d'une règle déclenchée PAR
      l'acceptation : les rappels de dépôt (« Soumission acceptée » + 1 h,
      + 2 jours) ne sont jamais partis (30 tâches annulées, 0 exécutée en
      prod au 2026-09-28). Idem « Facture payée » + délai, « Rendez-vous
      annulé » + délai.
   3. L'opportunité : « Arrêter si l'opportunité change d'étape ».

   ── Case absente = comportement d'avant ──
   Les automatisations existantes n'ont pas la clé. Pour elles, on garde ce
   que faisait le moteur : arrêt pour la soumission, la facture et le
   rendez-vous (il était en dur), pas d'arrêt pour l'opportunité (il
   n'existait pas). Les NOUVELLES automatisations naissent avec la case
   cochée (le builder l'écrit). Rapport de phase 0, décision D1.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';
import { corrigerChangementDHeure, FUSEAU_DEFAUT } from './automations-fuseau-org';
import { CLE_CONDITIONS_CHAMPS, objetDeLEntite } from './champs/automatisations';
import { listerChamps, lireValeursLot } from './champs/service';
import { evaluerCondition, type Condition } from '../../src/lib/champs/filtres';

export type FamilleSortie = 'soumission' | 'facture' | 'rendezvous' | 'opportunite';

/** Les déclencheurs qui portent la case, et la famille qui dit quoi vérifier. */
export const FAMILLE_PAR_DECLENCHEUR: Record<string, FamilleSortie> = {
  'quote.sent': 'soumission',
  'invoice.sent': 'facture',
  'invoice.overdue': 'facture',
  'appointment.created': 'rendezvous',
  'deal.stage_entered': 'opportunite',
};

/** Ce que faisait le moteur avant la case, famille par famille. */
const DEFAUT_SANS_CASE: Record<FamilleSortie, boolean> = {
  soumission: true,
  facture: true,
  rendezvous: true,
  opportunite: false,
};

export function familleSortie(declencheur: string | null | undefined): FamilleSortie | null {
  return declencheur ? FAMILLE_PAR_DECLENCHEUR[declencheur] ?? null : null;
}

/** La case est-elle cochée pour cette règle ? Absente = comportement d'avant. */
export function sortieCochee(
  reglages: { arreter_si_resolu?: boolean } | null | undefined,
  famille: FamilleSortie,
): boolean {
  const v = reglages?.arreter_si_resolu;
  return typeof v === 'boolean' ? v : DEFAUT_SANS_CASE[famille];
}

const MOTIF_SOUMISSION: Record<string, string> = {
  approved: 'la soumission a été acceptée',
  declined: 'la soumission a été refusée',
  changes_requested: 'le client a demandé des modifications à la soumission',
  expired: 'la soumission a expiré',
  converted: 'la soumission a été convertie',
  archived: 'la soumission a été annulée',
  void: 'la soumission a été annulée',
};
const MOTIF_FACTURE: Record<string, string> = {
  paid: 'la facture a été payée',
  cancelled: 'la facture a été annulée',
  void: 'la facture a été annulée',
};

/** Statuts qui « résolvent » l'entité — l'ancienne liste, inchangée. */
const RESOLUS_SOUMISSION = Object.keys(MOTIF_SOUMISSION);
const RESOLUS_FACTURE = Object.keys(MOTIF_FACTURE);

/**
 * Déclencheurs qui ARRIVENT par la résolution elle-même : leur entité est,
 * par construction, déjà dans l'état résolu. Les arrêter sur cet état, c'est
 * annuler la règle au moment où elle devait servir (bug des rappels de dépôt).
 */
export const DECLENCHE_PAR_RESOLUTION: Record<string, string[]> = {
  // « converted » : une soumission acceptée puis transformée en job reste une
  // soumission acceptée — la demande de dépôt prévue une heure après
  // l'acceptation ne doit pas tomber parce que l'entrepreneur a créé le job
  // entre-temps.
  'quote.approved': ['approved', 'converted'],
  'quote.declined': ['declined'],
  'quote.changes_requested': ['changes_requested'],
  'invoice.paid': ['paid'],
  'appointment.cancelled': ['cancelled'],
};

/* ═══════════════════════════════════════════════════════════════
   LA REVALIDATION AVANT CHAQUE ACTION DIFFÉRÉE (mission finale, point 9).

   UN mécanisme, appelé à UN endroit (`processScheduledTasks`, juste après la
   prise de la tâche) pour TOUTES les tâches de la file : règle à délai,
   étape de parcours, reprise, report d'heures calmes.

     1. l'ENTITÉ de la tâche — une fonction par type (`REVALIDATEURS`) :
        existe-t-elle encore, est-elle à la corbeille, a-t-elle changé d'état
        (facture payée ou annulée, devis accepté, refusé ou revenu en
        brouillon, rendez-vous annulé ou déplacé, job annulé, opportunité
        déplacée, prospect converti) ;
     2. le CLIENT de l'entité, quel que soit son type : à la corbeille, on
        n'écrit plus (avant, seul le client d'une tâche « client » ou d'une
        facture était vérifié) ;
     3. les CONDITIONS de la règle qui portent sur l'état actuel : étiquettes
        du client, champs personnalisés, l'étiquette de « Étiquette ajoutée ».
        Les filtres sur l'événement d'origine (montant, source) ne sont pas
        rejugés : ces valeurs ne changent pas.

   Ce n'est plus vrai → la tâche s'arrête proprement : annulée, avec un code
   (`condition_plus_valide`, `entite_supprimee`, `rappel_perime`) et CE QUI A
   CHANGÉ, sur la tâche et dans le journal. Un rendez-vous déplacé plus tard
   REPORTE son rappel au lieu de l'annuler.

   ── Deux garde-fous ──
   · Une LECTURE en échec ne conclut jamais : la tâche suit son cours. Un
     hoquet réseau ne doit pas supprimer une relance.
   · Ce que la règle modifie ELLE-MÊME n'est pas rejugé contre elle : un
     parcours « étiquette posée → retirer l'étiquette → attendre → écrire »
     ne s'annule pas parce qu'il a retiré l'étiquette.

   ── Drapeau `auto_sortie_parcours` ──
   Il ne décide plus QUE de la case « Arrêter si… » par déclencheur
   (`settings.arreter_si_resolu`) et de l'arrêt « l'opportunité a changé
   d'étape » pour « Entrée dans une étape ». Tout le reste vaut pour tous.
   ═══════════════════════════════════════════════════════════════ */

/** Les codes d'arrêt — ceux de `src/lib/automationMotifs.ts`. */
export type CodeArret = 'condition_plus_valide' | 'entite_supprimee' | 'rappel_perime';

export interface Arret {
  code: CodeArret;
  /** Ce qui a changé, en mots de l'écran : « la facture a été payée ». */
  changement: string;
  /** Motif historique gardé tel quel sur la tâche (des écrans et des tests le lisent). */
  motif?: string;
}

/** Le rendez-vous a été déplacé plus tard : le rappel est reporté, pas annulé. */
export interface Report {
  executeAt: number;
  /** Le nouveau début du rendez-vous (ms). */
  debut: number;
  changement: string;
}

export interface Revalidation {
  arret?: Arret;
  report?: Report;
  /** Le client de l'entité, s'il a été trouvé en chemin (`undefined` = pas cherché). */
  clientId?: string | null;
}

/** Le motif écrit sur la tâche (`last_error`). */
export function motifArret(a: Arret): string {
  if (a.motif) return a.motif;
  return a.code === 'rappel_perime' ? `rappel périmé : ${a.changement}` : `Arrêté : ${a.changement}.`;
}

/** La phrase du journal : le motif de la mission, puis ce qui a changé. */
export function phraseArret(a: Arret): string {
  const prefixe: Record<CodeArret, string> = {
    condition_plus_valide: 'Condition plus valide',
    entite_supprimee: 'Fiche supprimée',
    rappel_perime: 'Rappel périmé',
  };
  return `${prefixe[a.code]} : ${a.changement}`;
}

export interface TacheARevalider {
  orgId: string;
  entityType: string;
  entityId: string;
  /** Le déclencheur de la règle (ou celui noté dans la tâche). */
  declencheur: string | null | undefined;
  /** Métadonnées de l'événement d'origine (étape de l'opportunité, étiquette posée…). */
  metadonnees: Record<string, unknown> | null | undefined;
  reglages: { arreter_si_resolu?: boolean } | null | undefined;
  /** Les conditions de la RÈGLE (filtres d'étiquettes, champs personnalisés). */
  conditions: Record<string, unknown> | null | undefined;
  /** Les types d'actions que la règle exécute elle-même (voir « garde-fous »). */
  actionsDeLaRegle: readonly string[];
  /** Drapeau `auto_sortie_parcours` : la case par déclencheur est-elle écoutée ? */
  caseParDeclencheur: boolean;
  /** Règle à plat « X avant le rendez-vous » : son délai, négatif, en secondes. */
  rappelAvantSecondes?: number | null;
  fuseau?: string;
  maintenant?: number;
}

interface Ctx extends TacheARevalider {
  supabase: SupabaseClient;
  /** La case « Arrêter si… » vaut-elle pour cette tâche ? */
  cochee: boolean;
  /** Les états que le déclencheur produit lui-même (jamais un motif d'arrêt). */
  etatsDuDeclencheur: readonly string[];
}

type Ligne = Record<string, unknown>;

/** Lit UNE ligne de l'entreprise. `illisible` = on ne sait pas : ne rien conclure. */
async function lire(c: Ctx, table: string, colonnes: string, id: string): Promise<{ ligne: Ligne | null; illisible: boolean }> {
  const { data, error } = await c.supabase.from(table).select(colonnes).eq('id', id).eq('org_id', c.orgId).maybeSingle();
  if (error) {
    logger.error('[revalidation] lecture impossible — la tâche suit son cours', { table, id, message: error.message });
    return { ligne: null, illisible: true };
  }
  return { ligne: (data as Ligne | null) ?? null, illisible: false };
}

const supprimee = (changement: string): Revalidation => ({ arret: { code: 'entite_supprimee', changement } });
const plusValide = (changement: string, clientId?: string | null): Revalidation => ({ arret: { code: 'condition_plus_valide', changement }, clientId });
const texte = (v: unknown): string => (typeof v === 'string' ? v : '');
const idOuNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

// ── Une fonction par type d'entité ───────────────────────────

async function revaliderFacture(c: Ctx): Promise<Revalidation> {
  const { ligne: f, illisible } = await lire(c, 'invoices', 'status, client_id, deleted_at', c.entityId);
  if (illisible) return {};
  if (!f || f.deleted_at) return supprimee('la facture a été supprimée');
  const statut = texte(f.status);
  const clientId = idOuNull(f.client_id);
  if (c.cochee && !c.etatsDuDeclencheur.includes(statut)) {
    if (RESOLUS_FACTURE.includes(statut)) return plusValide(MOTIF_FACTURE[statut], clientId);
    // Ancien devis porté par une facture (`estimate.sent`, plus émis) : mêmes arrêts qu'avant.
    if (c.declencheur === 'estimate.sent' && (statut === 'accepted' || statut === 'rejected')) {
      return plusValide(statut === 'accepted' ? 'la soumission a été acceptée' : 'la soumission a été refusée', clientId);
    }
  }
  return { clientId };
}

/** Déclencheurs qui supposent une soumission ENVOYÉE : revenue en brouillon, la relance n'a plus d'objet. */
const SUPPOSE_SOUMISSION_ENVOYEE: readonly string[] = ['quote.sent', 'quote.viewed'];

async function revaliderDevis(c: Ctx): Promise<Revalidation> {
  const { ligne: q, illisible } = await lire(c, 'quotes', 'status, deleted_at, client_id, lead_id', c.entityId);
  if (illisible) return {};
  if (!q || q.deleted_at) return supprimee('la soumission a été supprimée');
  const statut = texte(q.status);
  const clientId = idOuNull(q.client_id) ?? idOuNull(q.lead_id);
  if (c.cochee && !c.etatsDuDeclencheur.includes(statut)) {
    if (RESOLUS_SOUMISSION.includes(statut)) return plusValide(MOTIF_SOUMISSION[statut], clientId);
    if (statut === 'draft' && SUPPOSE_SOUMISSION_ENVOYEE.includes(String(c.declencheur))) {
      return plusValide('la soumission est revenue en brouillon', clientId);
    }
  }
  return { clientId };
}

/** Tolérance d'un rappel « X avant » légèrement en retard (le tick passe toutes les 5 min). */
export const RETARD_TOLERE_RAPPEL_MS = 30 * 60 * 1000;
/** En deçà, on ne reporte pas : le rappel part maintenant. */
const AVANCE_MIN_REPORT_MS = 2 * 60 * 1000;

export type SortDuRappel =
  | { sort: 'part' }
  | { sort: 'reporte'; executeAt: number }
  | { sort: 'perime'; changement: string };

/**
 * Le sort d'un rappel « X avant le rendez-vous » d'une règle à plat, dont
 * l'heure a été calculée UNE fois, à la planification (B-02). Pur.
 *   · visite déjà passée → périmé : il n'a plus rien à rappeler ;
 *   · visite DÉPLACÉE (son début n'est plus celui noté dans la tâche) :
 *     plus tard → reporté à sa nouvelle heure ; plus tôt, et le moment du
 *     rappel est passé → périmé (on ne dit pas « c'est demain » à quelqu'un
 *     qu'on voit dans deux heures) ;
 *   · sinon il part.
 * Sans le début d'origine (`debutPlanifie`), on ne sait pas si la visite a
 * bougé : ni report ni annulation — un rappel seulement RETARDÉ (heures
 * calmes, reprise) reste un rappel valable.
 */
export function sortDuRappelAvant(p: {
  debut: number; debutPlanifie: number | null; avantSecondes: number; maintenant: number; fuseau?: string;
}): SortDuRappel {
  if (!(p.avantSecondes < 0) || !Number.isFinite(p.debut)) return { sort: 'part' };
  if (p.maintenant > p.debut) return { sort: 'perime', changement: 'le rendez-vous est déjà passé' };
  if (p.debutPlanifie === null || !Number.isFinite(p.debutPlanifie) || Math.abs(p.debut - p.debutPlanifie) <= 60_000) return { sort: 'part' };
  const cible = corrigerChangementDHeure(p.debut, p.debut + p.avantSecondes * 1000, p.fuseau || FUSEAU_DEFAUT);
  if (cible > p.maintenant + AVANCE_MIN_REPORT_MS) return { sort: 'reporte', executeAt: cible };
  if (p.maintenant > cible + RETARD_TOLERE_RAPPEL_MS) return { sort: 'perime', changement: 'le rendez-vous a été déplacé, le moment du rappel est passé' };
  return { sort: 'part' };
}

async function revaliderRendezVous(c: Ctx): Promise<Revalidation> {
  const { ligne: v, illisible } = await lire(c, 'schedule_events', 'status, deleted_at, job_id, start_at, start_time', c.entityId);
  if (illisible) return {};
  if (!v || v.deleted_at) return supprimee('le rendez-vous a été supprimé');
  const annulationVoulue = c.etatsDuDeclencheur.includes('cancelled');
  if (c.cochee && !annulationVoulue && texte(v.status) === 'cancelled') return plusValide('le rendez-vous a été annulé');

  // Le JOB de la visite : annuler un job ne touche pas ses visites, qui
  // restent « prévues » au calendrier (B-01).
  let clientId: string | null | undefined;
  const jobId = idOuNull(v.job_id);
  if (jobId) {
    const { ligne: j, illisible: jobIllisible } = await lire(c, 'jobs', 'status, deleted_at, client_id', jobId);
    if (!jobIllisible && j) {
      clientId = idOuNull(j.client_id);
      if (j.deleted_at) return { ...supprimee('le job a été supprimé'), clientId };
      if (c.cochee && !annulationVoulue && texte(j.status) === 'cancelled') return plusValide('le job a été annulé', clientId);
    }
  } else {
    clientId = null;
  }

  /*
   * Rappel « X avant le rendez-vous » d'une règle à plat : la visite a pu
   * bouger depuis sa planification (B-02) — voir `sortDuRappelAvant`.
   */
  const debut = Date.parse(texte(v.start_at) || texte(v.start_time));
  const debutPlanifie = Date.parse(texte(c.metadonnees?.start_time) || texte(c.metadonnees?.start_at));
  const rappel = sortDuRappelAvant({
    debut, debutPlanifie: Number.isFinite(debutPlanifie) ? debutPlanifie : null,
    avantSecondes: Number(c.rappelAvantSecondes ?? 0), maintenant: c.maintenant ?? Date.now(), fuseau: c.fuseau,
  });
  if (rappel.sort === 'perime') return { arret: { code: 'rappel_perime', changement: rappel.changement }, clientId };
  if (rappel.sort === 'reporte') return { report: { executeAt: rappel.executeAt, debut, changement: 'le rendez-vous a été déplacé' }, clientId };
  return { clientId };
}

async function revaliderJob(c: Ctx): Promise<Revalidation> {
  const { ligne: j, illisible } = await lire(c, 'jobs', 'status, deleted_at, client_id', c.entityId);
  if (illisible) return {};
  if (!j || j.deleted_at) return supprimee('le job a été supprimé');
  const clientId = idOuNull(j.client_id);
  if (texte(j.status) === 'cancelled') return plusValide('le job a été annulé', clientId);
  return { clientId };
}

/** Actions par lesquelles la règle déplace ELLE-MÊME l'opportunité. */
const ACTIONS_QUI_DEPLACENT: readonly string[] = ['move_deal_stage', 'modifier_deal'];

async function revaliderOpportunite(c: Ctx): Promise<Revalidation> {
  const { ligne: d, illisible } = await lire(c, 'deals', 'stage_id, deleted_at, client_id', c.entityId);
  if (illisible) return {};
  if (!d || d.deleted_at) return supprimee('l’opportunité a été supprimée');
  const clientId = idOuNull(d.client_id);
  const etapeAttendue = idOuNull(c.metadonnees?.stage_id);
  const deplacee = etapeAttendue !== null && idOuNull(d.stage_id) !== etapeAttendue;
  if (deplacee) {
    // « Opportunité qui dort » : elle a bougé, elle ne dort plus — pour tous.
    const dort = c.declencheur === 'deal.stage_idle' && !c.actionsDeLaRegle.some((a) => ACTIONS_QUI_DEPLACENT.includes(a));
    // « Entrée dans une étape » : la case « Arrêter si l'opportunité change
    // d'étape » (drapeau) — hors de la case, rien ne change.
    const entree = c.caseParDeclencheur && familleSortie(c.declencheur) === 'opportunite' && c.cochee;
    if (dort || entree) return plusValide('l’opportunité a changé d’étape', clientId);
  }
  return { clientId };
}

async function revaliderClient(c: Ctx): Promise<Revalidation> {
  const { ligne: cl, illisible } = await lire(c, 'clients', 'status, lead_status, deleted_at', c.entityId);
  if (illisible) return {};
  // (Une fiche absorbée par une FUSION est à la corbeille elle aussi : sans
  // trace de la fusion sur la fiche, le moteur ne peut pas les distinguer —
  // c'est `fusionner_clients` qui doit traiter ses relances, migration M-03.)
  if (!cl || cl.deleted_at) {
    return { arret: { code: 'entite_supprimee', changement: 'le client a été supprimé', motif: MOTIF_CLIENT_SUPPRIME }, clientId: c.entityId };
  }
  if (c.entityType === 'lead') {
    // Une fiche qui n'est plus un prospect ouvert (convertie, gagnée, perdue).
    if (texte(cl.status) !== 'lead') return plusValide('le prospect a été converti en client', c.entityId);
    /*
     * Exception : une relance de prospect PERDU (`lost_lead_reengagement`,
     * 90 jours après le passage à « perdu ») s'annulait elle-même — planifiée
     * parce que le prospect venait d'être marqué perdu, puis supprimée parce
     * qu'il ÉTAIT perdu.
     */
    const relanceDePerdu = c.declencheur === 'lead.status_changed' && c.metadonnees?.new_status === 'lost';
    const arrets = relanceDePerdu ? ['closed', 'converted', 'closed_won'] : ['lost', 'closed', 'converted', 'closed_won', 'closed_lost'];
    const statutProspect = texte(cl.lead_status);
    if (arrets.includes(statutProspect)) {
      return plusValide(['lost', 'closed_lost'].includes(statutProspect) ? 'le prospect est marqué perdu' : 'le prospect est fermé', c.entityId);
    }
  }
  return { clientId: c.entityId };
}

/** Motif historique d'une tâche dont le client est à la corbeille. */
export const MOTIF_CLIENT_SUPPRIME = 'Annulée : le client a été supprimé.';

/** LA table : un revalidateur par type d'entité. Un type absent n'a pas d'état à relire. */
const REVALIDATEURS: Readonly<Record<string, (c: Ctx) => Promise<Revalidation>>> = {
  invoice: revaliderFacture,
  quote: revaliderDevis,
  schedule_event: revaliderRendezVous,
  appointment: revaliderRendezVous,
  job: revaliderJob,
  deal: revaliderOpportunite,
  client: revaliderClient,
  lead: revaliderClient,
};

// ── Les conditions de la règle, sur l'état actuel ────────────

const ACTIONS_QUI_ETIQUETTENT: readonly string[] = ['ajouter_etiquette', 'retirer_etiquette'];
const ACTIONS_QUI_ECRIVENT_DES_CHAMPS: readonly string[] = ['update_custom_field', 'modifier_client', 'modifier_deal'];

async function revaliderEtiquettes(c: Ctx, clientId: string | null | undefined): Promise<Arret | null> {
  if (c.actionsDeLaRegle.some((a) => ACTIONS_QUI_ETIQUETTENT.includes(a))) return null;
  const norme = (v: unknown) => texte(v).trim().toLowerCase();
  const doitAvoir: string[] = [];
  const doitNePasAvoir: string[] = [];
  if (norme(c.conditions?.client_a_etiquette)) doitAvoir.push(norme(c.conditions?.client_a_etiquette));
  if (norme(c.conditions?.client_sans_etiquette)) doitNePasAvoir.push(norme(c.conditions?.client_sans_etiquette));
  // « Étiquette ajoutée / retirée » pour UNE étiquette choisie (`conditions.tag`) :
  // elle doit toujours y être (ou n'y être toujours pas). Une règle qui écoute
  // N'IMPORTE quelle étiquette ne dit pas laquelle compte : elle n'est pas rejugée.
  const duDeclencheur = norme(c.conditions?.tag);
  if (duDeclencheur && c.declencheur === 'client.tagged') doitAvoir.push(duDeclencheur);
  if (duDeclencheur && c.declencheur === 'client.untagged') doitNePasAvoir.push(duDeclencheur);
  if (!doitAvoir.length && !doitNePasAvoir.length) return null;
  if (!clientId) return null; // pas de client connu : on ne conclut pas

  const { data, error } = await c.supabase.from('client_tags').select('tag').eq('client_id', clientId);
  if (error) {
    logger.error('[revalidation] étiquettes illisibles — la tâche suit son cours', { clientId, message: error.message });
    return null;
  }
  const posees = new Set(((data ?? []) as Array<{ tag: string }>).map((r) => String(r.tag).toLowerCase()));
  const manquante = doitAvoir.find((t) => !posees.has(t));
  if (manquante) return { code: 'condition_plus_valide', changement: `le client n’a plus l’étiquette « ${manquante} »` };
  const enTrop = doitNePasAvoir.find((t) => posees.has(t));
  if (enTrop) return { code: 'condition_plus_valide', changement: `le client a maintenant l’étiquette « ${enTrop} »` };
  return null;
}

async function revaliderChamps(c: Ctx): Promise<Arret | null> {
  const conditions = c.conditions?.[CLE_CONDITIONS_CHAMPS];
  if (!Array.isArray(conditions) || conditions.length === 0) return null;
  if (c.actionsDeLaRegle.some((a) => ACTIONS_QUI_ECRIVENT_DES_CHAMPS.includes(a))) return null;
  const objet = objetDeLEntite(c.entityType);
  if (!objet) return null;
  try {
    const { champs } = await listerChamps(c.supabase, c.orgId, { objet, inclureArchives: true });
    const valeurs = (await lireValeursLot(c.supabase, c.orgId, objet, [c.entityId], champs))[c.entityId] ?? {};
    for (const condition of conditions as Condition[]) {
      const champ = champs.find((x) => x.id === condition.field_id);
      // Champ disparu : on ne sait plus juger — on ne conclut pas.
      if (!champ) continue;
      const tient = evaluerCondition(champ.field_type, valeurs[champ.id]?.value ?? null, condition,
        { fuseau: c.fuseau || FUSEAU_DEFAUT, avecHeure: !!champ.config.include_time });
      if (!tient) return { code: 'condition_plus_valide', changement: `le champ « ${champ.label} » ne remplit plus la condition` };
    }
  } catch (e) {
    logger.error('[revalidation] champs personnalisés illisibles — la tâche suit son cours', {
      entity_type: c.entityType, entity_id: c.entityId, message: e instanceof Error ? e.message : String(e),
    });
  }
  return null;
}

/**
 * La situation de cette tâche différée est-elle toujours vraie ?
 *
 * Rend `{}` quand tout tient (ou quand on n'a pas pu le vérifier), un `arret`
 * quand ce n'est plus vrai, un `report` quand le rendez-vous a été déplacé
 * plus tard. Ne lève jamais.
 */
export async function revaliderTache(supabase: SupabaseClient, tache: TacheARevalider): Promise<Revalidation> {
  const famille = familleSortie(tache.declencheur);
  const c: Ctx = {
    ...tache,
    supabase,
    // Hors drapeau, le moteur arrêtait toujours sur un état résolu : inchangé.
    cochee: tache.caseParDeclencheur && famille ? sortieCochee(tache.reglages, famille) : true,
    etatsDuDeclencheur: (tache.declencheur && DECLENCHE_PAR_RESOLUTION[tache.declencheur]) || [],
  };
  try {
    // 1. L'entité.
    const revalidateur = REVALIDATEURS[tache.entityType];
    const r: Revalidation = revalidateur ? await revalidateur(c) : {};
    if (r.arret) return r;

    // 2. Le client de l'entité (une fiche client ou prospect vient d'être lue).
    if (r.clientId && tache.entityType !== 'client' && tache.entityType !== 'lead') {
      const { ligne: cl, illisible } = await lire(c, 'clients', 'deleted_at', r.clientId);
      if (!illisible && cl?.deleted_at) {
        return { arret: { code: 'entite_supprimee', changement: 'le client a été supprimé', motif: MOTIF_CLIENT_SUPPRIME }, clientId: r.clientId };
      }
    }

    // 3. Les conditions de la règle sur l'état actuel.
    const etiquette = await revaliderEtiquettes(c, r.clientId);
    if (etiquette) return { arret: etiquette, clientId: r.clientId };
    const champ = await revaliderChamps(c);
    if (champ) return { arret: champ, clientId: r.clientId };

    return r;
  } catch (e) {
    logger.error('[revalidation] vérification impossible — la tâche suit son cours', {
      entity_type: tache.entityType, entity_id: tache.entityId, message: e instanceof Error ? e.message : String(e),
    });
    return {};
  }
}
