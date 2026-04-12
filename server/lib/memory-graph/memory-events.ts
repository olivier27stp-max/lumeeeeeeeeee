/* ═══════════════════════════════════════════════════════════════
   Memory Graph — Memory Event System
   Handles lifecycle events for the memory graph.

   This module provides functions that LIA's agent pipeline calls
   whenever a memory-relevant action occurs (learning, correction,
   escalation, synthesis, etc.). Each function creates/updates
   nodes and edges, and logs the event for audit.

   Memory Layer Promotion Rules:
   - conversation → client: if seen 2+ times for same client
   - client → company: if pattern applies to 3+ clients
   - any → agentic: if it's a learned correction or meta-pattern
   - staleness: nodes not refreshed in 30d get flagged
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';

type MemoryEventType =
  | 'memory.created'
  | 'memory.updated'
  | 'memory.merged'
  | 'memory.archived'
  | 'memory.conflict_detected'
  | 'memory.promoted'
  | 'memory.demoted'
  | 'memory.linked'
  | 'memory.unlinked';

// ── Log a memory event ────────────────────────────────────
export async function logMemoryEvent(
  supabase: SupabaseClient,
  orgId: string,
  event: {
    type: MemoryEventType;
    nodeId?: string;
    edgeId?: string;
    description: string;
    actor?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await supabase.from('memory_logs').insert({
    org_id: orgId,
    node_id: event.nodeId || null,
    edge_id: event.edgeId || null,
    event_type: event.type,
    description: event.description,
    actor: event.actor || 'lia',
    metadata: event.metadata || {},
  });
}

// ── Promote a node to a higher memory layer ───────────────
export async function promoteNode(
  supabase: SupabaseClient,
  orgId: string,
  nodeId: string,
  targetLayer: 'client' | 'company' | 'agentic',
): Promise<void> {
  const { data: node } = await supabase
    .from('memory_nodes')
    .select('memory_layer, label')
    .eq('id', nodeId)
    .single();

  if (!node) return;

  const layerOrder = ['conversation', 'client', 'company', 'agentic'];
  const currentIdx = layerOrder.indexOf(node.memory_layer);
  const targetIdx = layerOrder.indexOf(targetLayer);

  if (targetIdx <= currentIdx) return; // Can't demote via promote

  await supabase.from('memory_nodes').update({
    memory_layer: targetLayer,
    importance: Math.min(1, 0.7), // Boost importance on promotion
  }).eq('id', nodeId);

  await logMemoryEvent(supabase, orgId, {
    type: 'memory.promoted',
    nodeId,
    description: `Promoted "${node.label}" from ${node.memory_layer} to ${targetLayer}`,
  });
}

// ── Demote a stale node ───────────────────────────────────
export async function demoteNode(
  supabase: SupabaseClient,
  orgId: string,
  nodeId: string,
  targetLayer: 'conversation' | 'client',
): Promise<void> {
  const { data: node } = await supabase
    .from('memory_nodes')
    .select('memory_layer, label')
    .eq('id', nodeId)
    .single();

  if (!node) return;

  const layerOrder = ['conversation', 'client', 'company', 'agentic'];
  const currentIdx = layerOrder.indexOf(node.memory_layer);
  const targetIdx = layerOrder.indexOf(targetLayer);

  if (targetIdx >= currentIdx) return;

  await supabase.from('memory_nodes').update({
    memory_layer: targetLayer,
    importance: Math.max(0.1, 0.3),
  }).eq('id', nodeId);

  await logMemoryEvent(supabase, orgId, {
    type: 'memory.demoted',
    nodeId,
    description: `Demoted "${node.label}" from ${node.memory_layer} to ${targetLayer}`,
  });
}

// ── Record a learned preference ───────────────────────────
export async function recordLearnedPreference(
  supabase: SupabaseClient,
  orgId: string,
  opts: {
    label: string;
    description: string;
    clientId?: string;
    layer: 'client' | 'company' | 'agentic';
    sourceType: string;
    sourceId?: string;
    sourceLabel?: string;
  },
): Promise<string | null> {
  const { data: node, error } = await supabase.from('memory_nodes').insert({
    org_id: orgId,
    node_type: 'memory_note',
    label: opts.label,
    description: opts.description,
    confidence: 0.6,
    importance: 0.5,
    memory_layer: opts.layer,
    client_id: opts.clientId || null,
    metadata: {},
  }).select('id').single();

  if (error || !node) return null;

  // Add source
  await supabase.from('memory_sources').insert({
    org_id: orgId,
    node_id: node.id,
    source_type: opts.sourceType,
    source_id: opts.sourceId || null,
    source_label: opts.sourceLabel || null,
  });

  // Update source count
  await supabase.from('memory_nodes').update({ source_count: 1 }).eq('id', node.id);

  await logMemoryEvent(supabase, orgId, {
    type: 'memory.created',
    nodeId: node.id,
    description: `Learned preference: "${opts.label}"`,
  });

  return node.id;
}

// ── Record a correction (human feedback) ──────────────────
export async function recordCorrection(
  supabase: SupabaseClient,
  orgId: string,
  opts: {
    label: string;
    description: string;
    correctedNodeId?: string;
    sourceSessionId?: string;
  },
): Promise<string | null> {
  const { data: node, error } = await supabase.from('memory_nodes').insert({
    org_id: orgId,
    node_type: 'learned_pattern',
    label: opts.label,
    description: opts.description,
    confidence: 0.8,
    importance: 0.7,
    memory_layer: 'agentic',
    metadata: { type: 'correction' },
  }).select('id').single();

  if (error || !node) return null;

  // Link to corrected node if applicable
  if (opts.correctedNodeId) {
    await supabase.from('memory_edges').insert({
      org_id: orgId,
      source_id: node.id,
      target_id: opts.correctedNodeId,
      relation_type: 'contradicted_by',
      weight: 0.8,
      confidence: 0.8,
    });

    // Detect conflict
    await supabase.from('memory_conflicts').insert({
      org_id: orgId,
      node_a_id: node.id,
      node_b_id: opts.correctedNodeId,
      conflict_type: 'correction',
      description: opts.description,
      severity: 0.6,
    });
  }

  await logMemoryEvent(supabase, orgId, {
    type: 'memory.created',
    nodeId: node.id,
    description: `Correction recorded: "${opts.label}"`,
  });

  return node.id;
}

// ── Detect and flag stale memories ────────────────────────
export async function detectStaleness(
  supabase: SupabaseClient,
  orgId: string,
  staleDays: number = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();

  const { data: staleNodes } = await supabase
    .from('memory_nodes')
    .select('id, label')
    .eq('org_id', orgId)
    .eq('is_archived', false)
    .lt('freshness_at', cutoff);

  let count = 0;
  for (const node of staleNodes || []) {
    // Reduce confidence for stale nodes
    await supabase.from('memory_nodes').update({
      confidence: 0.3,
    }).eq('id', node.id).gte('confidence', 0.4);

    count++;
  }

  if (count > 0) {
    await logMemoryEvent(supabase, orgId, {
      type: 'memory.updated',
      description: `${count} stale nodes detected and confidence reduced`,
      actor: 'staleness_detector',
    });
  }

  return count;
}

// ── Check for promotion candidates ────────────────────────
export async function checkPromotionCandidates(
  supabase: SupabaseClient,
  orgId: string,
): Promise<number> {
  let promoted = 0;

  // Conversation → Client: nodes refreshed 2+ times with a client_id
  const { data: convNodes } = await supabase
    .from('memory_nodes')
    .select('id, client_id, source_count')
    .eq('org_id', orgId)
    .eq('memory_layer', 'conversation')
    .eq('is_archived', false)
    .gte('source_count', 2)
    .not('client_id', 'is', null);

  for (const n of convNodes || []) {
    await promoteNode(supabase, orgId, n.id, 'client');
    promoted++;
  }

  // Client → Company: same pattern found for 3+ clients
  // (simplified: nodes with high source count and no client specificity)
  const { data: clientNodes } = await supabase
    .from('memory_nodes')
    .select('id, source_count')
    .eq('org_id', orgId)
    .eq('memory_layer', 'client')
    .eq('is_archived', false)
    .gte('source_count', 5);

  for (const n of clientNodes || []) {
    await promoteNode(supabase, orgId, n.id, 'company');
    promoted++;
  }

  return promoted;
}

// ── Deduplication check ───────────────────────────────────
export async function detectDuplicates(
  supabase: SupabaseClient,
  orgId: string,
): Promise<number> {
  const { data: nodes } = await supabase
    .from('memory_nodes')
    .select('id, label, node_type, description')
    .eq('org_id', orgId)
    .eq('is_archived', false);

  if (!nodes || nodes.length < 2) return 0;

  let duplicates = 0;
  const seen = new Map<string, string>();

  for (const node of nodes) {
    const key = `${node.node_type}:${node.label.toLowerCase().trim()}`;
    if (seen.has(key)) {
      const existingId = seen.get(key)!;

      // Check if edge already exists
      const { data: existing } = await supabase
        .from('memory_edges')
        .select('id')
        .eq('org_id', orgId)
        .eq('source_id', node.id)
        .eq('target_id', existingId)
        .eq('relation_type', 'duplicate_of')
        .maybeSingle();

      if (!existing) {
        await supabase.from('memory_edges').insert({
          org_id: orgId,
          source_id: node.id,
          target_id: existingId,
          relation_type: 'duplicate_of',
          weight: 0.9,
          confidence: 0.7,
        });

        await supabase.from('memory_conflicts').insert({
          org_id: orgId,
          node_a_id: node.id,
          node_b_id: existingId,
          conflict_type: 'duplicate',
          description: `Potential duplicate: "${node.label}"`,
          severity: 0.4,
        });

        duplicates++;
      }
    } else {
      seen.set(key, node.id);
    }
  }

  return duplicates;
}
