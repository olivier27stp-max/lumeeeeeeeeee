import React, { useMemo, useState } from 'react';
import { Clock, Filter, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { findFreeSlots, FreeSlot } from '../lib/availabilityApi';
import { listTeams } from '../lib/teamsApi';
import { scheduleUnscheduledJob, DEFAULT_TIMEZONE } from '../lib/scheduleApi';
import { cn } from '../lib/utils';
import { PageHeader, StatCard, EmptyState } from '../components/ui';
import { FilterSelect } from '../components/ui/FilterBar';
import { useTranslation } from '../i18n';

export default function FindTime() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [durationFilter, setDurationFilter] = useState<number>(60);
  const [daysAhead, setDaysAhead] = useState<number>(14);
  const [pendingJobId, setPendingJobId] = useState('');
  const [bookingSlot, setBookingSlot] = useState<FreeSlot | null>(null);
  const [isBooking, setIsBooking] = useState(false);

  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: listTeams });
  const slotsQuery = useQuery({
    queryKey: ['findTimeSlots', teamFilter, durationFilter, daysAhead],
    queryFn: () => findFreeSlots({ teamId: teamFilter === 'all' ? null : teamFilter, days: daysAhead, slotDuration: durationFilter }),
  });

  const teams = teamsQuery.data || [];
  const slots = slotsQuery.data || [];

  const slotsByDay = useMemo(() => {
    const grouped = new Map<string, FreeSlot[]>();
    for (const slot of slots) {
      const bucket = grouped.get(slot.date) || [];
      bucket.push(slot);
      grouped.set(slot.date, bucket);
    }
    return Array.from(grouped.entries());
  }, [slots]);

  async function handleBookSlot(slot: FreeSlot) {
    if (!pendingJobId.trim()) { toast.error(t.findTime.enterJobId); return; }
    setIsBooking(true);
    try {
      await scheduleUnscheduledJob({ jobId: pendingJobId.trim(), startAt: slot.start_time, endAt: slot.end_time, teamId: slot.team_id, timezone: DEFAULT_TIMEZONE });
      toast.success(t.findTime.jobScheduled);
      setBookingSlot(null);
      setPendingJobId('');
      queryClient.invalidateQueries({ queryKey: ['findTimeSlots'] });
    } catch (error: any) { toast.error(error?.message || t.findTime.failedSchedule);
    } finally { setIsBooking(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t.findTime.title} subtitle={t.findTime.subtitle}>
        <button type="button" onClick={() => slotsQuery.refetch()} className="glass-button inline-flex items-center gap-1.5">
          <RefreshCw size={14} /> {t.common.refresh}
        </button>
      </PageHeader>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={teamFilter}
          onChange={setTeamFilter}
          icon={<Filter size={13} />}
          options={[{ value: 'all', label: t.findTime.allTeams }, ...teams.map((team) => ({ value: team.id, label: team.name }))]}
        />
        <FilterSelect
          value={String(durationFilter)}
          onChange={(v) => setDurationFilter(Number(v))}
          icon={<Clock size={13} />}
          options={[
            { value: '30', label: t.findTime.thirtyMin },
            { value: '60', label: t.findTime.oneHour },
            { value: '90', label: t.findTime.onePointFiveHours },
            { value: '120', label: t.findTime.twoHours },
            { value: '180', label: t.findTime.threeHours },
            { value: '240', label: t.findTime.fourHours },
          ]}
        />
        <FilterSelect
          value={String(daysAhead)}
          onChange={(v) => setDaysAhead(Number(v))}
          options={[
            { value: '7', label: t.findTime.next7Days },
            { value: '14', label: t.findTime.next14Days },
            { value: '30', label: t.findTime.next30Days },
          ]}
        />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard label={t.findTime.availableSlots} value={slots.length} />
        <StatCard label={t.findTime.daysWithOpenings} value={slotsByDay.length} />
        <StatCard label={t.findTime.teamsAvailable} value={new Set(slots.map((s) => s.team_id)).size} />
      </div>

      {/* Quick book */}
      <div className="section-card p-4">
        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.findTime.quickBook}</label>
        <input
          value={pendingJobId}
          onChange={(e) => setPendingJobId(e.target.value)}
          placeholder={t.findTime.jobUuidPlaceholder}
          className="glass-input mt-1.5 w-full"
        />
        <p className="mt-1.5 text-xs text-text-tertiary">{t.findTime.clickSlotToSchedule}</p>
      </div>

      {/* Slots */}
      {slotsQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (<div key={i} className="h-24 skeleton" />))}
        </div>
      ) : slots.length === 0 ? (
        <EmptyState icon={Clock} title={t.findTime.noSlotsFound} description={t.findTime.setupAvailability} />
      ) : (
        <div className="space-y-5">
          {slotsByDay.map(([date, daySlots]) => (
            <div key={date}>
              <h3 className="mb-2 text-[13px] font-semibold text-text-primary">{daySlots[0].day_label}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {daySlots.map((slot) => {
                  const startTime = new Date(slot.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const endTime = new Date(slot.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  return (
                    <button
                      key={`${slot.team_id}-${slot.start_time}`}
                      type="button"
                      onClick={() => { if (pendingJobId.trim()) setBookingSlot(slot); }}
                      className={cn(
                        'section-card p-3 text-left transition-all',
                        pendingJobId.trim()
                          ? 'hover:border-primary hover:shadow-sm cursor-pointer'
                          : 'cursor-default opacity-75'
                      )}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: slot.team_color }} />
                        <span className="text-xs text-text-tertiary truncate">{slot.team_name}</span>
                      </div>
                      <p className="text-[13px] font-medium text-text-primary tabular-nums">{startTime} – {endTime}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Booking confirmation */}
      {bookingSlot && (
        <div className="modal-overlay" onClick={() => setBookingSlot(null)}>
          <div className="modal-content max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-5">
              <h3 className="text-[15px] font-semibold text-text-primary">{t.findTime.confirmScheduling}</h3>
              <div className="mt-3 space-y-2 text-[13px] text-text-secondary">
                <p><span className="font-medium text-text-primary">{`${t.findTime.team}:`}</span> {bookingSlot.team_name}</p>
                <p><span className="font-medium text-text-primary">{`${t.findTime.date}:`}</span> {bookingSlot.day_label}</p>
                <p>
                  <span className="font-medium text-text-primary">{`${t.findTime.time}:`}</span>{' '}
                  {new Date(bookingSlot.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –{' '}
                  {new Date(bookingSlot.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
                <p><span className="font-medium text-text-primary">{`${t.findTime.jobId}:`}</span> <span className="font-mono text-xs">{pendingJobId}</span></p>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className="glass-button" onClick={() => setBookingSlot(null)} disabled={isBooking}>{t.common.cancel}</button>
                <button type="button" className="glass-button-primary" onClick={() => handleBookSlot(bookingSlot)} disabled={isBooking}>
                  {isBooking ? t.findTime.scheduling : t.findTime.schedule}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
