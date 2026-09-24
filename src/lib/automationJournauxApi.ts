/* ═══════════════════════════════════════════════════════════════
   Ce qu'une automatisation a fait — historique et journaux.

   Les données existaient DÉJÀ : le moteur écrit chaque action dans
   `automation_execution_logs` et chaque envoi prévu dans
   `automation_scheduled_tasks`. Personne ne les lisait. C'était le trou
   le plus coûteux du produit : quand un client ne recevait rien,
   l'entrepreneur n'avait aucun moyen de savoir pourquoi.

   Colonnes vérifiées en base le 2026-09-24 (pas devinées) :
   · execution_logs  : action_type, action_config, result_success,
                       result_error, result_data, duration_ms, entity_type,
                       entity_id, trigger_event, created_at
   · scheduled_tasks : entity_type, entity_id, action_config, execute_at,
                       status, attempts, last_error, completed_at,
                       step_id, sequence_context
   · clients         : first_name + last_name (PAS `name`), et il n'existe
                       aucune table de prospects — un `entity_type = 'lead'`
                       reste donc sans nom affichable.

   La RLS filtre déjà par organisation (`has_org_membership`), mais chaque
   requête porte quand même son `org_id` : une policy peut changer, et une
   fuite entre entreprises ne se rattrape pas.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import { getCurrentOrgId } from './orgApi';

/** Sur combien de jours on garde l'historique visible, comme GHL. */
export const FENETRE_JOURS = 60;

// ── Journaux d'exécution ────────────────────────────────────

export interface LigneJournal {
  id: string;
  action_type: string;
  result_success: boolean;
  result_error: string | null;
  duration_ms: number | null;
  entity_type: string;
  entity_id: string;
  trigger_event: string;
  created_at: string;
  /** Nom du client, résolu après coup — la table ne le porte pas. */
  client?: string | null;
}

export interface FiltresJournal {
  ruleId: string;
  /** ISO. Par défaut : les 60 derniers jours. */
  depuis?: string;
  jusqua?: string;
  /** `all` = tous. */
  action?: string;
  statut?: 'all' | 'succes' | 'echec';
  limite?: number;
}

export async function lireJournaux(f: FiltresJournal): Promise<LigneJournal[]> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return [];

  const depuis = f.depuis ?? new Date(Date.now() - FENETRE_JOURS * 86400_000).toISOString();

  let q = supabase
    .from('automation_execution_logs')
    .select('id, action_type, result_success, result_error, duration_ms, entity_type, entity_id, trigger_event, created_at')
    .eq('org_id', orgId)
    .eq('automation_rule_id', f.ruleId)
    .gte('created_at', depuis)
    .order('created_at', { ascending: false })
    .limit(f.limite ?? 200);

  if (f.jusqua) q = q.lte('created_at', f.jusqua);
  if (f.action && f.action !== 'all') q = q.eq('action_type', f.action);
  if (f.statut === 'succes') q = q.eq('result_success', true);
  if (f.statut === 'echec') q = q.eq('result_success', false);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return await nommerLesClients((data ?? []) as LigneJournal[], orgId);
}

// ── Historique des inscriptions ─────────────────────────────

export interface LigneInscription {
  id: string;
  entity_type: string;
  entity_id: string;
  status: string;
  execute_at: string;
  completed_at: string | null;
  attempts: number;
  last_error: string | null;
  step_id: string | null;
  action_config: { type?: string } | null;
  client?: string | null;
}

