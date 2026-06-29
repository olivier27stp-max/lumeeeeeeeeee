// Background GPS tracking controller: while the signed-in user is clocked in,
// their position streams into tracking_points + tracking_live_locations — even
// when the app is backgrounded / the phone is locked (so the live map follows a
// tech who's driving). Uses startLocationUpdatesAsync + a TaskManager task
// (see background-location.ts).

import * as Location from 'expo-location';
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from './auth';
import { usePermissions } from './usePermissions';
import { getActiveTimesheet } from './api/timesheets';
import { startTrackingSession, endTrackingSession } from './api/tracking';
import { startBackgroundTracking, stopBackgroundTracking } from './background-location';
import { registerForPush } from './api/pushNotifications';

/** Non-visual controller. Mount once inside the authenticated layout. */
export function LiveTrackingController() {
  const { session } = useAuth();
  const { orgId, teamId } = usePermissions();
  const userId = session?.user.id ?? null;

  const sessionIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);

  useEffect(() => {
    if (orgId && userId) registerForPush(orgId, userId);
  }, [orgId, userId]);

  const { data: active } = useQuery({
    queryKey: ['live-tracking-clock', userId],
    queryFn: () => getActiveTimesheet(String(userId)),
    enabled: !!userId,
    refetchInterval: 60_000,
  });
  const isClockedIn = !!active && active.status !== 'completed';

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (startingRef.current || sessionIdRef.current || !orgId || !userId) return;
      startingRef.current = true;
      try {
        const fg = await Location.requestForegroundPermissionsAsync();
        if (fg.status !== 'granted' || cancelled) return;
        // "Always" permission lets it keep tracking in the background; best effort.
        await Location.requestBackgroundPermissionsAsync().catch(() => {});

        const sessionId = await startTrackingSession({
          orgId,
          userId,
          teamId: teamId ?? null,
          timeEntryId: active?.id ?? null,
        });
        if (cancelled) {
          await endTrackingSession({ sessionId, userId }).catch(() => {});
          return;
        }
        sessionIdRef.current = sessionId;
        await startBackgroundTracking({ orgId, userId, sessionId, teamId: teamId ?? null });
      } catch (e) {
        console.warn('[live-tracking] start failed:', (e as Error)?.message ?? e);
      } finally {
        startingRef.current = false;
      }
    }

    async function stop() {
      await stopBackgroundTracking().catch(() => {});
      const sid = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sid && userId) await endTrackingSession({ sessionId: sid, userId }).catch(() => {});
    }

    if (isClockedIn) start();
    else stop();

    return () => {
      cancelled = true;
    };
  }, [isClockedIn, orgId, userId, teamId, active?.id]);

  // Stop on sign-out / teardown.
  useEffect(() => {
    return () => {
      stopBackgroundTracking().catch(() => {});
      const sid = sessionIdRef.current;
      if (sid && userId) endTrackingSession({ sessionId: sid, userId }).catch(() => {});
    };
  }, [userId]);

  return null;
}
