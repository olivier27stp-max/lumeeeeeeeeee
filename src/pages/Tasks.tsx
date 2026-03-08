import React, { useState, useEffect } from 'react';
import {
  Plus,
  CheckCircle2,
  Circle,
  Calendar,
  User as UserIcon,
  Trash2,
  CheckSquare,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../lib/supabase';
import { Task, Lead } from '../types';
import { formatDate, cn } from '../lib/utils';
import { PageHeader, StatCard, EmptyState } from '../components/ui';

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState<string>('');

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const [tasksRes, leadsRes] = await Promise.all([
      supabase.from('tasks').select('*').order('due_date', { ascending: true }),
      supabase.from('leads').select('id, first_name, last_name'),
    ]);

    if (tasksRes.data) setTasks(tasksRes.data);
    if (leadsRes.data) setLeads(leadsRes.data);
    setLoading(false);
  }

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        title: newTaskTitle,
        due_date: new Date(Date.now() + 86400000).toISOString(),
        lead_id: selectedLeadId || null,
        completed: false,
      })
      .select()
      .single();

    if (!error && data) {
      setTasks((prev) => [data, ...prev]);
      setNewTaskTitle('');
      setSelectedLeadId('');
    }
  };

  const toggleTask = async (task: Task) => {
    const { error } = await supabase
      .from('tasks')
      .update({ completed: !task.completed })
      .eq('id', task.id);

    if (!error) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: !t.completed } : t)));
    }
  };

  const deleteTask = async (id: string) => {
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (!error) {
      setTasks((prev) => prev.filter((t) => t.id !== id));
    }
  };

  const activeTasks = tasks.filter((t) => !t.completed);
  const completedTasks = tasks.filter((t) => t.completed);

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="skeleton h-6 w-32" />
        <div className="skeleton h-40" />
        <div className="skeleton h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Tasks" subtitle={`${activeTasks.length} pending`} />

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Pending" value={activeTasks.length} />
        <StatCard label="Completed" value={completedTasks.length} />
        <StatCard label="Total" value={tasks.length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
        {/* Quick Add */}
        <div className="space-y-3">
          <div className="section-card p-4">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-3">Quick Add</h3>
            <form onSubmit={addTask} className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Title</label>
                <input
                  type="text"
                  placeholder="What needs to be done?"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="glass-input w-full mt-1"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Link to Lead</label>
                <select
                  value={selectedLeadId}
                  onChange={(e) => setSelectedLeadId(e.target.value)}
                  className="glass-input w-full mt-1"
                >
                  <option value="">No Lead</option>
                  {leads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.first_name} {lead.last_name}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="glass-button-primary w-full inline-flex items-center justify-center gap-1.5">
                <Plus size={15} />
                Create Task
              </button>
            </form>
          </div>
        </div>

        {/* Task List */}
        <div className="space-y-5">
          {/* Active */}
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-2 px-1">
              Active ({activeTasks.length})
            </h3>
            <div className="space-y-1.5">
              <AnimatePresence mode="popLayout">
                {activeTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    lead={leads.find((l) => l.id === task.lead_id)}
                    onToggle={() => toggleTask(task)}
                    onDelete={() => deleteTask(task.id)}
                  />
                ))}
              </AnimatePresence>
              {activeTasks.length === 0 && (
                <EmptyState
                  icon={CheckSquare}
                  title="All caught up"
                  description="No pending tasks. Add one to get started."
                />
              )}
            </div>
          </div>

          {/* Completed */}
          {completedTasks.length > 0 && (
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-2 px-1">
                Completed ({completedTasks.length})
              </h3>
              <div className="space-y-1.5 opacity-60">
                {completedTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    lead={leads.find((l) => l.id === task.lead_id)}
                    onToggle={() => toggleTask(task)}
                    onDelete={() => deleteTask(task.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface TaskItemProps {
  task: Task;
  lead?: { first_name: string; last_name: string };
  onToggle: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}

const TaskItem: React.FC<TaskItemProps> = ({ task, lead, onToggle, onDelete }) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 8 }}
      className="section-card flex items-center justify-between px-4 py-3 group"
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onToggle}
          className={cn(
            'transition-colors shrink-0',
            task.completed ? 'text-success' : 'text-text-tertiary hover:text-primary'
          )}
        >
          {task.completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
        </button>
        <div>
          <p
            className={cn(
              'text-[13px] font-semibold transition-all',
              task.completed && 'line-through text-text-tertiary'
            )}
          >
            {task.title}
          </p>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="flex items-center gap-1 text-xs text-text-tertiary">
              <Calendar size={10} />
              {formatDate(task.due_date)}
            </span>
            {lead && (
              <span className="flex items-center gap-1 text-xs text-text-tertiary">
                <UserIcon size={10} />
                {lead.first_name} {lead.last_name}
              </span>
            )}
          </div>
        </div>
      </div>
      <button
        onClick={onDelete}
        className="p-1.5 text-text-tertiary hover:text-danger hover:bg-danger-light rounded transition-all opacity-0 group-hover:opacity-100"
      >
        <Trash2 size={14} />
      </button>
    </motion.div>
  );
};
