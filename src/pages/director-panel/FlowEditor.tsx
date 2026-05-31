import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  BackgroundVariant,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
  type OnConnect,
  type NodeChange,
  type EdgeChange,
  type IsValidConnection,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Save,
  Play,
  Copy,
  Layout,
  Link2,
  Coins,
  Undo,
  Redo,
  Maximize,
  ChevronLeft,
  PanelLeftOpen,
  PanelRightOpen,
  ChevronUp,
  Loader2,
  Check,
  X,
  Upload,
  Square,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import ErrorBoundary from '../../components/ErrorBoundary';
import { useFlowEditorStore } from '../../lib/director-panel/store';
import { getNodeDef } from '../../lib/director-panel/config/node-registry';
import {
  estimateGraphCost,
  validateGraph,
  canConnect,
  executeGraph,
} from '../../lib/director-panel/engine/graph-engine';
import type { DirectorNode, DirectorEdge } from '../../types/director';

// Lazy load heavy components
const NodeLibrary = React.lazy(() => import('../../components/director-panel/library/NodeLibrary'));
const InspectorPanel = React.lazy(() => import('../../components/director-panel/inspector/InspectorPanel'));
const OutputPanel = React.lazy(() => import('../../components/director-panel/output/OutputPanel'));

import OnboardingTour from '../../components/director-panel/onboarding/OnboardingTour';
import { EDITOR_TOUR_KEY, EDITOR_TOUR_STEPS } from '../../components/director-panel/onboarding/tours';

// ---- Helpers ----------------------------------------------------------------

function generateId() {
  return crypto.randomUUID();
}

function directorNodeToRFNode(node: DirectorNode): RFNode {
  return {
    id: node.id,
    type: node.type,
    position: { x: node.position_x, y: node.position_y },
    data: { ...node.data_json, title: node.title, nodeId: node.id },
    style: node.width ? { width: node.width, height: node.height ?? undefined } : undefined,
    zIndex: node.z_index,
  };
}

