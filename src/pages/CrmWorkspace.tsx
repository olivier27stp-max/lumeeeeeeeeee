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
    <div className="relative -m-6 lg:-m-10 -mt-8">
      {/* ─── HOME MAP BACKGROUND (exact Calendar map — today's jobs) ──────────
          Sticky + full viewport: the map stays pinned to the screen while the
          content scrolls over it, so scrolling down past the cards leaves only
          the complete map on screen.
          Easy to remove: delete this whole block + HomeMapBackground.tsx and
          restore `bg-surface min-h-screen ... p-6 lg:p-8` on the wrapper. */}
      <div className="sticky top-0 z-0 h-[100dvh] -mb-[100dvh] overflow-hidden">
        <HomeMapBackground />
      </div>
      {/* ─── END HOME MAP BACKGROUND ──────────────────────────────────────── */}

      {/* Foreground content — scrolls on top of the (non-interactive) map. */}
      <div className="relative z-10 p-6 lg:p-8">
        {/* TOP BAR — bold date + "welcome back, <name>" greeting (white over the map) */}
        <div className="mb-5">
          <h1 className="text-[24px] font-bold text-white first-letter:uppercase drop-shadow">{todayLabel}</h1>
          <p className="text-[16px] font-bold text-white/90 mt-0.5 drop-shadow">{greeting}</p>
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

        {/* Scroll room — lets you scroll the cards fully off-screen so only the
            complete map remains visible. */}
        <div className="h-[120vh]" />
      </div>
    </div>
  );
}
