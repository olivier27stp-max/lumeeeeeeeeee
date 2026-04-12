/* ═══════════════════════════════════════════════════════════════
   Memory Graph — Analytics Widgets
   Bottom panel with memory health insights.
   ═══════════════════════════════════════════════════════════════ */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronUp, ChevronDown, BarChart3, AlertTriangle,
  Unlink, Clock, Brain, Activity, TrendingUp, Shield,
  Zap,
} from 'lucide-react';
import type { MemoryGraphStats, MemoryLog, MemoryNodeType } from '../types';
import { NODE_TYPE_COLORS, NODE_TYPE_LABELS, LAYER_LABELS } from '../types';

interface MemoryAnalyticsProps {
  stats: MemoryGraphStats | null;
  logs: MemoryLog[];
  onNavigateToNode: (nodeId: string) => void;
  language: 'en' | 'fr';
}

function timeAgo(date: string, fr: boolean): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return fr ? `${mins}min` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return fr ? `${hours}h` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return fr ? `${days}j` : `${days}d`;
}

export default function MemoryAnalytics({
  stats,
  logs,
  onNavigateToNode,
  language,
}: MemoryAnalyticsProps) {
  const fr = language === 'fr';
  const [expanded, setExpanded] = useState(false);

  if (!stats) return null;

  return (
    <div className="border-t border-outline dark:border-white/6 bg-surface-card dark:bg-[#0e0e11]">
      {/* Toggle bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-surface-tertiary dark:hover:bg-white/3 transition-colors"
      >
        <div className="flex items-center gap-3">
          <BarChart3 size={14} className="text-text-tertiary" />
          <span className="text-[12px] font-semibold text-text-primary">
            {fr ? 'Analytique mémoire' : 'Memory Analytics'}
          </span>
          <div className="flex items-center gap-3 text-[10px] text-text-muted">
            <span>{stats.total_nodes} {fr ? 'nœuds' : 'nodes'}</span>
            <span>{stats.total_edges} {fr ? 'liens' : 'edges'}</span>
            {stats.orphan_count > 0 && (
              <span className="text-warning">{stats.orphan_count} {fr ? 'orphelins' : 'orphans'}</span>
            )}
            {stats.conflict_count > 0 && (
              <span className="text-danger">{stats.conflict_count} {fr ? 'conflits' : 'conflicts'}</span>
            )}
            {stats.stale_count > 0 && (
              <span className="text-text-muted">{stats.stale_count} {fr ? 'périmés' : 'stale'}</span>
            )}
          </div>
        </div>
        {expanded ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronUp size={14} className="text-text-muted" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {/* Health Cards */}
              <StatCard
                icon={<BarChart3 size={14} />}
                label={fr ? 'Total nœuds' : 'Total Nodes'}
                value={stats.total_nodes}
                color="text-text-primary"
              />
              <StatCard
                icon={<Activity size={14} />}
                label={fr ? 'Total liens' : 'Total Edges'}
                value={stats.total_edges}
                color="text-info"
              />
              <StatCard
                icon={<Unlink size={14} />}
                label={fr ? 'Orphelins' : 'Orphans'}
                value={stats.orphan_count}
                color={stats.orphan_count > 5 ? 'text-warning' : 'text-text-secondary'}
              />
              <StatCard
                icon={<AlertTriangle size={14} />}
                label={fr ? 'Conflits' : 'Conflicts'}
                value={stats.conflict_count}
                color={stats.conflict_count > 0 ? 'text-danger' : 'text-success'}
              />
              <StatCard
                icon={<Shield size={14} />}
                label={fr ? 'Confiance moy.' : 'Avg Confidence'}
                value={`${(stats.avg_confidence * 100).toFixed(0)}%`}
                color={stats.avg_confidence > 0.7 ? 'text-success' : 'text-warning'}
              />
              <StatCard
                icon={<Clock size={14} />}
                label={fr ? 'Périmés' : 'Stale'}
                value={stats.stale_count}
                color={stats.stale_count > 10 ? 'text-warning' : 'text-text-secondary'}
              />

              {/* Top Hubs */}
              <div className="col-span-2 md:col-span-2 p-3 rounded-lg bg-surface-tertiary dark:bg-white/3">
                <h5 className="text-[11px] font-semibold text-text-primary mb-2 flex items-center gap-1.5">
                  <Brain size={12} /> {fr ? 'Top hubs mémoire' : 'Top Memory Hubs'}
                </h5>
                <div className="space-y-1">
                  {stats.top_hubs.slice(0, 5).map((hub) => (
                    <button
                      key={hub.id}
                      onClick={() => onNavigateToNode(hub.id)}
                      className="w-full flex items-center gap-2 text-left hover:bg-surface-secondary dark:hover:bg-white/4 px-1.5 py-1 rounded transition-colors"
                    >
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: NODE_TYPE_COLORS[hub.node_type as MemoryNodeType] || '#6366F1' }}
                      />
                      <span className="text-[11px] text-text-secondary flex-1 truncate">{hub.label}</span>
                      <span className="text-[10px] text-text-muted">{hub.degree} links</span>
                    </button>
                  ))}
                  {stats.top_hubs.length === 0 && (
                    <span className="text-[10px] text-text-muted">{fr ? 'Aucun hub' : 'No hubs yet'}</span>
                  )}
                </div>
              </div>

              {/* Type Distribution */}
              <div className="col-span-2 md:col-span-2 p-3 rounded-lg bg-surface-tertiary dark:bg-white/3">
                <h5 className="text-[11px] font-semibold text-text-primary mb-2 flex items-center gap-1.5">
                  <TrendingUp size={12} /> {fr ? 'Distribution par type' : 'Type Distribution'}
                </h5>
                <div className="space-y-1">
                  {Object.entries(stats.type_counts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([type, count]) => (
                      <div key={type} className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: NODE_TYPE_COLORS[type as MemoryNodeType] || '#6366F1' }}
                        />
                        <span className="text-[10px] text-text-secondary flex-1">{NODE_TYPE_LABELS[type as MemoryNodeType]?.[language] || type}</span>
                        <div className="flex-1 max-w-[80px] h-1.5 rounded-full bg-surface-secondary dark:bg-white/6 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(100, (count / stats.total_nodes) * 100)}%`,
                              backgroundColor: NODE_TYPE_COLORS[type as MemoryNodeType] || '#6366F1',
                            }}
                          />
                        </div>
                        <span className="text-[10px] text-text-muted w-6 text-right">{count}</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Recent Activity */}
              <div className="col-span-2 p-3 rounded-lg bg-surface-tertiary dark:bg-white/3">
                <h5 className="text-[11px] font-semibold text-text-primary mb-2 flex items-center gap-1.5">
                  <Zap size={12} /> {fr ? 'Activité récente' : 'Recent Activity'}
                </h5>
                <div className="space-y-1 max-h-[100px] overflow-y-auto">
                  {logs.slice(0, 8).map((log) => (
                    <div key={log.id} className="flex items-start gap-2 text-[10px]">
                      <span className="text-text-muted shrink-0 w-[32px]">{timeAgo(log.created_at, fr)}</span>
                      <span className="text-text-secondary truncate">{log.description || log.event_type}</span>
                    </div>
                  ))}
                  {logs.length === 0 && (
                    <span className="text-[10px] text-text-muted">{fr ? 'Aucune activité' : 'No activity yet'}</span>
                  )}
                </div>
              </div>

              {/* Layer Distribution */}
              <div className="col-span-2 md:col-span-2 p-3 rounded-lg bg-surface-tertiary dark:bg-white/3">
                <h5 className="text-[11px] font-semibold text-text-primary mb-2 flex items-center gap-1.5">
                  <Shield size={12} /> {fr ? 'Couches mémoire' : 'Memory Layers'}
                </h5>
                <div className="space-y-1.5">
                  {(['conversation', 'client', 'company', 'agentic'] as const).map((layer) => {
                    const count = stats.layer_counts[layer] || 0;
                    const pct = stats.total_nodes > 0 ? (count / stats.total_nodes * 100) : 0;
                    return (
                      <div key={layer} className="flex items-center gap-2">
                        <span className="text-[10px] text-text-secondary w-24">{LAYER_LABELS[layer][language]}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-surface-secondary dark:bg-white/6 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-text-primary dark:bg-white/30"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-text-muted w-8 text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Contradictions */}
              {stats.recent_conflicts.length > 0 && (
                <div className="col-span-2 p-3 rounded-lg bg-danger-light dark:bg-danger/5 border border-danger/20">
                  <h5 className="text-[11px] font-semibold text-danger mb-2 flex items-center gap-1.5">
                    <AlertTriangle size={12} /> {fr ? 'Contradictions récentes' : 'Recent Contradictions'}
                  </h5>
                  <div className="space-y-1">
                    {stats.recent_conflicts.slice(0, 4).map((c) => (
                      <div key={c.id} className="text-[10px] text-text-secondary">
                        <span className="font-medium text-danger">{c.conflict_type}</span>
                        {c.description && <span className="ml-1.5">{c.description}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className="p-3 rounded-lg bg-surface-tertiary dark:bg-white/3 flex flex-col items-center text-center">
      <div className={`${color} mb-1`}>{icon}</div>
      <div className={`text-[18px] font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-text-muted mt-0.5">{label}</div>
    </div>
  );
}
