/* ═══════════════════════════════════════════════════════════════
   TaskDetailSheet — View details slide-over
   Premium detail view for a single task.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect } from 'react';
import {
  X,
  Pencil,
  CheckCircle2,
  Circle,
  Trash2,
  Calendar,
  Tag,
  Flag,
  AlignLeft,
  Hash,
  Link,
  User,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { TaskRow } from '../../types/task';

interface TaskDetailSheetProps {
  task: TaskRow;
  onClose: () => void;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}

export default function TaskDetailSheet({ task, onClose, onEdit, onToggleStatus, onDelete }: TaskDetailSheetProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-surface-elevated border-l border-outline shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-mono text-text-tertiary">{task.public_id}</span>
            <span className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2 py-[1px] text-[11px] font-medium leading-[16px]',
              task.status === 'done'
                ? 'text-[#059669] border-[#6ee7b7] bg-[#ecfdf5]'
                : 'text-[#525252] border-[#d4d4d4] bg-[#fafafa]'
            )}>
              <span className="w-[4px] h-[4px] rounded-full bg-current" />
              {task.status === 'done' ? 'Done' : 'Open'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl border border-outline text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-all"
          >
            <X size={15} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Title */}
          <h2 className="text-[18px] font-semibold text-text-primary leading-snug">{task.title}</h2>

          {/* Description */}
          {task.description && (
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-1.5">
                <AlignLeft size={12} />
                Description
              </div>
              <p className="text-[13px] text-text-secondary leading-relaxed">{task.description}</p>
            </div>
          )}

          {/* Details grid */}
          <div className="space-y-3">
            <DetailRow icon={Tag} label="Type" value={task.type} />
            <DetailRow
              icon={Flag}
              label="Priority"
              value={
                <span className={cn(
                  'inline-flex items-center gap-1 text-[12px] font-medium capitalize',
                  task.priority === 'high' ? 'text-[#dc2626]' :
                  task.priority === 'medium' ? 'text-[#d97706]' : 'text-[#2563eb]'
                )}>
                  {task.priority}
                </span>
              }
            />
            {task.due_date && (
              <DetailRow
                icon={Calendar}
                label="Due Date"
                value={new Date(task.due_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              />
            )}
            {task.linked_entity_type && (
              <DetailRow icon={Link} label="Linked Entity" value={task.linked_entity_type} />
            )}
            {task.linked_person_type && (
              <DetailRow icon={User} label="Linked Person" value={task.linked_person_type.replace('_', ' ')} />
            )}
            <DetailRow
              icon={Hash}
              label="Created"
              value={new Date(task.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            />
          </div>
        </div>

        {/* Actions footer */}
        <div className="px-6 py-4 border-t border-outline flex items-center gap-2">
          <button
            onClick={onToggleStatus}
            className={cn(
              'flex items-center gap-1.5 h-9 px-4 rounded-md text-[13px] font-medium transition-all',
              task.status === 'open'
                ? 'bg-success/10 text-success hover:bg-success/20'
                : 'bg-surface border border-outline text-text-secondary hover:bg-surface-secondary'
            )}
          >
            {task.status === 'open' ? <CheckCircle2 size={14} /> : <Circle size={14} />}
            {task.status === 'open' ? 'Mark Done' : 'Reopen'}
          </button>
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 h-9 px-4 bg-surface border border-outline rounded-md text-[13px] text-text-secondary font-medium hover:bg-surface-secondary transition-colors"
          >
            <Pencil size={14} />
            Edit
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 h-9 px-4 rounded-md text-[13px] font-medium text-danger hover:bg-danger-light transition-colors ml-auto"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>
    </>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: typeof Tag; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-5 flex justify-center">
        <Icon size={14} className="text-text-tertiary" />
      </div>
      <span className="text-[12px] text-text-tertiary w-24 shrink-0">{label}</span>
      <span className="text-[13px] text-text-primary font-medium capitalize">{value}</span>
    </div>
  );
}
