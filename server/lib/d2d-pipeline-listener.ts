/**
 * D2D Pipeline Event Listener
 * =============================
 * Listens to CRM events and auto-syncs pipeline stages.
 * Registered once at server startup.
 */

import { eventBus, type CRMEvent } from './eventBus';
import { getServiceClient } from './supabase';
import { syncPipelineStage } from './d2d-pipeline-sync';

/**
 * Initialize the D2D pipeline sync listeners.
 * Call once at server startup (after eventBus.init).
 */
export function initD2DPipelineListeners() {
  const admin = getServiceClient();

  // Quote created → NEW_LEAD
  eventBus.onEvent('quote.created', async (event: CRMEvent) => {
    try {
      await syncPipelineStage(admin, {
        orgId: event.orgId,
        trigger: 'quote_created',
        leadId: event.metadata?.lead_id || null,
        clientId: event.metadata?.client_id || null,
        quoteId: event.entityId,
        repId: event.actorId || null,
        title: event.metadata?.title || 'D2D Quote',
        value: event.metadata?.total_cents ? Number(event.metadata.total_cents) / 100 : 0,
      });
    } catch (err: any) {
      console.error('[d2d-pipeline] quote.created sync failed:', err.message);
    }
  });

  // Quote sent → QUOTE_SENT
  eventBus.onEvent('quote.sent', async (event: CRMEvent) => {
    try {
      await syncPipelineStage(admin, {
        orgId: event.orgId,
        trigger: 'quote_sent',
        quoteId: event.entityId,
        leadId: event.metadata?.lead_id || null,
      });
    } catch (err: any) {
      console.error('[d2d-pipeline] quote.sent sync failed:', err.message);
    }
  });

  // Quote declined → CLOSED_LOST
  eventBus.onEvent('quote.declined', async (event: CRMEvent) => {
    try {
      await syncPipelineStage(admin, {
        orgId: event.orgId,
        trigger: 'quote_declined',
        quoteId: event.entityId,
        leadId: event.metadata?.lead_id || null,
        lostReason: event.metadata?.reason || 'Quote declined',
      });
    } catch (err: any) {
      console.error('[d2d-pipeline] quote.declined sync failed:', err.message);
    }
  });

  // Job created → CLOSED_WON
  eventBus.onEvent('job.created', async (event: CRMEvent) => {
    try {
      // Only sync if the job came from a quote/lead (D2D flow)
      if (!event.metadata?.from_lead && !event.relatedEntityType) return;

      await syncPipelineStage(admin, {
        orgId: event.orgId,
        trigger: 'job_created',
        jobId: event.entityId,
        leadId: event.relatedEntityId || event.metadata?.lead_id || null,
        clientId: event.metadata?.client_id || null,
        quoteId: event.metadata?.quote_id || null,
        repId: event.actorId || null,
        title: event.metadata?.title || 'D2D Job',
        value: event.metadata?.value || 0,
      });
    } catch (err: any) {
      console.error('[d2d-pipeline] job.created sync failed:', err.message);
    }
  });

  // Lead status changed to lost → CLOSED_LOST
  eventBus.onEvent('lead.status_changed', async (event: CRMEvent) => {
    try {
      if (event.metadata?.new_status === 'lost' || event.metadata?.new_status === 'closed_lost') {
        await syncPipelineStage(admin, {
          orgId: event.orgId,
          trigger: 'lead_lost',
          leadId: event.entityId,
          lostReason: event.metadata?.reason || 'Lead marked as lost',
        });
      }
    } catch (err: any) {
      console.error('[d2d-pipeline] lead.status_changed sync failed:', err.message);
    }
  });

  console.log('[d2d-pipeline] Event listeners initialized');
}
