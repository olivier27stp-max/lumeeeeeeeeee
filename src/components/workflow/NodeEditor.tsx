import React, { useState, useEffect } from 'react';
import {
  X, Zap, GitBranch, Play, Timer, Trash2, Plus, Clock,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { ACTION_DEFS, TRIGGER_DEFS, type ActionType, type TriggerType } from '../../lib/workflowApi';
import type { Node } from '@xyflow/react';
import { useTranslation } from '../i18n';

interface NodeEditorProps {
  node: Node | null;
  onUpdate: (nodeId: string, data: Record<string, any>) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
  fr: boolean;
}

const CONDITION_OPERATORS = [
  { value: 'equals', label: 'Equals', labelFr: 'Égal à' },
  { value: 'not_equals', label: 'Not Equals', labelFr: 'Différent de' },
  { value: 'contains', label: 'Contains', labelFr: 'Contient' },
  { value: 'greater_than', label: 'Greater Than', labelFr: 'Supérieur à' },
  { value: 'less_than', label: 'Less Than', labelFr: 'Inférieur à' },
  { value: 'is_empty', label: 'Is Empty', labelFr: 'Est vide' },
  { value: 'is_not_empty', label: 'Is Not Empty', labelFr: 'N\'est pas vide' },
];

const DELAY_UNITS = [
  { value: 'minutes', label: 'Minutes' },
  { value: 'hours', label: 'Hours', labelFr: 'Heures' },
  { value: 'days', label: 'Days', labelFr: 'Jours' },
];

export default function NodeEditor({ node, onUpdate, onDelete, onClose, fr }: NodeEditorProps) {
  const [localData, setLocalData] = useState<Record<string, any>>({});

  useEffect(() => {
    if (node) {
      setLocalData({ ...node.data } as Record<string, any>);
    }
  }, [node]);

  if (!node) return null;

  const nodeType = node.type as string;

  const handleChange = (key: string, value: any) => {
    const updated = { ...localData, [key]: value };
    setLocalData(updated);
    onUpdate(node.id, updated);
  };

  const handleConditionChange = (idx: number, field: string, value: any) => {
    const conditions = [...(localData.conditions || [])];
    conditions[idx] = { ...conditions[idx], [field]: value };
    handleChange('conditions', conditions);
  };

  const addCondition = () => {
    const conditions = [...(localData.conditions || []), { field: '', operator: 'equals', value: '' }];
    handleChange('conditions', conditions);
  };

  const removeCondition = (idx: number) => {
    const conditions = (localData.conditions || []).filter((_: any, i: number) => i !== idx);
    handleChange('conditions', conditions);
  };

  const typeConfig = {
    trigger: { icon: Zap, color: 'text-text-primary', bg: 'bg-surface-tertiary', label: 'Trigger' },
    condition: { icon: GitBranch, color: 'text-text-secondary', bg: 'bg-surface-tertiary', label: 'Condition' },
    action: { icon: Play, color: 'text-text-secondary', bg: 'bg-surface-tertiary', label: 'Action' },
    delay: { icon: Timer, color: 'text-text-secondary', bg: 'bg-surface-tertiary', label: 'Delay' },
  };

  const cfg = typeConfig[nodeType as keyof typeof typeConfig] || typeConfig.action;
  const TypeIcon = cfg.icon;

  return (
    <div className="w-[300px] shrink-0 border-l border-outline bg-surface flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-outline flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center', cfg.bg)}>
            <TypeIcon size={12} className={cfg.color} />
          </div>
          <span className={cn('text-[10px] font-bold uppercase tracking-wider', cfg.color)}>{cfg.label}</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-surface-secondary transition-colors">
          <X size={14} className="text-text-tertiary" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Label */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary block mb-1.5">
            {t.workflows.label}
          </label>
          <input
            type="text"
            value={localData.label || ''}
            onChange={(e) => handleChange('label', e.target.value)}
            className="glass-input w-full text-[12px] py-1.5"
          />
        </div>

        {/* Trigger-specific */}
        {nodeType === 'trigger' && (
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary block mb-1.5">
              {t.workflows.triggerType}
            </label>
            <select
              value={localData.trigger_type || ''}
              onChange={(e) => handleChange('trigger_type', e.target.value)}
              className="glass-input w-full text-[11px] py-1.5"
            >
              {Object.entries(TRIGGER_DEFS).map(([key, def]) => (
                <option key={key} value={key}>{fr ? def.labelFr : def.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Delay-specific */}
        {nodeType === 'delay' && (
          <>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary block mb-1.5">
                {t.workflows.duration}
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={localData.delay_value || ''}
                  onChange={(e) => handleChange('delay_value', parseInt(e.target.value) || 0)}
                  className="glass-input flex-1 text-[12px] py-1.5"
                  placeholder="0"
                />
                <select
                  value={localData.delay_unit || 'hours'}
                  onChange={(e) => handleChange('delay_unit', e.target.value)}
                  className="glass-input w-24 text-[11px] py-1.5"
                >
                  {DELAY_UNITS.map((u) => (
                    <option key={u.value} value={u.value}>{fr && u.labelFr ? u.labelFr : u.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        {/* Condition-specific */}
        {nodeType === 'condition' && (
          <>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary block mb-1.5">
                {t.workflows.operator}
              </label>
              <div className="flex gap-1.5">
                {['AND', 'OR'].map((op) => (
                  <button
                    key={op}
                    onClick={() => handleChange('operator', op)}
                    className={cn(
                      'text-[11px] font-semibold px-3 py-1 rounded-lg transition-colors',
                      (localData.operator || 'AND') === op
                        ? 'bg-text-primary text-surface'
                        : 'bg-surface-secondary text-text-tertiary hover:text-text-primary'
                    )}
                  >
                    {op}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
                  {t.workflows.conditions}
                </label>
                <button onClick={addCondition} className="text-[10px] text-primary font-semibold flex items-center gap-0.5 hover:underline">
                  <Plus size={10} />
                  {t.workflows.add}
                </button>
              </div>

              <div className="space-y-2">
                {(localData.conditions || []).map((cond: any, idx: number) => (
                  <div key={idx} className="bg-surface-secondary rounded-lg p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold text-text-tertiary">#{idx + 1}</span>
                      <button onClick={() => removeCondition(idx)} className="text-text-tertiary hover:text-danger">
                        <Trash2 size={10} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={cond.field || ''}
                      onChange={(e) => handleConditionChange(idx, 'field', e.target.value)}
                      placeholder={t.workflows.field}
                      className="glass-input w-full text-[11px] py-1"
                    />
                    <select
                      value={cond.operator || 'equals'}
                      onChange={(e) => handleConditionChange(idx, 'operator', e.target.value)}
                      className="glass-input w-full text-[11px] py-1"
                    >
                      {CONDITION_OPERATORS.map((op) => (
                        <option key={op.value} value={op.value}>{fr ? op.labelFr : op.label}</option>
                      ))}
                    </select>
                    {!['is_empty', 'is_not_empty'].includes(cond.operator) && (
                      <input
                        type="text"
                        value={cond.value || ''}
                        onChange={(e) => handleConditionChange(idx, 'value', e.target.value)}
                        placeholder={t.modals.value}
                        className="glass-input w-full text-[11px] py-1"
                      />
                    )}
                  </div>
                ))}
                {(localData.conditions || []).length === 0 && (
                  <p className="text-[10px] text-text-tertiary text-center py-3">{t.workflows.noConditionsYet}</p>
                )}
              </div>
            </div>
          </>
        )}

        {/* Action-specific */}
        {nodeType === 'action' && localData.actionType && (
          <div className="space-y-3">
            {ACTION_DEFS[localData.actionType as ActionType]?.fields.map((field) => (
              <div key={field.key}>
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary block mb-1.5">
                  {field.label}
                </label>
                {field.type === 'textarea' ? (
                  <textarea
                    value={localData[field.key] || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    rows={3}
                    className="glass-input w-full text-[11px] py-1.5 resize-none"
                  />
                ) : (
                  <input
                    type={field.type}
                    value={localData[field.key] || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className="glass-input w-full text-[12px] py-1.5"
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {nodeType !== 'trigger' && (
        <div className="px-4 py-3 border-t border-outline">
          <button
            onClick={() => onDelete(node.id)}
            className="w-full text-[11px] font-medium text-danger hover:bg-danger/5 rounded-lg py-2 transition-colors flex items-center justify-center gap-1.5"
          >
            <Trash2 size={12} />
            {t.workflows.deleteThisNode}
          </button>
        </div>
      )}
    </div>
  );
}
