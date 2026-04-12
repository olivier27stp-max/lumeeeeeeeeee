import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  Position,
  Handle,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { X, Trophy, AlertTriangle, CheckCircle2, Users, Briefcase, FileText, DollarSign, User, Maximize2, Minimize2, Database, Brain, Target, Sparkles, Zap } from 'lucide-react';
import MrLumeAvatar from './MrLumeAvatar';
import type { ScenarioResult, ScenarioOption, AgentStateLabel } from '../types';

/* ═══════════════════════════════════════════════════════════════
   Custom Nodes — MiroFish style
   ═══════════════════════════════════════════════════════════════ */

/* ── Signal dot (small verification/check point) ── */
function SignalNode({ data }: { data: { label: string; active: boolean; done: boolean } }) {
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0 !w-0 !h-0" />
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        className="flex flex-col items-center gap-1"
      >
        <motion.div
          className={`w-3 h-3 rounded-full transition-colors ${
            data.done ? 'bg-green-400' : data.active ? 'bg-primary' : 'bg-surface-tertiary'
          }`}
          animate={data.active ? { scale: [1, 1.4, 1], opacity: [1, 0.6, 1] } : {}}
          transition={data.active ? { duration: 1.2, repeat: Infinity } : {}}
        />
        <span className="text-[8px] text-text-tertiary whitespace-nowrap max-w-[60px] truncate">{data.label}</span>
      </motion.div>
    </div>
  );
}

/* ── Check node (medium — important verification) ── */
function CheckNode({ data }: { data: { label: string; icon: string; active: boolean; done: boolean; detail?: string } }) {
  const icons: Record<string, React.ElementType> = { Database, Brain, Target, Sparkles, Users, Briefcase };
  const Icon = icons[data.icon] || Brain;

  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} className="!bg-text-tertiary !w-1.5 !h-1.5" />
      <Handle type="source" position={Position.Right} className="!bg-text-tertiary !w-1.5 !h-1.5" />
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all min-w-[110px] ${
          data.done
            ? 'border-green-300 bg-green-50/50 dark:border-green-700 dark:bg-green-900/20'
            : data.active
              ? 'border-text-primary/30 bg-surface shadow-md'
              : 'border-outline-subtle bg-surface-secondary'
        }`}
      >
        <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
          data.done ? 'bg-green-100 dark:bg-green-900/40' : data.active ? 'bg-primary text-white' : 'bg-surface-tertiary'
        }`}>
          {data.done ? <CheckCircle2 size={12} className="text-green-500" /> : (
            <motion.div animate={data.active ? { rotate: 360 } : {}} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
              <Icon size={12} className={data.active ? 'text-white' : 'text-text-tertiary'} />
            </motion.div>
          )}
        </div>
        <div className="min-w-0">
          <p className={`text-[10px] font-semibold truncate ${data.active ? 'text-text-primary' : 'text-text-tertiary'}`}>{data.label}</p>
          {data.detail && <p className="text-[8px] text-text-tertiary truncate">{data.detail}</p>}
        </div>
      </motion.div>
    </div>
  );
}

