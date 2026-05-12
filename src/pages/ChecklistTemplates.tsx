/* ═══════════════════════════════════════════════════════════════
   Page — Checklist Templates
   Admins build reusable job checklists / forms per service type.
   Items support: checkbox, text, number, photo, signature.
   ═══════════════════════════════════════════════════════════════ */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Trash2, GripVertical, X, ArrowLeft, ClipboardList, Edit2 } from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import {
  listChecklistTemplates,
  createChecklistTemplate,
  updateChecklistTemplate,
  deleteChecklistTemplate,
  type ChecklistTemplate,
  type ChecklistItem,
  type ChecklistItemType,
} from '../lib/checklistsApi';

type Mode = 'list' | 'edit';

function newItem(): ChecklistItem {
  return { id: crypto.randomUUID(), type: 'checkbox', label: '', required: false };
}

function SortableItemRow({
  item,
  onChange,
  onRemove,
  t,
}: {
  item: ChecklistItem;
  onChange: (next: ChecklistItem) => void;
  onRemove: () => void;
  t: any;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 p-3 rounded-lg border border-outline bg-surface"
    >
      <button
        {...attributes}
        {...listeners}
        className="mt-1.5 text-text-tertiary hover:text-text-primary cursor-grab active:cursor-grabbing"
        type="button"
        aria-label="drag"
      >
        <GripVertical size={16} />
      </button>
      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-2">
        <select
          value={item.type}
          onChange={(e) => onChange({ ...item, type: e.target.value as ChecklistItemType })}
          className="glass-input md:col-span-3"
        >
          <option value="checkbox">{t.checklists.typeCheckbox}</option>
          <option value="text">{t.checklists.typeText}</option>
          <option value="number">{t.checklists.typeNumber}</option>
          <option value="photo">{t.checklists.typePhoto}</option>
          <option value="signature">{t.checklists.typeSignature}</option>
        </select>
        <input
          type="text"
          value={item.label}
          onChange={(e) => onChange({ ...item, label: e.target.value })}
          placeholder={t.checklists.itemLabelPlaceholder}
          className="glass-input md:col-span-7"
        />
        <label className="md:col-span-2 flex items-center gap-2 text-[12px] text-text-secondary px-2">
          <input
            type="checkbox"
            checked={!!item.required}
            onChange={(e) => onChange({ ...item, required: e.target.checked })}
          />
          {t.checklists.required}
        </label>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="mt-1 text-text-tertiary hover:text-danger"
        aria-label="remove"
      >
        <X size={16} />
      </button>
    </div>
  );
}

