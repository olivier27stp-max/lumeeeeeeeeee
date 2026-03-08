import React from 'react';
import { cn } from '../../lib/utils';
import { InsightsTab } from '../../lib/insightsApi';

const TAB_OPTIONS: Array<{ id: InsightsTab; label: string }> = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'lead_conversion', label: 'Lead conversion' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'invoices', label: 'Invoices' },
];

export default function InsightsTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: InsightsTab;
  onTabChange: (tab: InsightsTab) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-white/20 bg-white p-1">
      {TAB_OPTIONS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            activeTab === tab.id ? 'bg-black text-white' : 'text-text-primary hover:bg-black/5'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
