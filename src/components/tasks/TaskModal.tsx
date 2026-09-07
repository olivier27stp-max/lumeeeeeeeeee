/* ═══════════════════════════════════════════════════════════════
   TaskModal — Créer / Modifier une tâche
   Champs : titre, description, priorité, statut, date d'échéance,
   heure optionnelle (bloc calendrier), et « Assigné à » (une personne
   OU une équipe). Volontairement simple : pas de type ni de liens
   d'entité (retirés le 2026-09-06 — trop confus, jamais utilisés).
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import { useTranslation } from '../../i18n';
import type {
  TaskRow,
  TaskCreateInput,
  TaskUpdateInput,
  TaskStatus,
  TaskPriority,
} from '../../types/task';
import type { AssignableMember } from '../../lib/tasksApi';
import type { TeamRecord } from '../../lib/teamsApi';

interface TaskModalProps {
  open: boolean;
  onClose: () => void;
  task?: TaskRow | null;
  onSubmit: (input: TaskCreateInput | TaskUpdateInput) => Promise<void>;
  /** Valeurs pré-remplies à l'ouverture (ex. depuis le calendrier : jour+heure cliqués). */
  defaults?: { due_date?: string; scheduled_at?: string; duration_minutes?: number };
  /** Membres assignables (personnes). */
  members?: AssignableMember[];
  /** Équipes assignables. */
  teams?: TeamRecord[];
}

