/* ═══════════════════════════════════════════════════════════════
   Component — NoteCard
   Displays a single note with all its features:
   content, author, date, pin, color, tags, checklist, files, reminder
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, memo } from 'react';
import {
  Pin, PinOff, Trash2, Edit3, MoreHorizontal, Paperclip,
  CheckSquare, Square, Clock, Tag, Calendar, History,
  FileText, Image, Download, X, ChevronDown, ChevronUp,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '../../lib/utils';
import type { Note, NoteChecklistItem } from '../../types/note';
import { NOTE_COLORS, ENTITY_TYPE_META } from '../../types/note';
import { useTranslation } from '../i18n';

interface NoteCardProps {
  note: Note;
  language: string;
  onEdit: (note: Note) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onToggleChecklist: (itemId: string, checked: boolean) => void;
  onDeleteFile: (fileId: string) => void;
  onViewHistory: (noteId: string) => void;
}

function NoteCard({
  note, language, onEdit, onDelete, onTogglePin,
  onToggleChecklist, onDeleteFile, onViewHistory,
}: NoteCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [checklistExpanded, setChecklistExpanded] = useState(true);
  const [filesExpanded, setFilesExpanded] = useState(true);

  const colorMeta = NOTE_COLORS.find((c) => c.value === note.color);
  const entityMeta = note.entity_type ? ENTITY_TYPE_META[note.entity_type] : null;

  const checkedCount = note.checklist?.filter((c) => c.is_checked).length ?? 0;
  const totalChecklist = note.checklist?.length ?? 0;

  // Render content with @mentions and #tags highlighted
  const renderContent = (content: string) => {
    const parts = content.split(/(@\w+|#\w+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return (
          <span key={i} className="text-blue-600 dark:text-blue-400 font-medium cursor-pointer hover:underline">
            {part}
          </span>
        );
      }
      if (part.startsWith('#')) {
        return (
          <span key={i} className="text-purple-600 dark:text-purple-400 font-medium cursor-pointer hover:underline">
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  const isImage = (type: string) => type.startsWith('image/');

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={cn(
        'card group relative transition-shadow hover:shadow-md',
        colorMeta ? `${colorMeta.bg} ${colorMeta.border}` : '',
        note.pinned && 'ring-1 ring-amber-300 dark:ring-amber-700',
      )}
    >
      {/* ─── Header: pin indicator + menu ─── */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {note.pinned && (
            <Pin size={13} className="text-amber-500 shrink-0 rotate-45" />
          )}
          {entityMeta && (
            <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0', entityMeta.color)}>
              {language === 'fr' ? entityMeta.labelFr : entityMeta.label}
            </span>
          )}
          {note.reminder_at && (
            <span className="inline-flex items-center gap-1 text-[10px] text-orange-600 dark:text-orange-400 font-medium shrink-0">
              <Calendar size={10} />
              {format(new Date(note.reminder_at), 'dd MMM HH:mm', { locale: language === 'fr' ? fr : undefined })}
            </span>
          )}
        </div>

        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-surface-secondary transition-colors opacity-0 group-hover:opacity-100"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-7 z-50 w-40 bg-surface border border-outline rounded-lg shadow-lg py-1">
                <button
                  onClick={() => { setMenuOpen(false); onEdit(note); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-secondary transition-colors"
                >
                  <Edit3 size={12} />
                  {t.advancedNotes.edit}
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onTogglePin(note.id, !note.pinned); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-secondary transition-colors"
                >
                  {note.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                  {note.pinned
                    ? (t.advancedNotes.unpin)
                    : (t.advancedNotes.pin)
                  }
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onViewHistory(note.id); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-secondary transition-colors"
                >
                  <History size={12} />
                  {t.advancedNotes.history}
                </button>
                <div className="border-t border-outline my-1" />
                <button
                  onClick={() => { setMenuOpen(false); onDelete(note.id); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 size={12} />
                  {t.advancedNotes.delete}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── Content ─── */}
      <div className="text-[13px] text-text-primary whitespace-pre-wrap leading-relaxed">
        {renderContent(note.content)}
      </div>

      {/* ─── Checklist ─── */}
      {totalChecklist > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setChecklistExpanded(!checklistExpanded)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-text-tertiary hover:text-text-secondary mb-1.5"
          >
            <CheckSquare size={12} />
            {checkedCount}/{totalChecklist}
            {checklistExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
          {/* Progress bar */}
          <div className="h-1 bg-surface-secondary rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-300"
              style={{ width: `${totalChecklist > 0 ? (checkedCount / totalChecklist) * 100 : 0}%` }}
            />
          </div>
          <AnimatePresence>
            {checklistExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="space-y-1 overflow-hidden"
              >
                {note.checklist?.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-center gap-2 cursor-pointer group/check"
                  >
                    <button
                      onClick={(e) => { e.preventDefault(); onToggleChecklist(item.id, !item.is_checked); }}
                      className="shrink-0"
                    >
                      {item.is_checked ? (
                        <CheckSquare size={14} className="text-green-500" />
                      ) : (
                        <Square size={14} className="text-text-tertiary group-hover/check:text-text-secondary" />
                      )}
                    </button>
                    <span className={cn(
                      'text-[12px]',
                      item.is_checked ? 'line-through text-text-tertiary' : 'text-text-secondary',
                    )}>
                      {item.text}
                    </span>
                  </label>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ─── Files ─── */}
      {(note.files?.length ?? 0) > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setFilesExpanded(!filesExpanded)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-text-tertiary hover:text-text-secondary mb-1.5"
          >
            <Paperclip size={12} />
            {note.files?.length} {t.advancedNotes.files}
            {filesExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
          <AnimatePresence>
            {filesExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="space-y-1.5 overflow-hidden"
              >
                {note.files?.map((file) => (
                  <div key={file.id} className="flex items-center gap-2 group/file">
                    {isImage(file.file_type) ? (
                      <a href={file.file_url} target="_blank" rel="noopener noreferrer" className="block">
                        <img
                          src={file.file_url}
                          alt={file.file_name}
                          className="max-w-[200px] max-h-[120px] rounded-md border border-outline object-cover"
                        />
                      </a>
                    ) : (
                      <div className="flex items-center gap-2 px-2 py-1.5 bg-surface-secondary rounded-md flex-1 min-w-0">
                        <FileText size={14} className="text-text-tertiary shrink-0" />
                        <span className="text-[11px] text-text-secondary truncate">{file.file_name}</span>
                        <a
                          href={file.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 p-0.5 rounded hover:bg-surface-tertiary transition-colors"
                        >
                          <Download size={11} className="text-text-tertiary" />
                        </a>
                      </div>
                    )}
                    <button
                      onClick={() => onDeleteFile(file.id)}
                      className="p-0.5 rounded text-text-tertiary hover:text-red-500 opacity-0 group-hover/file:opacity-100 transition-all shrink-0"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ─── Tags ─── */}
      {(note.tags?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {note.tags?.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-[10px] font-medium"
            >
              <Tag size={9} />
              {tag.tag}
            </span>
          ))}
        </div>
      )}

      {/* ─── Footer ─── */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-outline">
        <span className="text-[10px] text-text-tertiary flex items-center gap-1">
          <Clock size={10} />
          {formatDistanceToNow(new Date(note.created_at), {
            addSuffix: true,
            locale: language === 'fr' ? fr : undefined,
          })}
        </span>
        {note.updated_at !== note.created_at && (
          <span className="text-[10px] text-text-tertiary italic">
            {t.advancedNotes.edited}
          </span>
        )}
      </div>
    </motion.div>
  );
}

export default memo(NoteCard);
