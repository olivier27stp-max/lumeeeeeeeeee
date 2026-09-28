/* ═══════════════════════════════════════════════════════════════
   Event Bus — Typed in-process event emitter for CRM events.
   Every emission also writes to the activity_log table.
   ═══════════════════════════════════════════════════════════════ */

import { EventEmitter } from 'events';
import { SupabaseClient } from '@supabase/supabase-js';

// ── Event types ─────────────────────────────────────────────────

export type CRMEventType =
  | 'lead.created'
  | 'lead.updated'
  | 'lead.status_changed'
  | 'lead.converted'
  | 'pipeline_deal.stage_changed'
  // Pipeline de ventes (table `deals`). À ne pas confondre avec
  // `pipeline_deal.stage_changed` ci-dessus, qui appartient à l'ANCIEN
  // pipeline de porte-à-porte (table `pipeline_deals`).
  | 'deal.stage_entered'
  | 'deal.stage_exited'
  | 'deal.stage_idle'
  | 'client.archived'
  | 'client.deleted'
  | 'estimate.sent'
  | 'estimate.accepted'
  | 'estimate.rejected'
  | 'quote.created'
  | 'quote.sent'
  /** Le client final a ouvert la page publique de sa soumission (mission 2026-09-28). */
  | 'quote.viewed'
  | 'quote.approved'
  | 'quote.declined'
  | 'quote.changes_requested'
  | 'quote.converted'
  | 'agreement.signed'
  | 'appointment.created'
  | 'appointment.updated'
  | 'appointment.cancelled'
  | 'job.created'
  | 'job.completed'
  | 'job.ready_for_invoicing'  // Emitted when technician completes a job — triggers admin/LIA invoicing
  | 'invoice.created'
  | 'invoice.sent'
  | 'invoice.paid'
  | 'invoice.overdue'
  /**
   * Le client a répondu à un message de l'entreprise.
   *
   * Émis par le webhook des SMS entrants (`routes/messages.ts`), et SEULEMENT
   * quand l'expéditeur est un client — un membre de l'équipe qui écrit à son
   * assistant n'est pas une réponse de client.
   *
   * L'entité est le CLIENT (pas la conversation) : c'est de lui que les
   * actions ont besoin, et c'est lui que les variables décrivent.
   */
  // Champs personnalises v2 : emis par customFieldsService (server/lib/champs)
  // quand une valeur change reellement — jamais sur un rejeu identique.
  | 'custom_field.changed'
  | 'client.replied'
  /**
   * Une étiquette vient d'être posée sur un client.
   *
   * C'est le « handoff manuel » : un vendeur marque une fiche « À rappeler »
   * et une séquence part. Le retrait d'étiquette N'EST PAS émis — retirer un
   * marqueur ne devrait jamais déclencher un envoi au client.
   */
  | 'client.tagged'
  /**
   * Une tâche vient d'être marquée terminée.
   *
   * L'entité est le CLIENT rattaché à la tâche quand il y en a un — c'est
   * lui que les messages décrivent. Une tâche sans lien client existe
   * (« commander des pièces ») : elle n'émet rien, faute de destinataire.
   */
  | 'task.completed'
  /**
   * Une note vient d'être ajoutée sur un client ou un job.
   *
   * Usage typique : une note sur la fiche prévient le responsable. Les
   * notes écrites PAR une automatisation n'émettent rien — sinon une règle
   * « ajouter une note » qui écoute « note ajoutée » tournerait en boucle.
   */
  | 'note.added'
  /**
   * Une date personnalisée est atteinte (fin de contrat, échéance de
   * garantie, anniversaire d'installation).
   *
   * Émis par le balayage QUOTIDIEN `balayerRappelsDates`, jamais par une
   * écriture : une date se corrige, un client se supprime, et une règle
   * peut être créée après la saisie. Un balayage voit l'état réel du jour.
   */
  /**
   * Un service EXTÉRIEUR a appelé le webhook entrant de l'entreprise
   * (formulaire du site, Zapier, Facebook Leads, fournisseur d'appels).
   *
   * `metadata.corps` porte le JSON reçu tel quel : les conditions d'une
   * automatisation peuvent s'en servir (`corps.source = "facebook"`).
   * `entityId` est l'id du webhook — il n'y a pas d'entité CRM derrière.
   */
  | 'webhook.received'
  | 'date.reached';

