import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getCurrentOrgId } from '../lib/orgApi';
import { getActiveSession, stopTrackingSession } from '../lib/trackingApi';
import { useGpsTracker } from './useGpsTracker';

/**
 * Transmet la position du membre connecté PENDANT QU'IL EST POINTÉ (session de
 * suivi ouverte par le pointage, `time_entry_id`), vers
 * `tracking_live_locations` via {@link useGpsTracker}. Hors pointage : rien.
 *
 * The browser shows its native location-permission prompt on first run. If the
 * user denies it, tracking simply stays off (no crash).
 *
 * Pass `userId`/`orgId` from the authenticated shell. `allowed` gates the whole
 * thing on org switch + user consent (Loi 25) — when false, or either id is
 * null, tracking is off and no session is created.
 */
export function useLiveLocationTracking(
  userId: string | null,
  orgId: string | null,
  allowed: boolean,
) {
  const [sessionReady, setSessionReady] = useState(false);

  // Loi 25 (audit Agenda, 2026-09-30) : la position n'est transmise que
  // PENDANT LES HEURES POINTÉES. Avant, une session « de connexion » était
  // ouverte pour tout utilisateur connecté, bureau compris (« so we don't
  // require a time entry ») : on suivait des gens qui ne travaillaient pas.
  // Désormais ce hook n'ouvre aucune session : il suit celle que le POINTAGE
  // ouvre (tracking_sessions.time_entry_id), revérifiée chaque minute et au
  // retour sur l'onglet ; le dépointage la ferme et la transmission s'arrête.
  useEffect(() => {
    if (!userId || !orgId || !allowed) {
      setSessionReady(false);
      return;
    }
    let cancelled = false;
    const verifier = async () => {
      try {
        const session = await getActiveSession(userId);
        if (!cancelled) setSessionReady(Boolean(session && session.time_entry_id && session.org_id === orgId));
      } catch {
        if (!cancelled) setSessionReady(false);
      }
    };
    void verifier();
    const minuterie = window.setInterval(() => void verifier(), 60_000);
    const auRetour = () => { if (document.visibilityState === 'visible') void verifier(); };
    document.addEventListener('visibilitychange', auRetour);
    return () => {
      cancelled = true;
      window.clearInterval(minuterie);
      document.removeEventListener('visibilitychange', auRetour);
      setSessionReady(false);
    };
  }, [userId, orgId, allowed]);

  return useGpsTracker({ enabled: sessionReady });
}

/**
 * Stops the user's live-tracking session, THEN signs out. Call this from logout
 * buttons instead of `supabase.auth.signOut()` directly: it runs while auth is
 * still valid so the RLS-protected "mark offline" write succeeds, removing the
 * user's live pin from the maps immediately rather than waiting for it to go stale.
 *
 * Ends by sending the browser to the marketing home page. We navigate to the
 * ORIGIN ROOT (`window.location.origin`), not `'/'`: assigning `'/'` keeps the
 * current pathname in the History entry until the load commits, so for a split
 * second the app re-renders the route the user just left (e.g. /jobs) against
 * the now-signed-out router — whose public tree only matches it with the
 * catch-all, flashing "Page not found" (404) before the reload lands. Replacing
 * the whole URL avoids that flash and can't leave the old route in history.
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
  // Replace (not assign) so the signed-in route never lands in history, and go
  // to the origin root so the home page is what loads — never the old path.
  window.location.replace(window.location.origin + '/');
}
