import { supabase } from './supabase';
import type { WorkflowPreset } from './workflowPresets';

// ─── Types ──────────────────────────────────────────────────────
export type TriggerType =
  | 'lead_created' | 'lead_updated' | 'lead_status_changed' | 'lead_converted'
  | 'pipeline_deal_stage_changed'
  | 'estimate_sent' | 'estimate_approved'
  | 'quote_created' | 'quote_sent' | 'quote_approved' | 'quote_declined' | 'quote_converted'
  | 'invoice_created' | 'invoice_overdue'
  | 'payment_received'
  | 'job_scheduled' | 'job_started' | 'job_completed'
  | 'technician_arrived' | 'technician_left'
  | 'review_not_submitted' | 'form_submitted';

export type ActionType =
  | 'send_sms' | 'send_email' | 'create_task' | 'assign_user'
  | 'update_status' | 'add_tag' | 'create_note' | 'schedule_reminder'
  | 'request_review' | 'send_notification' | 'call_webhook' | 'trigger_n8n';

export type NodeType = 'trigger' | 'condition' | 'action' | 'delay';
export type WorkflowStatus = 'draft' | 'published' | 'paused';
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface Workflow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  active: boolean;
  trigger_type: TriggerType;
  trigger_config: Record<string, any>;
  status: WorkflowStatus;
  preset_id: string | null;
  category: string | null;
  icon: string | null;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  _run_count?: number;
  _last_run?: WorkflowRun | null;
}

export interface WorkflowNode {
  id: string;
  workflow_id: string;
  node_type: NodeType;
  action_type: ActionType | null;
  label: string | null;
  config: Record<string, any>;
  position_x: number;
  position_y: number;
}

export interface WorkflowEdge {
  id: string;
  workflow_id: string;
  source_id: string;
  target_id: string;
  source_handle: string | null;
  target_handle: string | null;
  label: string | null;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  org_id: string;
  status: RunStatus;
  trigger_data: Record<string, any> | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error_msg: string | null;
  nodes_executed: number;
}

export interface WorkflowLog {
  id: string;
  run_id: string;
  node_id: string | null;
  level: LogLevel;
  message: string;
  data: Record<string, any> | null;
  created_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────
async function getOrgId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!data) throw new Error('No organization found');
  return data.org_id;
}

// ─── Trigger definitions ────────────────────────────────────────
export const TRIGGER_DEFS: Record<TriggerType, { label: string; labelFr: string; icon: string; category: string }> = {
  lead_created:         { label: 'Lead Created',          labelFr: 'Prospect créé',           icon: 'UserPlus',    category: 'CRM' },
  lead_updated:         { label: 'Lead Updated',          labelFr: 'Prospect modifié',        icon: 'UserCog',     category: 'CRM' },
  lead_status_changed:  { label: 'Lead Status Changed',   labelFr: 'Statut prospect changé',  icon: 'RefreshCw',   category: 'CRM' },
  lead_converted:       { label: 'Lead Converted',        labelFr: 'Prospect converti',       icon: 'UserCheck',   category: 'CRM' },
  pipeline_deal_stage_changed: { label: 'Deal Stage Changed', labelFr: 'Étape deal changée', icon: 'GitBranch',   category: 'Pipeline' },
  estimate_sent:        { label: 'Estimate Sent',         labelFr: 'Devis envoyé',            icon: 'Send',        category: 'Sales' },
  estimate_approved:    { label: 'Estimate Approved',     labelFr: 'Devis approuvé',          icon: 'CheckCircle', category: 'Sales' },
  quote_created:        { label: 'Quote Created',         labelFr: 'Soumission créée',        icon: 'FilePlus',    category: 'Sales' },
  quote_sent:           { label: 'Quote Sent',            labelFr: 'Soumission envoyée',      icon: 'Send',        category: 'Sales' },
  quote_approved:       { label: 'Quote Approved',        labelFr: 'Soumission approuvée',    icon: 'CheckCircle2', category: 'Sales' },
  quote_declined:       { label: 'Quote Declined',        labelFr: 'Soumission refusée',      icon: 'XCircle',     category: 'Sales' },
  quote_converted:      { label: 'Quote Converted to Job', labelFr: 'Soumission convertie',   icon: 'ArrowRight',  category: 'Sales' },
  invoice_created:      { label: 'Invoice Created',       labelFr: 'Facture créée',           icon: 'FileText',    category: 'Finance' },
  invoice_overdue:      { label: 'Invoice Overdue',       labelFr: 'Facture en retard',       icon: 'AlertCircle', category: 'Finance' },
  payment_received:     { label: 'Payment Received',      labelFr: 'Paiement reçu',           icon: 'CreditCard',  category: 'Finance' },
  job_scheduled:        { label: 'Job Scheduled',         labelFr: 'Job planifié',            icon: 'Calendar',    category: 'Operations' },
  job_started:          { label: 'Job Started',           labelFr: 'Job commencé',            icon: 'Play',        category: 'Operations' },
  job_completed:        { label: 'Job Completed',         labelFr: 'Job terminé',             icon: 'CheckSquare', category: 'Operations' },
  technician_arrived:   { label: 'Technician Arrived',    labelFr: 'Technicien arrivé',       icon: 'MapPin',      category: 'Field' },
  technician_left:      { label: 'Technician Left Site',  labelFr: 'Technicien parti',        icon: 'LogOut',      category: 'Field' },
  review_not_submitted: { label: 'Review Not Submitted',  labelFr: 'Avis non soumis',         icon: 'Star',        category: 'Follow-up' },
  form_submitted:       { label: 'Form Submitted',        labelFr: 'Formulaire soumis',       icon: 'ClipboardCheck', category: 'Follow-up' },
};

