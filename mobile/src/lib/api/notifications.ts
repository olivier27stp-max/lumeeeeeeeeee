// In-app notifications (bell). Reads the shared `notifications` table the web
// uses. Columns vary slightly across deployments, so we select('*') and read
// fields defensively, and writes are best-effort.

import { supabase } from '../supabase';

export interface NotificationRow {
  id: string;
  type?: string | null;
  category?: string | null;
  title: string;
  body?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  read_at?: string | null;
  dismissed_at?: string | null;
  created_at: string;
}

/**
 * Create an org-wide notification (shows in everyone's bell). Best-effort —
 * never throws, so it can't break the action that triggered it (new client,
 * new job, quote sent, …).
 */
export async function createNotification(params: {
  orgId: string;
  title: string;
  body?: string | null;
  category?: string;
  type?: string;
  entityType?: string | null;
  entityId?: string | null;
}): Promise<void> {
  await supabase
    .from('notifications')
    .insert({
      org_id: params.orgId,
      type: params.type ?? 'info',
      category: params.category ?? 'general',
      title: params.title,
      body: params.body ?? null,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
    })
    .then(undefined, () => {});
}

/** Latest notifications for the org (and this user, or org-wide rows). */
export async function listNotifications(orgId: string, userId: string): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  // Keep rows addressed to everyone (user_id null) or to this user.
  return (data ?? []).filter((n: any) => !n.user_id || n.user_id === userId) as NotificationRow[];
}

/** Count of unread (best-effort: a row with no read_at/dismissed_at). */
export function unreadCount(rows: NotificationRow[]): number {
  return rows.filter((n) => !n.read_at && !n.dismissed_at).length;
}

/** Mark one notification read. Best-effort — ignores schema differences. */
export async function markNotificationRead(id: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .then(undefined, () => {});
}

/** Mark every org notification read. Best-effort. */
export async function markAllNotificationsRead(orgId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .is('read_at', null)
    .then(undefined, () => {});
}
