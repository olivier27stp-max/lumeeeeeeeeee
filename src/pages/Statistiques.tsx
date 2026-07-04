/**
 * Statistiques (/insights) — financial overview.
 * Interactive revenue chart, KPIs, A/R aging + top debtors, TPS/TVQ taxes to
 * remit, and commissions & payroll. All figures come from existing APIs.
 * (The previous analytics page lives on in pages/Insights.tsx, unrouted.)
 */
import { useTranslation } from '../i18n';
import FinancesOverview from '../components/FinancesOverview';

export default function Statistiques() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  return (
    <div>
      <h1 className="text-[28px] font-bold text-text-primary leading-tight tracking-tight">
        {fr ? 'Statistiques' : 'Statistics'}
      </h1>
      <FinancesOverview />
    </div>
  );
}
