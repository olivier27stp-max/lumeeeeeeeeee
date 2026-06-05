import { Text, View } from 'react-native';

type Props = { status: string };

const styles: Record<string, { bg: string; text: string; label: string }> = {
  scheduled: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Scheduled' },
  in_progress: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'In Progress' },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Completed' },
  cancelled: { bg: 'bg-slate-200', text: 'text-slate-700', label: 'Cancelled' },
  draft: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Draft' },
};

export function StatusPill({ status }: Props) {
  const s = styles[status] ?? { bg: 'bg-slate-100', text: 'text-slate-700', label: status };
  return (
    <View className={`px-2.5 py-1 rounded-full self-start ${s.bg}`}>
      <Text className={`text-xs font-semibold ${s.text}`}>{s.label}</Text>
    </View>
  );
}
