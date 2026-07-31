/* ═══════════════════════════════════════════════════════════════
   TaskModal — Create / Edit task
   Used for both "Add Task" and "Edit" flows.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
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

// Display labels only — values sent to the API stay in English
const TASK_TYPE_LABELS_FR: Record<string, string> = {
  'Meeting': 'Rencontre',
  'Recruit': 'Recrue',
  'Follow-up': 'Suivi',
  'Admin': 'Admin',
  'Personal': 'Personnel',
  'Client': 'Client',
  'Sales': 'Ventes',
  'Finance': 'Finance',
  'CRM': 'CRM',
  'Reminder': 'Rappel',
  'Custom': 'Personnalisé',
};

interface TaskModalProps {
  open: boolean;
  onClose: () => void;
  task?: TaskRow | null;
  onSubmit: (input: TaskCreateInput | TaskUpdateInput) => Promise<void>;
}

export default function TaskModal({ open, onClose, task, onSubmit }: TaskModalProps) {
  const { language } = useTranslation();
  const fr = language === 'fr';
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
      setError(fr ? 'Le titre est requis' : 'Title is required');
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
      setError(err?.message || (fr ? 'Impossible d’enregistrer la tâche' : 'Failed to save task'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? (fr ? 'Modifier la tâche' : 'Edit Task') : (fr ? 'Ajouter une tâche' : 'Add Task')}
      description={isEdit ? (fr ? 'Mettez à jour les détails de la tâche.' : 'Update task details.') : (fr ? 'Créez une nouvelle tâche.' : 'Create a new task.')}
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
            {saving ? (fr ? 'Enregistrement...' : 'Saving...') : isEdit ? (fr ? 'Enregistrer' : 'Save Changes') : (fr ? 'Créer la tâche' : 'Create Task')}
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
          <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Titre *' : 'Title *'}</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={fr ? 'Ex. : Appeler la recrue Simon jeudi' : 'e.g. Call recruit Simon on Thursday'}
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
            placeholder={fr ? 'Ajoutez des détails...' : 'Add details...'}
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
                <option key={t} value={t}>{fr ? (TASK_TYPE_LABELS_FR[t] || t) : t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Priorité' : 'Priority'}</label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value as TaskPriority)}
              className="input-field w-full"
            >
              <option value="low">{fr ? 'Faible' : 'Low'}</option>
              <option value="medium">{fr ? 'Moyenne' : 'Medium'}</option>
              <option value="high">{fr ? 'Élevée' : 'High'}</option>
            </select>
          </div>
        </div>

        {/* Row: Status + Due Date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Statut' : 'Status'}</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as TaskStatus)}
              className="input-field w-full"
            >
              <option value="open">{fr ? 'Ouverte' : 'Open'}</option>
              <option value="done">{fr ? 'Terminée' : 'Done'}</option>
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Date d’échéance' : 'Due Date'}</label>
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
            <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Entité liée' : 'Linked Entity'}</label>
            <select
              value={linkedEntityType}
              onChange={e => setLinkedEntityType(e.target.value as TaskLinkedEntityType | '')}
              className="input-field w-full"
            >
              <option value="">{fr ? 'Aucune' : 'None'}</option>
              <option value="client">Client</option>
              <option value="lead">Lead</option>
              <option value="quote">{fr ? 'Devis' : 'Quote'}</option>
              <option value="invoice">{fr ? 'Facture' : 'Invoice'}</option>
              <option value="job">Job</option>
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-text-primary mb-1 block">{fr ? 'Personne liée' : 'Linked Person'}</label>
            <select
              value={linkedPersonType}
              onChange={e => setLinkedPersonType(e.target.value as TaskLinkedPersonType | '')}
              className="input-field w-full"
            >
              <option value="">{fr ? 'Aucune' : 'None'}</option>
              <option value="recruit">{fr ? 'Recrue' : 'Recruit'}</option>
              <option value="client">Client</option>
              <option value="prospect">Prospect</option>
              <option value="contact">Contact</option>
              <option value="team_member">{fr ? 'Membre de l’équipe' : 'Team Member'}</option>
            </select>
          </div>
        </div>
      </div>
    </Modal>
  );
}