/* ── Panda center node ── */
function PandaNode({ data }: { data: { active: boolean } }) {
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} className="!bg-primary !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-primary !w-2 !h-2" />
      <Handle type="source" position={Position.Top} className="!bg-primary !w-2 !h-2" id="top" />
      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2" id="bottom" />
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        className="flex flex-col items-center gap-1 p-3 rounded-2xl bg-surface border-2 border-text-primary/20 shadow-lg"
      >
        <MrLumeAvatar size="md" pulse={data.active} />
        <span className="text-[10px] font-bold text-text-primary">Mr Lume</span>
      </motion.div>
      {data.active && (
        <motion.div
          className="absolute inset-0 rounded-2xl border-2 border-text-primary/15 -z-10"
          animate={{ scale: [1, 1.12, 1], opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}
    </div>
  );
}

/* ── Entity node ── */
const ENTITY_COLORS: Record<string, string> = {
  client: 'border-blue-400 bg-blue-50 dark:bg-blue-900/30',
  job: 'border-green-400 bg-green-50 dark:bg-green-900/30',
  team: 'border-orange-400 bg-orange-50 dark:bg-orange-900/30',
  quote: 'border-purple-400 bg-purple-50 dark:bg-purple-900/30',
  invoice: 'border-cyan-400 bg-cyan-50 dark:bg-cyan-900/30',
};
const ENTITY_ICONS: Record<string, React.ElementType> = {
  client: User, job: Briefcase, team: Users, quote: FileText, invoice: DollarSign,
};

function EntityNode({ data }: { data: { type: string; label: string; detail?: string } }) {
  const Icon = ENTITY_ICONS[data.type] || Briefcase;
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} className="!bg-text-tertiary !w-1.5 !h-1.5" />
      <Handle type="source" position={Position.Right} className="!bg-text-tertiary !w-1.5 !h-1.5" />
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3 }}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${ENTITY_COLORS[data.type] || 'border-gray-300 bg-surface-secondary'}`}
      >
        <Icon size={11} className="text-text-secondary shrink-0" />
        <div className="min-w-0">
          <p className="text-[9px] font-semibold text-text-primary truncate max-w-[80px]">{data.label}</p>
          {data.detail && <p className="text-[7px] text-text-tertiary truncate max-w-[80px]">{data.detail}</p>}
        </div>
      </motion.div>
    </div>
  );
}

/* ── Scenario branch node ── */
function ScenarioBranchNode({ data }: { data: { option: ScenarioOption; revealed: boolean } }) {
  const { option, revealed } = data;
  if (!revealed) return null;
  const scoreColor = option.score >= 70 ? 'text-green-500' : option.score >= 45 ? 'text-amber-500' : 'text-red-400';

  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} className="!bg-text-tertiary !w-1.5 !h-1.5" />
      <motion.div
        initial={{ scale: 0, opacity: 0, x: -15 }}
        animate={{ scale: 1, opacity: 1, x: 0 }}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
        className={`rounded-xl border p-3 min-w-[160px] max-w-[200px] ${
          option.isWinner ? 'border-text-primary/40 bg-surface shadow-lg ring-1 ring-text-primary/10' : 'border-outline-subtle bg-surface'
        }`}
      >
        {option.isWinner && (
          <div className="flex items-center gap-1 mb-1.5">
            <Trophy size={9} className="text-amber-500" />
            <span className="text-[8px] font-bold text-amber-500 uppercase tracking-wider">WINNER</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <p className="text-[10px] font-semibold text-text-primary truncate flex-1">{option.label}</p>
          <span className={`text-sm font-bold tabular-nums ${scoreColor}`}>{option.score}</span>
        </div>
        {option.benefits?.slice(0, 1).map((b, i) => (
          <div key={i} className="flex items-start gap-1">
            <CheckCircle2 size={7} className="text-green-400 mt-0.5 shrink-0" />
            <span className="text-[8px] text-text-secondary truncate">{b}</span>
          </div>
        ))}
        {option.risks?.slice(0, 1).map((r, i) => (
          <div key={i} className="flex items-start gap-1 mt-0.5">
            <AlertTriangle size={7} className="text-red-400 mt-0.5 shrink-0" />
            <span className="text-[8px] text-text-tertiary truncate">{r}</span>
          </div>
        ))}
        <div className="mt-1.5 flex items-center gap-1">
          <div className="flex-1 h-0.5 rounded-full bg-surface-tertiary overflow-hidden">
            <motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }}
              animate={{ width: `${option.confidence * 100}%` }} transition={{ duration: 0.8, delay: 0.3 }} />
          </div>
          <span className="text-[7px] text-text-tertiary tabular-nums">{Math.round(option.confidence * 100)}%</span>
        </div>
      </motion.div>
    </div>
  );
}

/* ── Final recommendation node ── */
function RecommendationNode({ data }: { data: { label: string; score: number; visible: boolean } }) {
  if (!data.visible) return null;
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} className="!bg-primary !w-2 !h-2" />
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
        className="flex items-center gap-2 px-4 py-3 rounded-2xl border-2 border-text-primary/30 bg-surface shadow-xl"
      >
        <Sparkles size={16} className="text-text-primary shrink-0" />
        <div>
          <p className="text-[10px] font-bold text-text-primary">{data.label}</p>
          <p className="text-[8px] text-text-tertiary">Score {data.score}/100</p>
        </div>
      </motion.div>
    </div>
  );
}

const nodeTypes = {
  signal: SignalNode,
  check: CheckNode,
  panda: PandaNode,
  entity: EntityNode,
  scenarioBranch: ScenarioBranchNode,
  recommendation: RecommendationNode,
};

/* ═══════════════════════════════════════════════════════════════
   Live Graph Builder — builds progressively from agent state
   ═══════════════════════════════════════════════════════════════ */

const STATE_TO_LAYER: Record<string, number> = {
  understand: 1, fetch_context: 2, check_memory: 2,
  decide: 3, scenario_engine: 4, recommend: 5,
  await_approval: 5, execute: 6, log: 6, done: 6, error: 6,
};

function buildLiveGraph(
  currentState: AgentStateLabel | null,
  scenarioData: ScenarioResult | null,
  crmEntities: { type: string; label: string; detail?: string }[],
  revealedScenarios: number,
  showRecommendation: boolean,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const layer = STATE_TO_LAYER[currentState || ''] || 0;

  // ── Layer 1: Context signals (left side) ──
  const signals = [
    { id: 'sig-intent', label: 'Intent', x: 50, y: 180 },
    { id: 'sig-lang', label: 'Language', x: 50, y: 230 },
    { id: 'sig-perms', label: 'Permissions', x: 50, y: 280 },
    { id: 'sig-history', label: 'History', x: 50, y: 330 },
  ];

  signals.forEach(s => {
    nodes.push({
      id: s.id, type: 'signal', position: { x: s.x, y: s.y }, draggable: true,
      data: { label: s.label, active: layer === 1, done: layer > 1 },
    });
  });

  // ── Layer 2: CRM Data + Memory (check nodes) ──
  const checks = [
    { id: 'check-crm', label: 'CRM Data', icon: 'Database', y: 200, state: 'fetch_context' },
    { id: 'check-memory', label: 'Memory', icon: 'Brain', y: 300, state: 'check_memory' },
  ];

  checks.forEach(c => {
    const active = currentState === c.state;
    const done = layer > 2;
    nodes.push({
      id: c.id, type: 'check', position: { x: 200, y: c.y }, draggable: true,
      data: { label: c.label, icon: c.icon, active, done, detail: done ? `${crmEntities.length} found` : undefined },
    });
    // Connect signals to checks
    signals.forEach(s => {
      edges.push({ id: `e-${s.id}-${c.id}`, source: s.id, target: c.id, animated: active, style: { stroke: done ? '#a3e635' : '#d4d4d4', strokeWidth: 1 } });
    });
  });

  // CRM entity nodes (appear when fetch_context is done)
  if (layer >= 3 && crmEntities.length > 0) {
    crmEntities.slice(0, 6).forEach((ent, i) => {
      const id = `ent-${i}`;
      nodes.push({
        id, type: 'entity', position: { x: 120, y: 400 + i * 50 }, draggable: true,
        data: ent,
      });
      edges.push({ id: `e-${id}-check-crm`, source: id, target: 'check-crm', style: { stroke: '#d4d4d4', strokeWidth: 1 } });
    });
  }

  // ── Layer 3: Panda center (decision hub) ──
  nodes.push({
    id: 'panda', type: 'panda', position: { x: 400, y: 240 }, draggable: true,
    data: { active: layer >= 3 && layer < 5 },
  });

  checks.forEach(c => {
    edges.push({
      id: `e-${c.id}-panda`, source: c.id, target: 'panda', animated: layer === 3,
      style: { stroke: layer >= 3 ? 'var(--color-primary)' : 'var(--color-outline)', strokeWidth: layer >= 3 ? 2 : 1 },
    });
  });

  // Decision check
  if (layer >= 3) {
    nodes.push({
      id: 'check-decide', type: 'check', position: { x: 400, y: 380 }, draggable: true,
      data: { label: 'Decision', icon: 'Target', active: currentState === 'decide', done: layer > 3 },
    });
    edges.push({ id: 'e-panda-decide', source: 'panda', target: 'check-decide', sourceHandle: 'bottom', style: { stroke: 'var(--color-primary)', strokeWidth: 1.5 } });
  }

  // ── Layer 4: Scenario branches ──
  const scenarios = scenarioData?.options || [];
  if (layer >= 4 && scenarios.length > 0) {
    scenarios.forEach((option, i) => {
      const id = `scenario-${i}`;
      const yOffset = (i - (scenarios.length - 1) / 2) * 100;
      nodes.push({
        id, type: 'scenarioBranch', position: { x: 650, y: 240 + yOffset }, draggable: true,
        data: { option, revealed: i < revealedScenarios },
      });
      edges.push({
        id: `e-panda-${id}`, source: 'panda', target: id,
        animated: i < revealedScenarios && !showRecommendation,
        style: {
          stroke: option.isWinner && showRecommendation ? 'var(--color-primary)' : 'var(--color-outline)',
          strokeWidth: option.isWinner && showRecommendation ? 2.5 : 1.5,
          opacity: showRecommendation && !option.isWinner ? 0.3 : 1,
        },
      });
    });
  }

  // ── Layer 5: Final recommendation ──
  const winner = scenarios.find(o => o.isWinner) || scenarios[0];
  if (winner) {
    nodes.push({
      id: 'recommendation', type: 'recommendation', position: { x: 900, y: 240 }, draggable: true,
      data: { label: winner.label, score: winner.score, visible: showRecommendation },
    });
    if (showRecommendation) {
      const winnerId = `scenario-${scenarios.indexOf(winner)}`;
      edges.push({
        id: 'e-winner-rec', source: winnerId, target: 'recommendation',
        animated: true, style: { stroke: 'var(--color-primary)', strokeWidth: 2.5 },
      });
    }
  }

  return { nodes, edges };
}

/* ═══════════════════════════════════════════════════════════════
   Legend
   ═══════════════════════════════════════════════════════════════ */

function GraphLegend({ fr }: { fr: boolean }) {
  const items = [
    { color: 'bg-blue-400', label: 'Client' },
    { color: 'bg-green-400', label: 'Job' },
    { color: 'bg-orange-400', label: fr ? 'Equipe' : 'Team' },
    { color: 'bg-purple-400', label: fr ? 'Devis' : 'Quote' },
    { color: 'bg-surface-tertiary', label: 'Signal' },
    { color: 'bg-primary', label: fr ? 'Scenario' : 'Scenario' },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
      className="absolute bottom-4 left-4 z-10 rounded-xl bg-surface/90 backdrop-blur-sm border border-outline-subtle p-3">
      <p className="text-[8px] font-bold uppercase tracking-wider text-red-500 mb-1.5">{fr ? 'TYPES' : 'TYPES'}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {items.map(it => (
          <div key={it.label} className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${it.color}`} />
            <span className="text-[8px] text-text-secondary">{it.label}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Main Panel
   ═══════════════════════════════════════════════════════════════ */

