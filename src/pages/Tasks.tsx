/* ═══════════════════════════════════════════════════════════════
   Page — Tasks (Premium CRM task manager)
   Shadcn-reference-grade table with real filters, search,
   sorting, bulk actions, row actions, and full CRUD.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUpDown,
  Calendar,
  CheckCircle2,
  CirclePlus,
  Copy,
  Eye,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  Circle,
  ArrowUp,
  ArrowDown,
  Minus,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import {
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  duplicateTask,
  bulkUpdateTaskStatus,
  bulkUpdateTaskPriority,
  bulkDeleteTasks,
} from '../lib/tasksApi';
import type {
  TaskRow,
  TaskStatus,
  TaskPriority,
  TaskStatusFilter,
  TaskPriorityFilter,
  TaskSortKey,
  TaskCreateInput,
  TaskUpdateInput,
} from '../types/task';
import BulkActionBar, { type BulkAction } from '../components/BulkActionBar';
import { useTranslation } from '../i18n';
import TaskModal from '../components/tasks/TaskModal';
import TaskDetailSheet from '../components/tasks/TaskDetailSheet';

const PAGE_SIZE = 20;

// ── Task type config — badge colors ──
const TYPE_STYLES: Record<string, string> = {
  Meeting:     'badge-info',
  Recruit:     'badge-purple',
  'Follow-up': 'badge-warning',
  Admin:       'badge-neutral',
  Personal:    'badge-teal',
  Client:      'badge-success',
  Sales:       'badge-orange',
  Finance:     'badge-success',
  CRM:         'badge-neutral',
  Reminder:    'badge-pink',
  Custom:      'badge-neutral',
};

// ── Status badge ──
function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const styles = status === 'done'
    ? 'badge-success'
    : 'badge-neutral';
  const label = status === 'done' ? 'Done' : 'Open';
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[2px] text-[12px] font-medium leading-[18px]', styles)}>
      <span className="w-[5px] h-[5px] rounded-full bg-current shrink-0 opacity-80" />
      {label}
    </span>
  );
}

// ── Priority badge ──
function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  const config: Record<TaskPriority, { icon: typeof ArrowUp; label: string; cls: string }> = {
    high:   { icon: ArrowUp,   label: 'High',   cls: 'badge-danger' },
    medium: { icon: Minus,     label: 'Medium', cls: 'badge-warning' },
    low:    { icon: ArrowDown, label: 'Low',    cls: 'badge-info' },
  };
  const c = config[priority];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-[2px] text-[12px] font-medium leading-[18px]', c.cls)}>
      <c.icon size={12} strokeWidth={2.5} />
      {c.label}
    </span>
  );
}

// ── Type badge ──
function TaskTypeBadge({ type }: { type: string }) {
  const style = TYPE_STYLES[type] || TYPE_STYLES.Custom;
  return (
    <span className={cn('inline-block rounded-full border px-2.5 py-[2px] text-[12px] font-medium leading-[18px]', style)}>
      {type}
    </span>
  );
}

// ── Filter dropdown ──
function FilterDropdown({ label, options, value, onChange }: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isActive = value !== 'all';

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1.5 h-9 px-3 border rounded-md text-[14px] font-normal transition-colors',
          isActive
            ? 'bg-primary text-white border-primary'
            : 'bg-surface text-text-primary border-outline hover:bg-surface-secondary'
        )}
      >
        <CirclePlus size={15} strokeWidth={1.5} className={isActive ? 'text-white' : 'text-[#64748b]'} />
        {label}
        {isActive && (
          <span className="ml-0.5 text-[11px] opacity-80">
            ({options.find(o => o.value === value)?.label})
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-40 bg-surface-elevated border border-outline rounded-md shadow-dropdown z-50 py-1">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-[13px] transition-colors',
                value === opt.value
                  ? 'bg-primary-light text-text-primary font-medium'
                  : 'text-text-secondary hover:bg-surface-secondary'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Row actions dropdown ──
function RowActions({ task, onEdit, onViewDetails, onDuplicate, onToggleStatus, onDelete }: {
  task: TaskRow;
  onEdit: () => void;
  onViewDetails: () => void;
  onDuplicate: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const items = [
    { id: 'view', label: 'View details', icon: Eye, action: onViewDetails },
    { id: 'edit', label: 'Edit', icon: Pencil, action: onEdit },
    { id: 'duplicate', label: 'Duplicate', icon: Copy, action: onDuplicate },
    {
      id: 'toggle',
      label: task.status === 'open' ? 'Mark as done' : 'Mark as open',
      icon: task.status === 'open' ? CheckCircle2 : Circle,
      action: onToggleStatus,
    },
    { id: 'delete', label: 'Delete', icon: Trash2, action: onDelete, danger: true },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-44 bg-surface-elevated border border-outline rounded-md shadow-dropdown z-50 py-1">
          {items.map((item) => (
            <React.Fragment key={item.id}>
              {item.id === 'delete' && <div className="my-1 border-t border-outline" />}
              <button
                onClick={(e) => { e.stopPropagation(); item.action(); setOpen(false); }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-[13px] transition-colors',
                  (item as any).danger
                    ? 'text-danger hover:bg-danger-light'
                    : 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
                )}
              >
                <item.icon size={14} />
                {item.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Bulk priority picker ──
function BulkPriorityPicker({ onSelect }: { onSelect: (p: TaskPriority) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium hover:bg-surface-card/10 text-white/80 transition-colors"
      >
        <ArrowUp size={13} />
        Priority
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-32 bg-surface-elevated border border-outline rounded-md shadow-dropdown z-50 py-1">
          {(['low', 'medium', 'high'] as TaskPriority[]).map(p => (
            <button
              key={p}
              onClick={() => { onSelect(p); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-secondary capitalize"
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function Tasks() {
  const { language } = useTranslation();
  const queryClient = useQueryClient();

  // ── State ──
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriorityFilter>('all');
  const [sort, setSort] = useState<TaskSortKey>('created_at_desc');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskRow | null>(null);
  const [detailTask, setDetailTask] = useState<TaskRow | null>(null);

  // ── Debounced search ──
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [statusFilter, priorityFilter]);

  // ── Query ──
  const tasksQuery = useQuery({
    queryKey: ['tasks', statusFilter, priorityFilter, sort, page, debouncedQ],
    queryFn: () => listTasks({
      status: statusFilter,
      priority: priorityFilter,
      sort,
      page,
      q: debouncedQ,
      pageSize: PAGE_SIZE,
    }),
  });

  const rows = tasksQuery.data?.rows || [];
  const total = tasksQuery.data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const loading = tasksQuery.isLoading;

  // Clear selection when data changes
  useEffect(() => { setSelected(new Set()); }, [rows]);

  // ── Selection ──
  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0 && selected.size < rows.length;
  const toggleAll = () => {
    allSelected ? setSelected(new Set()) : setSelected(new Set(rows.map(r => r.id)));
  };
  const toggle = (id: string) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };

  // ── Sort handler ──
  const handleSort = (col: string) => {
    const currentCol = sort.replace(/_asc$|_desc$/, '');
    const currentDir = sort.endsWith('_asc') ? 'asc' : 'desc';
    if (currentCol === col) {
      setSort(`${col}_${currentDir === 'asc' ? 'desc' : 'asc'}` as TaskSortKey);
    } else {
      setSort(`${col}_asc` as TaskSortKey);
    }
  };

  const getSortIcon = (col: string) => {
    const currentCol = sort.replace(/_asc$|_desc$/, '');
    if (currentCol !== col) return <ArrowUpDown size={14} className="text-text-tertiary" />;
    return sort.endsWith('_asc')
      ? <ArrowUp size={14} className="text-text-primary" />
      : <ArrowDown size={14} className="text-text-primary" />;
  };

  // ── Invalidate helper ──
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tasks'] });

  // ── CRUD handlers ──
  const handleCreate = async (input: TaskCreateInput) => {
    try {
      await createTask(input);
      toast.success('Task created');
      refresh();
      setModalOpen(false);
    } catch (err: any) {
      console.error('Create task error:', err);
      toast.error(err?.message || 'Failed to create task');
      throw err; // re-throw so modal knows it failed
    }
  };

  const handleUpdate = async (id: string, input: TaskUpdateInput) => {
    try {
      await updateTask(id, input);
      toast.success('Task updated');
      refresh();
      setEditingTask(null);
    } catch (err: any) {
      console.error('Update task error:', err);
      toast.error(err?.message || 'Failed to update task');
      throw err;
    }
  };

  const handleToggleStatus = async (task: TaskRow) => {
    try {
      const newStatus: TaskStatus = task.status === 'open' ? 'done' : 'open';
      await updateTask(task.id, { status: newStatus });
      toast.success(newStatus === 'done' ? 'Task completed' : 'Task reopened');
      refresh();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update task');
    }
  };

  const handleDuplicate = async (task: TaskRow) => {
    try {
      await duplicateTask(task.id);
      toast.success('Task duplicated');
      refresh();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to duplicate task');
    }
  };

  const handleDelete = async (task: TaskRow) => {
    try {
      await deleteTask(task.id);
      toast.success('Task deleted');
      refresh();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete task');
    }
  };

  // ── Bulk actions ──
  const handleBulkAction = async (actionId: string) => {
    const ids = Array.from(selected);
    try {
      if (actionId === 'mark_open') {
        await bulkUpdateTaskStatus(ids, 'open');
        toast.success(`${ids.length} task(s) marked as open`);
      } else if (actionId === 'mark_done') {
        await bulkUpdateTaskStatus(ids, 'done');
        toast.success(`${ids.length} task(s) completed`);
      } else if (actionId === 'delete') {
        await bulkDeleteTasks(ids);
        toast.success(`${ids.length} task(s) deleted`);
      }
      setSelected(new Set());
      refresh();
    } catch {
      toast.error('Action failed');
    }
  };

  const handleBulkPriority = async (priority: TaskPriority) => {
    const ids = Array.from(selected);
    try {
      await bulkUpdateTaskPriority(ids, priority);
      toast.success(`Priority updated for ${ids.length} task(s)`);
      setSelected(new Set());
      refresh();
    } catch {
      toast.error('Action failed');
    }
  };

  const bulkActions: BulkAction[] = [
    { id: 'mark_open', label: 'Mark Open', icon: Circle },
    { id: 'mark_done', label: 'Mark Done', icon: CheckCircle2 },
    { id: 'delete', label: 'Delete', icon: Trash2, variant: 'danger' },
  ];

  // ── Columns ──
  const columns = [
    { key: 'public_id', label: 'Task', sortable: true },
    { key: 'type', label: 'Type', sortable: false },
    { key: 'title', label: 'Title', sortable: true },
    { key: 'status', label: 'Status', sortable: true },
    { key: 'priority', label: 'Priority', sortable: true },
  ];

  return (
    <>
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-bold text-text-primary leading-tight">Tasks</h1>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 h-10 px-5 bg-primary text-white rounded-md text-[14px] font-medium hover:bg-primary-hover active:scale-[0.98] transition-all"
        >
          <CirclePlus size={16} strokeWidth={1.5} />
          Add Task
        </button>
      </div>

      {/* ── FILTERS ROW ── */}
      <div className="flex items-center gap-2 mt-5 mb-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Filter tasks..."
            className="h-9 w-[200px] pl-9 pr-3 text-[14px] bg-surface border border-outline rounded-md text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-text-tertiary focus:border-text-tertiary transition-all"
          />
        </div>
        <FilterDropdown
          label="Status"
          value={statusFilter}
          onChange={v => setStatusFilter(v as TaskStatusFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'open', label: 'Open' },
            { value: 'done', label: 'Done' },
          ]}
        />
        <FilterDropdown
          label="Priority"
          value={priorityFilter}
          onChange={v => setPriorityFilter(v as TaskPriorityFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ]}
        />
      </div>

      {/* ── TABLE ── */}
      <div className="border border-outline rounded-md overflow-hidden bg-surface">
        <div className="grid" style={{ gridTemplateColumns: '48px 90px 90px 1fr 100px 100px 80px 48px' }}>
          {/* Header */}
          <div className="pl-4 py-3 border-b border-outline flex items-center">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected; }}
              onChange={toggleAll}
              className="rounded-[3px] border-outline w-[16px] h-[16px] accent-primary cursor-pointer"
            />
          </div>
          {columns.map(col => (
            <div key={col.key} className="px-4 py-3 border-b border-outline flex items-center text-[14px] font-medium text-text-primary">
              <button
                onClick={() => col.sortable && handleSort(col.key)}
                className={cn(
                  'inline-flex items-center gap-1 select-none',
                  col.sortable && 'cursor-pointer hover:text-text-primary'
                )}
                disabled={!col.sortable}
              >
                {col.label}
                {col.sortable && getSortIcon(col.key)}
              </button>
            </div>
          ))}
          <div className="border-b border-outline" />
          <div className="border-b border-outline" />

          {/* Loading skeleton */}
          {loading && Array.from({ length: 10 }).map((_, i) => (
            <React.Fragment key={`sk-${i}`}>
              <div className="pl-4 py-[13px] border-b border-outline/30 flex items-center"><div className="w-4 h-4 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="px-4 py-[13px] border-b border-outline/30"><div className="h-[18px] w-14 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="px-4 py-[13px] border-b border-outline/30"><div className="h-[18px] w-16 bg-surface-tertiary rounded-full animate-pulse" /></div>
              <div className="px-4 py-[13px] border-b border-outline/30"><div className="h-[18px] w-40 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="px-4 py-[13px] border-b border-outline/30"><div className="h-[18px] w-14 bg-surface-tertiary rounded-full animate-pulse" /></div>
              <div className="px-4 py-[13px] border-b border-outline/30"><div className="h-[18px] w-16 bg-surface-tertiary rounded-full animate-pulse" /></div>
              <div className="border-b border-outline/30" />
              <div className="border-b border-outline/30" />
            </React.Fragment>
          ))}

          {/* Empty state */}
          {!loading && rows.length === 0 && (
            <div className="col-span-8 py-20 text-center">
              <div className="text-text-tertiary">
                <div className="text-[14px] font-medium mb-1">No tasks found</div>
                <div className="text-[13px]">
                  {debouncedQ || statusFilter !== 'all' || priorityFilter !== 'all'
                    ? 'Try adjusting your filters or search query.'
                    : 'Create your first task to get started.'}
                </div>
              </div>
            </div>
          )}

          {/* Rows */}
          {!loading && rows.map(row => {
            const rowCls = cn(
              'border-b border-[#f1f5f9] transition-colors',
              selected.has(row.id) ? 'bg-[#f0f4ff]' : 'hover:bg-surface-secondary'
            );
            return (
              <React.Fragment key={row.id}>
                <div className={`pl-4 py-[13px] flex items-center ${rowCls}`} onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                    className="rounded-[3px] border-outline w-[16px] h-[16px] accent-primary cursor-pointer"
                  />
                </div>
                <div className={`px-4 py-[13px] flex items-center ${rowCls}`}>
                  <span className="text-[13px] font-mono text-text-secondary">{row.public_id}</span>
                </div>
                <div className={`px-4 py-[13px] flex items-center ${rowCls}`}>
                  <TaskTypeBadge type={row.type} />
                </div>
                <div className={`px-4 py-[13px] flex items-center min-w-0 ${rowCls}`}>
                  <div className="min-w-0">
                    <span className="text-[14px] text-text-primary font-medium truncate block">
                      {row.title}
                    </span>
                    {row.due_date && (
                      <span className="text-[12px] text-text-tertiary mt-0.5 flex items-center gap-1">
                        <Calendar size={11} />
                        {new Date(row.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
                <div className={`px-4 py-[13px] flex items-center ${rowCls}`}>
                  <TaskStatusBadge status={row.status} />
                </div>
                <div className={`px-4 py-[13px] flex items-center ${rowCls}`}>
                  <TaskPriorityBadge priority={row.priority} />
                </div>
                <div className={`px-4 py-[13px] flex items-center justify-end gap-1 ${rowCls}`}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingTask(row); }}
                    className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(row); }}
                    className="p-1.5 rounded text-text-tertiary hover:text-danger hover:bg-danger/10 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className={`pr-4 py-[13px] flex items-center justify-center ${rowCls}`}>
                  <RowActions
                    task={row}
                    onViewDetails={() => setDetailTask(row)}
                    onEdit={() => setEditingTask(row)}
                    onDuplicate={() => handleDuplicate(row)}
                    onToggleStatus={() => handleToggleStatus(row)}
                    onDelete={() => handleDelete(row)}
                  />
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-[14px] text-[#64748b]">
          {selected.size} of {total} row(s) selected.
        </span>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="h-9 px-4 bg-surface border border-outline rounded-md text-[14px] text-text-primary font-normal disabled:opacity-40 disabled:cursor-default hover:bg-surface-secondary transition-colors cursor-pointer"
          >
            Previous
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="h-9 px-4 bg-surface border border-outline rounded-md text-[14px] text-text-primary font-normal disabled:opacity-40 disabled:cursor-default hover:bg-surface-secondary transition-colors cursor-pointer"
          >
            Next
          </button>
        </div>
      </div>

      {/* ── BULK ACTIONS ── */}
      <AnimatePresence>
        {selected.size > 0 && (
          <BulkActionBar
            count={selected.size}
            actions={bulkActions}
            onAction={handleBulkAction}
            onClear={() => setSelected(new Set())}
            language={language}
          />
        )}
      </AnimatePresence>

      {/* Bulk priority picker */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[101] pointer-events-none" style={{ marginLeft: '200px' }}>
          <div className="pointer-events-auto">
            <BulkPriorityPicker onSelect={handleBulkPriority} />
          </div>
        </div>
      )}

      {/* ── ADD TASK MODAL ── */}
      <TaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleCreate}
      />

      {/* ── EDIT TASK MODAL ── */}
      {editingTask && (
        <TaskModal
          open={true}
          onClose={() => setEditingTask(null)}
          task={editingTask}
          onSubmit={async (input) => {
            await handleUpdate(editingTask.id, input);
          }}
        />
      )}

      {/* ── DETAIL SHEET ── */}
      {detailTask && (
        <TaskDetailSheet
          task={detailTask}
          onClose={() => setDetailTask(null)}
          onEdit={() => { setEditingTask(detailTask); setDetailTask(null); }}
          onToggleStatus={() => { handleToggleStatus(detailTask); setDetailTask(null); }}
          onDelete={() => { handleDelete(detailTask); setDetailTask(null); }}
        />
      )}
    </>
  );
}
