import { supabase } from './supabase';
import type {
  DirectorFlow,
  DirectorNode,
  DirectorEdge,
  DirectorRun,
  DirectorRunStep,
  DirectorTemplate,
  DirectorFlowLink,
  OrgCreditBalance,
  OrgCreditTransaction,
} from '../types/director';

// ─── Safety helper: returns [] or null if table doesn't exist yet ────────────

function isTableMissing(error: any): boolean {
  if (!error) return false;
  const msg = (error.message || error.code || '').toLowerCase();
  return msg.includes('relation') && msg.includes('does not exist')
    || msg.includes('42p01') // PostgreSQL "undefined_table"
    || msg.includes('pgrst') && msg.includes('not found');
}

// ─── Flows ───────────────────────────────────────────────────────────────────

export async function getFlows(orgId: string) {
  const { data, error } = await supabase
    .from('director_flows')
    .select('*')
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false });
  if (error) {
    if (isTableMissing(error)) return [];
    throw error;
  }
  return data as DirectorFlow[];
}

export async function getFlow(flowId: string) {
  const { data, error } = await supabase
    .from('director_flows')
    .select('*')
    .eq('id', flowId)
    .single();
  if (error) throw error;
  return data as DirectorFlow;
}

export async function createFlow(flow: Omit<DirectorFlow, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('director_flows')
    .insert(flow)
    .select()
    .single();
  if (error) throw error;
  return data as DirectorFlow;
}

export async function updateFlow(flowId: string, updates: Partial<DirectorFlow>) {
  const { data, error } = await supabase
    .from('director_flows')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', flowId)
    .select()
    .single();
  if (error) throw error;
  return data as DirectorFlow;
}

export async function deleteFlow(flowId: string) {
  const { error } = await supabase
    .from('director_flows')
    .delete()
    .eq('id', flowId);
  if (error) throw error;
}

// ─── Nodes ───────────────────────────────────────────────────────────────────

export async function getFlowNodes(flowId: string) {
  const { data, error } = await supabase
    .from('director_nodes')
    .select('*')
    .eq('flow_id', flowId)
    .order('z_index', { ascending: true });
  if (error) {
    if (isTableMissing(error)) return [];
    throw error;
  }
  return data as DirectorNode[];
}

export async function upsertNodes(nodes: DirectorNode[]) {
  if (nodes.length === 0) return [];
  const { data, error } = await supabase
    .from('director_nodes')
    .upsert(nodes.map((n) => ({ ...n, updated_at: new Date().toISOString() })))
    .select();
  if (error) throw error;
  return data as DirectorNode[];
}

export async function deleteNodes(nodeIds: string[]) {
  if (nodeIds.length === 0) return;
  const { error } = await supabase
    .from('director_nodes')
    .delete()
    .in('id', nodeIds);
  if (error) throw error;
}

// ─── Edges ───────────────────────────────────────────────────────────────────

export async function getFlowEdges(flowId: string) {
  const { data, error } = await supabase
    .from('director_edges')
    .select('*')
    .eq('flow_id', flowId);
  if (error) {
    if (isTableMissing(error)) return [];
    throw error;
  }
  return data as DirectorEdge[];
}

export async function upsertEdges(edges: DirectorEdge[]) {
  if (edges.length === 0) return [];
  const { data, error } = await supabase
    .from('director_edges')
    .upsert(edges.map((e) => ({ ...e, updated_at: new Date().toISOString() })))
    .select();
  if (error) throw error;
  return data as DirectorEdge[];
}

export async function deleteEdges(edgeIds: string[]) {
  if (edgeIds.length === 0) return;
  const { error } = await supabase
    .from('director_edges')
    .delete()
    .in('id', edgeIds);
  if (error) throw error;
}

// ─── Save entire flow graph (batch) ─────────────────────────────────────────

