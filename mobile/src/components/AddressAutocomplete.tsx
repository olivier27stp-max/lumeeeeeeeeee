import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Input } from '@/components/ui/Input';

export type PickedAddress = {
  address: string;
  city?: string;
  province?: string;
  postal_code?: string;
  country?: string;
  lat?: number;
  lng?: number;
};

type Suggestion = {
  display_name: string;
  lat: string;
  lon: string;
  address?: Record<string, string>;
};

/** Free address autocomplete via OpenStreetMap (Nominatim) — no API key. */
export function AddressAutocomplete({
  label = 'Address',
  value,
  onChangeText,
  onSelect,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  onSelect: (a: PickedAddress) => void;
}) {
  const [results, setResults] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Geographic bias so suggestions favour the user's region, not the whole world.
  const bias = useRef<{ lat: number; lng: number; country?: string } | null>(null);

  // Resolve the device location once (no prompt — reuses the tracking grant) to
  // get a country + a bounding box centred on the user.
  useEffect(() => {
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        let pos = await Location.getLastKnownPositionAsync();
        if (!pos) pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
        if (!pos) return;
        const { latitude, longitude } = pos.coords;
        let country: string | undefined;
        try {
          const geo = await Location.reverseGeocodeAsync({ latitude, longitude });
          country = geo[0]?.isoCountryCode?.toLowerCase() || undefined;
        } catch {
          /* reverse-geocode is best-effort */
        }
        bias.current = { lat: latitude, lng: longitude, country };
      } catch {
        /* no location → fall back to unbiased search */
      }
    })();
  }, []);

  useEffect(() => {
    if (!open) return;
    if (value.trim().length < 4) {
      setResults([]);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        let url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(value)}`;
        const b = bias.current;
        if (b) {
          // Prefer a ~1.5° box around the user (bounded=0 = bias, not hard limit)…
          const d = 1.5;
          url += `&viewbox=${b.lng - d},${b.lat - d},${b.lng + d},${b.lat + d}&bounded=0`;
          // …and keep results within their country to drop worldwide noise.
          if (b.country) url += `&countrycodes=${b.country}`;
        }
        const res = await fetch(url, { headers: { 'User-Agent': 'LumeCRM-Mobile/1.0', Accept: 'application/json' } });
        const json = (await res.json()) as Suggestion[];
        setResults(Array.isArray(json) ? json : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 600);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [value, open]);

  const pick = (s: Suggestion) => {
    const a = s.address ?? {};
    const picked: PickedAddress = {
      address: s.display_name,
      city: a.city || a.town || a.village || a.municipality,
      province: a.state || a.province,
      postal_code: a.postcode,
      country: a.country,
      lat: parseFloat(s.lat),
      lng: parseFloat(s.lon),
    };
    onChangeText(s.display_name);
    onSelect(picked);
    setResults([]);
    setOpen(false);
  };

  return (
    <View className="gap-1">
      <Input
        label={label}
        value={value}
        onChangeText={(v) => {
          onChangeText(v);
          setOpen(true);
        }}
        placeholder="Start typing an address…"
        autoCapitalize="words"
      />
      {loading ? <ActivityIndicator color="#A3A3A3" style={{ alignSelf: 'flex-start' }} /> : null}
      {open && results.length > 0 ? (
        <View className="overflow-hidden rounded-xl border border-surface-border bg-white">
          {results.map((s, i) => (
            <Pressable
              key={`${s.lat}-${s.lon}-${i}`}
              onPress={() => pick(s)}
              className="border-b border-surface-border px-3 py-2.5 active:bg-surface-sunken"
            >
              <Text className="text-sm text-ink" numberOfLines={2}>
                {s.display_name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
