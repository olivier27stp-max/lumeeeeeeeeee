/* ═══════════════════════════════════════════════════════════════
   Memory Graph — API Client
   All frontend data fetching for the memory graph feature.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from '../../lib/supabase';
import type {
  MemoryNode, MemoryEdge, MemoryGraphData, MemoryGraphStats,
  MemoryNodeDetail, MemoryConflict, MemoryLog, MemorySource,
  MemoryGraphFilters, MemorySnapshot,
} from './types';

// ── Fetch full graph ──────────────────────────────────────
export async function fetchMemoryGraph(
  orgId: string,
  filters: MemoryGraphFilters,
): Promise<MemoryGraphData> {
  // Build nodes query
  let nodesQuery = supabase
    .from('memory_nodes')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_archived', false)
    .order('importance', { ascending: false })
    .limit(500);

  // Apply filters
  if (filters.nodeTypes.length > 0 && filters.nodeTypes.length < 24) {
    nodesQuery = nodesQuery.in('node_type', filters.nodeTypes);
  }
  if (filters.layers.length > 0 && filters.layers.length < 4) {
    nodesQuery = nodesQuery.in('memory_layer', filters.layers);
  }
  if (filters.companyId) {
    nodesQuery = nodesQuery.eq('company_id', filters.companyId);
  }
  if (filters.clientId) {
    nodesQuery = nodesQuery.eq('client_id', filters.clientId);
  }
  if (filters.minConfidence > 0) {
    nodesQuery = nodesQuery.gte('confidence', filters.minConfidence);
  }
  if (filters.minImportance > 0) {
    nodesQuery = nodesQuery.gte('importance', filters.minImportance);
  }
  if (filters.freshnessRange !== 'all') {
    const ranges: Record<string, number> = {
      '24h': 1, '7d': 7, '30d': 30, '90d': 90,
    };
    const days = ranges[filters.freshnessRange] || 365;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    nodesQuery = nodesQuery.gte('freshness_at', cutoff);
  }
  if (filters.search) {
    nodesQuery = nodesQuery.or(`label.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);
  }
  if (filters.viewMode === 'orphans') {
    nodesQuery = nodesQuery.eq('is_orphan', true);
  }
  if (filters.hideWeak) {
    nodesQuery = nodesQuery.gte('confidence', 0.3).gte('importance', 0.2);
  }

  const { data: nodes, error: nodesErr } = await nodesQuery;
  if (nodesErr) throw nodesErr;

  const nodeIds = (nodes || []).map(n => n.id);

  // Fetch edges connecting visible nodes
  let edges: MemoryEdge[] = [];
  if (nodeIds.length > 0) {
    // Fetch in batches if needed
    const { data: edgeData, error: edgesErr } = await supabase
      .from('memory_edges')
      .select('*')
      .eq('org_id', orgId)
      .in('source_id', nodeIds)
      .in('target_id', nodeIds)
      .limit(2000);
    if (edgesErr) throw edgesErr;
    edges = edgeData || [];
  }

  // Fetch stats
  const stats = await fetchMemoryStats(orgId);

  return { nodes: nodes || [], edges, stats };
}

// ── Fetch local subgraph around a node ────────────────────
export async function fetchLocalGraph(
  orgId: string,
  nodeId: string,
  depth: number = 2,
): Promise<{ nodes: MemoryNode[]; edges: MemoryEdge[] }> {
  const visited = new Set<string>();
  const allNodes: MemoryNode[] = [];
  const allEdges: MemoryEdge[] = [];
  let frontier = [nodeId];

  for (let d = 0; d < depth && frontier.length > 0; d++) {
    frontier.forEach(id => visited.add(id));

    // Get edges from/to frontier
    const [outgoing, incoming] = await Promise.all([
      supabase.from('memory_edges').select('*').eq('org_id', orgId).in('source_id', frontier),
      supabase.from('memory_edges').select('*').eq('org_id', orgId).in('target_id', frontier),
    ]);

    const edgesFound = [...(outgoing.data || []), ...(incoming.data || [])];
    const newNodeIds = new Set<string>();
    for (const e of edgesFound) {
      if (!allEdges.find(ae => ae.id === e.id)) allEdges.push(e);
      if (!visited.has(e.source_id)) newNodeIds.add(e.source_id);
      if (!visited.has(e.target_id)) newNodeIds.add(e.target_id);
    }

    // Fetch new neighbor nodes
    const idsToFetch = [...newNodeIds];
    if (idsToFetch.length > 0) {
      const { data: neighborNodes } = await supabase
        .from('memory_nodes')
        .select('*')
        .eq('org_id', orgId)
        .in('id', idsToFetch);
      if (neighborNodes) allNodes.push(...neighborNodes);
    }

    frontier = idsToFetch;
  }

  // Also fetch the center node itself
  const { data: centerNode } = await supabase
    .from('memory_nodes')
    .select('*')
    .eq('id', nodeId)
    .single();
  if (centerNode) allNodes.unshift(centerNode);

  return { nodes: allNodes, edges: allEdges };
}

// ── Fetch node detail ─────────────────────────────────────
export async function fetchNodeDetail(
  orgId: string,
  nodeId: string,
): Promise<MemoryNodeDetail> {
  const [nodeRes, edgesOutRes, edgesInRes, sourcesRes, logsRes, conflictsRes] = await Promise.all([
    supabase.from('memory_nodes').select('*').eq('id', nodeId).single(),
    supabase.from('memory_edges').select('*').eq('org_id', orgId).eq('source_id', nodeId),
    supabase.from('memory_edges').select('*').eq('org_id', orgId).eq('target_id', nodeId),
    supabase.from('memory_sources').select('*').eq('node_id', nodeId).order('created_at', { ascending: false }).limit(20),
    supabase.from('memory_logs').select('*').eq('node_id', nodeId).order('created_at', { ascending: false }).limit(30),
    supabase.from('memory_conflicts').select('*').eq('org_id', orgId).or(`node_a_id.eq.${nodeId},node_b_id.eq.${nodeId}`).limit(10),
  ]);

  if (nodeRes.error) throw nodeRes.error;
  const node = nodeRes.data as MemoryNode;

  // Gather neighbor node IDs
  const outEdges = edgesOutRes.data || [];
  const inEdges = edgesInRes.data || [];
  const neighborIds = new Set<string>();
  outEdges.forEach(e => neighborIds.add(e.target_id));
  inEdges.forEach(e => neighborIds.add(e.source_id));

  let neighborNodes: MemoryNode[] = [];
  if (neighborIds.size > 0) {
    const { data } = await supabase.from('memory_nodes').select('*').in('id', [...neighborIds]);
    neighborNodes = data || [];
  }
  const nodeMap = new Map(neighborNodes.map(n => [n.id, n]));

  const neighbors = [
    ...outEdges.map(e => ({
      node: nodeMap.get(e.target_id)!,
      edge: e as MemoryEdge,
      direction: 'outgoing' as const,
    })),
    ...inEdges.map(e => ({
      node: nodeMap.get(e.source_id)!,
      edge: e as MemoryEdge,
      direction: 'incoming' as const,
    })),
  ].filter(n => n.node);

  return {
    ...node,
    neighbors,
    sources: (sourcesRes.data || []) as MemorySource[],
    logs: (logsRes.data || []) as MemoryLog[],
    conflicts: (conflictsRes.data || []) as MemoryConflict[],
  };
}

// ── Fetch graph stats ─────────────────────────────────────
export async function fetchMemoryStats(orgId: string): Promise<MemoryGraphStats> {
  const [
    nodesCount,
    edgesCount,
    orphanCount,
    conflictsUnresolved,
    avgConfRes,
    layerCounts,
    typeCounts,
    staleCount,
  ] = await Promise.all([
    supabase.from('memory_nodes').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_archived', false),
    supabase.from('memory_edges').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
    supabase.from('memory_nodes').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_orphan', true).eq('is_archived', false),
    supabase.from('memory_conflicts').select('*').eq('org_id', orgId).eq('resolved', false).order('created_at', { ascending: false }).limit(10),
    supabase.from('memory_nodes').select('confidence, importance').eq('org_id', orgId).eq('is_archived', false),
    supabase.from('memory_nodes').select('memory_layer').eq('org_id', orgId).eq('is_archived', false),
    supabase.from('memory_nodes').select('node_type').eq('org_id', orgId).eq('is_archived', false),
    supabase.from('memory_nodes').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_archived', false).lt('freshness_at', new Date(Date.now() - 30 * 86400000).toISOString()),
  ]);

  // Compute avg confidence & importance
  const confData = avgConfRes.data || [];
  const avgConf = confData.length > 0
    ? confData.reduce((s, n) => s + Number(n.confidence), 0) / confData.length
    : 0;
  const avgImp = confData.length > 0
    ? confData.reduce((s, n) => s + Number(n.importance), 0) / confData.length
    : 0;

  // Layer distribution
  const layerDist: Record<string, number> = {};
  (layerCounts.data || []).forEach(r => {
    layerDist[r.memory_layer] = (layerDist[r.memory_layer] || 0) + 1;
  });

  // Type distribution
  const typeDist: Record<string, number> = {};
  (typeCounts.data || []).forEach(r => {
    typeDist[r.node_type] = (typeDist[r.node_type] || 0) + 1;
  });

  // Top hubs (nodes with most connections)
  const { data: hubEdges } = await supabase
    .from('memory_edges')
    .select('source_id, target_id')
    .eq('org_id', orgId);

  const degreeCounts = new Map<string, number>();
  (hubEdges || []).forEach(e => {
    degreeCounts.set(e.source_id, (degreeCounts.get(e.source_id) || 0) + 1);
    degreeCounts.set(e.target_id, (degreeCounts.get(e.target_id) || 0) + 1);
  });

  const topHubIds = [...degreeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, degree]) => ({ id, degree }));

  let topHubs: MemoryGraphStats['top_hubs'] = [];
  if (topHubIds.length > 0) {
    const { data: hubNodes } = await supabase
      .from('memory_nodes')
      .select('id, label, node_type')
      .in('id', topHubIds.map(h => h.id));
    if (hubNodes) {
      topHubs = topHubIds.map(h => {
        const node = hubNodes.find(n => n.id === h.id);
        return {
          id: h.id,
          label: node?.label || 'Unknown',
          node_type: node?.node_type || 'concept',
          degree: h.degree,
        };
      });
    }
  }

  return {
    total_nodes: nodesCount.count || 0,
    total_edges: edgesCount.count || 0,
    orphan_count: orphanCount.count || 0,
    conflict_count: (conflictsUnresolved.data || []).length,
    avg_confidence: Math.round(avgConf * 100) / 100,
    avg_importance: Math.round(avgImp * 100) / 100,
    layer_counts: layerDist,
    type_counts: typeDist,
    top_hubs: topHubs,
    recent_conflicts: (conflictsUnresolved.data || []) as MemoryConflict[],
    stale_count: staleCount.count || 0,
  };
}

// ── Fetch snapshots for timeline ──────────────────────────
export async function fetchMemorySnapshots(
  orgId: string,
  limit: number = 30,
): Promise<MemorySnapshot[]> {
  const { data, error } = await supabase
    .from('memory_snapshots')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as MemorySnapshot[];
}

// ── Fetch recent memory logs ──────────────────────────────
export async function fetchRecentLogs(
  orgId: string,
  limit: number = 50,
): Promise<MemoryLog[]> {
  const { data, error } = await supabase
    .from('memory_logs')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as MemoryLog[];
}
