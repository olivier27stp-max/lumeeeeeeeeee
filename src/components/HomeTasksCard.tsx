/**
 * HomeTasksCard — today's tasks box for the Home page, shown left of the
 * revenue chart. Lets the user toggle between Late (overdue) and Next
 * (today/upcoming) open tasks.
 */
import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';

type TaskLite = { id: string; title: string; due_date: string; priority: string };

function formatDueDate(due: string, fr: boolean): string {
  const d = new Date(due.length <= 10 ? due + 'T12:00:00' : due);
  return d.toLocaleDateString(fr ? 'fr-CA' : 'en-US', { month: 'short', day: 'numeric' });
}

export default function HomeTasksCard({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [view, setView] = useState<'late' | 'next'>('late');

  const { data: tasks = [] } = useQuery({
    queryKey: ['home-tasks-open'],
    queryFn: async () => {
      const { data } = await supabase
        .from('tasks_active')
        .select('id, title, due_date, priority, status')
        .eq('status', 'open')
        .not('due_date', 'is', null)
        .order('due_date', { ascending: true })
        .limit(100);
      return (data || []) as TaskLite[];
    },
    staleTime: 30_000,
    // Refresh the Home every time you come back to it (navigation or tab focus).
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const late = tasks.filter((t) => (t.due_date || '').slice(0, 10) < todayStr);
  const next = tasks.filter((t) => (t.due_date || '').slice(0, 10) >= todayStr);
  const list = view === 'late' ? late : next;

  return (
    <div className={`bg-surface-card border border-border rounded-xl p-5 flex flex-col ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <ListChecks size={16} className="text-primary" />
        <h3 className="text-[15px] font-semibold text-text-primary">
          {fr ? 'Tâches du jour' : "Today's tasks"}
        </h3>
      </div>

      {/* Late / Next toggle */}
      <div className="inline-flex items-center gap-0.5 rounded-lg bg-surface-tertiary p-0.5 mb-3">
        <button
          onClick={() => setView('late')}
          className={
            'flex-1 h-7 px-3 rounded-md text-[12px] font-medium transition-colors ' +
            (view === 'late'
              ? 'bg-surface-card text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary')
          }
        >
          {fr ? 'En retard' : 'Late'}
          {late.length > 0 ? ` (${late.length})` : ''}
        </button>
        <button
          onClick={() => setView('next')}
          className={
            'flex-1 h-7 px-3 rounded-md text-[12px] font-medium transition-colors ' +
            (view === 'next'
              ? 'bg-surface-card text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary')
          }
        >
          {fr ? 'À venir' : 'Next'}
          {next.length > 0 ? ` (${next.length})` : ''}
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto -mx-1">
        {list.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-text-muted">
            {view === 'late'
              ? fr ? 'Aucune tâche en retard' : 'No late tasks'
              : fr ? 'Aucune tâche à venir' : 'No upcoming tasks'}
          </div>
        ) : (
          list.map((task) => (
            <button
              key={task.id}
              onClick={() => navigate('/tasks')}
              className="w-full flex items-start gap-2.5 px-1 py-2 text-left rounded-lg hover:bg-surface-tertiary/50 transition-colors"
            >
              <span
                className={
                  'w-2 h-2 rounded-full shrink-0 mt-1.5 ' +
                  (task.priority === 'high'
                    ? 'bg-text-primary'
                    : task.priority === 'medium'
                    ? 'bg-text-secondary'
                    : 'bg-text-muted')
                }
              />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-text-primary truncate leading-tight">
                  {task.title}
                </p>
                <p
                  className={
                    'text-[11px] tabular-nums mt-0.5 ' +
                    (view === 'late' ? 'text-text-secondary' : 'text-text-muted')
                  }
                >
                  {formatDueDate(task.due_date, fr)}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
