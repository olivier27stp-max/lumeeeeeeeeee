/* ═══════════════════════════════════════════════════════════════
   Page — Note Canvas (Infinite collaborative canvas)
   Uses React Flow (@xyflow/react) for the canvas engine.

   Interaction model:
   - Empty canvas drag → pan
   - Click node → select
   - Double-click node → edit content
   - Drag node → move (5px threshold)
   - Mouse wheel → zoom
   - Editing mode disables drag on that node via noDragClassName
   - Overlays use pointer-events:none passthrough
   - Right-click → context menu
   - Drawing tools overlay
   - Live cursors + presence
   - Comments, voting, presentation mode
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type OnConnect,
  type NodeChange,
  type EdgeChange,
  type Connection,
  BackgroundVariant,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Make selected edges visible with a thicker stroke
const edgeSelectedStyles = `
  .react-flow__edge.selected .react-flow__edge-path {
    stroke: #3b82f6 !important;
    stroke-width: 3 !important;
  }
  .react-flow__edge {
    cursor: pointer;
  }
  .react-flow__edge-path {
    stroke-width: 2;
  }
`;

import { ArrowLeft, Pencil, MessageCircle, ThumbsUp, Play, Pen } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import {
  fetchBoard, fetchBoardItems, fetchBoardConnections,
  createItem, updateItem, deleteItem,
  createConnection, deleteConnection, updateBoard, subscribeToBoardChanges,
  uploadNoteFile, linkEntity, unlinkEntity,
  fetchBoardComments, createBoardComment, resolveBoardComment, deleteBoardComment,
  fetchBoardVotes, castVote, removeVote, clearBoardVotes,
  subscribeToBoardPresence,
  fetchBoardDrawings, createBoardDrawing, deleteBoardDrawing,
} from '../lib/noteBoardsApi';
import { supabase } from '../lib/supabase';
import type { NoteBoard, NoteItem, NoteConnection, NoteItemType, ShapeType, EntityType, ChecklistItem } from '../types/noteBoard';
import StickyNoteNode from '../components/notes/StickyNoteNode';
import TextNode from '../components/notes/TextNode';
import ChecklistNode from '../components/notes/ChecklistNode';
import ShapeNode from '../components/notes/ShapeNode';
import ImageNode from '../components/notes/ImageNode';
import LinkNode from '../components/notes/LinkNode';
import FrameNode from '../components/notes/FrameNode';
import CanvasToolbar, { type ToolType } from '../components/notes/CanvasToolbar';
import InspectorPanel from '../components/notes/InspectorPanel';
import CanvasContextMenu from '../components/notes/CanvasContextMenu';
import DrawingCanvas, { type DrawPath, type DrawTool } from '../components/notes/DrawingCanvas';
import LiveCursors, { type CursorState, getUserColor } from '../components/notes/LiveCursors';
import PresenceBar, { type PresenceUser } from '../components/notes/PresenceBar';
import CommentsPanel, { type BoardComment } from '../components/notes/CommentsPanel';
import VotingPanel, { type Vote } from '../components/notes/VotingPanel';
import PresentationMode from '../components/notes/PresentationMode';
import { Skeleton } from '../components/ui';

// ─── Node type mapping (static — never recreated) ──────────────
const nodeTypes = {
  sticky_note: StickyNoteNode,
  text: TextNode,
  checklist: ChecklistNode,
  shape: ShapeNode,
  image: ImageNode,
  file: ImageNode,
  link: LinkNode,
  section_header: TextNode,
  diagram_block: ShapeNode,
  frame: FrameNode,
};

// ─── Convert DB connection → React Flow edge ───────────────────
function connectionToEdge(conn: NoteConnection): Edge {
  const color = conn.color || '#6b7280';
  return {
    id: conn.id,
    source: conn.source_id,
    target: conn.target_id,
    type: conn.line_type === 'straight' ? 'straight' : conn.line_type === 'step' ? 'step' : conn.line_type === 'smoothstep' ? 'smoothstep' : 'default',
    label: conn.label || undefined,
    animated: conn.animated,
    style: { stroke: color, strokeWidth: conn.stroke_width || 2 },
    markerEnd: conn.arrow_end !== false ? { type: MarkerType.ArrowClosed, color } : undefined,
    markerStart: conn.arrow_start ? { type: MarkerType.ArrowClosed, color } : undefined,
    selectable: true,
    data: { connectionId: conn.id },
  };
}

// ─── Inner canvas component ────────────────────────────────────
function CanvasInner() {
  const { id: boardId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const { fitView, zoomIn, zoomOut, getViewport, screenToFlowPosition, setViewport } = useReactFlow();

  // ─── Persisted state ───────────────────────────────────────
  const [board, setBoard] = useState<NoteBoard | null>(null);
  const [items, setItems] = useState<NoteItem[]>([]);
  const [connections, setConnections] = useState<NoteConnection[]>([]);
  const [loading, setLoading] = useState(true);

  // ─── Transient UI state ────────────────────────────────────
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');

  // ─── Context menu ──────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(null);

  // ─── Drawing ───────────────────────────────────────────────
  const [drawTool, setDrawTool] = useState<DrawTool>('pen');
  const [drawColor, setDrawColor] = useState('#000000');
  const [drawStrokeWidth, setDrawStrokeWidth] = useState(3);
  const [drawPaths, setDrawPaths] = useState<DrawPath[]>([]);
  const isDrawing = activeTool === 'draw';

  // ─── Comments ──────────────────────────────────────────────
  const [comments, setComments] = useState<BoardComment[]>([]);
  const [showComments, setShowComments] = useState(false);

  // ─── Voting ────────────────────────────────────────────────
  const [votes, setVotes] = useState<Vote[]>([]);
  const [showVoting, setShowVoting] = useState(false);
  const [votingActive, setVotingActive] = useState(false);
  const [votingMaxVotes, setVotingMaxVotes] = useState(3);
  const [votingAnonymous, setVotingAnonymous] = useState(false);
  const [votingTimerSeconds, setVotingTimerSeconds] = useState(120);
  const [votingTimerRunning, setVotingTimerRunning] = useState(false);

  // ─── Presentation ──────────────────────────────────────────
  const [presenting, setPresenting] = useState(false);
  const [presentIndex, setPresentIndex] = useState(0);

  // ─── Presence / cursors ────────────────────────────────────
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [cursors, setCursors] = useState<CursorState[]>([]);
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string } | null>(null);
  const broadcastCursorRef = useRef<((x: number, y: number) => void) | null>(null);

  // ─── Clipboard ─────────────────────────────────────────────
  const clipboardRef = useRef<NoteItem | null>(null);

  // ─── React Flow state (managed separately) ─────────────────
  const [nodes, setNodes] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileType = useRef<'image' | 'file'>('image');
  const saveViewportTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const initialLoadDone = useRef(false);
  const recentLocalUpdates = useRef<Set<string>>(new Set());

  const selectedItem = useMemo(() =>
    items.find((i) => i.id === selectedItemId) || null
  , [items, selectedItemId]);

  // ─── Get current user ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUser({ id: user.id, name: user.email?.split('@')[0] || 'User' });
      }
    })();
  }, []);

  // ─── Stable callbacks for node data ────────────────────────
  const markLocalUpdate = useCallback((itemId: string) => {
    recentLocalUpdates.current.add(itemId);
    setTimeout(() => recentLocalUpdates.current.delete(itemId), 3000);
  }, []);

  const onContentChange = useCallback((itemId: string, content: string) => {
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, content } : i));
    setNodes((nds) => nds.map((n) =>
      n.id === itemId ? { ...n, data: { ...n.data, content } } : n
    ));
    markLocalUpdate(itemId);
    updateItem(itemId, { content }).catch((e: any) => { console.error('[canvas]', e?.message); toast.error('Failed to save note'); });
  }, [setNodes, markLocalUpdate]);

  const onChecklistChange = useCallback((itemId: string, checklist: ChecklistItem[]) => {
    setItems((prev) => prev.map((i) =>
      i.id === itemId ? { ...i, rich_content: { ...i.rich_content, checklist } } : i
    ));
    setNodes((nds) => nds.map((n) =>
      n.id === itemId ? { ...n, data: { ...n.data, checklist } } : n
    ));
    markLocalUpdate(itemId);
    updateItem(itemId, { rich_content: { checklist } }).catch((e: any) => { console.error('[canvas]', e?.message); });
  }, [setNodes, markLocalUpdate]);

  const callbacksRef = useRef({ onContentChange, onChecklistChange });
  callbacksRef.current = { onContentChange, onChecklistChange };

  const connectMode = activeTool === 'connector';
  const connectModeRef = useRef(connectMode);
  connectModeRef.current = connectMode;

  // ─── Build a single node from a NoteItem ───────────────────
  const buildNode = useCallback((item: NoteItem, isConnectMode = false): Node => ({
    id: item.id,
    type: item.item_type,
    position: { x: item.pos_x, y: item.pos_y },
    style: {
      width: item.width,
      height: item.height || undefined,
      ...(item.rotation ? { transform: `rotate(${item.rotation}deg)` } : {}),
    },
    draggable: !item.locked,
    data: {
      itemId: item.id,
      content: item.content || '',
      color: item.color,
      fontSize: item.font_size,
      textAlign: item.text_align,
      locked: item.locked,
      shapeType: item.shape_type,
      borderStyle: item.border_style,
      fileUrl: item.file_url,
      fileName: item.file_name,
      fileType: item.file_type,
      fileSize: item.file_size,
      linkUrl: item.link_url || '',
      linkTitle: item.link_title,
      linkPreview: item.link_preview,
      checklist: item.rich_content?.checklist || [],
      isFile: item.item_type === 'file',
      entityLinks: item.entity_links || [],
      connectMode: isConnectMode,
      onContentChange: callbacksRef.current.onContentChange,
      onChecklistChange: callbacksRef.current.onChecklistChange,
    },
  }), []);

  // ─── When connect-mode toggles, update nodes ──────────────
  const prevConnectMode = useRef(false);
  useEffect(() => {
    if (prevConnectMode.current === connectMode) return;
    prevConnectMode.current = connectMode;
    setNodes((nds) => nds.map((n) => ({
      ...n,
      data: { ...n.data, connectMode },
    })));
  }, [connectMode, setNodes]);

  // ─── Load board data ───────────────────────────────────────
  useEffect(() => {
    if (!boardId) return;
    (async () => {
      try {
        const [b, its, conns] = await Promise.all([
          fetchBoard(boardId),
          fetchBoardItems(boardId),
          fetchBoardConnections(boardId),
        ]);
        setBoard(b);
        setTitleValue(b.title);
        setItems(its);
        setConnections(conns);
        setNodes(its.map((i) => buildNode(i)));
        setEdges(conns.map(connectionToEdge));

        // Load comments, votes, drawings in parallel (non-blocking)
        Promise.all([
          fetchBoardComments(boardId).then(setComments).catch(() => {}),
          fetchBoardVotes(boardId).then((v) => setVotes(v.map((vv: any) => ({
            itemId: vv.item_id, userId: vv.user_id, userName: vv.user_name,
          })))).catch(() => {}),
          fetchBoardDrawings(boardId).then((d) => setDrawPaths(d.map((dd: any) => ({
            id: dd.id, d: dd.path_data, color: dd.color,
            strokeWidth: dd.stroke_width, opacity: dd.opacity, tool: dd.tool,
          })))).catch(() => {}),
        ]);
      } catch (err) {
        toast.error('Failed to load board');
        navigate('/notes');
      } finally {
        setLoading(false);
      }
    })();
  }, [boardId, navigate, buildNode, setNodes, setEdges]);

  // ─── Fit view ONCE after initial load ──────────────────────
  useEffect(() => {
    if (!loading && !initialLoadDone.current && items.length > 0) {
      initialLoadDone.current = true;
      setTimeout(() => fitView({ padding: 0.2 }), 150);
    }
  }, [loading, items.length, fitView]);

  // ─── Realtime subscription ─────────────────────────────────
  useEffect(() => {
    if (!boardId) return;
    const unsub = subscribeToBoardChanges(
      boardId,
      (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload;
        if (eventType === 'INSERT') {
          const newItem = newRow as NoteItem;
          setItems((prev) => {
            if (prev.find((i) => i.id === newItem.id)) return prev;
            return [...prev, newItem];
          });
          setNodes((nds) => {
            if (nds.find((n) => n.id === newItem.id)) return nds;
            return [...nds, buildNode(newItem)];
          });
        } else if (eventType === 'UPDATE') {
          const updated = newRow as NoteItem;
          if (recentLocalUpdates.current.has(updated.id)) return;
          setItems((prev) => prev.map((i) => i.id === updated.id ? { ...i, ...updated } : i));
          setNodes((nds) => nds.map((n) => {
            if (n.id !== updated.id) return n;
            const fresh = buildNode(updated);
            return { ...n, ...fresh, selected: n.selected, data: { ...fresh.data } };
          }));
        } else if (eventType === 'DELETE') {
          setItems((prev) => prev.filter((i) => i.id !== oldRow.id));
          setNodes((nds) => nds.filter((n) => n.id !== oldRow.id));
        }
      },
      (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload;
        if (eventType === 'INSERT') {
          setConnections((prev) => {
            if (prev.find((c) => c.id === newRow.id)) return prev;
            return [...prev, newRow as NoteConnection];
          });
          setEdges((eds) => {
            if (eds.find((e) => e.id === newRow.id)) return eds;
            return [...eds, connectionToEdge(newRow as NoteConnection)];
          });
        } else if (eventType === 'DELETE') {
          setConnections((prev) => prev.filter((c) => c.id !== oldRow.id));
          setEdges((eds) => eds.filter((e) => e.id !== oldRow.id));
        }
      },
    );
    return unsub;
  }, [boardId, buildNode, setNodes, setEdges]);

  // ─── Presence subscription ─────────────────────────────────
  useEffect(() => {
    if (!boardId || !currentUser) return;
    const color = getUserColor(currentUser.id);
    const { broadcastCursor, unsubscribe } = subscribeToBoardPresence(
      boardId,
      { userId: currentUser.id, userName: currentUser.name, color },
      (users) => {
        setPresenceUsers(users.map((u) => ({
          userId: u.userId, userName: u.userName, color: u.color,
        })));
      },
      (cursorUpdates) => {
        setCursors((prev) => {
          const updated = [...prev];
          for (const c of cursorUpdates) {
            const idx = updated.findIndex((p) => p.userId === c.userId);
            const state: CursorState = {
              userId: c.userId, userName: c.userName, color: c.color,
              x: c.x, y: c.y, lastSeen: Date.now(),
            };
            if (idx >= 0) updated[idx] = state;
            else updated.push(state);
          }
          return updated;
        });
      },
    );
    broadcastCursorRef.current = broadcastCursor;
    return () => {
      broadcastCursorRef.current = null;
      unsubscribe();
    };
  }, [boardId, currentUser]);

  // Clean stale cursors
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 10000;
      setCursors((prev) => prev.filter((c) => c.lastSeen > cutoff));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // ─── Node changes (drag, resize, select) → save to DB ─────
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));

    for (const change of changes) {
      if (change.type === 'position' && change.dragging === false && change.position) {
        markLocalUpdate(change.id);
        updateItem(change.id, {
          pos_x: change.position.x,
          pos_y: change.position.y,
        }).catch((e: any) => { console.error('[canvas]', e?.message); });
        setItems((prev) => prev.map((i) =>
          i.id === change.id ? { ...i, pos_x: change.position!.x, pos_y: change.position!.y } : i
        ));
      }
      if (change.type === 'dimensions' && change.dimensions) {
        markLocalUpdate(change.id);
        updateItem(change.id, {
          width: change.dimensions.width,
          height: change.dimensions.height,
        }).catch((e: any) => { console.error('[canvas]', e?.message); });
      }
    }
  }, [setNodes, markLocalUpdate]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
    for (const change of changes) {
      if (change.type === 'remove') {
        setConnections((prev) => prev.filter((c) => c.id !== change.id));
        deleteConnection(change.id).catch((e: any) => { console.error('[canvas]', e?.message); });
      }
    }
  }, [setEdges]);

  // ─── New connections ───────────────────────────────────────
  const onConnect: OnConnect = useCallback(async (params: Connection) => {
    if (!boardId || !params.source || !params.target) return;
    try {
      const conn = await createConnection({
        board_id: boardId,
        source_id: params.source,
        target_id: params.target,
        color: '#6b7280',
      });
      setConnections((prev) => [...prev, conn]);
      setEdges((eds) => [...eds, connectionToEdge(conn)]);
      setActiveTool('select');
      toast.success('Connected');
    } catch {
      toast.error('Failed to create connection');
    }
  }, [boardId, setEdges]);

  // ─── Selection tracking ────────────────────────────────────
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const onSelectionChange = useCallback(({ nodes: sel, edges: edgeSel }: { nodes: Node[]; edges: Edge[] }) => {
    setSelectedItemId(sel.length === 1 ? sel[0].id : null);
    setSelectedEdgeId(edgeSel.length === 1 ? edgeSel[0].id : null);
  }, []);

  // ─── Add new item ──────────────────────────────────────────
  const handleAddItem = useCallback(async (type: NoteItemType, opts?: { shapeType?: ShapeType; color?: string }) => {
    if (!boardId) return;

    if (type === 'image' || type === 'file') {
      pendingFileType.current = type === 'image' ? 'image' : 'file';
      fileInputRef.current?.click();
      return;
    }

    if (type === 'link') {
      const url = prompt(t.noteCanvas.linkUrl);
      if (!url) return;
      try {
        const item = await createItem({
          board_id: boardId,
          item_type: 'link',
          pos_x: Math.random() * 400 + 100,
          pos_y: Math.random() * 400 + 100,
          width: 260,
          height: 80,
          content: '',
        });
        await updateItem(item.id, { link_url: url, link_title: url });
        const fullItem = { ...item, link_url: url, link_title: url };
        setItems((prev) => [...prev, fullItem]);
        setNodes((nds) => [...nds, buildNode(fullItem)]);
      } catch {
        toast.error('Failed to add link');
      }
      return;
    }

    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

    const defaults: Record<string, any> = {
      sticky_note: { width: 200, height: 150, color: opts?.color || '#fef08a' },
      text: { width: 250, height: 60 },
      checklist: { width: 220, height: 200 },
      shape: { width: 160, height: 120, color: opts?.color || '#e2e8f0' },
      section_header: { width: 300, height: 40, content: 'Section' },
      diagram_block: { width: 180, height: 100 },
      frame: { width: 500, height: 350, color: '#f1f5f9', content: 'Frame' },
    };

    const d = defaults[type] || {};

    try {
      const item = await createItem({
        board_id: boardId,
        item_type: type,
        pos_x: center.x - (d.width || 200) / 2 + (Math.random() * 40 - 20),
        pos_y: center.y - (d.height || 150) / 2 + (Math.random() * 40 - 20),
        width: d.width,
        height: d.height,
        content: d.content || '',
        color: d.color,
        shape_type: opts?.shapeType || null,
      });
      setItems((prev) => [...prev, item]);
      setNodes((nds) => [...nds, buildNode(item)]);
    } catch {
      toast.error('Failed to add item');
    }
  }, [boardId, language, screenToFlowPosition, buildNode, setNodes]);

  // ─── File upload handler ───────────────────────────────────
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !boardId) return;
    e.target.value = '';

    try {
      const uploaded = await uploadNoteFile(boardId, file);
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

      const w = isImage ? 400 : isPdf ? 500 : 260;
      const h = isImage ? 300 : isPdf ? 600 : 80;

      const item = await createItem({
        board_id: boardId,
        item_type: isImage && pendingFileType.current === 'image' ? 'image' : 'file',
        pos_x: center.x - w / 2,
        pos_y: center.y - h / 2,
        width: w,
        height: h,
      });

      await updateItem(item.id, {
        file_url: uploaded.url,
        file_name: uploaded.name,
        file_type: uploaded.type,
        file_size: uploaded.size,
      });

      const fullItem = {
        ...item,
        file_url: uploaded.url,
        file_name: uploaded.name,
        file_type: uploaded.type,
        file_size: uploaded.size,
      };
      setItems((prev) => [...prev, fullItem]);
      setNodes((nds) => [...nds, buildNode(fullItem)]);
    } catch {
      toast.error('Failed to upload file');
    }
  }, [boardId, screenToFlowPosition, buildNode, setNodes]);

  // ─── Duplicate selected ────────────────────────────────────
  const handleDuplicate = useCallback(async () => {
    if (!selectedItem || !boardId) return;
    try {
      const item = await createItem({
        board_id: boardId,
        item_type: selectedItem.item_type,
        pos_x: selectedItem.pos_x + 30,
        pos_y: selectedItem.pos_y + 30,
        width: selectedItem.width,
        height: selectedItem.height,
        content: selectedItem.content,
        color: selectedItem.color,
        shape_type: selectedItem.shape_type,
        font_size: selectedItem.font_size,
        text_align: selectedItem.text_align,
        border_style: selectedItem.border_style,
        rich_content: selectedItem.rich_content,
      });
      setItems((prev) => [...prev, item]);
      setNodes((nds) => [...nds, buildNode(item)]);
      toast.success('Duplicated');
    } catch {
      toast.error('Failed to duplicate');
    }
  }, [selectedItem, boardId, buildNode, setNodes]);

  // ─── Delete selected (node or edge) ────────────────────────
  const handleDelete = useCallback(async () => {
    if (selectedEdgeId) {
      try {
        await deleteConnection(selectedEdgeId);
        setConnections((prev) => prev.filter((c) => c.id !== selectedEdgeId));
        setEdges((eds) => eds.filter((e) => e.id !== selectedEdgeId));
        setSelectedEdgeId(null);
        toast.success('Connector deleted');
      } catch {
        toast.error('Failed to delete connector');
      }
      return;
    }
    if (!selectedItemId) return;
    try {
      await deleteItem(selectedItemId);
      setItems((prev) => prev.filter((i) => i.id !== selectedItemId));
      setNodes((nds) => nds.filter((n) => n.id !== selectedItemId));
      setSelectedItemId(null);
    } catch {
      toast.error('Failed to delete item');
    }
  }, [selectedItemId, selectedEdgeId, setNodes, setEdges]);

  // ─── Toggle lock ───────────────────────────────────────────
  const handleToggleLock = useCallback(async () => {
    if (!selectedItem) return;
    const locked = !selectedItem.locked;
    try {
      markLocalUpdate(selectedItem.id);
      await updateItem(selectedItem.id, { locked });
      setItems((prev) => prev.map((i) => i.id === selectedItem.id ? { ...i, locked } : i));
      setNodes((nds) => nds.map((n) =>
        n.id === selectedItem.id ? { ...n, draggable: !locked, data: { ...n.data, locked } } : n
      ));
    } catch {
      toast.error('Failed to update');
    }
  }, [selectedItem, setNodes, markLocalUpdate]);

  // ─── Z-index management ────────────────────────────────────
  const handleBringToFront = useCallback(async () => {
    if (!selectedItem) return;
    const maxZ = Math.max(...items.map((i) => i.z_index || 0), 0) + 1;
    markLocalUpdate(selectedItem.id);
    updateItem(selectedItem.id, { z_index: maxZ }).catch((e: any) => { console.error('[canvas]', e?.message); });
    setItems((prev) => prev.map((i) => i.id === selectedItem.id ? { ...i, z_index: maxZ } : i));
  }, [selectedItem, items, markLocalUpdate]);

  const handleSendToBack = useCallback(async () => {
    if (!selectedItem) return;
    const minZ = Math.min(...items.map((i) => i.z_index || 0), 0) - 1;
    markLocalUpdate(selectedItem.id);
    updateItem(selectedItem.id, { z_index: minZ }).catch((e: any) => { console.error('[canvas]', e?.message); });
    setItems((prev) => prev.map((i) => i.id === selectedItem.id ? { ...i, z_index: minZ } : i));
  }, [selectedItem, items, markLocalUpdate]);

  // ─── Inspector update handler ──────────────────────────────
  const handleInspectorUpdate = useCallback(async (id: string, updates: Partial<NoteItem>) => {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, ...updates } : i));
    setNodes((nds) => nds.map((n) => {
      if (n.id !== id) return n;
      const dataUpdates: Record<string, any> = {};
      if ('color' in updates) dataUpdates.color = updates.color;
      if ('font_size' in updates) dataUpdates.fontSize = updates.font_size;
      if ('text_align' in updates) dataUpdates.textAlign = updates.text_align;
      if ('locked' in updates) dataUpdates.locked = updates.locked;
      // Apply rotation to node style
      const style = { ...n.style };
      if ('rotation' in updates) {
        style.transform = updates.rotation ? `rotate(${updates.rotation}deg)` : undefined;
      }
      return { ...n, style, draggable: !(updates.locked ?? n.data.locked), data: { ...n.data, ...dataUpdates } };
    }));
    try {
      markLocalUpdate(id);
      await updateItem(id, updates);
    } catch {
      toast.error('Failed to update');
    }
  }, [setNodes, markLocalUpdate]);

  // ─── Entity linking ────────────────────────────────────────
  const handleLinkEntity = useCallback(async (itemId: string, entityType: EntityType, entityId: string) => {
    try {
      const link = await linkEntity(itemId, entityType, entityId);
      setItems((prev) => prev.map((i) =>
        i.id === itemId ? { ...i, entity_links: [...(i.entity_links || []), link] } : i
      ));
      toast.success(t.noteCanvas.entityLinked);
    } catch {
      toast.error('Failed to link entity');
    }
  }, [language]);

  const handleUnlinkEntity = useCallback(async (linkId: string) => {
    try {
      await unlinkEntity(linkId);
      setItems((prev) => prev.map((i) => ({
        ...i,
        entity_links: (i.entity_links || []).filter((l) => l.id !== linkId),
      })));
    } catch {
      toast.error('Failed to unlink');
    }
  }, []);

  // ─── Comments handlers ────────────────────────────────────
  const handleAddComment = useCallback(async (content: string, itemId: string | null, parentId: string | null) => {
    if (!boardId || !currentUser) return;
    try {
      const comment = await createBoardComment({
        board_id: boardId,
        item_id: itemId,
        parent_id: parentId,
        content,
        user_name: currentUser.name,
      });
      setComments((prev) => [...prev, comment]);
    } catch {
      toast.error('Failed to add comment');
    }
  }, [boardId, currentUser]);

  const handleResolveComment = useCallback(async (commentId: string) => {
    try {
      await resolveBoardComment(commentId);
      setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, resolved: true } : c));
    } catch {
      toast.error('Failed to resolve comment');
    }
  }, []);

  const handleDeleteComment = useCallback(async (commentId: string) => {
    try {
      await deleteBoardComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId && c.parent_id !== commentId));
    } catch {
      toast.error('Failed to delete comment');
    }
  }, []);

  // ─── Voting handlers ──────────────────────────────────────
  const handleStartVoting = useCallback((maxVotes: number, anonymous: boolean, timerSeconds: number) => {
    setVotingMaxVotes(maxVotes);
    setVotingAnonymous(anonymous);
    setVotingTimerSeconds(timerSeconds);
    setVotingActive(true);
    setVotingTimerRunning(true);
    setVotes([]);
    if (boardId) clearBoardVotes(boardId).catch((e: any) => { console.error('[canvas]', e?.message); });
  }, [boardId]);

  const handleStopVoting = useCallback(() => {
    setVotingActive(false);
    setVotingTimerRunning(false);
  }, []);

  // ─── Drawing handlers ─────────────────────────────────────
  const handlePathComplete = useCallback(async (path: DrawPath) => {
    setDrawPaths((prev) => [...prev, path]);
    if (boardId) {
      createBoardDrawing({
        board_id: boardId,
        path_data: path.d,
        color: path.color,
        stroke_width: path.strokeWidth,
        opacity: path.opacity,
        tool: path.tool,
      }).catch((e: any) => { console.error('[canvas]', e?.message); });
    }
  }, [boardId]);

  const handlePathErase = useCallback(async (pathId: string) => {
    setDrawPaths((prev) => prev.filter((p) => p.id !== pathId));
    deleteBoardDrawing(pathId).catch((e: any) => { console.error('[canvas]', e?.message); });
  }, []);

  // ─── Presentation helpers ──────────────────────────────────
  const frameItems = useMemo(() =>
    items.filter((i) => i.item_type === 'frame').map((i) => ({
      id: i.id,
      label: i.content || 'Frame',
      x: i.pos_x,
      y: i.pos_y,
      width: i.width,
      height: i.height,
    }))
  , [items]);

  const handlePresentNavigate = useCallback((index: number) => {
    setPresentIndex(index);
    const frame = frameItems[index];
    if (!frame) return;
    // Zoom to frame
    const padding = 60;
    const zoom = Math.min(
      (window.innerWidth - padding * 2) / frame.width,
      (window.innerHeight - padding * 2) / frame.height,
      1.5,
    );
    setViewport({
      x: -frame.x * zoom + (window.innerWidth - frame.width * zoom) / 2,
      y: -frame.y * zoom + (window.innerHeight - frame.height * zoom) / 2,
      zoom,
    }, { duration: 500 });
  }, [frameItems, setViewport]);

  // ─── Context menu handler ──────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Check if right-clicking a node
    const target = e.target as HTMLElement;
    const nodeEl = target.closest('.react-flow__node');
    const nodeId = nodeEl?.getAttribute('data-id') || null;

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      nodeId,
    });
  }, []);

  const handleContextAction = useCallback((actionId: string) => {
    const menuNodeId = contextMenu?.nodeId;
    if (menuNodeId) setSelectedItemId(menuNodeId);

    switch (actionId) {
      case 'duplicate': handleDuplicate(); break;
      case 'delete': handleDelete(); break;
      case 'lock': handleToggleLock(); break;
      case 'bring-front': handleBringToFront(); break;
      case 'send-back': handleSendToBack(); break;
      case 'connect': setActiveTool('connector'); break;
      case 'copy':
        if (menuNodeId) clipboardRef.current = items.find((i) => i.id === menuNodeId) || null;
        break;
      case 'cut':
        if (menuNodeId) {
          clipboardRef.current = items.find((i) => i.id === menuNodeId) || null;
          handleDelete();
        }
        break;
      case 'paste': {
        if (clipboardRef.current && boardId && contextMenu) {
          const pos = screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y });
          const clip = clipboardRef.current;
          createItem({
            board_id: boardId,
            item_type: clip.item_type,
            pos_x: pos.x,
            pos_y: pos.y,
            width: clip.width,
            height: clip.height,
            content: clip.content,
            color: clip.color,
            shape_type: clip.shape_type,
            font_size: clip.font_size,
            text_align: clip.text_align,
            border_style: clip.border_style,
            rich_content: clip.rich_content,
          }).then((item) => {
            setItems((prev) => [...prev, item]);
            setNodes((nds) => [...nds, buildNode(item)]);
          }).catch(() => toast.error('Paste failed'));
        }
        break;
      }
      case 'add-sticky': handleAddItem('sticky_note'); break;
      case 'add-text': handleAddItem('text'); break;
      case 'add-checklist': handleAddItem('checklist'); break;
      case 'add-shape': handleAddItem('shape', { shapeType: 'rectangle' }); break;
      case 'add-frame': handleAddItem('frame'); break;
      case 'add-image': handleAddItem('image'); break;
      case 'add-link': handleAddItem('link'); break;
      case 'select-all':
        setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
        break;
    }
    setContextMenu(null);
  }, [contextMenu, handleDuplicate, handleDelete, handleToggleLock, handleBringToFront, handleSendToBack,
      items, boardId, screenToFlowPosition, buildNode, setNodes, handleAddItem]);

  // ─── Handle node click for voting ──────────────────────────
  const handleNodeClick = useCallback(async (_: any, node: Node) => {
    if (!votingActive || !boardId || !currentUser) return;
    if (node.type !== 'sticky_note') return;

    const myVotes = votes.filter((v) => v.userId === currentUser.id);
    const alreadyVoted = myVotes.find((v) => v.itemId === node.id);

    if (alreadyVoted) {
      // Remove vote
      await removeVote(boardId, node.id).catch((e: any) => { console.error('[canvas]', e?.message); });
      setVotes((prev) => prev.filter((v) => !(v.userId === currentUser.id && v.itemId === node.id)));
    } else if (myVotes.length < votingMaxVotes) {
      // Cast vote
      await castVote(boardId, node.id, currentUser.name).catch((e: any) => { console.error('[canvas]', e?.message); });
      setVotes((prev) => [...prev, { itemId: node.id, userId: currentUser.id, userName: currentUser.name }]);
    } else {
      toast.error(t.noteCanvas.maxVotesReached);
    }
  }, [votingActive, boardId, currentUser, votes, votingMaxVotes, language]);

  // ─── Save title ────────────────────────────────────────────
  const saveTitle = useCallback(async () => {
    if (!board || !titleValue.trim()) return;
    setEditingTitle(false);
    if (titleValue !== board.title) {
      await updateBoard(board.id, { title: titleValue.trim() });
      setBoard((prev) => prev ? { ...prev, title: titleValue.trim() } : prev);
    }
  }, [board, titleValue]);

  // ─── Save viewport on move (debounced) ─────────────────────
  const onMoveEnd = useCallback(() => {
    if (!boardId) return;
    if (saveViewportTimer.current) clearTimeout(saveViewportTimer.current);
    saveViewportTimer.current = setTimeout(() => {
      const vp = getViewport();
      updateBoard(boardId, { viewport_x: vp.x, viewport_y: vp.y, viewport_zoom: vp.zoom }).catch((e: any) => { console.error('[canvas]', e?.message); });
    }, 1000);
  }, [boardId, getViewport]);

  // ─── Mouse move for cursor broadcast ───────────────────────
  const cursorThrottleRef = useRef(0);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const now = Date.now();
    if (now - cursorThrottleRef.current < 50) return; // 20fps max
    cursorThrottleRef.current = now;
    if (broadcastCursorRef.current) {
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      broadcastCursorRef.current(pos.x, pos.y);
    }
  }, [screenToFlowPosition]);

  // ─── Keyboard shortcuts ────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Delete / Backspace → delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDelete();
        return;
      }
      // Escape → exit modes
      if (e.key === 'Escape') {
        if (presenting) { setPresenting(false); return; }
        if (isDrawing) { setActiveTool('select'); return; }
        if (connectMode) { setActiveTool('select'); return; }
        setContextMenu(null);
        return;
      }
      // Ctrl+D → duplicate
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        handleDuplicate();
        return;
      }
      // Ctrl+C → copy
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedItem) clipboardRef.current = selectedItem;
        return;
      }
      // Ctrl+V → paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboardRef.current && boardId) {
          const clip = clipboardRef.current;
          createItem({
            board_id: boardId,
            item_type: clip.item_type,
            pos_x: clip.pos_x + 40,
            pos_y: clip.pos_y + 40,
            width: clip.width,
            height: clip.height,
            content: clip.content,
            color: clip.color,
            shape_type: clip.shape_type,
          }).then((item) => {
            setItems((prev) => [...prev, item]);
            setNodes((nds) => [...nds, buildNode(item)]);
          }).catch((e: any) => { console.error('[canvas]', e?.message); });
        }
        return;
      }
      // Ctrl+X → cut
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        if (selectedItem) {
          clipboardRef.current = selectedItem;
          handleDelete();
        }
        return;
      }
      // Ctrl+A → select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
        return;
      }
      // Ctrl+Z → undo (placeholder)
      // S → sticky note
      if (e.key === 's' && !e.ctrlKey && !e.metaKey) { handleAddItem('sticky_note'); return; }
      // T → text
      if (e.key === 't' && !e.ctrlKey) { handleAddItem('text'); return; }
      // F → frame
      if (e.key === 'f' && !e.ctrlKey) { handleAddItem('frame'); return; }
      // R → rectangle
      if (e.key === 'r' && !e.ctrlKey) { handleAddItem('shape', { shapeType: 'rectangle' }); return; }
      // C → connector
      if (e.key === 'c' && !e.ctrlKey && !e.metaKey) { setActiveTool(connectMode ? 'select' : 'connector'); return; }
      // D → draw
      if (e.key === 'd' && !e.ctrlKey && !e.metaKey) { setActiveTool(isDrawing ? 'select' : 'draw' as any); return; }
      // V → select
      if (e.key === 'v' && !e.ctrlKey && !e.metaKey) { setActiveTool('select'); return; }
      // L → lock/unlock
      if (e.key === 'l' && !e.ctrlKey) { handleToggleLock(); return; }
      // +/- → zoom
      if (e.key === '=' || e.key === '+') { zoomIn(); return; }
      if (e.key === '-') { zoomOut(); return; }
      // 0 → fit view
      if (e.key === '0' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fitView({ padding: 0.2 }); return; }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleDelete, handleDuplicate, handleToggleLock, handleAddItem,
      connectMode, isDrawing, presenting, selectedItem, boardId, buildNode,
      setNodes, zoomIn, zoomOut, fitView]);

  // ─── Presentation keyboard navigation ─────────────────────
  useEffect(() => {
    if (!presenting) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        setPresentIndex((i) => Math.min(i + 1, frameItems.length - 1));
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPresentIndex((i) => Math.max(i - 1, 0));
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [presenting, frameItems.length]);

  useEffect(() => {
    if (presenting && frameItems.length > 0) {
      handlePresentNavigate(presentIndex);
    }
  }, [presenting, presentIndex, handlePresentNavigate, frameItems.length]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Skeleton className="w-full h-[600px] rounded-xl" />
      </div>
    );
  }

  const viewport = getViewport();

  return (
    <div className="fixed inset-0 z-40 bg-surface flex flex-col">
      <style>{edgeSelectedStyles}</style>
      {/* ─── Top bar ─── */}
      <div className="h-12 border-b border-outline flex items-center justify-between px-4 bg-surface shrink-0 z-50">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/notes')}
            className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          {editingTitle ? (
            <input
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
              className="text-[14px] font-semibold text-text-primary bg-transparent border-b border-blue-400 outline-none px-1"
              autoFocus
            />
          ) : (
            <button
              onClick={() => setEditingTitle(true)}
              className="flex items-center gap-1.5 text-[14px] font-semibold text-text-primary hover:text-text-secondary transition-colors"
            >
              {board?.title || 'Untitled'}
              <Pencil size={11} className="text-text-tertiary" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Presence avatars */}
          <PresenceBar users={presenceUsers} language={language} />

          {/* Action buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowComments(!showComments)}
              className={`p-1.5 rounded-md transition-colors ${showComments ? 'bg-primary/10 text-text-primary' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-secondary'}`}
              title={t.noteCanvas.comments}
            >
              <MessageCircle size={15} />
            </button>
            <button
              onClick={() => setShowVoting(!showVoting)}
              className={`p-1.5 rounded-md transition-colors ${showVoting ? 'bg-primary/10 text-text-primary' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-secondary'}`}
              title={t.noteCanvas.voting}
            >
              <ThumbsUp size={15} />
            </button>
            <button
              onClick={() => { setPresenting(true); setPresentIndex(0); }}
              className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors"
              title={t.noteCanvas.present}
            >
              <Play size={15} />
            </button>
            <button
              onClick={() => setActiveTool(isDrawing ? 'select' : 'draw' as any)}
              className={`p-1.5 rounded-md transition-colors ${isDrawing ? 'bg-primary/10 text-text-primary' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-secondary'}`}
              title={t.noteCanvas.draw}
            >
              <Pen size={15} />
            </button>
          </div>

          <span className="text-[11px] text-text-tertiary">
            {items.length} {t.noteBoards.items}
          </span>
        </div>
      </div>

      {/* ─── Canvas ─── */}
      <div className="flex-1 relative" onContextMenu={handleContextMenu} onMouseMove={handleMouseMove}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          onMoveEnd={onMoveEnd}
          onNodeClick={handleNodeClick}
          nodeTypes={nodeTypes}
          selectionOnDrag={false}
          nodeDragThreshold={5}
          panOnDrag={!isDrawing}
          zoomOnScroll={!isDrawing}
          panOnScroll={false}
          zoomOnDoubleClick={false}
          snapToGrid
          snapGrid={[16, 16]}
          deleteKeyCode={null}
          noDragClassName="nodrag"
          noWheelClassName="nowheel"
          defaultViewport={board ? { x: board.viewport_x, y: board.viewport_y, zoom: board.viewport_zoom } : undefined}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--color-outline, #e2e8f0)" />
          <MiniMap
            nodeStrokeWidth={2}
            pannable
            zoomable
            className="!bg-surface !border !border-outline !rounded-lg"
          />
        </ReactFlow>

        {/* ─── Drawing overlay ─── */}
        <DrawingCanvas
          active={isDrawing}
          tool={drawTool}
          color={drawColor}
          strokeWidth={drawStrokeWidth}
          viewport={viewport}
          existingPaths={drawPaths}
          onPathComplete={handlePathComplete}
          onPathErase={handlePathErase}
        />

        {/* ─── Live cursors ─── */}
        <LiveCursors cursors={cursors} viewport={viewport} />

        {/* ─── Connect mode banner ─── */}
        {connectMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div className="pointer-events-auto bg-primary text-white px-4 py-2 rounded-lg shadow-lg text-[13px] font-medium flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-surface-card animate-pulse" />
              {language === 'fr'
                ? 'Mode flèche — glisse d\'un point bleu vers un autre pour relier'
                : 'Arrow mode — drag from a blue dot to another to connect'}
              <button
                onClick={() => setActiveTool('select')}
                className="ml-2 px-2 py-0.5 bg-surface-card/20 hover:bg-surface-card/30 rounded text-[11px] transition-colors"
              >
                {t.advancedNotes.cancel}
              </button>
            </div>
          </div>
        )}

        {/* ─── Drawing toolbar ─── */}
        {isDrawing && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-2 bg-surface border border-outline rounded-xl shadow-lg px-3 py-2">
              {(['pen', 'highlighter', 'eraser'] as DrawTool[]).map((dt) => (
                <button
                  key={dt}
                  onClick={() => setDrawTool(dt)}
                  className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-colors ${drawTool === dt ? 'bg-primary/10 text-text-primary' : 'text-text-tertiary hover:bg-surface-secondary'}`}
                >
                  {dt === 'pen' ? (t.noteCanvas.pen) : dt === 'highlighter' ? (t.noteCanvas.highlighter) : (t.noteCanvas.eraser)}
                </button>
              ))}
              <div className="w-px h-5 bg-outline" />
              <input
                type="color"
                value={drawColor}
                onChange={(e) => setDrawColor(e.target.value)}
                className="w-6 h-6 rounded border border-outline cursor-pointer"
                title={t.advancedNotes.color}
              />
              <input
                type="range"
                min={1}
                max={12}
                value={drawStrokeWidth}
                onChange={(e) => setDrawStrokeWidth(Number(e.target.value))}
                className="w-16 accent-blue-500"
                title={t.noteCanvas.width}
              />
              <button
                onClick={() => setActiveTool('select')}
                className="px-2 py-1 rounded-lg text-[11px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium transition-colors"
              >
                {t.noteCanvas.exit}
              </button>
            </div>
          </div>
        )}

        {/* ─── Floating toolbar ─── */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="pointer-events-auto">
            <CanvasToolbar
              activeTool={activeTool}
              onToolChange={setActiveTool}
              onAddItem={handleAddItem}
              onZoomIn={() => zoomIn()}
              onZoomOut={() => zoomOut()}
              onFitView={() => fitView({ padding: 0.2 })}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onToggleLock={handleToggleLock}
              hasSelection={!!selectedItemId || !!selectedEdgeId}
              isLocked={selectedItem?.locked ?? false}
              language={language}
            />
          </div>
        </div>

        {/* ─── Inspector ─── */}
        {selectedItem && !showComments && !showVoting && (
          <div className="absolute top-4 right-4 z-50 pointer-events-none">
            <div className="pointer-events-auto">
              <InspectorPanel
                item={selectedItem}
                onClose={() => setSelectedItemId(null)}
                onUpdate={handleInspectorUpdate}
                onLinkEntity={handleLinkEntity}
                onUnlinkEntity={handleUnlinkEntity}
                language={language}
              />
            </div>
          </div>
        )}

        {/* ─── Comments Panel ─── */}
        {showComments && (
          <div className="absolute top-4 right-4 z-50 pointer-events-none">
            <div className="pointer-events-auto">
              <CommentsPanel
                comments={comments}
                selectedItemId={selectedItemId}
                currentUserId={currentUser?.id || ''}
                currentUserName={currentUser?.name || 'User'}
                language={language}
                onAddComment={handleAddComment}
                onResolve={handleResolveComment}
                onDelete={handleDeleteComment}
                onClose={() => setShowComments(false)}
              />
            </div>
          </div>
        )}

        {/* ─── Voting Panel ─── */}
        {showVoting && (
          <div className="absolute top-4 right-4 z-50 pointer-events-none">
            <div className="pointer-events-auto">
              <VotingPanel
                active={votingActive}
                votes={votes}
                maxVotes={votingMaxVotes}
                anonymous={votingAnonymous}
                timerSeconds={votingTimerSeconds}
                timerRunning={votingTimerRunning}
                currentUserId={currentUser?.id || ''}
                language={language}
                onStart={handleStartVoting}
                onStop={handleStopVoting}
                onClose={() => setShowVoting(false)}
              />
            </div>
          </div>
        )}

        {/* ─── Context menu ─── */}
        {contextMenu && (
          <CanvasContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            isNodeMenu={!!contextMenu.nodeId}
            isLocked={selectedItem?.locked ?? false}
            language={language}
            onAction={handleContextAction}
            onClose={() => setContextMenu(null)}
          />
        )}

        {/* ─── Presentation mode ─── */}
        {presenting && (
          <PresentationMode
            frames={frameItems}
            currentIndex={presentIndex}
            language={language}
            onNavigate={handlePresentNavigate}
            onExit={() => setPresenting(false)}
          />
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileUpload}
          accept={pendingFileType.current === 'image' ? 'image/*' : '*'}
        />
      </div>
    </div>
  );
}

// ─── Wrapped with ReactFlowProvider ──────────────────────────
export default function NoteCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
