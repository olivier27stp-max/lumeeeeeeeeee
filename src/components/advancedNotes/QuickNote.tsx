/* ═══════════════════════════════════════════════════════════════
   Component — QuickNote
   Floating quick-add bar for creating notes instantly.
   Supports keyboard shortcut Cmd/Ctrl + N.
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useRef, useEffect } from 'react';
import { Plus, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { createNote, addTag, addChecklistItem, extractTags } from '../../lib/notesApi';
import { cn } from '../../lib/utils';
import { useTranslation } from '../i18n';

interface QuickNoteProps {
  language: string;
  onCreated: () => void;
}

export default function QuickNote({ language, onCreated }: QuickNoteProps) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keyboard shortcut: Cmd/Ctrl + N
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        setExpanded(true);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
      if (e.key === 'Escape' && expanded) {
        setExpanded(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [expanded]);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const note = await createNote({ content: content.trim() });

      // Auto-extract and add tags from content
      const tags = extractTags(content);
      for (const tag of tags) {
        await addTag(note.id, tag);
      }

      setContent('');
      setExpanded(false);
      onCreated();
      toast.success(t.advancedNotes.noteCreated);
    } catch (err: any) {
      toast.error(err.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative">
      <AnimatePresence>
        {expanded ? (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="bg-surface border border-outline rounded-xl shadow-lg p-3 w-full"
          >
            <textarea
              ref={inputRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={language === 'fr'
                ? 'Note rapide... (Ctrl+Enter pour sauvegarder)'
                : 'Quick note... (Ctrl+Enter to save)'
              }
              className="w-full bg-transparent border-none outline-none text-[13px] text-text-primary resize-none placeholder:text-text-tertiary"
              rows={3}
              autoFocus
            />
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-outline">
              <button
                onClick={() => { setExpanded(false); setContent(''); }}
                className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
              >
                {t.advancedNotes.cancel}
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || !content.trim()}
                className="btn-primary text-[11px] px-3 py-1 flex items-center gap-1"
              >
                <Send size={11} />
                {saving ? '...' : (t.advancedNotes.create)}
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={() => { setExpanded(true); setTimeout(() => inputRef.current?.focus(), 100); }}
            className="w-full flex items-center gap-2 px-4 py-2.5 bg-surface border border-outline rounded-xl text-[13px] text-text-tertiary hover:text-text-secondary hover:border-outline-subtle hover:shadow-sm transition-all"
          >
            <Plus size={14} />
            {t.advancedNotes.quickNoteCtrln}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
