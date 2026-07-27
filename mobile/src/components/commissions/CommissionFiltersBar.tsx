// Filter bar for the commission dashboards — port of the web
// `components/commissions/CommissionFilters`. Same value shape (status +
// from/to + optional repId); the web's free date inputs become a month
// stepper (the web defaults to the current month anyway) so it works with
// native controls only.

import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';

export type CommissionStatusFilter = 'all' | 'pending' | 'approved' | 'paid' | 'reversed';

export interface CommissionFiltersValue {
  status: CommissionStatusFilter;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  repId?: string;
}

interface RepOption {
  id: string;
  label: string;
}

export function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

function shiftMonth(value: CommissionFiltersValue, delta: number): { from: string; to: string } {
  const [y, m] = value.from.split('-').map(Number);
  const from = new Date(y, (m - 1) + delta, 1);
  const to = new Date(y, m + delta, 0);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function monthLabel(value: CommissionFiltersValue, locale: string): string {
  const [y, m] = value.from.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

export default function CommissionFiltersBar({
  value,
  onChange,
  reps,
}: {
  value: CommissionFiltersValue;
  onChange: (next: CommissionFiltersValue) => void;
  reps?: RepOption[];
}) {
  const { t, language } = useTranslation();
  const c = t.mobileCommissions;
  const locale = language === 'fr' ? 'fr-CA' : 'en-CA';

  const STATUS_OPTIONS: { value: CommissionStatusFilter; label: string }[] = [
    { value: 'all', label: c.statusAll },
    { value: 'pending', label: c.statusPending },
    { value: 'approved', label: c.statusApproved },
    { value: 'paid', label: c.statusPaid },
    { value: 'reversed', label: c.statusReversed },
  ];

  return (
    <View className="gap-2 rounded-2xl bg-white p-3">
      {/* Month stepper */}
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={() => onChange({ ...value, ...shiftMonth(value, -1) })}
          className="h-8 w-8 items-center justify-center rounded-xl bg-surface-sunken active:opacity-70"
        >
          <SymbolView name="chevron.left" tintColor="#171717" size={13} resizeMode="scaleAspectFit" />
        </Pressable>
        <Text className="text-sm font-semibold capitalize text-ink">{monthLabel(value, locale)}</Text>
        <Pressable
          onPress={() => onChange({ ...value, ...shiftMonth(value, 1) })}
          className="h-8 w-8 items-center justify-center rounded-xl bg-surface-sunken active:opacity-70"
        >
          <SymbolView name="chevron.right" tintColor="#171717" size={13} resizeMode="scaleAspectFit" />
        </Pressable>
      </View>

      {/* Status chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {STATUS_OPTIONS.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => onChange({ ...value, status: o.value })}
            className={`rounded-xl px-3 py-1.5 ${value.status === o.value ? 'bg-ink' : 'bg-surface-sunken'}`}
          >
            <Text className={`text-xs font-semibold ${value.status === o.value ? 'text-white' : 'text-ink-muted'}`}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Rep chips (admin/owner only, mirrors the web rep <select>) */}
      {reps && reps.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <Pressable
            onPress={() => onChange({ ...value, repId: undefined })}
            className={`rounded-xl px-3 py-1.5 ${!value.repId ? 'bg-ink' : 'bg-surface-sunken'}`}
          >
            <Text className={`text-xs font-semibold ${!value.repId ? 'text-white' : 'text-ink-muted'}`}>{c.allReps}</Text>
          </Pressable>
          {reps.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => onChange({ ...value, repId: r.id })}
              className={`rounded-xl px-3 py-1.5 ${value.repId === r.id ? 'bg-ink' : 'bg-surface-sunken'}`}
            >
              <Text className={`text-xs font-semibold ${value.repId === r.id ? 'text-white' : 'text-ink-muted'}`}>
                {r.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
