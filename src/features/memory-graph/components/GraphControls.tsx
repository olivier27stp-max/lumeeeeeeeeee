/* ═══════════════════════════════════════════════════════════════
   Memory Graph — Controls & Filters Bar
   Top bar with view modes, filters, search, and actions.
   ═══════════════════════════════════════════════════════════════ */

import React, { useState } from 'react';
import {
  Search, Filter, RefreshCw, ZapOff, Zap, Eye, EyeOff,
  Globe, Building2, User, Brain, AlertTriangle, Unlink,
  Clock, Loader2, RotateCcw, ChevronDown,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import type {
  MemoryGraphFilters, GraphViewMode, MemoryNodeType, MemoryLayer,
} from '../types';
import {
  VIEW_MODE_LABELS, NODE_TYPE_COLORS, NODE_TYPE_LABELS,
  MEMORY_NODE_TYPES, MEMORY_LAYERS, LAYER_LABELS,
} from '../types';

interface GraphControlsProps {
  filters: MemoryGraphFilters;
  updateFilter: <K extends keyof MemoryGraphFilters>(key: K, value: MemoryGraphFilters[K]) => void;
  setViewMode: (mode: GraphViewMode) => void;
  toggleNodeType: (type: MemoryNodeType) => void;
  resetFilters: () => void;
  onBuild: () => void;
  onLint: () => void;
  isBuilding: boolean;
  isLinting: boolean;
  isLocalView: boolean;
  onExitLocalView: () => void;
  nodeCount: number;
  edgeCount: number;
  language: 'en' | 'fr';
}

const VIEW_MODE_ICONS: Record<GraphViewMode, React.ReactNode> = {
  global:          <Globe size={13} />,
  company:         <Building2 size={13} />,
  client:          <User size={13} />,
  agentic:         <Brain size={13} />,
  contradictions:  <AlertTriangle size={13} />,
  orphans:         <Unlink size={13} />,
  recent:          <Clock size={13} />,
};

export default function GraphControls({
  filters,
  updateFilter,
  setViewMode,
  toggleNodeType,
  resetFilters,
  onBuild,
  onLint,
  isBuilding,
  isLinting,
  isLocalView,
  onExitLocalView,
  nodeCount,
  edgeCount,
  language,
}: GraphControlsProps) {
  const fr = language === 'fr';
  const [showTypeFilter, setShowTypeFilter] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="flex flex-col gap-2 p-3 bg-surface-card dark:bg-[#0e0e11] border-b border-outline dark:border-white/6">
      {/* Row 1: View modes */}
      <div className="flex items-center gap-1 flex-wrap">
        {(Object.keys(VIEW_MODE_LABELS) as GraphViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all',
              filters.viewMode === mode
                ? 'bg-primary dark:bg-white/12 text-white dark:text-text-primary shadow-sm'
                : 'text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary dark:hover:bg-white/5',
            )}
          >
            {VIEW_MODE_ICONS[mode]}
            <span className="hidden sm:inline">{VIEW_MODE_LABELS[mode][language]}</span>
          </button>
        ))}

        {isLocalView && (
          <button
            onClick={onExitLocalView}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-info/10 text-info hover:bg-info/20 transition-colors ml-1"
          >
            <RotateCcw size={12} />
            {fr ? 'Vue globale' : 'Back to global'}
          </button>
        )}
      </div>

      {/* Row 2: Search + actions */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 max-w-[280px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            placeholder={fr ? 'Rechercher dans la mémoire…' : 'Search memory…'}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface-tertiary dark:bg-white/5 text-[12px] text-text-primary placeholder:text-text-muted border border-transparent focus:border-outline dark:focus:border-white/10 outline-none transition-colors"
          />
        </div>

        {/* Node type filter */}
        <div className="relative">
          <button
            onClick={() => { setShowTypeFilter(!showTypeFilter); setShowAdvanced(false); }}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors',
              filters.nodeTypes.length > 0
                ? 'bg-info/10 text-info'
                : 'text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary dark:hover:bg-white/5',
            )}
          >
            <Filter size={12} />
            {fr ? 'Types' : 'Types'}
            {filters.nodeTypes.length > 0 && (
              <span className="text-[9px] bg-info/20 px-1 rounded">{filters.nodeTypes.length}</span>
            )}
            <ChevronDown size={10} />
          </button>

          {showTypeFilter && (
            <div className="absolute top-full left-0 mt-1 z-50 w-[240px] max-h-[300px] overflow-y-auto rounded-lg bg-surface-card dark:bg-[#141417] border border-outline dark:border-white/10 shadow-dropdown p-2">
              {MEMORY_NODE_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => toggleNodeType(type)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] text-left transition-colors',
                    filters.nodeTypes.includes(type)
                      ? 'bg-surface-tertiary dark:bg-white/6 text-text-primary'
                      : 'text-text-secondary hover:bg-surface-tertiary dark:hover:bg-white/4',
                  )}
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_TYPE_COLORS[type] }} />
                  <span>{NODE_TYPE_LABELS[type][language]}</span>
                  {filters.nodeTypes.includes(type) && <span className="ml-auto text-info">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Advanced filters toggle */}
        <button
          onClick={() => { setShowAdvanced(!showAdvanced); setShowTypeFilter(false); }}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors',
            showAdvanced ? 'bg-surface-tertiary dark:bg-white/6 text-text-primary' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary dark:hover:bg-white/5',
          )}
        >
          <Zap size={12} /> {fr ? 'Avancé' : 'Advanced'}
        </button>

        {/* Hide weak */}
        <button
          onClick={() => updateFilter('hideWeak', !filters.hideWeak)}
          title={fr ? 'Masquer les nœuds faibles' : 'Hide weak nodes'}
          className={cn(
            'p-1.5 rounded-lg transition-colors',
            filters.hideWeak ? 'bg-warning/10 text-warning' : 'text-text-muted hover:text-text-primary hover:bg-surface-tertiary dark:hover:bg-white/5',
          )}
        >
          {filters.hideWeak ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>

        {/* Spacer + stats */}
        <div className="flex-1" />
        <span className="text-[10px] text-text-muted hidden md:block">
          {nodeCount} {fr ? 'nœuds' : 'nodes'} · {edgeCount} {fr ? 'liens' : 'edges'}
        </span>

        {/* Build */}
        <button
          onClick={onBuild}
          disabled={isBuilding}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-primary dark:bg-white/10 text-white dark:text-text-primary hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {isBuilding ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {isBuilding ? (fr ? 'Build…' : 'Building…') : 'Build'}
        </button>

        {/* Lint */}
        <button
          onClick={onLint}
          disabled={isLinting}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-surface-tertiary dark:bg-white/6 text-text-primary hover:bg-surface-secondary dark:hover:bg-white/10 transition-colors disabled:opacity-50"
        >
          {isLinting ? <Loader2 size={12} className="animate-spin" /> : <ZapOff size={12} />}
          Lint
        </button>

        {/* Reset */}
        <button
          onClick={resetFilters}
          title={fr ? 'Réinitialiser les filtres' : 'Reset filters'}
          className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-tertiary dark:hover:bg-white/5 transition-colors"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      {/* Advanced filters row */}
      {showAdvanced && (
        <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-outline/50 dark:border-white/4">
          {/* Confidence slider */}
          <label className="flex items-center gap-2 text-[11px] text-text-secondary">
            {fr ? 'Confiance min' : 'Min confidence'}
            <input
              type="range"
              min={0} max={1} step={0.1}
              value={filters.minConfidence}
              onChange={(e) => updateFilter('minConfidence', Number(e.target.value))}
              className="w-20 h-1 accent-info"
            />
            <span className="text-text-muted w-8">{(filters.minConfidence * 100).toFixed(0)}%</span>
          </label>

          {/* Importance slider */}
          <label className="flex items-center gap-2 text-[11px] text-text-secondary">
            {fr ? 'Importance min' : 'Min importance'}
            <input
              type="range"
              min={0} max={1} step={0.1}
              value={filters.minImportance}
              onChange={(e) => updateFilter('minImportance', Number(e.target.value))}
              className="w-20 h-1 accent-info"
            />
            <span className="text-text-muted w-8">{(filters.minImportance * 100).toFixed(0)}%</span>
          </label>

          {/* Freshness */}
          <label className="flex items-center gap-2 text-[11px] text-text-secondary">
            {fr ? 'Fraîcheur' : 'Freshness'}
            <select
              value={filters.freshnessRange}
              onChange={(e) => updateFilter('freshnessRange', e.target.value as any)}
              className="px-2 py-1 rounded bg-surface-tertiary dark:bg-white/5 text-[11px] text-text-primary border-0 outline-none"
            >
              <option value="all">{fr ? 'Tout' : 'All time'}</option>
              <option value="24h">{fr ? '24h' : '24h'}</option>
              <option value="7d">{fr ? '7 jours' : '7 days'}</option>
              <option value="30d">{fr ? '30 jours' : '30 days'}</option>
              <option value="90d">{fr ? '90 jours' : '90 days'}</option>
            </select>
          </label>

          {/* Layer filter */}
          <div className="flex items-center gap-1">
            {MEMORY_LAYERS.map((layer) => (
              <button
                key={layer}
                onClick={() => {
                  const layers = filters.layers.includes(layer)
                    ? filters.layers.filter(l => l !== layer)
                    : [...filters.layers, layer];
                  updateFilter('layers', layers);
                }}
                className={cn(
                  'px-2 py-1 rounded text-[10px] font-medium transition-colors',
                  filters.layers.includes(layer)
                    ? 'bg-info/10 text-info'
                    : 'text-text-muted hover:text-text-secondary hover:bg-surface-tertiary dark:hover:bg-white/4',
                )}
              >
                {LAYER_LABELS[layer][language]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
