import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session } from '@supabase/supabase-js';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import { useAuth } from './auth';
import { supabase } from './supabase';
import {
  ACTIVE_ORG_KEY,
  CompanyMembership,
  cacheMemberships,
  fetchMemberships,
  pickActiveMembership,
  readCachedMemberships,
} from './membership';

/** Best display name for the signed-in user (Google metadata → email prefix). */
function sessionDisplayName(session: Session | null): string | null {
  const m = (session?.user?.user_metadata ?? {}) as Record<string, any>;
  const name = m.full_name || m.name || m.preferred_username;
  if (name) return String(name);
  const email = session?.user?.email;
  return email ? email.split('@')[0] : null;
}

type MembershipState = {
  /** Active company membership (null while loading or if user has none). */
  current: CompanyMembership | null;
  /** All active companies the user belongs to. */
  companies: CompanyMembership[];
  /** True while the first load is in progress. */
  loading: boolean;
  /** True if the user has zero companies (needs onboarding/invite). */
  hasNoCompany: boolean;
  /** Switch active company (multi-company users). */
  switchCompany: (orgId: string) => Promise<void>;
  /** Re-fetch from the DB (after a role/permission change). */
  refresh: () => Promise<void>;
};

const MembershipContext = createContext<MembershipState | null>(null);

export function MembershipProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [companies, setCompanies] = useState<CompanyMembership[]>([]);
  const [current, setCurrent] = useState<CompanyMembership | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setCompanies([]);
      setCurrent(null);
      setLoading(false);
      return;
    }
    setLoading(true);

    // Offline-first: hydrate from cache immediately so the UI has a role.
    const cached = await readCachedMemberships();
    if (cached && cached.length > 0) {
      setCompanies(cached);
      setCurrent(await pickActiveMembership(cached));
    }

    try {
      const list = await fetchMemberships(userId);
      // Fill in the user's display name from the Google session when the DB
      // didn't store one, so they always see their own name.
      const name = sessionDisplayName(session);
      if (name) for (const m of list) if (!m.fullName) m.fullName = name;

      setCompanies(list);
      const active = await pickActiveMembership(list);
      setCurrent(active);
      await cacheMemberships(list);

      // Best effort: persist the name to the membership so it also shows up in
      // the team list for admins (no-op if RLS forbids it).
      if (name && active) {
        supabase
          .from('memberships')
          .update({ full_name: name })
          .eq('user_id', userId)
          .eq('org_id', active.orgId)
          .is('full_name', null)
          .then(() => {}, () => {});
      }
    } catch {
      // Network error: keep cached values if we have them.
    } finally {
      setLoading(false);
    }
  }, [userId, session]);

  useEffect(() => {
    load();
  }, [load]);

  const switchCompany = useCallback(
    async (orgId: string) => {
      const match = companies.find((c) => c.orgId === orgId);
      if (!match) return;
      await AsyncStorage.setItem(ACTIVE_ORG_KEY, orgId);
      setCurrent(match);
    },
    [companies],
  );

  return (
    <MembershipContext.Provider
      value={{
        current,
        companies,
        loading,
        hasNoCompany: !loading && companies.length === 0,
        switchCompany,
        refresh: load,
      }}
    >
      {children}
    </MembershipContext.Provider>
  );
}

export function useMembership() {
  const ctx = useContext(MembershipContext);
  if (!ctx) throw new Error('useMembership must be used inside <MembershipProvider>');
  return ctx;
}
