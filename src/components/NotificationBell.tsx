import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, X, AlertTriangle, Info, CheckCircle2, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';

interface Notification {
  id: string;
  type: string;
  category: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const res = await fetch('/api/notifications/unread-count', { headers });
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.count || 0);
      }
    } catch { /* silent */ }
  }, []);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const res = await fetch('/api/notifications', { headers });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
        setUnreadCount(data.filter((n: Notification) => !n.read_at).length);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      await fetch('/api/notifications/read', { method: 'POST', headers, body: '{}' });
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
      setUnreadCount(0);
    } catch { /* silent */ }
  }, []);

  const dismissNotif = useCallback(async (id: string) => {
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      await fetch(`/api/notifications/${id}`, { method: 'DELETE', headers });
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch { /* silent */ }
  }, []);

  // Poll every 60s
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 60_000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Load full list when opened
  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, fetchNotifications]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) && bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler); };
  }, [open]);

  const iconForType = (type: string) => {
    if (type === 'alert') return <AlertTriangle size={14} className="text-amber-500" />;
    if (type === 'success') return <CheckCircle2 size={14} className="text-emerald-500" />;
    if (type === 'action_required') return <Zap size={14} className="text-rose-500" />;
    return <Info size={14} className="text-text-secondary" />;
  };

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <>
      <button
        ref={bellRef}
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg hover:bg-surface-secondary transition-colors text-text-secondary"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && createPortal(
        <AnimatePresence>
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            style={{ position: 'fixed', top: 56, right: 16, zIndex: 9999, width: 380 }}
            className="bg-surface border border-outline rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-outline">
              <h3 className="text-sm font-bold text-text-primary">Notifications</h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-[11px] text-primary font-medium hover:underline">
                    Mark all read
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-surface-secondary text-text-tertiary">
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="max-h-[420px] overflow-y-auto">
              {loading && notifications.length === 0 && (
                <div className="p-6 text-center text-text-tertiary text-sm">Loading...</div>
              )}
              {!loading && notifications.length === 0 && (
                <div className="p-8 text-center">
                  <Bell size={28} className="mx-auto text-text-tertiary opacity-30 mb-2" />
                  <p className="text-sm text-text-tertiary">No notifications yet</p>
                </div>
              )}
              {notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 border-b border-outline/50 transition-colors hover:bg-surface-secondary/50',
                    !notif.read_at && 'bg-primary/[0.03]'
                  )}
                >
                  <div className="mt-0.5 shrink-0">{iconForType(notif.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn('text-[13px] leading-tight', !notif.read_at ? 'font-semibold text-text-primary' : 'text-text-secondary')}>
                        {notif.title}
                      </p>
                      <button onClick={() => dismissNotif(notif.id)} className="shrink-0 p-0.5 rounded hover:bg-surface-secondary text-text-tertiary">
                        <X size={12} />
                      </button>
                    </div>
                    {notif.body && <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-2">{notif.body}</p>}
                    <p className="text-[10px] text-text-tertiary mt-1">{timeAgo(notif.created_at)}</p>
                  </div>
                  {!notif.read_at && <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                </div>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
