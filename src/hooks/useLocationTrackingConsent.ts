import { useCallback, useEffect, useState } from 'react';
import {
  getLocationTrackingEnabled,
  getMyLocationConsent,
  setMyLocationConsent,
  LOCATION_CONSENT_EVENT,
} from '../lib/locationConsentApi';

export interface LocationTrackingConsent {
  /** Org master switch (defaults true when unset). */
  orgEnabled: boolean;
  /** null = never asked, true = consented, false = declined. */
  consent: boolean | null;
  /** True once org switch + consent have loaded. */
  ready: boolean;
  /** Tracking may run: org on AND user consented. */
  allowed: boolean;
  /** Show the consent prompt: org on AND user never answered. */
  needsPrompt: boolean;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
}

/**
 * Loads the org-wide location switch and the current user's consent, and lets
 * the caller record a decision. Drives both the auto-tracking gate and the
 * first-login consent modal so they stay in sync.
 */
export function useLocationTrackingConsent(
  userId: string | null,
  orgId: string | null,
): LocationTrackingConsent {
  const [orgEnabled, setOrgEnabled] = useState(true);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!userId || !orgId) { setReady(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const [enabled, c] = await Promise.all([
          getLocationTrackingEnabled(orgId),
          getMyLocationConsent(userId),
        ]);
        if (cancelled) return;
        setOrgEnabled(enabled);
        setConsent(c);
        setReady(true);
      } catch {
        // Leave ready=false → tracking stays off until we can read the gate.
      }
    })();
    return () => { cancelled = true; };
  }, [userId, orgId]);

  // Consent saved elsewhere (e.g. the Settings toggle) — sync so tracking
  // starts/stops immediately instead of waiting for a reload.
  useEffect(() => {
    const onConsent = (e: Event) => {
      const detail = (e as CustomEvent<{ consent: boolean }>).detail;
      if (typeof detail?.consent === 'boolean') setConsent(detail.consent);
    };
    window.addEventListener(LOCATION_CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(LOCATION_CONSENT_EVENT, onConsent);
  }, []);

  const record = useCallback(async (value: boolean) => {
    if (!userId) return;
    await setMyLocationConsent(userId, value);
    setConsent(value);
  }, [userId]);

  const accept = useCallback(() => record(true), [record]);
  const decline = useCallback(() => record(false), [record]);

  return {
    orgEnabled,
    consent,
    ready,
    allowed: ready && orgEnabled && consent === true,
    needsPrompt: ready && orgEnabled && consent === null,
    accept,
    decline,
  };
}
