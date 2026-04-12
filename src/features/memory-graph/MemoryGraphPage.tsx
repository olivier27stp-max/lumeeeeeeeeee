/* ═══════════════════════════════════════════════════════════════
   Memory Graph — Main Page
   LIA's brain visualization: Obsidian-inspired force graph
   connected to the real CRM memory system.
   ═══════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { useMemoryGraph } from './useMemoryGraph';
import ForceGraph from './components/ForceGraph';
import NodeDetailPanel from './components/NodeDetailPanel';
import GraphControls from './components/GraphControls';
import MemoryAnalytics from './components/MemoryAnalytics';
import { Loader2, Brain } from 'lucide-react';
import { toast } from 'sonner';

export default function MemoryGraphPage() {
  const { t, language } = useTranslation();
  const [orgId, setOrgId] = useState<string>('');

  // Get org_id from the current user
  useEffect(() => {
    async function loadOrg() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membership } = await supabase
        .from('memberships')
        .select('org_id')
        .eq('user_id', user.id)
        .limit(1)
        .single();
      if (membership) setOrgId(membership.org_id);
    }
    loadOrg();
  }, []);

  const {
    nodes, edges, stats, nodeDetail, logs,
    isLoading, isLoadingDetail, isBuilding, isLinting,
    selectedNodeId, setSelectedNodeId, isLocalView,
    filters, updateFilter, setViewMode, toggleNodeType,
    resetFilters, focusNode, unfocusNode,
    buildGraph, lintGraph, lintNode, lintNodeResult, isLintingNode,
    refetch,
  } = useMemoryGraph(orgId);

  // Handlers
  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, [setSelectedNodeId]);

  const handleNodeDoubleClick = useCallback((nodeId: string) => {
    focusNode(nodeId);
    setSelectedNodeId(nodeId);
  }, [focusNode, setSelectedNodeId]);

  const handleBackgroundClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  const handleNavigateToNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, [setSelectedNodeId]);

  const handleBuild = useCallback(async () => {
    try {
      const result = await buildGraph();
      toast.success(
        language === 'fr'
          ? `Build terminé: ${result?.result?.nodesCreated || 0} nœuds créés, ${result?.result?.edgesCreated || 0} liens`
          : `Build complete: ${result?.result?.nodesCreated || 0} nodes created, ${result?.result?.edgesCreated || 0} edges`,
      );
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'Build failed');
    }
  }, [buildGraph, refetch, language]);

  const handleLint = useCallback(async () => {
    try {
      const result = await lintGraph();
      const r = result?.results;
      toast.success(
        language === 'fr'
          ? `Lint: ${r?.stale_nodes_flagged || 0} périmés, ${r?.nodes_promoted || 0} promus, ${r?.duplicates_detected || 0} doublons`
          : `Lint: ${r?.stale_nodes_flagged || 0} stale, ${r?.nodes_promoted || 0} promoted, ${r?.duplicates_detected || 0} duplicates`,
      );
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'Lint failed');
    }
  }, [lintGraph, refetch, language]);

  const handleLintNode = useCallback(async (nodeId: string) => {
    try {
      await lintNode(nodeId);
    } catch (err: any) {
      toast.error(err.message || 'Node lint failed');
    }
  }, [lintNode]);

  if (!orgId) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] bg-surface dark:bg-[#09090b] overflow-hidden">
      {/* Controls bar */}
      <GraphControls
        filters={filters}
        updateFilter={updateFilter}
        setViewMode={setViewMode}
        toggleNodeType={toggleNodeType}
        resetFilters={resetFilters}
        onBuild={handleBuild}
        onLint={handleLint}
        isBuilding={isBuilding}
        isLinting={isLinting}
        isLocalView={isLocalView}
        onExitLocalView={unfocusNode}
        nodeCount={nodes.length}
        edgeCount={edges.length}
        language={language}
      />

      {/* Main area: graph + side panel */}
      <div className="flex-1 relative overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={28} className="animate-spin text-text-muted" />
              <span className="text-[12px] text-text-muted">
                {language === 'fr' ? 'Chargement du graphe mémoire…' : 'Loading memory graph…'}
              </span>
            </div>
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <Brain size={48} className="mx-auto mb-4 text-text-muted" strokeWidth={1} />
              <h2 className="text-[16px] font-semibold text-text-primary mb-2">
                {language === 'fr' ? 'Graphe mémoire vide' : 'Memory Graph Empty'}
              </h2>
              <p className="text-[13px] text-text-secondary mb-4">
                {language === 'fr'
                  ? "Le cerveau de LIA n'a pas encore été hydraté. Lancez un build pour créer le graphe à partir de vos données CRM existantes."
                  : "LIA's brain hasn't been hydrated yet. Run a build to create the graph from your existing CRM data."}
              </p>
              <button
                onClick={handleBuild}
                disabled={isBuilding}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary dark:bg-white/10 text-white dark:text-text-primary text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isBuilding ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
                {isBuilding
                  ? (language === 'fr' ? 'Construction…' : 'Building…')
                  : (language === 'fr' ? 'Construire le graphe' : 'Build Memory Graph')}
              </button>
            </div>
          </div>
        ) : (
          <ForceGraph
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            focusNodeId={filters.focusNodeId}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            onBackgroundClick={handleBackgroundClick}
            language={language}
          />
        )}

        {/* Side panel */}
        <NodeDetailPanel
          node={nodeDetail}
          isLoading={isLoadingDetail}
          onClose={() => setSelectedNodeId(null)}
          onNavigateToNode={handleNavigateToNode}
          onLintNode={handleLintNode}
          isLintingNode={isLintingNode}
          lintResult={lintNodeResult}
          language={language}
        />
      </div>

      {/* Analytics panel */}
      <MemoryAnalytics
        stats={stats}
        logs={logs}
        onNavigateToNode={handleNavigateToNode}
        language={language}
      />
    </div>
  );
}
