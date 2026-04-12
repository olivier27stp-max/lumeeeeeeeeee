/* ═══════════════════════════════════════════════════════════════
   Memory Graph — Node Detail Side Panel
   Shows full detail when a node is clicked.
   ═══════════════════════════════════════════════════════════════ */

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, ExternalLink, AlertTriangle, Link2, FileText,
  Clock, Shield, Activity, Zap, ChevronRight, Search,
  BarChart3,
} from 'lucide-react';
import type { MemoryNodeDetail } from '../types';
import { NODE_TYPE_COLORS, NODE_TYPE_LABELS, EDGE_TYPE_LABELS, LAYER_LABELS } from '../types';

interface NodeDetailPanelProps {
  node: MemoryNodeDetail | null;
  isLoading: boolean;
  onClose: () => void;
  onNavigateToNode: (nodeId: string) => void;
  onLintNode: (nodeId: string) => void;
  isLintingNode: boolean;
  lintResult: any;
  language: 'en' | 'fr';
}

function timeAgo(date: string, fr: boolean): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return fr ? `${mins}min` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return fr ? `${hours}h` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return fr ? `${days}j` : `${days}d ago`;
  const months = Math.floor(days / 30);
  return fr ? `${months}mo` : `${months}mo ago`;
}

export default function NodeDetailPanel({
  node,
  isLoading,
  onClose,
  onNavigateToNode,
  onLintNode,
  isLintingNode,
  lintResult,
  language,
}: NodeDetailPanelProps) {
  const fr = language === 'fr';

  return (
    <AnimatePresence>
      {(node || isLoading) && (
        <motion.div
          initial={{ x: 380, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 380, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
          className="absolute right-0 top-0 bottom-0 w-[380px] bg-surface-card dark:bg-[#0e0e11] border-l border-outline dark:border-white/8 overflow-y-auto z-30 shadow-xl"
        >
          {isLoading ? (
            <div className="p-6 space-y-4">
              <div className="h-6 bg-surface-tertiary dark:bg-white/5 rounded animate-pulse w-48" />
              <div className="h-4 bg-surface-tertiary dark:bg-white/5 rounded animate-pulse w-32" />
              <div className="h-20 bg-surface-tertiary dark:bg-white/5 rounded animate-pulse" />
            </div>
          ) : node ? (
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="p-4 border-b border-outline dark:border-white/6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div
                      className="w-3 h-3 rounded-full shrink-0 mt-1"
                      style={{ backgroundColor: NODE_TYPE_COLORS[node.node_type] }}
                    />
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-semibold text-text-primary truncate">{node.label}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-text-tertiary capitalize">
                          {NODE_TYPE_LABELS[node.node_type]?.[language] || node.node_type.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-tertiary dark:bg-white/6 text-text-secondary">
                          {LAYER_LABELS[node.memory_layer]?.[language] || node.memory_layer}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button onClick={onClose} className="p-1 rounded hover:bg-surface-tertiary dark:hover:bg-white/6 text-text-tertiary">
                    <X size={16} />
                  </button>
                </div>

                {node.description && (
                  <p className="mt-2.5 text-[12px] text-text-secondary leading-relaxed">{node.description}</p>
                )}
              </div>

              {/* Metrics */}
              <div className="p-4 border-b border-outline dark:border-white/6">
                <div className="grid grid-cols-3 gap-3">
                  <MetricCard label={fr ? 'Confiance' : 'Confidence'} value={`${(Number(node.confidence) * 100).toFixed(0)}%`} color={Number(node.confidence) > 0.7 ? 'emerald' : Number(node.confidence) > 0.4 ? 'amber' : 'red'} />
                  <MetricCard label={fr ? 'Importance' : 'Importance'} value={`${(Number(node.importance) * 100).toFixed(0)}%`} color={Number(node.importance) > 0.7 ? 'emerald' : 'amber'} />
                  <MetricCard label={fr ? 'Connexions' : 'Connections'} value={`${node.neighbors.length}`} color="blue" />
                </div>
                <div className="flex items-center gap-4 mt-3 text-[11px] text-text-tertiary">
                  <span className="flex items-center gap-1"><Clock size={11} /> {fr ? 'Mis à jour' : 'Updated'}: {timeAgo(node.freshness_at, fr)}</span>
                  <span className="flex items-center gap-1"><FileText size={11} /> {node.source_count} source{node.source_count !== 1 ? 's' : ''}</span>
                </div>
                {node.is_orphan && (
                  <div className="mt-2 px-2 py-1 rounded bg-warning-light dark:bg-warning/10 text-[11px] text-warning flex items-center gap-1.5">
                    <AlertTriangle size={12} /> {fr ? 'Nœud orphelin — aucune connexion' : 'Orphan node — no connections'}
                  </div>
                )}
              </div>

              {/* Connected Nodes */}
              {node.neighbors.length > 0 && (
                <div className="p-4 border-b border-outline dark:border-white/6">
                  <h4 className="text-[12px] font-semibold text-text-primary mb-2 flex items-center gap-1.5">
                    <Link2 size={13} /> {fr ? 'Nœuds reliés' : 'Connected Nodes'} ({node.neighbors.length})
                  </h4>
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {node.neighbors.map(({ node: neighbor, edge, direction }) => (
                      <button
                        key={`${edge.id}-${neighbor.id}`}
                        onClick={() => onNavigateToNode(neighbor.id)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-tertiary dark:hover:bg-white/4 text-left group transition-colors"
                      >
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: NODE_TYPE_COLORS[neighbor.node_type] }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] text-text-primary truncate">{neighbor.label}</div>
                          <div className="text-[10px] text-text-muted">
                            {direction === 'outgoing' ? '→' : '←'}{' '}
                            {EDGE_TYPE_LABELS[edge.relation_type]?.[language] || edge.relation_type.replace(/_/g, ' ')}
                          </div>
                        </div>
                        <ChevronRight size={12} className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Conflicts */}
              {node.conflicts.length > 0 && (
                <div className="p-4 border-b border-outline dark:border-white/6">
                  <h4 className="text-[12px] font-semibold text-danger mb-2 flex items-center gap-1.5">
                    <AlertTriangle size={13} /> {fr ? 'Contradictions' : 'Conflicts'} ({node.conflicts.length})
                  </h4>
                  <div className="space-y-1.5">
                    {node.conflicts.map((c) => (
                      <div key={c.id} className="px-2 py-1.5 rounded-md bg-danger-light dark:bg-danger/8 text-[11px] text-text-secondary">
                        <div className="font-medium text-danger">{c.conflict_type}</div>
                        {c.description && <div className="mt-0.5">{c.description}</div>}
                        {c.resolved && <span className="text-success text-[10px]">{fr ? 'Résolu' : 'Resolved'}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sources */}
              {node.sources.length > 0 && (
                <div className="p-4 border-b border-outline dark:border-white/6">
                  <h4 className="text-[12px] font-semibold text-text-primary mb-2 flex items-center gap-1.5">
                    <FileText size={13} /> Sources ({node.sources.length})
                  </h4>
                  <div className="space-y-1.5">
                    {node.sources.map((s) => (
                      <div key={s.id} className="px-2 py-1.5 rounded-md bg-surface-tertiary dark:bg-white/3 text-[11px]">
                        <div className="font-medium text-text-secondary">{s.source_label || s.source_type}</div>
                        {s.excerpt && <div className="text-text-muted mt-0.5 truncate">{s.excerpt}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Activity */}
              {node.logs.length > 0 && (
                <div className="p-4 border-b border-outline dark:border-white/6">
                  <h4 className="text-[12px] font-semibold text-text-primary mb-2 flex items-center gap-1.5">
                    <Activity size={13} /> {fr ? 'Historique récent' : 'Recent Activity'}
                  </h4>
                  <div className="space-y-1 max-h-[160px] overflow-y-auto">
                    {node.logs.slice(0, 10).map((log) => (
                      <div key={log.id} className="flex items-start gap-2 text-[11px]">
                        <span className="text-text-muted shrink-0 w-[48px]">{timeAgo(log.created_at, fr)}</span>
                        <span className="text-text-secondary">{log.description || log.event_type}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="p-4 space-y-2 mt-auto">
                <button
                  onClick={() => onLintNode(node.id)}
                  disabled={isLintingNode}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-surface-tertiary dark:bg-white/6 hover:bg-surface-secondary dark:hover:bg-white/10 text-[12px] font-medium text-text-primary transition-colors disabled:opacity-50"
                >
                  <Search size={13} />
                  {isLintingNode
                    ? (fr ? 'Analyse en cours…' : 'Linting…')
                    : (fr ? 'Lint mémoire ciblé' : 'Lint this node')}
                </button>

                {lintResult && lintResult.nodeId === node.id && (
                  <div className={`mt-2 p-2.5 rounded-lg text-[11px] ${
                    lintResult.health === 'healthy' ? 'bg-success-light dark:bg-success/10 text-success' :
                    lintResult.health === 'warning' ? 'bg-warning-light dark:bg-warning/10 text-warning' :
                    'bg-danger-light dark:bg-danger/10 text-danger'
                  }`}>
                    <div className="font-semibold mb-1 flex items-center gap-1">
                      <Shield size={12} />
                      {lintResult.health === 'healthy' ? (fr ? 'Sain' : 'Healthy') :
                       lintResult.health === 'warning' ? (fr ? 'Attention' : 'Warning') :
                       (fr ? 'Critique' : 'Critical')}
                    </div>
                    {lintResult.issues?.map((issue: string, i: number) => (
                      <div key={i} className="ml-3">• {issue}</div>
                    ))}
                    {lintResult.suggestions?.map((s: string, i: number) => (
                      <div key={i} className="ml-3 text-text-secondary mt-0.5">→ {s}</div>
                    ))}
                  </div>
                )}

                {node.metadata?.crm_id && (
                  <button
                    onClick={() => {
                      const type = node.node_type;
                      const id = node.metadata.crm_id as string;
                      const routes: Record<string, string> = {
                        client: `/clients/${id}`,
                        job: `/jobs/${id}`,
                        invoice: `/invoices/${id}`,
                        quote: `/quotes/${id}`,
                      };
                      if (routes[type]) window.location.hash = routes[type];
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary dark:bg-white/10 text-white dark:text-text-primary text-[12px] font-medium hover:opacity-90 transition-opacity"
                  >
                    <ExternalLink size={13} />
                    {fr ? 'Ouvrir dans le CRM' : 'Open in CRM'}
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-success',
    amber: 'text-warning',
    red: 'text-danger',
    blue: 'text-info',
  };
  return (
    <div className="text-center p-2 rounded-lg bg-surface-tertiary dark:bg-white/4">
      <div className={`text-[16px] font-bold ${colorMap[color] || 'text-text-primary'}`}>{value}</div>
      <div className="text-[10px] text-text-muted mt-0.5">{label}</div>
    </div>
  );
}
