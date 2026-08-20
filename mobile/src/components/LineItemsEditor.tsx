import { useQuery } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Input } from '@/components/ui/Input';
import { LineItemInput } from '@/lib/api/billing';
import { listServices } from '@/lib/api/services';
import { useTranslation } from '@/lib/i18n';
import { usePermissions } from '@/lib/usePermissions';

type Row = { id: string; name: string; qty: string; price: string };

let counter = 0;
const newRow = (name = '', price = ''): Row => ({ id: `r${counter++}`, name, qty: '1', price });

export function LineItemsEditor({
  onChange,
  seed,
  seedKey,
}: {
  onChange: (items: LineItemInput[]) => void;
  /** Pre-fill the editor (e.g. invoice from a job). Re-seeds when seedKey changes. */
  seed?: LineItemInput[];
  seedKey?: string;
}) {
  const { t } = useTranslation();
  const c = t.mobileComp;
  const { orgId } = usePermissions();
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');

  useEffect(() => {
    if (!seedKey) return;
    if (seed && seed.length) {
      setRows(
        seed.map((s) => ({
          id: `r${counter++}`,
          name: s.name,
          qty: String(s.qty || 1),
          price: (s.unit_price_cents / 100).toFixed(2),
        })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const { data: services } = useQuery({
    queryKey: ['services', orgId, catalogSearch],
    queryFn: () => listServices(orgId ?? '', catalogSearch),
    enabled: catalogOpen && !!orgId,
  });

  // Ne rien remonter au tout premier rendu : l'ensemencement n'a pas encore eu
  // lieu, et un onChange([]) écraserait la liste du parent. C'est ce qui vidait
  // les services d'une visite au moment d'en choisir une autre, puisque
  // l'éditeur est remonté à chaque changement de visite.
  const premierRendu = useRef(true);
  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false;
      if (seedKey) return;
    }
    const items: LineItemInput[] = rows
      .filter((r) => r.name.trim() || r.price.trim())
      .map((r) => ({
        name: r.name.trim(),
        qty: parseFloat(r.qty) || 0,
        unit_price_cents: Math.round((parseFloat(r.price) || 0) * 100),
      }));
    onChange(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const update = (id: string, k: keyof Row, v: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const remove = (id: string) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  const addFromService = (name: string, priceCents: number) => {
    setRows((rs) => {
      const blank = rs.find((r) => !r.name.trim() && !r.price.trim());
      const filled = newRow(name, (priceCents / 100).toFixed(2));
      return blank ? rs.map((r) => (r.id === blank.id ? { ...filled, id: r.id } : r)) : [...rs, filled];
    });
    setCatalogOpen(false);
    setCatalogSearch('');
  };

  return (
    <View className="gap-2">
      <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{c.items}</Text>

      {rows.map((r) => (
        <View key={r.id} className="gap-2 rounded-2xl border border-surface-border bg-white p-3">
          <View className="flex-row items-center gap-2">
            <TextInput
              value={r.name}
              onChangeText={(v) => update(r.id, 'name', v)}
              placeholder={c.itemService}
              placeholderTextColor="#A3A3A3"
              className="flex-1 text-base text-ink"
            />
            <Pressable onPress={() => remove(r.id)} className="p-1">
              <SymbolView name="trash" tintColor="#DC2626" size={16} resizeMode="scaleAspectFit" />
            </Pressable>
          </View>
          <View className="flex-row gap-2">
            <View className="w-20">
              <Text className="mb-0.5 text-[11px] text-ink-subtle">{c.qty}</Text>
              <TextInput value={r.qty} onChangeText={(v) => update(r.id, 'qty', v)} keyboardType="decimal-pad" className="rounded-lg border border-surface-border px-2 py-1.5 text-sm text-ink" />
            </View>
            <View className="flex-1">
              <Text className="mb-0.5 text-[11px] text-ink-subtle">{c.unitPrice}</Text>
              <TextInput value={r.price} onChangeText={(v) => update(r.id, 'price', v)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#A3A3A3" className="rounded-lg border border-surface-border px-2 py-1.5 text-sm text-ink" />
            </View>
          </View>
        </View>
      ))}

      <View className="flex-row gap-2">
        <Pressable
          onPress={() => setRows((rs) => [...rs, newRow()])}
          className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl border border-dashed border-surface-border py-3"
        >
          <SymbolView name="plus" tintColor="#171717" size={14} resizeMode="scaleAspectFit" />
          <Text className="text-sm font-medium text-ink">{c.customItem}</Text>
        </Pressable>
        <Pressable
          onPress={() => setCatalogOpen((o) => !o)}
          className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl border border-dashed border-surface-border py-3"
        >
          <SymbolView name="square.grid.2x2" tintColor="#171717" size={14} resizeMode="scaleAspectFit" />
          <Text className="text-sm font-medium text-ink">{c.fromCatalog}</Text>
        </Pressable>
      </View>

      {catalogOpen ? (
        <View className="gap-2 rounded-2xl border border-surface-border bg-white p-3">
          <Input label={c.searchService} value={catalogSearch} onChangeText={setCatalogSearch} placeholder={c.serviceNamePlaceholder} />
          {(services ?? []).map((s) => (
            <Pressable
              key={s.id}
              onPress={() => addFromService(s.name, s.default_price_cents)}
              className="flex-row items-center justify-between gap-3 border-b border-surface-border py-2.5"
            >
              {/* Nom, puis la description du service en sous-titre — comme le
                  sélecteur du web, qui l'affiche sous le nom. */}
              <View className="flex-1">
                <Text className="text-sm text-ink" numberOfLines={1}>{s.name}</Text>
                {s.description ? (
                  <Text className="pt-0.5 text-xs text-ink-subtle" numberOfLines={2}>{s.description}</Text>
                ) : null}
              </View>
              <Text className="text-sm text-ink-muted">${(s.default_price_cents / 100).toFixed(2)}</Text>
            </Pressable>
          ))}
          {(services?.length ?? 0) === 0 ? (
            <Text className="py-2 text-xs text-ink-subtle">{c.noServiceFound}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
