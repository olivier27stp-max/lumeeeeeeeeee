import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Calendar, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import { addVisit } from '../lib/scheduleApi';
import { listTeams, type TeamRecord } from '../lib/teamsApi';
import { getJobs } from '../lib/jobsApi';

interface LockedJob {
  id: string;
  label: string;
}

interface AddVisitModalProps {
  open: boolean;
  onClose: () => void;
  onAdded?: () => void;
  /** When provided, the visit is added to this job and the job picker is hidden. */
  job?: LockedJob | null;
  /** When true and no locked job is given, show a search box to pick an existing job. */
  allowJobPick?: boolean;
  /** Prefill the date/time (e.g. the calendar slot that was clicked). */
  defaultStart?: Date;
  defaultEnd?: Date;
  /** Optional escape hatch (calendar) to create a brand-new job instead. */
  onCreateNewJob?: () => void;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toTimeInput(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function nextHour(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

export default function AddVisitModal({
  open,
  onClose,
  onAdded,
  job = null,
  allowJobPick = false,
  defaultStart,
  defaultEnd,
  onCreateNewJob,
}: AddVisitModalProps) {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const baseStart = defaultStart || nextHour();
  const baseEnd = defaultEnd || new Date(baseStart.getTime() + 2 * 60 * 60 * 1000);

  const [date, setDate] = useState(toDateInput(baseStart));
  const [startTime, setStartTime] = useState(toTimeInput(baseStart));
  const [endTime, setEndTime] = useState(toTimeInput(baseEnd));
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<LockedJob | null>(job);
  const [jobQuery, setJobQuery] = useState('');
  const [jobResults, setJobResults] = useState<LockedJob[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const searchSeq = useRef(0);

  // Reset form each time the modal is (re)opened.
  useEffect(() => {
    if (!open) return;
    const s = defaultStart || nextHour();
    const e = defaultEnd || new Date(s.getTime() + 2 * 60 * 60 * 1000);
    setDate(toDateInput(s));
    setStartTime(toTimeInput(s));
    setEndTime(toTimeInput(e));
    setTeamId(null);
    setSelectedJob(job);
    setJobQuery('');
    setJobResults([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listTeams().then((rows) => setTeams(rows.filter((tm) => tm.is_active !== false))).catch(() => setTeams([]));
  }, [open]);

  // Debounced job search (calendar mode only).
  useEffect(() => {
    if (!open || selectedJob || !allowJobPick) return;
    const q = jobQuery.trim();
    if (!q) {
      setJobResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(() => {
      getJobs({ q, pageSize: 8, sort: 'schedule', sortDirection: 'asc' })
        .then((res) => {
          if (seq !== searchSeq.current) return;
          setJobResults(
            res.jobs.map((j) => ({
              id: j.id,
              label: [j.title, j.client_name].filter(Boolean).join(' — ') || (fr ? 'Job sans titre' : 'Untitled job'),
            })),
          );
        })
        .catch(() => {
          if (seq === searchSeq.current) setJobResults([]);
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [jobQuery, open, selectedJob, allowJobPick, fr]);

  const canSubmit = useMemo(() => !!selectedJob && !!date && !!startTime && !!endTime, [selectedJob, date, startTime, endTime]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!selectedJob) {
      toast.error(fr ? 'Choisis un job pour la visite.' : 'Pick a job for the visit.');
      return;
    }
    const start = new Date(`${date}T${startTime}`);
    const end = new Date(`${date}T${endTime}`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      toast.error(fr ? 'Date ou heure invalide.' : 'Invalid date or time.');
      return;
    }
    if (end <= start) {
      toast.error(fr ? "L'heure de fin doit être après le début." : 'End time must be after the start.');
      return;
    }
    setSaving(true);
    try {
      await addVisit({
        jobId: selectedJob.id,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        teamId,
      });
      toast.success(fr ? 'Visite ajoutée.' : 'Visit added.');
      onAdded?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || (fr ? "Impossible d'ajouter la visite." : 'Could not add the visit.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-text-primary flex items-center gap-2">
            <Calendar size={15} className="text-text-secondary" />
            {fr ? 'Nouvelle visite' : 'New visit'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-tertiary"><X size={16} /></button>
        </div>

        {/* Job selection */}
        {selectedJob ? (
          <div className="mb-4 flex items-center justify-between rounded-xl bg-surface-secondary p-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-text-tertiary">{fr ? 'Job' : 'Job'}</p>
              <p className="truncate text-[13px] font-semibold text-text-primary">{selectedJob.label}</p>
            </div>
            {!job && allowJobPick && (
              <button onClick={() => setSelectedJob(null)} className="text-[12px] text-text-secondary hover:text-text-primary">{fr ? 'Changer' : 'Change'}</button>
            )}
          </div>
        ) : allowJobPick ? (
          <div className="mb-4">
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{fr ? 'Choisir un job' : 'Pick a job'}</label>
            <div className="relative mt-1.5">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                autoFocus
                value={jobQuery}
                onChange={(e) => setJobQuery(e.target.value)}
                placeholder={fr ? 'Rechercher un job…' : 'Search a job…'}
                className="glass-input w-full !pl-8"
              />
            </div>
            {(searching || jobResults.length > 0) && (
              <div className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-border bg-surface">
                {searching && <p className="px-3 py-2 text-[12px] text-text-tertiary">{fr ? 'Recherche…' : 'Searching…'}</p>}
                {!searching && jobResults.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => { setSelectedJob(r); setJobResults([]); setJobQuery(''); }}
                    className="block w-full truncate px-3 py-2 text-left text-[13px] text-text-primary hover:bg-surface-secondary"
                  >
                    {r.label}
                  </button>
                ))}
                {!searching && jobResults.length === 0 && jobQuery.trim() && (
                  <p className="px-3 py-2 text-[12px] text-text-tertiary">{fr ? 'Aucun job trouvé.' : 'No job found.'}</p>
                )}
              </div>
            )}
          </div>
        ) : null}

        {/* Date + time */}
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{fr ? 'Date' : 'Date'}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="glass-input mt-1.5 w-full" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted flex items-center gap-1"><Clock size={11} />{fr ? 'Début' : 'Start'}</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="glass-input mt-1.5 w-full" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted flex items-center gap-1"><Clock size={11} />{fr ? 'Fin' : 'End'}</label>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="glass-input mt-1.5 w-full" />
            </div>
          </div>
          {teams.length > 0 && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{fr ? 'Équipe (optionnel)' : 'Team (optional)'}</label>
              <select value={teamId ?? ''} onChange={(e) => setTeamId(e.target.value || null)} className="glass-input mt-1.5 w-full">
                <option value="">{fr ? 'Non assignée' : 'Unassigned'}</option>
                {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          {onCreateNewJob ? (
            <button onClick={() => { onClose(); onCreateNewJob(); }} className="text-[12px] text-text-secondary hover:text-text-primary">
              {fr ? '+ Créer un nouveau job' : '+ Create a new job'}
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="glass-button !text-[13px] !px-3 !py-1.5">{fr ? 'Annuler' : 'Cancel'}</button>
            <button
              onClick={() => void handleSubmit()}
              disabled={!canSubmit || saving}
              className="rounded-lg bg-text-primary px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? (fr ? 'Ajout…' : 'Adding…') : (fr ? 'Ajouter la visite' : 'Add visit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
