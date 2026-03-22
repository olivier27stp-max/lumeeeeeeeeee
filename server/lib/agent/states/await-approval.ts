/* State: await_approval — Create approval record and wait for user response */

import type { AgentContext, AgentState } from '../types';

export async function awaitApproval(ctx: AgentContext): Promise<{ next: AgentState; ctx: AgentContext }> {
  const fr = ctx.language === 'fr';

  try {
    // Create decision log
    const { data: decisionLog } = await ctx.supabase.from('decision_logs').insert({
      org_id: ctx.orgId,
      session_id: ctx.sessionId,
      decision_type: ctx.recommendation?.actionType || ctx.intent?.domain || 'general',
      input_summary: ctx.userMessage,
      chosen_option: ctx.scenarios?.find(s => s.isWinner)?.label || null,
      confidence: ctx.recommendation?.confidence || 0.5,
      reasoning: ctx.response,
    }).select('id').single();

    // Create approval record
    const { data: approval } = await ctx.supabase.from('approvals').insert({
      org_id: ctx.orgId,
      session_id: ctx.sessionId,
      decision_log_id: decisionLog?.id || null,
      action_type: ctx.recommendation?.actionType || 'unknown',
      action_params: ctx.recommendation?.actionParams || {},
      status: 'pending',
    }).select('id, expires_at').single();

    if (approval) {
      ctx.approval = { id: approval.id, status: 'pending' };
      ctx.responseType = 'approval_request';
      ctx.structuredData = {
        approvalId: approval.id,
        actionType: ctx.recommendation?.actionType || 'unknown',
        actionParams: ctx.recommendation?.actionParams || {},
        description: ctx.response,
        expiresAt: approval.expires_at,
      };
    }
  } catch (err: any) {
    ctx.errors.push(`Approval creation failed: ${err?.message}`);
    // Fall through to log — the recommendation text is still useful
  }

  return { next: 'log', ctx };
}
