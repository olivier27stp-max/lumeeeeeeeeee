import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  type GpsPermissionState,
  type GpsPosition,
  checkGpsPermission,
  isGpsAvailable,
  startGpsWatch,
  stopGpsWatch,
} from '../lib/gpsProvider';
import { type TrackingSession } from '../lib/trackingApi';

export interface GpsTrackingState {
  /** GPS hardware available in browser */
  available: boolean;
  /** Current permission state */
  permission: GpsPermissionState;
  /** Active tracking session */
  session: TrackingSession | null;
  /** Whether GPS is actively watching */
  watching: boolean;
  /** Last recorded position */
  lastPosition: GpsPosition | null;
  /** Last error message */
  error: string | null;
  /** Whether the tab is hidden */
  tabHidden: boolean;
  /** Points recorded in this session */
  pointCount: number;
}

export interface GpsTrackingActions {
  startTracking: (teamId?: string | null) => Promise<void>;
  stopTracking: () => Promise<void>;
  requestPermission: () => Promise<GpsPermissionState>;
}

export function useGpsTracking(): GpsTrackingState & GpsTrackingActions {
  const [state, setState] = useState<GpsTrackingState>({
    available: isGpsAvailable(),
    permission: 'unknown',
    session: null,
    watching: false,
    lastPosition: null,
    error: null,
    tabHidden: false,
    pointCount: 0,
  });

  const sessionRef = useRef<TrackingSession | null>(null);
  const orgIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);

  // Check initial permission and user context
  useEffect(() => {
    checkGpsPermission().then((perm) => {
      setState((s) => ({ ...s, permission: perm }));
    });

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) userIdRef.current = user.id;
    });

    supabase.rpc('current_org_id').then(({ data }) => {
      if (data) orgIdRef.current = data as string;
    });
  }, []);

  const getAuthToken = useCallback(async (): Promise<string> => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Not authenticated');
    return token;
  }, []);

  const apiCall = useCallback(async (path: string, body: any) => {
    const token = await getAuthToken();
    const res = await fetch(`/api/tracking/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed: ${path}`);
    return data;
  }, [getAuthToken]);

  const startTracking = useCallback(async (teamId?: string | null) => {
    try {
      // Start server session
      const { session } = await apiCall('start', { teamId, source: 'web' });
      sessionRef.current = session;
      orgIdRef.current = session.org_id;

      setState((s) => ({ ...s, session, watching: true, error: null, pointCount: 0 }));

      // Start GPS watch
      startGpsWatch({
        onPosition: async (pos) => {
          if (!sessionRef.current) return;
          try {
            await apiCall('point', {
              sessionId: sessionRef.current.id,
              latitude: pos.latitude,
              longitude: pos.longitude,
              accuracy_m: pos.accuracy_m,
              heading: pos.heading,
              speed_mps: pos.speed_mps,
              altitude_m: pos.altitude_m,
              is_moving: pos.speed_mps != null ? pos.speed_mps > 0.5 : undefined,
            });
            setState((s) => ({
              ...s,
              lastPosition: pos,
              pointCount: s.pointCount + 1,
              error: null,
            }));
          } catch (err: any) {
            console.warn('Failed to send GPS point:', err.message);
          }
        },
        onError: (err) => {
          const message = err instanceof GeolocationPositionError
            ? `GPS error: ${err.message} (code ${err.code})`
            : err.message;
          setState((s) => ({ ...s, error: message }));
        },
        onPermissionChange: (perm) => {
          setState((s) => ({ ...s, permission: perm }));
          if (perm === 'denied' && sessionRef.current) {
            apiCall('event', {
              sessionId: sessionRef.current.id,
              eventType: 'permission_revoked',
            }).catch(() => {});
          }
        },
        onVisibilityChange: (hidden) => {
          setState((s) => ({ ...s, tabHidden: hidden }));
          if (sessionRef.current) {
            apiCall('event', {
              sessionId: sessionRef.current.id,
              eventType: hidden ? 'tab_hidden' : 'tab_visible',
            }).catch(() => {});
          }
        },
      });
    } catch (err: any) {
      setState((s) => ({ ...s, error: err.message }));
      throw err;
    }
  }, [apiCall]);

  const stopTracking = useCallback(async () => {
    stopGpsWatch();

    if (sessionRef.current) {
      try {
        await apiCall('stop', { sessionId: sessionRef.current.id, reason: 'stopped' });
      } catch (err: any) {
        console.warn('Failed to stop session:', err.message);
      }
    }

    sessionRef.current = null;
    setState((s) => ({
      ...s,
      session: null,
      watching: false,
      lastPosition: null,
    }));
  }, [apiCall]);

  const requestPermission = useCallback(async (): Promise<GpsPermissionState> => {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => {
          setState((s) => ({ ...s, permission: 'granted' }));
          resolve('granted');
        },
        (err) => {
          const perm: GpsPermissionState = err.code === err.PERMISSION_DENIED ? 'denied' : 'unknown';
          setState((s) => ({ ...s, permission: perm }));
          resolve(perm);
        },
        { enableHighAccuracy: true, timeout: 10_000 }
      );
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopGpsWatch();
    };
  }, []);

  return {
    ...state,
    startTracking,
    stopTracking,
    requestPermission,
  };
}