export interface CRMEvent {
  type: CRMEventType;
  orgId: string;
  entityType: string;
  entityId: string;
  actorId?: string;
  metadata: Record<string, any>;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /** Ligne de l'outbox (`domain_events`) qui porte cet événement, s'il y en a une. */
  outboxId?: number;
  /**
   * Règles déjà traitées pour cet événement — renseigné au rejeu d'un
   * orphelin, complété par le moteur au fil des règles (voir outbox.ts).
   */
  reglesTraitees?: string[];
}

// Map event types to activity_log event_type values
const EVENT_TO_ACTIVITY: Record<CRMEventType, string> = {
  'lead.created': 'lead_created',
  'lead.updated': 'lead_updated',
  'lead.status_changed': 'status_changed',
  'lead.converted': 'lead_converted',
  'pipeline_deal.stage_changed': 'deal_stage_changed',
  'deal.stage_entered': 'deal_stage_entered',
  'deal.stage_exited': 'deal_stage_exited',
  'deal.stage_idle': 'deal_stage_idle',
  'client.archived': 'client_archived',
  'client.deleted': 'client_deleted',
  'estimate.sent': 'estimate_sent',
  'estimate.accepted': 'estimate_accepted',
  'estimate.rejected': 'estimate_rejected',
  'quote.created': 'quote_created',
  'quote.sent': 'quote_sent',
  'quote.viewed': 'quote_viewed',
  'quote.approved': 'quote_approved',
  'quote.declined': 'quote_declined',
  'quote.changes_requested': 'quote_changes_requested',
  'quote.converted': 'quote_converted',
  'agreement.signed': 'agreement_signed',
  'appointment.created': 'appointment_created',
  'appointment.updated': 'appointment_updated',
  'appointment.cancelled': 'appointment_cancelled',
  'job.created': 'job_created',
  'job.completed': 'job_completed',
  'job.ready_for_invoicing': 'job_ready_for_invoicing',
  'invoice.created': 'invoice_created',
  'invoice.sent': 'invoice_sent',
  'invoice.paid': 'invoice_paid',
  'invoice.overdue': 'invoice_overdue',
  'custom_field.changed': 'custom_field_changed',
  'client.replied': 'client_replied',
  'client.tagged': 'client_tagged',
  'task.completed': 'task_completed',
  'note.added': 'note_added',
  'date.reached': 'date_reached',
  'webhook.received': 'webhook_received',
};

/**
 * Types qui ont DÉJÀ leur file durable : `pipeline_events`, alimentée par
 * trigger et rejouée par pipelineEvenements.ts, qui les réémet ici. Les
 * consigner aussi dans `domain_events` les ferait rejouer deux fois.
 */
const TYPES_DEJA_DURABLES = new Set<CRMEventType>([
  'deal.stage_entered',
  'deal.stage_exited',
  'deal.stage_idle',
]);

/**
 * Types qui ne doivent exister qu'UNE fois dans `activity_log` pour une même
 * entité et un même palier — garanti par un index unique en base
 * (20261001100000_activity_log_retard_unique.sql). Pour eux, le journal passe
 * en premier : s'il refuse le doublon, l'événement n'est ni consigné ni
 * diffusé. Ainsi un redéploiement ou une 2e instance ne peut plus répéter
 * « Facture en retard J+x » dans l'historique.
 */
const TYPES_UNIQUES = new Set<CRMEventType>(['invoice.overdue']);

// ── Bus singleton ───────────────────────────────────────────────

