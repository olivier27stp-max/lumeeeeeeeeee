/**
 * SpecificNotes — Reusable module for attaching notes + files to entities.
 * Used in ClientDetails (tab), JobDetails (section), QuoteCreateModal & QuoteDetails.
 *
 * Modes:
 *  - "full"    → standalone section with header (for Jobs, standalone use)
 *  - "tab"     → content only, no outer card (for tabs inside ClientDetails)
 *  - "inline"  → compact section for embedding inside forms (QuoteCreateModal)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus, Trash2, Pencil, X, Upload, FileText, Film, Image as ImageIcon,
  Download, ChevronDown, ChevronUp, Paperclip, Eye,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../lib/utils';
import {
  listSpecificNotes,
  createSpecificNote,
  updateSpecificNote,
  deleteSpecificNote,
  uploadSpecificNoteFile,
  removeFileFromNote,
  type SpecificNote,
  type SpecificNoteFile,
  type EntityType,
} from '../lib/specificNotesApi';
import { toast } from 'sonner';

// ── Props ──

interface SpecificNotesProps {
  entityType: EntityType;
  entityId: string;
  mode?: 'full' | 'tab' | 'inline';
  className?: string;
}

// ── Helpers ──

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ACCEPTED_TYPES = 'image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(type: SpecificNoteFile['file_type']) {
  switch (type) {
    case 'image': return <ImageIcon size={14} />;
    case 'video': return <Film size={14} />;
    default: return <FileText size={14} />;
  }
}

function fileIconColor(type: SpecificNoteFile['file_type']) {
  switch (type) {
    case 'image': return 'text-sky-500 bg-sky-500/10';
    case 'video': return 'text-violet-500 bg-violet-500/10';
    default: return 'text-amber-500 bg-amber-500/10';
  }
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ── Main Component ──

export default function SpecificNotes({ entityType, entityId, mode = 'full', className }: SpecificNotesProps) {
  const [notes, setNotes] = useState<SpecificNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formText, setFormText] = useState('');
  const [formFiles, setFormFiles] = useState<SpecificNoteFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  // Lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Drag state
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const editNoteIdRef = useRef<string | null>(null);

  // ── Load notes ──
  const [loadError, setLoadError] = useState(false);
  const load = useCallback(async () => {
    if (!entityId) { setLoading(false); return; }
    try {
      setLoadError(false);
      const data = await listSpecificNotes(entityType, entityId);
      setNotes(data);
    } catch (err: any) {
      console.error('Failed to load specific notes:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => { load(); }, [load]);

  // ── File upload handler ──
  const handleFiles = async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    const valid = fileArr.filter((f) => {
      if (f.size > MAX_FILE_SIZE) {
        toast.error(`${f.name} is too large (max 50 MB)`);
        return false;
      }
      return true;
    });
    if (valid.length === 0) return;

    setUploading(true);
    try {
      const uploaded: SpecificNoteFile[] = [];
      for (const file of valid) {
        const result = await uploadSpecificNoteFile(entityType, entityId, file);
        uploaded.push(result);
      }
      setFormFiles((prev) => [...prev, ...uploaded]);
      toast.success(`${uploaded.length} file${uploaded.length > 1 ? 's' : ''} uploaded`);
    } catch (err: any) {
      toast.error(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // ── Add files to existing note ──
  const handleAddFilesToNote = async (noteId: string, files: FileList | File[]) => {
    const fileArr = Array.from(files).filter((f) => f.size <= MAX_FILE_SIZE);
    if (fileArr.length === 0) return;

    setUploading(true);
    try {
      const uploaded: SpecificNoteFile[] = [];
      for (const file of fileArr) {
        const result = await uploadSpecificNoteFile(entityType, entityId, file);
        uploaded.push(result);
      }
      const note = notes.find((n) => n.id === noteId);
      if (!note) return;
      const updated = await updateSpecificNote(noteId, {
        files: [...note.files, ...uploaded],
      });
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
      toast.success('Files added');
    } catch (err: any) {
      toast.error(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // ── Drag & drop ──
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      if (!showForm) setShowForm(true);
      handleFiles(e.dataTransfer.files);
    }
  };

  // ── Save new note ──
  const handleSave = async () => {
    if (!formText.trim() && formFiles.length === 0) {
      toast.error('Add some text or files');
      return;
    }
    setSaving(true);
    try {
      const note = await createSpecificNote(
        entityType,
        entityId,
        formText.trim() || null,
        formFiles,
      );
      setNotes((prev) => [note, ...prev]);
      setFormText('');
      setFormFiles([]);
      setShowForm(false);
      toast.success('Note added');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save note');
    } finally {
      setSaving(false);
    }
  };

  // ── Update note text ──
  const handleUpdateText = async (noteId: string) => {
    try {
      const updated = await updateSpecificNote(noteId, { text: editText.trim() || null });
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
      setEditingId(null);
      toast.success('Note updated');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update');
    }
  };

  // ── Delete note ──
  const handleDelete = async (noteId: string) => {
    try {
      await deleteSpecificNote(noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success('Note deleted');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete');
    }
  };

  // ── Remove file from note ──
  const handleRemoveFile = async (noteId: string, filePath: string) => {
    try {
      const updated = await removeFileFromNote(noteId, filePath);
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
      toast.success('File removed');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove file');
    }
  };

  // ── Remove file from form (not yet saved) ──
  const handleRemoveFormFile = (path: string) => {
    setFormFiles((prev) => prev.filter((f) => f.path !== path));
  };

  // ── Render file grid ──
  const renderFiles = (files: SpecificNoteFile[], noteId?: string) => {
    if (files.length === 0) return null;

    const images = files.filter((f) => f.file_type === 'image');
    const videos = files.filter((f) => f.file_type === 'video');
    const docs = files.filter((f) => f.file_type === 'document');

    return (
      <div className="space-y-2 mt-2">
        {/* Image grid */}
        {images.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {images.map((f) => (
              <div key={f.path} className="relative group rounded-lg overflow-hidden border border-outline-subtle bg-surface-secondary aspect-square">
                <img
                  src={f.url}
                  alt={f.name}
                  className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform"
                  onClick={() => setLightboxUrl(f.url)}
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />
                <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setLightboxUrl(f.url)}
                    className="p-1 rounded bg-black/60 text-white hover:bg-black/80"
                    title="View"
                  >
                    <Eye size={12} />
                  </button>
                  {noteId && (
                    <button
                      onClick={() => handleRemoveFile(noteId, f.path)}
                      className="p-1 rounded bg-black/60 text-white hover:bg-red-500"
                      title="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/60 to-transparent">
                  <p className="text-[10px] text-white truncate">{f.name}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Videos */}
        {videos.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {videos.map((f) => (
              <div key={f.path} className="relative group rounded-lg overflow-hidden border border-outline-subtle bg-black">
                <video
                  src={f.url}
                  controls
                  preload="metadata"
                  className="w-full max-h-[240px] object-contain"
                />
                <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {noteId && (
                    <button
                      onClick={() => handleRemoveFile(noteId, f.path)}
                      className="p-1 rounded bg-black/60 text-white hover:bg-red-500"
                      title="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 px-2.5 py-1.5 bg-surface-secondary">
                  <Film size={12} className="text-violet-500 shrink-0" />
                  <p className="text-[11px] text-text-secondary truncate">{f.name}</p>
                  <span className="text-[10px] text-text-tertiary ml-auto shrink-0">{formatFileSize(f.size)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Documents */}
        {docs.length > 0 && (
          <div className="space-y-1.5">
            {docs.map((f) => (
              <div key={f.path} className="flex items-center gap-2.5 rounded-lg border border-outline-subtle bg-surface-secondary px-3 py-2 group">
                <div className={cn('w-7 h-7 rounded flex items-center justify-center shrink-0', fileIconColor('document'))}>
                  <FileText size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-text-primary truncate">{f.name}</p>
                  <p className="text-[10px] text-text-tertiary">{formatFileSize(f.size)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1 rounded hover:bg-surface-tertiary text-text-tertiary hover:text-text-primary transition-colors"
                    title="Download"
                  >
                    <Download size={13} />
                  </a>
                  {noteId && (
                    <button
                      onClick={() => handleRemoveFile(noteId, f.path)}
                      className="p-1 rounded hover:bg-surface-tertiary text-text-tertiary hover:text-danger transition-colors opacity-0 group-hover:opacity-100"
                      title="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Render a single note card ──
  const renderNoteCard = (note: SpecificNote) => {
    const isEditing = editingId === note.id;

    return (
      <motion.div
        key={note.id}
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="rounded-xl border border-outline-subtle bg-surface p-4 space-y-2 group/card"
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
            <Paperclip size={11} />
            <span>{relativeTime(note.created_at)}</span>
            {note.files.length > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-tertiary text-[10px] font-medium">
                {note.files.length} file{note.files.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity">
            <button
              onClick={() => {
                editNoteIdRef.current = note.id;
                editFileInputRef.current?.click();
              }}
              className="p-1 rounded hover:bg-surface-tertiary text-text-tertiary hover:text-text-primary"
              title="Add files"
            >
              <Upload size={12} />
            </button>
            <button
              onClick={() => {
                if (isEditing) {
                  setEditingId(null);
                } else {
                  setEditingId(note.id);
                  setEditText(note.text || '');
                }
              }}
              className="p-1 rounded hover:bg-surface-tertiary text-text-tertiary hover:text-text-primary"
              title="Edit"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={() => handleDelete(note.id)}
              className="p-1 rounded hover:bg-surface-tertiary text-text-tertiary hover:text-danger"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {/* Text */}
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="glass-input w-full min-h-[60px] text-[13px] resize-none"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => handleUpdateText(note.id)}
                className="glass-button-primary !text-[12px] !px-3 !py-1"
              >
                Save
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="glass-button !text-[12px] !px-3 !py-1"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : note.text ? (
          <p className="text-[13px] text-text-secondary whitespace-pre-wrap leading-relaxed">
            {note.text}
          </p>
        ) : null}

        {/* Files */}
        {renderFiles(note.files, note.id)}
      </motion.div>
    );
  };

  // ── Main render ──

  const content = (
    <div
      className={cn('space-y-3', className)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop zone overlay */}
      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-xl flex items-center justify-center pointer-events-none"
          >
            <div className="text-center">
              <Upload size={32} className="mx-auto text-primary mb-2" />
              <p className="text-[14px] font-semibold text-primary">Drop files here</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Note button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="glass-button-primary !text-[12px] flex items-center gap-1.5"
        >
          <Plus size={13} /> Add Note
        </button>
      )}

      {/* New Note form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-primary/30 bg-surface p-4 space-y-3">
              <textarea
                value={formText}
                onChange={(e) => setFormText(e.target.value)}
                placeholder="Write a note..."
                className="glass-input w-full min-h-[70px] text-[13px] resize-none"
                autoFocus
              />

              {/* Uploaded files preview */}
              {formFiles.length > 0 && (
                <div className="space-y-1.5">
                  {formFiles.map((f) => (
                    <div key={f.path} className="flex items-center gap-2 rounded-lg bg-surface-secondary px-2.5 py-1.5">
                      <div className={cn('w-5 h-5 rounded flex items-center justify-center shrink-0', fileIconColor(f.file_type))}>
                        {fileIcon(f.file_type)}
                      </div>
                      <span className="text-[12px] text-text-primary truncate flex-1">{f.name}</span>
                      <span className="text-[10px] text-text-tertiary shrink-0">{formatFileSize(f.size)}</span>
                      <button
                        onClick={() => handleRemoveFormFile(f.path)}
                        className="p-0.5 rounded hover:bg-surface-tertiary text-text-tertiary hover:text-danger"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Action bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="glass-button !text-[12px] flex items-center gap-1.5"
                  >
                    <Upload size={12} />
                    {uploading ? 'Uploading...' : 'Add Files'}
                  </button>
                  <span className="text-[10px] text-text-tertiary">
                    Images, videos, PDFs, documents (max 50 MB)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setShowForm(false); setFormText(''); setFormFiles([]); }}
                    className="glass-button !text-[12px]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || uploading}
                    className="glass-button-primary !text-[12px] disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Note'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Notes list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-outline-subtle bg-surface p-4 animate-pulse">
              <div className="h-3 w-24 bg-surface-tertiary rounded mb-3" />
              <div className="h-4 w-3/4 bg-surface-tertiary rounded mb-2" />
              <div className="h-4 w-1/2 bg-surface-tertiary rounded" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="text-center py-6">
          <Paperclip size={24} className="mx-auto text-text-tertiary mb-2 opacity-40" />
          <p className="text-[13px] text-text-tertiary">Notes spécifiques</p>
          <p className="text-[11px] text-text-muted mt-1">La table n'est pas encore configurée. Exécutez la migration SQL.</p>
        </div>
      ) : notes.length === 0 && !showForm ? (
        <div className="text-center py-8">
          <Paperclip size={24} className="mx-auto text-text-tertiary mb-2 opacity-40" />
          <p className="text-[13px] text-text-tertiary">No specific notes yet.</p>
          <p className="text-[11px] text-text-muted mt-1">Add photos, videos, documents or text notes.</p>
        </div>
      ) : (
        <AnimatePresence mode="popLayout">
          {notes.map(renderNoteCard)}
        </AnimatePresence>
      )}

      {/* Hidden file inputs */}
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
      <input
        ref={editFileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={(e) => {
          if (e.target.files && editNoteIdRef.current) {
            handleAddFilesToNote(editNoteIdRef.current, e.target.files);
          }
          e.target.value = '';
        }}
      />

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setLightboxUrl(null)}
          >
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <X size={20} />
            </button>
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              src={lightboxUrl}
              alt="Preview"
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  // ── Wrap based on mode ──

  if (mode === 'tab' || mode === 'inline') {
    return content;
  }

  // "full" mode — wrapped in a section card
  return (
    <div className="rounded-xl border border-outline bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
        <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
          <div className="icon-tile icon-tile-sm icon-tile-purple">
            <Paperclip size={13} strokeWidth={2} />
          </div>
          Notes spécifiques
        </h2>
      </div>
      <div className="p-5">
        {content}
      </div>
    </div>
  );
}