export async function saveFlowGraph(
  flowId: string,
  nodes: DirectorNode[],
  edges: DirectorEdge[]
) {
  // Get existing node/edge IDs to detect deletions
  const [existingNodes, existingEdges] = await Promise.all([
    getFlowNodes(flowId),
    getFlowEdges(flowId),
  ]);

  const currentNodeIds = new Set(nodes.map((n) => n.id));
  const currentEdgeIds = new Set(edges.map((e) => e.id));

  const deletedNodeIds = existingNodes.filter((n) => !currentNodeIds.has(n.id)).map((n) => n.id);
  const deletedEdgeIds = existingEdges.filter((e) => !currentEdgeIds.has(e.id)).map((e) => e.id);

  await Promise.all([
    deleteEdges(deletedEdgeIds),
    deleteNodes(deletedNodeIds),
  ]);

  await Promise.all([
    upsertNodes(nodes),
    upsertEdges(edges),
  ]);

  // Update flow timestamp
  await updateFlow(flowId, {});
}

// ─── Runs ────────────────────────────────────────────────────────────────────

export async function getRuns(orgId: string, limit = 20) {
  const { data, error } = await supabase
    .from('director_runs')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isTableMissing(error)) return [];
    throw error;
  }
  return data as DirectorRun[];
}

