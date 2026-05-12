/* ═══════════════════════════════════════════════════════════════
   API Layer — Note Boards
   All CRUD for boards, items, connections, and entity links.
   Uses Supabase client directly (RLS handles org scoping).
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import type {
  NoteBoard, NoteItem, NoteConnection, NoteEntityLink,
  BoardType, NoteItemType, EntityType,
} from '../types/noteBoard';

// ─── Boards ────────────────────────────────────────────────────

export async function fetchBoards(): Promise<NoteBoard[]> {
  const { data, error } = await supabase
    .from('note_boards')
    .select('*, note_items(count)')
    .is('archived_at', null)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((b: any) => ({
    ...b,
    item_count: b.note_items?.[0]?.count ?? 0,
  }));
}

export async function fetchBoard(id: string): Promise<NoteBoard> {
  const { data, error } = await supabase
    .from('note_boards')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

export async function createBoard(board: {
  title: string;
  description?: string;
  board_type?: BoardType;
  tags?: string[];
}): Promise<NoteBoard> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: membership } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (!membership?.org_id) throw new Error('No organization');

  const { data, error } = await supabase
    .from('note_boards')
    .insert({
      org_id: membership.org_id,
      created_by: user.id,
      title: board.title,
      description: board.description ?? null,
      board_type: board.board_type ?? 'freeform',
      tags: board.tags ?? [],
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateBoard(id: string, updates: Partial<Pick<NoteBoard,
  'title' | 'description' | 'board_type' | 'tags' | 'thumbnail_url' |
  'viewport_x' | 'viewport_y' | 'viewport_zoom'
>>): Promise<void> {
  const { error } = await supabase
    .from('note_boards')
    .update(updates)
    .eq('id', id);

  if (error) throw error;
}

export async function deleteBoard(id: string): Promise<void> {
  const { error } = await supabase
    .from('note_boards')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function archiveBoard(id: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('note_boards')
    .update({ archived_at: new Date().toISOString(), archived_by: user?.id })
    .eq('id', id);

  if (error) throw error;
}

// ─── Items ─────────────────────────────────────────────────────

export async function fetchBoardItems(boardId: string): Promise<NoteItem[]> {
  const { data, error } = await supabase
    .from('note_items')
    .select('*, note_entity_links(*)')
    .eq('board_id', boardId)
    .order('z_index', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((item: any) => ({
    ...item,
    entity_links: item.note_entity_links ?? [],
  }));
}

export async function createItem(item: {
  board_id: string;
  item_type: NoteItemType;
  pos_x: number;
  pos_y: number;
  width?: number;
  height?: number;
  content?: string;
  color?: string;
  shape_type?: string | null;
  rich_content?: any;
  font_size?: number;
  text_align?: string;
  border_style?: string;
}): Promise<NoteItem> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('note_items')
    .insert({ ...item, created_by: user.id })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateItem(id: string, updates: Partial<Pick<NoteItem,
  'pos_x' | 'pos_y' | 'width' | 'height' | 'rotation' | 'z_index' |
  'content' | 'rich_content' | 'color' | 'font_size' | 'text_align' |
  'shape_type' | 'border_style' | 'file_url' | 'file_name' | 'file_type' |
  'file_size' | 'link_url' | 'link_title' | 'link_preview' | 'locked'
>>): Promise<void> {
  const { error } = await supabase
    .from('note_items')
    .update(updates)
    .eq('id', id);

  if (error) throw error;
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('note_items')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function bulkDeleteItems(ids: string[]): Promise<void> {
  const { error } = await supabase
    .from('note_items')
    .delete()
    .in('id', ids);

  if (error) throw error;
}

// ─── Connections ───────────────────────────────────────────────

export async function fetchBoardConnections(boardId: string): Promise<NoteConnection[]> {
  const { data, error } = await supabase
    .from('note_connections')
    .select('*')
    .eq('board_id', boardId);

  if (error) throw error;
  return data ?? [];
}

export async function createConnection(conn: {
  board_id: string;
  source_id: string;
  target_id: string;
  label?: string;
  line_type?: string;
  color?: string;
}): Promise<NoteConnection> {
  const { data, error } = await supabase
    .from('note_connections')
    .insert(conn)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateConnection(id: string, updates: Partial<Pick<NoteConnection,
  'label' | 'line_type' | 'color' | 'stroke_width' | 'animated' | 'arrow_start' | 'arrow_end'
>>): Promise<void> {
  const { error } = await supabase
    .from('note_connections')
    .update(updates)
    .eq('id', id);

  if (error) throw error;
}

export async function deleteConnection(id: string): Promise<void> {
  const { error } = await supabase
    .from('note_connections')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ─── Entity Links ──────────────────────────────────────────────

export async function linkEntity(itemId: string, entityType: EntityType, entityId: string): Promise<NoteEntityLink> {
  const { data, error } = await supabase
    .from('note_entity_links')
    .insert({ item_id: itemId, entity_type: entityType, entity_id: entityId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function unlinkEntity(linkId: string): Promise<void> {
  const { error } = await supabase
    .from('note_entity_links')
    .delete()
    .eq('id', linkId);

  if (error) throw error;
}

// ─── Board template starter items ─────────────────────────────

type StarterItem = {
  item_type: NoteItemType;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  content: string;
  color?: string;
  font_size?: number;
  shape_type?: string | null;
};

function getTemplateItems(boardType: BoardType): StarterItem[] {
  if (boardType === 'freeform') return [];

  if (boardType === 'meeting') {
    return [
      { item_type: 'text', pos_x: 50, pos_y: 30, width: 500, height: 40, content: 'Meeting Notes', font_size: 24 },
      { item_type: 'sticky_note', pos_x: 50, pos_y: 100, width: 240, height: 180, content: 'Agenda\n\n1. \n2. \n3. ', color: '#93c5fd' },
      { item_type: 'sticky_note', pos_x: 320, pos_y: 100, width: 240, height: 180, content: 'Decisions\n\n- ', color: '#86efac' },
      { item_type: 'sticky_note', pos_x: 50, pos_y: 310, width: 240, height: 180, content: 'Discussion Notes\n\n', color: '#fef08a' },
      { item_type: 'sticky_note', pos_x: 320, pos_y: 310, width: 240, height: 180, content: 'Action Items\n\n[ ] \n[ ] ', color: '#fdba74' },
    ];
  }

  if (boardType === 'brainstorm') {
    return [
      { item_type: 'text', pos_x: 200, pos_y: 20, width: 300, height: 40, content: 'Brainstorm Session', font_size: 24 },
      { item_type: 'sticky_note', pos_x: 100, pos_y: 100, width: 160, height: 120, content: 'Idea 1', color: '#fef08a' },
      { item_type: 'sticky_note', pos_x: 300, pos_y: 100, width: 160, height: 120, content: 'Idea 2', color: '#93c5fd' },
      { item_type: 'sticky_note', pos_x: 500, pos_y: 100, width: 160, height: 120, content: 'Idea 3', color: '#86efac' },
      { item_type: 'sticky_note', pos_x: 100, pos_y: 260, width: 160, height: 120, content: 'Idea 4', color: '#f9a8d4' },
      { item_type: 'sticky_note', pos_x: 300, pos_y: 260, width: 160, height: 120, content: 'Idea 5', color: '#c4b5fd' },
      { item_type: 'sticky_note', pos_x: 500, pos_y: 260, width: 160, height: 120, content: 'Idea 6', color: '#fdba74' },
      { item_type: 'text', pos_x: 200, pos_y: 420, width: 300, height: 30, content: 'Top Picks / Next Steps', font_size: 18 },
    ];
  }

  if (boardType === 'project_plan') {
    return [
      { item_type: 'text', pos_x: 50, pos_y: 20, width: 400, height: 40, content: 'Project Plan', font_size: 24 },
      { item_type: 'shape', pos_x: 50, pos_y: 90, width: 200, height: 150, content: 'Goals\n\n- \n- ', color: '#93c5fd', shape_type: 'rectangle' },
      { item_type: 'shape', pos_x: 280, pos_y: 90, width: 200, height: 150, content: 'Key Tasks\n\n- \n- ', color: '#86efac', shape_type: 'rectangle' },
      { item_type: 'shape', pos_x: 510, pos_y: 90, width: 200, height: 150, content: 'Blockers\n\n- ', color: '#fca5a5', shape_type: 'rectangle' },
      { item_type: 'sticky_note', pos_x: 50, pos_y: 280, width: 660, height: 100, content: 'Timeline / Milestones\n\n', color: '#fef08a' },
      { item_type: 'sticky_note', pos_x: 50, pos_y: 410, width: 320, height: 120, content: 'Resources Needed\n\n', color: '#d1d5db' },
      { item_type: 'sticky_note', pos_x: 400, pos_y: 410, width: 310, height: 120, content: 'Risks\n\n', color: '#fdba74' },
    ];
  }

  if (boardType === 'retrospective') {
    return [
      { item_type: 'text', pos_x: 150, pos_y: 20, width: 400, height: 40, content: 'Retrospective', font_size: 24 },
      { item_type: 'text', pos_x: 50, pos_y: 80, width: 200, height: 30, content: 'What Went Well', font_size: 16 },
      { item_type: 'text', pos_x: 280, pos_y: 80, width: 200, height: 30, content: 'To Improve', font_size: 16 },
      { item_type: 'text', pos_x: 510, pos_y: 80, width: 200, height: 30, content: 'Action Items', font_size: 16 },
      { item_type: 'sticky_note', pos_x: 50, pos_y: 120, width: 200, height: 120, content: '', color: '#86efac' },
      { item_type: 'sticky_note', pos_x: 50, pos_y: 260, width: 200, height: 120, content: '', color: '#86efac' },
      { item_type: 'sticky_note', pos_x: 280, pos_y: 120, width: 200, height: 120, content: '', color: '#fca5a5' },
      { item_type: 'sticky_note', pos_x: 280, pos_y: 260, width: 200, height: 120, content: '', color: '#fca5a5' },
      { item_type: 'sticky_note', pos_x: 510, pos_y: 120, width: 200, height: 120, content: '', color: '#93c5fd' },
      { item_type: 'sticky_note', pos_x: 510, pos_y: 260, width: 200, height: 120, content: '', color: '#93c5fd' },
    ];
  }

  if (boardType === 'kanban') {
    return [
      { item_type: 'text', pos_x: 50, pos_y: 20, width: 160, height: 30, content: 'To Do', font_size: 18 },
      { item_type: 'text', pos_x: 280, pos_y: 20, width: 160, height: 30, content: 'In Progress', font_size: 18 },
      { item_type: 'text', pos_x: 510, pos_y: 20, width: 160, height: 30, content: 'Done', font_size: 18 },
      { item_type: 'shape', pos_x: 50, pos_y: 60, width: 200, height: 400, content: '', color: '#f1f5f9', shape_type: 'rectangle' },
      { item_type: 'shape', pos_x: 280, pos_y: 60, width: 200, height: 400, content: '', color: '#f1f5f9', shape_type: 'rectangle' },
      { item_type: 'shape', pos_x: 510, pos_y: 60, width: 200, height: 400, content: '', color: '#f1f5f9', shape_type: 'rectangle' },
      { item_type: 'sticky_note', pos_x: 65, pos_y: 80, width: 170, height: 80, content: 'Task 1', color: '#fef08a' },
      { item_type: 'sticky_note', pos_x: 65, pos_y: 175, width: 170, height: 80, content: 'Task 2', color: '#fef08a' },
      { item_type: 'sticky_note', pos_x: 295, pos_y: 80, width: 170, height: 80, content: 'Task 3', color: '#fdba74' },
    ];
  }

  return [];
}

export async function seedBoardTemplate(boardId: string, boardType: BoardType): Promise<NoteItem[]> {
  const templateItems = getTemplateItems(boardType);
  if (templateItems.length === 0) return [];

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const rows = templateItems.map((item, i) => ({
    board_id: boardId,
    created_by: user.id,
    item_type: item.item_type,
    pos_x: item.pos_x,
    pos_y: item.pos_y,
    width: item.width,
    height: item.height,
    content: item.content,
    color: item.color || '',
    font_size: item.font_size || 14,
    shape_type: item.shape_type ?? null,
    z_index: i,
  }));

  const { data, error } = await supabase
    .from('note_items')
    .insert(rows)
    .select();

  if (error) throw error;
  return data ?? [];
}

// ─── Realtime subscriptions ────────────────────────────────────

export function subscribeToBoardChanges(
  boardId: string,
  onItemChange: (payload: any) => void,
  onConnectionChange: (payload: any) => void,
) {
  const channel = supabase
    .channel(`note_board_${boardId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'note_items', filter: `board_id=eq.${boardId}` },
      onItemChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'note_connections', filter: `board_id=eq.${boardId}` },
      onConnectionChange,
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ─── Comments ──────────────────────────────────────────────────

export async function fetchBoardComments(boardId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('board_comments')
    .select('*')
    .eq('board_id', boardId)
    .order('created_at', { ascending: true });

  if (error) {
    // Table may not exist yet — return empty
    console.warn('board_comments fetch failed:', error.message);
    return [];
  }
  return data ?? [];
}

export async function createBoardComment(comment: {
  board_id: string;
  item_id?: string | null;
  parent_id?: string | null;
  content: string;
  user_name: string;
}): Promise<any> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('board_comments')
    .insert({
      board_id: comment.board_id,
      item_id: comment.item_id ?? null,
      parent_id: comment.parent_id ?? null,
      user_id: user.id,
      user_name: comment.user_name,
      content: comment.content,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function resolveBoardComment(commentId: string): Promise<void> {
  const { error } = await supabase
    .from('board_comments')
    .update({ resolved: true })
    .eq('id', commentId);

  if (error) throw error;
}

export async function deleteBoardComment(commentId: string): Promise<void> {
  const { error } = await supabase
    .from('board_comments')
    .delete()
    .eq('id', commentId);

  if (error) throw error;
}

// ─── Votes ─────────────────────────────────────────────────────

export async function fetchBoardVotes(boardId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('board_votes')
    .select('*')
    .eq('board_id', boardId);

  if (error) {
    console.warn('board_votes fetch failed:', error.message);
    return [];
  }
  return data ?? [];
}

export async function castVote(boardId: string, itemId: string, userName: string): Promise<any> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('board_votes')
    .insert({
      board_id: boardId,
      item_id: itemId,
      user_id: user.id,
      user_name: userName,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeVote(boardId: string, itemId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    .from('board_votes')
    .delete()
    .eq('board_id', boardId)
    .eq('item_id', itemId)
    .eq('user_id', user.id);

  if (error) throw error;
}

export async function clearBoardVotes(boardId: string): Promise<void> {
  const { error } = await supabase
    .from('board_votes')
    .delete()
    .eq('board_id', boardId);

  if (error) throw error;
}

// ─── Presence ──────────────────────────────────────────────────

export function subscribeToBoardPresence(
  boardId: string,
  currentUser: { userId: string; userName: string; color: string },
  onPresenceChange: (users: Array<{ userId: string; userName: string; color: string }>) => void,
  onCursorMove: (cursors: Array<{ userId: string; userName: string; color: string; x: number; y: number }>) => void,
) {
  const channel = supabase.channel(`presence_board_${boardId}`, {
    config: { presence: { key: currentUser.userId } },
  });

  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<{ userId: string; userName: string; color: string }>();
      const users: Array<{ userId: string; userName: string; color: string }> = [];
      for (const [, presences] of Object.entries(state)) {
        for (const p of presences) {
          if (p.userId !== currentUser.userId) {
            users.push({ userId: p.userId, userName: p.userName, color: p.color });
          }
        }
      }
      onPresenceChange(users);
    })
    .on('broadcast', { event: 'cursor' }, ({ payload }) => {
      if (payload.userId !== currentUser.userId) {
        onCursorMove([{
          userId: payload.userId,
          userName: payload.userName,
          color: payload.color,
          x: payload.x,
          y: payload.y,
        }]);
      }
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          userId: currentUser.userId,
          userName: currentUser.userName,
          color: currentUser.color,
        });
      }
    });

  const broadcastCursor = (x: number, y: number) => {
    channel.send({
      type: 'broadcast',
      event: 'cursor',
      payload: {
        userId: currentUser.userId,
        userName: currentUser.userName,
        color: currentUser.color,
        x,
        y,
      },
    });
  };

  return {
    broadcastCursor,
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
  };
}

// ─── Drawing paths ─────────────────────────────────────────────

export async function fetchBoardDrawings(boardId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('board_drawings')
    .select('*')
    .eq('board_id', boardId)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('board_drawings fetch failed:', error.message);
    return [];
  }
  return data ?? [];
}

export async function createBoardDrawing(drawing: {
  board_id: string;
  path_data: string;
  color: string;
  stroke_width: number;
  opacity: number;
  tool: string;
}): Promise<any> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('board_drawings')
    .insert({ ...drawing, created_by: user.id })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteBoardDrawing(drawingId: string): Promise<void> {
  const { error } = await supabase
    .from('board_drawings')
    .delete()
    .eq('id', drawingId);

  if (error) throw error;
}

// ─── File upload ───────────────────────────────────────────────

export async function uploadNoteFile(boardId: string, file: File): Promise<{ url: string; name: string; type: string; size: number }> {
  const ext = file.name.split('.').pop() ?? 'bin';
  const path = `note-boards/${boardId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from('attachments')
    .upload(path, file, { upsert: false });

  if (error) throw error;

  // Always use short-lived signed URLs (AUDIT_INTEGRATIONS_2026_05_12.md).
  // The `attachments` bucket holds tenant-private files — public URLs
  // would leak data across orgs. 1h TTL is a first pass; callers may need
  // to refresh on display, which is acceptable.
  const { data: signedData, error: signedError } = await supabase.storage
    .from('attachments')
    .createSignedUrl(path, 3600);
  if (signedError || !signedData?.signedUrl) {
    throw signedError ?? new Error('Failed to create signed URL for attachment');
  }
  const url = signedData.signedUrl;

  return {
    url,
    name: file.name,
    type: file.type,
    size: file.size,
  };
}
