/* ═══════════════════════════════════════════════════════════════
   Mr Lume Agent — API Routes (SSE Streaming)
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { runAgent } from '../lib/agent/index';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

// Feature flag check helper
async function isAgentEnabled(orgId: string): Promise<boolean> {
  try {
    const admin = getServiceClient();
    const { data } = await admin.from('org_features')
      .select('enabled')
      .eq('org_id', orgId)
      .eq('feature', 'agent')
      .maybeSingle();
    // If no row exists, agent is enabled by default
    return data?.enabled !== false;
  } catch { return true; }
}

// Max message length (4000 chars — prevents abuse and keeps LLM context reasonable)
const MAX_MESSAGE_LENGTH = 4000;

// POST /api/agent/chat — Main agent endpoint (SSE stream)
router.post('/agent/chat', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { message, sessionId, language } = req.body;

  // Input validation
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message (string) is required' });
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return res.status(400).json({ error: 'message cannot be empty' });
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
  }
  if (sessionId && typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId must be a string' });
  }

  const lang = language === 'fr' ? 'fr' : 'en';

  // Feature flag check
  const enabled = await isAgentEnabled(auth.orgId);
  if (!enabled) {
    return res.status(403).json({ error: lang === 'fr' ? 'Mr Lume est désactivé pour cette organisation.' : 'Mr Lume is disabled for this organization.' });
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Keep-alive with error handling — if write fails, client disconnected
  let clientDisconnected = false;
  const keepAlive = setInterval(() => {
    try {
      if (!clientDisconnected) {
        res.write(': keepalive\n\n');
      }
    } catch {
      clientDisconnected = true;
      clearInterval(keepAlive);
    }
  }, 15000);

  req.on('close', () => {
    clientDisconnected = true;
    clearInterval(keepAlive);
  });

  // Helper to safely write SSE events
  function sendEvent(data: unknown): void {
    if (clientDisconnected) return;
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      clientDisconnected = true;
    }
  }

  try {
    const agentIterator = runAgent(
      {
        message: trimmed,
        sessionId: sessionId || undefined,
        language: lang as 'en' | 'fr',
        orgId: auth.orgId,
        userId: auth.user.id,
      },
      // Token callback for streaming text — safely writes via SSE
      (token) => sendEvent({ type: 'token', content: token })
    );

    for await (const event of agentIterator) {
      sendEvent(event);
      if (clientDisconnected) break;
    }
  } catch (err: any) {
    console.error('[agent/chat] Error:', err?.message);
    sendEvent({ type: 'error', error: 'An error occurred while processing your request.' });
  } finally {
    clearInterval(keepAlive);
    if (!clientDisconnected) {
      try { res.end(); } catch { /* already closed */ }
    }
  }
});

