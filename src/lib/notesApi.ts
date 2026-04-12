/* ═══════════════════════════════════════════════════════════════
   API Layer — Advanced Notes
   CRUD for notes, files, tags, checklist, history.
   Uses Supabase client directly (RLS handles org scoping).
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';
import type {
  Note, NoteFile, NoteTag, NoteHistoryEntry,
  NoteChecklistItem, NoteColor, NoteEntityType,
} from '../types/note';

// ─── Notes ────────────────────────────────────────────────────

export async function fetchNotes(filters?: {
  entity_type?: NoteEntityType;
  entity_id?: string;
  tag?: string;
  color?: NoteColor;
  search?: string;
  pinned_only?: boolean;
}): Promise<Note[]> {
  let query = supabase
    .from('notes')
    .select('*, notes_files(*), notes_tags(*), notes_checklist(*)');

  if (filters?.entity_type) {
    query = query.eq('entity_type', filters.entity_type);
  }
  if (filters?.entity_id) {
    query = query.eq('entity_id', filters.entity_id);
  }
  if (filters?.color) {
    query = query.eq('color', filters.color);
  }
  if (filters?.pinned_only) {
    query = query.eq('pinned', true);
  }
  if (filters?.search) {
    query = query.ilike('content', `%${filters.search}%`);
  }

  // Pinned first, then newest
  query = query
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw error;

  let notes = (data ?? []).map((n: any) => ({
    ...n,
    files: n.notes_files ?? [],
    tags: n.notes_tags ?? [],
    checklist: (n.notes_checklist ?? []).sort((a: any, b: any) => a.position - b.position),
  }));

  // Filter by tag (post-query since it's a relation)
  if (filters?.tag) {
    notes = notes.filter((n: Note) => n.tags?.some((t) => t.tag === filters.tag));
  }

  return notes;
}

export async function fetchNote(id: string): Promise<Note> {
  const { data, error } = await supabase
    .from('notes')
    .select('*, notes_files(*), notes_tags(*), notes_checklist(*)')
    .eq('id', id)
    .single();

  if (error) throw error;
  return {
    ...data,
    files: data.notes_files ?? [],
    tags: data.notes_tags ?? [],
    checklist: (data.notes_checklist ?? []).sort((a: any, b: any) => a.position - b.position),
  };
}

export async function createNote(note: {
  content: string;
  pinned?: boolean;
  color?: NoteColor | null;
  entity_type?: NoteEntityType | null;
  entity_id?: string | null;
  reminder_at?: string | null;
}): Promise<Note> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const orgId = await getCurrentOrgIdOrThrow();

  const { data, error } = await supabase
    .from('notes')
    .insert({
      org_id: orgId,
      created_by: user.id,
      content: note.content,
      pinned: note.pinned ?? false,
      color: note.color ?? null,
      entity_type: note.entity_type ?? null,
      entity_id: note.entity_id ?? null,
      reminder_at: note.reminder_at ?? null,
    })
    .select('*, notes_files(*), notes_tags(*), notes_checklist(*)')
    .single();

  if (error) throw error;
  return {
    ...data,
    files: data.notes_files ?? [],
    tags: data.notes_tags ?? [],
    checklist: data.notes_checklist ?? [],
  };
}

export async function updateNote(id: string, updates: Partial<Pick<Note,
  'content' | 'pinned' | 'color' | 'entity_type' | 'entity_id' | 'reminder_at'
>>): Promise<void> {
  const { error } = await supabase
    .from('notes')
    .update(updates)
    .eq('id', id);

  if (error) throw error;
}

export async function deleteNote(id: string): Promise<void> {
  // Cascade: delete dependents before the note itself
  await supabase.from('notes_checklist').delete().eq('note_id', id);
  await supabase.from('notes_tags').delete().eq('note_id', id);
  await supabase.from('notes_files').delete().eq('note_id', id);

  const { error } = await supabase
    .from('notes')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function togglePin(id: string, pinned: boolean): Promise<void> {
  const { error } = await supabase
    .from('notes')
    .update({ pinned })
    .eq('id', id);

  if (error) throw error;
}

// ─── Files ────────────────────────────────────────────────────

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const BLOCKED_EXTENSIONS = new Set(['exe', 'bat', 'cmd', 'sh', 'php', 'js', 'vbs', 'ps1', 'msi', 'dll', 'scr']);

export async function uploadNoteFile(noteId: string, file: File): Promise<NoteFile> {
  if (file.size > MAX_FILE_SIZE) throw new Error(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) throw new Error(`File type .${ext} is not allowed`);
  const path = `notes/${noteId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('attachments')
    .upload(path, file, { upsert: false });

  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabase.storage
    .from('attachments')
    .getPublicUrl(path);

  const { data, error } = await supabase
    .from('notes_files')
    .insert({
      note_id: noteId,
      file_url: publicUrl,
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteNoteFile(fileId: string): Promise<void> {
  const { error } = await supabase
    .from('notes_files')
    .delete()
    .eq('id', fileId);

  if (error) throw error;
}

// ─── Tags ─────────────────────────────────────────────────────

export async function addTag(noteId: string, tag: string): Promise<NoteTag> {
  const { data, error } = await supabase
    .from('notes_tags')
    .insert({ note_id: noteId, tag: tag.toLowerCase().replace(/^#/, '') })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeTag(tagId: string): Promise<void> {
  const { error } = await supabase
    .from('notes_tags')
    .delete()
    .eq('id', tagId);

  if (error) throw error;
}

export async function fetchAllTags(): Promise<string[]> {
  const { data, error } = await supabase
    .from('notes_tags')
    .select('tag');

  if (error) throw error;
  const unique = [...new Set((data ?? []).map((t: any) => t.tag))];
  return unique.sort();
}

// ─── Checklist ────────────────────────────────────────────────

export async function addChecklistItem(noteId: string, text: string, position: number): Promise<NoteChecklistItem> {
  const { data, error } = await supabase
    .from('notes_checklist')
    .insert({ note_id: noteId, text, position })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateChecklistItem(id: string, updates: Partial<Pick<NoteChecklistItem, 'text' | 'is_checked' | 'position'>>): Promise<void> {
  const { error } = await supabase
    .from('notes_checklist')
    .update(updates)
    .eq('id', id);

  if (error) throw error;
}

export async function deleteChecklistItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('notes_checklist')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ─── History ──────────────────────────────────────────────────

export async function fetchNoteHistory(noteId: string): Promise<NoteHistoryEntry[]> {
  const { data, error } = await supabase
    .from('note_history')
    .select('*')
    .eq('note_id', noteId)
    .order('edited_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

// ─── Mentions ─────────────────────────────────────────────────

export function extractMentions(content: string): string[] {
  const matches = content.match(/@(\w+)/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(1)))];
}

export function extractTags(content: string): string[] {
  const matches = content.match(/#(\w+)/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
}

// ─── Realtime ─────────────────────────────────────────────────

export function subscribeToNotes(
  onNoteChange: (payload: any) => void,
  onChecklistChange: (payload: any) => void,
) {
  const channel = supabase
    .channel('notes_realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notes' },
      onNoteChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notes_checklist' },
      onChecklistChange,
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ─── Members lookup (for mentions) ───────────────────────────

export async function fetchOrgMembers(): Promise<{ id: string; email: string; full_name?: string }[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const orgId = await getCurrentOrgIdOrThrow();

  const { data, error } = await supabase
    .from('memberships')
    .select('user_id')
    .eq('org_id', orgId);

  if (error || !data) return [];

  // Return member IDs - email resolution happens via auth admin or profiles
  return data.map((m: any) => ({ id: m.user_id, email: '', full_name: undefined }));
}
