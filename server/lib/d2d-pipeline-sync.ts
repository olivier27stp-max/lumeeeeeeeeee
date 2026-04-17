/**
 * D2D Pipeline Sync Engine
 * =========================
 * Automatically updates pipeline_deals stage based on real CRM events.
 * Single function: syncPipelineStage(entity) — listens to changes in
 * quotes, jobs, pins and updates the pipeline accordingly.
 *
 * Stage transitions:
 *   Quote created from D2D → NEW_LEAD (Qualified)
 *   Pin marked revisit/callback → MUST_RECALL (Contact)
 *   Quote sent → QUOTE_SENT (Quote Sent)
 *   Job created from quote → CLOSED_WON (Closed)
 *   Quote declined / lead lost → CLOSED_LOST (Lost)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { D2D_TO_DB_STAGE, type D2DStage } from './d2d-pipeline-stages';

interface SyncInput {
  orgId: string;
  /** The entity that triggered the sync */
  trigger: 'quote_created' | 'quote_sent' | 'quote_declined' | 'job_created' | 'pin_revisit' | 'lead_lost' | 'manual';
  /** IDs for linking */
  leadId?: string | null;
  clientId?: string | null;
  quoteId?: string | null;
  jobId?: string | null;
  pinId?: string | null;
  repId?: string | null;
  /** For manual stage overrides */
  targetStage?: DnDStage;
  /** For lost deals */
  lostReason?: string;
  /** Deal value (from quote total) */
  value?: number;
  /** Deal title */
  title?: string;
}

type DnDStage = D2DStage;

/**
 * Determine the correct pipeline stage based on the trigger event.
 */
function resolveStage(trigger: SyncInput['trigger'], targetStage?: DnDStage): D2DStage {
  switch (trigger) {
    case 'quote_created': return 'new_lead';
    case 'pin_revisit': return 'must_recall';
    case 'quote_sent': return 'quote_sent';
    case 'job_created': return 'closed_won';
    case 'quote_declined':
    case 'lead_lost': return 'closed_lost';
    case 'manual': return targetStage || 'new_lead';
    default: return 'new_lead';
  }
}

/**
 * Sync a pipeline deal's stage based on a CRM event.
 * Creates the deal if it doesn't exist, updates if it does.
 */
export async function syncPipelineStage(admin: SupabaseClient, input: SyncInput): Promise<string | null> {
  const stage = resolveStage(input.trigger, input.targetStage);
  const dbStage = D2D_TO_DB_STAGE[stage];

  // Find existing deal by lead_id or quote_id
  let existingDealId: string | null = null;

  if (input.leadId) {
    const { data } = await admin
      .from('pipeline_deals')
      .select('id')
      .eq('org_id', input.orgId)
      .eq('lead_id', input.leadId)
      .is('deleted_at', null)
      .maybeSingle();
    existingDealId = data?.id || null;
  }

  if (!existingDealId && input.quoteId) {
    const { data } = await admin
      .from('pipeline_deals')
      .select('id')
      .eq('org_id', input.orgId)
      .eq('quote_id', input.quoteId)
      .is('deleted_at', null)
      .maybeSingle();
    existingDealId = data?.id || null;
  }

  const now = new Date().toISOString();

  if (existingDealId) {
    // Update existing deal
    const updates: Record<string, any> = {
      stage: dbStage,
      updated_at: now,
    };
    if (input.jobId) updates.job_id = input.jobId;
    if (input.quoteId) updates.quote_id = input.quoteId;
    if (input.repId) updates.rep_id = input.repId;
    if (input.pinId) updates.pin_id = input.pinId;
    if (input.value != null) updates.value = input.value;
    if (stage === 'closed_lost') {
      updates.lost_at = now;
      if (input.lostReason) updates.lost_reason = input.lostReason;
    }

    await admin
      .from('pipeline_deals')
      .update(updates)
      .eq('id', existingDealId);

    return existingDealId;
  } else {
    // Create new deal
    const insert: Record<string, any> = {
      org_id: input.orgId,
      stage: dbStage,
      title: input.title || 'D2D Deal',
      value: input.value || 0,
      source: 'd2d',
      created_at: now,
      updated_at: now,
    };
    if (input.leadId) insert.lead_id = input.leadId;
    if (input.clientId) insert.client_id = input.clientId;
    if (input.quoteId) insert.quote_id = input.quoteId;
    if (input.jobId) insert.job_id = input.jobId;
    if (input.repId) insert.rep_id = input.repId;
    if (input.pinId) insert.pin_id = input.pinId;
    if (stage === 'closed_lost') {
      insert.lost_at = now;
      if (input.lostReason) insert.lost_reason = input.lostReason;
    }

    // Need at least lead_id or client_id for the CHECK constraint
    if (!insert.lead_id && !insert.client_id) {
      // Create without — this will need the constraint to be relaxed or a dummy lead
      console.warn('[d2d-pipeline-sync] No lead_id or client_id — deal may fail constraint');
    }

    const { data, error } = await admin
      .from('pipeline_deals')
      .insert(insert)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[d2d-pipeline-sync] Insert failed:', error.message);
      return null;
    }

    return data?.id || null;
  }
}
