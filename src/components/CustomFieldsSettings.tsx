import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, GripVertical, Eye, EyeOff, ChevronDown, ChevronRight,
  Type, Hash, Calendar, CheckSquare, Mail, Phone, Link, DollarSign,
  Star, Tag, List, Loader2, Pencil, X, Check, Settings,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import {
  listColumns,
  createColumn,
  updateColumn,
  deleteColumn,
  reorderColumns,
  type CustomColumn,
  type EntityType,
  type ColumnType,
  type ColumnConfig,
  type StatusOption,
  type DropdownOption,
} from '../lib/customFieldsApi';
import { useTranslation } from '../i18n';

// ─── Column type icons & labels ─────────────────────────────────
const COL_TYPE_META: Record<ColumnType, { icon: typeof Type; label: string; labelFr: string }> = {
  text:     { icon: Type,        label: 'Text',      labelFr: 'Texte' },
  number:   { icon: Hash,        label: 'Number',    labelFr: 'Nombre' },
  status:   { icon: List,        label: 'Status',    labelFr: 'Statut' },
  dropdown: { icon: ChevronDown, label: 'Dropdown',  labelFr: 'Liste déroulante' },
  date:     { icon: Calendar,    label: 'Date',      labelFr: 'Date' },
  checkbox: { icon: CheckSquare, label: 'Checkbox',  labelFr: 'Case à cocher' },
  email:    { icon: Mail,        label: 'Email',     labelFr: 'Email' },
  phone:    { icon: Phone,       label: 'Phone',     labelFr: 'Téléphone' },
  url:      { icon: Link,        label: 'URL',       labelFr: 'URL' },
  currency: { icon: DollarSign,  label: 'Currency',  labelFr: 'Monnaie' },
  rating:   { icon: Star,        label: 'Rating',    labelFr: 'Évaluation' },
  label:    { icon: Tag,         label: 'Label',     labelFr: 'Étiquette' },
};

const ENTITY_TABS: { key: EntityType; label: string; labelFr: string }[] = [
  { key: 'clients',  label: 'Clients',  labelFr: 'Clients' },
  { key: 'jobs',     label: 'Jobs',     labelFr: 'Travaux' },
  { key: 'invoices', label: 'Invoices', labelFr: 'Factures' },
];

const STATUS_COLORS = [
  '#94a3b8', '#3b82f6', '#22c55e', '#ef4444', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#6366f1',
];

