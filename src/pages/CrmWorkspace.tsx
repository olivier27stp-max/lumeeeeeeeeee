/**
 * CRM Workspace — Home page.
 * Personalized hero + quick actions, a KPI strip, then a modular widget grid.
 * One shared dashboard query feeds the hero, KPIs, agenda, pipeline and
 * receivables; the revenue / tasks / service-mix cards keep their own queries.
 */
import { useQuery } from '@tanstack/react-query';
import {
  getDashboardData,
  type BusinessPerformance,
  type TodayAppointmentsSummary,
  type WorkflowSummary,
} from '../lib/dashboardApi';
import HomeHero from '../components/HomeHero';
import HomeWeatherStrip from '../components/HomeWeatherStrip';
import HomeKpiStrip from '../components/HomeKpiStrip';
import HomeAgendaCard from '../components/HomeAgendaCard';
import HomePipelineCard from '../components/HomePipelineCard';
import HomeReceivablesCard from '../components/HomeReceivablesCard';
import RevenueOverviewCard from '../components/RevenueOverviewCard';
import HomeTasksCard from '../components/HomeTasksCard';
import HomeServiceMixCard from '../components/HomeServiceMixCard';

const EMPTY_APPOINTMENTS: TodayAppointmentsSummary = {
  total: 0,
  active: 0,
  completed: 0,
  overdue: 0,
  remaining: 0,
  items: [],
};

const EMPTY_PERFORMANCE: BusinessPerformance = {
  receivables: { totalDue: 0, clientsOwing: 0, topClients: [] },
  upcomingJobs: { next7Days: 0 },
  revenue: { today: 0 },
  outstanding: { totalCents: 0 },
  todayJobs: 0,
  newLeadsToday: 0,
  conversionRate: 0,
  upcomingAppointments: 0,
  upcomingPayouts: { total: 0, processing: 0 },
};

const EMPTY_WORKFLOW: WorkflowSummary = {
  quotes: { activeLeads: 0, approvedAmount: 0, draft: 0, approved: 0, changesRequested: 0 },
  jobs: { active: 0, inProgressAmount: 0, activeSubCount: 0, actionRequired: 0 },
  invoices: { total: 0, comingSoon: false },
};

export default function CrmWorkspace() {
  const { data, isLoading } = useQuery({
    queryKey: ['home-dashboard'],
    queryFn: getDashboardData,
    staleTime: 30_000,
    // Refresh the Home every time you come back to it (navigation or tab focus).
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const appointments = data?.appointments ?? EMPTY_APPOINTMENTS;
  const performance = data?.performance ?? EMPTY_PERFORMANCE;
  const workflow = data?.workflow ?? EMPTY_WORKFLOW;

  return (
    <div className="bg-surface min-h-screen p-6 lg:p-8">
      <HomeWeatherStrip />

      <HomeHero appointmentsTotal={appointments.total} overdue={appointments.overdue} />

      <HomeKpiStrip performance={performance} appointments={appointments} loading={isLoading} />

      {/* Modular widget grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 grid-flow-row-dense items-start">
        <HomeAgendaCard appointments={appointments} loading={isLoading} className="xl:row-span-2" />
        <RevenueOverviewCard className="xl:col-span-2" />
        <HomeTasksCard />
        <HomePipelineCard workflow={workflow} loading={isLoading} />
        <HomeReceivablesCard receivables={performance.receivables} loading={isLoading} />
        <HomeServiceMixCard />
      </div>
    </div>
  );
}
