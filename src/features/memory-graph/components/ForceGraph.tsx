/* ═══════════════════════════════════════════════════════════════
   Memory Graph — Force-Directed Graph (Canvas)

   Tech choice: Custom Canvas-based force simulation.
   Rationale:
   - No extra dependency (react-force-graph is 300KB+ bundled)
   - Full control over rendering for Obsidian-like aesthetics
   - Matches existing RelationshipGraph pattern in the codebase
   - Canvas is more performant than SVG for 500+ nodes
   - Allows custom glow effects, opacity by freshness, etc.
   ═══════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MemoryNode, MemoryEdge, SimNode } from '../types';
import { NODE_TYPE_COLORS } from '../types';

interface ForceGraphProps {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  selectedNodeId: string | null;
  focusNodeId: string | null;
  onNodeClick: (nodeId: string) => void;
  onNodeDoubleClick: (nodeId: string) => void;
  onBackgroundClick: () => void;
  language: 'en' | 'fr';
}

// ── Force Simulation ──────────────────────────────────────
function buildSimNodes(nodes: MemoryNode[], width: number, height: number): SimNode[] {
  return nodes.map((n) => ({
    ...n,
    x: width / 2 + (Math.random() - 0.5) * width * 0.7,
    y: height / 2 + (Math.random() - 0.5) * height * 0.7,
    vx: 0,
    vy: 0,
    degree: 0,
    radius: 4,
  }));
}

function computeDegrees(simNodes: SimNode[], edges: MemoryEdge[]): void {
  const degreeMap = new Map<string, number>();
  for (const e of edges) {
    degreeMap.set(e.source_id, (degreeMap.get(e.source_id) || 0) + 1);
    degreeMap.set(e.target_id, (degreeMap.get(e.target_id) || 0) + 1);
  }
  for (const n of simNodes) {
    n.degree = degreeMap.get(n.id) || 0;
    // Radius: base 4, scale with degree and importance
    n.radius = Math.max(3, Math.min(18, 4 + n.degree * 0.8 + Number(n.importance) * 6));
  }
}

function runSimulation(
  simNodes: SimNode[],
  edges: MemoryEdge[],
  width: number,
  height: number,
  iterations: number = 150,
): void {
  const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
  const edgePairs = edges
    .map((e) => ({ source: nodeMap.get(e.source_id), target: nodeMap.get(e.target_id), weight: Number(e.weight) }))
    .filter((e) => e.source && e.target);

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;
    const decay = 0.35 * alpha;

    // Repulsion
    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const a = simNodes[i], b = simNodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (1000 * decay) / (dist * dist);
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // Attraction (connected nodes)
    for (const edge of edgePairs) {
      const a = edge.source!, b = edge.target!;
      let dx = b.x - a.x, dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const idealDist = 80 + (1 - edge.weight) * 40;
      const force = (dist - idealDist) * 0.025 * decay;
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    // Center gravity
    for (const n of simNodes) {
      n.vx += (width / 2 - n.x) * 0.0008 * decay;
      n.vy += (height / 2 - n.y) * 0.0008 * decay;
    }

    // Apply velocity with damping
    for (const n of simNodes) {
      n.vx *= 0.85;
      n.vy *= 0.85;
      n.x += n.vx;
      n.y += n.vy;
      // Bounds
      n.x = Math.max(20, Math.min(width - 20, n.x));
      n.y = Math.max(20, Math.min(height - 20, n.y));
    }
  }
}

// ── Canvas Renderer ───────────────────────────────────────
export default function ForceGraph({
  nodes,
  edges,
  selectedNodeId,
  focusNodeId,
  onNodeClick,
  onNodeDoubleClick,
  onBackgroundClick,
  language,
}: ForceGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Observe container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Run simulation when data changes
  useEffect(() => {
    if (nodes.length === 0) {
      setSimNodes([]);
      return;
    }
    const { width, height } = dimensions;
    const sn = buildSimNodes(nodes, width, height);
    computeDegrees(sn, edges);
    runSimulation(sn, edges, width, height);
    setSimNodes(sn);
  }, [nodes, edges, dimensions]);

  // ── Draw ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    ctx.scale(dpr, dpr);

    const { x: tx, y: ty, scale } = transform;

    // Clear
    ctx.clearRect(0, 0, dimensions.width, dimensions.height);

    // Apply transform
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);

    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
    const now = Date.now();

    // ── Draw edges ──
    for (const edge of edges) {
      const source = nodeMap.get(edge.source_id);
      const target = nodeMap.get(edge.target_id);
      if (!source || !target) continue;

      const isHighlighted =
        selectedNodeId === edge.source_id ||
        selectedNodeId === edge.target_id ||
        hoveredNode?.id === edge.source_id ||
        hoveredNode?.id === edge.target_id;

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);

      if (edge.relation_type === 'contradicted_by' || edge.relation_type === 'duplicate_of') {
        ctx.strokeStyle = isHighlighted ? 'rgba(239,68,68,0.6)' : 'rgba(239,68,68,0.15)';
        ctx.setLineDash([4, 4]);
      } else {
        ctx.strokeStyle = isHighlighted
          ? 'rgba(255,255,255,0.35)'
          : 'rgba(255,255,255,0.06)';
        ctx.setLineDash([]);
      }
      ctx.lineWidth = isHighlighted ? 1.5 : Math.max(0.5, Number(edge.weight) * 1.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Draw nodes ──
    for (const node of simNodes) {
      const isSelected = node.id === selectedNodeId;
      const isFocused = node.id === focusNodeId;
      const isHovered = node.id === hoveredNode?.id;
      const isNeighbor = selectedNodeId
        ? edges.some(
            (e) =>
              (e.source_id === selectedNodeId && e.target_id === node.id) ||
              (e.target_id === selectedNodeId && e.source_id === node.id),
          )
        : false;

      const color = NODE_TYPE_COLORS[node.node_type] || '#6366F1';

      // Freshness opacity (more transparent if stale)
      const daysSinceFresh = (now - new Date(node.freshness_at).getTime()) / 86400000;
      const freshnessAlpha = Math.max(0.3, 1 - daysSinceFresh / 90);

      // Confidence affects saturation
      const confidenceAlpha = Math.max(0.4, Number(node.confidence));

      let alpha = freshnessAlpha * confidenceAlpha;
      if (selectedNodeId && !isSelected && !isNeighbor) alpha *= 0.3;
      if (isSelected || isHovered || isFocused) alpha = 1;

      // Glow effect for selected/hovered
      if (isSelected || isHovered || isFocused) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 8, 0, Math.PI * 2);
        const gradient = ctx.createRadialGradient(
          node.x, node.y, node.radius,
          node.x, node.y, node.radius + 8,
        );
        gradient.addColorStop(0, `${color}40`);
        gradient.addColorStop(1, `${color}00`);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = alpha < 0.9 ? `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` : color;
      ctx.fill();

      // Border for selected
      if (isSelected || isFocused) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label for hovered/selected/large nodes
      if (isHovered || isSelected || isFocused || node.radius > 10) {
        ctx.font = `${isSelected || isHovered ? '600' : '500'} ${isSelected || isHovered ? 11 : 9}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const label = node.label.length > 28 ? node.label.slice(0, 26) + '…' : node.label;

        // Text shadow
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillText(label, node.x + 1, node.y + node.radius + 5);

        // Text
        ctx.fillStyle = isSelected || isHovered ? '#ffffff' : `rgba(255,255,255,${alpha * 0.85})`;
        ctx.fillText(label, node.x, node.y + node.radius + 4);
      }
    }

    ctx.restore();
  }, [simNodes, edges, selectedNodeId, focusNodeId, hoveredNode, transform, dimensions]);

  // ── Hit test ────────────────────────────────────────────
  const getNodeAtPos = useCallback(
    (clientX: number, clientY: number): SimNode | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const mx = (clientX - rect.left - transform.x) / transform.scale;
      const my = (clientY - rect.top - transform.y) / transform.scale;

      for (let i = simNodes.length - 1; i >= 0; i--) {
        const n = simNodes[i];
        const dx = mx - n.x, dy = my - n.y;
        if (dx * dx + dy * dy <= (n.radius + 4) * (n.radius + 4)) return n;
      }
      return null;
    },
    [simNodes, transform],
  );

  // ── Mouse handlers ──────────────────────────────────────
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setIsDragging(true);
      setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
    },
    [transform],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const node = getNodeAtPos(e.clientX, e.clientY);
      setHoveredNode(node);

      if (isDragging) {
        setTransform((prev) => ({
          ...prev,
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        }));
      }
    },
    [isDragging, dragStart, getNodeAtPos],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      setIsDragging(false);

      // If minimal movement, treat as click
      const dx = e.clientX - (dragStart.x + transform.x);
      const dy = e.clientY - (dragStart.y + transform.y);
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        // This was a click, not a drag — handled by onClick
      }
    },
    [isDragging, dragStart, transform],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const node = getNodeAtPos(e.clientX, e.clientY);
      if (node) {
        onNodeClick(node.id);
      } else {
        onBackgroundClick();
      }
    },
    [getNodeAtPos, onNodeClick, onBackgroundClick],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const node = getNodeAtPos(e.clientX, e.clientY);
      if (node) {
        onNodeDoubleClick(node.id);
      }
    },
    [getNodeAtPos, onNodeDoubleClick],
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform((prev) => {
      const newScale = Math.max(0.1, Math.min(5, prev.scale * delta));
      // Zoom toward cursor
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { ...prev, scale: newScale };
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      return {
        x: mx - (mx - prev.x) * (newScale / prev.scale),
        y: my - (my - prev.y) * (newScale / prev.scale),
        scale: newScale,
      };
    });
  }, []);

  // ── Tooltip ─────────────────────────────────────────────
  const tooltipContent = hoveredNode
    ? {
        label: hoveredNode.label,
        type: hoveredNode.node_type,
        confidence: (Number(hoveredNode.confidence) * 100).toFixed(0),
        importance: (Number(hoveredNode.importance) * 100).toFixed(0),
        connections: hoveredNode.degree,
        layer: hoveredNode.memory_layer,
      }
    : null;

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      <canvas
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        style={{ width: dimensions.width, height: dimensions.height, cursor: hoveredNode ? 'pointer' : isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
      />

      {/* Tooltip */}
      {tooltipContent && hoveredNode && (
        <div
          className="absolute pointer-events-none z-50 px-3 py-2 rounded-lg bg-[#1a1a1d]/95 border border-white/10 backdrop-blur-sm shadow-xl"
          style={{
            left: hoveredNode.x * transform.scale + transform.x + 12,
            top: hoveredNode.y * transform.scale + transform.y - 10,
            maxWidth: 280,
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: NODE_TYPE_COLORS[hoveredNode.node_type] }}
            />
            <span className="text-[12px] font-semibold text-white truncate">{tooltipContent.label}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-white/60">
            <span>Type: <span className="text-white/80">{tooltipContent.type.replace(/_/g, ' ')}</span></span>
            <span>Layer: <span className="text-white/80">{tooltipContent.layer}</span></span>
            <span>Confidence: <span className="text-white/80">{tooltipContent.confidence}%</span></span>
            <span>Importance: <span className="text-white/80">{tooltipContent.importance}%</span></span>
            <span>Connections: <span className="text-white/80">{tooltipContent.connections}</span></span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {simNodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-text-tertiary text-sm mb-2">
              {language === 'fr' ? 'Aucun nœud mémoire' : 'No memory nodes'}
            </div>
            <div className="text-text-muted text-xs">
              {language === 'fr'
                ? 'Lancez un build pour hydrater le graphe depuis vos données CRM'
                : 'Run a build to hydrate the graph from your CRM data'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
