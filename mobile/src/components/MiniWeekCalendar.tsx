import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Compact version of the Schedule week strip — pick a day, see which have jobs. */
export function MiniWeekCalendar({
  selected,
  onSelect,
  counts,
}: {
  selected: Date;
  onSelect: (d: Date) => void;
  counts?: (d: Date) => number;
}) {
  const today = useMemo(() => new Date(), []);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(selected));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const monthLabel = weekStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <View className="rounded-2xl bg-white p-3">
      <View className="mb-2 flex-row items-center justify-between">
        <Pressable onPress={() => setWeekStart((w) => addDays(w, -7))} className="h-7 w-7 items-center justify-center rounded-full bg-surface-sunken">
          <SymbolView name="chevron.left" tintColor="#171717" size={12} resizeMode="scaleAspectFit" />
        </Pressable>
        <Text className="text-xs font-semibold capitalize text-ink">{monthLabel}</Text>
        <Pressable onPress={() => setWeekStart((w) => addDays(w, 7))} className="h-7 w-7 items-center justify-center rounded-full bg-surface-sunken">
          <SymbolView name="chevron.right" tintColor="#171717" size={12} resizeMode="scaleAspectFit" />
        </Pressable>
      </View>
      <View className="flex-row justify-between">
        {days.map((d, i) => {
          const isSel = sameDay(d, selected);
          const isToday = sameDay(d, today);
          const n = counts ? counts(d) : 0;
          return (
            <Pressable key={d.toISOString()} onPress={() => onSelect(d)} className={`w-9 items-center rounded-xl py-1.5 ${isSel ? 'bg-ink' : ''}`}>
              <Text className={`text-[10px] font-medium ${isSel ? 'text-white' : 'text-ink-subtle'}`}>{DAY_ABBR[i]}</Text>
              <Text className={`mt-0.5 text-sm font-bold ${isSel ? 'text-white' : 'text-ink'}`}>{d.getDate()}</Text>
              <View style={{ width: 4, height: 4, borderRadius: 2, marginTop: 2 }} className={n > 0 ? (isSel ? 'bg-white' : 'bg-ink') : 'bg-transparent'} />
              {isToday && !isSel ? <View className="absolute bottom-0.5 h-0.5 w-3 rounded-full bg-ink" /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
