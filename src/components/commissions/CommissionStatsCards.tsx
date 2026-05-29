import { StatCard } from '../d2d/stat-card';

export interface CommissionStat {
  label: string;
  value: string;
  subtitle?: string;
}

interface Props {
  cards: CommissionStat[];
  columns?: 3 | 4;
}

/**
 * Row of KPI cards used at the top of both personal and admin commission
 * dashboards. Layout adapts to the count provided.
 */
export default function CommissionStatsCards({ cards, columns = 4 }: Props) {
  const gridClass = columns === 3
    ? 'grid grid-cols-1 gap-3 sm:grid-cols-3'
    : 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4';
  return (
    <div className={gridClass}>
      {cards.map((card) => (
        <StatCard
          key={card.label}
          label={card.label}
          value={card.value}
          subtitle={card.subtitle}
        />
      ))}
    </div>
  );
}
