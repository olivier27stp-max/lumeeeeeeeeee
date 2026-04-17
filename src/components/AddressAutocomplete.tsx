import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import { AlertCircle, Loader2, MapPin } from 'lucide-react';
import { cn } from '../lib/utils';

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
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
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

// ── Main component ──
function AddressAutocompleteInner({
  value, onChange, onSelect, duplicateWarning, className, placeholder, restrictCountries,
}: AddressAutocompleteProps) {
  const { t } = useTranslation();
  const { isReady, isLoading, isError, hasKey } = useGooglePlaces();
  const inputRef = useRef<HTMLInputElement>(null);
  const acRef = useRef<google.maps.places.Autocomplete | null>(null);
  const cbRef = useRef({ onChange, onSelect });
  cbRef.current = { onChange, onSelect };
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!isReady || !inputRef.current || acRef.current) return;
    try {
      const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ['address'],
        componentRestrictions: { country: restrictCountries || ['ca'] },
        fields: ['address_components', 'formatted_address', 'geometry', 'place_id'],
      });
      ac.addListener('place_changed', () => {
        try {
          const place = ac.getPlace();
          if (!place?.address_components) return;
          const get = (type: string) => place.address_components!.find((c) => c.types.includes(type))?.long_name || '';
          const geo = place.geometry?.location;
          const addr: StructuredAddress = {
            formatted_address: place.formatted_address || '',
            street_number: get('street_number'),
            street_name: get('route'),
            city: get('locality') || get('sublocality'),
            province: get('administrative_area_level_1'),
            postal_code: get('postal_code'),
            country: get('country'),
            latitude: geo ? geo.lat() : null,
            longitude: geo ? geo.lng() : null,
            place_id: place.place_id || '',
          };
          cbRef.current.onChange(addr.formatted_address);
          cbRef.current.onSelect(addr);
        } catch (err) {
          console.error('[AddressAutocomplete] place_changed error:', err);
        }
      });
      acRef.current = ac;
    } catch (err) {
      console.error('[AddressAutocomplete] init error:', err);
    }
    return () => {
      try { if (acRef.current) window.google.maps.event.clearInstanceListeners(acRef.current); } catch { /* */ }
      acRef.current = null;
    };
  }, [isReady]);

  // Fallback label for missing key or error
  const hint = !hasKey ? t.address.apiKeyMissing : isError ? t.address.loadError : null;

  return (
    <div>
      <div className="relative">
        <MapPin size={14} className={cn('pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 transition-colors', focused ? 'text-primary' : 'text-text-tertiary')} />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={cn('glass-input w-full pl-9', className)}
          placeholder={placeholder || t.address.placeholder}
          autoComplete="new-password"
          name="address-search-no-autofill"
        />
        {isLoading && hasKey && (
          <Loader2 size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-text-tertiary" />
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
      <p className="mt-1 flex items-center gap-1 text-[11px] text-danger">
        <AlertCircle size={11} /> {t.address.loadError}
      </p>
    </div>
  );
  return (
    <AddressErrorBoundary fallback={fallback}>
      <AddressAutocompleteInner {...props} />
    </AddressErrorBoundary>
  );
}
