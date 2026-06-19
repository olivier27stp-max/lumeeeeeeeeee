/**
 * CRM Workspace — Home page.
 * Shows the date/greeting and the wide horizontal revenue overview card.
 */
import { useTranslation } from '../i18n';
import { useCompany } from '../contexts/CompanyContext';
import RevenueOverviewCard from '../components/RevenueOverviewCard';
import HomeTasksCard from '../components/HomeTasksCard';
import { HomeMapBackground } from '../components/map';

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
    <div className="relative min-h-screen -m-6 lg:-m-10 -mt-8 overflow-hidden">
      {/* ─── HOME MAP BACKGROUND (exact Calendar map — today's jobs) ──────────
          Easy to remove: delete this whole block + HomeMapBackground.tsx and
          restore `bg-surface ... p-6 lg:p-8` on the wrapper above. */}
      <div className="absolute inset-0 z-0">
        <HomeMapBackground />
        {/* Scrim: keeps the greeting + cards readable up top, fades out so the
            map shows through clearly below. pointer-events-none so it never
            blocks interaction with the map underneath. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] bg-gradient-to-b from-surface via-surface/85 to-transparent" />
      </div>
      {/* ─── END HOME MAP BACKGROUND ──────────────────────────────────────── */}

      {/* Foreground content — sits on top of the map. The wrapper is
          pointer-events-none so empty areas let clicks/scroll reach the
          interactive map; only the cards re-enable pointer events. */}
      <div className="relative z-10 p-6 lg:p-8 pointer-events-none">
        {/* TOP BAR — bold date + "welcome back, <name>" greeting */}
        <div className="mb-5">
          <h1 className="text-[24px] font-bold text-text-primary first-letter:uppercase">{todayLabel}</h1>
          <p className="text-[16px] font-bold text-text-primary mt-0.5">{greeting}</p>
        </div>

        {/* Tasks box (1/3, left) + revenue overview chart (2/3, right) */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
          <div className="xl:col-span-1 pointer-events-auto">
            <HomeTasksCard />
          </div>
          <div className="xl:col-span-2 pointer-events-auto">
            <RevenueOverviewCard />
          </div>
        </div>

        {/* Spacer — leaves a clear, interactive stretch of map below the cards. */}
        <div className="h-[55vh]" />
      </div>
    </div>
  );
}