interface PredictionGraphProps {
  open: boolean;
  onClose: () => void;
  scenarioData: ScenarioResult | null;
  question: string;
  currentState?: AgentStateLabel | null;
  crmEntities?: { type: string; label: string; detail?: string }[];
  language: 'en' | 'fr';
}

export default function PredictionGraph({
  open, onClose, scenarioData, question,
  currentState = null,
  crmEntities = [],
  language,
}: PredictionGraphProps) {
  const fr = language === 'fr';
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [revealedScenarios, setRevealedScenarios] = useState(0);
  const [showRecommendation, setShowRecommendation] = useState(false);

  // Progressive scenario reveal
  useEffect(() => {
    const count = scenarioData?.options?.length || 0;
    if (count === 0) { setRevealedScenarios(0); setShowRecommendation(false); return; }

    setRevealedScenarios(0);
    setShowRecommendation(false);

    let i = 0;
    const interval = setInterval(() => {
      i++;
      if (i <= count) {
        setRevealedScenarios(i);
      } else {
        setShowRecommendation(true);
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [scenarioData]);

  const { nodes, edges } = useMemo(
    () => buildLiveGraph(currentState, scenarioData, crmEntities, revealedScenarios, showRecommendation),
    [currentState, scenarioData, crmEntities, revealedScenarios, showRecommendation]
  );

  // Key changes force ReactFlow to re-render with new nodes/edges
  const graphKey = `${currentState}-${revealedScenarios}-${showRecommendation ? 1 : 0}-${nodes.length}`;

  const winner = scenarioData?.options?.find(o => o.isWinner) || scenarioData?.options?.[0];
  const isAnalyzing = currentState && currentState !== 'done' && currentState !== 'error';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
          className={`fixed z-50 bg-surface shadow-2xl flex flex-col ${
            isFullscreen ? 'inset-0' : 'inset-y-0 right-0 w-full max-w-4xl border-l border-outline-subtle'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-outline-subtle">
            <div className="flex items-center gap-3">
              <MrLumeAvatar size="sm" pulse={!!isAnalyzing} />
              <div>
                <h2 className="text-sm font-bold text-text-primary">
                  {fr ? 'Visualisation des predictions' : 'Prediction Visualization'}
                </h2>
                <p className="text-[10px] text-text-tertiary">
                  {isAnalyzing
                    ? fr ? 'Analyse en cours...' : 'Analyzing...'
                    : scenarioData
                      ? `${scenarioData.options?.length || 0} ${fr ? 'scenarios' : 'scenarios'} · ${(scenarioData.durationMs / 1000).toFixed(1)}s`
                      : fr ? 'En attente' : 'Waiting'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setIsFullscreen(!isFullscreen)}
                aria-label={isFullscreen ? 'Minimize' : 'Fullscreen'}
                className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors">
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button onClick={onClose} aria-label="Close"
                className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Graph */}
          <div className="flex-1 relative">
            <ReactFlow
              key={graphKey}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.2}
              maxZoom={2}
              nodesDraggable
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#e5e5e5" gap={24} size={1} />
            </ReactFlow>
            <GraphLegend fr={fr} />
          </div>

          {/* Bottom bar */}
          {winner && showRecommendation && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="px-5 py-3 border-t border-outline-subtle bg-surface-secondary flex items-center gap-3"
            >
              <Trophy size={16} className="text-amber-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-text-primary truncate">
                  {fr ? 'Recommandation' : 'Recommendation'}: {winner.label}
                </p>
                <p className="text-[10px] text-text-tertiary">
                  Score {winner.score}/100 · {fr ? 'Confiance' : 'Confidence'} {Math.round(winner.confidence * 100)}%
                </p>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
