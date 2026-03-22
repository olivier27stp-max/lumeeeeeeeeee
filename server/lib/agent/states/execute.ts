/* State: execute — Run the approved CRM action */

import type { AgentContext, AgentState } from '../types';
import { executeCrmTool } from '../tools/crm-tools';

export async function execute(ctx: AgentContext): Promise<{ next: AgentState; ctx: AgentContext }> {
  const fr = ctx.language === 'fr';

  if (!ctx.approval || ctx.approval.status !== 'approved') {
    ctx.executionResult = {
      success: false,
      summary: fr ? 'Action non approuvée.' : 'Action not approved.',
    };
    return { next: 'log', ctx };
  }

  try {
    // Get the approval details and verify it hasn't expired
    const { data: approvalRow, error: fetchErr } = await ctx.supabase
      .from('approvals')
      .select('action_type, action_params, status, expires_at')
      .eq('id', ctx.approval.id)
      .single();

    if (fetchErr || !approvalRow) {
      ctx.executionResult = {
        success: false,
        summary: fr ? 'Détails de l\'approbation introuvables.' : 'Approval details not found.',
      };
      return { next: 'log', ctx };
    }

    // Check expiration
    if (approvalRow.expires_at && new Date(approvalRow.expires_at) < new Date()) {
      await ctx.supabase.from('approvals')
        .update({ status: 'expired' })
        .eq('id', ctx.approval.id);

      ctx.executionResult = {
        success: false,
        summary: fr ? 'L\'approbation a expiré.' : 'Approval has expired.',
      };
      return { next: 'log', ctx };
    }

    // Double-check status is still pending (only pending approvals can be executed)
    if (approvalRow.status !== 'pending') {
      ctx.executionResult = {
        success: false,
        summary: fr ? `L'approbation est déjà ${approvalRow.status}.` : `Approval is already ${approvalRow.status}.`,
      };
      return { next: 'log', ctx };
    }

    // Execute the CRM action
    const result = await executeCrmTool(
      ctx.supabase,
      ctx.orgId,
      approvalRow.action_type,
      approvalRow.action_params || {}
    );

    ctx.executionResult = result;

    // Update approval status to approved with responder info
    await ctx.supabase.from('approvals')
      .update({
        status: 'approved',
        responded_at: new Date().toISOString(),
        responded_by: ctx.userId,
      })
      .eq('id', ctx.approval.id);

    // Update decision log with approval info
    const { data: approvalWithLog } = await ctx.supabase.from('approvals')
      .select('decision_log_id')
      .eq('id', ctx.approval.id)
      .single();

    if (approvalWithLog?.decision_log_id) {
      await ctx.supabase.from('decision_logs')
        .update({
          approved_by: ctx.userId,
          approved_at: new Date().toISOString(),
        })
        .eq('id', approvalWithLog.decision_log_id);
    }

    ctx.response = result.summary;
    ctx.responseType = 'text';

  } catch (err: any) {
    ctx.executionResult = {
      success: false,
      summary: fr ? `Erreur d'exécution: ${err?.message}` : `Execution error: ${err?.message}`,
    };
    ctx.errors.push(`Execute failed: ${err?.message}`);
    console.error('[agent/execute] Error:', err?.message);
  }

  return { next: 'log', ctx };
}
