import React from 'react';
import { cn } from '../../lib/utils';
import { InsightsTab } from '../../lib/insightsApi';
import { useTranslation } from '../../i18n';

export default function InsightsTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: InsightsTab;
  onTabChange: (tab: InsightsTab) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const TAB_OPTIONS: Array<{ id: InsightsTab; label: string }> = [
    { id: 'reports', label: fr ? 'Rapports' : 'Reports' },
    { id: 'revenue', label: 'Performance' },
    { id: 'finance', label: 'Finance' },
  ];
  return (
    <div className="inline-flex rounded-md border border-outline overflow-hidden">
      {TAB_OPTIONS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'px-5 py-2 text-[13px] font-medium transition-all',
            activeTab === tab.id
              ? 'bg-text-primary text-white'
              : 'bg-surface text-text-secondary hover:bg-surface-secondary'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
