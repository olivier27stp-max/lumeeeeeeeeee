import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimePostgresInsertPayload, RealtimePostgresUpdatePayload } from '@supabase/supabase-js';
import { useCompany } from '../contexts/CompanyContext';
import { showDesktopNotification } from '../lib/desktopNotifications';

interface Notification {
  id: string;
  is_read: boolean;
  org_id?: string;
  title?: string;
  body?: string | null;
  entity_type?: string | null;
  [key: string]: unknown;
}

// Maps a notification's entity_type to the sidebar nav item it belongs to, so
// the unread count can surface as a badge on the relevant page.
const ENTITY_TO_NAV: Record<string, string> = {
  invoice: 'invoices',
  quote: 'quotes',
  quote_deposit: 'quotes',
  client: 'clients',
  lead: 'requests',
  request: 'requests',
  job: 'jobs',
  event: 'schedule',
  message: 'messages',
};

export function useRealtimeNotifications(enabled: boolean) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [countsByNav, setCountsByNav] = useState<Record<string, number>>({});
  // Scope realtime + count to the current tenant — without this every user
  // received WebSocket pings for every notification across all tenants
  // (security + perf issue, see AUDIT_PERFORMANCE_2026_05_12.md).
  const { currentOrgId } = useCompany();
  const orgRef = useRef<string | null>(null);
  orgRef.current = currentOrgId ?? null;

  // Tally unread notifications into per-page counts. Unread volume is small
  // (alerts are deduped), so a full refetch on each change is cheap.
  const fetchCounts = useCallback(async () => {
    const org = orgRef.current;
    if (!org) return;
    const { data } = await supabase
      .from('notifications')
      .select('entity_type')
      .eq('org_id', org)
      .eq('is_read', false)
      .limit(500);
    const counts: Record<string, number> = {};
    for (const row of (data || []) as Array<{ entity_type: string | null }>) {
      const navId = row.entity_type ? ENTITY_TO_NAV[row.entity_type] : undefined;
      if (navId) counts[navId] = (counts[navId] || 0) + 1;
    }
    setCountsByNav(counts);
  }, []);

  const resetCount = useCallback(() => {
    setUnreadCount(0);
    setCountsByNav({});
  }, []);

  useEffect(() => {
    if (!enabled || !currentOrgId) {
      setUnreadCount(0);
      setCountsByNav({});
      return;
    }

    // Initial fetches — filter by org_id
    const fetchCount = async () => {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', currentOrgId)
        .eq('is_read', false);
      setUnreadCount(count || 0);
    };
    fetchCount();
    fetchCounts();

    // Subscribe to realtime changes scoped to this org
    const orgFilter = `org_id=eq.${currentOrgId}`;
    const channel = supabase
      .channel(`notifications-realtime-${currentOrgId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: orgFilter },
        (payload: RealtimePostgresInsertPayload<Notification>) => {
          if (!payload.new.is_read) {
            setUnreadCount((prev) => prev + 1);
            // Surface a native OS notification when Lume isn't the active tab.
            showDesktopNotification({
              title: payload.new.title || 'Lume',
              body: payload.new.body,
              tag: payload.new.id,
            });
          }
          fetchCounts();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: orgFilter },
        (payload: RealtimePostgresUpdatePayload<Notification>) => {
          if (payload.old && !payload.old.is_read && payload.new.is_read) {
            setUnreadCount((prev) => Math.max(0, prev - 1));
          }
          if (payload.old && payload.old.is_read && !payload.new.is_read) {
            setUnreadCount((prev) => prev + 1);
          }
          fetchCounts();
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'notifications', filter: orgFilter },
        () => { fetchCounts(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, currentOrgId, fetchCounts]);

  return { unreadCount, resetCount, countsByNav };
}
