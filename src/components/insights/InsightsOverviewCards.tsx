import React from 'react';
import { ChevronRight } from 'lucide-react';
import { formatMoneyFromCents } from '../../lib/invoicesApi';

export interface InsightsOverviewCardItem {
  id: string;
  label: string;
  value: number;
  format?: 'count' | 'money';
}

export default function InsightsOverviewCards({ items }: { items: InsightsOverviewCardItem[] }) {
  return (
    <section className="glass rounded-2xl border border-white/20 p-4">
      <h2 className="text-3xl font-semibold tracking-tight text-text-primary">Overview</h2>
      <div className={`mt-4 grid gap-3 ${items.length >= 5 ? 'grid-cols-1 md:grid-cols-5' : 'grid-cols-1 md:grid-cols-4'}`}>
        {items.map((item) => (
          <article key={item.id} className="rounded-xl border border-white/30 bg-surface-card/70 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-text-primary">{item.label}</p>
              <ChevronRight size={14} className="text-text-tertiary" />
            </div>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-text-primary">
              {item.format === 'money' ? formatMoneyFromCents(item.value) : item.value.toLocaleString('en-US')}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
