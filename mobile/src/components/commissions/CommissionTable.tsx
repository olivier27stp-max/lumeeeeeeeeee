// Commission entries list — port of the web `components/commissions/CommissionTable`
// (table → cards). Read-only by default; renders the admin approve/reverse
// actions only when `showActions` is true.

import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import type { FsCommissionEntry } from '@/lib/api/commissionsServer';
import { useTranslation } from '@/lib/i18n';

export const STATUS_COLOR: Record<string, string> = {
  pending: '#D97706',
  approved: '#2563EB',
  paid: '#16A34A',
  reversed: '#DC2626',
};

export function fmtMoney(n: number) {
  return '$' + Number(n || 0).toLocaleString('en-US');
}

function fmtDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  const c = t.mobileCommissions;
  const label =
    status === 'pending' ? c.statusPending
    : status === 'approved' ? c.statusApproved
    : status === 'paid' ? c.statusPaid
    : status === 'reversed' ? c.statusReversed
    : status;
  return (
    <View className="rounded-md px-2 py-0.5" style={{ backgroundColor: STATUS_COLOR[status] ?? '#A3A3A3' }}>
      <Text className="text-[10px] font-semibold text-white">{label}</Text>
    </View>
  );
}

interface Props {
  entries: FsCommissionEntry[];
  profileMap: Record<string, string>;
  /** Show the rep identity — true for admin/owner views, false for personal view */
  showRep: boolean;
  /** Show approve/reverse actions — only for owner/admin */
  showActions: boolean;
  actionLoading?: string | null;
  onApprove?: (id: string) => void;
  onReverse?: (id: string) => void;
  emptyMessage?: string;
}

export default function CommissionTable({
  entries,
  profileMap,
  showRep,
  showActions,
  actionLoading,
  onApprove,
  onReverse,
  emptyMessage,
}: Props) {
  const { t, language } = useTranslation();
  const c = t.mobileCommissions;
  const locale = language === 'fr' ? 'fr-CA' : 'en-US';

  if (entries.length === 0) {
    return (
      <View className="items-center py-8">
        <Text className="text-sm text-ink-muted">{emptyMessage ?? c.noEntries}</Text>
      </View>
    );
  }

  return (
    <View>
      {entries.map((e, i) => {
        const repName = profileMap[e.user_id] ?? e.rep_name ?? e.user_id;
        const pct = e.base_amount > 0 ? Math.round((e.amount / e.base_amount) * 100) : 0;
        const busy = actionLoading === e.id;
        return (
          <View key={e.id} className={`gap-2 px-4 py-3 ${i === 0 ? '' : 'border-t border-surface-border'}`}>
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1">
                <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
                  {e.description ?? e.lead_id ?? '—'}
                </Text>
                {showRep ? (
                  <View className="mt-1 flex-row items-center gap-1.5">
                    <UnifiedAvatar id={e.user_id} name={repName} size={16} url={e.rep_avatar ?? undefined} />
                    <Text className="text-xs text-ink-muted" numberOfLines={1}>
                      {repName}
                    </Text>
                  </View>
                ) : null}
                <Text className="mt-0.5 text-[11px] text-ink-subtle">
                  {c.closed} · {fmtDate(e.created_at, locale)}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-base font-bold text-ink">
                  {fmtMoney(e.amount)} <Text className="text-xs font-normal text-ink-subtle">({pct}%)</Text>
                </Text>
                <Text className="text-xs text-ink-muted">
                  {c.dealAmount}: {fmtMoney(e.base_amount)}
                </Text>
                <View className="mt-1">
                  <StatusPill status={e.status} />
                </View>
              </View>
            </View>

            {showActions && (e.status === 'pending' || e.status === 'approved') ? (
              <View className="flex-row justify-end gap-2">
                {e.status === 'pending' && onApprove ? (
                  <Pressable
                    onPress={() => onApprove(e.id)}
                    disabled={busy}
                    className="flex-row items-center gap-1 rounded-xl bg-status-completed/10 px-3 py-1.5 active:opacity-70"
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#16A34A" />
                    ) : (
                      <SymbolView name="checkmark.circle" tintColor="#16A34A" size={13} resizeMode="scaleAspectFit" />
                    )}
                    <Text className="text-xs font-semibold" style={{ color: '#16A34A' }}>
                      {c.approve}
                    </Text>
                  </Pressable>
                ) : null}
                {onReverse ? (
                  <Pressable
                    onPress={() => onReverse(e.id)}
                    disabled={busy}
                    className="flex-row items-center gap-1 rounded-xl px-3 py-1.5 active:opacity-70"
                    style={{ backgroundColor: '#DC262615' }}
                  >
                    <SymbolView name="xmark.circle" tintColor="#DC2626" size={13} resizeMode="scaleAspectFit" />
                    <Text className="text-xs font-semibold" style={{ color: '#DC2626' }}>
                      {c.reverse}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
