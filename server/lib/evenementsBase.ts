/**
 * Événements d'automatisation écrits PAR LA BASE (launch 2026-09-28, bloc 2).
 * ===========================================================================
 *
 * AVANT. Rendez-vous créé ou annulé, job terminé, devis accepté ou refusé,
 * facture envoyée : ces déclencheurs partaient en partie du NAVIGATEUR, en
 * « tire et oublie ». Onglet fermé, réseau coupé, 500 : l'automatisation ne
 * partait jamais, et rien ne le disait. Le refus d'un devis depuis l'app
 * visait même une route inexistante ; les factures récurrentes et « envoyer
 * maintenant » n'émettaient rien.
 *
 * MAINTENANT. Un trigger sur la TRANSITION de statut écrit l'événement dans
 * `automation_evenements_base`, dans la même transaction que le changement
 * (migration 20261003100000). Ce module lit cette file toutes les 15 s et la
 * passe au bus, qui la consigne dans l'outbox et la journalise — exactement
 * comme un événement émis par le serveur. Même principe que `pipeline_events`.
 *
 * GARANTIES.
 *   · rien n'est perdu : la ligne existe dès que le changement est validé ;
 *   · rien n'est émis deux fois : la prise est atomique (verrou optimiste sur
 *     `attempts`) et, après un arrêt entre l'émission et le marquage, on
 *     retrouve l'événement déjà consigné dans l'outbox (`evenement_base_id`)
 *     au lieu de le réémettre ;
 *   · un événement qui échoue est réessayé, puis abandonné et signalé.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { eventBus, type CRMEventType } from './eventBus';
import { logger } from './logger';

export const MAX_TENTATIVES_BASE = 5;
const TAILLE_LOT = 100;
export const INTERVALLE_BASE_MS = 15_000;

/**
 * Plan de visites (M6). Une visite est « en lot » quand le même job a déjà une
 * autre visite active créée juste avant — « Nouveau job » crée la 1re visite
 * puis les suivantes dans la foulée. Seule la 1re confirme ; les rappels
 * restent calés sur chaque visite.
 */
export const FENETRE_LOT_VISITES_MS = 10 * 60 * 1000;

/**
 * MISE EN SERVICE. La migration peut arriver en prod AVANT ce code : pendant
 * ce temps, les triggers remplissent la file ET l'ancien chemin (navigateur,
 * routes) émet encore. Réémettre cet arriéré doublerait les envois. Au tout
 * premier démarrage, on pose une ligne-repère ; tout ce qui la précède est
 * marqué « déjà émis par l'ancien chemin ». Le repère survit aux redémarrages :
 * un vrai arriéré (serveur arrêté) PLUS TARD est bien traité.
 */
export const TYPE_REPERE = '__mise_en_service__';
const ZERO = '00000000-0000-0000-0000-000000000000';

async function dateDeMiseEnService(supabase: SupabaseClient): Promise<string | null> {
  const lire = () => supabase.from('automation_evenements_base').select('created_at')
    .eq('type', TYPE_REPERE).order('created_at').limit(1).maybeSingle();
  const { data, error } = await lire();
  if (error) { logger.error('[evenements-base] repère illisible', { message: error.message }); return null; }
  if (data) return String((data as { created_at: string }).created_at);
  const { error: errIns } = await supabase.from('automation_evenements_base').insert({
    org_id: ZERO, type: TYPE_REPERE, entity_type: 'systeme', entity_id: ZERO, cle: 'repere',
    traite_at: new Date().toISOString(),
  });
  if (errIns && errIns.code !== '23505') { logger.error('[evenements-base] repère non posé', { message: errIns.message }); return null; }
  const relu = await lire();
  return relu.data ? String((relu.data as { created_at: string }).created_at) : null;
}

interface LigneBase {
  id: number;
  org_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  metadata: Record<string, unknown> | null;
  attempts: number;
  created_at: string;
}

