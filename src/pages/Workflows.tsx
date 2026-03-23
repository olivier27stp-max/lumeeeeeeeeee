import React, { useState, useEffect, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Plus, Zap, GitBranch, Play, Trash2, Loader2,
  ChevronRight, Clock, AlertCircle, Timer,
  Check, X, Search, Sparkles, MoreHorizontal,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { toast } from 'sonner';
import { nodeTypes } from '../components/workflow/WorkflowNodes';
import PresetLibrary from '../components/workflow/PresetLibrary';
import NodeEditor from '../components/workflow/NodeEditor';
import {
  type Workflow, type WorkflowRun, type TriggerType, type ActionType, type WorkflowStatus,
  TRIGGER_DEFS, ACTION_DEFS,
  getWorkflows, createWorkflow, updateWorkflow, deleteWorkflow,
  getWorkflowNodes, getWorkflowEdges,
  createNode, updateNode, deleteNode as apiDeleteNode,
  createEdge as apiCreateEdge, deleteEdge as apiDeleteEdge,
  getWorkflowRuns, executeWorkflow, getRunLogs,
  clonePreset,
} from '../lib/workflowApi';
import type { WorkflowPreset } from '../lib/workflowPresets';

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function Workflows() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';

  // ── State ──
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWf, setSelectedWf] = useState<Workflow | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showPresets, setShowPresets] = useState(false);
  const [showAddNode, setShowAddNode] = useState(false);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(null);
  const [runLogs, setRunLogs] = useState<any[]>([]);
  const [executing, setExecuting] = useState(false);
  const [cloningPreset, setCloningPreset] = useState(false);

  // ── Load workflows ──
  const loadWorkflows = useCallback(async () => {
    try {
      const data = await getWorkflows();
      setWorkflows(data);
    } catch (e) {
      console.error('Failed to load workflows', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadWorkflows(); }, [loadWorkflows]);

  // ── Load workflow nodes/edges ──
  const loadWorkflowGraph = useCallback(async (wf: Workflow) => {
    try {
      const [dbNodes, dbEdges] = await Promise.all([
        getWorkflowNodes(wf.id),
        getWorkflowEdges(wf.id),
      ]);

      const rfNodes: Node[] = dbNodes.map((n) => ({
        id: n.id,
        type: n.node_type,
        position: { x: n.position_x, y: n.position_y },
        data: {
          label: n.label || '',
          actionType: n.action_type,
          icon: n.node_type === 'trigger'
            ? TRIGGER_DEFS[n.config?.trigger_type as TriggerType]?.icon
            : n.action_type
              ? ACTION_DEFS[n.action_type as ActionType]?.icon
              : undefined,
          ...n.config,
        },
      }));

      const rfEdges: Edge[] = dbEdges.map((e) => ({
        id: e.id,
        source: e.source_id,
        target: e.target_id,
        sourceHandle: e.source_handle || undefined,
        targetHandle: e.target_handle || undefined,
        label: e.label || undefined,
        type: 'smoothstep',
        style: { stroke: 'var(--color-outline)', strokeWidth: 1.5 },
        animated: false,
      }));

      setNodes(rfNodes);
      setEdges(rfEdges);

      const wfRuns = await getWorkflowRuns(wf.id);
      setRuns(wfRuns);
    } catch (e) {
      console.error('Failed to load workflow graph', e);
    }
  }, [setNodes, setEdges]);

  const selectWorkflow = useCallback((wf: Workflow) => {
    setSelectedWf(wf);
    setSelectedNode(null);
    setSelectedRun(null);
    setRunLogs([]);
    loadWorkflowGraph(wf);
  }, [loadWorkflowGraph]);

  // ── Clone preset ──
  const handleClonePreset = async (preset: WorkflowPreset) => {
    setCloningPreset(true);
    try {
      const wf = await clonePreset(preset);
      setWorkflows((prev) => [wf, ...prev]);
      selectWorkflow(wf);
      setShowPresets(false);
      toast.success(fr ? `Workflow "${preset.name}" créé` : `Workflow "${preset.name}" created`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to create workflow from preset');
    } finally {
      setCloningPreset(false);
    }
  };

  // ── Delete workflow ──
  const handleDelete = async (id: string) => {
    try {
      await deleteWorkflow(id);
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
      if (selectedWf?.id === id) {
        setSelectedWf(null);
        setNodes([]);
        setEdges([]);
        setSelectedNode(null);
      }
      toast.success(t.workflows.workflowDeleted);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // ── Update status ──
  const setStatus = async (wf: Workflow, status: WorkflowStatus) => {
    const active = status === 'published';
    setWorkflows((prev) => prev.map((w) => w.id === wf.id ? { ...w, status, active } : w));
    if (selectedWf?.id === wf.id) setSelectedWf({ ...wf, status, active });
    try {
      await updateWorkflow(wf.id, { status, active });
    } catch {
      setWorkflows((prev) => prev.map((w) => w.id === wf.id ? wf : w));
    }
  };

  // ── Connect edges ──
  const onConnect = useCallback(async (params: Connection) => {
    if (!selectedWf) return;
    const newEdge = {
      ...params,
      id: `e-${params.source}-${params.target}`,
      type: 'smoothstep',
      style: { stroke: 'var(--color-outline)', strokeWidth: 1.5 },
    } as Edge;
    setEdges((eds) => addEdge(newEdge, eds));
    try {
      await apiCreateEdge(selectedWf.id, {
        source_id: params.source!,
        target_id: params.target!,
        source_handle: params.sourceHandle || undefined,
        target_handle: params.targetHandle || undefined,
      });
    } catch {
      toast.error('Failed to save connection');
    }
  }, [selectedWf, setEdges]);

  const onEdgesDelete = useCallback(async (deleted: Edge[]) => {
    for (const edge of deleted) {
      try { await apiDeleteEdge(edge.id); } catch {}
    }
  }, []);

  // ── Node drag stop ──
  const onNodeDragStop = useCallback(async (_: any, node: Node) => {
    try {
      await updateNode(node.id, { position_x: node.position.x, position_y: node.position.y });
    } catch {}
  }, []);

  // ── Node click → open editor ──
  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
    setSelectedRun(null);
  }, []);

  // ── Node editor update ──
  const handleNodeUpdate = useCallback(async (nodeId: string, data: Record<string, any>) => {
    setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n));
    try {
      const { label, actionType, icon, ...config } = data;
      await updateNode(nodeId, { label, config });
    } catch {}
  }, [setNodes]);

  // ── Node editor delete ──
  const handleNodeDelete = useCallback(async (nodeId: string) => {
    try {
      await apiDeleteNode(nodeId);
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNode(null);
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [setNodes, setEdges]);

  // ── Add node ──
  const addNodeToCanvas = async (type: 'condition' | 'action' | 'delay', actionType?: ActionType) => {
    if (!selectedWf) return;
    setShowAddNode(false);

    const label = type === 'condition'
      ? (t.workflows.condition)
      : type === 'delay'
        ? (t.workflows.delay)
        : actionType
          ? (fr ? ACTION_DEFS[actionType].labelFr : ACTION_DEFS[actionType].label)
          : 'Action';

    const icon = type === 'action' && actionType ? ACTION_DEFS[actionType].icon : undefined;

    try {
      const dbNode = await createNode(selectedWf.id, {
        node_type: type,
        action_type: type === 'action' ? (actionType || null) : null,
        label,
        config: type === 'delay'
          ? { delay_value: 1, delay_unit: 'hours' }
          : actionType ? { action_type: actionType } : {},
        position_x: 250 + Math.random() * 100,
        position_y: 150 + nodes.length * 130,
      });

      const newNode: Node = {
        id: dbNode.id,
        type: dbNode.node_type,
        position: { x: dbNode.position_x, y: dbNode.position_y },
        data: { label, actionType, icon, ...dbNode.config },
      };

      setNodes((prev) => [...prev, newNode]);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // ── Delete nodes ──
  const onNodesDelete = useCallback(async (deleted: Node[]) => {
    for (const node of deleted) {
      if (node.type === 'trigger') {
        toast.error(t.workflows.cannotDeleteTheTriggerNode);
        if (selectedWf) loadWorkflowGraph(selectedWf);
        return;
      }
      try { await apiDeleteNode(node.id); } catch {}
    }
  }, [selectedWf, fr, loadWorkflowGraph]);

  // ── Execute workflow ──
  const handleExecute = async () => {
    if (!selectedWf) return;
    setExecuting(true);
    try {
      const run = await executeWorkflow(selectedWf.id, { manual: true, triggered_at: new Date().toISOString() });
      setRuns((prev) => [run, ...prev]);
      toast.success(t.workflows.workflowExecuted);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setExecuting(false);
    }
  };

  // ── View run logs ──
  const viewRunLogs = async (run: WorkflowRun) => {
    setSelectedRun(run);
    setSelectedNode(null);
    try {
      const logs = await getRunLogs(run.id);
      setRunLogs(logs);
    } catch {}
  };

  // ── Filtered workflows ──
  const filteredWorkflows = workflows.filter((w) =>
    w.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const statusLabel = (s: WorkflowStatus) => {
    if (s === 'published') return t.workflows.published;
    if (s === 'paused') return t.workflows.paused;
    return t.workflows.draft;
  };

  const statusStyle = (s: WorkflowStatus) => {
    if (s === 'published') return 'bg-badge-success/10 text-badge-success';
    if (s === 'paused') return 'bg-badge-warning/10 text-badge-warning';
    return 'bg-surface-tertiary text-text-tertiary';
  };

  // Should we show the node editor or the runs panel on the right?
  const showNodeEditor = selectedNode && !selectedRun;

  return (
    <div className="flex h-[calc(100vh-130px)] gap-0 -mx-6 -my-5">
      {/* ═══ LEFT SIDEBAR ═══ */}
      <div className="w-[260px] shrink-0 border-r border-outline bg-surface flex flex-col">
        <div className="px-4 py-3 border-b border-outline flex items-center justify-between">
          <h2 className="text-[14px] font-bold text-text-primary flex items-center gap-1.5">
            <Zap size={14} className="text-text-secondary" />
            {t.workflows.workflows}
          </h2>
          <span className="text-[10px] font-medium text-text-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded">
            {workflows.length}
          </span>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              placeholder={t.automations.search}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="glass-input w-full pl-8 text-[12px] py-1.5"
            />
          </div>
        </div>

        {/* Workflow list */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={16} className="animate-spin text-text-tertiary" />
            </div>
          ) : filteredWorkflows.length === 0 ? (
            <div className="text-center py-8 px-4">
              <Sparkles size={20} className="mx-auto text-text-tertiary mb-2 opacity-30" />
              <p className="text-[11px] text-text-tertiary mb-3">
                {t.workflows.noWorkflowsYet}
              </p>
              <button
                onClick={() => setShowPresets(true)}
                className="glass-button-primary text-[11px] py-1.5 px-3 mx-auto"
              >
                {t.workflows.startWithAPreset}
              </button>
            </div>
          ) : (
            filteredWorkflows.map((wf) => (
              <button
                key={wf.id}
                onClick={() => selectWorkflow(wf)}
                className={cn(
                  'w-full text-left px-3 py-2.5 rounded-lg transition-colors group',
                  selectedWf?.id === wf.id
                    ? 'bg-surface-tertiary'
                    : 'hover:bg-surface-secondary'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-text-primary truncate flex-1">{wf.name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(wf.id); }}
                    className="p-0.5 text-text-tertiary hover:text-danger opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded', statusStyle(wf.status))}>
                    {statusLabel(wf.status)}
                  </span>
                  <span className="text-[10px] text-text-tertiary truncate">
                    {fr ? TRIGGER_DEFS[wf.trigger_type as TriggerType]?.labelFr : TRIGGER_DEFS[wf.trigger_type as TriggerType]?.label}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Create buttons */}
        <div className="p-3 border-t border-outline space-y-1.5">
          <button
            onClick={() => setShowPresets(true)}
            className="w-full text-[12px] py-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 bg-primary text-white hover:bg-primary/90 transition-colors"
          >
            <Sparkles size={13} />
            {t.workflows.newFromPreset}
          </button>
        </div>
      </div>

      {/* ═══ CENTER CANVAS ═══ */}
      <div className="flex-1 relative workflow-canvas-wrapper">
        {!selectedWf ? (
          <div className="flex items-center justify-center h-full bg-surface-secondary">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-surface-tertiary/50 flex items-center justify-center mx-auto mb-4">
                <Zap size={28} className="text-text-tertiary opacity-30" />
              </div>
              <h3 className="text-[15px] font-bold text-text-primary mb-1.5">
                {t.workflows.automateYourBusiness}
              </h3>
              <p className="text-[12px] text-text-tertiary max-w-[260px] mx-auto mb-5">
                {fr
                  ? 'Sélectionnez un workflow existant ou créez-en un depuis notre bibliothèque de presets.'
                  : 'Select an existing workflow or create one from our preset library.'
                }
              </p>
              <button
                onClick={() => setShowPresets(true)}
                className="glass-button-primary text-[12px] py-2 px-5 flex items-center gap-2 mx-auto"
              >
                <Sparkles size={14} />
                {t.workflows.browsePresets}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Top toolbar */}
            <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-2 pointer-events-auto">
                <h3 className="text-[13px] font-bold text-text-primary bg-surface/90 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-outline shadow-sm">
                  {selectedWf.name}
                </h3>
                <span className={cn('text-[10px] font-semibold px-2 py-1 rounded-md', statusStyle(selectedWf.status))}>
                  {statusLabel(selectedWf.status)}
                </span>
              </div>

              <div className="flex items-center gap-1.5 pointer-events-auto">
                {/* Add node */}
                <div className="relative">
                  <button
                    onClick={() => setShowAddNode(!showAddNode)}
                    className="bg-surface/90 backdrop-blur-sm border border-outline shadow-sm rounded-lg px-3 py-1.5 text-[12px] font-medium text-text-primary hover:border-text-tertiary transition-colors flex items-center gap-1.5"
                  >
                    <Plus size={13} />
                    {t.workflows.add}
                  </button>

                  <AnimatePresence>
                    {showAddNode && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="absolute top-full right-0 mt-1 bg-surface border border-outline rounded-xl shadow-xl w-[240px] max-h-[420px] overflow-y-auto z-50"
                      >
                        {/* Logic */}
                        <div className="px-3 pt-3 pb-1">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">
                            {t.workflows.logic}
                          </p>
                          <button
                            onClick={() => addNodeToCanvas('condition')}
                            className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-secondary transition-colors flex items-center gap-2"
                          >
                            <div className="w-5 h-5 rounded-md bg-surface-tertiary flex items-center justify-center">
                              <GitBranch size={11} className="text-text-secondary" />
                            </div>
                            <span className="text-[12px] font-medium text-text-primary">
                              {t.workflows.condition}
                            </span>
                          </button>
                          <button
                            onClick={() => addNodeToCanvas('delay')}
                            className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-secondary transition-colors flex items-center gap-2"
                          >
                            <div className="w-5 h-5 rounded-md bg-surface-tertiary flex items-center justify-center">
                              <Timer size={11} className="text-text-secondary" />
                            </div>
                            <span className="text-[12px] font-medium text-text-primary">
                              {t.workflows.delay}
                            </span>
                          </button>
                        </div>

                        {/* Actions */}
                        <div className="px-3 pt-2 pb-3">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">
                            {t.automations.actions}
                          </p>
                          <div className="space-y-0.5">
                            {(Object.entries(ACTION_DEFS) as [ActionType, typeof ACTION_DEFS[ActionType]][]).map(([key, def]) => (
                              <button
                                key={key}
                                onClick={() => addNodeToCanvas('action', key)}
                                className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-secondary transition-colors flex items-center gap-2"
                              >
                                <div className="w-5 h-5 rounded-md bg-surface-tertiary flex items-center justify-center">
                                  <Play size={10} className="text-text-secondary" />
                                </div>
                                <span className="text-[12px] text-text-primary">
                                  {fr ? def.labelFr : def.label}
                                </span>
                                {key === 'trigger_n8n' && (
                                  <span className="ml-auto text-[9px] font-semibold text-text-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded">n8n</span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Execute */}
                <button
                  onClick={handleExecute}
                  disabled={executing}
                  className="bg-surface/90 backdrop-blur-sm border border-outline shadow-sm rounded-lg px-3 py-1.5 text-[12px] font-medium text-text-primary hover:border-text-tertiary transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {executing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                  {t.workflows.test}
                </button>

                {/* Status toggle */}
                {selectedWf.status === 'draft' && (
                  <button
                    onClick={() => setStatus(selectedWf, 'published')}
                    className="bg-text-primary hover:bg-text-primary/90 text-surface shadow-sm rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors flex items-center gap-1.5"
                  >
                    <Zap size={12} />
                    {t.workflows.publish}
                  </button>
                )}
                {selectedWf.status === 'published' && (
                  <button
                    onClick={() => setStatus(selectedWf, 'paused')}
                    className="bg-text-secondary hover:bg-text-secondary/90 text-surface shadow-sm rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors flex items-center gap-1.5"
                  >
                    {t.workflows.pause}
                  </button>
                )}
                {selectedWf.status === 'paused' && (
                  <button
                    onClick={() => setStatus(selectedWf, 'published')}
                    className="bg-text-primary hover:bg-text-primary/90 text-surface shadow-sm rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors flex items-center gap-1.5"
                  >
                    <Play size={12} />
                    {t.workflows.resume}
                  </button>
                )}
              </div>
            </div>

            {/* React Flow canvas */}
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onEdgesDelete={onEdgesDelete}
              onNodesDelete={onNodesDelete}
              onNodeDragStop={onNodeDragStop}
              onNodeClick={onNodeClick}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.3 }}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{
                type: 'smoothstep',
                style: { stroke: 'var(--color-outline)', strokeWidth: 1.5 },
              }}
              className="workflow-canvas"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1}
                color="var(--color-text-tertiary)"
                style={{ opacity: 0.15 }}
              />
              <Controls
                showInteractive={false}
                className="!bg-surface !border !border-outline !rounded-lg !shadow-sm"
              />
              <MiniMap
                nodeStrokeWidth={2}
                className="!bg-surface !border !border-outline !rounded-lg !shadow-sm"
                maskColor="rgba(0,0,0,0.06)"
                style={{ width: 120, height: 80 }}
              />
            </ReactFlow>
          </>
        )}
      </div>

      {/* ═══ RIGHT PANEL ═══ */}
      {showNodeEditor ? (
        <NodeEditor
          node={selectedNode}
          onUpdate={handleNodeUpdate}
          onDelete={handleNodeDelete}
          onClose={() => setSelectedNode(null)}
          fr={fr}
        />
      ) : (
        <div className="w-[280px] shrink-0 border-l border-outline bg-surface flex flex-col">
          <div className="px-4 py-3 border-b border-outline flex items-center justify-between">
            <h3 className="text-[13px] font-bold text-text-primary flex items-center gap-1.5">
              <Clock size={13} className="text-text-secondary" />
              {t.workflows.runHistory}
            </h3>
            {runs.length > 0 && (
              <span className="text-[10px] font-medium text-text-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded">
                {runs.length}
              </span>
            )}
          </div>

          {!selectedWf ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[11px] text-text-tertiary">{t.workflows.selectAWorkflow}</p>
            </div>
          ) : selectedRun ? (
            <div className="flex-1 overflow-y-auto">
              <button
                onClick={() => { setSelectedRun(null); setRunLogs([]); }}
                className="px-4 py-2 text-[11px] text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors"
              >
                <ChevronRight size={11} className="rotate-180" />
                {t.companySettings.back}
              </button>
              <div className="px-4 pb-2">
                <div className="flex items-center gap-2 mb-2">
                  <RunStatusBadge status={selectedRun.status} />
                  {selectedRun.duration_ms != null && (
                    <span className="text-[10px] text-text-tertiary">{selectedRun.duration_ms}ms</span>
                  )}
                </div>
                <p className="text-[10px] text-text-tertiary">
                  {new Date(selectedRun.started_at).toLocaleString()}
                </p>
                {selectedRun.error_msg && (
                  <div className="mt-2 text-[11px] text-danger bg-danger/5 border border-danger/10 rounded-lg px-3 py-2">
                    {selectedRun.error_msg}
                  </div>
                )}
              </div>

              <div className="px-4 py-2 border-t border-outline">
                <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-2">
                  {t.workflows.logs}
                </p>
                <div className="space-y-1.5">
                  {runLogs.map((log) => (
                    <div key={log.id} className="flex items-start gap-2">
                      <div className={cn(
                        'w-1.5 h-1.5 rounded-full mt-1.5 shrink-0',
                        log.level === 'error' ? 'bg-danger' : log.level === 'warn' ? 'bg-warning' : 'bg-text-tertiary'
                      )} />
                      <div className="min-w-0">
                        <p className="text-[11px] text-text-primary leading-tight">{log.message}</p>
                        <p className="text-[9px] text-text-tertiary mt-0.5">
                          {new Date(log.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  ))}
                  {runLogs.length === 0 && (
                    <p className="text-[11px] text-text-tertiary">{t.workflows.noLogs}</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {runs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full px-4">
                  <Clock size={20} className="text-text-tertiary mb-2 opacity-30" />
                  <p className="text-[11px] text-text-tertiary text-center">
                    {t.workflows.noRunsYet}
                  </p>
                  <p className="text-[10px] text-text-tertiary text-center mt-1 opacity-60">
                    {t.workflows.testYourWorkflowToSeeResultsHere}
                  </p>
                </div>
              ) : (
                <div className="py-1">
                  {runs.map((run, i) => (
                    <button
                      key={run.id}
                      onClick={() => viewRunLogs(run)}
                      className="w-full text-left px-4 py-2.5 hover:bg-surface-secondary transition-colors border-b border-outline/30"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-text-primary">
                          Run #{runs.length - i}
                        </span>
                        <RunStatusBadge status={run.status} />
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-text-tertiary">
                        {run.duration_ms != null && (
                          <span className="flex items-center gap-0.5">
                            <Clock size={9} /> {run.duration_ms}ms
                          </span>
                        )}
                        <span>{run.nodes_executed} {t.workflows.nodes}</span>
                        <span className="ml-auto">{formatTimeAgo(run.started_at)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Overview stats */}
          {selectedWf && !selectedRun && runs.length > 0 && (
            <div className="px-4 py-3 border-t border-outline">
              <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-2">
                {t.workflows.overview}
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[16px] font-bold text-text-primary tabular-nums">{runs.length}</p>
                  <p className="text-[9px] text-text-tertiary">{t.billing.total}</p>
                </div>
                <div>
                  <p className="text-[16px] font-bold text-text-primary tabular-nums">{runs.filter((r) => r.status === 'completed').length}</p>
                  <p className="text-[9px] text-text-tertiary">{t.workflows.ok}</p>
                </div>
                <div>
                  <p className="text-[16px] font-bold text-danger tabular-nums">{runs.filter((r) => r.status === 'failed').length}</p>
                  <p className="text-[9px] text-text-tertiary">{t.workflows.failed}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ PRESET LIBRARY MODAL ═══ */}
      <PresetLibrary
        open={showPresets}
        onClose={() => setShowPresets(false)}
        onSelect={handleClonePreset}
        fr={fr}
      />
    </div>
  );
}

// ── Helper components ──

function RunStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    running: 'bg-badge-info/10 text-badge-info',
    completed: 'bg-badge-success/10 text-badge-success',
    failed: 'bg-badge-danger/10 text-badge-danger',
    cancelled: 'bg-surface-tertiary text-text-tertiary',
  };

  const icons: Record<string, typeof Check> = {
    running: Loader2,
    completed: Check,
    failed: AlertCircle,
    cancelled: X,
  };

  const Icon = icons[status] || Clock;

  return (
    <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1', styles[status])}>
      <Icon size={9} className={status === 'running' ? 'animate-spin' : ''} />
      {status === 'running' ? 'Running' : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
