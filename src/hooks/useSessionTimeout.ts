/**
 * Session inactivity timeout hook.
 * Signs out the user after SESSION_TIMEOUT_MS of no interaction.
 * Resets the timer on mouse, keyboard, touch, and scroll events.
 */
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

// 30 minutes of inactivity before auto-signout
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

// Warning 2 minutes before timeout
const WARNING_BEFORE_MS = 2 * 60 * 1000;

export function useSessionTimeout(userId: string | null) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;

    const resetTimer = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);

      // Set warning timer
      warningRef.current = setTimeout(() => {
        // Dispatch custom event for UI to show warning
        window.dispatchEvent(new CustomEvent('session-timeout-warning', {
          detail: { remainingMs: WARNING_BEFORE_MS },
        }));
      }, SESSION_TIMEOUT_MS - WARNING_BEFORE_MS);

      // Set signout timer
      timeoutRef.current = setTimeout(async () => {
        console.warn('[session] Inactivity timeout — signing out');
        await supabase.auth.signOut();
        window.location.href = '/';
      }, SESSION_TIMEOUT_MS);
    };

    // Activity events that reset the timer
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    for (const event of events) {
      window.addEventListener(event, resetTimer, { passive: true });
    }

    // Start the timer
    resetTimer();

    return () => {
      for (const event of events) {
        window.removeEventListener(event, resetTimer);
      }
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
    };
  }, [userId]);
}