/** Métadonnées lues au moment du traitement (état réel, pas une copie). */
async function enrichir(supabase: SupabaseClient, ev: LigneBase): Promise<Record<string, unknown>> {
  const meta: Record<string, unknown> = { ...(ev.metadata ?? {}), evenement_base_id: String(ev.id) };
  if (ev.type !== 'appointment.created' || !meta.job_id) return meta;

  const { data: visite, error: e1 } = await supabase
    .from('schedule_events').select('created_at').eq('id', ev.entity_id).maybeSingle();
  if (e1) throw new Error(`lecture de la visite : ${e1.message}`);
  const creee = Date.parse(String((visite as { created_at?: string } | null)?.created_at ?? ev.created_at));
  const { data: avant, error: e2 } = await supabase
    .from('schedule_events')
    .select('id')
    .eq('org_id', ev.org_id)
    .eq('job_id', String(meta.job_id))
    .neq('id', ev.entity_id)
    .is('deleted_at', null)
    .lt('created_at', new Date(creee).toISOString())
    .gte('created_at', new Date(creee - FENETRE_LOT_VISITES_MS).toISOString())
    .limit(1);
  if (e2) throw new Error(`lecture des visites du job : ${e2.message}`);
  if ((avant?.length ?? 0) > 0) meta.suppress_immediate = true;
  return meta;
}

/**
 * Événements dont l'entité du DÉCLENCHEUR est le client, alors que la base
 * consigne la note ou la tâche elle-même (B-14) : « Note ajoutée » depuis
 * l'onglet Notes d'une fiche (`specific_notes`), « Tâche terminée » quel que
 * soit le chemin (écran, Lumi, import).
 */
const TYPES_VIA_CLIENT = new Set(['note.added', 'task.completed']);

/**
 * « Tâche terminée » est AUSSI émise par un appel du navigateur juste après
 * l'écriture (POST /api/automations/events/task-completed). On lui laisse le
 * temps d'arriver, puis on ne réémet pas ce qu'il a déjà émis : sans ça, une
 * tâche terminée à l'écran déclencherait deux fois.
 */
export const DELAI_GRACE_TACHE_MS = 10_000;

/** La fiche client d'une entité (même carte des liens que la route « task-completed »). */
async function clientDe(supabase: SupabaseClient, orgId: string, type: unknown, id: unknown): Promise<string | null> {
  if (typeof type !== 'string' || typeof id !== 'string' || !type || !id) return null;
  if (type === 'client' || type === 'lead') return id;
  const cible: Record<string, { table: string; colonnes: string }> = {
    job: { table: 'jobs', colonnes: 'client_id' },
    invoice: { table: 'invoices', colonnes: 'client_id' },
    quote: { table: 'quotes', colonnes: 'client_id, lead_id' },
    deal: { table: 'deals', colonnes: 'client_id' },
  };
  const c = cible[type];
  if (!c) return null;
  const { data, error } = await supabase.from(c.table).select(c.colonnes).eq('id', id).eq('org_id', orgId).maybeSingle();
  if (error) throw new Error(`lecture de ${c.table} : ${error.message}`);
  const l = data as { client_id?: string | null; lead_id?: string | null } | null;
  return l?.client_id ?? l?.lead_id ?? null;
}

type Emission =
  | { entityType: string; entityId: string; metadata: Record<string, unknown> }
  | { ignorer: string };

/**
 * Ce qu'il faut ÉMETTRE pour une ligne de la file. Pour la plupart des types,
 * la ligne telle quelle (enrichie). Pour une note ou une tâche : le client
 * rattaché — sans client, rien à qui écrire, la ligne est close avec son motif.
 */
