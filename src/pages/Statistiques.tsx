/**
 * Statistiques (/insights) — rebuilt from scratch.
 * Clean slate: sections get added back incrementally, wired to real data.
 * The previous implementation lives in pages/Insights.tsx (unrouted).
 */
import { useTranslation } from '../i18n';

export default function Statistiques() {
  const { language } = useTranslation();
  const fr = language === 'fr';

  return (
    <div>
      <h1 className="text-[28px] font-bold text-text-primary leading-tight tracking-tight">
        {fr ? 'Statistiques' : 'Statistics'}
      </h1>
      <p className="text-[13px] text-text-tertiary mt-1">
        {fr ? "Analytiques et rapports d'affaires" : 'Business analytics & reports'}
      </p>

      <div className="mt-16 flex flex-col items-center justify-center text-center py-16 border border-dashed border-border rounded-xl">
        <p className="text-[14px] font-medium text-text-secondary">
          {fr ? 'Page en reconstruction' : 'Page under reconstruction'}
        </p>
        <p className="text-[12.5px] text-text-tertiary mt-1">
          {fr ? 'On la rebâtit à neuf.' : "We're building it fresh."}
        </p>
      </div>
    </div>
  );
}
