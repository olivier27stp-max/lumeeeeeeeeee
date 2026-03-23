/* ═══════════════════════════════════════════════════════════════
   Component — NoteEditor
   Modal to create / edit a note with all features:
   content, color, entity link, reminder, tags, checklist, files
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Plus, X, Tag, Paperclip, Calendar, CheckSquare,
  Square, Trash2, GripVertical, Pin,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import Modal from '../ui/Modal';
import type { Note, NoteColor, NoteEntityType, NoteChecklistItem } from '../../types/note';
import { NOTE_COLORS, ENTITY_TYPE_META } from '../../types/note';
import {
  createNote, updateNote, addTag, removeTag,
  addChecklistItem, updateChecklistItem, deleteChecklistItem,
  uploadNoteFile, deleteNoteFile, extractTags,
} from '../../lib/notesApi';

interface NoteEditorProps {
  open: boolean;
  onClose: () => void;
  note: Note | null; // null = create mode
  language: string;
  onSaved: () => void;
}

export default function NoteEditor({ open, onClose, note, language, onSaved }: NoteEditorProps) {
  const isEdit = !!note;
  const [content, setContent] = useState('');
  const [color, setColor] = useState<NoteColor | null>(null);
  const [pinned, setPinned] = useState(false);
  const [entityType, setEntityType] = useState<NoteEntityType | null>(null);
  const [entityId, setEntityId] = useState('');
  const [reminderAt, setReminderAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<{ id?: string; tag: string }[]>([]);
  const [checklist, setChecklist] = useState<{ id?: string; text: string; is_checked: boolean }[]>([]);
  const [newCheckItem, setNewCheckItem] = useState('');
  const [files, setFiles] = useState<{ id: string; file_name: string; file_url: string; file_type: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initialize from note
  useEffect(() => {
    if (open) {
      if (note) {
        setContent(note.content);
        setColor(note.color);
        setPinned(note.pinned);
        setEntityType(note.entity_type);
        setEntityId(note.entity_id ?? '');
        setReminderAt(note.reminder_at ? note.reminder_at.slice(0, 16) : '');
        setTags(note.tags?.map((t) => ({ id: t.id, tag: t.tag })) ?? []);
        setChecklist(note.checklist?.map((c) => ({ id: c.id, text: c.text, is_checked: c.is_checked })) ?? []);
        setFiles(note.files?.map((f) => ({ id: f.id, file_name: f.file_name, file_url: f.file_url, file_type: f.file_type })) ?? []);
      } else {
        setContent('');
        setColor(null);
        setPinned(false);
        setEntityType(null);
        setEntityId('');
        setReminderAt('');
        setTags([]);
        setChecklist([]);
        setFiles([]);
      }
      setTagInput('');
      setNewCheckItem('');
    }
  }, [open, note]);

  // Auto-focus textarea
  useEffect(() => {
    if (open && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSave = async () => {
    if (!content.trim() && checklist.length === 0) return;
    setSaving(true);
    try {
      if (isEdit && note) {
        // Update content/color/pin/entity/reminder
        await updateNote(note.id, {
          content: content.trim(),
          color,
          pinned,
          entity_type: entityType,
          entity_id: entityId || null,
          reminder_at: reminderAt ? new Date(reminderAt).toISOString() : null,
        });

        // Sync tags: add new ones, remove deleted ones
        const existingTags = note.tags ?? [];
        const newTags = tags.filter((t) => !t.id);
        const removedTags = existingTags.filter((et) => !tags.some((t) => t.id === et.id));

        for (const t of newTags) {
          await addTag(note.id, t.tag);
        }
        for (const t of removedTags) {
          await removeTag(t.id);
        }

        // Sync checklist
        const existingChecks = note.checklist ?? [];
        const newChecks = checklist.filter((c) => !c.id);
        const removedChecks = existingChecks.filter((ec) => !checklist.some((c) => c.id === ec.id));
        const updatedChecks = checklist.filter((c) => c.id);

        for (const c of newChecks) {
          await addChecklistItem(note.id, c.text, checklist.indexOf(c));
        }
        for (const c of removedChecks) {
          await deleteChecklistItem(c.id);
        }
        for (const c of updatedChecks) {
          const original = existingChecks.find((ec) => ec.id === c.id);
          if (original && (original.text !== c.text || original.is_checked !== c.is_checked)) {
            await updateChecklistItem(c.id!, { text: c.text, is_checked: c.is_checked });
          }
        }

        toast.success(t.noteEditor.noteUpdated);
      } else {
        // Create note
        const created = await createNote({
          content: content.trim(),
          color,
          pinned,
          entity_type: entityType,
          entity_id: entityId || null,
          reminder_at: reminderAt ? new Date(reminderAt).toISOString() : null,
        });

        // Add tags
        const autoTags = extractTags(content);
        const allTags = [...new Set([...tags.map((t) => t.tag), ...autoTags])];
        for (const t of allTags) {
          await addTag(created.id, t);
        }

        // Add checklist items
        for (let i = 0; i < checklist.length; i++) {
          await addChecklistItem(created.id, checklist[i].text, i);
        }

        toast.success(t.advancedNotes.noteCreated);
      }

      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Error saving note');
    } finally {
      setSaving(false);
    }
  };

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase().replace(/^#/, '');
    if (!tag || tags.some((t) => t.tag === tag)) return;
    setTags([...tags, { tag }]);
    setTagInput('');
  };

  const handleRemoveTag = (idx: number) => {
    setTags(tags.filter((_, i) => i !== idx));
  };

  const handleAddCheckItem = () => {
    if (!newCheckItem.trim()) return;
    setChecklist([...checklist, { text: newCheckItem.trim(), is_checked: false }]);
    setNewCheckItem('');
  };

  const handleRemoveCheckItem = (idx: number) => {
    setChecklist(checklist.filter((_, i) => i !== idx));
  };

  const handleToggleCheckItem = (idx: number) => {
    setChecklist(checklist.map((c, i) => i === idx ? { ...c, is_checked: !c.is_checked } : c));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || !note) return;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      try {
        const uploaded = await uploadNoteFile(note.id, file);
        setFiles((prev) => [...prev, {
          id: uploaded.id,
          file_name: uploaded.file_name,
          file_url: uploaded.file_url,
          file_type: uploaded.file_type,
        }]);
        toast.success(`${file.name} ${t.noteEditor.uploaded}`);
      } catch (err: any) {
        toast.error(`${file.name}: ${err.message}`);
      }
    }
    e.target.value = '';
  };

  const handleDeleteFile = async (fileId: string) => {
    try {
      await deleteNoteFile(fileId);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit
        ? (t.noteEditor.editNote)
        : (t.advancedNotes.newNote)
      }
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary text-[13px]">
            {t.advancedNotes.cancel}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (!content.trim() && checklist.length === 0)}
            className="btn-primary text-[13px]"
          >
            {saving
              ? (t.billing.saving)
              : (t.customFields.save)
            }
          </button>
        </>
      }
    >
      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        {/* ─── Content ─── */}
        <div>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={language === 'fr'
              ? 'Écrivez votre note... Utilisez @nom pour mentionner, #tag pour tagger'
              : 'Write your note... Use @name to mention, #tag to tag'
            }
            className="input-field w-full text-[13px] resize-none min-h-[120px]"
            rows={5}
          />
        </div>

        {/* ─── Quick Actions Row ─── */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Pin */}
          <button
            onClick={() => setPinned(!pinned)}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors',
              pinned
                ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300'
                : 'border-outline text-text-tertiary hover:text-text-secondary hover:bg-surface-secondary',
            )}
          >
            <Pin size={11} className={pinned ? 'rotate-45' : ''} />
            {pinned ? (t.noteEditor.pinned) : (t.advancedNotes.pin)}
          </button>

          {/* File upload (only in edit mode) */}
          {isEdit && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-outline text-text-tertiary hover:text-text-secondary hover:bg-surface-secondary transition-colors"
              >
                <Paperclip size={11} />
                {t.noteEditor.file}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileUpload}
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              />
            </>
          )}
        </div>

        {/* ─── Color Picker ─── */}
        <div>
          <label className="text-[11px] font-medium text-text-tertiary mb-1.5 block">
            {t.advancedNotes.color}
          </label>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setColor(null)}
              className={cn(
                'w-6 h-6 rounded-full border-2 transition-all',
                color === null ? 'border-text-primary scale-110' : 'border-outline',
                'bg-surface',
              )}
              title={t.noteEditor.default}
            />
            {NOTE_COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => setColor(c.value)}
                className={cn(
                  'w-6 h-6 rounded-full border-2 transition-all',
                  color === c.value ? 'border-text-primary scale-110' : 'border-transparent',
                )}
                style={{ backgroundColor: c.hex }}
                title={language === 'fr' ? c.nameFr : c.name}
              />
            ))}
          </div>
        </div>

        {/* ─── Tags ─── */}
        <div>
          <label className="text-[11px] font-medium text-text-tertiary mb-1.5 block">
            <Tag size={11} className="inline mr-1" />
            Tags
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
              placeholder="#important"
              className="input-field text-[12px] flex-1"
            />
            <button onClick={handleAddTag} className="btn-secondary text-[11px] px-2 py-1">
              <Plus size={12} />
            </button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {tags.map((t, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-[10px] font-medium"
                >
                  #{t.tag}
                  <button onClick={() => handleRemoveTag(i)} className="hover:text-red-500">
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ─── Checklist ─── */}
        <div>
          <label className="text-[11px] font-medium text-text-tertiary mb-1.5 block">
            <CheckSquare size={11} className="inline mr-1" />
            Checklist
          </label>
          <div className="space-y-1 mb-2">
            {checklist.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2 group/ci">
                <button onClick={() => handleToggleCheckItem(idx)} className="shrink-0">
                  {item.is_checked ? (
                    <CheckSquare size={14} className="text-green-500" />
                  ) : (
                    <Square size={14} className="text-text-tertiary" />
                  )}
                </button>
                <input
                  type="text"
                  value={item.text}
                  onChange={(e) => setChecklist(checklist.map((c, i) => i === idx ? { ...c, text: e.target.value } : c))}
                  className={cn(
                    'flex-1 text-[12px] bg-transparent border-none outline-none',
                    item.is_checked && 'line-through text-text-tertiary',
                  )}
                />
                <button
                  onClick={() => handleRemoveCheckItem(idx)}
                  className="p-0.5 text-text-tertiary hover:text-red-500 opacity-0 group-hover/ci:opacity-100 transition-opacity shrink-0"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newCheckItem}
              onChange={(e) => setNewCheckItem(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddCheckItem())}
              placeholder={t.noteEditor.addItem}
              className="input-field text-[12px] flex-1"
            />
            <button onClick={handleAddCheckItem} className="btn-secondary text-[11px] px-2 py-1">
              <Plus size={12} />
            </button>
          </div>
        </div>

        {/* ─── Entity Link ─── */}
        <div>
          <label className="text-[11px] font-medium text-text-tertiary mb-1.5 block">
            {t.noteEditor.linkToCrmObject}
          </label>
          <div className="flex items-center gap-2">
            <select
              value={entityType ?? ''}
              onChange={(e) => setEntityType((e.target.value || null) as NoteEntityType | null)}
              className="input-field text-[12px] w-36"
            >
              <option value="">{t.noteEditor.none}</option>
              {Object.entries(ENTITY_TYPE_META).map(([key, meta]) => (
                <option key={key} value={key}>
                  {language === 'fr' ? meta.labelFr : meta.label}
                </option>
              ))}
            </select>
            {entityType && (
              <input
                type="text"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                placeholder="ID"
                className="input-field text-[12px] flex-1"
              />
            )}
          </div>
        </div>

        {/* ─── Reminder ─── */}
        <div>
          <label className="text-[11px] font-medium text-text-tertiary mb-1.5 block">
            <Calendar size={11} className="inline mr-1" />
            {t.noteEditor.reminder}
          </label>
          <input
            type="datetime-local"
            value={reminderAt}
            onChange={(e) => setReminderAt(e.target.value)}
            className="input-field text-[12px] w-full"
          />
        </div>

        {/* ─── Existing Files (edit mode) ─── */}
        {isEdit && files.length > 0 && (
          <div>
            <label className="text-[11px] font-medium text-text-tertiary mb-1.5 block">
              <Paperclip size={11} className="inline mr-1" />
              {t.noteEditor.files}
            </label>
            <div className="space-y-1">
              {files.map((f) => (
                <div key={f.id} className="flex items-center gap-2 px-2 py-1 bg-surface-secondary rounded-md group/f">
                  <span className="text-[11px] text-text-secondary truncate flex-1">{f.file_name}</span>
                  <button
                    onClick={() => handleDeleteFile(f.id)}
                    className="p-0.5 text-text-tertiary hover:text-red-500 opacity-0 group-hover/f:opacity-100 transition-opacity"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