async function preparerEmission(supabase: SupabaseClient, ev: LigneBase): Promise<Emission> {
  if (!TYPES_VIA_CLIENT.has(ev.type)) {
    return { entityType: ev.entity_type, entityId: ev.entity_id, metadata: await enrichir(supabase, ev) };
  }
  const meta = (ev.metadata ?? {}) as Record<string, unknown>;
  const base = { evenement_base_id: String(ev.id) };

  if (ev.type === 'note.added') {
    const clientId = await clientDe(supabase, ev.org_id, ev.entity_type, ev.entity_id);
    if (!clientId) return { ignorer: 'Note sans client rattaché : rien à déclencher' };
    return {
      entityType: 'client',
      entityId: clientId,
      metadata: { ...base, note_sur: meta.note_sur ?? ev.entity_type, texte: String(meta.texte ?? '').slice(0, 500), note_id: meta.note_id ?? null },
    };
  }

  // task.completed
  const taskId = String(meta.task_id ?? ev.entity_id);
  const clientId = await clientDe(supabase, ev.org_id, meta.linked_entity_type, meta.linked_entity_id)
    ?? await clientDe(supabase, ev.org_id, meta.job_id ? 'job' : null, meta.job_id);
  if (!clientId) return { ignorer: 'Tâche sans client rattaché : rien à déclencher' };

  // Le navigateur a-t-il déjà émis cet événement pour cette tâche ?
  const { data: deja, error: errDeja } = await supabase
    .from('domain_events').select('id')
    .eq('org_id', ev.org_id).eq('type', 'task.completed').eq('entity_id', clientId)
    .eq('metadata->>task_id', taskId)
    .is('metadata->>evenement_base_id', null)
    .gte('created_at', new Date(Date.parse(ev.created_at) - DELAI_GRACE_TACHE_MS).toISOString())
    .limit(1);
  if (errDeja) throw new Error(`lecture de l'outbox : ${errDeja.message}`);
  if (deja?.length) return { ignorer: 'Déjà émis par l’écran des tâches' };

  const { data: client, error: errClient } = await supabase
    .from('clients').select('first_name, last_name, email, phone').eq('id', clientId).eq('org_id', ev.org_id).maybeSingle();
  if (errClient) throw new Error(`lecture du client : ${errClient.message}`);
  const c = client as { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null } | null;
  return {
    entityType: 'client',
    entityId: clientId,
    metadata: {
      ...base,
      task_id: taskId,
      task_title: String(meta.task_title ?? ''),
      client_name: c ? `${c.first_name || ''} ${c.last_name || ''}`.trim() : '',
      email: c?.email || '',
      phone: c?.phone || '',
    },
  };
}

async function marquer(supabase: SupabaseClient, id: number, champs: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('automation_evenements_base').update(champs).eq('id', id);
  if (error) logger.error('[evenements-base] marquage impossible', { id, message: error.message });
}

/**
 * Traite la file. Ne lève jamais.
 * `options.orgId` : ne traite que la file de CETTE entreprise (suite
 * d'intégration des automatisations, bureau de test) — sans lui, toute la file.
 * @returns le nombre d'événements passés au bus.
 */
