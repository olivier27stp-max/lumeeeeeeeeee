// Row of KPI cards at the top of both personal and admin commission
// dashboards — port of the web `components/commissions/CommissionStatsCards`.

import { Text, View } from 'react-native';

export interface CommissionStat {
  label: string;
  value: string;
  subtitle?: string;
}

const CARD = { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } } as const;

export default function CommissionStatsCards({ cards }: { cards: CommissionStat[] }) {
  return (
    <View className="flex-row flex-wrap gap-3">
      {cards.map((card) => (
        <View key={card.label} className="min-w-[45%] flex-1 gap-0.5 rounded-2xl bg-white p-4" style={CARD}>
          <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{card.label}</Text>
          <Text className="text-xl font-bold text-ink" numberOfLines={1}>
            {card.value}
          </Text>
          {card.subtitle ? <Text className="text-[11px] text-ink-muted">{card.subtitle}</Text> : null}
        </View>
      ))}
    </View>
  );
}
