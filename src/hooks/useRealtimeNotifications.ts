import { useEffect, useState, useCallback } from 'react';
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
  [key: string]: unknown;
}

export function useRealtimeNotifications(enabled: boolean) {
  const [unreadCount, setUnreadCount] = useState(0);
  // Scope realtime + count to the current tenant — without this every user
  // received WebSocket pings for every notification across all tenants
  // (security + perf issue, see AUDIT_PERFORMANCE_2026_05_12.md).
  const { currentOrgId } = useCompany();

  const resetCount = useCallback(() => {
    setUnreadCount(0);
  }, []);

  useEffect(() => {
    if (!enabled || !currentOrgId) {
      setUnreadCount(0);
      return;
    }

    // Initial count fetch — filter by org_id
    const fetchCount = async () => {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', currentOrgId)
        .eq('is_read', false);
      setUnreadCount(count || 0);
    };
    fetchCount();

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
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, currentOrgId]);

  return { unreadCount, resetCount };
}
