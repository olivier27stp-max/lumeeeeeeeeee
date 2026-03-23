/* ═══════════════════════════════════════════════════════════════
   Page — Advanced Notes
   Full-featured notes list with timeline view, filters, pinning,
   colors, tags, checklist, mentions, files, reminders, history.
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useCallback } from 'react';
import {
  StickyNote, Plus, Search, Filter, Pin, Tag, Clock,
  Calendar, LayoutList, LayoutGrid, X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr as frLocale } from 'date-fns/locale';
import { PageHeader, EmptyState, Skeleton } from '../components/ui';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import {
  fetchNotes, deleteNote, togglePin, updateChecklistItem,
  deleteNoteFile, fetchAllTags, subscribeToNotes,
} from '../lib/notesApi';
import type { Note, NoteColor, NoteEntityType } from '../types/note';
import { NOTE_COLORS, ENTITY_TYPE_META } from '../types/note';
import NoteCard from '../components/advancedNotes/NoteCard';
import NoteEditor from '../components/advancedNotes/NoteEditor';
import NoteHistoryPanel from '../components/advancedNotes/NoteHistoryPanel';
import QuickNote from '../components/advancedNotes/QuickNote';

type ViewMode = 'list' | 'timeline';

export default function Notes() {
  const { t, language } = useTranslation();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterColor, setFilterColor] = useState<NoteColor | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterEntity, setFilterEntity] = useState<NoteEntityType | null>(null);
  const [filterPinned, setFilterPinned] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [allTags, setAllTags] = useState<string[]>([]);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  // History state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyNoteId, setHistoryNoteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [notesData, tagsData] = await Promise.all([
        fetchNotes({
          search: search || undefined,
          color: filterColor ?? undefined,
          tag: filterTag ?? undefined,
          entity_type: filterEntity ?? undefined,
          pinned_only: filterPinned || undefined,
        }),
        fetchAllTags(),
      ]);
      setNotes(notesData);
      setAllTags(tagsData);
    } catch (err) {
      toast.error(t.advancedNotes.failedToLoadNotes);
    } finally {
      setLoading(false);
    }
  }, [search, filterColor, filterTag, filterEntity, filterPinned, language]);

  useEffect(() => { load(); }, [load]);

  // Realtime subscription
  useEffect(() => {
    const unsub = subscribeToNotes(
      () => load(),
      () => load(),
    );
    return unsub;
  }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm(t.advancedNotes.deleteThisNote)) return;
    try {
      // Optimistic update
      setNotes((prev) => prev.filter((n) => n.id !== id));
      await deleteNote(id);
      toast.success(t.advancedNotes.noteDeleted);
    } catch {
      load();
      toast.error(t.advancedNotes.error);
    }
  };

  const handleTogglePin = async (id: string, pinned: boolean) => {
    try {
      // Optimistic update
      setNotes((prev) => {
        const updated = prev.map((n) => n.id === id ? { ...n, pinned } : n);
        return updated.sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
      });
      await togglePin(id, pinned);
    } catch {
      load();
    }
  };

  const handleToggleChecklist = async (itemId: string, checked: boolean) => {
    try {
      // Optimistic update
      setNotes((prev) => prev.map((n) => ({
        ...n,
        checklist: n.checklist?.map((c) => c.id === itemId ? { ...c, is_checked: checked } : c),
      })));
      await updateChecklistItem(itemId, { is_checked: checked });
    } catch {
      load();
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    try {
      setNotes((prev) => prev.map((n) => ({
        ...n,
        files: n.files?.filter((f) => f.id !== fileId),
      })));
      await deleteNoteFile(fileId);
    } catch {
      load();
    }
  };

  const handleEdit = (note: Note) => {
    setEditingNote(note);
    setEditorOpen(true);
  };

  const handleViewHistory = (noteId: string) => {
    setHistoryNoteId(noteId);
    setHistoryOpen(true);
  };

  const handleCreate = () => {
    setEditingNote(null);
    setEditorOpen(true);
  };

  const clearFilters = () => {
    setFilterColor(null);
    setFilterTag(null);
    setFilterEntity(null);
    setFilterPinned(false);
  };

  const hasFilters = filterColor || filterTag || filterEntity || filterPinned;

  // Group notes by date for timeline view
  const groupedByDate = notes.reduce<Record<string, Note[]>>((acc, note) => {
    const dateKey = format(new Date(note.created_at), 'yyyy-MM-dd');
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(note);
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title={t.advancedNotes.notes}
        subtitle={t.advancedNotes.collaborativeNotesSystem}
        icon={StickyNote}
        iconColor="blue"
      >
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              placeholder={`${t.advancedNotes.search}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-8 w-48 text-[13px]"
            />
          </div>

          {/* View mode toggle */}
          <div className="flex items-center bg-surface-secondary rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'list' ? 'bg-surface shadow-sm text-text-primary' : 'text-text-tertiary',
              )}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'timeline' ? 'bg-surface shadow-sm text-text-primary' : 'text-text-tertiary',
              )}
            >
              <LayoutList size={14} />
            </button>
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'p-2 rounded-lg border transition-colors',
              hasFilters
                ? 'border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                : 'border-outline text-text-tertiary hover:text-text-secondary hover:bg-surface-secondary',
            )}
          >
            <Filter size={14} />
          </button>

          {/* Create */}
          <button onClick={handleCreate} className="btn-primary text-[13px] flex items-center gap-1.5">
            <Plus size={14} />
            {t.advancedNotes.newNote}
          </button>
        </div>
      </PageHeader>

      <div className="mt-4 space-y-4">
        {/* ─── Quick Note ─── */}
        <QuickNote language={language} onCreated={load} />

        {/* ─── Filters Panel ─── */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-surface border border-outline rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-text-primary">
                    {t.advancedNotes.filters}
                  </span>
                  {hasFilters && (
                    <button onClick={clearFilters} className="text-[11px] text-blue-600 hover:underline">
                      {t.advancedNotes.clearAll}
                    </button>
                  )}
                </div>

                {/* Color filter */}
                <div>
                  <label className="text-[11px] font-medium text-text-tertiary mb-1.5 block">
                    {t.advancedNotes.color}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setFilterColor(null)}
                      className={cn(
                        'w-5 h-5 rounded-full border-2 bg-surface transition-all',
                        !filterColor ? 'border-text-primary' : 'border-outline',
                      )}
                      title={t.advancedNotes.all}
                    />
                    {NOTE_COLORS.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => setFilterColor(filterColor === c.value ? null : c.value)}
                        className={cn(
                          'w-5 h-5 rounded-full border-2 transition-all',
                          filterColor === c.value ? 'border-text-primary scale-110' : 'border-transparent',
                        )}
                        style={{ backgroundColor: c.hex }}
                        title={language === 'fr' ? c.nameFr : c.name}
                      />
                    ))}
                  </div>
                </div>

                {/* Tag filter */}
                {allTags.length > 0 && (
                  <div>
                    <label className="text-[11px] font-medium text-text-tertiary mb-1.5 block">
                      <Tag size={10} className="inline mr-1" />
                      Tags
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {allTags.map((tag) => (
                        <button
                          key={tag}
                          onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                          className={cn(
                            'px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors',
                            filterTag === tag
                              ? 'bg-purple-600 text-white'
                              : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 hover:bg-purple-200',
                          )}
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Entity type filter */}
                <div>
                  <label className="text-[11px] font-medium text-text-tertiary mb-1.5 block">
                    {language === 'fr' ? 'Type d\'objet' : 'Entity type'}
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(ENTITY_TYPE_META).map(([key, meta]) => (
                      <button
                        key={key}
                        onClick={() => setFilterEntity(filterEntity === key ? null : key as NoteEntityType)}
                        className={cn(
                          'px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors',
                          filterEntity === key
                            ? 'bg-blue-600 text-white'
                            : `${meta.color} hover:opacity-80`,
                        )}
                      >
                        {language === 'fr' ? meta.labelFr : meta.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Pinned only */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterPinned}
                    onChange={(e) => setFilterPinned(e.target.checked)}
                    className="rounded border-outline"
                  />
                  <span className="text-[11px] font-medium text-text-secondary flex items-center gap-1">
                    <Pin size={10} className="rotate-45" />
                    {t.advancedNotes.pinnedOnly}
                  </span>
                </label>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── Notes List ─── */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : notes.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              icon={StickyNote}
              iconColor="blue"
              title={hasFilters || search
                ? (t.advancedNotes.noNotesFound)
                : (t.advancedNotes.noNotesYet)
              }
              description={!hasFilters && !search
                ? (language === 'fr'
                  ? 'Créez votre première note pour commencer à collaborer.'
                  : 'Create your first note to start collaborating.')
                : undefined
              }
              action={!hasFilters && !search ? (
                <button onClick={handleCreate} className="btn-primary text-[13px] flex items-center gap-1.5">
                  <Plus size={14} />
                  {t.advancedNotes.createNote}
                </button>
              ) : undefined}
            />
          </div>
        ) : viewMode === 'list' ? (
          /* ─── Grid View ─── */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence mode="popLayout">
              {notes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  language={language}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onTogglePin={handleTogglePin}
                  onToggleChecklist={handleToggleChecklist}
                  onDeleteFile={handleDeleteFile}
                  onViewHistory={handleViewHistory}
                />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          /* ─── Timeline View ─── */
          <div className="space-y-6">
            {Object.entries(groupedByDate).map(([dateKey, dateNotes]: [string, Note[]]) => (
              <div key={dateKey}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  <h3 className="text-[13px] font-semibold text-text-primary">
                    {format(new Date(dateKey), 'EEEE d MMMM yyyy', {
                      locale: language === 'fr' ? frLocale : undefined,
                    })}
                  </h3>
                  <div className="flex-1 h-px bg-outline" />
                </div>
                <div className="ml-4 pl-4 border-l-2 border-outline space-y-3">
                  {dateNotes.map((note) => (
                    <div key={note.id} className="relative">
                      {/* Timeline dot */}
                      <div className="absolute -left-[21px] top-3 w-2.5 h-2.5 rounded-full bg-surface border-2 border-blue-400" />
                      {/* Time label */}
                      <span className="text-[10px] text-text-tertiary font-medium mb-1 block">
                        {format(new Date(note.created_at), 'HH:mm')}
                      </span>
                      <NoteCard
                        note={note}
                        language={language}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onTogglePin={handleTogglePin}
                        onToggleChecklist={handleToggleChecklist}
                        onDeleteFile={handleDeleteFile}
                        onViewHistory={handleViewHistory}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Note Editor Modal ─── */}
      <NoteEditor
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditingNote(null); }}
        note={editingNote}
        language={language}
        onSaved={load}
      />

      {/* ─── History Panel ─── */}
      <NoteHistoryPanel
        open={historyOpen}
        onClose={() => { setHistoryOpen(false); setHistoryNoteId(null); }}
        noteId={historyNoteId}
        language={language}
      />
    </>
  );
}
