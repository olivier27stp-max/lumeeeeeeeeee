/**
 * HomeKpiStrip — four compact, clickable stat tiles across the top of the Home
 * page. Fed from the shared dashboard query; each tile deep-links to its page.
 */
import { DollarSign, Briefcase, UserPlus, CreditCard, type LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { formatCurrency } from '../lib/utils';
import type { BusinessPerformance, TodayAppointmentsSummary } from '../lib/dashboardApi';

type HomeKpiStripProps = {
  performance: BusinessPerformance;
  appointments: TodayAppointmentsSummary;
  loading?: boolean;
};

export default function HomeKpiStrip({ performance, appointments, loading }: HomeKpiStripProps) {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';

  const tiles: { icon: LucideIcon; label: string; value: string; sub: string; onClick: () => void }[] = [
    {
      icon: DollarSign,
      label: fr ? 'Revenus du jour' : "Today's revenue",
      value: formatCurrency(performance.revenue.today),
      sub: fr ? "encaissé aujourd'hui" : 'collected today',
      onClick: () => navigate('/finances'),
    },
    {
      icon: Briefcase,
      label: fr ? "Jobs aujourd'hui" : 'Jobs today',
      value: String(performance.todayJobs),
      sub: `${appointments.active} ${fr ? 'en cours' : 'active'} · ${appointments.remaining} ${fr ? 'à venir' : 'left'}`,
      onClick: () => navigate('/jobs'),
    },
    {
      icon: UserPlus,
      label: fr ? 'Nouveaux leads' : 'New leads',
      value: String(performance.newLeadsToday),
      sub: `${Math.round(performance.conversionRate)}% ${fr ? 'conversion' : 'conversion'}`,
      onClick: () => navigate('/quotes'),
    },
    {
      icon: CreditCard,
      label: fr ? 'À recevoir' : 'Receivable',
      value: formatCurrency(performance.receivables.totalDue),
      sub: `${performance.receivables.clientsOwing} ${fr ? 'clients' : 'clients'}`,
      onClick: () => navigate('/finances'),
    },
  ];

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
      {tiles.map((t) => (
        <button
          key={t.label}
          onClick={t.onClick}
          className="text-left bg-surface-card border border-border rounded-xl p-4 hover:border-text-muted hover:shadow-sm transition-all"
        >
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-text-muted">
            <t.icon size={14} />
            {t.label}
          </div>
          {loading ? (
            <div className="h-[26px] w-20 bg-surface-tertiary/60 rounded animate-pulse mt-3" />
          ) : (
            <div className="text-[26px] font-bold text-text-primary tracking-tight tabular-nums mt-3 leading-none">
              {t.value}
            </div>
          )}
          <div className="text-[12px] text-text-secondary mt-1.5">{loading ? ' ' : t.sub}</div>
        </button>
      ))}
    </div>
  );
}