class CRMEventBus extends EventEmitter {
  private supabase: SupabaseClient | null = null;

  init(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  // @ts-expect-error — intentional override of EventEmitter.emit with async CRM-typed version
  async emit(event: CRMEventType, data: Omit<CRMEvent, 'type'>): Promise<boolean> {
    const fullEvent: CRMEvent = { type: event, ...data };

    // Le journal et l'outbox en parallèle : l'appelant (une route HTTP, le
    // plus souvent) n'attend pas une écriture de plus qu'avant.
    let outboxId: number | null = null;
    if (this.supabase && TYPES_UNIQUES.has(event)) {
      if ((await this.journaliser(this.supabase, fullEvent)) === 'doublon') return false;
      outboxId = await this.consigner(this.supabase, fullEvent);
    } else if (this.supabase) {
      [, outboxId] = await Promise.all([
        this.journaliser(this.supabase, fullEvent),
        TYPES_DEJA_DURABLES.has(event) ? Promise.resolve(null) : this.consigner(this.supabase, fullEvent),
      ]);
    }

    /*
     * Les écouteurs sont lancés ici, mais PAS attendus : l'appelant ne doit
     * pas patienter pendant qu'une automatisation envoie un texto (c'était
     * déjà le cas avec `super.emit`, qui n'attend pas les écouteurs async).
     * C'est la fin de leur traitement, en arrière-plan, qui coche la ligne.
     */
    if (outboxId !== null) {
      fullEvent.outboxId = outboxId;
      fullEvent.reglesTraitees = [];
    }
    const { aDesEcouteurs, fin } = this.diffuser(fullEvent);
    if (outboxId !== null) {
      void fin.then((erreurs) => this.cocher(outboxId as number, erreurs));
    }
    return aDesEcouteurs;
  }

  /**
   * Rejoue un événement consigné qui n'a jamais été coché — un orphelin de
   * redémarrage. Appelé par `rejouerEvenementsOrphelins` (outbox.ts).
   *
   * Contrairement à `emit`, ATTEND la fin des écouteurs : le rejeu tourne
   * dans le tick du planificateur, qui traite la file en série.
   *
   * N'écrit pas `activity_log` une seconde fois : l'émission d'origine l'a
   * déjà fait.
   */
  async rejouer(outboxId: number, evenement: CRMEvent): Promise<void> {
    // Sans écouteur (moteur pas encore branché), cocher la ligne perdrait
    // l'événement une seconde fois. On lève : il sera retenté au tick suivant.
    if (this.listenerCount(evenement.type) === 0) {
      throw new Error(`aucun écouteur pour ${evenement.type} — moteur non initialisé`);
    }
    const erreurs = await this.diffuser(evenement).fin;
    await this.cocher(outboxId, erreurs);
  }

  /**
   * Appelle chaque écouteur et rend une promesse qui se résout quand TOUS
   * ont fini, avec leurs erreurs. Ne rejette jamais.
   *
   * Un écouteur qui échoue n'empêche pas les autres, comme avec `super.emit`
   * pour des écouteurs async. La différence : son échec est maintenant
   * récupéré au lieu de finir en rejet non géré.
   */
  private diffuser(evenement: CRMEvent): { aDesEcouteurs: boolean; fin: Promise<string[]> } {
    const ecouteurs = this.listeners(evenement.type) as Array<(e: CRMEvent) => unknown>;
    const promesses = ecouteurs.map((ecouteur) => {
      try {
        return Promise.resolve(ecouteur.call(this, evenement));
      } catch (err) {
        return Promise.reject(err);
      }
    });
    const fin = Promise.allSettled(promesses).then((resultats) =>
      resultats
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason))),
    );
    return { aDesEcouteurs: ecouteurs.length > 0, fin };
  }

  private async journaliser(supabase: SupabaseClient, fullEvent: CRMEvent): Promise<'ok' | 'doublon'> {
    const event = fullEvent.type;
    // supabase-js retourne l'erreur, il ne la lève pas : le try/catch seul
    // laissait passer toute écriture refusée sans une ligne de log.
    try {
      const { error } = await supabase.from('activity_log').insert({
        org_id: fullEvent.orgId,
        entity_type: fullEvent.entityType,
        entity_id: fullEvent.entityId,
        related_entity_type: fullEvent.relatedEntityType || null,
        related_entity_id: fullEvent.relatedEntityId || null,
        event_type: EVENT_TO_ACTIVITY[event] || event,
        actor_id: fullEvent.actorId || null,
        metadata: fullEvent.metadata,
      });
      // 23505 = l'index unique a refusé une entrée déjà présente : c'est
      // voulu, pas un incident.
      if (error?.code === '23505') return 'doublon';
      if (error) {
        console.error(`[eventBus] activity_log insert failed for ${event} (org ${fullEvent.orgId}, ${fullEvent.entityType} ${fullEvent.entityId}):`, error.message);
      }
    } catch (err: any) {
      console.error('[eventBus] activity_log insert threw:', err.message);
    }
    return 'ok';
  }

  /**
   * Consigne l'événement dans l'outbox et rend l'id de la ligne.
   *
   * Un échec ne bloque PAS l'émission : l'événement part quand même en
   * mémoire, comme avant l'outbox. On perd seulement la garantie de rejeu
   * pour celui-là — et on le dit.
   */
  private async consigner(supabase: SupabaseClient, fullEvent: CRMEvent): Promise<number | null> {
    try {
      const { data, error } = await supabase
        .from('domain_events')
        .insert({
          org_id: fullEvent.orgId,
          type: fullEvent.type,
          entity_type: fullEvent.entityType,
          entity_id: fullEvent.entityId,
          actor_id: fullEvent.actorId || null,
          related_entity_type: fullEvent.relatedEntityType || null,
          related_entity_id: fullEvent.relatedEntityId || null,
          metadata: fullEvent.metadata ?? {},
        })
        .select('id')
        .single();
      if (error || !data) {
        console.error(`[eventBus] outbox : ${fullEvent.type} non consigné (org ${fullEvent.orgId}) — émis sans garantie de rejeu :`, error?.message);
        return null;
      }
      return (data as { id: number }).id;
    } catch (err: any) {
      console.error('[eventBus] outbox : insertion levée —', err?.message || err);
      return null;
    }
  }

  /**
   * Coche la ligne une fois TOUS les écouteurs terminés.
   *
   * Une erreur d'écouteur est gardée dans `last_error` mais la ligne est
   * quand même cochée : rejouer relancerait AUSSI les écouteurs qui ont
   * réussi, et une action déjà partie repartirait. Le rejeu est réservé aux
   * traitements coupés net par un arrêt du processus.
   */
  private async cocher(outboxId: number, erreurs: string[]): Promise<void> {
    if (!this.supabase) return;
    try {
      const { error } = await this.supabase
        .from('domain_events')
        .update({
          processed_at: new Date().toISOString(),
          last_error: erreurs.length ? erreurs.join(' | ').slice(0, 500) : null,
        })
        .eq('id', outboxId);
      if (error) {
        console.error(`[eventBus] outbox : ligne ${outboxId} traitée mais non cochée — elle sera rejouée :`, error.message);
      }
    } catch (err: any) {
      console.error(`[eventBus] outbox : cochage de ${outboxId} levé —`, err?.message || err);
    }
  }

  onEvent(event: CRMEventType, handler: (data: CRMEvent) => void) {
    this.on(event, handler);
  }

  onAnyEvent(handler: (data: CRMEvent) => void) {
    const allEvents: CRMEventType[] = Object.keys(EVENT_TO_ACTIVITY) as CRMEventType[];
    for (const evt of allEvents) {
      this.on(evt, handler);
    }
  }
}

export const eventBus = new CRMEventBus();
eventBus.setMaxListeners(50);