export const ACTION_DEFS: Record<ActionType, { label: string; labelFr: string; icon: string; fields: { key: string; label: string; type: string }[] }> = {
  send_sms:           { label: 'Send SMS',           labelFr: 'Envoyer SMS',         icon: 'MessageSquare', fields: [{ key: 'to', label: 'To', type: 'text' }, { key: 'body', label: 'Message', type: 'textarea' }] },
  send_email:         { label: 'Send Email',         labelFr: 'Envoyer courriel',    icon: 'Mail',          fields: [{ key: 'to', label: 'To', type: 'text' }, { key: 'subject', label: 'Subject', type: 'text' }, { key: 'body', label: 'Body', type: 'textarea' }] },
  create_task:        { label: 'Create Task',        labelFr: 'Créer tâche',         icon: 'CheckSquare',   fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'assignee', label: 'Assignee', type: 'text' }] },
  assign_user:        { label: 'Assign User',        labelFr: 'Assigner utilisateur', icon: 'UserPlus',     fields: [{ key: 'user_id', label: 'User', type: 'text' }] },
  update_status:      { label: 'Update Status',      labelFr: 'Mettre à jour statut', icon: 'RefreshCw',   fields: [{ key: 'status', label: 'New Status', type: 'text' }] },
  add_tag:            { label: 'Add Tag',            labelFr: 'Ajouter tag',         icon: 'Tag',           fields: [{ key: 'tag', label: 'Tag', type: 'text' }] },
  create_note:        { label: 'Create Note',        labelFr: 'Créer note',          icon: 'StickyNote',    fields: [{ key: 'content', label: 'Note', type: 'textarea' }] },
  schedule_reminder:  { label: 'Schedule Reminder',  labelFr: 'Planifier rappel',    icon: 'Bell',          fields: [{ key: 'delay', label: 'Delay (min)', type: 'number' }, { key: 'message', label: 'Message', type: 'text' }] },
  request_review:     { label: 'Request Review',     labelFr: 'Demander avis',       icon: 'Star',          fields: [{ key: 'template', label: 'Template', type: 'text' }] },
  send_notification:  { label: 'Send Notification',  labelFr: 'Envoyer notification', icon: 'Bell',         fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'body', label: 'Body', type: 'text' }] },
  call_webhook:       { label: 'Call Webhook',       labelFr: 'Appeler webhook',     icon: 'Globe',         fields: [{ key: 'url', label: 'URL', type: 'text' }, { key: 'method', label: 'Method', type: 'text' }, { key: 'headers', label: 'Headers (JSON)', type: 'textarea' }, { key: 'payload', label: 'Payload (JSON)', type: 'textarea' }] },
  trigger_n8n:        { label: 'Trigger n8n',        labelFr: 'Déclencher n8n',      icon: 'Zap',           fields: [{ key: 'webhook_url', label: 'n8n Webhook URL', type: 'text' }, { key: 'payload', label: 'Payload (JSON)', type: 'textarea' }, { key: 'headers', label: 'Headers (JSON)', type: 'textarea' }] },
};

// ─── CRUD ───────────────────────────────────────────────────────

