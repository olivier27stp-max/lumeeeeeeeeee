/**
 * HomeAgendaCard — "My day" timeline: today's appointments in order.
 * Each row deep-links to the job; the header links to the calendar.
 */
import { CalendarDays } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';
import HomeCard from './HomeCard';
import type { TodayAppointmentsSummary } from '../lib/dashboardApi';

type HomeAgendaCardProps = {
  appointments: TodayAppointmentsSummary;
  loading?: boolean;
  className?: string;
};

function formatTime(iso: string, fr: boolean): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(fr ? 'fr-CA' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !fr,
  });
}

export default function HomeAgendaCard({ appointments, loading, className }: HomeAgendaCardProps) {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const items = appointments.items || [];

  return (
    <HomeCard
      icon={CalendarDays}
      title={fr ? 'Ma journée' : 'My day'}
      action={{ label: fr ? 'Calendrier' : 'Calendar', onClick: () => navigate('/calendar') }}
      className={className}
      bodyClassName="-mx-1"
    >
      {loading ? (
        <div className="space-y-2 px-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-11 bg-surface-tertiary/50 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-[12px] text-text-muted">
          {fr ? "Aucun rendez-vous aujourd'hui" : 'No appointments today'}
        </div>
      ) : (
        items.map((a, i) => (
          <button
            key={a.id}
            onClick={() => navigate(`/jobs/${a.jobId}`)}
            className={
              'group relative w-full text-left grid grid-cols-[44px_1fr] gap-3 items-start px-2 py-2.5 rounded-lg hover:bg-surface-secondary transition-colors ' +
              (i > 0 ? 'border-t border-border-light' : '')
            }
          >
            <span className="absolute left-0 top-3 bottom-3 w-0.5 rounded bg-border group-hover:bg-text-secondary transition-colors" />
            <span className="text-[12px] font-semibold text-text-primary tabular-nums pt-0.5">
              {formatTime(a.startAt, fr)}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-text-primary truncate leading-tight">{a.title}</p>
              <p className="text-[12px] text-text-muted truncate mt-0.5">
                {[a.clientName, a.propertyAddress].filter(Boolean).join(' · ') || (fr ? 'Sans client' : 'No client')}
              </p>
            </div>
          </button>
        ))
      )}
    </HomeCard>
  );
}