export default function ChecklistTemplates() {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const fr = language === 'fr';

  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('list');
  const [editing, setEditing] = useState<ChecklistTemplate | null>(null);

  // edit form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [jobType, setJobType] = useState('');
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const list = await listChecklistTemplates(true);
      setTemplates(list);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load');
    } finally { setLoading(false); }
  }

  function openNew() {
    setEditing(null);
    setName(''); setDescription(''); setJobType('');
    setItems([newItem()]);
    setMode('edit');
  }

  function openEdit(tpl: ChecklistTemplate) {
    setEditing(tpl);
    setName(tpl.name);
    setDescription(tpl.description || '');
    setJobType(tpl.job_type || '');
    setItems(tpl.items?.length ? tpl.items : [newItem()]);
    setMode('edit');
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIdx = prev.findIndex((i) => i.id === active.id);
      const newIdx = prev.findIndex((i) => i.id === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  async function save() {
    if (!name.trim()) { toast.error(t.checklists.nameRequired); return; }
    const cleanItems = items.filter((i) => i.label.trim());
    if (cleanItems.length === 0) { toast.error(t.checklists.atLeastOneItem); return; }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        job_type: jobType.trim() || null,
        items: cleanItems,
      };
      if (editing) {
        await updateChecklistTemplate(editing.id, payload);
        toast.success(t.checklists.templateUpdated);
      } else {
        await createChecklistTemplate(payload);
        toast.success(t.checklists.templateCreated);
      }
      setMode('list');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Save failed');
    } finally { setSaving(false); }
  }

  async function toggleActive(tpl: ChecklistTemplate) {
    try {
      await updateChecklistTemplate(tpl.id, { is_active: !tpl.is_active });
      await load();
    } catch (err: any) { toast.error(err?.message || 'Failed'); }
  }

  async function remove(tpl: ChecklistTemplate) {
    if (!confirm(fr ? `Supprimer "${tpl.name}" ?` : `Delete "${tpl.name}"?`)) return;
    try {
      await deleteChecklistTemplate(tpl.id);
      toast.success(t.checklists.templateDeleted);
      await load();
    } catch (err: any) { toast.error(err?.message || 'Delete failed'); }
  }

  // ── EDIT VIEW ──
  if (mode === 'edit') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setMode('list')} className="glass-button !px-2">
            <ArrowLeft size={16} />
          </button>
          <h1 className="text-[20px] font-semibold text-text-primary">
            {editing ? t.checklists.editTemplate : t.checklists.newTemplate}
          </h1>
        </div>

        <div className="rounded-xl border border-outline bg-surface p-5 space-y-4">
          <div>
            <label className="text-[12px] font-medium text-text-tertiary uppercase tracking-wider">{t.checklists.name}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="glass-input w-full mt-1.5"
              placeholder={t.checklists.namePlaceholder} />
          </div>
          <div>
            <label className="text-[12px] font-medium text-text-tertiary uppercase tracking-wider">{t.checklists.description}</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="glass-input w-full mt-1.5" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-text-tertiary uppercase tracking-wider">{t.checklists.jobType}</label>
            <input value={jobType} onChange={(e) => setJobType(e.target.value)} className="glass-input w-full mt-1.5"
              placeholder={t.checklists.jobTypePlaceholder} />
          </div>
        </div>

        <div className="rounded-xl border border-outline bg-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[14px] font-semibold text-text-primary">{t.checklists.items}</h2>
            <button onClick={() => setItems([...items, newItem()])} className="glass-button !text-[12px]">
              <Plus size={14} /> {t.checklists.addItem}
            </button>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <SortableItemRow
                    key={it.id}
                    item={it}
                    onChange={(next) => setItems((prev) => prev.map((x, i) => (i === idx ? next : x)))}
                    onRemove={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    t={t}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={() => setMode('list')} className="glass-button">{t.common.cancel}</button>
          <button disabled={saving} onClick={save} className="glass-button-primary">
            {saving ? t.common.saving : t.common.save}
          </button>
        </div>
      </div>
    );
  }

  // ── LIST VIEW ──
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList size={22} className="text-text-tertiary" />
          <h1 className="text-[20px] font-semibold text-text-primary">{t.checklists.templatesTitle}</h1>
        </div>
        <button onClick={openNew} className="glass-button-primary">
          <Plus size={15} /> {t.checklists.newTemplate}
        </button>
      </div>
      <p className="text-[13px] text-text-tertiary">{t.checklists.templatesDescription}</p>

      {loading ? (
        <div className="text-text-tertiary text-[13px]">{t.common.loading}</div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline p-10 text-center">
          <ClipboardList size={28} className="mx-auto text-text-tertiary mb-3" />
          <p className="text-[14px] text-text-secondary">{t.checklists.noTemplates}</p>
          <button onClick={openNew} className="glass-button-primary mt-4">
            <Plus size={15} /> {t.checklists.newTemplate}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-outline overflow-hidden">
          {templates.map((tpl, idx) => (
            <div key={tpl.id}
              className={cn(
                'flex items-center gap-3 px-4 py-3 bg-surface hover:bg-surface-elevated transition-colors',
                idx > 0 && 'border-t border-outline-subtle',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium text-text-primary truncate">{tpl.name}</span>
                  {!tpl.is_active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-tertiary text-text-tertiary">
                      {t.checklists.inactive}
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-text-tertiary truncate">
                  {(tpl.items?.length || 0)} {t.checklists.itemsCount}
                  {tpl.job_type ? ` · ${tpl.job_type}` : ''}
                  {tpl.description ? ` · ${tpl.description}` : ''}
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                <input type="checkbox" checked={tpl.is_active} onChange={() => toggleActive(tpl)} />
                {t.checklists.active}
              </label>
              <button onClick={() => openEdit(tpl)} className="glass-button !text-[12px]"><Edit2 size={13} /></button>
              <button onClick={() => remove(tpl)} className="glass-button !text-[12px] !text-danger hover:bg-danger-light">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