export async function getWorkflows(): Promise<Workflow[]> {
  const orgId = await getOrgId();
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getWorkflow(id: string): Promise<Workflow> {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function createWorkflow(
  name: string,
  triggerType: TriggerType,
  opts?: { preset_id?: string; category?: string; icon?: string; description?: string; status?: WorkflowStatus }
): Promise<Workflow> {
  const orgId = await getOrgId();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('workflows')
    .insert({
      org_id: orgId,
      name,
      description: opts?.description || null,
      trigger_type: triggerType,
      trigger_config: {},
      status: opts?.status || 'draft',
      preset_id: opts?.preset_id || null,
      category: opts?.category || null,
      icon: opts?.icon || null,
      created_by: user?.id,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateWorkflow(
  id: string,
  updates: Partial<Pick<Workflow, 'name' | 'description' | 'active' | 'trigger_type' | 'trigger_config' | 'status'>>
): Promise<void> {
  const { error } = await supabase
    .from('workflows')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteWorkflow(id: string): Promise<void> {
  const { error } = await supabase.from('workflows').delete().eq('id', id);
  if (error) throw error;
}

// ─── Clone Preset ──────────────────────────────────────────────

export async function clonePreset(preset: WorkflowPreset): Promise<Workflow> {
  const wf = await createWorkflow(preset.name, preset.trigger_type, {
    preset_id: preset.id,
    category: preset.category,
    icon: preset.icon,
    description: preset.description,
    status: 'draft',
  });

  // Insert all nodes
  const nodeIdMap = new Map<string, string>();

  for (const pNode of preset.nodes) {
    const { data, error } = await supabase
      .from('workflow_nodes')
      .insert({
        workflow_id: wf.id,
        node_type: pNode.node_type,
        action_type: pNode.action_type || null,
        label: pNode.label,
        config: pNode.config,
        position_x: pNode.position_x,
        position_y: pNode.position_y,
      })
      .select('id')
      .single();
    if (error) throw error;
    nodeIdMap.set(pNode.id, data.id);
  }

  // Insert all edges with mapped IDs
  for (const pEdge of preset.edges) {
    const sourceId = nodeIdMap.get(pEdge.source);
    const targetId = nodeIdMap.get(pEdge.target);
    if (!sourceId || !targetId) continue;

    await supabase.from('workflow_edges').insert({
      workflow_id: wf.id,
      source_id: sourceId,
      target_id: targetId,
      label: pEdge.label || null,
    });
  }

  return wf;
}

// ─── Nodes ──────────────────────────────────────────────────────

export async function getWorkflowNodes(workflowId: string): Promise<WorkflowNode[]> {
  const { data, error } = await supabase
    .from('workflow_nodes')
    .select('*')
    .eq('workflow_id', workflowId);
  if (error) throw error;
  return data || [];
}

export async function createNode(workflowId: string, node: Omit<WorkflowNode, 'id' | 'workflow_id'>): Promise<WorkflowNode> {
  const { data, error } = await supabase
    .from('workflow_nodes')
    .insert({ ...node, workflow_id: workflowId })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateNode(id: string, updates: Partial<Pick<WorkflowNode, 'label' | 'config' | 'action_type' | 'position_x' | 'position_y'>>): Promise<void> {
  const { error } = await supabase.from('workflow_nodes').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteNode(id: string): Promise<void> {
  const { error } = await supabase.from('workflow_nodes').delete().eq('id', id);
  if (error) throw error;
}

// ─── Edges ──────────────────────────────────────────────────────

export async function getWorkflowEdges(workflowId: string): Promise<WorkflowEdge[]> {
  const { data, error } = await supabase
    .from('workflow_edges')
    .select('*')
    .eq('workflow_id', workflowId);
  if (error) throw error;
  return data || [];
}

export async function createEdge(workflowId: string, edge: { source_id: string; target_id: string; source_handle?: string; target_handle?: string; label?: string }): Promise<WorkflowEdge> {
  const { data, error } = await supabase
    .from('workflow_edges')
    .insert({ ...edge, workflow_id: workflowId })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEdge(id: string): Promise<void> {
  const { error } = await supabase.from('workflow_edges').delete().eq('id', id);
  if (error) throw error;
}

// ─── Runs ───────────────────────────────────────────────────────

export async function getWorkflowRuns(workflowId: string, limit = 50): Promise<WorkflowRun[]> {
  const { data, error } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getRunLogs(runId: string): Promise<WorkflowLog[]> {
  const { data, error } = await supabase
    .from('workflow_logs')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ─── Execution Engine ───────────────────────────────────────────

export async function executeWorkflow(workflowId: string, triggerData: Record<string, any> = {}): Promise<WorkflowRun> {
  const orgId = await getOrgId();
  const startTime = Date.now();

  const { data: run, error: runError } = await supabase
    .from('workflow_runs')
    .insert({
      workflow_id: workflowId,
      org_id: orgId,
      status: 'running',
      trigger_data: triggerData,
    })
    .select('*')
    .single();
  if (runError) throw runError;

  try {
    const [nodes, edges] = await Promise.all([
      getWorkflowNodes(workflowId),
      getWorkflowEdges(workflowId),
    ]);

    const triggerNode = nodes.find((n) => n.node_type === 'trigger');
    if (!triggerNode) throw new Error('No trigger node found');

    const adj = new Map<string, string[]>();
    for (const edge of edges) {
      const existing = adj.get(edge.source_id) || [];
      existing.push(edge.target_id);
      adj.set(edge.source_id, existing);
    }

    const queue: string[] = [triggerNode.id];
    const visited = new Set<string>();
    let nodesExecuted = 0;

    await logEntry(run.id, triggerNode.id, 'info', 'Workflow started', triggerData);

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = nodes.find((n) => n.id === nodeId);
      if (!node) continue;

      nodesExecuted++;

      if (node.node_type === 'condition') {
        const passed = evaluateCondition(node.config, triggerData);
        await logEntry(run.id, nodeId, 'info', `Condition "${node.label}" → ${passed ? 'true' : 'false'}`, { passed });
        if (passed) {
          const nextNodes = adj.get(nodeId) || [];
          nextNodes.forEach((n) => queue.push(n));
        }
      } else if (node.node_type === 'delay') {
        await logEntry(run.id, nodeId, 'info', `Delay "${node.label}" — ${node.config.delay_value} ${node.config.delay_unit}`, node.config);
        const nextNodes = adj.get(nodeId) || [];
        nextNodes.forEach((n) => queue.push(n));
      } else if (node.node_type === 'action') {
        try {
          await executeAction(node, triggerData);
          await logEntry(run.id, nodeId, 'info', `Action "${node.label}" executed`, { action_type: node.action_type });
        } catch (e: any) {
          await logEntry(run.id, nodeId, 'error', `Action failed: ${e.message}`, { action_type: node.action_type });
        }
        const nextNodes = adj.get(nodeId) || [];
        nextNodes.forEach((n) => queue.push(n));
      } else {
        const nextNodes = adj.get(nodeId) || [];
        nextNodes.forEach((n) => queue.push(n));
      }
    }

    const durationMs = Date.now() - startTime;
    await supabase
      .from('workflow_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString(), duration_ms: durationMs, nodes_executed: nodesExecuted })
      .eq('id', run.id);

    await logEntry(run.id, null, 'info', `Workflow completed in ${durationMs}ms`, { nodes_executed: nodesExecuted });
    return { ...run, status: 'completed', duration_ms: durationMs, nodes_executed: nodesExecuted };
  } catch (e: any) {
    const durationMs = Date.now() - startTime;
    await supabase
      .from('workflow_runs')
      .update({ status: 'failed', completed_at: new Date().toISOString(), duration_ms: durationMs, error_msg: e.message })
      .eq('id', run.id);
    await logEntry(run.id, null, 'error', `Workflow failed: ${e.message}`);
    return { ...run, status: 'failed', duration_ms: durationMs, error_msg: e.message };
  }
}

// ─── Condition evaluator ────────────────────────────────────────

function evaluateCondition(config: Record<string, any>, data: Record<string, any>): boolean {
  const { conditions, operator = 'AND' } = config;
  if (!conditions || !Array.isArray(conditions)) return true;

  const results = conditions.map((c: any) => {
    const value = data[c.field];
    switch (c.operator) {
      case 'equals': return value === c.value;
      case 'not_equals': return value !== c.value;
      case 'contains': return String(value || '').includes(String(c.value));
      case 'greater_than': return Number(value) > Number(c.value);
      case 'less_than': return Number(value) < Number(c.value);
      case 'is_empty': return !value;
      case 'is_not_empty': return !!value;
      default: return true;
    }
  });

  return operator === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

// ─── Action executor ────────────────────────────────────────────

async function executeAction(node: WorkflowNode, data: Record<string, any>): Promise<void> {
  const config = node.config || {};

  switch (node.action_type) {
    case 'call_webhook':
    case 'trigger_n8n': {
      const url = config.webhook_url || config.url;
      if (!url) throw new Error('Webhook URL is required');
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.headers) {
        try { headers = { ...headers, ...JSON.parse(config.headers) }; } catch {}
      }
      let payload = data;
      if (config.payload) {
        try { payload = { ...data, ...JSON.parse(config.payload) }; } catch {}
      }
      const resp = await fetch(url, {
        method: config.method || 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`Webhook returned ${resp.status}`);
      break;
    }

    case 'send_notification':
    case 'send_email':
    case 'send_sms':
    case 'create_task':
    case 'assign_user':
    case 'update_status':
    case 'add_tag':
    case 'create_note':
    case 'schedule_reminder':
    case 'request_review': {
      // Route to server-side automation engine for real execution
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Not authenticated — cannot execute workflow action');
      const resp = await fetch('/api/workflows/execute-action', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_type: node.action_type,
          config,
          context: data,
        }),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody?.error || `Action ${node.action_type} failed (${resp.status})`);
      }
      break;
    }

    default:
      throw new Error(`Unknown action type: ${node.action_type}`);
  }
}

// ─── Log helper ─────────────────────────────────────────────────

async function logEntry(runId: string, nodeId: string | null, level: LogLevel, message: string, data?: Record<string, any>): Promise<void> {
  await supabase.from('workflow_logs').insert({
    run_id: runId,
    node_id: nodeId,
    level,
    message,
    data: data || null,
  });
}
