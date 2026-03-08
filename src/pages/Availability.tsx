import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Clock, RefreshCw } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AvailabilityRecord,
  createAvailability,
  deleteAvailability,
  listAvailability,
  minutesToTime,
  setDefaultAvailability,
  timeToMinutes,
  weekdayLabel,
} from '../lib/availabilityApi';
import { listTeams, TeamRecord } from '../lib/teamsApi';
import { cn } from '../lib/utils';
import { PageHeader, EmptyState } from '../components/ui';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

export default function Availability() {
  const queryClient = useQueryClient();
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newWeekday, setNewWeekday] = useState<number>(1);
  const [newStart, setNewStart] = useState('08:00');
  const [newEnd, setNewEnd] = useState('17:00');

  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: listTeams });
  const teams = teamsQuery.data || [];

  const availQuery = useQuery({
    queryKey: ['availability', selectedTeam],
    queryFn: () => listAvailability(selectedTeam || undefined),
    enabled: true,
  });
  const records = availQuery.data || [];

  if (!selectedTeam && teams.length > 0) {
    setSelectedTeam(teams[0].id);
  }

  const grouped = useMemo(() => {
    const map = new Map<number, AvailabilityRecord[]>();
    for (const rec of records) {
      if (selectedTeam && rec.team_id !== selectedTeam) continue;
      const bucket = map.get(rec.weekday) || [];
      bucket.push(rec);
      map.set(rec.weekday, bucket);
    }
    return map;
  }, [records, selectedTeam]);

  const createMutation = useMutation({
    mutationFn: createAvailability,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availability'] });
      toast.success('Availability added.');
      setIsAddOpen(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to add availability.'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAvailability,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availability'] });
      toast.success('Availability removed.');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to remove.'),
  });

  const defaultMutation = useMutation({
    mutationFn: setDefaultAvailability,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availability'] });
      toast.success('Default Mon-Fri 8-5 availability set.');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to set defaults.'),
  });

  function handleAdd() {
    if (!selectedTeam) {
      toast.error('Select a team first.');
      return;
    }
    createMutation.mutate({
      team_id: selectedTeam,
      weekday: newWeekday,
      start_minute: timeToMinutes(newStart),
      end_minute: timeToMinutes(newEnd),
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Team Availability" subtitle="Define working hours per team and weekday">
        <button type="button" onClick={() => availQuery.refetch()} className="glass-button inline-flex items-center gap-1.5">
          <RefreshCw size={14} /> Refresh
        </button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        {teams.map((team) => (
          <button
            key={team.id}
            type="button"
            onClick={() => setSelectedTeam(team.id)}
            className={cn(
              'inline-flex items-center gap-2 rounded-md border px-3 py-[6px] text-[13px] font-medium transition-colors',
              selectedTeam === team.id
                ? 'border-primary bg-primary text-white'
                : 'border-border bg-surface text-text-secondary hover:bg-surface-secondary'
            )}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: team.color_hex || '#111827' }} />
            {team.name}
          </button>
        ))}
        {selectedTeam && (
          <div className="flex items-center gap-2 ml-auto">
            <button type="button" onClick={() => defaultMutation.mutate(selectedTeam)} disabled={defaultMutation.isPending} className="glass-button-ghost text-[13px]">
              Set Mon-Fri defaults
            </button>
            <button type="button" onClick={() => setIsAddOpen(true)} className="glass-button-primary inline-flex items-center gap-1.5">
              <Plus size={14} /> Add slot
            </button>
          </div>
        )}
      </div>

      {teams.length === 0 && <EmptyState icon={Clock} title="No teams yet" description="Create teams in Settings first." />}

      {selectedTeam && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {WEEKDAYS.map((weekday) => {
            const daySlots = grouped.get(weekday) || [];
            return (
              <div key={weekday} className="section-card p-4">
                <h3 className="text-[13px] font-semibold text-text-primary mb-3">{weekdayLabel(weekday)}</h3>
                {daySlots.length === 0 ? (
                  <p className="text-xs text-text-tertiary">No availability</p>
                ) : (
                  <div className="space-y-1.5">
                    {daySlots.map((slot) => (
                      <div key={slot.id} className="flex items-center justify-between rounded-md bg-surface-secondary px-3 py-2">
                        <span className="text-[13px] text-text-primary tabular-nums">
                          {minutesToTime(slot.start_minute)} – {minutesToTime(slot.end_minute)}
                        </span>
                        <button type="button" onClick={() => deleteMutation.mutate(slot.id)} className="rounded p-1 text-text-tertiary hover:text-danger hover:bg-danger-light transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isAddOpen && (
        <div className="modal-overlay" onClick={() => setIsAddOpen(false)}>
          <div className="modal-content max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5"><h3 className="text-[15px] font-semibold text-text-primary">Add availability slot</h3></div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Weekday</label>
                <select value={newWeekday} onChange={(e) => setNewWeekday(Number(e.target.value))} className="glass-input mt-1 w-full">
                  {WEEKDAYS.map((d) => (<option key={d} value={d}>{weekdayLabel(d)}</option>))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Start</label>
                  <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} className="glass-input mt-1 w-full" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">End</label>
                  <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} className="glass-input mt-1 w-full" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button type="button" className="glass-button" onClick={() => setIsAddOpen(false)}>Cancel</button>
              <button type="button" className="glass-button-primary" onClick={handleAdd} disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
