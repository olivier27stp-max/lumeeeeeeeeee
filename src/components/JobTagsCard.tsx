import React, { useEffect, useRef, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { toRgba } from '../lib/colorUtils';
import { TAG_COLORS } from '../lib/tagPalette';
import TagColorSwatches from './TagColorSwatches';
import {
  JobTagRecord, createJobTag, listJobTags, setJobTagIds, softDeleteJobTag, updateJobTag,
} from '../lib/jobTagsApi';

/**
 * Carte « Tags » du hub job : chips des tags assignés + menu déroulant blanc
 * où tout se passe — assigner/retirer un tag, en créer un (nom + couleur de
 * la palette vive des tags) et modifier/supprimer les existants, sans quitter
 * le menu. Aucun tag par défaut : la liste de l'org démarre vide.
 */
interface JobTagsCardProps {
  jobId: string;
  tagIds: string[];
  onChange: (tagIds: string[]) => void;
}

export default function JobTagsCard({ jobId, tagIds, onChange }: JobTagsCardProps) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [tags, setTags] = useState<JobTagRecord[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Création inline
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(TAG_COLORS[0]);
  const [creating, setCreating] = useState(false);

  // Édition inline (un tag à la fois)
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  useEffect(() => { void listJobTags().then(setTags); }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const assigned = tags.filter((tg) => tagIds.includes(tg.id));

  async function persist(ids: string[]) {
    const previous = tagIds;
    onChange(ids);
    try {
      await setJobTagIds(jobId, ids);
    } catch (e: any) {
      onChange(previous);
      toast.error(e?.message || (fr ? 'Impossible de sauvegarder les tags' : 'Could not save tags'));
    }
  }

  function toggle(tagId: string) {
    void persist(tagIds.includes(tagId) ? tagIds.filter((x) => x !== tagId) : [...tagIds, tagId]);
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const tag = await createJobTag(name, newColor);
      setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewColor(TAG_COLORS[0]);
      // Un tag créé depuis le hub est directement assigné à la job.
      void persist([...tagIds, tag.id]);
    } catch (e: any) {
      toast.error(e?.message || (fr ? 'Impossible de créer le tag' : 'Could not create tag'));
    } finally {
      setCreating(false);
    }
  }

  function startEdit(tag: JobTagRecord) {
    setEditId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color_hex);
  }

  async function handleSaveEdit() {
    if (!editId) return;
    const name = editName.trim();
    if (!name) return;
    try {
      const updated = await updateJobTag(editId, { name, color_hex: editColor });
      setTags((prev) => prev.map((tg) => (tg.id === updated.id ? updated : tg))
        .sort((a, b) => a.name.localeCompare(b.name)));
      setEditId(null);
    } catch (e: any) {
      toast.error(e?.message || (fr ? 'Impossible de modifier le tag' : 'Could not update tag'));
    }
  }

  async function handleDelete(tag: JobTagRecord) {
    if (!window.confirm(fr ? `Supprimer le tag « ${tag.name} » ?` : `Delete tag "${tag.name}"?`)) return;
    try {
      await softDeleteJobTag(tag.id);
      setTags((prev) => prev.filter((tg) => tg.id !== tag.id));
      if (tagIds.includes(tag.id)) void persist(tagIds.filter((x) => x !== tag.id));
    } catch (e: any) {
      toast.error(e?.message || (fr ? 'Impossible de supprimer le tag' : 'Could not delete tag'));
    }
  }

  return (
    <div className="rounded-xl border border-outline bg-surface overflow-visible">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
        <h2 className="text-[13px] font-semibold text-text-primary">Tags</h2>
      </div>
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {assigned.map((tag) => {
            return (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-semibold"
                style={{ backgroundColor: toRgba(tag.color_hex, 0.14), color: tag.color_hex }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color_hex }} />
                {tag.name}
                <button
                  onClick={() => toggle(tag.id)}
                  className="ml-0.5 opacity-50 transition-opacity hover:opacity-100"
                  title={fr ? 'Retirer' : 'Remove'}
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}

          {/* ── Menu déroulant blanc ── */}
          <div ref={ref} className="relative">
            <button
              onClick={() => setOpen(!open)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1 text-[12px] font-medium transition-colors',
                open
                  ? 'border-primary/40 bg-primary/5 text-primary'
                  : 'border-outline text-text-tertiary hover:border-outline hover:bg-surface-secondary hover:text-text-secondary',
              )}
            >
              <Plus size={12} />
              {fr ? 'Ajouter un tag' : 'Add tag'}
            </button>

            {open && (
              <div className="absolute left-0 top-full z-40 mt-1.5 w-72 rounded-xl border border-outline bg-white shadow-xl dark:bg-surface-elevated">
                <div className="max-h-56 overflow-y-auto p-1.5">
                  {tags.length === 0 && (
                    <p className="px-2.5 py-3 text-center text-[11px] text-text-tertiary">
                      {fr ? 'Aucun tag. Créez le premier ci-dessous.' : 'No tags yet. Create the first one below.'}
                    </p>
                  )}
                  {tags.map((tag) => {
                    const on = tagIds.includes(tag.id);
                    if (editId === tag.id) {
                      return (
                        <div key={tag.id} className="space-y-2 rounded-lg bg-surface-secondary p-2">
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveEdit(); }}
                            className="w-full rounded-md border border-outline bg-white px-2 py-1.5 text-[12px] text-text-primary dark:bg-surface-tertiary"
                            autoFocus
                          />
                          <TagColorSwatches size="sm" value={editColor} onChange={setEditColor} />
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => void handleSaveEdit()}
                              className="flex-1 rounded-md bg-text-primary px-2 py-1 text-[11px] font-semibold text-white dark:text-black"
                            >
                              {fr ? 'Sauvegarder' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditId(null)}
                              className="rounded-md border border-outline px-2 py-1 text-[11px] font-medium text-text-secondary"
                            >
                              {fr ? 'Annuler' : 'Cancel'}
                            </button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={tag.id}
                        className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-secondary"
                      >
                        <button onClick={() => toggle(tag.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color_hex }} />
                          <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', on ? 'font-semibold text-text-primary' : 'text-text-secondary')}>
                            {tag.name}
                          </span>
                          {on && <Check size={13} className="shrink-0 text-primary" />}
                        </button>
                        <button
                          onClick={() => startEdit(tag)}
                          className="shrink-0 rounded p-1 text-text-tertiary opacity-0 transition-opacity hover:text-text-primary group-hover:opacity-100"
                          title={fr ? 'Modifier' : 'Edit'}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => void handleDelete(tag)}
                          className="shrink-0 rounded p-1 text-text-tertiary opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                          title={fr ? 'Supprimer' : 'Delete'}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* ── Création directement dans le menu ── */}
                <div className="space-y-2 border-t border-outline-subtle p-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                    {fr ? 'Nouveau tag' : 'New tag'}
                  </p>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
                    placeholder={fr ? 'Nom du tag…' : 'Tag name…'}
                    className="w-full rounded-md border border-outline bg-white px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-tertiary dark:bg-surface-tertiary"
                  />
                  <TagColorSwatches size="sm" value={newColor} onChange={setNewColor} />
                  <button
                    onClick={() => void handleCreate()}
                    disabled={creating || !newName.trim()}
                    className="w-full rounded-md bg-text-primary px-2 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:text-black"
                  >
                    {fr ? 'Créer le tag' : 'Create tag'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
