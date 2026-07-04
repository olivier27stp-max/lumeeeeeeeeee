/* ═══════════════════════════════════════════════════════════════
   Page — Finances
   Single workspace with three sub-tabs:
     • Facturation (invoices, default)
     • Paiements   (client payments)
     • Versements  (payouts to the connected bank account)
   Thin shell: owns the page title + tab nav, mounts the existing
   Invoices / Payments page bodies in embedded mode.
   ═══════════════════════════════════════════════════════════════ */

import { useSearchParams } from 'react-router-dom';
import { useTranslation } from '../i18n';
import Invoices from './Invoices';
import Payments from './Payments';
import FinancesOverview from '../components/FinancesOverview';

type FinancesTab = 'apercu' | 'facturation' | 'paiements' | 'versements';

function parseFinancesTab(raw: string | null): FinancesTab {
  if (raw === 'facturation') return 'facturation';
  if (raw === 'paiements') return 'paiements';
  if (raw === 'versements') return 'versements';
  return 'apercu';
}

export default function Finances() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const [params, setParams] = useSearchParams();
  const tab = parseFinancesTab(params.get('tab'));

  // Switching tabs clears sub-filter params (status/method/page/etc.) so a
  // filter from one tab never bleeds into another.
  function selectTab(next: FinancesTab) {
    const sp = new URLSearchParams();
    if (next !== 'apercu') sp.set('tab', next);
    setParams(sp);
  }

  const tabs: { key: FinancesTab; label: string }[] = [
    { key: 'apercu', label: fr ? "Vue d'ensemble" : 'Overview' },
    { key: 'facturation', label: t.finances?.tabs?.invoicing || (fr ? 'Facturation' : 'Invoicing') },
    { key: 'paiements', label: t.finances?.tabs?.payments || (fr ? 'Paiements' : 'Payments') },
    { key: 'versements', label: t.finances?.tabs?.payouts || (fr ? 'Versements' : 'Payouts') },
  ];

  return (
    <>
      <h1 className="text-[28px] font-bold text-text-primary leading-tight">
        {t.finances?.title || 'Finances'}
      </h1>

      {/* ── Sub-tabs ── */}
      <div className="tab-nav mt-4">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            className={tab === tb.key ? 'tab-item-active' : 'tab-item'}
            onClick={() => selectTab(tb.key)}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <div className="mt-2">
        {tab === 'apercu' && <FinancesOverview />}
        {tab === 'facturation' && <Invoices embedded />}
        {tab === 'paiements' && <Payments embedded forceTab="overview" />}
        {tab === 'versements' && <Payments embedded forceTab="payouts" />}
      </div>
    </>
  );
}