export async function lireInscriptions(params: {
  ruleId: string;
  depuis?: string;
  jusqua?: string;
  statut?: 'all' | 'pending' | 'completed' | 'failed' | 'cancelled';
  limite?: number;
}): Promise<LigneInscription[]> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return [];

  const depuis = params.depuis ?? new Date(Date.now() - FENETRE_JOURS * 86400_000).toISOString();

  let q = supabase
    .from('automation_scheduled_tasks')
    .select('id, entity_type, entity_id, status, execute_at, completed_at, attempts, last_error, step_id, action_config')
    .eq('org_id', orgId)
    .eq('automation_rule_id', params.ruleId)
    .gte('created_at', depuis)
    .order('execute_at', { ascending: false })
    .limit(params.limite ?? 200);

  if (params.jusqua) q = q.lte('created_at', params.jusqua);
  if (params.statut && params.statut !== 'all') q = q.eq('status', params.statut);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return await nommerLesClients((data ?? []) as LigneInscription[], orgId);
}

// ── Résoudre les noms ───────────────────────────────────────

/**
 * Remplace les identifiants par des noms de clients.
 *
 * Ni les journaux ni la file ne portent le nom : ils portent `entity_type`
 * + `entity_id` (un devis, une facture, un job…). Afficher un UUID à un
 * entrepreneur ne lui dit rien — il veut savoir QUI n'a pas reçu son message.
 *
 * On remonte donc l'entité jusqu'à son client, par type, en une requête par
 * table plutôt qu'une par ligne. Une table illisible n'empêche pas d'afficher
 * le reste : la colonne reste vide, et c'est déjà mieux qu'un écran en erreur.
 */
async function nommerLesClients<T extends { entity_type: string; entity_id: string; client?: string | null }>(
  lignes: T[],
  orgId: string,
): Promise<T[]> {
  if (!lignes.length) return lignes;

  /**
   * entity_type → table qui porte `client_id`.
   *
   * Vérifié en base ET dans le moteur le 2026-09-24, pas deviné :
   * · `quotes`, `invoices`, `jobs` portent bien `client_id` ;
   * · `schedule_events` N'EN A PAS — un rendez-vous passe par son `job_id` ;
   * · le type émis est `schedule_event`, pas `appointment` (62 % des journaux
   *   sont des `lead`, 22 % des `schedule_event` — mesuré) ;
   * · un PROSPECT est un client : `entity_id` d'un `lead` est directement un
   *   `clients.id` (server/lib/actions/index.ts:543). Il n'y a pas de table
   *   de prospects séparée.
   * Avec PostgREST, une seule colonne inexistante fait échouer TOUTE la
   * requête, et supabase-js ne lève jamais : la colonne serait restée vide
   * pour tout le monde, sans un mot.
   */
  const TABLES: Record<string, string> = {
    quote: 'quotes',
    invoice: 'invoices',
    job: 'jobs',
  };

  /** Les types qui pointent DIRECTEMENT sur un client. */
  const DIRECTS = new Set(['lead', 'client']);
  /** Les types qui passent par un rendez-vous, donc par son job. */
  const VIA_RDV = new Set(['schedule_event', 'appointment']);

  const parType = new Map<string, Set<string>>();
  for (const l of lignes) {
    if (!TABLES[l.entity_type] && !DIRECTS.has(l.entity_type) && !VIA_RDV.has(l.entity_type)) continue;
    if (!parType.has(l.entity_type)) parType.set(l.entity_type, new Set());
    parType.get(l.entity_type)!.add(l.entity_id);
  }

  /** entity_id → nom affichable. */
  const noms = new Map<string, string>();
  /** client_id → nom, mis en commun entre les types. */
  const nomsClients = new Map<string, string>();

  /** Charge les noms manquants, en une requête. */
  const chargerClients = async (ids: string[]) => {
    const absents = ids.filter((i) => i && !nomsClients.has(i));
    if (!absents.length) return;
    const { data } = await supabase
      .from('clients')
      .select('id, first_name, last_name')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .in('id', absents.slice(0, 300));
    for (const c of data ?? []) {
      const complet = `${(c as { first_name?: string }).first_name ?? ''} ${(c as { last_name?: string }).last_name ?? ''}`.trim();
      if (complet) nomsClients.set((c as { id: string }).id, complet);
    }
  };

  for (const [type, ids] of parType) {
    const liste = [...ids].slice(0, 200);
    try {
      if (DIRECTS.has(type)) {
        // Un prospect EST un client : son entity_id est un clients.id.
        await chargerClients(liste);
        for (const id of liste) {
          if (nomsClients.has(id)) noms.set(id, nomsClients.get(id)!);
        }
        continue;
      }

      if (VIA_RDV.has(type)) {
        // Un rendez-vous n'a pas de client : il tient à un job, qui en a un.
        const { data: evts } = await supabase
          .from('schedule_events')
          .select('id, job_id')
          .eq('org_id', orgId)
          .in('id', liste);
        const jobIds = [...new Set((evts ?? []).map((e) => (e as { job_id?: string }).job_id).filter(Boolean))] as string[];
        if (!jobIds.length) continue;
        const { data: jobs } = await supabase
          .from('jobs')
          .select('id, client_id')
          .eq('org_id', orgId)
          .in('id', jobIds);
        const clientParJob = new Map((jobs ?? []).map((j) => [(j as { id: string }).id, (j as { client_id?: string }).client_id]));
        await chargerClients([...clientParJob.values()].filter(Boolean) as string[]);
        for (const e of evts ?? []) {
          const cid = clientParJob.get((e as { job_id?: string }).job_id ?? '');
          if (cid && nomsClients.has(cid)) noms.set((e as { id: string }).id, nomsClients.get(cid)!);
        }
        continue;
      }

      const { data } = await supabase
        .from(TABLES[type])
        .select('id, client_id')
        .eq('org_id', orgId)
        .in('id', liste);

      await chargerClients((data ?? []).map((r) => (r as { client_id?: string }).client_id).filter(Boolean) as string[]);
      for (const r of data ?? []) {
        const cid = (r as { client_id?: string }).client_id;
        if (cid && nomsClients.has(cid)) noms.set((r as { id: string }).id, nomsClients.get(cid)!);
      }
    } catch (e: unknown) {
      // Une table illisible ne doit pas vider l'écran : la colonne reste vide
      // et on le dit, plutôt que de tout faire échouer.
      console.error('[journaux] noms de clients indisponibles pour', type,
        e instanceof Error ? e.message : String(e));
    }
  }

  return lignes.map((l) => ({ ...l, client: noms.get(l.entity_id) ?? null }));
}

