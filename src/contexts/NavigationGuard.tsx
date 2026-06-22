/**
 * NavigationGuard — lets page-local modals (Quote, Visit, …) intercept in-app
 * navigation so an open form with unsaved data isn't silently discarded.
 *
 * React Router v7 is used here in *declarative* mode (`<BrowserRouter>`), where
 * `useBlocker` is unavailable (it requires a data router). Instead we wrap the
 * router's underlying history `push`/`replace` once at the app root: when a
 * registered guard is "dirty", the attempted navigation is parked and the guard
 * is told to show its confirmation. The modal then either confirms (the parked
 * navigation runs — the page changes and the modal unmounts) or cancels.
 *
 * Note: browser back/forward (popstate) is not intercepted — only push/replace,
 * which covers sidebar links, <Link> clicks and programmatic `navigate()`.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';

type Blocker = {
  when: () => boolean;
  onBlock: () => void;
};

type NavigationGuardContextValue = {
  register: (blocker: Blocker) => () => void;
  proceed: () => void;
  cancel: () => void;
};

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

export function NavigationGuardProvider({ children }: { children: React.ReactNode }) {
  const { navigator } = useContext(UNSAFE_NavigationContext) as any;
  const blockersRef = useRef<Set<Blocker>>(new Set());
  const pendingRef = useRef<(() => void) | null>(null);
  const bypassRef = useRef(false);

  const register = useCallback((blocker: Blocker) => {
    blockersRef.current.add(blocker);
    return () => {
      blockersRef.current.delete(blocker);
    };
  }, []);

  const proceed = useCallback(() => {
    const tx = pendingRef.current;
    pendingRef.current = null;
    if (tx) {
      bypassRef.current = true;
      try {
        tx();
      } finally {
        bypassRef.current = false;
      }
    }
  }, []);

  const cancel = useCallback(() => {
    pendingRef.current = null;
  }, []);

  useEffect(() => {
    if (!navigator) return;
    const original = { push: navigator.push, replace: navigator.replace };
    const intercept =
      (method: 'push' | 'replace') =>
      (...args: any[]) => {
        if (!bypassRef.current) {
          const active = [...blockersRef.current].find((b) => b.when());
          if (active) {
            pendingRef.current = () => original[method].apply(navigator, args);
            active.onBlock();
            return undefined;
          }
        }
        return original[method].apply(navigator, args);
      };
    navigator.push = intercept('push');
    navigator.replace = intercept('replace');
    return () => {
      navigator.push = original.push;
      navigator.replace = original.replace;
    };
  }, [navigator]);

  const value = useMemo<NavigationGuardContextValue>(
    () => ({ register, proceed, cancel }),
    [register, proceed, cancel]
  );

  return <NavigationGuardContext.Provider value={value}>{children}</NavigationGuardContext.Provider>;
}

/**
 * Guards in-app navigation while `when` is true.
 * - `active`  — a navigation was attempted; show the leave-confirmation.
 * - `confirmLeave()` — run the parked navigation (page changes, modal unmounts).
 * - `cancelLeave()`  — stay; discard the parked navigation.
 * - `release()` — imperatively allow the *next* navigation through without a
 *   prompt (call right before navigating yourself after a successful save).
 */
export function useNavigationGuard(when: boolean) {
  const ctx = useContext(NavigationGuardContext);
  const [active, setActive] = useState(false);
  const whenRef = useRef(when);
  whenRef.current = when;

  useEffect(() => {
    if (!ctx) return;
    return ctx.register({
      when: () => whenRef.current,
      onBlock: () => setActive(true),
    });
  }, [ctx]);

  // Drop a stale prompt if the form is no longer dirty (e.g. it was reset).
  useEffect(() => {
    if (!when && active) setActive(false);
  }, [when, active]);

  const confirmLeave = useCallback(() => {
    setActive(false);
    ctx?.proceed();
  }, [ctx]);

  const cancelLeave = useCallback(() => {
    setActive(false);
    ctx?.cancel();
  }, [ctx]);

  const release = useCallback(() => {
    whenRef.current = false;
    setActive(false);
  }, []);

  return { active, confirmLeave, cancelLeave, release };
}
