import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { usePermissions } from '@/lib/usePermissions';

// The same floating "+" create menu used on the technician Home, extracted so
// the rep Schedule (Horaire) can offer it too: New job / client / quote / invoice.
export function CreateMenuFab() {
  const { can, canSeePricing } = usePermissions();
  const [open, setOpen] = useState(false);

  const options: { label: string; icon: string; route: string }[] = [];
  if (can('jobs.create')) options.push({ label: 'Nouveau job', icon: 'wrench.and.screwdriver', route: '/(app)/jobs/new' });
  if (can('clients.create')) options.push({ label: 'Nouveau client', icon: 'person.badge.plus', route: '/(app)/clients/new' });
  if (can('quotes.create') || canSeePricing) options.push({ label: 'Nouvelle soumission', icon: 'doc.text', route: '/(app)/quotes/new' });
  if (can('invoices.create') || canSeePricing) options.push({ label: 'Nouvelle facture', icon: 'dollarsign.circle', route: '/(app)/invoices/new' });

  if (options.length === 0) return null;

  const go = (route: string) => {
    setOpen(false);
    router.push(route as any);
  };

  return (
    <>
      {open ? <Pressable className="absolute inset-0" onPress={() => setOpen(false)} /> : null}

      {open ? (
        <View
          className="absolute bottom-24 right-6 w-56 overflow-hidden rounded-2xl bg-white"
          style={{ shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }}
        >
          {options.map((o) => (
            <Pressable
              key={o.route}
              onPress={() => go(o.route)}
              className="flex-row items-center gap-3 border-b border-surface-border px-4 py-3.5 active:bg-surface-sunken"
            >
              <SymbolView name={o.icon as any} tintColor="#171717" size={18} resizeMode="scaleAspectFit" />
              <Text className="text-base text-ink">{o.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Pressable
        onPress={() => setOpen((o) => !o)}
        className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-ink"
        style={{ shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}
      >
        <SymbolView name={open ? 'xmark' : 'plus'} tintColor="#FFFFFF" size={24} resizeMode="scaleAspectFit" />
      </Pressable>
    </>
  );
}
