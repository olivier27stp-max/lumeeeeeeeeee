// Native OS desktop notifications (foreground only — no service worker / web push).
// Fires a real Windows/macOS notification when a new in-app notification arrives
// AND the Lume tab is not the focused/visible tab. When the user is actively
// looking at Lume, the in-app toast/bell already covers it, so we stay silent.

const PREF_KEY = 'lume-desktop-notifs';

export function desktopNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function desktopNotificationPermission(): NotificationPermission {
  if (!desktopNotificationsSupported()) return 'denied';
  return Notification.permission;
}

// User opt-in is stored separately from the browser permission so a user can
// have granted the browser permission once but later disable it inside Lume.
export function desktopNotificationsEnabled(): boolean {
  if (!desktopNotificationsSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setDesktopNotificationsEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch { /* ignore */ }
}

// Must be called from a user gesture (e.g. a button click) — browsers reject
// requestPermission() otherwise.
export async function requestDesktopNotificationPermission(): Promise<NotificationPermission> {
  if (!desktopNotificationsSupported()) return 'denied';
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') setDesktopNotificationsEnabled(true);
    return result;
  } catch {
    return Notification.permission;
  }
}

interface DesktopNotifyInput {
  title: string;
  body?: string | null;
  tag?: string;
}

export function showDesktopNotification({ title, body, tag }: DesktopNotifyInput): void {
  if (!desktopNotificationsEnabled()) return;
  // Only notify at the OS level when the user is NOT actively viewing Lume.
  const inForeground =
    document.visibilityState === 'visible' &&
    (typeof document.hasFocus !== 'function' || document.hasFocus());
  if (inForeground) return;

  try {
    const notif = new Notification(title, {
      body: body || undefined,
      icon: '/lume-logo-v2.png',
      badge: '/lume-logo-v2.png',
      tag, // same tag replaces a previous notification instead of stacking
    });
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
  } catch { /* ignore — some browsers throw if invoked outside a SW */ }
}
