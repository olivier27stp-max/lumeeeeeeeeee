/* ═══════════════════════════════════════════════════════════════
   Tâche planifiée → bloc de calendrier
   ─────────────────────────────────────────────────────────────
   Les vues du calendrier (Jour/Semaine/Mois) affichent des jobs. Une tâche
   avec une heure (scheduled_at) doit y apparaître comme un bloc distinct.
   Ce petit type + helper évite de recopier la conversion dans chaque vue.
   ═══════════════════════════════════════════════════════════════ */

import type { TaskRow, TaskPriority } from '../types/task';

export interface ScheduledTaskBlock {
  id: string;
  title: string;
  startAt: string;   // ISO — scheduled_at
  endAt: string;     // ISO — scheduled_at + durée (défaut 60 min)
  priority: TaskPriority;
  status: string;    // 'open' | 'done'
  assigneeUserId: string | null;
  raw: TaskRow;
}

const DEFAULT_DURATION_MIN = 60;

/** Convertit les tâches planifiées en blocs calendrier. Ignore celles sans heure. */
export function tasksToBlocks(tasks: TaskRow[]): ScheduledTaskBlock[] {
  const blocks: ScheduledTaskBlock[] = [];
  for (const t of tasks) {
    if (!t.scheduled_at) continue;
    const start = new Date(t.scheduled_at);
    if (Number.isNaN(start.getTime())) continue;
    const durMin = t.duration_minutes && t.duration_minutes > 0 ? t.duration_minutes : DEFAULT_DURATION_MIN;
    const end = new Date(start.getTime() + durMin * 60_000);
    blocks.push({
      id: t.id,
      title: t.title,
      startAt: t.scheduled_at,
      endAt: end.toISOString(),
      priority: t.priority,
      status: t.status,
      assigneeUserId: t.assignee_user_id,
      raw: t,
    });
  }
  return blocks;
}

/** Couleur d'un bloc tâche selon la priorité (distincte des couleurs d'équipe/tag). */
export function taskPriorityColor(priority: TaskPriority): string {
  switch (priority) {
    case 'high': return '#dc2626';   // rouge
    case 'medium': return '#d97706'; // ambre
    default: return '#6366f1';       // indigo (low)
  }
}