// ── Libellés ────────────────────────────────────────────────

/** Le nom d'une action, en mots du métier. */
export function libelleAction(type: string, fr: boolean): string {
  const l: Record<string, [string, string]> = {
    send_sms: ['Texto', 'Text'],
    send_email: ['Courriel', 'Email'],
    create_notification: ['Notification', 'Notification'],
    send_notification: ['Notification', 'Notification'],
    create_task: ['Tâche', 'Task'],
    request_review: ['Demande d’avis', 'Review request'],
    log_activity: ['Journal', 'Activity log'],
    update_status: ['Changement de statut', 'Status change'],
    move_deal_stage: ['Déplacement dans le pipeline', 'Pipeline move'],
  };
  const p = l[type];
  return p ? (fr ? p[0] : p[1]) : type.replace(/_/g, ' ');
}

/** Le statut d'une inscription, en mots du métier. */
export function libelleStatut(statut: string, fr: boolean): string {
  const l: Record<string, [string, string]> = {
    pending: ['En attente', 'Pending'],
    running: ['En cours', 'Running'],
    completed: ['Terminé', 'Completed'],
    failed: ['Échoué', 'Failed'],
    cancelled: ['Annulé', 'Cancelled'],
  };
  const p = l[statut];
  return p ? (fr ? p[0] : p[1]) : statut;
}

/**
 * La raison d'un échec, traduite.
 *
 * « No recipient phone » ne dit rien à un entrepreneur ; « ce client n'a pas
 * de numéro » lui dit quoi faire. Une cause inconnue reste affichée telle
 * quelle — mieux vaut un message technique qu'un silence.
 */
