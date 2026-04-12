/**
 * SpecificNotesInline — Lightweight inline version for forms (QuoteCreateModal).
 * Collects text + files without saving to DB yet. Parent calls getPendingNote()
 * after entity creation, then uses the API to persist.
 */

import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import {
  Upload, X, FileText, Film, Image as ImageIcon, Paperclip, Plus,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  uploadSpecificNoteFile,
  createSpecificNote,
  type SpecificNoteFile,
  type EntityType,
} from '../lib/specificNotesApi';
import { toast } from 'sonner';

// ── Types ──

export interface SpecificNotesInlineHandle {
  /** Call after entity creation to save note. Returns true if a note was created. */
  saveNote: (entityType: EntityType, entityId: string) => Promise<boolean>;
  /** Whether any content (text or files) has been added */
  hasContent: () => boolean;
}

interface SpecificNotesInlineProps {
  /** Used to build the upload storage path before entity creation */
  tempEntityType: EntityType;
  tempEntityId?: string;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ACCEPTED_TYPES = 'image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIconColor(type: SpecificNoteFile['file_type']) {
  switch (type) {
    case 'image': return 'text-sky-500 bg-sky-500/10';
    case 'video': return 'text-violet-500 bg-violet-500/10';
    default: return 'text-amber-500 bg-amber-500/10';
  }
}

function fileIcon(type: SpecificNoteFile['file_type']) {
  switch (type) {
    case 'image': return <ImageIcon size={12} />;
    case 'video': return <Film size={12} />;
    default: return <FileText size={12} />;
  }
}

// ── Component ──

const SpecificNotesInline = forwardRef<SpecificNotesInlineHandle, SpecificNotesInlineProps>(
  ({ tempEntityType, tempEntityId }, ref) => {
    const [text, setText] = useState('');
    const [files, setFiles] = useState<SpecificNoteFile[]>([]);
    const [uploading, setUploading] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Temporary ID for upload paths before real entity ID exists
    const uploadId = tempEntityId || 'draft-' + crypto.randomUUID().slice(0, 8);

    const handleFiles = async (fileList: FileList | File[]) => {
      const arr = Array.from(fileList).filter((f) => {
        if (f.size > MAX_FILE_SIZE) {
          toast.error(`${f.name} is too large (max 50 MB)`);
          return false;
        }
        return true;
      });
      if (arr.length === 0) return;

      setUploading(true);
      try {
        const uploaded: SpecificNoteFile[] = [];
        for (const file of arr) {
          const result = await uploadSpecificNoteFile(tempEntityType, uploadId, file);
          uploaded.push(result);
        }
        setFiles((prev) => [...prev, ...uploaded]);
        toast.success(`${uploaded.length} file${uploaded.length > 1 ? 's' : ''} uploaded`);
      } catch (err: any) {
        toast.error(err?.message || 'Upload failed');
      } finally {
        setUploading(false);
      }
    };

    useImperativeHandle(ref, () => ({
      hasContent: () => text.trim().length > 0 || files.length > 0,
      saveNote: async (entityType: EntityType, entityId: string) => {
        if (!text.trim() && files.length === 0) return false;
        try {
          await createSpecificNote(entityType, entityId, text.trim() || null, files);
          return true;
        } catch (err: any) {
          console.error('Failed to save specific note:', err);
          return false;
        }
      },
    }));

    if (!expanded) {
      return (
        <div className="section-card border-dashed p-4">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex items-center gap-2 text-[13px] font-medium text-text-secondary hover:text-primary transition-colors"
          >
            <Paperclip size={14} />
            Notes spécifiques
            <span className="text-[11px] text-text-tertiary">(photos, vidéos, documents, notes)</span>
          </button>
        </div>
      );
    }

    return (
      <div className="section-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[14px] font-bold tracking-tight text-text-primary flex items-center gap-2">
            <Paperclip size={14} className="text-violet-500" />
            Notes spécifiques
          </h4>
          <button
            type="button"
            onClick={() => { setExpanded(false); setText(''); setFiles([]); }}
            className="text-text-tertiary hover:text-danger"
          >
            <X size={14} />
          </button>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add notes, details, context..."
          className="glass-input w-full min-h-[60px] text-[13px] resize-none"
        />

        {/* Files */}
        {files.length > 0 && (
          <div className="space-y-1.5">
            {files.map((f) => (
              <div key={f.path} className="flex items-center gap-2 rounded-lg bg-surface-secondary px-2.5 py-1.5">
                <div className={cn('w-5 h-5 rounded flex items-center justify-center shrink-0', fileIconColor(f.file_type))}>
                  {fileIcon(f.file_type)}
                </div>
                {f.file_type === 'image' && (
                  <img src={f.url} alt={f.name} className="w-8 h-8 rounded object-cover shrink-0" />
                )}
                <span className="text-[12px] text-text-primary truncate flex-1">{f.name}</span>
                <span className="text-[10px] text-text-tertiary shrink-0">{formatFileSize(f.size)}</span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((x) => x.path !== f.path))}
                  className="p-0.5 rounded hover:bg-surface-tertiary text-text-tertiary hover:text-danger"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="glass-button !text-[12px] flex items-center gap-1.5"
          >
            <Upload size={12} />
            {uploading ? 'Uploading...' : 'Add Files'}
          </button>
          <span className="text-[10px] text-text-tertiary">
            Photos, vidéos, PDF, documents (max 50 MB)
          </span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    );
  },
);

SpecificNotesInline.displayName = 'SpecificNotesInline';
export default SpecificNotesInline;
