/* ═══════════════════════════════════════════════════════════════
   Component — NoteHistoryPanel
   Shows modification history of a note in a side panel / modal.
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useEffect } from 'react';
import { History, Clock, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import Modal from '../ui/Modal';
import { fetchNoteHistory } from '../../lib/notesApi';
import type { NoteHistoryEntry } from '../../types/note';
import { useTranslation } from '../i18n';

interface NoteHistoryPanelProps {
  open: boolean;
  onClose: () => void;
  noteId: string | null;
  language: string;
}

export default function NoteHistoryPanel({ open, onClose, noteId, language }: NoteHistoryPanelProps) {
  const [entries, setEntries] = useState<NoteHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !noteId) return;
    setLoading(true);
    fetchNoteHistory(noteId)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [open, noteId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.advancedNotes.editHistory}
      size="lg"
    >
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-surface-secondary rounded-lg animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8">
          <History size={24} className="mx-auto text-text-tertiary mb-2" />
          <p className="text-[13px] text-text-tertiary">
            {t.advancedNotes.noEditsYet}
          </p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[50vh] overflow-y-auto">
          {entries.map((entry) => (
            <div key={entry.id} className="border border-outline rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Clock size={12} className="text-text-tertiary" />
                <span className="text-[11px] font-medium text-text-secondary">
                  {format(new Date(entry.edited_at), 'dd MMM yyyy HH:mm', {
                    locale: language === 'fr' ? fr : undefined,
                  })}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-red-50 dark:bg-red-950/20 rounded-md p-2">
                  <p className="text-[10px] font-medium text-red-600 dark:text-red-400 mb-1">
                    {t.advancedNotes.before}
                  </p>
                  <p className="text-[11px] text-text-secondary whitespace-pre-wrap line-clamp-4">
                    {entry.old_content || '(empty)'}
                  </p>
                </div>
                <div className="bg-green-50 dark:bg-green-950/20 rounded-md p-2">
                  <p className="text-[10px] font-medium text-green-600 dark:text-green-400 mb-1">
                    {t.advancedNotes.after}
                  </p>
                  <p className="text-[11px] text-text-secondary whitespace-pre-wrap line-clamp-4">
                    {entry.new_content || '(empty)'}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
