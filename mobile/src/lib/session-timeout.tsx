// "Stay signed in" control: the user picks how long the app can stay inactive
// (backgrounded or closed) before it signs them out. 'forever' (default) never
// signs out — Supabase refresh tokens don't expire on their own, so without an
// explicit limit the session simply persists.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from './supabase';

export type IdleLimit = '1h' | '8h' | '24h' | '7d' | '30d' | 'forever';

const LIMIT_KEY = 'lume_session_idle_limit';
const LAST_ACTIVE_KEY = 'lume_session_last_active';

export const IDLE_LIMIT_OPTIONS: IdleLimit[] = ['1h', '8h', '24h', '7d', '30d', 'forever'];

const IDLE_LIMIT_MS: Record<Exclude<IdleLimit, 'forever'>, number> = {
  '1h': 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

async function getIdleLimit(): Promise<IdleLimit> {
  const v = await AsyncStorage.getItem(LIMIT_KEY);
  return IDLE_LIMIT_OPTIONS.includes(v as IdleLimit) ? (v as IdleLimit) : 'forever';
}

/** Read + persist the user's chosen idle limit (profile screen). */
export function useIdleLimit() {
  const [limit, setLimit] = useState<IdleLimit>('forever');
  useEffect(() => {
    getIdleLimit().then(setLimit);
  }, []);
  const update = (l: IdleLimit) => {
    setLimit(l);
    AsyncStorage.setItem(LIMIT_KEY, l);
  };
  return { limit, setLimit: update };
}

/** True if the idle window elapsed and the user was signed out. */
async function expireIfIdle(): Promise<boolean> {
  const [limit, lastRaw] = await Promise.all([
    getIdleLimit(),
    AsyncStorage.getItem(LAST_ACTIVE_KEY),
  ]);
  if (limit === 'forever') return false;
  const last = Number(lastRaw);
  if (!last) return false;
  if (Date.now() - last <= IDLE_LIMIT_MS[limit]) return false;
  await supabase.auth.signOut();
  return true;
}

/** Mounted once inside the authenticated layout (like LiveTrackingController). */
export function SessionTimeoutController() {
  useEffect(() => {
    // A cold start is a return from inactivity too: the last-active stamp was
    // written when the app was backgrounded before being killed.
    //
    // MAIS une connexion toute fraîche est de l'activité par définition. Sans
    // ce garde, le jalon d'AVANT la déconnexion (hier…) « expirait » un login
    // vieux d'une demi-seconde → signOut immédiat, en boucle, à chaque
    // tentative (Google comme courriel). On compare donc le dernier sign-in de
    // la session au jalon : plus récent = login frais → on réinitialise.
    (async () => {
      const [{ data }, lastRaw] = await Promise.all([
        supabase.auth.getSession(),
        AsyncStorage.getItem(LAST_ACTIVE_KEY),
      ]);
      const lastSignIn = new Date(data.session?.user?.last_sign_in_at ?? 0).getTime();
      const lastActive = Number(lastRaw) || 0;
      if (lastSignIn > lastActive) {
        await AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
        return;
      }
      const expired = await expireIfIdle();
      if (expired) router.replace('/(auth)/sign-in');
      else AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
    })();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        expireIfIdle().then((expired) => {
          if (expired) router.replace('/(auth)/sign-in');
        });
      } else {
        AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
      }
    });
    return () => sub.remove();
  }, []);
  return null;
}
