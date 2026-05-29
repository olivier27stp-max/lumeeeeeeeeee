import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getActiveSession, recordPosition } from '../lib/trackingApi';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';

interface UseGpsTrackerOptions {
  /** When true, request permission and start watchPosition. When false, stop. */
  enabled: boolean;
  /** Minimum ms between writes to the DB (default 15s) — watchPosition fires far more often. */
  minIntervalMs?: number;
}

interface GpsTrackerState {
  status: 'idle' | 'requesting' | 'active' | 'denied' | 'error' | 'no-session';
  lastError: string | null;
  lastWriteAt: number | null;
}

/**
 * Streams the browser's geolocation into tracking_points / tracking_live_locations
 * whenever `enabled` is true. The Express server creates the tracking_sessions row
 * on punch-in; this hook just attaches the device to that session.
 */
export function useGpsTracker({ enabled, minIntervalMs = 15_000 }: UseGpsTrackerOptions) {
  const [state, setState] = useState<GpsTrackerState>({ status: 'idle', lastError: null, lastWriteAt: null });
  const watchIdRef = useRef<number | null>(null);
  const lastWriteRef = useRef<number>(0);
  const ctxRef = useRef<{ orgId: string; userId: string; sessionId: string; teamId: string | null } | null>(null);

  const stop = useCallback(() => {
    if (watchIdRef.current != null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
    ctxRef.current = null;
    setState({ status: 'idle', lastError: null, lastWriteAt: null });
  }, []);

  const handlePosition = useCallback((pos: GeolocationPosition) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const now = Date.now();
    if (now - lastWriteRef.current < minIntervalMs) return;
    lastWriteRef.current = now;
    void recordPosition({
      orgId: ctx.orgId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      teamId: ctx.teamId,
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy,
      heading: pos.coords.heading,
      speed_mps: pos.coords.speed,
      altitude_m: pos.coords.altitude,
    }).then(() => {
      setState((s) => ({ ...s, status: 'active', lastWriteAt: now, lastError: null }));
    }).catch((e) => {
      setState((s) => ({ ...s, lastError: e?.message || 'Failed to record point' }));
    });
  }, [minIntervalMs]);

  const handleError = useCallback((err: GeolocationPositionError) => {
    if (err.code === err.PERMISSION_DENIED) {
      setState({ status: 'denied', lastError: 'Geolocation permission denied', lastWriteAt: lastWriteRef.current || null });
      stop();
    } else {
      setState((s) => ({ ...s, status: 'error', lastError: err.message }));
    }
  }, [stop]);

  useEffect(() => {
    if (!enabled) { stop(); return; }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ status: 'error', lastError: 'Geolocation API unavailable', lastWriteAt: null });
      return;
    }

    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, status: 'requesting' }));
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');
        const orgId = await getCurrentOrgIdOrThrow();
        const session = await getActiveSession(user.id);
        if (!session) {
          // Punch-in should have created one; if missing the user is not punched.
          setState({ status: 'no-session', lastError: 'No active tracking session — punch in first', lastWriteAt: null });
          return;
        }
        if (cancelled) return;
        ctxRef.current = { orgId, userId: user.id, sessionId: session.id, teamId: session.team_id };
        watchIdRef.current = navigator.geolocation.watchPosition(handlePosition, handleError, {
          enableHighAccuracy: true,
          maximumAge: 5_000,
          timeout: 30_000,
        });
        setState((s) => ({ ...s, status: 'active' }));
      } catch (e: any) {
        setState({ status: 'error', lastError: e?.message || 'Failed to start tracker', lastWriteAt: null });
      }
    })();

    return () => { cancelled = true; stop(); };
  }, [enabled, handlePosition, handleError, stop]);

  return state;
}
