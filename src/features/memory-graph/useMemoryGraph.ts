/* ═══════════════════════════════════════════════════════════════
   Memory Graph — React Hook
   Manages graph data, filters, and selection state.
   ═══════════════════════════════════════════════════════════════ */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import {
  fetchMemoryGraph,
  fetchNodeDetail,
  fetchLocalGraph,
  fetchMemoryStats,
  fetchRecentLogs,
} from './memoryGraphApi';
import type {
  MemoryGraphFilters,
  MemoryGraphData,
  MemoryNodeDetail,
  MemoryNode,
  MemoryEdge,
  GraphViewMode,
  MemoryNodeType,
  MemoryLayer,
  MemoryLog,
} from './types';

const DEFAULT_FILTERS: MemoryGraphFilters = {
  viewMode: 'global',
  nodeTypes: [],
  layers: [],
  companyId: null,
  clientId: null,
  minConfidence: 0,
  minImportance: 0,
  freshnessRange: 'all',
  search: '',
  hideWeak: false,
  focusNodeId: null,
};

export function useMemoryGraph(orgId: string) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<MemoryGraphFilters>(DEFAULT_FILTERS);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isLocalView, setIsLocalView] = useState(false);

  // ── Main graph data ─────────────────────────────────────
  const graphQuery = useQuery<MemoryGraphData>({
    queryKey: ['memory-graph', orgId, filters],
    queryFn: () => fetchMemoryGraph(orgId, filters),
    enabled: !!orgId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // ── Local subgraph (when focusing on a node) ────────────
  const localGraphQuery = useQuery({
    queryKey: ['memory-graph-local', orgId, filters.focusNodeId],
    queryFn: () => fetchLocalGraph(orgId, filters.focusNodeId!, 2),
    enabled: !!orgId && !!filters.focusNodeId && isLocalView,
    staleTime: 30_000,
  });

  // ── Selected node detail ────────────────────────────────
  const nodeDetailQuery = useQuery<MemoryNodeDetail>({
    queryKey: ['memory-node-detail', orgId, selectedNodeId],
    queryFn: () => fetchNodeDetail(orgId, selectedNodeId!),
    enabled: !!orgId && !!selectedNodeId,
    staleTime: 15_000,
  });

  // ── Recent logs ─────────────────────────────────────────
  const logsQuery = useQuery<MemoryLog[]>({
    queryKey: ['memory-logs', orgId],
    queryFn: () => fetchRecentLogs(orgId, 50),
    enabled: !!orgId,
    staleTime: 60_000,
  });

  // ── Build graph mutation ────────────────────────────────
  const buildMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch('/api/memory-graph/build', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memory-graph'] });
      queryClient.invalidateQueries({ queryKey: ['memory-logs'] });
    },
  });

  // ── Lint mutation ───────────────────────────────────────
  const lintMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch('/api/memory-graph/lint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memory-graph'] });
    },
  });

  // ── Lint node mutation ──────────────────────────────────
  const lintNodeMutation = useMutation({
    mutationFn: async (nodeId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch('/api/memory-graph/lint-node', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ nodeId }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  // ── Filter helpers ──────────────────────────────────────
  const updateFilter = useCallback(<K extends keyof MemoryGraphFilters>(
    key: K,
    value: MemoryGraphFilters[K],
  ) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const setViewMode = useCallback((mode: GraphViewMode) => {
    setFilters(prev => {
      const next = { ...prev, viewMode: mode };
      // Apply view mode presets
      if (mode === 'orphans') { next.hideWeak = false; }
      if (mode === 'agentic') { next.layers = ['agentic']; }
      if (mode === 'company') { next.layers = ['company']; }
      if (mode === 'client') { next.layers = ['client']; }
      if (mode === 'contradictions') { /* handled by contradictions view in component */ }
      if (mode === 'recent') { next.freshnessRange = '7d'; }
      if (mode === 'global') { next.layers = []; next.freshnessRange = 'all'; }
      return next;
    });
  }, []);

  const toggleNodeType = useCallback((type: MemoryNodeType) => {
    setFilters(prev => {
      const types = prev.nodeTypes.includes(type)
        ? prev.nodeTypes.filter(t => t !== type)
        : [...prev.nodeTypes, type];
      return { ...prev, nodeTypes: types };
    });
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setIsLocalView(false);
  }, []);

  const focusNode = useCallback((nodeId: string) => {
    setFilters(prev => ({ ...prev, focusNodeId: nodeId }));
    setIsLocalView(true);
  }, []);

  const unfocusNode = useCallback(() => {
    setFilters(prev => ({ ...prev, focusNodeId: null }));
    setIsLocalView(false);
  }, []);

  // ── Active graph data (global or local) ─────────────────
  const activeData = useMemo(() => {
    if (isLocalView && localGraphQuery.data) {
      return {
        nodes: localGraphQuery.data.nodes,
        edges: localGraphQuery.data.edges,
      };
    }
    return {
      nodes: graphQuery.data?.nodes || [],
      edges: graphQuery.data?.edges || [],
    };
  }, [isLocalView, localGraphQuery.data, graphQuery.data]);

  return {
    // Data
    nodes: activeData.nodes,
    edges: activeData.edges,
    stats: graphQuery.data?.stats || null,
    nodeDetail: nodeDetailQuery.data || null,
    logs: logsQuery.data || [],

    // Loading states
    isLoading: graphQuery.isLoading,
    isLoadingDetail: nodeDetailQuery.isLoading,
    isBuilding: buildMutation.isPending,
    isLinting: lintMutation.isPending,

    // Selection
    selectedNodeId,
    setSelectedNodeId,
    isLocalView,

    // Filters
    filters,
    setFilters,
    updateFilter,
    setViewMode,
    toggleNodeType,
    resetFilters,
    focusNode,
    unfocusNode,

    // Actions
    buildGraph: buildMutation.mutateAsync,
    lintGraph: lintMutation.mutateAsync,
    lintNode: lintNodeMutation.mutateAsync,
    lintNodeResult: lintNodeMutation.data,
    isLintingNode: lintNodeMutation.isPending,

    // Refresh
    refetch: graphQuery.refetch,
  };
}
