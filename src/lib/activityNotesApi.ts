import { supabase } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────

export interface ActivityNote {
  id: string;
  entity_type: 'client' | 'job';
  entity_id: string;
  body: string;
  actor_id: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Auth helper ─────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ─── API functions ───────────────────────────────────────────────────

export async function fetchNotes(
  entityType: 'client' | 'job',
  entityId: string,
): Promise<ActivityNote[]> {
  const headers = await getAuthHeaders();
  const query = new URLSearchParams({ entityType, entityId });
  const res = await fetch(`/api/activity-notes?${query}`, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to fetch notes');
  return data.notes || [];
}

export async function addNote(
  entityType: 'client' | 'job',
  entityId: string,
  body: string,
): Promise<ActivityNote> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/activity-notes', {
    method: 'POST',
    headers,
    body: JSON.stringify({ entityType, entityId, body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to add note');
  return data.note;
}

export async function deleteNote(id: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/activity-notes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to delete note');
}
