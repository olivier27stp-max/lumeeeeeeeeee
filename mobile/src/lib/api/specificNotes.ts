// Internal notes attached to an entity (job/client/quote), with optional file
// attachments. Mirrors the desktop `specific_notes` table. Distinct from a job's
// one-shot "completion notes" — these are a running, multi-entry log.

import { supabase } from '../supabase';

export interface NoteFile {
  name: string;
  url: string;
  path?: string;
  file_type?: 'image' | 'video' | 'document';
  size?: number;
}

export interface SpecificNote {
  id: string;
  entity_type: 'client' | 'job' | 'quote';
  entity_id: string;
  text: string | null;
  files: NoteFile[];
  created_by: string | null;
  created_at: string;
}

const COLS = 'id, entity_type, entity_id, text, files, created_by, created_at';

export async function listSpecificNotes(
  entityType: SpecificNote['entity_type'],
  entityId: string,
): Promise<SpecificNote[]> {
  const { data, error } = await supabase
    .from('specific_notes')
    .select(COLS)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ ...r, files: Array.isArray(r.files) ? r.files : [] })) as SpecificNote[];
}

export async function createSpecificNote(input: {
  orgId: string;
  entityType: SpecificNote['entity_type'];
  entityId: string;
  text: string;
  files?: NoteFile[];
  createdBy: string;
}): Promise<SpecificNote> {
  const { data, error } = await supabase
    .from('specific_notes')
    .insert({
      org_id: input.orgId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      text: input.text.trim() || null,
      files: input.files ?? [],
      created_by: input.createdBy,
    })
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  return { ...(data as any), files: (data as any).files ?? [] } as SpecificNote;
}

export async function deleteSpecificNote(id: string): Promise<void> {
  const { error } = await supabase.from('specific_notes').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Replace a note's attached files — used to remove a single photo from a note. */
export async function updateSpecificNoteFiles(id: string, files: NoteFile[]): Promise<void> {
  const { error } = await supabase.from('specific_notes').update({ files }).eq('id', id);
  if (error) throw new Error(error.message);
}