// Découpe un ISO en date (yyyy-mm-dd) et heure locale (HH:mm) pour les inputs.
function splitLocal(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

type AssignMode = 'none' | 'person' | 'team';

export default function TaskModal({ open, onClose, task, onSubmit, defaults, members = [], teams = [] }: TaskModalProps) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const isEdit = !!task;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('open');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  // Planification optionnelle à une heure précise (bloc calendrier).
  const [timed, setTimed] = useState(false);
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');
  const [durationMin, setDurationMin] = useState('60');
  // Assignation : personne, équipe, ou aucune.
  const [assignMode, setAssignMode] = useState<AssignMode>('none');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title || '');
    setDescription(task?.description || '');
    setStatus(task?.status || 'open');
    setPriority(task?.priority || 'medium');
    setDueDate(task?.due_date || defaults?.due_date || '');
    const sched = task?.scheduled_at || defaults?.scheduled_at || '';
    const { date: sd, time: st } = splitLocal(sched);
    setTimed(!!sched);
    setSchedDate(sd);
    setSchedTime(st);
    setDurationMin(String(task?.duration_minutes ?? defaults?.duration_minutes ?? 60));
    // Assignation : équipe prime si les deux existent (ne devrait pas arriver).
    if (task?.team_id) { setAssignMode('team'); setTeamId(task.team_id); setAssigneeUserId(''); }
    else if (task?.assignee_user_id) { setAssignMode('person'); setAssigneeUserId(task.assignee_user_id); setTeamId(''); }
    else { setAssignMode('none'); setAssigneeUserId(''); setTeamId(''); }
    setSaving(false);
    setError('');
  }, [open, task, defaults]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError(fr ? 'Le titre est requis' : 'Title is required');
      return;
    }
    if (timed && (!schedDate || !schedTime)) {
      setError(fr ? 'Choisis une date ET une heure, ou décoche « à une heure précise ».' : 'Pick a date AND a time, or uncheck “at a specific time”.');
      return;
    }
    setError('');
    setSaving(true);
    const scheduledAt = timed && schedDate && schedTime
      ? new Date(`${schedDate}T${schedTime}`).toISOString()
      : null;
    const dur = timed ? Math.max(1, Math.min(1440, parseInt(durationMin, 10) || 60)) : null;
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        due_date: dueDate || null,
        scheduled_at: scheduledAt,
        duration_minutes: dur,
        // Une seule cible d'assignation à la fois ; l'autre est remise à null.
        assignee_user_id: assignMode === 'person' ? (assigneeUserId || null) : null,
        team_id: assignMode === 'team' ? (teamId || null) : null,
      });
    } catch (err: any) {
      setError(err?.message || (fr ? 'Impossible d’enregistrer la tâche' : 'Failed to save task'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? (fr ? 'Modifier la tâche' : 'Edit task') : (fr ? 'Nouvelle tâche' : 'New task')}
      description={isEdit ? (fr ? 'Mets à jour les détails de la tâche.' : 'Update task details.') : (fr ? 'Crée une nouvelle tâche.' : 'Create a new task.')}
      size="lg"
      footer={
        <>
          <button
            onClick={onClose}
            className="h-9 px-4 bg-surface border border-outline rounded-md text-[13px] text-text-primary font-medium hover:bg-surface-secondary transition-colors"
          >
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !title.trim()}
            className="h-9 px-5 bg-primary text-white rounded-md text-[13px] font-medium hover:bg-primary-hover disabled:opacity-50 transition-all"
          >
            {saving ? (fr ? 'Enregistrement...' : 'Saving...') : isEdit ? (fr ? 'Enregistrer' : 'Save') : (fr ? 'Créer la tâche' : 'Create task')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="text-[13px] text-danger bg-danger-light border border-danger/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {/* Titre */}
        <div>
          <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Titre *' : 'Title *'}</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={fr ? 'Ex. : Appeler Jean jeudi' : 'e.g. Call Jean on Thursday'}
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
            placeholder={fr ? 'Ajoute des détails...' : 'Add details...'}
            rows={3}
            className="input-field w-full resize-none"
          />
        </div>

        {/* Priorité + Statut */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Priorité' : 'Priority'}</label>
            <select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)} className="input-field w-full">
              <option value="low">{fr ? 'Faible' : 'Low'}</option>
              <option value="medium">{fr ? 'Moyenne' : 'Medium'}</option>
              <option value="high">{fr ? 'Élevée' : 'High'}</option>
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Statut' : 'Status'}</label>
            <select value={status} onChange={e => setStatus(e.target.value as TaskStatus)} className="input-field w-full">
              <option value="open">{fr ? 'Ouverte' : 'Open'}</option>
              <option value="done">{fr ? 'Terminée' : 'Done'}</option>
            </select>
          </div>
        </div>

        {/* Date d'échéance + Assigné à */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Date d’échéance' : 'Due date'}</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input-field w-full" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Assigné à' : 'Assigned to'}</label>
            <select
              value={assignMode}
              onChange={e => { const m = e.target.value as AssignMode; setAssignMode(m); if (m !== 'person') setAssigneeUserId(''); if (m !== 'team') setTeamId(''); }}
              className="input-field w-full"
            >
              <option value="none">{fr ? 'Personne' : 'No one'}</option>
              <option value="person">{fr ? 'Un membre' : 'A member'}</option>
              <option value="team">{fr ? 'Une équipe' : 'A team'}</option>
            </select>
          </div>
        </div>

        {/* Sélecteur de personne / d'équipe selon le mode */}
        {assignMode === 'person' && (
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Membre' : 'Member'}</label>
            <select value={assigneeUserId} onChange={e => setAssigneeUserId(e.target.value)} className="input-field w-full">
              <option value="">{fr ? 'Choisir un membre...' : 'Choose a member...'}</option>
              {members.map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </select>
          </div>
        )}
        {assignMode === 'team' && (
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Équipe' : 'Team'}</label>
            <select value={teamId} onChange={e => setTeamId(e.target.value)} className="input-field w-full">
              <option value="">{fr ? 'Choisir une équipe...' : 'Choose a team...'}</option>
              {teams.map(tm => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
            </select>
          </div>
        )}

        {/* Planification à une heure précise (bloc calendrier) — optionnel */}
        <div className="rounded-lg border border-outline bg-surface-secondary/40 p-3">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={timed}
              onChange={e => setTimed(e.target.checked)}
              className="h-4 w-4 rounded border-outline text-primary focus:ring-1 focus:ring-primary/40 cursor-pointer"
            />
            <span className="text-[13px] font-medium text-text-primary">
              {fr ? 'Planifier à une heure précise' : 'Schedule at a specific time'}
            </span>
            <span className="text-[11px] text-text-tertiary">
              {fr ? '(apparaît dans le calendrier)' : '(shows in the calendar)'}
            </span>
          </label>
          {timed && (
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div>
                <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Date' : 'Date'}</label>
                <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} className="input-field w-full" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Heure' : 'Time'}</label>
                <input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)} className="input-field w-full" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Durée (min)' : 'Duration (min)'}</label>
                <input type="number" min={1} max={1440} step={15} value={durationMin} onChange={e => setDurationMin(e.target.value)} className="input-field w-full" />
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
