import { useEffect } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Signs the user out after `inactivityMs` of no user activity
 * (mouse, keyboard, scroll, touch). No-op when `enabled` is false.
 */
export function useInactivityLogout(enabled: boolean, inactivityMs: number = 30 * 60 * 1000) {
  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        supabase.auth.signOut();
      }, inactivityMs);
    };

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((e) => document.addEventListener(e, reset, { passive: true }));
    reset();

    return () => {
      clearTimeout(timer);
      events.forEach((e) => document.removeEventListener(e, reset));
    };
  }, [enabled, inactivityMs]);
}