function rfNodeToDirectorNode(
  rfNode: RFNode,
  flowId: string,
  orgId: string,
  existing?: DirectorNode
): DirectorNode {
  const def = getNodeDef(rfNode.type || 'prompt');
  return {
    id: rfNode.id,
    flow_id: flowId,
    org_id: orgId,
    type: rfNode.type || 'prompt',
    category: def?.category || 'quick_access',
    title: (rfNode.data as any)?.title || def?.displayName || rfNode.type || 'Node',
    position_x: rfNode.position.x,
    position_y: rfNode.position.y,
    width: rfNode.measured?.width ?? existing?.width ?? null,
    height: rfNode.measured?.height ?? existing?.height ?? null,
    z_index: rfNode.zIndex ?? 0,
    data_json: rfNode.data as Record<string, any>,
    ui_json: existing?.ui_json || {},
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function rfEdgeToDirectorEdge(
  rfEdge: RFEdge,
  flowId: string,
  orgId: string
): DirectorEdge {
  return {
    id: rfEdge.id,
    flow_id: flowId,
    org_id: orgId,
    source_node_id: rfEdge.source,
    target_node_id: rfEdge.target,
    source_handle: rfEdge.sourceHandle || '',
    target_handle: rfEdge.targetHandle || '',
    label: (rfEdge.label as string) ?? undefined,
    edge_type: rfEdge.animated ? 'animated' : 'default',
    data_json: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function directorEdgeToRFEdge(edge: DirectorEdge): RFEdge {
  return {
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    sourceHandle: edge.source_handle,
    targetHandle: edge.target_handle,
    label: edge.label ?? undefined,
    type: edge.edge_type === 'animated' ? 'smoothstep' : 'default',
    animated: edge.edge_type === 'animated',
    style: { stroke: '#c084fc', strokeWidth: 2 },
  };
}

// ---- Auto-save debounce delay (ms) -----------------------------------------

const AUTOSAVE_DELAY = 3000;

// ---- Flow Editor Inner (needs ReactFlowProvider) ----------------------------

function FlowEditorInner() {
  const { t } = useTranslation();
  const { flowId } = useParams<{ flowId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, deleteElements, fitView: rfFitView } = useReactFlow();

  const store = useFlowEditorStore();

  // Reset store on unmount so stale data doesn't leak between flows
  useEffect(() => {
    return () => {
      store.resetEditor();
    };
  }, []);

  const [rfNodes, setRFNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRFEdges, onEdgesChange] = useEdgesState([]);
  const [flowTitle, setFlowTitle] = useState(t.directorPanel.untitledFlow);
  const [saving, setSaving] = useState(false);
  const [creditEstimate, setCreditEstimate] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Auto-save timer ref
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Undo/Redo history
  const historyRef = useRef<{ nodes: typeof rfNodes; edges: typeof rfEdges }[]>([]);
  const historyIndexRef = useRef(-1);
  const isUndoRedoRef = useRef(false);
  const MAX_HISTORY = 50;

  const pushHistory = () => {
    if (isUndoRedoRef.current) return;
    const next = historyRef.current.slice(0, historyIndexRef.current + 1);
    next.push({ nodes: structuredClone(rfNodes), edges: structuredClone(rfEdges) });
    if (next.length > MAX_HISTORY) next.shift();
    historyRef.current = next;
    historyIndexRef.current = next.length - 1;
  };

  const handleUndo = () => {
    if (historyIndexRef.current <= 0) return;
    // Save current state first if at end
    if (historyIndexRef.current === historyRef.current.length - 1) {
      historyRef.current.push({ nodes: structuredClone(rfNodes), edges: structuredClone(rfEdges) });
    }
    historyIndexRef.current--;
    const entry = historyRef.current[historyIndexRef.current];
    isUndoRedoRef.current = true;
    setRFNodes(entry.nodes);
    setRFEdges(entry.edges);
    store.markDirty();
    setTimeout(() => { isUndoRedoRef.current = false; }, 50);
  };

  const handleRedo = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current++;
    const entry = historyRef.current[historyIndexRef.current];
    isUndoRedoRef.current = true;
    setRFNodes(entry.nodes);
    setRFEdges(entry.edges);
    store.markDirty();
    setTimeout(() => { isUndoRedoRef.current = false; }, 50);
  };

  // Lazy-load node types
  const [nodeTypes, setNodeTypes] = useState<any>(null);
  const [nodeTypesReady, setNodeTypesReady] = useState(false);
  useEffect(() => {
    import('../../components/director-panel/nodes').then((mod) => {
      setNodeTypes(mod.nodeTypes);
      setNodeTypesReady(true);
    });
  }, []);

  // Load flow data — wait for nodeTypes to be ready
  useEffect(() => {
    const templateId = searchParams.get('template');
    const inputsParam = searchParams.get('inputs');

    if (!nodeTypesReady) return; // Wait for node types

    if (templateId) {
      // Load from template
      import('../../lib/director-panel/config/templates').then(({ BUILT_IN_TEMPLATES }) => {
        const tpl = BUILT_IN_TEMPLATES.find((t) => t.id === templateId);
        if (!tpl) return;

        // Parse pre-filled inputs from AI assistant (if any)
        let prefilled: Record<string, string> = {};
        if (inputsParam) {
          try { prefilled = JSON.parse(decodeURIComponent(inputsParam)); } catch {}
        }

        setFlowTitle(tpl.title);
        const newFlowId = flowId === 'new' ? generateId() : flowId!;

        // Create nodes with real IDs + apply pre-filled inputs
        const nodeIdMap = new Map<string, string>();
        const nodes: RFNode[] = tpl.nodes.map((n, i) => {
          const id = generateId();
          nodeIdMap.set(`__node_${i}`, id);

          // Apply pre-filled data from AI to matching nodes
          let nodeData: Record<string, any> = { ...n.data_json, title: n.title };
          if (Object.keys(prefilled).length > 0 && n.type === 'prompt') {
            const title = (n.title || '').toLowerCase();
            if (title.includes('scene') && prefilled.scene_description) {
              nodeData = { ...nodeData, text: prefilled.scene_description };
            } else if (title.includes('face') && prefilled.face_description) {
              nodeData = { ...nodeData, text: prefilled.face_description };
            } else if (title.includes('dialogue') && prefilled.dialogue_instruction) {
              nodeData = { ...nodeData, text: prefilled.dialogue_instruction };
            } else if ((title.includes('vo') || title.includes('camera')) && prefilled.vo_direction) {
              nodeData = { ...nodeData, text: prefilled.vo_direction };
            }
          }

          return {
            id,
            type: n.type,
            position: { x: n.position_x, y: n.position_y },
            data: nodeData,
          };
        });

        const edges: RFEdge[] = tpl.edges.map((e) => ({
          id: generateId(),
          source: nodeIdMap.get(e.source_node_id) || '',
          target: nodeIdMap.get(e.target_node_id) || '',
          sourceHandle: e.source_handle,
          targetHandle: e.target_handle,
          type: 'default',
          style: { stroke: '#c084fc', strokeWidth: 2 },
        }));

        setRFNodes(nodes);
        setRFEdges(edges);
        store.markDirty();

        // Fit view after a tick so React Flow renders first
        setTimeout(() => {
          try { rfFitView({ padding: 0.15 }); } catch {}
        }, 200);
      });
    } else if (flowId && flowId !== 'new') {
      // Load existing flow
      Promise.all([
        import('../../lib/directorApi').then((m) => m.getFlow(flowId)),
        import('../../lib/directorApi').then((m) => m.getFlowNodes(flowId)),
        import('../../lib/directorApi').then((m) => m.getFlowEdges(flowId)),
      ])
        .then(([flow, nodes, edges]) => {
          store.setFlow(flow);
          store.setNodes(nodes);
          store.setEdges(edges);
          setFlowTitle(flow.title);
          setRFNodes(nodes.map(directorNodeToRFNode));
          setRFEdges(edges.map(directorEdgeToRFEdge));
        })
        .catch((err) => {
          // DB not set up yet - start empty
          setFlowTitle(t.directorPanel.untitledFlow);
          toast.error(err?.message || t.directorPanel.failedToLoadFlow);
        });
    }
  }, [flowId, searchParams, nodeTypesReady]);

  // Update credit estimate when nodes change
  useEffect(() => {
    const dirNodes = rfNodes.map((n) =>
      rfNodeToDirectorNode(n, flowId || 'new', '')
    );
    const dirEdges: DirectorEdge[] = rfEdges.map((e) =>
      rfEdgeToDirectorEdge(e, flowId || 'new', '')
    );
    setCreditEstimate(estimateGraphCost(dirNodes, dirEdges));
  }, [rfNodes, rfEdges]);

  // ---- Connection validation ------------------------------------------------

  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      const { source, target, sourceHandle, targetHandle } = connection;

      // Prevent self-connections
      if (source === target) return false;

      // Prevent duplicate connections (same source+handle -> same target+handle)
      const isDuplicate = rfEdges.some(
        (e) =>
          e.source === source &&
          e.target === target &&
          e.sourceHandle === sourceHandle &&
          e.targetHandle === targetHandle
      );
      if (isDuplicate) return false;

      // Look up port kinds from the registry
      const sourceNode = rfNodes.find((n) => n.id === source);
      const targetNode = rfNodes.find((n) => n.id === target);
      if (!sourceNode || !targetNode) return false;

      const sourceDef = getNodeDef(sourceNode.type || '');
      const targetDef = getNodeDef(targetNode.type || '');
      if (!sourceDef || !targetDef) return false;

      const sourcePort = sourceDef.outputs.find((p) => p.id === sourceHandle);
      const targetPort = targetDef.inputs.find((p) => p.id === targetHandle);
      if (!sourcePort || !targetPort) return false;

      return canConnect(sourcePort.kind, targetPort.kind);
    },
    [rfNodes, rfEdges]
  );

  // ---- Connection handler ---------------------------------------------------

  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      pushHistory();
      setRFEdges((eds) => addEdge(params, eds));
      store.markDirty();
    },
    [rfNodes, rfEdges]
  );

  // ---- Add node from library ------------------------------------------------

  const handleAddNode = useCallback(
    (nodeType: string, position?: { x: number; y: number }) => {
      const def = getNodeDef(nodeType);
      if (!def) return;

      const pos = position || screenToFlowPosition({ x: 400, y: 300 });
      const newNode: RFNode = {
        id: generateId(),
        type: nodeType,
        position: pos,
        data: { ...def.defaultData, title: def.displayName },
      };

      pushHistory();
      setRFNodes((nds) => [...nds, newNode]);
      store.markDirty();
    },
    [screenToFlowPosition, rfNodes, rfEdges]
  );

  // ---- Node selection -------------------------------------------------------

  const handleNodeClick = useCallback((_: React.MouseEvent, node: RFNode) => {
    store.selectNode(node.id);
    store.setInspectorOpen(true);
  }, []);

  const handlePaneClick = useCallback(() => {
    store.selectNode(null);
    // Close context menu on pane click
    setContextMenu(null);
  }, []);

  // ---- Save (proper DB persist) ---------------------------------------------

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const orgId = store.flow?.org_id || '';
      let actualFlowId = flowId || 'new';

      if (actualFlowId === 'new') {
        // Create the flow first
        const { createFlow } = await import('../../lib/directorApi');
        const newFlow = await createFlow({
          org_id: orgId,
          title: flowTitle || t.directorPanel.untitledFlow,
          slug: 'untitled-flow',
          description: '',
          status: 'draft',
          created_by: null as any,
          updated_by: null as any,
          version_number: 1,
        });
        actualFlowId = newFlow.id;
        store.setFlow(newFlow);
        // Update URL without reload
        window.history.replaceState(null, '', `/director-panel/flows/${newFlow.id}`);
      }

      const dirNodes = rfNodes.map((n) =>
        rfNodeToDirectorNode(n, actualFlowId, orgId, store.nodes.find((sn) => sn.id === n.id))
      );
      const dirEdges = rfEdges.map((e) =>
        rfEdgeToDirectorEdge(e, actualFlowId, orgId)
      );

      const { saveFlowGraph, updateFlow } = await import('../../lib/directorApi');
      await saveFlowGraph(actualFlowId, dirNodes, dirEdges);
      // Save flow title if changed
      if (flowTitle) {
        await updateFlow(actualFlowId, { title: flowTitle }).catch(() => {});
      }

      store.setNodes(dirNodes);
      store.setEdges(dirEdges);
      store.markClean();
      toast.success(t.directorPanel.flowSaved);
    } catch (err: any) {
      console.error('Save failed:', err);
      toast.error(err?.message || t.directorPanel.failedToSaveFlow);
    } finally {
      setSaving(false);
    }
  }, [rfNodes, rfEdges, flowId, saving, store.flow?.org_id, store.nodes]);

  // ---- Auto-save with debounce ----------------------------------------------

  useEffect(() => {
    if (!store.isDirty) return;
    if (flowId === 'new') return; // Don't auto-save until the flow has been persisted once

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      handleSave();
    }, AUTOSAVE_DELAY);

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [store.isDirty, rfNodes, rfEdges, flowId, handleSave]);

  // ---- Run flow -------------------------------------------------------------

  const handleRun = useCallback(async () => {
    const orgId = store.flow?.org_id || '';
    const fid = flowId || 'new';

    const dirNodes = rfNodes.map((n) =>
      rfNodeToDirectorNode(n, fid, orgId)
    );
    const dirEdges: DirectorEdge[] = rfEdges.map((e) =>
      rfEdgeToDirectorEdge(e, fid, orgId)
    );

    // Validation errors check
    const validationErrors = validateGraph(dirNodes, dirEdges);
    const criticalErrors = validationErrors.filter((e) => e.severity === 'error');
    if (criticalErrors.length > 0) {
      criticalErrors.forEach((e) => toast.error(e.message));
      return;
    }
    const warnings = validationErrors.filter((e) => e.severity === 'warning');
    if (warnings.length > 0) {
      warnings.forEach((e) => toast.warning(e.message));
    }

    // Credit balance check
    if (orgId) {
      try {
        const { getCreditBalance } = await import('../../lib/directorApi');
        const balance = await getCreditBalance(orgId);
        if (balance && creditEstimate > balance.credits_balance) {
          toast.error(
            `Insufficient credits: estimated cost ~${creditEstimate} exceeds balance of ${balance.credits_balance}`
          );
          return;
        }
      } catch (creditErr: any) {
        console.warn('[director] Credit check failed, proceeding:', creditErr?.message);
        toast.warning(t.directorPanel.creditCheckUnavailable);
      }
    }

    store.resetRun();
    store.resetNodeStates();
    store.setRunState({ status: 'running', runId: generateId() });
    store.setOutputPanelTab('logs');
    if (!store.outputPanelOpen) store.toggleOutputPanel();

    const controller = new AbortController();
    setAbortController(controller);

    const result = await executeGraph(dirNodes, dirEdges, {
      onLog: (entry) => store.addLog(entry),
      onNodeStart: (nodeId) => {
        store.setNodeState(nodeId, 'running');
        store.setRunState({ currentNodeId: nodeId });
      },
      onNodeComplete: (nodeId, outputs) => {
        store.setNodeState(nodeId, 'completed');
        store.setRunState({ currentNodeId: null });
        // Update node preview with generated output
        setRFNodes((nds) =>
          nds.map((n) => {
            if (n.id !== nodeId) return n;
            const url = outputs.image || outputs.video || outputs.output || outputs.mask;
            if (!url) return n;
            return {
              ...n,
              data: {
                ...n.data,
                ...(url ? { previewUrl: url, previewType: outputs.video ? 'video' : 'image' } : {}),
              },
            };
          })
        );
      },
      onNodeError: (nodeId, error) => {
        store.setNodeState(nodeId, 'error');
        store.addLog({
          timestamp: new Date().toISOString(),
          nodeId,
          level: 'error',
          message: error,
        });
      },
      onOutput: (output) => {
        store.addOutput(output);
        // Persist generation to DB for Recent Generations panel
        if (output.url && store.flow?.org_id) {
          import('../../lib/directorApi').then(({ createGeneration }) => {
            createGeneration({
              org_id: store.flow!.org_id,
              created_by: store.flow!.created_by || null,
              flow_id: flowId === 'new' ? null : flowId || null,
              run_id: store.runState.runId || null,
              node_id: output.metadata?.nodeId || null,
              template_id: null,
              title: store.flow!.title || 'Generation',
              prompt: output.metadata?.prompt || null,
              output_type: output.kind === 'video' ? 'video' : output.kind === 'image' ? 'image' : 'edit',
              output_url: output.url || null,
              thumbnail_url: output.kind === 'image' ? output.url || null : null,
              provider: output.metadata?.provider || null,
              model: output.metadata?.model || null,
              status: 'completed',
              metadata: output.metadata || {},
            }).catch(() => { /* non-blocking */ });
          });
        }
      },
      onProgress: (progress) => store.setRunState({ progress }),
    }, {
      flowId: flowId === 'new' ? undefined : flowId,
      abortSignal: controller.signal,
    });

    setAbortController(null);
    const finalStatus = result.success ? 'completed' : 'failed';
    store.setRunState({
      status: finalStatus,
      costs: { estimated: creditEstimate, actual: result.totalCost },
    });

    // Persist run to DB
    if (flowId && flowId !== 'new' && store.flow?.org_id) {
      import('../../lib/directorApi').then(async ({ createRun }) => {
        try {
          await createRun({
            org_id: store.flow!.org_id,
            flow_id: flowId,
            status: finalStatus,
            triggered_by: store.flow!.created_by || null,
            cost_estimate_credits: creditEstimate,
            cost_actual_credits: result.totalCost,
            provider_cost_actual: 0,
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
            error_json: result.errors.length > 0 ? { errors: result.errors } : null,
            result_summary_json: { outputCount: result.outputs.length },
          });
        } catch { /* non-blocking */ }
      });
    }

    if (result.success) {
      toast.success(t.directorPanel.flowCompletedSuccessfully);
    } else {
      toast.error(`${t.directorPanel.flowFailed}: ${result.errors[0] || 'Unknown error'}`);
    }
  }, [rfNodes, rfEdges, flowId, creditEstimate, store.flow?.org_id]);

  const handleStop = useCallback(() => {
    abortController?.abort();
  }, [abortController]);

  // ---- Drop handler for drag from library -----------------------------------

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData('application/director-node-type');
      if (!nodeType) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      handleAddNode(nodeType, position);
    },
    [screenToFlowPosition, handleAddNode]
  );

  // ---- Context menu ---------------------------------------------------------

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const onPaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, []);

  // Close context menu on Escape
  useEffect(() => {
    if (!contextMenu) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [contextMenu]);

  // ---- Keyboard shortcuts ---------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Ctrl+S -> save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }

      // Ctrl+Enter -> Run
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleRun();
        return;
      }

      // Ctrl+Z -> undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Ctrl+Shift+Z or Ctrl+Y -> redo
      if (((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) || ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // ? -> show shortcuts panel
      if (e.key === '?' && !isInput) {
        setShowShortcuts((p) => !p);
        return;
      }

      // Ctrl+C -> copy selected node
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !isInput) {
        const selectedId = store.selectedNodeId;
        if (selectedId) {
          const node = rfNodes.find((n) => n.id === selectedId);
          if (node) {
            (window as any).__lume_clipboard = structuredClone(node);
            toast.success(t.directorPanel.nodeCopied);
          }
        }
        return;
      }

      // Ctrl+V -> paste copied node
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !isInput) {
        const copied = (window as any).__lume_clipboard;
        if (copied) {
          e.preventDefault();
          pushHistory();
          const newNode = {
            ...copied,
            id: generateId(),
            position: { x: copied.position.x + 50, y: copied.position.y + 50 },
          };
          setRFNodes((nds) => [...nds, newNode]);
          store.markDirty();
          toast.success(t.directorPanel.nodePasted);
        }
        return;
      }

      // Delete -> delete selected node (skip if in input)
      if (e.key === 'Delete' && !isInput) {
        const selectedId = store.selectedNodeId;
        if (selectedId) {
          pushHistory();
          setRFNodes((nds) => nds.filter((n) => n.id !== selectedId));
          setRFEdges((eds) =>
            eds.filter((e) => e.source !== selectedId && e.target !== selectedId)
          );
          store.selectNode(null);
          store.markDirty();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleRun, store.selectedNodeId]);

  // ---- Render ---------------------------------------------------------------

  const runStatus = store.runState.status;

  // ── Animate edges: highlight edges connected to running node ──
  useEffect(() => {
    const currentId = store.runState.currentNodeId;
    const nodeStates = store.runState.nodeStates;
    if (runStatus !== 'running') {
      // Reset edge styles
      setRFEdges((eds) => eds.map((e) => ({
        ...e,
        animated: false,
        style: { stroke: '#c084fc', strokeWidth: 2 },
      })));
      return;
    }

    setRFEdges((eds) =>
      eds.map((e) => {
        const isActive = e.source === currentId || e.target === currentId;
        const isCompleted = nodeStates[e.source] === 'completed' && nodeStates[e.target] === 'completed';
        return {
          ...e,
          animated: isActive,
          style: {
            stroke: isActive ? '#a855f7' : isCompleted ? '#22c55e' : '#c084fc',
            strokeWidth: isActive ? 3 : 2,
            filter: isActive ? 'drop-shadow(0 0 6px rgba(168, 85, 247, 0.6))' : undefined,
          },
        };
      })
    );
  }, [store.runState.currentNodeId, store.runState.nodeStates, runStatus]);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#111]">
      {/* ---- Top Bar ---- */}
      <div className="h-12 flex items-center justify-between px-3 border-b border-[#2a2a2a] bg-[#1a1a1a] shrink-0 z-10">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/director-panel')}
            className="p-1.5 rounded-md hover:bg-[#2a2a2a] text-[#888] hover:text-white transition-colors"
            aria-label="Back to Director Panel"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input
            type="text"
            value={flowTitle}
            onChange={(e) => { setFlowTitle(e.target.value); store.markDirty(); }}
            className="bg-transparent text-sm font-medium text-white border-none outline-none max-w-[200px]"
            placeholder="Flow title..."
          />
          {store.isDirty && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" title="Unsaved" />}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            data-tour="save-button"
            onClick={handleSave}
            disabled={saving}
            aria-label="Save flow"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#2a2a2a] hover:bg-[#333] text-[#e0e0e0] border border-[#333] transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
          {runStatus === 'running' ? (
            <button
              data-tour="run-button"
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
            >
              <Square className="w-3.5 h-3.5" /> Stop
            </button>
          ) : (
            <button
              data-tour="run-button"
              onClick={handleRun}
              aria-label="Run flow"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white transition-colors"
            >
              <Play className="w-3.5 h-3.5" /> Run
            </button>
          )}
          <button onClick={() => {
            const exportData = { title: flowTitle, nodes: rfNodes, edges: rfEdges, exportedAt: new Date().toISOString() };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `${flowTitle || 'flow'}.json`; a.click();
            URL.revokeObjectURL(url);
            toast.success(t.directorPanel.flowExported);
          }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-[#888] hover:bg-[#2a2a2a] transition-colors" title="Export flow JSON" aria-label="Export flow">
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                try {
                  const data = JSON.parse(ev.target?.result as string);
                  if (data.nodes && Array.isArray(data.nodes)) {
                    setRFNodes(data.nodes);
                    setRFEdges(data.edges || []);
                    if (data.title) setFlowTitle(data.title);
                    store.markDirty();
                    toast.success(t.directorPanel.flowImported);
                  } else {
                    toast.error(t.directorPanel.invalidFlowFile);
                  }
                } catch { toast.error(t.directorPanel.failedToParseFlowFile); }
              };
              reader.readAsText(file);
            };
            input.click();
          }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-[#888] hover:bg-[#2a2a2a] transition-colors" title="Import flow JSON" aria-label="Import flow">
            <Upload className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => {
            // Auto-layout: arrange nodes in a grid
            const COLS = 3; const GAP_X = 400; const GAP_Y = 300;
            setRFNodes((nds) => nds.map((n, i) => ({
              ...n, position: { x: (i % COLS) * GAP_X, y: Math.floor(i / COLS) * GAP_Y },
            })));
            store.markDirty();
            setTimeout(() => { try { rfFitView({ padding: 0.15 }); } catch {} }, 100);
            toast.success(t.directorPanel.autoLayoutApplied);
          }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-[#888] hover:bg-[#2a2a2a] transition-colors" title="Auto-layout">
            <Layout className="w-3.5 h-3.5" />
          </button>
          <button onClick={async () => {
            const campaignId = prompt('Enter Campaign ID to link:');
            if (!campaignId?.trim()) return;
            const orgId = store.flow?.org_id;
            const fid = flowId;
            if (!orgId || !fid || fid === 'new') { toast.error(t.directorPanel.saveFlowFirst); return; }
            try {
              const { createFlowLink } = await import('../../lib/directorApi');
              await createFlowLink({ org_id: orgId, flow_id: fid, entity_type: 'campaign', entity_id: campaignId.trim() });
              toast.success(t.directorPanel.flowLinkedToCampaign);
            } catch (err: any) { toast.error(err?.message || t.directorPanel.failedToLinkCampaign); }
          }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-[#888] hover:bg-[#2a2a2a] transition-colors" title="Link to campaign">
            <Link2 className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-[#888] bg-[#1e1e1e] border border-[#2a2a2a]">
            <Coins className="w-3.5 h-3.5 text-yellow-400" />
            ~{creditEstimate}
          </div>
        </div>
      </div>

      {/* ---- Main Area ---- */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Node Library */}
        {store.libraryOpen && (
          <div data-tour="node-library" className="shrink-0 h-full">
            <React.Suspense fallback={<div className="w-[280px] h-full bg-[#1a1a1a]" />}>
              <NodeLibrary
                mode="sidebar"
                onAddNode={handleAddNode}
              />
            </React.Suspense>
          </div>
        )}

        {/* Center: Canvas */}
        <div data-tour="canvas" className="flex-1 relative min-h-0" ref={reactFlowWrapper}>
          {nodeTypes && (
            <ErrorBoundary>
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeClick={handleNodeClick}
              onPaneClick={handlePaneClick}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onPaneContextMenu={onPaneContextMenu}
              nodeTypes={nodeTypes}
              fitView
              snapToGrid
              snapGrid={[16, 16]}
              defaultEdgeOptions={{
                style: { stroke: '#c084fc', strokeWidth: 2 },
                type: 'default',
              }}
              proOptions={{ hideAttribution: true }}
              className="bg-[#111]"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1}
                color="#333"
              />
              <MiniMap
                nodeColor="#2a2a2a"
                maskColor="rgba(0,0,0,0.6)"
                style={{ backgroundColor: '#1a1a1a', borderRadius: 8 }}
              />
            </ReactFlow>
            </ErrorBoundary>
          )}

          {/* Context menu */}
          {contextMenu && (
            <React.Suspense fallback={null}>
              <NodeLibrary
                mode="contextmenu"
                position={contextMenu}
                onAddNode={(type, pos) => {
                  const flowPos = screenToFlowPosition(contextMenu);
                  handleAddNode(type, flowPos);
                  setContextMenu(null);
                }}
                onClose={() => setContextMenu(null)}
              />
            </React.Suspense>
          )}
        </div>

        {/* Right: Inspector */}
        {store.inspectorOpen && (
          <div data-tour="inspector" className="shrink-0 h-full">
            <React.Suspense fallback={<div className="w-[280px] h-full bg-[#1a1a1a]" />}>
              <InspectorPanel />
            </React.Suspense>
          </div>
        )}
      </div>

      {/* ---- Bottom Bar ---- */}
      <div className="shrink-0">
        {/* Output panel (always rendered — it manages its own collapsed/expanded state) */}
        <React.Suspense fallback={<div className="h-[40px] bg-[#1a1a1a]" />}>
          <OutputPanel />
        </React.Suspense>

        {/* Bottom toolbar */}
        <div className="h-9 flex items-center justify-between px-3 border-t border-[#2a2a2a] bg-[#1a1a1a] text-[#888]">
          <div className="flex items-center gap-1">
            <button
              onClick={() => store.toggleLibrary()}
              className="p-1 rounded hover:bg-[#2a2a2a] transition-colors"
              title="Toggle library"
              aria-label="Toggle library panel"
            >
              <PanelLeftOpen className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => store.toggleInspector()}
              className="p-1 rounded hover:bg-[#2a2a2a] transition-colors"
              title="Toggle inspector"
              aria-label="Toggle inspector panel"
            >
              <PanelRightOpen className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => store.toggleOutputPanel()}
              className="p-1 rounded hover:bg-[#2a2a2a] transition-colors"
              title="Toggle output"
              aria-label="Toggle output panel"
            >
              <ChevronUp className={cn('w-3.5 h-3.5 transition-transform', store.outputPanelOpen && 'rotate-180')} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* Run status */}
            <div className="flex items-center gap-1.5 text-xs">
              {runStatus === 'running' && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
              {runStatus === 'completed' && <Check className="w-3 h-3 text-green-400" />}
              {runStatus === 'failed' && <X className="w-3 h-3 text-red-400" />}
              <span className="capitalize">{runStatus}</span>
              {runStatus === 'running' && (
                <span className="text-[10px] text-[#666]">{Math.round(store.runState.progress)}%</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button onClick={handleUndo} className="p-1 rounded hover:bg-[#2a2a2a] transition-colors" title="Undo (Ctrl+Z)">
              <Undo className="w-3.5 h-3.5" />
            </button>
            <button onClick={handleRedo} className="p-1 rounded hover:bg-[#2a2a2a] transition-colors" title="Redo (Ctrl+Shift+Z)">
              <Redo className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => { try { rfFitView({ padding: 0.15 }); } catch {} }} className="p-1 rounded hover:bg-[#2a2a2a] transition-colors" title="Fit view">
              <Maximize className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] text-[#666] ml-1">{Math.round(store.zoom * 100)}%</span>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts */}
      {showShortcuts && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={() => setShowShortcuts(false)}>
          <div className="w-full max-w-sm rounded-xl bg-[#222] border border-[#444] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[14px] font-semibold text-white mb-4">Keyboard Shortcuts</h3>
            <div className="space-y-2 text-[12px]">
              {[
                ['Ctrl+S', 'Save flow'],
                ['Ctrl+Enter', 'Run flow'],
                ['Ctrl+Z', 'Undo'],
                ['Ctrl+Shift+Z', 'Redo'],
                ['Ctrl+C', 'Copy selected node'],
                ['Ctrl+V', 'Paste node'],
                ['Delete', 'Delete selected node'],
                ['?', 'Toggle this panel'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-[#aaa]">{desc}</span>
                  <kbd className="px-2 py-0.5 rounded bg-[#333] text-[#ddd] font-mono text-[11px]">{key}</kbd>
                </div>
              ))}
            </div>
            <button onClick={() => setShowShortcuts(false)} className="mt-4 w-full py-2 rounded-lg bg-[#333] text-[12px] text-[#ccc] hover:bg-[#444] transition-colors">Close</button>
          </div>
        </div>
      )}

      {/* Onboarding Tour */}
      <OnboardingTour steps={EDITOR_TOUR_STEPS} tourKey={EDITOR_TOUR_KEY} />
    </div>
  );
}

// ---- Wrapper with Provider --------------------------------------------------

export default function FlowEditor() {
  return (
    <ReactFlowProvider>
      <FlowEditorInner />
    </ReactFlowProvider>
  );
}
