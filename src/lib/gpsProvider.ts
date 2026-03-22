/**
 * Browser GPS provider — wraps navigator.geolocation.watchPosition with:
 * - Accuracy filtering
 * - Distance-based deduplication
 * - Offline buffering
 * - Tab visibility handling
 * - Heartbeat keep-alive
 * - Permission state tracking
 *
 * Designed to be replaceable with a React Native equivalent later.
 */

import { TRACKING_CONFIG, haversineDistance } from './trackingApi';
import { supabase } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export type GpsPermissionState = 'prompt' | 'granted' | 'denied' | 'unavailable' | 'unknown';

export interface GpsPosition {
  latitude: number;
  longitude: number;
  accuracy_m: number;
  heading: number | null;
  speed_mps: number | null;
  altitude_m: number | null;
  timestamp: number;
}

export interface GpsProviderCallbacks {
  onPosition: (pos: GpsPosition) => void;
  onError: (error: GeolocationPositionError | Error) => void;
  onPermissionChange: (state: GpsPermissionState) => void;
  onVisibilityChange: (hidden: boolean) => void;
}

// ─── State ──────────────────────────────────────────────────────────────────

let watchId: number | null = null;
let lastPosition: GpsPosition | null = null;
let lastSentAt = 0;
let callbacks: GpsProviderCallbacks | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let offlineBuffer: GpsPosition[] = [];
let isOnline = navigator.onLine;

// ─── Permission check ───────────────────────────────────────────────────────

export async function checkGpsPermission(): Promise<GpsPermissionState> {
  if (!navigator.geolocation) return 'unavailable';

  try {
    if (navigator.permissions) {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      return result.state as GpsPermissionState;
    }
  } catch {
    // permissions API not supported
  }

  return 'unknown';
}

export function isGpsAvailable(): boolean {
  return 'geolocation' in navigator;
}

// ─── Start watching ─────────────────────────────────────────────────────────

export function startGpsWatch(cbs: GpsProviderCallbacks): void {
  if (!navigator.geolocation) {
    cbs.onError(new Error('Geolocation not supported'));
    cbs.onPermissionChange('unavailable');
    return;
  }

  callbacks = cbs;
  lastPosition = null;
  lastSentAt = 0;
  offlineBuffer = [];

  watchId = navigator.geolocation.watchPosition(
    handlePositionSuccess,
    handlePositionError,
    {
      enableHighAccuracy: true,
      maximumAge: 10_000,
      timeout: 30_000,
    }
  );

  // Permission monitoring
  if (navigator.permissions) {
    navigator.permissions.query({ name: 'geolocation' }).then((status) => {
      callbacks?.onPermissionChange(status.state as GpsPermissionState);
      status.addEventListener('change', () => {
        callbacks?.onPermissionChange(status.state as GpsPermissionState);
      });
    }).catch(() => {});
  }

  // Tab visibility handler
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Online/offline handlers
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // Heartbeat: sends last known position periodically even when idle
  heartbeatTimer = setInterval(() => {
    if (lastPosition && callbacks) {
      callbacks.onPosition({ ...lastPosition, timestamp: Date.now() });
    }
  }, TRACKING_CONFIG.heartbeatIntervalMs);
}

// ─── Stop watching ──────────────────────────────────────────────────────────

export function stopGpsWatch(): void {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);

  callbacks = null;
  lastPosition = null;
  lastSentAt = 0;
}

// ─── Get offline buffer (for flush on reconnect) ────────────────────────────

export function getAndClearOfflineBuffer(): GpsPosition[] {
  const buffer = [...offlineBuffer];
  offlineBuffer = [];
  return buffer;
}

export function getLastKnownPosition(): GpsPosition | null {
  return lastPosition;
}

// ─── Internal handlers ──────────────────────────────────────────────────────

function handlePositionSuccess(pos: GeolocationPosition): void {
  const gpsPos: GpsPosition = {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy_m: pos.coords.accuracy,
    heading: pos.coords.heading,
    speed_mps: pos.coords.speed,
    altitude_m: pos.coords.altitude,
    timestamp: pos.timestamp,
  };

  // Filter: reject low accuracy
  if (gpsPos.accuracy_m > TRACKING_CONFIG.maxAccuracyM) return;

  const now = Date.now();

  // Throttle: minimum interval between sends
  if (now - lastSentAt < TRACKING_CONFIG.minIntervalMs) return;

  // Distance filter: ignore if too close to last point
  if (lastPosition) {
    const dist = haversineDistance(
      lastPosition.latitude, lastPosition.longitude,
      gpsPos.latitude, gpsPos.longitude
    );
    const timeSinceLastMs = now - lastSentAt;

    // If barely moved AND not yet due for heartbeat, skip
    if (dist < TRACKING_CONFIG.minDistanceM && timeSinceLastMs < TRACKING_CONFIG.heartbeatIntervalMs) {
      return;
    }
  }

  lastPosition = gpsPos;
  lastSentAt = now;

  // If offline, buffer locally
  if (!isOnline) {
    offlineBuffer.push(gpsPos);
    return;
  }

  callbacks?.onPosition(gpsPos);
}

function handlePositionError(error: GeolocationPositionError): void {
  if (error.code === error.PERMISSION_DENIED) {
    callbacks?.onPermissionChange('denied');
  }
  callbacks?.onError(error);
}

function handleVisibilityChange(): void {
  const hidden = document.hidden;
  callbacks?.onVisibilityChange(hidden);
}

function handleOnline(): void {
  isOnline = true;
  // Flush offline buffer
  if (offlineBuffer.length > 0 && callbacks) {
    for (const pos of offlineBuffer) {
      callbacks.onPosition(pos);
    }
    offlineBuffer = [];
  }
}

function handleOffline(): void {
  isOnline = false;
}
