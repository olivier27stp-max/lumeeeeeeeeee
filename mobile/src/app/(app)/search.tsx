import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { ClientCard } from '@/components/ClientCard';
import {
  IconAgreement, IconClient, IconEvent, IconInvoice, IconJob, IconLead,
  IconPayment, IconProperty, IconQuote, IconRequest, IconTeam,
} from '@/components/EntityIcons';
import { Input } from '@/components/ui/Input';
import { StatusPill } from '@/components/ui/StatusPill';
import { listClients } from '@/lib/api/clients';
import {
  ALL_ENTITY_GROUP_KEYS,
  EntityGroupKey,
  SearchEntityItem,
  fetchSearchSuggestions,
  fullSearchAvailable,
  searchItemRoute,
} from '@/lib/api/search';
import { formatCurrencyCents } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';

type IconFn = (p: { color: string; size?: number }) => React.ReactElement;

// Same glyph per entity as the web's global search (GlobalSearch.tsx).
const GROUP_ICON: Record<EntityGroupKey, IconFn> = {
  clients: IconClient,
  properties: IconProperty,
  jobs: IconJob,
  agreements: IconAgreement,
  payments: IconPayment,
  leads: IconLead,
  invoices: IconInvoice,
  quotes: IconQuote,
  requests: IconRequest,
  teams: IconTeam,
  events: IconEvent,
};

type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'item'; key: string; group: EntityGroupKey; item: SearchEntityItem };

export default function Search() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');

  // Debounced: the server route runs search_global plus a relationship
  // expansion, so firing it on every keystroke is wasteful.
  useEffect(() => {
    const id = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const canFull = fullSearchAvailable();

  const searchQ = useQuery({
    queryKey: ['search', 'all', term],
    queryFn: () => fetchSearchSuggestions(term, 8),
    enabled: canFull && term.length >= 1,
    staleTime: 0,
    gcTime: 0,
    retry: 0,
  });

  // Degraded mode: no server URL configured, or the call failed (offline).
  // Rather than showing nothing, fall back to the client-only search this
  // screen used to be.
  const degraded = term.length >= 1 && (!canFull || !!searchQ.error);

  const clientsQ = useQuery({
    queryKey: ['clients', 'search', term],
    queryFn: () => listClients(term),
    // Empty query → the screen's resting state: most recent clients.
    enabled: term.length === 0 || degraded,
    staleTime: 0,
    gcTime: 0,
  });

  const rows = useMemo<Row[]>(() => {
    const grouped = searchQ.data?.grouped;
    if (!grouped) return [];
    const label: Record<EntityGroupKey, string> = {
      clients: t.mobileMisc.groupClients,
      properties: t.mobileMisc.groupProperties,
      jobs: t.mobileMisc.groupJobs,
      agreements: t.mobileMisc.groupAgreements,
      payments: t.mobileMisc.groupPayments,
      leads: t.mobileMisc.groupLeads,
      invoices: t.mobileMisc.groupInvoices,
      quotes: t.mobileMisc.groupQuotes,
      requests: t.mobileMisc.groupRequests,
      teams: t.mobileMisc.groupTeams,
      events: t.mobileMisc.groupEvents,
    };
    const out: Row[] = [];
    // Same group order as the desktop.
    for (const key of ALL_ENTITY_GROUP_KEYS) {
      const items = grouped[key] ?? [];
      if (items.length === 0) continue;
      out.push({ kind: 'header', key: `h-${key}`, label: label[key] });
      for (const item of items) {
        out.push({ kind: 'item', key: `${key}-${item.id}`, group: key, item });
      }
    }
    return out;
  }, [searchQ.data, t]);

  const card = 'flex-row items-center gap-3 rounded-2xl bg-white p-3';

  const renderRow = ({ item: row }: { item: Row }) => {
    if (row.kind === 'header') {
      return (
        <Text className="px-1 pb-1 pt-4 text-[11px] font-bold uppercase tracking-widest text-ink-subtle">
          {row.label}
        </Text>
      );
    }

    const { item } = row;
    const Icon = GROUP_ICON[row.group];
    const route = searchItemRoute(item);
    const amount =
      item.amountCents != null ? formatCurrencyCents(item.amountCents, item.currency ?? undefined) : null;

    const body = (
      <>
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-surface-sunken">
          <Icon color="#171717" size={18} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold text-ink" numberOfLines={1}>
            {item.title}
          </Text>
          {item.subtitle || item.clientName ? (
            <Text className="text-sm text-ink-muted" numberOfLines={1}>
              {item.subtitle || item.clientName}
            </Text>
          ) : null}
        </View>
        {amount ? <Text className="text-sm font-semibold text-ink">{amount}</Text> : null}
        {item.status ? <StatusPill status={item.status} /> : null}
      </>
    );

    // No mobile destination → still show the result, but don't pretend it
    // leads somewhere.
    if (!route) return <View className={card}>{body}</View>;

    return (
      <Pressable onPress={() => router.push(route as any)} className={`${card} active:opacity-70`}>
        {body}
      </Pressable>
    );
  };

  // Resting state and degraded fallback both render clients the old way.
  const showClientList = term.length === 0 || degraded;

  return (
    <View className="flex-1 bg-surface-alt">
      <View className="px-5 pb-2 pt-3">
        <Input
          value={q}
          onChangeText={setQ}
          placeholder={canFull ? t.mobileMisc.searchAllPlaceholder : t.mobileMisc.searchClientPlaceholder}
          autoFocus
          autoCapitalize="none"
        />
        <Text className="mt-2 text-xs text-ink-muted">
          {degraded
            ? t.mobileMisc.searchFallbackNotice
            : canFull
              ? t.mobileMisc.searchAllHint
              : t.mobileMisc.searchClientHint}
        </Text>
      </View>

      {showClientList ? (
        <FlatList
          data={clientsQ.data ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 20, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            (clientsQ.data?.length ?? 0) > 0 ? (
              <Text className="pb-2 text-[11px] font-bold uppercase tracking-widest text-ink-subtle">
                {term ? t.mobileMisc.resultsHeader : t.mobileMisc.recentClientsHeader}
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <ClientCard client={item} onPress={() => router.push(`/(app)/clients/${item.id}`)} />
          )}
          ListEmptyComponent={
            term.length >= 1 && !clientsQ.isFetching ? (
              <View className="items-center py-12">
                <Text className="text-sm text-ink-muted">{t.mobileMisc.noClientsFound}</Text>
              </View>
            ) : null
          }
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 8 }}
          keyboardShouldPersistTaps="handled"
          renderItem={renderRow}
          ListEmptyComponent={
            searchQ.isFetching ? (
              <View className="items-center py-12">
                <ActivityIndicator />
              </View>
            ) : (
              <View className="items-center py-12">
                <Text className="text-sm text-ink-muted">
                  {t.mobileMisc.noResultForQuery.replace('{query}', term)}
                </Text>
              </View>
            )
          }
        />
      )}
    </View>
  );
}
