/**
 * API helpers for the specific_notes table.
 * Used by SpecificNotes.tsx and SpecificNotesInline.tsx.
 */

import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

// ── Types ──

export type EntityType = 'client' | 'job' | 'quote';

export interface SpecificNoteFile {
  name: string;
  url: string;
  path: string;
  file_type: 'image' | 'video' | 'document';
  size: number;
}

export interface SpecificNote {
  id: string;
  org_id: string;
  entity_type: EntityType;
  entity_id: string;
  text: string | null;
  files: SpecificNoteFile[];
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Helpers ──

function detectFileType(file: File): SpecificNoteFile['file_type'] {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return 'document';
}

// ── CRUD ──

export async function listSpecificNotes(
  entityType: EntityType,
  entityId: string,
): Promise<SpecificNote[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('specific_notes')
    .select('*')
    .eq('org_id', orgId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as SpecificNote[];
}

export async function createSpecificNote(
  entityType: EntityType,
  entityId: string,
  text: string | null,
  files: SpecificNoteFile[],
): Promise<SpecificNote> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('specific_notes')
    .insert({
      org_id: orgId,
      entity_type: entityType,
      entity_id: entityId,
      text,
      files: files as any,
      created_by: user?.id ?? null,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as SpecificNote;
}

export async function updateSpecificNote(
  noteId: string,
  updates: { text?: string | null; files?: SpecificNoteFile[] },
): Promise<SpecificNote> {
  const payload: Record<string, unknown> = {};
  if ('text' in updates) payload.text = updates.text;
  if ('files' in updates) payload.files = updates.files as any;

  const { data, error } = await supabase
    .from('specific_notes')
    .update(payload)
    .eq('id', noteId)
    .select('*')
    .single();

  if (error) throw error;
  return data as SpecificNote;
}

export async function deleteSpecificNote(noteId: string): Promise<void> {
  const { error } = await supabase
    .from('specific_notes')
    .delete()
    .eq('id', noteId);

  if (error) throw error;
}

// ── File operations ──

const STORAGE_BUCKET = 'attachments';

export async function uploadSpecificNoteFile(
  entityType: EntityType,
  entityId: string,
  file: File,
): Promise<SpecificNoteFile> {
  const ext = file.name.split('.').pop() || 'bin';
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const storagePath = `specific-notes/${entityType}/${entityId}/${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, { cacheControl: '3600', upsert: true });

  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath);

  return {
    name: file.name,
    url: urlData.publicUrl,
    path: storagePath,
    file_type: detectFileType(file),
    size: file.size,
  };
}

export async function removeFileFromNote(
  noteId: string,
  filePath: string,
): Promise<SpecificNote> {
  // Fetch current note to filter out the file
  const { data: note, error: fetchError } = await supabase
    .from('specific_notes')
    .select('*')
    .eq('id', noteId)
    .single();

  if (fetchError) throw fetchError;

  const currentFiles = (note.files || []) as SpecificNoteFile[];
  const updatedFiles = currentFiles.filter((f) => f.path !== filePath);

  // Remove from storage (best-effort)
  await supabase.storage.from(STORAGE_BUCKET).remove([filePath]).catch(() => {});

  // Update the note
  const { data, error } = await supabase
    .from('specific_notes')
    .update({ files: updatedFiles as any })
    .eq('id', noteId)
    .select('*')
    .single();

  if (error) throw error;
  return data as SpecificNote;
}