export function raisonLisible(erreur: string | null, fr: boolean): string | null {
  if (!erreur) return null;
  const e = erreur.toLowerCase();
  const paires: Array<[string, string, string]> = [
    ['no recipient phone', 'ce client n’a pas de numéro de téléphone', 'this client has no phone number'],
    ['no recipient email', 'ce client n’a pas d’adresse courriel', 'this client has no email address'],
    ['opted out', 'ce client s’est désabonné', 'this client opted out'],
    ['not configured', 'l’envoi n’est pas configuré dans les réglages', 'sending is not configured in settings'],
    ['frequency cap', 'la limite de messages pour ce client est atteinte', 'message limit reached for this client'],
    ['consentement', 'le consentement de ce client n’est pas enregistré', 'this client’s consent is not on file'],
    ['consent', 'le consentement de ce client n’est pas enregistré', 'this client’s consent is not on file'],
    ['supprimée', 'l’automatisation a été supprimée', 'the automation was deleted'],
  ];
  for (const [motif, fra, eng] of paires) {
    if (e.includes(motif)) return fr ? fra : eng;
  }
  return erreur;
}

// ── La vue d'ensemble ───────────────────────────────────────

export interface ActiviteSemaine {
  /** Le lundi de la semaine. */
  debut: Date;
  fin: Date;
  /** Déclenchements de la semaine. */
  n: number;
}

/**
 * Combien de fois les automatisations sont parties, semaine par semaine.
 *
 * La vue d'ensemble affichait une courbe plate à zéro « en attendant le
 * comptage » — alors que `automation_execution_logs` porte déjà chaque
 * exécution. La donnée était là, personne ne la lisait : la courbe
 * annonçait « rien ne se passe » à une entreprise dont les automatisations
 * tournaient.
 *
 * On compte les DÉCLENCHEMENTS, pas les actions : une règle qui envoie un
 * courriel ET crée une tâche s'est déclenchée UNE fois. La paire
 * (entité, événement) identifie un déclenchement.
 */
export async function activiteParSemaine(semaines = 7): Promise<{
  total: number;
  parSemaine: ActiviteSemaine[];
}> {
  const orgId = await getCurrentOrgId();

  // Les bornes : `semaines` tranches de 7 jours, la dernière finissant
  // aujourd'hui.
  const maintenant = new Date();
  const tranches: ActiviteSemaine[] = [];
  for (let i = semaines - 1; i >= 0; i--) {
    const fin = new Date(maintenant);
    fin.setDate(maintenant.getDate() - i * 7);
    fin.setHours(23, 59, 59, 999);
    const debut = new Date(fin);
    debut.setDate(fin.getDate() - 6);
    debut.setHours(0, 0, 0, 0);
    tranches.push({ debut, fin, n: 0 });
  }

  if (!orgId) return { total: 0, parSemaine: tranches };

  const depuis = tranches[0].debut.toISOString();
  const { data, error } = await supabase
    .from('automation_execution_logs')
    .select('created_at, entity_id, trigger_event')
    .eq('org_id', orgId)
    .gte('created_at', depuis)
    .order('created_at', { ascending: true })
    .limit(5000);

  if (error || !data) {
    console.error('[apercu] activité par semaine', error?.message ?? 'aucune donnée');
    return { total: 0, parSemaine: tranches };
  }

  // Dédoublonnage : une règle qui fait trois actions n'est qu'UN
  // déclenchement. La clé porte aussi la semaine, pour qu'un même client
  // repassé la semaine suivante compte deux fois — c'est bien deux
  // déclenchements.
  const vus = new Set<string>();
  let total = 0;
  for (const ligne of data) {
    const quand = new Date(ligne.created_at as string);
    const tranche = tranches.find((t) => quand >= t.debut && quand <= t.fin);
    if (!tranche) continue;
    const cle = `${tranche.debut.toISOString().slice(0, 10)}:${ligne.entity_id}:${ligne.trigger_event}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    tranche.n += 1;
    total += 1;
  }

  return { total, parSemaine: tranches };
}