export async function getFlowRuns(flowId: string, limit = 10) {
  const { data, error } = await supabase
    .from('director_runs')
    .select('*')
    .eq('flow_id', flowId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as DirectorRun[];
}

export async function createRun(run: Omit<DirectorRun, 'id' | 'created_at'>) {
  const { data, error } = await supabase
    .from('director_runs')
    .insert(run)
    .select()
    .single();
  if (error) throw error;
  return data as DirectorRun;
}

export async function updateRun(runId: string, updates: Partial<DirectorRun>) {
  const { data, error } = await supabase
    .from('director_runs')
    .update(updates)
    .eq('id', runId)
    .select()
    .single();
  if (error) throw error;
  return data as DirectorRun;
}

// ─── Run Steps ───────────────────────────────────────────────────────────────

export async function createRunSteps(steps: Omit<DirectorRunStep, 'id'>[]) {
  if (steps.length === 0) return [];
  const { data, error } = await supabase
    .from('director_run_steps')
    .insert(steps)
    .select();
  if (error) throw error;
  return data as DirectorRunStep[];
}

export async function getRunSteps(runId: string) {
  const { data, error } = await supabase
    .from('director_run_steps')
    .select('*')
    .eq('run_id', runId)
    .order('started_at', { ascending: true });
  if (error) throw error;
  return data as DirectorRunStep[];
}

// ─── Templates ───────────────────────────────────────────────────────────────

export async function getTemplates(orgId?: string) {
  let query = supabase
    .from('director_templates')
    .select('*')
    .order('title', { ascending: true });

  if (orgId) {
    query = query.or(`org_id.is.null,org_id.eq.${orgId}`);
  } else {
    query = query.is('org_id', null);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as DirectorTemplate[];
}

export async function getTemplate(templateId: string) {
  const { data, error } = await supabase
    .from('director_templates')
    .select('*')
    .eq('id', templateId)
    .single();
  if (error) throw error;
  return data as DirectorTemplate;
}

// ─── Flow Links ──────────────────────────────────────────────────────────────

export async function getFlowLinks(flowId: string) {
  const { data, error } = await supabase
    .from('director_flow_links')
    .select('*')
    .eq('flow_id', flowId);
  if (error) throw error;
  return data as DirectorFlowLink[];
}

export async function createFlowLink(link: Omit<DirectorFlowLink, 'id' | 'created_at'>) {
  const { data, error } = await supabase
    .from('director_flow_links')
    .insert(link)
    .select()
    .single();
  if (error) throw error;
  return data as DirectorFlowLink;
}

export async function deleteFlowLink(linkId: string) {
  const { error } = await supabase
    .from('director_flow_links')
    .delete()
    .eq('id', linkId);
  if (error) throw error;
}

// ─── Credits ─────────────────────────────────────────────────────────────────

export async function getCreditBalance(orgId: string) {
  const { data, error } = await supabase
    .from('org_credit_balances')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) {
    if (isTableMissing(error)) return null;
    throw error;
  }
  return data as OrgCreditBalance | null;
}

export async function getCreditTransactions(orgId: string, limit = 50) {
  const { data, error } = await supabase
    .from('org_credit_transactions')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as OrgCreditTransaction[];
}

// ─── Generations ────────────────────────────────────────────────────────────

export interface DirectorGeneration {
  id: string;
  org_id: string;
  created_by: string | null;
  flow_id: string | null;
  run_id: string | null;
  node_id: string | null;
  template_id: string | null;
  title: string;
  prompt: string | null;
  output_type: 'image' | 'video' | 'edit' | 'batch';
  output_url: string | null;
  thumbnail_url: string | null;
  provider: string | null;
  model: string | null;
  status: 'processing' | 'completed' | 'failed';
  metadata: Record<string, any>;
  is_favorite: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  flow?: { id: string; title: string } | null;
}

export async function listGenerations(
  orgId: string,
  opts?: { type?: string; limit?: number; offset?: number }
): Promise<{ data: DirectorGeneration[]; total: number }> {
  const limit = opts?.limit || 24;
  const offset = opts?.offset || 0;

  let query = supabase
    .from('director_generations')
    .select('*, flow:director_flows!director_generations_flow_id_fkey(id,title)', { count: 'exact' })
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (opts?.type === 'favorites') {
    query = query.eq('is_favorite', true);
  } else if (opts?.type && opts.type !== 'all') {
    query = query.eq('output_type', opts.type);
  }

  const { data, error, count } = await query;
  if (error) {
    if (isTableMissing(error)) return { data: [], total: 0 };
    throw error;
  }
  return { data: (data || []) as DirectorGeneration[], total: count || 0 };
}

export async function createGeneration(gen: Omit<DirectorGeneration, 'id' | 'created_at' | 'updated_at' | 'deleted_at' | 'flow' | 'is_favorite'> & { is_favorite?: boolean }): Promise<DirectorGeneration> {
  const { data, error } = await supabase
    .from('director_generations')
    .insert(gen)
    .select()
    .single();
  if (error) throw error;
  return data as DirectorGeneration;
}

export async function deleteGeneration(id: string): Promise<void> {
  const { error } = await supabase
    .from('director_generations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ─── Analytics & Usage Tracking ──────────────────────────────────────────────

export type UsageEventType = 'view' | 'download' | 'copy_prompt' | 'reuse' | 'delete' | 'save_style' | 'share' | 'favorite';

export async function trackUsageEvent(orgId: string, generationId: string, eventType: UsageEventType, metadata?: Record<string, any>): Promise<void> {
  try {
    await supabase.from('director_usage_events').insert({
      org_id: orgId,
      generation_id: generationId,
      event_type: eventType,
      metadata: metadata || {},
    });
  } catch {
    // Non-blocking
  }
}

export async function toggleFavorite(generationId: string, isFavorite: boolean): Promise<void> {
  const { error } = await supabase
    .from('director_generations')
    .update({ is_favorite: isFavorite })
    .eq('id', generationId);
  if (error) throw error;
}

export async function getTopPerformingPrompts(orgId: string, limit = 10): Promise<{ prompt: string; model: string; usage_count: number }[]> {
  const { data, error } = await supabase
    .from('director_usage_events')
    .select('generation_id, director_generations!inner(prompt, model)')
    .eq('org_id', orgId)
    .in('event_type', ['download', 'reuse', 'copy_prompt', 'favorite'])
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !data) return [];

  // Count events per generation and extract prompts
  const counts = new Map<string, { prompt: string; model: string; count: number }>();
  for (const row of data as any[]) {
    const id = row.generation_id;
    const existing = counts.get(id);
    if (existing) {
      existing.count++;
    } else {
      counts.set(id, {
        prompt: row.director_generations?.prompt || '',
        model: row.director_generations?.model || '',
        count: 1,
      });
    }
  }

  return [...counts.values()]
    .filter((c) => c.prompt)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((c) => ({ prompt: c.prompt, model: c.model, usage_count: c.count }));
}

export async function getAnalyticsSummary(orgId: string): Promise<{
  totalGenerations: number;
  totalDownloads: number;
  totalReuses: number;
  favoriteCount: number;
  topModel: string | null;
}> {
  const [genRes, eventsRes, favRes] = await Promise.allSettled([
    supabase.from('director_generations').select('model', { count: 'exact' }).eq('org_id', orgId).is('deleted_at', null),
    supabase.from('director_usage_events').select('event_type').eq('org_id', orgId),
    supabase.from('director_generations').select('id', { count: 'exact' }).eq('org_id', orgId).eq('is_favorite', true).is('deleted_at', null),
  ]);

  let totalGenerations = 0;
  let topModel: string | null = null;
  if (genRes.status === 'fulfilled') {
    totalGenerations = genRes.value.count || 0;
    const models = (genRes.value.data || []) as any[];
    const modelCounts = new Map<string, number>();
    for (const r of models) { if (r.model) modelCounts.set(r.model, (modelCounts.get(r.model) || 0) + 1); }
    let maxCount = 0;
    for (const [m, c] of modelCounts) { if (c > maxCount) { maxCount = c; topModel = m; } }
  }

  let totalDownloads = 0;
  let totalReuses = 0;
  if (eventsRes.status === 'fulfilled') {
    const events = (eventsRes.value.data || []) as any[];
    totalDownloads = events.filter((e: any) => e.event_type === 'download').length;
    totalReuses = events.filter((e: any) => e.event_type === 'reuse' || e.event_type === 'copy_prompt').length;
  }

  const favoriteCount = favRes.status === 'fulfilled' ? (favRes.value.count || 0) : 0;

  return { totalGenerations, totalDownloads, totalReuses, favoriteCount, topModel };
}

// ─── Style DNA ──────────────────────────────────────────────────────────────

export interface StyleDnaRecord {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  color_palette: string[];
  lighting: string | null;
  contrast: 'low' | 'medium' | 'high' | 'extreme' | null;
  texture: string | null;
  camera_style: string | null;
  composition: string | null;
  realism_level: number;
  brand_descriptors: string[];
  visual_rules: string[];
  negative_rules: string[];
  config_json: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export async function listStyleDna(orgId: string): Promise<StyleDnaRecord[]> {
  const { data, error } = await supabase
    .from('director_style_dna')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    if (isTableMissing(error)) return [];
    throw error;
  }
  return data as StyleDnaRecord[];
}

export async function createStyleDna(record: Omit<StyleDnaRecord, 'id' | 'created_at' | 'updated_at'>): Promise<StyleDnaRecord> {
  const { data, error } = await supabase
    .from('director_style_dna')
    .insert(record)
    .select()
    .single();
  if (error) throw error;
  return data as StyleDnaRecord;
}

export async function updateStyleDna(id: string, updates: Partial<StyleDnaRecord>): Promise<StyleDnaRecord> {
  const { data, error } = await supabase
    .from('director_style_dna')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as StyleDnaRecord;
}

export async function deleteStyleDna(id: string): Promise<void> {
  const { error } = await supabase
    .from('director_style_dna')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ─── Convert generation to Style DNA ────────────────────────────────────────

export async function generationToStyleDna(generationId: string, orgId: string, name: string): Promise<StyleDnaRecord> {
  const gen = await supabase
    .from('director_generations')
    .select('*')
    .eq('id', generationId)
    .single();
  if (gen.error) throw gen.error;
  const g = gen.data as DirectorGeneration;

  return createStyleDna({
    org_id: orgId,
    name,
    description: `Created from generation: ${g.title}`,
    color_palette: [],
    lighting: null,
    contrast: null,
    texture: null,
    camera_style: null,
    composition: null,
    realism_level: 8,
    brand_descriptors: [],
    visual_rules: g.prompt ? [g.prompt] : [],
    negative_rules: [],
    config_json: { source_generation_id: generationId, source_model: g.model, source_prompt: g.prompt },
  });
}

export async function debitCredits(
  orgId: string,
  amount: number,
  reason: string,
  runId?: string
) {
  // Check balance first
  const balance = await getCreditBalance(orgId);
  if (!balance || balance.credits_balance < amount) {
    throw new Error('Insufficient credits');
  }

  // Debit
  const { error: txError } = await supabase
    .from('org_credit_transactions')
    .insert({
      org_id: orgId,
      kind: 'debit',
      amount: -amount,
      reason,
      run_id: runId || null,
      metadata_json: {},
    });
  if (txError) throw txError;

  // Update balance
  const { error: balError } = await supabase
    .from('org_credit_balances')
    .update({
      credits_balance: balance.credits_balance - amount,
      updated_at: new Date().toISOString(),
    })
    .eq('org_id', orgId);
  if (balError) throw balError;
}
