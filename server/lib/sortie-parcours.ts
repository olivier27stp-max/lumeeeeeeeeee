/* ═══════════════════════════════════════════════════════════════
   SORTIE AUTOMATIQUE DU PARCOURS — drapeau `auto_sortie_parcours`.

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

export interface VerdictSortie {
  /** `true` = annuler la tâche (et donc la suite du parcours). */
  arreter: boolean;
  /** Le motif, en mots de l'écran, écrit dans la tâche annulée. */
  motif: string | null;
}

const CONTINUER: VerdictSortie = { arreter: false, motif: null };
const arret = (motif: string): VerdictSortie => ({ arreter: true, motif: `Arrêté : ${motif}.` });

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

/**
 * Le verdict pour une tâche différée, drapeau ON.
 *
 * `null` = cette fonction ne tranche pas (entité hors de son périmètre, ex.
 * un prospect) : l'appelant garde l'ancienne vérification pour ce cas.
 * Une lecture en échec rend CONTINUER : on ne conclut pas sur une donnée
 * qu'on n'a pas pu lire (même règle que l'ancienne vérification).
 */
export async function verdictSortie(
  supabase: SupabaseClient,
  p: {
    orgId: string;
    entityType: string;
    entityId: string;
    declencheur: string | null | undefined;
    metadonnees: Record<string, unknown> | null | undefined;
    reglages: { arreter_si_resolu?: boolean } | null | undefined;
  },
): Promise<VerdictSortie | null> {
  const famille = familleSortie(p.declencheur);
  const cochee = famille ? sortieCochee(p.reglages, famille) : true;
  const statutsDuDeclencheur = (p.declencheur && DECLENCHE_PAR_RESOLUTION[p.declencheur]) || [];

  if (p.entityType === 'quote') {
    const { data, error } = await supabase
      .from('quotes').select('status, deleted_at').eq('id', p.entityId).eq('org_id', p.orgId).maybeSingle();
    if (error) return CONTINUER;
    if (!data || (data as any).deleted_at) return arret('la soumission a été supprimée');
    const statut = String((data as any).status ?? '');
    if (!cochee || statutsDuDeclencheur.includes(statut)) return CONTINUER;
    return RESOLUS_SOUMISSION.includes(statut) ? arret(MOTIF_SOUMISSION[statut]) : CONTINUER;
  }

  if (p.entityType === 'invoice') {
    const { data, error } = await supabase
      .from('invoices').select('status, client_id').eq('id', p.entityId).eq('org_id', p.orgId).maybeSingle();
    if (error) return CONTINUER;
    if (!data) return arret('la facture a été supprimée');
    const inv = data as { status?: string; client_id?: string | null };
    // Le client supprimé arrête tout, case ou pas : on n'écrit plus à
    // quelqu'un qu'on a retiré du carnet (comportement d'avant).
    if (inv.client_id) {
      const { data: cl, error: clErr } = await supabase
        .from('clients').select('deleted_at').eq('id', inv.client_id).eq('org_id', p.orgId).maybeSingle();
      if (clErr) return CONTINUER;
      if ((cl as any)?.deleted_at) return arret('le client a été supprimé');
    }
    const statut = String(inv.status ?? '');
    if (!cochee || statutsDuDeclencheur.includes(statut)) return CONTINUER;
    if (RESOLUS_FACTURE.includes(statut)) return arret(MOTIF_FACTURE[statut]);
    // Ancien devis porté par une facture (`estimate.sent`, plus émis) : mêmes
    // arrêts qu'avant, pour ne rien changer aux règles qui l'utiliseraient.
    if (p.declencheur === 'estimate.sent' && ['accepted', 'rejected'].includes(statut)) {
      return arret(statut === 'accepted' ? 'la soumission a été acceptée' : 'la soumission a été refusée');
    }
    return CONTINUER;
  }

  if (p.entityType === 'schedule_event' || p.entityType === 'appointment') {
    const { data, error } = await supabase
      .from('schedule_events').select('status, deleted_at').eq('id', p.entityId).eq('org_id', p.orgId).maybeSingle();
    if (error) return CONTINUER;
    if (!data || (data as any).deleted_at) return arret('le rendez-vous a été supprimé');
    const statut = String((data as any).status ?? '');
    if (!cochee || statutsDuDeclencheur.includes(statut)) return CONTINUER;
    return statut === 'cancelled' ? arret('le rendez-vous a été annulé') : CONTINUER;
  }

  if (p.entityType === 'deal') {
    // L'opportunité n'avait AUCUNE vérification : hors de la case, rien ne change.
    if (famille !== 'opportunite' || !cochee) return CONTINUER;
    const { data, error } = await supabase
      .from('deals').select('stage_id, deleted_at').eq('id', p.entityId).eq('org_id', p.orgId).maybeSingle();
    if (error) return CONTINUER;
    if (!data || (data as any).deleted_at) return arret('l’opportunité a été supprimée');
    const etapeAttendue = p.metadonnees?.stage_id;
    if (typeof etapeAttendue === 'string' && etapeAttendue && (data as any).stage_id !== etapeAttendue) {
      return arret('l’opportunité a changé d’étape');
    }
    return CONTINUER;
  }

  return null;
}