export async function traiterEvenementsBase(supabase: SupabaseClient, options: { orgId?: string } = {}): Promise<number> {
  const depuis = await dateDeMiseEnService(supabase);
  if (!depuis) return 0; // sans repère, on ne sait pas quoi est déjà parti : on attend

  // L'arriéré d'avant la mise en service a été émis par l'ancien chemin.
  let arriere = supabase
    .from('automation_evenements_base')
    .update({ traite_at: new Date().toISOString(), last_error: 'Antérieur à la mise en service : émis par l’ancien chemin' })
    .is('traite_at', null)
    .lt('created_at', depuis);
  if (options.orgId) arriere = arriere.eq('org_id', options.orgId);
  const { error: errArriere } = await arriere;
  if (errArriere) logger.error('[evenements-base] arriéré non marqué', { message: errArriere.message });

  let file = supabase
    .from('automation_evenements_base')
    .select('id, org_id, type, entity_type, entity_id, related_entity_type, related_entity_id, metadata, attempts, created_at')
    .is('traite_at', null)
    .lt('attempts', MAX_TENTATIVES_BASE);
  if (options.orgId) file = file.eq('org_id', options.orgId);
  const { data, error } = await file
    .order('id')
    .limit(TAILLE_LOT);
  if (error) {
    logger.error('[evenements-base] lecture de la file impossible', { message: error.message });
    return 0;
  }

  let emis = 0;
  for (const ev of (data ?? []) as LigneBase[]) {
    // « Tâche terminée » : on laisse à l'appel du navigateur le temps
    // d'arriver (voir DELAI_GRACE_TACHE_MS). La ligne reste telle quelle.
    if (ev.type === 'task.completed' && Date.now() - Date.parse(ev.created_at) < DELAI_GRACE_TACHE_MS) continue;

    // Prise atomique : deux instances ne traitent jamais la même ligne.
    const { data: pris, error: errPrise } = await supabase
      .from('automation_evenements_base')
      .update({ attempts: ev.attempts + 1 })
      .eq('id', ev.id)
      .eq('attempts', ev.attempts)
      .is('traite_at', null)
      .select('id');
    if (errPrise || !pris?.length) continue;

    try {
      // Ce qui sera émis : la ligne enrichie, ou — note, tâche — le client
      // rattaché (B-14). Rien à émettre (pas de client, déjà émis par
      // l'écran) : la ligne est close avec son motif, ce n'est pas un échec.
      const emission = await preparerEmission(supabase, ev);
      if ('ignorer' in emission) {
        await marquer(supabase, ev.id, { traite_at: new Date().toISOString(), last_error: emission.ignorer });
        continue;
      }

      // Déjà tenté : l'émission a pu réussir juste avant un arrêt. Si
      // l'outbox l'a déjà, on marque sans réémettre (pas de double envoi).
      if (ev.attempts > 0) {
        const { data: deja, error: errDeja } = await supabase
          .from('domain_events').select('id')
          .eq('org_id', ev.org_id).eq('type', ev.type).eq('entity_id', emission.entityId)
          .eq('metadata->>evenement_base_id', String(ev.id))
          .limit(1);
        if (errDeja) throw new Error(`lecture de l'outbox : ${errDeja.message}`);
        if (deja?.length) {
          await marquer(supabase, ev.id, { traite_at: new Date().toISOString(), last_error: null });
          continue;
        }
      }

      await eventBus.emit(ev.type as CRMEventType, {
        orgId: ev.org_id,
        entityType: emission.entityType,
        entityId: emission.entityId,
        ...(ev.related_entity_type && ev.related_entity_id
          ? { relatedEntityType: ev.related_entity_type, relatedEntityId: ev.related_entity_id } : {}),
        metadata: emission.metadata,
      });
      await marquer(supabase, ev.id, { traite_at: new Date().toISOString(), last_error: null });
      emis++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const tentatives = ev.attempts + 1;
      await marquer(supabase, ev.id, { last_error: message.slice(0, 500) });
      logger.error(
        tentatives >= MAX_TENTATIVES_BASE ? '[evenements-base] ABANDONNÉ après tentatives répétées' : '[evenements-base] échec, sera réessayé',
        { id: ev.id, orgId: ev.org_id, type: ev.type, tentatives, message },
      );
    }
  }
  if (emis > 0) logger.info('[evenements-base] événements passés au bus', { n: emis });
  return emis;
}

let minuterie: ReturnType<typeof setInterval> | null = null;
let enCours = false;

/** Lecture toutes les 15 s : une confirmation ne doit pas attendre le tick de 5 min. */
export function demarrerEvenementsBase(supabase: SupabaseClient): void {
  if (minuterie) return;
  const tour = async () => {
    if (enCours) return;
    enCours = true;
    try { await traiterEvenementsBase(supabase); } finally { enCours = false; }
  };
  void tour();
  minuterie = setInterval(() => void tour(), INTERVALLE_BASE_MS);
}
