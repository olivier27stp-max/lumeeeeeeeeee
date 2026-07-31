import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import { AlertCircle, Loader2, MapPin } from 'lucide-react';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';

/** Structured address returned when user picks a suggestion. */
export interface StructuredAddress {
  formatted_address: string;
  street_number: string;
  street_name: string;
  city: string;
  province: string;
  postal_code: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  place_id: string;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (address: StructuredAddress) => void;
  duplicateWarning?: string | null;
  className?: string;
  placeholder?: string;
  restrictCountries?: string[];
  /** Hide the missing-key / load-error hints (public-facing forms). */
  hideStatusHint?: boolean;
}

// ── Error boundary (function wrapper) ──
function AddressErrorBoundary({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const [hasError, setHasError] = useState(false);
  // Reset error state when children change
  useEffect(() => { setHasError(false); }, [children]);
  if (hasError) return <>{fallback}</>;
  return (
    <ErrorCatcher onError={() => setHasError(true)}>
      {children}
    </ErrorCatcher>
  );
}

// Minimal class error boundary (workaround for tsconfig class field issues)
const ErrorCatcher = (() => {
  function EC(this: any, props: any) {
    React.Component.call(this, props);
    this.state = { hasError: false };
  }
  EC.prototype = Object.create(React.Component.prototype);
  EC.prototype.constructor = EC;
  EC.getDerivedStateFromError = () => ({ hasError: true });
  EC.prototype.componentDidCatch = function(err: any) {
    console.error('[AddressAutocomplete]', err);
    this.props.onError?.();
  };
  EC.prototype.render = function() {
    return this.state.hasError ? null : this.props.children;
  };
  return EC as any as React.ComponentType<{ children: React.ReactNode; onError: () => void }>;
})()

// ── Google Maps script loader (inline, no separate hook needed) ──
const SCRIPT_ID = 'google-maps-places';
type ScriptStatus = 'idle' | 'loading' | 'ready' | 'error';

function useGooglePlaces() {
  const [status, setStatus] = useState<ScriptStatus>(() => {
    try { if (window.google?.maps?.places) return 'ready'; } catch { /* */ }
    return 'idle';
  });

  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '') as string;

  useEffect(() => {
    if (!apiKey) { setStatus('error'); return; }
    try { if (window.google?.maps?.places) { setStatus('ready'); return; } } catch { /* */ }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      // Script tag already in DOM — poll until ready
      const id = setInterval(() => {
        try { if (window.google?.maps?.places) { setStatus('ready'); clearInterval(id); } } catch { /* */ }
      }, 200);
      return () => clearInterval(id);
    }

    setStatus('loading');
    const s = document.createElement('script');
    s.id = SCRIPT_ID;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&v=weekly&loading=async`;
    s.async = true;
    s.onload = () => {
      // The script might not expose google.maps.places immediately
      const id = setInterval(() => {
        try {
          if (window.google?.maps?.places) { setStatus('ready'); clearInterval(id); }
        } catch { /* */ }
      }, 100);
      setTimeout(() => { clearInterval(id); setStatus((prev) => prev === 'ready' ? prev : 'error'); }, 10000);
    };
    s.onerror = () => setStatus('error');
    document.head.appendChild(s);
  }, [apiKey]);

  return { isReady: status === 'ready', isLoading: status === 'loading' || status === 'idle', isError: status === 'error', hasKey: Boolean(apiKey) };
}

// ── Org location bias ──
// Suggestions are biased around the company's address (company_settings) so
// nearby streets rank first. Geocoded once per session; anonymous visitors
// (public request form) simply get no bias — Google falls back to IP bias.
const ORG_GEO_CACHE_KEY = 'lume:org-geo';
let orgBiasPromise: Promise<{ lat: number; lng: number } | null> | null = null;

function getOrgLocationBias(): Promise<{ lat: number; lng: number } | null> {
  if (!orgBiasPromise) {
    orgBiasPromise = (async () => {
      try {
        const cached = sessionStorage.getItem(ORG_GEO_CACHE_KEY);
        if (cached) return JSON.parse(cached);
        const orgId = await getCurrentOrgIdOrThrow();
        const { data } = await supabase
          .from('company_settings')
          .select('street1, city, province, postal_code')
          .eq('org_id', orgId)
          .limit(1)
          .maybeSingle();
        const query = [data?.street1, data?.city, data?.province, data?.postal_code]
          .filter(Boolean).join(', ').trim();
        if (!query) return null;
        const geocoder = new window.google.maps.Geocoder();
        const res = await geocoder.geocode({ address: query });
        const loc = res.results?.[0]?.geometry?.location;
        if (!loc) return null;
        const point = { lat: loc.lat(), lng: loc.lng() };
        sessionStorage.setItem(ORG_GEO_CACHE_KEY, JSON.stringify(point));
        return point;
      } catch {
        return null;
      }
    })();
  }
  return orgBiasPromise;
}

// ── Suggestion fetching ──
// Uses the new Places Autocomplete Data API (AutocompleteSuggestion) when the
// key supports it, falling back to the legacy AutocompleteService otherwise.
// We render our own dropdown: the input stays a plain controlled input, so
// Google can never hijack or disable it (the old widget did exactly that when
// a Places request failed, freezing the field after a few keystrokes).
interface SuggestionItem {
  placeId: string;
  main: string;
  secondary: string;
  /** New-API prediction object (has .toPlace()) — null for legacy results. */
  prediction: any | null;
}

const BIAS_RADIUS_METERS = 50000;
const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 250;

async function fetchSuggestions(
  input: string,
  countries: string[],
  sessionToken: any,
  language: string,
): Promise<SuggestionItem[]> {
  const places: any = window.google?.maps?.places;
  if (!places) return [];
  const bias = await getOrgLocationBias();

  if (places.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
    const req: any = {
      input,
      sessionToken,
      includedRegionCodes: countries,
      language,
    };
    if (bias) req.locationBias = { center: bias, radius: BIAS_RADIUS_METERS };
    const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
    return (suggestions || [])
      .map((s: any) => {
        const p = s.placePrediction;
        if (!p) return null;
        return {
          placeId: p.placeId,
          main: p.mainText?.text || p.text?.text || '',
          secondary: p.secondaryText?.text || '',
          prediction: p,
        };
      })
      .filter(Boolean) as SuggestionItem[];
  }

  // Legacy fallback
  const svc = new places.AutocompleteService();
  const req: any = {
    input,
    sessionToken,
    types: ['address'],
    componentRestrictions: { country: countries },
  };
  if (bias) {
    req.location = new window.google.maps.LatLng(bias.lat, bias.lng);
    req.radius = BIAS_RADIUS_METERS;
  }
  const preds = await new Promise<any[]>((resolve) => {
    svc.getPlacePredictions(req, (results: any, status: any) => {
      resolve(status === 'OK' && results ? results : []);
    });
  });
  return preds.map((p: any) => ({
    placeId: p.place_id,
    main: p.structured_formatting?.main_text || p.description || '',
    secondary: p.structured_formatting?.secondary_text || '',
    prediction: null,
  }));
}

async function resolvePlace(item: SuggestionItem): Promise<StructuredAddress | null> {
  try {
    if (item.prediction?.toPlace) {
      const place = item.prediction.toPlace();
      await place.fetchFields({ fields: ['addressComponents', 'formattedAddress', 'location', 'id'] });
      const comps: any[] = place.addressComponents || [];
      const get = (type: string) => comps.find((c) => (c.types || []).includes(type))?.longText || '';
      return {
        formatted_address: place.formattedAddress || '',
        street_number: get('street_number'),
        street_name: get('route'),
        city: get('locality') || get('sublocality') || get('postal_town'),
        province: get('administrative_area_level_1'),
        postal_code: get('postal_code'),
        country: get('country'),
        latitude: place.location?.lat() ?? null,
        longitude: place.location?.lng() ?? null,
        place_id: place.id || item.placeId,
      };
    }
    // Legacy: resolve details through the Geocoder (no DOM node needed).
    const geocoder = new window.google.maps.Geocoder();
    const res = await geocoder.geocode({ placeId: item.placeId });
    const r = res.results?.[0];
    if (!r) return null;
    const get = (type: string) => r.address_components?.find((c) => c.types.includes(type))?.long_name || '';
    const loc = r.geometry?.location;
    return {
      formatted_address: r.formatted_address || '',
      street_number: get('street_number'),
      street_name: get('route'),
      city: get('locality') || get('sublocality') || get('postal_town'),
      province: get('administrative_area_level_1'),
      postal_code: get('postal_code'),
      country: get('country'),
      latitude: loc ? loc.lat() : null,
      longitude: loc ? loc.lng() : null,
      place_id: item.placeId,
    };
  } catch (err) {
    console.error('[AddressAutocomplete] place details error:', err);
    return null;
  }
}

// ── Main component ──
function AddressAutocompleteInner({
  value, onChange, onSelect, duplicateWarning, className, placeholder, restrictCountries, hideStatusHint,
}: AddressAutocompleteProps) {
  const { t, language } = useTranslation();
  const { isReady, isLoading, isError, hasKey } = useGooglePlaces();
  const inputRef = useRef<HTMLInputElement>(null);
  const cbRef = useRef({ onChange, onSelect });
  cbRef.current = { onChange, onSelect };
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [fetching, setFetching] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const tokenRef = useRef<any>(null);
  const requestSeqRef = useRef(0);
  const suppressFetchRef = useRef(false);
  const countriesRef = useRef(restrictCountries);
  countriesRef.current = restrictCountries;

  // Debounced suggestion fetch on user input
  useEffect(() => {
    if (!isReady || !focused) return;
    if (suppressFetchRef.current) { suppressFetchRef.current = false; return; }
    const query = value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([]); setOpen(false); setNoResults(false);
      return;
    }
    const seq = ++requestSeqRef.current;
    const timer = setTimeout(async () => {
      try {
        if (!tokenRef.current) {
          const Token = (window.google?.maps?.places as any)?.AutocompleteSessionToken;
          tokenRef.current = Token ? new Token() : null;
        }
        setFetching(true);
        const items = await fetchSuggestions(query, countriesRef.current || ['ca'], tokenRef.current, language);
        if (seq !== requestSeqRef.current) return; // stale response
        setSuggestions(items);
        setActiveIdx(-1);
        setNoResults(items.length === 0);
        setOpen(true);
      } catch (err) {
        if (seq === requestSeqRef.current) { setSuggestions([]); setOpen(false); }
        console.error('[AddressAutocomplete] suggestions error:', err);
      } finally {
        if (seq === requestSeqRef.current) setFetching(false);
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); };
  }, [value, isReady, focused, language]);

  async function pick(item: SuggestionItem) {
    setOpen(false);
    setSuggestions([]);
    setNoResults(false);
    suppressFetchRef.current = true;
    cbRef.current.onChange(item.secondary ? `${item.main}, ${item.secondary}` : item.main);
    const addr = await resolvePlace(item);
    tokenRef.current = null; // session consumed by the details call
    if (!addr) return;
    suppressFetchRef.current = true;
    cbRef.current.onChange(addr.formatted_address);
    cbRef.current.onSelect(addr);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (e.key === 'Escape') setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0 && activeIdx < suggestions.length) {
        e.preventDefault();
        void pick(suggestions[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  // Fallback label for missing key or error
  const hint = hideStatusHint ? null : !hasKey ? t.address.apiKeyMissing : isError ? t.address.loadError : null;

  return (
    <div>
      <div className="relative">
        <MapPin size={14} className={cn('pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 transition-colors', focused ? 'text-primary' : 'text-text-tertiary')} />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); setOpen(false); }}
          onKeyDown={onKeyDown}
          className={cn('glass-input w-full pl-9', className)}
          placeholder={placeholder || t.address.placeholder}
          autoComplete="new-password"
          name="address-search-no-autofill"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {((isLoading && hasKey) || fetching) && (
          <Loader2 size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-text-tertiary" />
        )}
        {open && (suggestions.length > 0 || noResults) && (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-outline bg-surface shadow-lg"
            // Keep input focus while clicking inside the dropdown
            onMouseDown={(e) => e.preventDefault()}
            role="listbox"
          >
            {suggestions.map((s, i) => (
              <button
                key={s.placeId}
                type="button"
                role="option"
                aria-selected={i === activeIdx}
                onClick={() => void pick(s)}
                onMouseEnter={() => setActiveIdx(i)}
                className={cn(
                  'flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors',
                  i === activeIdx ? 'bg-surface-secondary' : 'bg-transparent',
                )}
              >
                <MapPin size={13} className="mt-0.5 shrink-0 text-text-tertiary" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-text-primary">{s.main}</span>
                  {s.secondary && <span className="block truncate text-[11px] text-text-tertiary">{s.secondary}</span>}
                </span>
              </button>
            ))}
            {noResults && (
              <p className="px-3 py-2 text-[12px] text-text-tertiary">{t.address.noResults}</p>
            )}
            {/* Attribution required when showing Places results without a map */}
            <p className="border-t border-outline px-3 py-1 text-right text-[10px] text-text-tertiary">
              powered by Google
            </p>
          </div>
        )}
      </div>
      {hint && (
        <p className={cn('mt-1 flex items-center gap-1 text-[11px]', isError && hasKey ? 'text-danger' : 'text-text-tertiary')}>
          <AlertCircle size={11} /> {hint}
        </p>
      )}
      {duplicateWarning && (
        <p className="mt-1.5 flex items-center gap-1.5 rounded-md bg-warning-light px-2.5 py-1.5 text-[11px] font-medium text-warning">
          <AlertCircle size={12} className="shrink-0" /> {duplicateWarning}
        </p>
      )}
    </div>
  );
}

// ── Exported wrapper with error boundary ──
export default function AddressAutocomplete(props: AddressAutocompleteProps) {
  const { t } = useTranslation();
  const fallback = (
    <div>
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className={cn('glass-input w-full', props.className)}
        placeholder={props.placeholder || t.address.placeholder}
      />
      {!props.hideStatusHint && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-danger">
          <AlertCircle size={11} /> {t.address.loadError}
        </p>
      )}
    </div>
  );
  return (
    <AddressErrorBoundary fallback={fallback}>
      <AddressAutocompleteInner {...props} />
    </AddressErrorBoundary>
  );
}
