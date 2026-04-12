import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import { fetchRelationshipGraph, type GraphNode, type GraphEdge } from '../../lib/insightsApi';

/* ── Entity type colors (Mirofish-style) ─────────────────── */
const TYPE_COLORS: Record<string, string> = {
  client:  '#F97316', // orange
  job:     '#3B82F6', // blue
  team:    '#10B981', // green
  invoice: '#EF4444', // red
  lead:    '#A855F7', // purple
  quote:   '#EC4899', // pink
};

const TYPE_RADIUS: Record<string, number> = {
  client: 6, job: 5, team: 8, invoice: 4, lead: 5, quote: 4,
};

const TYPE_LABELS: Record<string, string> = {
  client: 'Client', job: 'Job', team: 'Équipe',
  invoice: 'Facture', lead: 'Lead', quote: 'Devis',
};

/* ── Simple force simulation ─────────────────────────────── */
interface SimNode extends GraphNode {
  x: number; y: number;
  vx: number; vy: number;
}

function runForceSimulation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  iterations: number = 120,
): SimNode[] {
  const simNodes: SimNode[] = nodes.map((n, i) => ({
    ...n,
    x: width / 2 + (Math.random() - 0.5) * width * 0.6,
    y: height / 2 + (Math.random() - 0.5) * height * 0.6,
    vx: 0, vy: 0,
  }));

  const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
  const edgePairs = edges.map((e) => ({ source: nodeMap.get(e.source), target: nodeMap.get(e.target) })).filter((e) => e.source && e.target);

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;
    const decay = 0.3 * alpha;

    // Repulsion (all nodes push each other away)
    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const a = simNodes[i], b = simNodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (800 * decay) / (dist * dist);
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // Attraction (connected nodes pull toward each other)
    for (const edge of edgePairs) {
      const a = edge.source!, b = edge.target!;
      let dx = b.x - a.x, dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - 80) * 0.02 * decay;
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    // Center gravity
    for (const n of simNodes) {
      n.vx += (width / 2 - n.x) * 0.001 * decay;
      n.vy += (height / 2 - n.y) * 0.001 * decay;
    }

    // Apply velocities with damping
    for (const n of simNodes) {
      n.vx *= 0.85;
      n.vy *= 0.85;
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.max(20, Math.min(width - 20, n.x));
      n.y = Math.max(20, Math.min(height - 20, n.y));
    }
  }

  return simNodes;
}

