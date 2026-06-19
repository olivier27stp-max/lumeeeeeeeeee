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

      {/* Foreground content — scrolls on top of the map. The wrapper is
          pointer-events-none so empty areas let clicks/scroll reach the
          interactive map; only the cards re-enable pointer events. */}
      <div className="relative z-10 p-6 lg:p-8 pointer-events-none">
        {/* Scrim: fades the top so the greeting + cards stay readable over the
            satellite imagery, and scrolls away with the content so the full map
            is clean once the cards are gone. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70vh] bg-gradient-to-b from-surface via-surface/80 to-transparent" />

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

        {/* Scroll room — lets you scroll the cards fully off-screen so only the
            complete map remains visible. */}
        <div className="h-[120vh]" />
      </div>
    </div>
  );
}
