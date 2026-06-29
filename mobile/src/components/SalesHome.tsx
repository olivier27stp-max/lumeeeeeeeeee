import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, Text, View } from 'react-native';

import { getDoorStats, getLeadPipeline } from '@/lib/api/salesRep';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/usePermissions';

const SHADOW = { shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } } as const;

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Nouveau',
  new_prospect: 'Nouveau',
  contacted: 'Contacté',
  no_response: 'Sans réponse',
  follow_up_1: 'Suivi',
  follow_up_2: 'Suivi',
  follow_up_3: 'Suivi',
  quote_sent: 'Soumission',
  closed: 'Gagné',
  closed_won: 'Gagné',
  won: 'Gagné',
  lost: 'Perdu',
  closed_lost: 'Perdu',
};
const label = (s: string) => STATUS_LABEL[s] ?? s;

function Tile({ label: l, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View className="flex-1 rounded-2xl bg-white p-4" style={SHADOW}>
      <Text className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">{l}</Text>
      <Text className="mt-1 text-xl font-bold" style={{ color: tint ?? '#171717' }}>
        {value}
      </Text>
    </View>
  );
}

/** A big navigation tile in the rep dashboard grid. */
function NavTile({
  icon,
  title,
  subtitle,
  tint,
  href,
}: {
  icon: string;
  title: string;
  subtitle: string;
  tint: string;
  href: string;
}) {
  return (
    <Pressable
      onPress={() => router.push(href as any)}
      className="flex-1 gap-2 rounded-2xl bg-white p-4 active:opacity-70"
      style={SHADOW}
    >
      <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: tint + '18' }}>
        <SymbolView name={icon as any} tintColor={tint} size={20} resizeMode="scaleAspectFit" />
      </View>
      <Text className="text-base font-bold text-ink">{title}</Text>
      <Text className="text-xs text-ink-muted">{subtitle}</Text>
    </Pressable>
  );
}

export default function SalesHome() {
  const { orgId, role } = usePermissions();
  const { session } = useAuth();
  const isRep = role === 'sales_rep';
  const me = session?.user.id ?? '';
  const scopeUser = isRep ? me : null; // rep = own data, manager = whole org

  const doorQ = useQuery({
    queryKey: ['sales', 'door', orgId, scopeUser],
    queryFn: () => getDoorStats(orgId ?? '', scopeUser, startOfToday()),
    enabled: !!orgId,
  });
  const pipeQ = useQuery({
    queryKey: ['sales', 'pipe', orgId, scopeUser],
    queryFn: () => getLeadPipeline(orgId ?? '', scopeUser),
    enabled: !!orgId,
  });

  const d = doorQ.data ?? { knocks: 0, leads: 0, sales: 0, total: 0 };
  const conv = d.knocks > 0 ? Math.round((d.sales / d.knocks) * 100) : 0;
  const pipe = pipeQ.data ?? [];
  const totalLeads = pipe.reduce((s, b) => s + b.count, 0);

  return (
    <View className="gap-3 px-5 pt-4">
      <Text className="text-2xl font-bold text-ink">Aujourd&apos;hui</Text>
      <View className="flex-row gap-3">
        <Tile label="Portes" value={String(d.knocks)} />
        <Tile label="Leads" value={String(d.leads)} tint="#CA8A04" />
        <Tile label="Ventes" value={String(d.sales)} tint="#16A34A" />
      </View>

      <View className="rounded-2xl bg-ink p-4" style={SHADOW}>
        <Text className="text-[11px] font-bold uppercase tracking-widest text-white/60">Taux de conversion</Text>
        <Text className="text-3xl font-bold text-white">{conv}%</Text>
        <Text className="text-sm text-white/70">
          {d.sales} ventes / {d.knocks} portes
        </Text>
      </View>

      {/* Primary action — the map */}
      <Pressable
        onPress={() => router.push('/(app)/(tabs)/d2d' as any)}
        className="flex-row items-center gap-3 rounded-2xl bg-white p-4"
        style={SHADOW}
      >
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-brand/10">
          <SymbolView name="map.fill" tintColor="#2563EB" size={22} resizeMode="scaleAspectFit" />
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold text-ink">Carte D2D / territoire</Text>
          <Text className="text-sm text-ink-muted">Cogner aux portes</Text>
        </View>
        <SymbolView name="chevron.right" tintColor="#A3A3A3" size={14} resizeMode="scaleAspectFit" />
      </Pressable>

      {/* Navigation grid — the real "pages" of rep mode */}
      <View className="flex-row gap-3">
        <NavTile icon="trophy.fill" title="Classement" subtitle="Podium & rangs" tint="#F59E0B" href="/(app)/leaderboard" />
        <NavTile icon="dollarsign.circle.fill" title="Commissions" subtitle="Mes gains" tint="#16A34A" href="/(app)/commissions" />
      </View>
      <View className="flex-row gap-3">
        <NavTile icon="person.crop.rectangle.stack.fill" title="Pipeline" subtitle={`${totalLeads} leads`} tint="#2563EB" href="/(app)/leads" />
        <NavTile icon="rosette" title="Défis & badges" subtitle="Défis · duels" tint="#D97706" href="/(app)/gamification" />
      </View>

      {me ? (
        <Pressable
          onPress={() => router.push(`/(app)/rep/${me}` as any)}
          className="flex-row items-center gap-3 rounded-2xl bg-white p-4"
          style={SHADOW}
        >
          <View className="h-10 w-10 items-center justify-center rounded-xl bg-ink/10">
            <SymbolView name="person.fill" tintColor="#171717" size={20} resizeMode="scaleAspectFit" />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-ink">Mon profil vente</Text>
            <Text className="text-sm text-ink-muted">Badges, stats, ventes par mois</Text>
          </View>
          <SymbolView name="chevron.right" tintColor="#A3A3A3" size={14} resizeMode="scaleAspectFit" />
        </Pressable>
      ) : null}

      {/* Pipeline snapshot */}
      <View className="flex-row items-baseline justify-between pt-1">
        <Text className="text-lg font-bold text-ink">{isRep ? 'Mon pipeline' : 'Pipeline'}</Text>
        <Pressable onPress={() => router.push('/(app)/leads' as any)}>
          <Text className="text-sm font-semibold text-brand">Tout voir</Text>
        </Pressable>
      </View>
      {pipe.length === 0 ? (
        <View className="items-center rounded-2xl bg-white p-6" style={SHADOW}>
          <Text className="text-sm text-ink-muted">Aucun lead.</Text>
        </View>
      ) : (
        <View className="rounded-2xl bg-white px-3 py-1" style={SHADOW}>
          {pipe.map((b, i) => (
            <View
              key={b.status}
              className={`flex-row items-center justify-between py-2.5 ${i > 0 ? 'border-t border-surface-border' : ''}`}
            >
              <Text className="text-base text-ink">{label(b.status)}</Text>
              <Text className="text-base font-bold text-ink">{b.count}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
