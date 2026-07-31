import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import { AlertCircle, Loader2, MapPin } from 'lucide-react';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';

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

// ── Server proxy calls ──
// Suggestions go through our own API (/api/places/*): the browser Google key
// is referer-restricted and broke on new domains, and the legacy Google widget
// used to disable the input outright when its request failed. Server-side the
// key always works, and the org's address biases results to nearby streets.
interface SuggestionItem {
  placeId: string;
  main: string;
  secondary: string;
}

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 250;

async function apiHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
    const activeOrg = localStorage.getItem('lume-active-org') || '';
    if (activeOrg) headers['x-org-id'] = activeOrg;
  } catch { /* unauthenticated (public form) — server will refuse, input stays manual */ }
  return headers;
}

async function fetchSuggestions(
  input: string,
  countries: string[] | undefined,
  sessionToken: string,
  language: string,
): Promise<SuggestionItem[] | null> {
  const res = await fetch('/api/places/autocomplete', {
    method: 'POST',
    headers: await apiHeaders(),
    body: JSON.stringify({ input, countries, sessionToken, language }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return (data?.suggestions || []) as SuggestionItem[];
}

async function resolvePlace(
  placeId: string,
  sessionToken: string,
  language: string,
): Promise<StructuredAddress | null> {
  const res = await fetch('/api/places/details', {
    method: 'POST',
    headers: await apiHeaders(),
    body: JSON.stringify({ placeId, sessionToken, language }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return (data?.address as StructuredAddress) || null;
}

// ── Main component ──
function AddressAutocompleteInner({
  value, onChange, onSelect, duplicateWarning, className, placeholder, restrictCountries, hideStatusHint,
}: AddressAutocompleteProps) {
  const { t, language } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  // Chrome keys its native autofill history on the field's name; a per-mount
  // random name orphans that history so the browser popup never appears over
  // our own dropdown.
  const fieldNameRef = useRef(`addr-${Math.random().toString(36).slice(2, 10)}`);
  const cbRef = useRef({ onChange, onSelect });
  cbRef.current = { onChange, onSelect };
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [fetching, setFetching] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const tokenRef = useRef<string>('');
  const requestSeqRef = useRef(0);
  const suppressFetchRef = useRef(false);
  const countriesRef = useRef(restrictCountries);
  countriesRef.current = restrictCountries;

  // Debounced suggestion fetch on user input
  useEffect(() => {
    if (!focused) return;
    if (suppressFetchRef.current) { suppressFetchRef.current = false; return; }
    const query = value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([]); setOpen(false); setNoResults(false);
      return;
    }
    const seq = ++requestSeqRef.current;
    const timer = setTimeout(async () => {
      try {
        if (!tokenRef.current) tokenRef.current = crypto.randomUUID();
        setFetching(true);
        const items = await fetchSuggestions(query, countriesRef.current, tokenRef.current, language);
        if (seq !== requestSeqRef.current) return; // stale response
        if (items === null) {
          // Server refused (not configured / not authed) — degrade to manual input
          setUnavailable(true);
          setSuggestions([]); setOpen(false); setNoResults(false);
          return;
        }
        setUnavailable(false);
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
  }, [value, focused, language]);

  async function pick(item: SuggestionItem) {
    setOpen(false);
    setSuggestions([]);
    setNoResults(false);
    suppressFetchRef.current = true;
    cbRef.current.onChange(item.secondary ? `${item.main}, ${item.secondary}` : item.main);
    const token = tokenRef.current;
    tokenRef.current = ''; // session consumed by the details call
    const addr = await resolvePlace(item.placeId, token, language);
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

  const hint = hideStatusHint ? null : unavailable ? t.address.loadError : null;

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
          autoComplete="off"
          name={fieldNameRef.current}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {fetching && (
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
        <p className="mt-1 flex items-center gap-1 text-[11px] text-text-tertiary">
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
