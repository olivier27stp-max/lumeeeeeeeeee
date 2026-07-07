import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimePostgresInsertPayload, RealtimePostgresUpdatePayload } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { useCompany } from '../contexts/CompanyContext';
import { showDesktopNotification } from '../lib/desktopNotifications';

interface Notification {
  id: string;
  is_read: boolean;
  org_id?: string;
  type?: string | null;
  title?: string;
  body?: string | null;
  entity_type?: string | null;
  [key: string]: unknown;
}

// Maps a notification's entity_type to the sidebar nav item(s) it belongs to,
// so the unread count can surface as a badge on the relevant page(s). A
// request badges both Requests and the pipeline (a submission creates a deal).
const ENTITY_TO_NAV: Record<string, string[]> = {
  invoice: ['invoices'],
  quote: ['quotes'],
  quote_deposit: ['quotes'],
  client: ['clients'],
  lead: ['requests'],
  request: ['requests', 'd2d-pipeline'],
  job: ['jobs'],
  event: ['schedule'],
  message: ['messages'],
};

interface RealtimeNotificationOptions {
  // Wired by App.tsx so the "new request" toast can navigate in-app.
  onViewRequests?: () => void;
  viewRequestsLabel?: string;
}

const isRequestNotification = (n: Notification) =>
  n.entity_type === 'request' || n.type === 'request_created';

export function useRealtimeNotifications(enabled: boolean, options?: RealtimeNotificationOptions) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [countsByNav, setCountsByNav] = useState<Record<string, number>>({});
  // Scope realtime + count to the current tenant — without this every user
  // received WebSocket pings for every notification across all tenants
  // (security + perf issue, see AUDIT_PERFORMANCE_2026_05_12.md).
  const { currentOrgId } = useCompany();
  const orgRef = useRef<string | null>(null);
  orgRef.current = currentOrgId ?? null;
  // Options in a ref so the realtime effect doesn't resubscribe every render.
  const optionsRef = useRef<RealtimeNotificationOptions | undefined>(options);
  optionsRef.current = options;

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
      const navIds = row.entity_type ? ENTITY_TO_NAV[row.entity_type] : undefined;
      for (const navId of navIds || []) counts[navId] = (counts[navId] || 0) + 1;
    }
    setCountsByNav(counts);
  }, []);

  const fetchUnreadTotal = useCallback(async () => {
    const org = orgRef.current;
    if (!org) return;
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org)
      .eq('is_read', false);
    setUnreadCount(count || 0);
  }, []);

  const resetCount = useCallback(() => {
    setUnreadCount(0);
    setCountsByNav({});
  }, []);

  // Mark every unread notification that badges the given nav item as read —
  // called when the user visits the page, so its sidebar badge clears.
  const markNavAsRead = useCallback(async (navId: string) => {
    const org = orgRef.current;
    if (!org) return;
    const entityTypes = Object.keys(ENTITY_TO_NAV).filter((t) => ENTITY_TO_NAV[t].includes(navId));
    if (entityTypes.length === 0) return;
    // Optimistic: a 'request' notification badges two navs, so clear every
    // nav those entity types feed, not just the visited one.
    setCountsByNav((prev) => {
      const next = { ...prev };
      for (const t of entityTypes) for (const nav of ENTITY_TO_NAV[t]) delete next[nav];
      return next;
    });
    await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('org_id', org)
      .eq('is_read', false)
      .in('entity_type', entityTypes);
    // Re-sync exact counts (realtime UPDATE events also do this, but they can
    // be dropped when the tab is backgrounded).
    fetchCounts();
    fetchUnreadTotal();
  }, [fetchCounts, fetchUnreadTotal]);

  useEffect(() => {
    if (!enabled || !currentOrgId) {
      setUnreadCount(0);
      setCountsByNav({});
      return;
    }

    // Initial fetches — filter by org_id
    fetchUnreadTotal();
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
            // In-app popup when a client request lands (public form submission).
            if (isRequestNotification(payload.new)) {
              const opts = optionsRef.current;
              toast.info(payload.new.title || 'Lume', {
                description: payload.new.body || undefined,
                duration: 8000,
                action: opts?.onViewRequests
                  ? { label: opts.viewRequestsLabel || 'View', onClick: () => opts.onViewRequests?.() }
                  : undefined,
              });
            }
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
  }, [enabled, currentOrgId, fetchCounts, fetchUnreadTotal]);

  return { unreadCount, resetCount, countsByNav, markNavAsRead };
}
