import React, { useState } from 'react';
import {
  X, Search, UserPlus, FileText, Star, MapPin, CreditCard,
  AlertCircle, Zap, Play, CheckSquare, Clock, GitBranch,
  ChevronRight, Sparkles, Timer, Receipt, Briefcase,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { WORKFLOW_PRESETS, PRESET_CATEGORIES, type WorkflowPreset } from '../../lib/workflowPresets';
import { useTranslation } from '../i18n';

const ICON_MAP: Record<string, typeof Zap> = {
  UserPlus, FileText, Star, MapPin, CreditCard, AlertCircle, Zap,
  Play, CheckSquare, Clock, GitBranch, Timer, Receipt, Briefcase,
  CheckCircle: CheckSquare,
  AlertTriangle: AlertCircle,
  UserMinus: UserPlus,
};

function getIcon(name: string) {
  return ICON_MAP[name] || Zap;
}

const CATEGORY_COLORS: Record<string, string> = {
  lead: 'bg-surface-tertiary text-text-secondary',
  estimate: 'bg-surface-tertiary text-text-secondary',
  invoice: 'bg-surface-tertiary text-text-secondary',
  job: 'bg-surface-tertiary text-text-secondary',
  review: 'bg-surface-tertiary text-text-secondary',
  field: 'bg-surface-tertiary text-text-secondary',
  payment: 'bg-surface-tertiary text-text-secondary',
};

interface PresetLibraryProps {
  open: boolean;
  onClose: () => void;
  onSelect: (preset: WorkflowPreset) => void;
  fr: boolean;
}

export default function PresetLibrary({ open, onClose, onSelect, fr }: PresetLibraryProps) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<WorkflowPreset | null>(null);

  const filtered = WORKFLOW_PRESETS.filter((p) => {
    const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase());
    const matchesCat = !activeCategory || p.category === activeCategory;
    return matchesSearch && matchesCat;
  });

  const nodeTypeCounts = (preset: WorkflowPreset) => {
    const triggers = preset.nodes.filter((n) => n.node_type === 'trigger').length;
    const conditions = preset.nodes.filter((n) => n.node_type === 'condition').length;
    const actions = preset.nodes.filter((n) => n.node_type === 'action').length;
    const delays = preset.nodes.filter((n) => n.node_type === 'delay').length;
    return { triggers, conditions, actions, delays };
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            className="bg-surface border border-outline rounded-2xl shadow-2xl w-[720px] max-h-[600px] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-outline flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Sparkles size={16} className="text-primary" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-text-primary">
                    {t.workflows.presetLibrary}
                  </h2>
                  <p className="text-[11px] text-text-tertiary">
                    {fr ? 'Workflows prêts à l\'emploi pour votre entreprise' : 'Ready-to-use workflows for your business'}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-secondary transition-colors">
                <X size={16} className="text-text-tertiary" />
              </button>
            </div>

            {/* Search + Categories */}
            <div className="px-6 py-3 border-b border-outline/50 space-y-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                <input
                  type="text"
                  placeholder={t.workflows.searchPresets}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="glass-input w-full pl-9 text-[12px] py-2"
                />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <button
                  onClick={() => setActiveCategory(null)}
                  className={cn(
                    'text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors',
                    !activeCategory ? 'bg-text-primary text-surface' : 'text-text-tertiary hover:bg-surface-secondary'
                  )}
                >
                  {t.automations.all}
                </button>
                {PRESET_CATEGORIES.map((cat) => {
                  const CatIcon = getIcon(cat.icon);
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(activeCategory === cat.id ? null : cat.id)}
                      className={cn(
                        'text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1',
                        activeCategory === cat.id ? 'bg-text-primary text-surface' : 'text-text-tertiary hover:bg-surface-secondary'
                      )}
                    >
                      <CatIcon size={11} />
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preset list */}
            <div className="flex-1 overflow-y-auto px-6 py-3">
              {selectedPreset ? (
                /* Detail view */
                <div>
                  <button
                    onClick={() => setSelectedPreset(null)}
                    className="text-[11px] text-text-tertiary hover:text-text-primary flex items-center gap-1 mb-3 transition-colors"
                  >
                    <ChevronRight size={11} className="rotate-180" />
                    {t.workflows.backToList}
                  </button>

                  <div className="flex items-start gap-3 mb-4">
                    <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', CATEGORY_COLORS[selectedPreset.category])}>
                      {React.createElement(getIcon(selectedPreset.icon), { size: 18 })}
                    </div>
                    <div className="flex-1">
                      <h3 className="text-[14px] font-bold text-text-primary">{selectedPreset.name}</h3>
                      <p className="text-[12px] text-text-secondary mt-0.5">{selectedPreset.description}</p>
                    </div>
                  </div>

                  {/* Node breakdown */}
                  <div className="bg-surface-secondary rounded-xl p-4 mb-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-3">
                      {t.workflows.workflowSteps}
                    </p>
                    <div className="space-y-2">
                      {selectedPreset.nodes.map((node, idx) => {
                        const NodeIcon = node.node_type === 'trigger' ? Zap
                          : node.node_type === 'condition' ? GitBranch
                          : node.node_type === 'delay' ? Timer
                          : Play;
                        const typeColor = node.node_type === 'trigger' ? 'text-text-primary'
                          : node.node_type === 'condition' ? 'text-text-secondary'
                          : node.node_type === 'delay' ? 'text-text-secondary'
                          : 'text-text-secondary';

                        return (
                          <div key={node.id} className="flex items-center gap-2.5">
                            <span className="text-[10px] font-bold text-text-tertiary w-4 text-right">{idx + 1}</span>
                            <div className={cn('w-5 h-5 rounded-md flex items-center justify-center',
                              node.node_type === 'trigger' ? 'bg-surface-tertiary' :
                              node.node_type === 'condition' ? 'bg-surface-tertiary' :
                              node.node_type === 'delay' ? 'bg-surface-tertiary' :
                              'bg-surface-tertiary'
                            )}>
                              <NodeIcon size={10} className={typeColor} />
                            </div>
                            <div className="flex-1">
                              <span className="text-[12px] font-medium text-text-primary">{node.label}</span>
                              <span className={cn('ml-2 text-[9px] font-bold uppercase', typeColor)}>
                                {node.node_type}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    onClick={() => onSelect(selectedPreset)}
                    className="glass-button-primary w-full py-2.5 text-[13px] font-semibold flex items-center justify-center gap-2"
                  >
                    <Play size={14} />
                    {t.workflows.useThisPreset}
                  </button>
                </div>
              ) : (
                /* Grid view */
                <div className="grid grid-cols-2 gap-3">
                  {filtered.map((preset) => {
                    const PresetIcon = getIcon(preset.icon);
                    const counts = nodeTypeCounts(preset);
                    return (
                      <button
                        key={preset.id}
                        onClick={() => setSelectedPreset(preset)}
                        className="text-left p-4 rounded-xl border border-outline hover:border-primary/30 hover:shadow-sm transition-all group bg-surface"
                      >
                        <div className="flex items-start gap-2.5 mb-2.5">
                          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', CATEGORY_COLORS[preset.category])}>
                            <PresetIcon size={15} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-[12px] font-bold text-text-primary truncate group-hover:text-primary transition-colors">
                              {preset.name}
                            </h4>
                            <span className={cn('text-[9px] font-bold uppercase', CATEGORY_COLORS[preset.category]?.split(' ')[1])}>
                              {preset.category}
                            </span>
                          </div>
                          <ChevronRight size={12} className="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 shrink-0" />
                        </div>
                        <p className="text-[11px] text-text-secondary leading-relaxed mb-3 line-clamp-2">
                          {preset.description}
                        </p>
                        <div className="flex items-center gap-2 text-[9px] text-text-tertiary font-medium">
                          <span className="flex items-center gap-0.5"><Zap size={8} />{counts.triggers}</span>
                          {counts.conditions > 0 && <span className="flex items-center gap-0.5"><GitBranch size={8} />{counts.conditions}</span>}
                          {counts.delays > 0 && <span className="flex items-center gap-0.5"><Timer size={8} />{counts.delays}</span>}
                          <span className="flex items-center gap-0.5"><Play size={8} />{counts.actions}</span>
                          <span className="ml-auto">{preset.nodes.length} {t.workflows.steps}</span>
                        </div>
                      </button>
                    );
                  })}

                  {filtered.length === 0 && (
                    <div className="col-span-2 text-center py-10">
                      <Search size={20} className="mx-auto text-text-tertiary mb-2 opacity-30" />
                      <p className="text-[12px] text-text-tertiary">
                        {t.workflows.noPresetsFound}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
