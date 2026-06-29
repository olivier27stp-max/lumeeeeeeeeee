// Background GPS tracking so a clocked-in tech/rep keeps streaming their position
// (route + live map) even when the app is backgrounded or the phone is locked.
// Uses expo-location's startLocationUpdatesAsync + a TaskManager task. The task
// runs with no React context, so the session context (org/user/session ids) is
// stashed in AsyncStorage and read back inside the task.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { recordTrackingPoint } from './api/tracking';

export const LOCATION_TASK = 'lume-location-updates';
const CTX_KEY = 'lume_tracking_ctx';

export interface TrackingCtx {
  orgId: string;
  userId: string;
  sessionId: string;
  teamId: string | null;
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: any) => {
  if (error || !data) return;
  const locations: Location.LocationObject[] = data.locations ?? [];
  if (!locations.length) return;
  const raw = await AsyncStorage.getItem(CTX_KEY);
  if (!raw) return;
  let ctx: TrackingCtx;
  try {
    ctx = JSON.parse(raw);
  } catch {
    return;
  }
  // Only need the latest fix for the live map; record them all for the trail.
  for (const pos of locations) {
    await recordTrackingPoint(
      { orgId: ctx.orgId, userId: ctx.userId, sessionId: ctx.sessionId, teamId: ctx.teamId },
      {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy ?? null,
        heading: pos.coords.heading ?? null,
        speed_mps: pos.coords.speed ?? null,
        altitude_m: pos.coords.altitude ?? null,
      },
    ).catch(() => {});
  }
});

export async function startBackgroundTracking(ctx: TrackingCtx): Promise<void> {
  await AsyncStorage.setItem(CTX_KEY, JSON.stringify(ctx));
  const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (already) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    distanceInterval: 20, // metres
    timeInterval: 15_000, // ms (Android)
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    foregroundService: {
      notificationTitle: 'Lume — suivi actif',
      notificationBody: 'Votre position est partagée pendant votre quart.',
    },
  });
}

export async function stopBackgroundTracking(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
  await AsyncStorage.removeItem(CTX_KEY);
}
