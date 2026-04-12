/* Comments Panel — threaded comments on canvas elements or the board */

import React, { useState, useRef, useEffect, memo } from 'react';
import { X, Send, CheckCircle2, MessageCircle, AtSign } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from '../../i18n';

export interface BoardComment {
  id: string;
  board_id: string;
  item_id: string | null;
  parent_id: string | null;
  user_id: string;
  user_name: string;
  content: string;
  resolved: boolean;
  created_at: string;
  replies?: BoardComment[];
}

interface CommentsPanelProps {
  comments: BoardComment[];
  selectedItemId: string | null;
  currentUserId: string;
  currentUserName: string;
  language: string;
  onAddComment: (content: string, itemId: string | null, parentId: string | null) => void;
  onResolve: (commentId: string) => void;
  onDelete: (commentId: string) => void;
  onClose: () => void;
}

function CommentsPanel({
  comments, selectedItemId, currentUserId, currentUserName,
  language, onAddComment, onResolve, onDelete, onClose,
}: CommentsPanelProps) {
  const { t } = useTranslation();
  const fr = language === 'fr';
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter and group comments
  const topLevel = comments.filter((c) => !c.parent_id);
  const filtered = topLevel.filter((c) => {
    if (filter === 'open') return !c.resolved;
    if (filter === 'resolved') return c.resolved;
    return true;
  });

  // If an item is selected, show only that item's comments
  const contextFiltered = selectedItemId
    ? filtered.filter((c) => c.item_id === selectedItemId)
    : filtered;

  const handleSubmit = () => {
    if (!newComment.trim()) return;
    onAddComment(newComment.trim(), selectedItemId, replyTo);
    setNewComment('');
    setReplyTo(null);
  };

  return (
    <div className="w-72 bg-surface border border-outline rounded-xl shadow-lg flex flex-col max-h-[500px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-outline">
        <div className="flex items-center gap-2">
          <MessageCircle size={14} className="text-text-tertiary" />
          <span className="text-[12px] font-semibold text-text-primary">
            {t.noteCanvas.comments}
          </span>
          <span className="text-[10px] text-text-tertiary bg-surface-secondary px-1.5 py-0.5 rounded-full">
            {contextFiltered.length}
          </span>
        </div>
        <button onClick={onClose} className="p-1 rounded-md text-text-tertiary hover:text-text-primary transition-colors">
          <X size={12} />
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-1 px-3 py-2 border-b border-outline">
        {(['all', 'open', 'resolved'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors',
              filter === f
                ? 'bg-primary/10 text-text-primary'
                : 'text-text-tertiary hover:bg-surface-secondary',
            )}
          >
            {f === 'all' ? (t.automations.all) : f === 'open' ? (t.noteCanvas.open) : (t.noteCanvas.resolved)}
          </button>
        ))}
      </div>

      {/* Comments list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {contextFiltered.length === 0 && (
          <p className="text-[11px] text-text-tertiary text-center py-4">
            {t.noteCanvas.noCommentsYet}
          </p>
        )}
        {contextFiltered.map((comment) => {
          const replies = comments.filter((c) => c.parent_id === comment.id);
          return (
            <div key={comment.id} className={cn('space-y-2', comment.resolved && 'opacity-60')}>
              {/* Main comment */}
              <div className="bg-surface-secondary rounded-lg p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-text-primary">{comment.user_name}</span>
                  <span className="text-[9px] text-text-tertiary">
                    {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-[12px] text-text-secondary whitespace-pre-wrap">{comment.content}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <button
                    onClick={() => setReplyTo(comment.id)}
                    className="text-[10px] text-text-secondary hover:text-text-primary font-medium"
                  >
                    {t.noteCanvas.reply}
                  </button>
                  {!comment.resolved && (
                    <button
                      onClick={() => onResolve(comment.id)}
                      className="text-[10px] text-green-500 hover:text-green-600 font-medium flex items-center gap-0.5"
                    >
                      <CheckCircle2 size={10} /> {t.noteCanvas.resolve}
                    </button>
                  )}
                  {comment.user_id === currentUserId && (
                    <button
                      onClick={() => onDelete(comment.id)}
                      className="text-[10px] text-red-400 hover:text-red-500 font-medium"
                    >
                      {t.advancedNotes.delete}
                    </button>
                  )}
                  {comment.resolved && (
                    <span className="text-[9px] text-green-500 flex items-center gap-0.5 ml-auto">
                      <CheckCircle2 size={9} /> {t.noteCanvas.resolved}
                    </span>
                  )}
                </div>
              </div>

              {/* Replies */}
              {replies.length > 0 && (
                <div className="ml-3 pl-2 border-l-2 border-outline space-y-1.5">
                  {replies.map((reply) => (
                    <div key={reply.id} className="bg-surface-secondary/50 rounded-md p-1.5">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] font-semibold text-text-primary">{reply.user_name}</span>
                        <span className="text-[8px] text-text-tertiary">
                          {formatDistanceToNow(new Date(reply.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-[11px] text-text-secondary">{reply.content}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply input */}
              {replyTo === comment.id && (
                <div className="ml-3 flex gap-1">
                  <input
                    ref={inputRef}
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    placeholder={t.noteCanvas.reply2}
                    className="input-field text-[11px] py-1 flex-1"
                    autoFocus
                  />
                  <button onClick={handleSubmit} className="btn-primary p-1">
                    <Send size={12} />
                  </button>
                  <button onClick={() => setReplyTo(null)} className="p-1 text-text-tertiary hover:text-text-primary">
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* New comment input */}
      {!replyTo && (
        <div className="flex gap-1 px-3 py-2 border-t border-outline">
          <input
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder={t.noteCanvas.addAComment}
            className="input-field text-[11px] py-1.5 flex-1"
          />
          <button
            onClick={handleSubmit}
            disabled={!newComment.trim()}
            className="btn-primary p-1.5 disabled:opacity-40"
          >
            <Send size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(CommentsPanel);
