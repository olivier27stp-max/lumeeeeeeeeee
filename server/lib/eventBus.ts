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
  | 'client.archived'
  | 'client.deleted'
  | 'estimate.sent'
  | 'estimate.accepted'
  | 'estimate.rejected'
  | 'quote.created'
  | 'quote.sent'
  | 'quote.approved'
  | 'quote.declined'
  | 'quote.converted'
  | 'appointment.created'
  | 'appointment.updated'
  | 'appointment.cancelled'
  | 'job.created'
  | 'job.completed'
  | 'invoice.created'
  | 'invoice.sent'
  | 'invoice.paid'
  | 'invoice.overdue';

export interface CRMEvent {
  type: CRMEventType;
  orgId: string;
  entityType: string;
  entityId: string;
  actorId?: string;
  metadata: Record<string, any>;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

// Map event types to activity_log event_type values
const EVENT_TO_ACTIVITY: Record<CRMEventType, string> = {
  'lead.created': 'lead_created',
  'lead.updated': 'lead_updated',
  'lead.status_changed': 'status_changed',
  'lead.converted': 'lead_converted',
  'pipeline_deal.stage_changed': 'deal_stage_changed',
  'client.archived': 'client_archived',
  'client.deleted': 'client_deleted',
  'estimate.sent': 'estimate_sent',
  'estimate.accepted': 'estimate_accepted',
  'estimate.rejected': 'estimate_rejected',
  'quote.created': 'quote_created',
  'quote.sent': 'quote_sent',
  'quote.approved': 'quote_approved',
  'quote.declined': 'quote_declined',
  'quote.converted': 'quote_converted',
  'appointment.created': 'appointment_created',
  'appointment.updated': 'appointment_updated',
  'appointment.cancelled': 'appointment_cancelled',
  'job.created': 'job_created',
  'job.completed': 'job_completed',
  'invoice.created': 'invoice_created',
  'invoice.sent': 'invoice_sent',
  'invoice.paid': 'invoice_paid',
  'invoice.overdue': 'invoice_overdue',
};

// ── Bus singleton ───────────────────────────────────────────────

class CRMEventBus extends EventEmitter {
  private supabase: SupabaseClient | null = null;

  init(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async emit(event: CRMEventType, data: Omit<CRMEvent, 'type'>): Promise<boolean> {
    const fullEvent: CRMEvent = { type: event, ...data };

    // Write to activity_log
    if (this.supabase) {
      try {
        await this.supabase.from('activity_log').insert({
          org_id: fullEvent.orgId,
          entity_type: fullEvent.entityType,
          entity_id: fullEvent.entityId,
          related_entity_type: fullEvent.relatedEntityType || null,
          related_entity_id: fullEvent.relatedEntityId || null,
          event_type: EVENT_TO_ACTIVITY[event] || event,
          actor_id: fullEvent.actorId || null,
          metadata: fullEvent.metadata,
        });
      } catch (err: any) {
        console.error('[eventBus] activity_log insert failed:', err.message);
      }
    }

    // Emit to in-process listeners (automation engine)
    return super.emit(event, fullEvent);
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
