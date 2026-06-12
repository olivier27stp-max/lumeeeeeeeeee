import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getCurrentOrgId } from '../lib/orgApi';
import { getActiveSession, startTrackingSession, stopTrackingSession } from '../lib/trackingApi';
import { useGpsTracker } from './useGpsTracker';

/** True on phones/tablets — used only to tag the tracking session source. */
const IS_MOBILE =
  typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/**
 * Auto-locates the signed-in user for the whole session — desktop AND mobile web
 * (same SPA, same code path). As soon as a user is logged in with an org context,
 * this ensures a `tracking_sessions` row exists (creating one if punch-in didn't)
 * and streams the browser position into `tracking_live_locations` via
 * {@link useGpsTracker}, so every user shows up as a live blue pin on the maps.
 *
 * The browser shows its native location-permission prompt on first run. If the
 * user denies it, tracking simply stays off (no crash).
 *
 * Pass `userId`/`orgId` from the authenticated shell. When either is null,
 * tracking is off.
 */
export function useLiveLocationTracking(userId: string | null, orgId: string | null) {
  const [sessionReady, setSessionReady] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || !orgId) {
      setSessionReady(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        // Reuse a punch-in session if one is already active, else open one
        // tagged to this login so we don't require a time entry.
        let session = await getActiveSession(userId);
        if (!session) {
          session = await startTrackingSession({
            orgId,
            userId,
            source: IS_MOBILE ? 'mobile' : 'web',
          });
        }
        if (cancelled) return;
        sessionIdRef.current = session.id;
        setSessionReady(true);
      } catch {
        // Org/session not ready yet (e.g. membership still provisioning) — leave
        // tracking off; the effect re-runs when orgId becomes available.
      }
    })();

    return () => {
      cancelled = true;
      setSessionReady(false);
      // Best-effort close on org switch / unmount while auth is still valid.
      // Deliberate logout is handled by endTrackingAndSignOut() so the row is
      // marked offline before the Supabase session clears.
      const sid = sessionIdRef.current;
      if (sid) {
        void stopTrackingSession({ sessionId: sid, userId, orgId, reason: 'stopped' }).catch(() => {});
        sessionIdRef.current = null;
      }
    };
  }, [userId, orgId]);

  return useGpsTracker({ enabled: sessionReady });
}

/**
 * Stops the user's live-tracking session, THEN signs out. Call this from logout
 * buttons instead of `supabase.auth.signOut()` directly: it runs while auth is
 * still valid so the RLS-protected "mark offline" write succeeds, removing the
 * user's live pin from the maps immediately rather than waiting for it to go stale.
 */
export async function endTrackingAndSignOut(): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const orgId = await getCurrentOrgId();
      const session = await getActiveSession(user.id);
      if (session && orgId) {
        await stopTrackingSession({ sessionId: session.id, userId: user.id, orgId, reason: 'stopped' });
      }
    }
  } catch {
    // Never block logout on a tracking-cleanup failure.
  }
  await supabase.auth.signOut();
}
