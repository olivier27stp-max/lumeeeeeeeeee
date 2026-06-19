/**
 * CRM Workspace — Home page.
 * Shows the date/greeting and the wide horizontal revenue overview card.
 */
import { useTranslation } from '../i18n';
import { useCompany } from '../contexts/CompanyContext';
import RevenueOverviewCard from '../components/RevenueOverviewCard';
import HomeTasksCard from '../components/HomeTasksCard';

export default function CrmWorkspace() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const { current } = useCompany();
  // Greeting block (top-left of the Home page): bold date + "welcome back, <name>"
  const firstName = current?.fullName?.trim().split(/\s+/)[0] || '';
  const todayLabel = new Date().toLocaleDateString(fr ? 'fr-CA' : 'en-US', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const greeting = firstName
    ? `${fr ? 'Bon retour' : 'Welcome back'}, ${firstName}`
    : (fr ? 'Bon retour' : 'Welcome back');

  return (
    <div className="bg-surface min-h-screen -m-6 lg:-m-10 -mt-8 p-6 lg:p-8">
      {/* TOP BAR — bold date + "welcome back, <name>" greeting */}
      <div className="mb-5">
        <h1 className="text-[24px] font-bold text-text-primary first-letter:uppercase">{todayLabel}</h1>
        <p className="text-[16px] font-bold text-text-primary mt-0.5">{greeting}</p>
      </div>

      {/* Tasks box (1/3, left) + revenue overview chart (2/3, right) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
        <div className="xl:col-span-1">
          <HomeTasksCard />
        </div>
        <div className="xl:col-span-2">
          <RevenueOverviewCard />
        </div>
      </div>
    </div>
  );
}