/* ── Main Component ──────────────────────────────────────── */
export default function RelationshipGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 900, height: 600 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const [simEdges, setSimEdges] = useState<GraphEdge[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['relationshipGraph'],
    queryFn: fetchRelationshipGraph,
    staleTime: 60_000,
  });

  // Run simulation when data arrives
  useEffect(() => {
    if (!data?.nodes.length) return;
    const w = dimensions.width;
    const h = dimensions.height;
    const nodes = runForceSimulation(data.nodes, data.edges, w, h);
    setSimNodes(nodes);
    setSimEdges(data.edges);
  }, [data, dimensions]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 100 && height > 100) setDimensions({ width, height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [fullscreen]);

  const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

  // Pan handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'circle') return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [dragging, dragStart]);

  const onMouseUp = useCallback(() => setDragging(false), []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.2, Math.min(3, z - e.deltaY * 0.001)));
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[500px] text-text-tertiary gap-2">
        <Loader2 size={18} className="animate-spin" /> Loading relationship graph...
      </div>
    );
  }

  if (!simNodes.length) {
    return <div className="text-center py-16 text-text-tertiary text-sm">No relationship data available yet. Add clients, jobs, and teams to see the graph.</div>;
  }

  return (
    <div className={fullscreen ? 'fixed inset-0 z-[100] bg-surface' : ''}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-outline bg-surface">
        <div>
          <p className="text-[15px] font-bold text-text-primary">Visualisation des relations</p>
          <p className="text-[11px] text-text-tertiary">{simNodes.length} entités · {simEdges.length} relations</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom((z) => Math.min(3, z + 0.2))} className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-tertiary"><ZoomIn size={16} /></button>
          <button onClick={() => setZoom((z) => Math.max(0.2, z - 0.2))} className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-tertiary"><ZoomOut size={16} /></button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="px-2 py-1 rounded-lg hover:bg-surface-secondary text-[11px] text-text-tertiary font-medium">Reset</button>
          <button onClick={() => setFullscreen(!fullscreen)} className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-tertiary">
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className={fullscreen ? 'w-full h-[calc(100vh-90px)]' : 'w-full h-[550px]'}
        style={{ cursor: dragging ? 'grabbing' : 'grab', overflow: 'hidden', background: '#ffffff' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      >
        <svg width="100%" height="100%" style={{ display: 'block' }}>
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Edges */}
            {simEdges.map((edge, i) => {
              const s = nodeMap.get(edge.source);
              const t = nodeMap.get(edge.target);
              if (!s || !t) return null;
              return (
                <line
                  key={`e-${i}`}
                  x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                  stroke="#6b7280" strokeWidth={1.2} strokeOpacity={0.7}
                />
              );
            })}

            {/* Nodes */}
            {simNodes.map((node) => {
              const color = TYPE_COLORS[node.type] || '#94A3B8';
              const r = TYPE_RADIUS[node.type] || 5;
              const isHovered = hoveredNode?.id === node.id;
              return (
                <g key={node.id}>
                  {/* Glow on hover */}
                  {isHovered && (
                    <circle cx={node.x} cy={node.y} r={r + 8} fill={color} opacity={0.15} />
                  )}
                  <circle
                    cx={node.x} cy={node.y} r={isHovered ? r + 2 : r}
                    fill={color}
                    stroke="#fff" strokeWidth={2}
                    style={{ cursor: 'pointer', transition: 'r 0.15s' }}
                    onMouseEnter={() => setHoveredNode(node)}
                    onMouseLeave={() => setHoveredNode(null)}
                  />
                  {/* Label (show on hover or if zoom > 1.2) */}
                  {(isHovered || zoom > 1.2) && (
                    <text
                      x={node.x} y={node.y - r - 4}
                      textAnchor="middle"
                      fontSize={isHovered ? 11 : 8}
                      fontWeight={isHovered ? 700 : 400}
                      fill={isHovered ? '#111' : '#666'}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {node.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-surface-card/95 backdrop-blur-sm rounded-xl border border-outline shadow-lg px-4 py-3" style={{ position: fullscreen ? 'fixed' : 'absolute' }}>
        <p className="text-[11px] font-bold uppercase tracking-wider text-rose-500 mb-2">Types d'entités</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {Object.entries(TYPE_LABELS).map(([type, label]) => (
            <div key={type} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TYPE_COLORS[type] }} />
              <span className="text-[12px] text-text-secondary">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hover tooltip */}
      {hoveredNode && (
        <div className="absolute top-14 right-4 bg-surface-card rounded-xl border border-outline shadow-lg px-4 py-3 min-w-[180px]" style={{ position: fullscreen ? 'fixed' : 'absolute' }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: TYPE_COLORS[hoveredNode.type] }} />
            <span className="text-[13px] font-bold text-text-primary">{hoveredNode.label}</span>
          </div>
          <p className="text-[11px] text-text-tertiary">{TYPE_LABELS[hoveredNode.type] || hoveredNode.type}</p>
          <p className="text-[10px] text-text-tertiary mt-1 font-mono">{hoveredNode.id.slice(0, 8)}...</p>
          <p className="text-[11px] text-text-secondary mt-1">
            {simEdges.filter((e) => e.source === hoveredNode.id || e.target === hoveredNode.id).length} connexion(s)
          </p>
        </div>
      )}
    </div>
  );
}