// ─── Main Component ─────────────────────────────────────────────
export default function CustomFieldsSettings() {
  const { t, language } = useTranslation();
  const isFr = language === 'fr';

  const [entity, setEntity] = useState<EntityType>('clients');
  const [columns, setColumns] = useState<CustomColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingColumn, setEditingColumn] = useState<CustomColumn | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const loadColumns = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listColumns(entity);
      setColumns(data);
    } catch (e) {
      console.error('Failed to load custom columns:', e);
    }
    setLoading(false);
  }, [entity]);

  useEffect(() => { loadColumns(); }, [loadColumns]);

  const handleToggleVisibility = async (col: CustomColumn) => {
    try {
      await updateColumn(col.id, { visible: !col.visible });
      setColumns((prev) => prev.map((c) => c.id === col.id ? { ...c, visible: !c.visible } : c));
    } catch (e) {
      console.error('Failed to toggle visibility:', e);
    }
  };

  const handleDelete = async (colId: string) => {
    try {
      await deleteColumn(colId);
      setColumns((prev) => prev.filter((c) => c.id !== colId));
    } catch (e) {
      console.error('Failed to delete column:', e);
    }
  };

  // Drag and drop reorder
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const reordered = [...columns];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    setColumns(reordered);
    setDragIdx(idx);
  };
  const handleDragEnd = async () => {
    setDragIdx(null);
    try {
      await reorderColumns(entity, columns.map((c) => c.id));
    } catch (e) {
      console.error('Failed to reorder:', e);
    }
  };

  return (
    <div className="space-y-5">
      {/* Entity tabs */}
      <div className="flex items-center gap-1 p-1 bg-surface-secondary/80 rounded-xl w-fit border border-outline-subtle/40">
        {ENTITY_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setEntity(tab.key)}
            className={cn(
              'px-4 py-2 rounded-lg text-[13px] font-semibold transition-all',
              entity === tab.key
                ? 'bg-surface text-text-primary shadow-sm border border-outline-subtle/50'
                : 'text-text-tertiary hover:text-text-primary border border-transparent'
            )}
          >
            {isFr ? tab.labelFr : tab.label}
          </button>
        ))}
      </div>

      {/* Column list */}
      <div className="section-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div>
            <h3 className="text-[14px] font-semibold text-text-primary">
              {t.customFields.customColumns}
              {' '}
              <span className="text-text-tertiary font-normal">— {isFr ? ENTITY_TABS.find((tab) => tab.key === entity)!.labelFr : ENTITY_TABS.find((tab) => tab.key === entity)!.label}</span>
            </h3>
            <p className="text-[12px] text-text-tertiary mt-0.5">
              {isFr
                ? 'Glissez pour réordonner. Cliquez sur l\'icône crayon pour modifier.'
                : 'Drag to reorder. Click the pencil icon to edit.'}
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="glass-button-primary inline-flex items-center gap-1.5 text-[13px]"
          >
            <Plus size={14} />
            {t.customFields.addColumn}
          </button>
        </div>

        {/* Column rows */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={18} className="animate-spin text-text-tertiary" />
          </div>
        ) : columns.length === 0 ? (
          <div className="py-12 text-center">
            <Settings size={28} className="text-text-tertiary mx-auto mb-3 opacity-30" />
            <p className="text-[13px] text-text-tertiary">
              {t.customFields.noCustomColumnsYet}
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-3 text-[13px] font-medium text-primary hover:underline"
            >
              {t.customFields.createYourFirstColumn}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {columns.map((col, idx) => {
              const meta = COL_TYPE_META[col.col_type as ColumnType];
              const Icon = meta?.icon || Type;
              return (
                <div
                  key={col.id}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    'flex items-center gap-3 px-5 py-3 group transition-colors',
                    dragIdx === idx ? 'bg-primary/5' : 'hover:bg-surface-secondary/60'
                  )}
                >
                  <GripVertical size={14} className="text-text-tertiary/40 opacity-0 group-hover:opacity-100 cursor-grab shrink-0 transition-opacity" />
                  <div className="w-8 h-8 rounded-lg bg-surface-secondary/80 border border-outline-subtle/40 flex items-center justify-center shrink-0">
                    <Icon size={15} className="text-text-secondary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-text-primary truncate">{col.name}</p>
                      {col.required && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-red-500 bg-red-50 rounded px-1.5 py-0.5">
                          {t.customFields.required}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-text-tertiary mt-0.5 flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-md bg-surface-secondary/80 px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                        <Icon size={10} />
                        {isFr ? meta?.labelFr : meta?.label}
                      </span>
                      {!col.visible && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-text-tertiary/70">
                          <EyeOff size={10} />
                          {t.customFields.hidden}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleToggleVisibility(col)}
                      className={cn(
                        'p-1.5 rounded-lg transition-colors',
                        col.visible
                          ? 'text-text-tertiary hover:text-text-primary hover:bg-surface-secondary'
                          : 'text-warning hover:text-warning hover:bg-warning/10'
                      )}
                      title={col.visible ? (t.customFields.hide) : (t.customFields.show)}
                    >
                      {col.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button
                      onClick={() => setEditingColumn(col)}
                      className="p-1.5 rounded-lg text-text-tertiary hover:text-primary hover:bg-primary/5 transition-colors"
                      title={t.advancedNotes.edit}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(col.id)}
                      className="p-1.5 rounded-lg text-text-tertiary hover:text-red-600 hover:bg-red-50 transition-colors"
                      title={t.advancedNotes.delete}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add column modal */}
      <AnimatePresence>
        {showAddModal && (
          <AddColumnModal
            entity={entity}
            isFr={isFr}
            onClose={() => setShowAddModal(false)}
            onCreated={(col) => {
              setColumns((prev) => [...prev, col]);
              setShowAddModal(false);
            }}
          />
        )}
        {editingColumn && (
          <EditColumnModal
            column={editingColumn}
            isFr={isFr}
            onClose={() => setEditingColumn(null)}
            onUpdated={(updated) => {
              setColumns((prev) => prev.map((c) => c.id === updated.id ? updated : c));
              setEditingColumn(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Add Column Modal ───────────────────────────────────────────
function AddColumnModal({
  entity,
  isFr,
  onClose,
  onCreated,
}: {
  entity: EntityType;
  isFr: boolean;
  onClose: () => void;
  onCreated: (col: CustomColumn) => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<'type' | 'name'>('type');
  const [selectedType, setSelectedType] = useState<ColumnType | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!selectedType || !name.trim()) return;
    setSaving(true);
    try {
      const col = await createColumn(entity, name.trim(), selectedType);
      onCreated(col);
    } catch (e: any) {
      console.error('Failed to create column:', e);
      alert(e.message || 'Failed to create column');
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        className="section-card w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h3 className="text-[14px] font-semibold text-text-primary">
            {step === 'type'
              ? (t.customFields.chooseColumnType)
              : (t.customFields.nameYourColumn)}
          </h3>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-surface-secondary text-text-tertiary">
            <X size={16} />
          </button>
        </div>

        {step === 'type' ? (
          <div className="p-4 grid grid-cols-4 gap-2">
            {(Object.entries(COL_TYPE_META) as [ColumnType, typeof COL_TYPE_META[ColumnType]][]).map(([type, meta]) => {
              const Icon = meta.icon;
              return (
                <button
                  key={type}
                  onClick={() => {
                    setSelectedType(type);
                    setStep('name');
                    setName(isFr ? meta.labelFr : meta.label);
                  }}
                  className={cn(
                    'flex flex-col items-center gap-2 p-3 rounded-xl border transition-all text-center group/type',
                    'border-outline-subtle/40 hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm'
                  )}
                >
                  <div className="w-9 h-9 rounded-lg bg-surface-secondary/80 group-hover/type:bg-primary/10 flex items-center justify-center transition-colors">
                    <Icon size={17} className="text-text-secondary group-hover/type:text-primary transition-colors" />
                  </div>
                  <span className="text-xs font-medium text-text-secondary group-hover/type:text-text-primary transition-colors">
                    {isFr ? meta.labelFr : meta.label}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                {t.customFields.columnName}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="glass-input w-full mt-1"
                placeholder={t.customFields.egPriority}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setStep('type')}
                className="glass-button text-[13px]"
              >
                {t.companySettings.back}
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !name.trim()}
                className="glass-button-primary flex-1 inline-flex items-center justify-center gap-1.5 text-[13px]"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
                {saving ? (t.customFields.creating) : (t.customFields.createColumn)}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ─── Edit Column Modal (name, config, required) ─────────────────
function EditColumnModal({
  column,
  isFr,
  onClose,
  onUpdated,
}: {
  column: CustomColumn;
  isFr: boolean;
  onClose: () => void;
  onUpdated: (col: CustomColumn) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(column.name);
  const [required, setRequired] = useState(column.required);
  const [config, setConfig] = useState<ColumnConfig>(column.config || {});
  const [saving, setSaving] = useState(false);

  // Status/dropdown option management
  const [newOptionValue, setNewOptionValue] = useState('');

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateColumn(column.id, {
        name: name.trim() || column.name,
        required,
        config,
      });
      onUpdated(updated);
    } catch (e: any) {
      console.error('Failed to update column:', e);
    }
    setSaving(false);
  };

  const addStatusOption = () => {
    if (!newOptionValue.trim()) return;
    const statuses = config.statuses || [];
    const color = STATUS_COLORS[statuses.length % STATUS_COLORS.length];
    setConfig({
      ...config,
      statuses: [...statuses, { value: newOptionValue.trim(), color }],
    });
    setNewOptionValue('');
  };

  const removeStatusOption = (idx: number) => {
    setConfig({
      ...config,
      statuses: (config.statuses || []).filter((_, i) => i !== idx),
    });
  };

  const updateStatusColor = (idx: number, color: string) => {
    const statuses = [...(config.statuses || [])];
    statuses[idx] = { ...statuses[idx], color };
    setConfig({ ...config, statuses });
  };

  const addDropdownOption = () => {
    if (!newOptionValue.trim()) return;
    const options = config.options || [];
    setConfig({
      ...config,
      options: [...options, { value: newOptionValue.trim() }],
    });
    setNewOptionValue('');
  };

  const removeDropdownOption = (idx: number) => {
    setConfig({
      ...config,
      options: (config.options || []).filter((_, i) => i !== idx),
    });
  };

  const isStatusType = column.col_type === 'status';
  const isDropdownType = column.col_type === 'dropdown' || column.col_type === 'label';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        className="section-card w-full max-w-md mx-4 overflow-hidden max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <h3 className="text-[14px] font-semibold text-text-primary">
            {t.customFields.editColumn}
          </h3>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-surface-secondary text-text-tertiary">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Name */}
          <div>
            <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
              {t.customFields.name}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="glass-input w-full mt-1"
            />
          </div>

          {/* Type (read-only) */}
          <div>
            <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
              {t.customFields.type}
            </label>
            <div className="mt-1 flex items-center gap-2 px-3 py-2 rounded-md bg-surface-secondary text-[13px] text-text-secondary">
              {React.createElement(COL_TYPE_META[column.col_type as ColumnType]?.icon || Type, { size: 14 })}
              {isFr ? COL_TYPE_META[column.col_type as ColumnType]?.labelFr : COL_TYPE_META[column.col_type as ColumnType]?.label}
            </div>
          </div>

          {/* Required toggle */}
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-primary">{t.customFields.required}</span>
            <button
              onClick={() => setRequired(!required)}
              className={cn(
                'relative w-9 h-5 rounded-full transition-colors',
                required ? 'bg-primary' : 'bg-surface-tertiary'
              )}
            >
              <span className={cn(
                'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                required ? 'translate-x-4' : 'translate-x-0.5'
              )} />
            </button>
          </div>

          {/* Status options */}
          {isStatusType && (
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                {t.customFields.statusOptions}
              </label>
              <div className="mt-2 space-y-1.5">
                {(config.statuses || []).map((status, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="color"
                      value={status.color}
                      onChange={(e) => updateStatusColor(idx, e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                    />
                    <span className="text-[13px] text-text-primary flex-1">{status.value}</span>
                    <button
                      onClick={() => removeStatusOption(idx)}
                      className="p-1 text-text-tertiary hover:text-red-500 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="text"
                    value={newOptionValue}
                    onChange={(e) => setNewOptionValue(e.target.value)}
                    placeholder={t.customFields.newStatus}
                    className="glass-input flex-1 text-[13px]"
                    onKeyDown={(e) => e.key === 'Enter' && addStatusOption()}
                  />
                  <button
                    onClick={addStatusOption}
                    disabled={!newOptionValue.trim()}
                    className="glass-button text-[12px] px-2 py-1.5"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Dropdown options */}
          {isDropdownType && (
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                {t.customFields.options}
              </label>
              <div className="mt-2 space-y-1.5">
                {(config.options || []).map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-surface-secondary">
                    <span className="text-[13px] text-text-primary flex-1">{opt.value}</span>
                    <button
                      onClick={() => removeDropdownOption(idx)}
                      className="p-1 text-text-tertiary hover:text-red-500 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="text"
                    value={newOptionValue}
                    onChange={(e) => setNewOptionValue(e.target.value)}
                    placeholder={t.customFields.newOption}
                    className="glass-input flex-1 text-[13px]"
                    onKeyDown={(e) => e.key === 'Enter' && addDropdownOption()}
                  />
                  <button
                    onClick={addDropdownOption}
                    disabled={!newOptionValue.trim()}
                    className="glass-button text-[12px] px-2 py-1.5"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Currency code */}
          {column.col_type === 'currency' && (
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                {t.customFields.currencyCode}
              </label>
              <select
                value={config.currency_code || 'CAD'}
                onChange={(e) => setConfig({ ...config, currency_code: e.target.value })}
                className="glass-input w-full mt-1 text-[13px]"
              >
                <option value="CAD">CAD ($)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>
          )}

          {/* Rating max */}
          {column.col_type === 'rating' && (
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                {t.customFields.maxRating}
              </label>
              <select
                value={config.max_rating || 5}
                onChange={(e) => setConfig({ ...config, max_rating: Number(e.target.value) })}
                className="glass-input w-full mt-1 text-[13px]"
              >
                {[3, 5, 10].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-border flex items-center gap-2 shrink-0">
          <button onClick={onClose} className="glass-button text-[13px]">
            {t.advancedNotes.cancel}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="glass-button-primary flex-1 inline-flex items-center justify-center gap-1.5 text-[13px]"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
            {saving ? (t.billing.saving) : (t.customFields.save)}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
