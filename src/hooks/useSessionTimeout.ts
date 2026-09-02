/**
 * Session inactivity timeout hook.
 * Signs out the user after SESSION_TIMEOUT_MS of no interaction, after warning
 * them WARNING_BEFORE_MS ahead via the `session-timeout-warning` event
 * (rendered by <SessionTimeoutModal />).
 *
 * Activity is detected in the capture phase so that scrolling inside a nested
 * container (a table with `overflow: auto`) counts — `scroll` does not bubble
 * to window, so a bubbling listener would miss it and log out a user who was
 * reading a long list the whole time.
 */
import { useEffect, useRef } from 'react';
import { endTrackingAndSignOut } from './useLiveLocationTracking';

// 4 hours of inactivity before auto-signout
export const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000;

// Warning 5 minutes before timeout
export const WARNING_BEFORE_MS = 5 * 60 * 1000;

/** Fired when the timer is reset — lets the warning modal dismiss itself. */
export const SESSION_ACTIVITY_EVENT = 'session-activity';
/** Fired WARNING_BEFORE_MS before signout, with `{ remainingMs }`. */
export const SESSION_WARNING_EVENT = 'session-timeout-warning';

// `mousemove` is throttled by MOVE_THROTTLE_MS — it fires hundreds of times a
// second and we only need to know that it happened at all.
const MOVE_THROTTLE_MS = 30 * 1000;

export function useSessionTimeout(userId: string | null) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMoveRef = useRef(0);

  useEffect(() => {
    if (!userId) return;

    const resetTimer = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);

      window.dispatchEvent(new CustomEvent(SESSION_ACTIVITY_EVENT));

      warningRef.current = setTimeout(() => {
        window.dispatchEvent(new CustomEvent(SESSION_WARNING_EVENT, {
          detail: { remainingMs: WARNING_BEFORE_MS },
        }));
      }, SESSION_TIMEOUT_MS - WARNING_BEFORE_MS);

      timeoutRef.current = setTimeout(async () => {
        console.warn('[session] Inactivity timeout — signing out');
        await endTrackingAndSignOut();
        window.location.href = '/';
      }, SESSION_TIMEOUT_MS);
    };

    const onMove = () => {
      const now = performance.now();
      if (now - lastMoveRef.current < MOVE_THROTTLE_MS) return;
      lastMoveRef.current = now;
      resetTimer();
    };

    // Capture phase: `scroll` inside an overflow container never reaches window
    // by bubbling, and a click in a stopPropagation() handler would be missed.
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    for (const event of events) {
      window.addEventListener(event, resetTimer, { passive: true, capture: true });
    }
    window.addEventListener('mousemove', onMove, { passive: true, capture: true });

    resetTimer();

    return () => {
      for (const event of events) {
        window.removeEventListener(event, resetTimer, { capture: true });
      }
      window.removeEventListener('mousemove', onMove, { capture: true });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
    };
  }, [userId]);
}