// POST /api/agent/approve — Approve or reject an action
router.post('/agent/approve', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { approvalId, decision } = req.body;
    if (!approvalId || typeof approvalId !== 'string') {
      return res.status(400).json({ error: 'approvalId (string) required' });
    }
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be "approve" or "reject"' });
    }

    const admin = getServiceClient();

    // Verify the approval belongs to this org and is still pending
    const { data: approval, error: fetchError } = await admin.from('approvals')
      .select('id, org_id, session_id, status, action_type, action_params, expires_at')
      .eq('id', approvalId)
      .eq('org_id', auth.orgId)
      .single();

    if (fetchError || !approval) {
      return res.status(404).json({ error: 'Approval not found' });
    }

    if (approval.status !== 'pending') {
      return res.status(409).json({ error: `Approval already ${approval.status}` });
    }

    // Check expiration
    if (approval.expires_at && new Date(approval.expires_at) < new Date()) {
      await admin.from('approvals').update({ status: 'expired' }).eq('id', approvalId);
      return res.status(410).json({ error: 'Approval has expired' });
    }

    if (decision === 'reject') {
      await admin.from('approvals').update({
        status: 'rejected',
        responded_at: new Date().toISOString(),
        responded_by: auth.user.id,
      }).eq('id', approvalId);

      // Record rejection as training outcome
      try {
        const { recordApprovalOutcome } = await import('../lib/agent/training-engine');
        await recordApprovalOutcome(admin, auth.orgId, auth.user.id, approvalId, false);
      } catch { /* training is optional */ }

      return res.json({ ok: true, status: 'rejected' });
    }

    // Approve — mark as approved FIRST to prevent double-execution race
    const { error: updateErr } = await admin.from('approvals').update({
      status: 'approved',
      responded_at: new Date().toISOString(),
      responded_by: auth.user.id,
    }).eq('id', approvalId).eq('status', 'pending'); // Only update if still pending

    if (updateErr) {
      return res.status(409).json({ error: 'Approval already processed' });
    }

    // Execute the action
    const { executeCrmTool } = await import('../lib/agent/tools/crm-tools');
    const result = await executeCrmTool(
      admin,
      auth.orgId,
      approval.action_type,
      approval.action_params || {}
    );

    // Save execution result as agent message
    await admin.from('agent_messages').insert({
      org_id: auth.orgId,
      session_id: approval.session_id,
      role: 'assistant',
      content: result.summary,
      message_type: 'tool_result',
      structured_data: result,
    });

    // Record approval as training outcome
    try {
      const { recordApprovalOutcome } = await import('../lib/agent/training-engine');
      await recordApprovalOutcome(admin, auth.orgId, auth.user.id, approvalId, true);
    } catch { /* training is optional */ }

    return res.json({ ok: true, status: 'approved', result });
  } catch (err: any) {
    return sendSafeError(res, err, 'Approval failed.', '[agent/approve]');
  }
});

// GET /api/agent/sessions — List user's agent sessions
router.get('/agent/sessions', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);

    const { data, error } = await auth.client.from('agent_sessions')
      .select('id, title, status, message_count, last_message_at, created_at')
      .eq('org_id', auth.orgId)
      .neq('status', 'cancelled')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) return sendSafeError(res, error, 'Failed to list sessions.', '[agent/sessions]');
    return res.json({ sessions: data || [] });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to list sessions.', '[agent/sessions]');
  }
});

// GET /api/agent/sessions/:id — Get session with messages
router.get('/agent/sessions/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { data: messages, error } = await auth.client.from('agent_messages')
      .select('id, role, content, message_type, structured_data, model, created_at')
      .eq('session_id', req.params.id)
      .eq('org_id', auth.orgId)
      .order('created_at', { ascending: true });

    if (error) return sendSafeError(res, error, 'Failed to load messages.', '[agent/sessions/:id]');
    return res.json({ messages: messages || [] });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to load messages.', '[agent/sessions/:id]');
  }
});

// DELETE /api/agent/sessions/:id — Soft delete session
router.delete('/agent/sessions/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { error } = await auth.client.from('agent_sessions')
      .update({ status: 'cancelled' })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId);

    if (error) return sendSafeError(res, error, 'Failed to delete session.', '[agent/sessions/delete]');
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to delete session.', '[agent/sessions/delete]');
  }
});

// POST /api/agent/feedback — Store user feedback on a response
router.post('/agent/feedback', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { messageId, sessionId, feedback } = req.body;
    if (!feedback || !['up', 'down'].includes(feedback)) {
      return res.status(400).json({ error: 'feedback must be "up" or "down"' });
    }

    const admin = getServiceClient();
    await admin.from('memory_events').insert({
      org_id: auth.orgId,
      event_type: 'feedback',
      entity_type: 'agent_message',
      entity_id: messageId || null,
      summary: `User rated response as ${feedback === 'up' ? 'helpful' : 'not helpful'}${sessionId ? ` (session: ${sessionId})` : ''}`,
      importance: feedback === 'down' ? 8 : 4,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to save feedback.', '[agent/feedback]');
  }
});

export default router;
