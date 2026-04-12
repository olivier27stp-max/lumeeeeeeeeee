/* ═══════════════════════════════════════════════════════════════
   TaskModal — Create / Edit task
   Used for both "Add Task" and "Edit" flows.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import { cn } from '../../lib/utils';
import type {
  TaskRow,
  TaskCreateInput,
  TaskUpdateInput,
  TaskStatus,
  TaskPriority,
  TaskLinkedEntityType,
  TaskLinkedPersonType,
} from '../../types/task';

const TASK_TYPES = [
  'Meeting', 'Recruit', 'Follow-up', 'Admin', 'Personal',
  'Client', 'Sales', 'Finance', 'CRM', 'Reminder', 'Custom',
];

interface TaskModalProps {
  open: boolean;
  onClose: () => void;
  task?: TaskRow | null;
  onSubmit: (input: TaskCreateInput | TaskUpdateInput) => Promise<void>;
}

export default function TaskModal({ open, onClose, task, onSubmit }: TaskModalProps) {
  const isEdit = !!task;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('open');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [type, setType] = useState('Admin');
  const [dueDate, setDueDate] = useState('');
  const [linkedEntityType, setLinkedEntityType] = useState<TaskLinkedEntityType | ''>('');
  const [linkedPersonType, setLinkedPersonType] = useState<TaskLinkedPersonType | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset form when modal opens or task changes
  useEffect(() => {
    if (open) {
      setTitle(task?.title || '');
      setDescription(task?.description || '');
      setStatus(task?.status || 'open');
      setPriority(task?.priority || 'medium');
      setType(task?.type || 'Admin');
      setDueDate(task?.due_date || '');
      setLinkedEntityType(task?.linked_entity_type || '');
      setLinkedPersonType(task?.linked_person_type || '');
      setSaving(false);
      setError('');
    }
  }, [open, task]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        type,
        due_date: dueDate || null,
        linked_entity_type: linkedEntityType || null,
        linked_person_type: linkedPersonType || null,
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to save task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Task' : 'Add Task'}
      description={isEdit ? 'Update task details.' : 'Create a new task.'}
      size="lg"
      footer={
        <>
          <button
            onClick={onClose}
            className="h-9 px-4 bg-surface border border-outline rounded-md text-[13px] text-text-primary font-medium hover:bg-surface-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !title.trim()}
            className="h-9 px-5 bg-primary text-white rounded-md text-[13px] font-medium hover:bg-primary-hover disabled:opacity-50 transition-all"
          >
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Task'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Error */}
        {error && (
          <div className="text-[13px] text-danger bg-danger-light border border-danger/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {/* Title */}
        <div>
          <label className="text-[12px] font-medium text-text-primary mb-1 block">Title *</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Call recrue Simon jeudi"
            className="input-field w-full"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-[12px] font-medium text-text-primary mb-1 block">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Add details..."
            rows={3}
            className="input-field w-full resize-none"
          />
        </div>

        {/* Row: Type + Priority */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">Type</label>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="input-field w-full"
            >
              {TASK_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">Priority</label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value as TaskPriority)}
              className="input-field w-full"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        {/* Row: Status + Due Date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">Status</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as TaskStatus)}
              className="input-field w-full"
            >
              <option value="open">Open</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="input-field w-full"
            />
          </div>
        </div>

        {/* Row: Linked Entity + Linked Person */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">Linked Entity</label>
            <select
              value={linkedEntityType}
              onChange={e => setLinkedEntityType(e.target.value as TaskLinkedEntityType | '')}
              className="input-field w-full"
            >
              <option value="">None</option>
              <option value="client">Client</option>
              <option value="lead">Lead</option>
              <option value="quote">Quote</option>
              <option value="invoice">Invoice</option>
              <option value="job">Job</option>
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">Linked Person</label>
            <select
              value={linkedPersonType}
              onChange={e => setLinkedPersonType(e.target.value as TaskLinkedPersonType | '')}
              className="input-field w-full"
            >
              <option value="">None</option>
              <option value="recruit">Recruit</option>
              <option value="client">Client</option>
              <option value="prospect">Prospect</option>
              <option value="contact">Contact</option>
              <option value="team_member">Team Member</option>
            </select>
          </div>
        </div>
      </div>
    </Modal>
  );
}
