import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  desktopNotificationsSupported,
  desktopNotificationPermission,
  desktopNotificationsEnabled,
  setDesktopNotificationsEnabled,
  requestDesktopNotificationPermission,
  showDesktopNotification,
} from '../../src/lib/desktopNotifications';

// The helper reads browser globals (Notification, document, localStorage) at
// call time. The vitest environment is 'node', so we stub them here and mutate
// their state per-test to exercise every guard branch.

const constructed: Array<{ title: string; options: NotificationOptions }> = [];

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  onclick: (() => void) | null = null;
  constructor(public title: string, public options: NotificationOptions = {}) {
    constructed.push({ title, options });
  }
  close() {}
}

function setForeground(visible: boolean, focused: boolean) {
  (globalThis as any).document.visibilityState = visible ? 'visible' : 'hidden';
  (globalThis as any).document.hasFocus = () => focused;
}

beforeEach(() => {
  constructed.length = 0;

  // localStorage stub
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };

  // document stub — default to backgrounded so notifications are allowed
  (globalThis as any).document = {};
  setForeground(false, false);

  // window + Notification stubs
  (globalThis as any).window = globalThis;
  (globalThis as any).window.focus = vi.fn();
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = vi.fn(async () => FakeNotification.permission);
  (globalThis as any).Notification = FakeNotification;
});

describe('desktopNotifications — capability + permission', () => {
  it('reports supported when Notification exists on window', () => {
    expect(desktopNotificationsSupported()).toBe(true);
  });

  it('reports unsupported when Notification is absent', () => {
    delete (globalThis as any).Notification;
    expect(desktopNotificationsSupported()).toBe(false);
    expect(desktopNotificationPermission()).toBe('denied');
    expect(desktopNotificationsEnabled()).toBe(false);
  });

  it('is not enabled unless permission is granted', () => {
    FakeNotification.permission = 'default';
    expect(desktopNotificationsEnabled()).toBe(false);
    FakeNotification.permission = 'denied';
    expect(desktopNotificationsEnabled()).toBe(false);
    FakeNotification.permission = 'granted';
    expect(desktopNotificationsEnabled()).toBe(true);
  });

  it('respects an explicit user opt-out even when granted', () => {
    setDesktopNotificationsEnabled(false);
    expect(desktopNotificationsEnabled()).toBe(false);
    setDesktopNotificationsEnabled(true);
    expect(desktopNotificationsEnabled()).toBe(true);
  });
});

describe('desktopNotifications — showDesktopNotification gating', () => {
  it('fires a native notification when backgrounded, granted and enabled', () => {
    setForeground(false, false);
    const fired = showDesktopNotification({ title: 'New lead', body: 'Jean Tremblay', tag: 'n1' });
    expect(fired).toBe(true);
    expect(constructed).toHaveLength(1);
    expect(constructed[0].title).toBe('New lead');
    expect(constructed[0].options.body).toBe('Jean Tremblay');
    expect(constructed[0].options.tag).toBe('n1');
  });

  it('stays silent when Lume is the focused/visible tab', () => {
    setForeground(true, true);
    const fired = showDesktopNotification({ title: 'New lead', body: 'x', tag: 'n2' });
    expect(fired).toBe(false);
    expect(constructed).toHaveLength(0);
  });

  it('force bypasses the foreground guard (confirmation notification)', () => {
    setForeground(true, true);
    const fired = showDesktopNotification({ title: 'Lume', body: 'enabled', tag: 't', force: true });
    expect(fired).toBe(true);
    expect(constructed).toHaveLength(1);
  });

  it('force still respects permission/opt-out', () => {
    setForeground(true, true);
    setDesktopNotificationsEnabled(false);
    const fired = showDesktopNotification({ title: 'x', force: true });
    expect(fired).toBe(false);
    expect(constructed).toHaveLength(0);
  });

  it('fires when visible but not focused (user on another window)', () => {
    setForeground(true, false);
    showDesktopNotification({ title: 'New lead', tag: 'n3' });
    expect(constructed).toHaveLength(1);
  });

  it('does nothing when permission is not granted', () => {
    FakeNotification.permission = 'denied';
    setForeground(false, false);
    showDesktopNotification({ title: 'x', tag: 'n4' });
    expect(constructed).toHaveLength(0);
  });

  it('does nothing when the user opted out', () => {
    setDesktopNotificationsEnabled(false);
    setForeground(false, false);
    showDesktopNotification({ title: 'x', tag: 'n5' });
    expect(constructed).toHaveLength(0);
  });
});

describe('desktopNotifications — requestDesktopNotificationPermission', () => {
  it('returns the granted result and enables notifications', async () => {
    FakeNotification.permission = 'default';
    FakeNotification.requestPermission = vi.fn(async () => {
      FakeNotification.permission = 'granted';
      return 'granted' as NotificationPermission;
    });
    const result = await requestDesktopNotificationPermission();
    expect(result).toBe('granted');
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
    expect(desktopNotificationsEnabled()).toBe(true);
  });

  it('does not enable when the user denies', async () => {
    FakeNotification.permission = 'default';
    FakeNotification.requestPermission = vi.fn(async () => {
      FakeNotification.permission = 'denied';
      return 'denied' as NotificationPermission;
    });
    const result = await requestDesktopNotificationPermission();
    expect(result).toBe('denied');
    expect(desktopNotificationsEnabled()).toBe(false);
  });
});
