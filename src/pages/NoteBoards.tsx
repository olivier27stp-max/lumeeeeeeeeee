/* ═══════════════════════════════════════════════════════════════
   Page — Note Boards (board list / management)
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useCallback } from 'react';
import {
  StickyNote, Plus, Search, Trash2, Archive, MoreHorizontal,
  Layout, Users, Lightbulb, FolderKanban, RotateCcw, Kanban,
  Clock, FileText,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader, EmptyState, Modal, Skeleton } from '../components/ui';
import { useTranslation } from '../i18n';
import { fetchBoards, createBoard, deleteBoard, archiveBoard, seedBoardTemplate } from '../lib/noteBoardsApi';
import type { NoteBoard, BoardType } from '../types/noteBoard';
import { BOARD_TYPE_META } from '../types/noteBoard';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';

const boardTypeIcons: Record<BoardType, React.ElementType> = {
  freeform: Layout,
  meeting: Users,
  brainstorm: Lightbulb,
  project_plan: FolderKanban,
  retrospective: RotateCcw,
  kanban: Kanban,
};

const boardTypeColors: Record<BoardType, string> = {
  freeform: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  meeting: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  brainstorm: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  project_plan: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  retrospective: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  kanban: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
};

export default function NoteBoards() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [boards, setBoards] = useState<NoteBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<BoardType>('freeform');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchBoards();
      setBoards(data);
    } catch (err) {
      toast.error('Failed to load boards');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const board = await createBoard({
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        board_type: newType,
      });
      // Seed template starter items for non-freeform boards
      if (newType !== 'freeform') {
        await seedBoardTemplate(board.id, newType).catch(() => {});
      }
      setShowCreate(false);
      setNewTitle('');
      setNewDesc('');
      setNewType('freeform');
      navigate(`/notes/${board.id}`);
    } catch (err) {
      toast.error('Failed to create board');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t.noteBoards.deleteThisBoard)) return;
    try {
      await deleteBoard(id);
      setBoards((prev) => prev.filter((b) => b.id !== id));
      toast.success(t.noteBoards.boardDeleted);
    } catch {
      toast.error('Failed to delete board');
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await archiveBoard(id);
      setBoards((prev) => prev.filter((b) => b.id !== id));
      toast.success(t.noteBoards.boardArchived);
    } catch {
      toast.error('Failed to archive board');
    }
  };

  const filtered = boards.filter((b) =>
    b.title.toLowerCase().includes(search.toLowerCase()) ||
    b.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <PageHeader
        title={t.noteBoards.noteBoards}
        subtitle={t.noteBoards.infiniteCollaborativeCanvas}
        icon={StickyNote}
        iconColor="blue"
      >
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder={t.common.search + '...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-8 w-48 text-[13px]"
          />
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary text-[13px] flex items-center gap-1.5"
        >
          <Plus size={14} />
          {t.noteBoards.newBoard}
        </button>
      </PageHeader>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-12">
          <EmptyState
            icon={StickyNote}
            iconColor="blue"
            title={search
              ? (t.noteBoards.noBoardsFound)
              : (t.noteBoards.noBoardsYet)
            }
            description={search
              ? undefined
              : (language === 'fr'
                ? 'Créez votre premier tableau pour commencer à collaborer visuellement.'
                : 'Create your first board to start collaborating visually.')
            }
            action={!search ? (
              <button onClick={() => setShowCreate(true)} className="btn-primary text-[13px] flex items-center gap-1.5">
                <Plus size={14} />
                {t.noteBoards.createBoard}
              </button>
            ) : undefined}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          <AnimatePresence mode="popLayout">
            {filtered.map((board) => {
              const TypeIcon = boardTypeIcons[board.board_type] || Layout;
              const meta = BOARD_TYPE_META[board.board_type];
              return (
                <motion.div
                  key={board.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="card group cursor-pointer hover:shadow-md transition-shadow relative"
                  onClick={() => navigate(`/notes/${board.id}`)}
                >
                  {/* Board type badge */}
                  <div className="flex items-center justify-between mb-3">
                    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium', boardTypeColors[board.board_type])}>
                      <TypeIcon size={12} />
                      {language === 'fr' ? meta?.labelFr : meta?.label}
                    </span>
                    <div className="relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === board.id ? null : board.id); }}
                        className="p-1 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-surface-secondary transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      {menuOpen === board.id && (
                        <div
                          className="absolute right-0 top-7 z-50 w-36 bg-surface border border-outline rounded-lg shadow-lg py-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => { setMenuOpen(null); handleArchive(board.id); }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-secondary transition-colors"
                          >
                            <Archive size={12} />
                            {t.noteBoards.archive}
                          </button>
                          <button
                            onClick={() => { setMenuOpen(null); handleDelete(board.id); }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          >
                            <Trash2 size={12} />
                            {t.advancedNotes.delete}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Title & description */}
                  <h3 className="text-[14px] font-semibold text-text-primary truncate">{board.title}</h3>
                  {board.description && (
                    <p className="text-[12px] text-text-tertiary mt-1 line-clamp-2">{board.description}</p>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-outline">
                    <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
                      <span className="flex items-center gap-1">
                        <FileText size={11} />
                        {board.item_count ?? 0} {t.noteBoards.items}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        {formatDistanceToNow(new Date(board.updated_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* ─── Create Board Modal ─── */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title={t.noteBoards.newBoard}
        size="lg"
        footer={
          <>
            <button onClick={() => setShowCreate(false)} className="btn-secondary text-[13px]">
              {t.common.cancel}
            </button>
            <button onClick={handleCreate} disabled={creating || !newTitle.trim()} className="btn-primary text-[13px]">
              {creating ? (t.customFields.creating) : (t.advancedNotes.create)}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-[12px] font-medium text-text-secondary mb-1 block">
              {t.noteBoards.boardName}
            </label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t.noteBoards.myBoard}
              className="input-field w-full text-[13px]"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>

          <div>
            <label className="text-[12px] font-medium text-text-secondary mb-1 block">
              {t.automations.description}
            </label>
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder={t.noteBoards.optionalDescription}
              className="input-field w-full text-[13px] resize-none"
              rows={2}
            />
          </div>

          <div>
            <label className="text-[12px] font-medium text-text-secondary mb-2 block">
              {t.noteBoards.boardType}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(BOARD_TYPE_META) as BoardType[]).map((type) => {
                const meta = BOARD_TYPE_META[type];
                const Icon = boardTypeIcons[type];
                return (
                  <button
                    key={type}
                    onClick={() => setNewType(type)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-3 rounded-lg border text-center transition-all',
                      newType === type
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-outline hover:border-outline-subtle hover:bg-surface-secondary'
                    )}
                  >
                    <Icon size={18} className={newType === type ? 'text-blue-600' : 'text-text-tertiary'} />
                    <span className={cn('text-[11px] font-medium', newType === type ? 'text-blue-700 dark:text-blue-300' : 'text-text-secondary')}>
                      {language === 'fr' ? meta.labelFr : meta.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
