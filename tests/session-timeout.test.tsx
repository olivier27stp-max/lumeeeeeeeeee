// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const signOutMock = vi.fn(async () => {});
vi.mock('../src/hooks/useLiveLocationTracking', () => ({
  endTrackingAndSignOut: () => signOutMock(),
}));

import {
  useSessionTimeout,
  SESSION_TIMEOUT_MS,
  WARNING_BEFORE_MS,
  SESSION_WARNING_EVENT,
} from '../src/hooks/useSessionTimeout';

function Harness({ userId }: { userId: string | null }) {
  useSessionTimeout(userId);
  return null;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function mount(userId: string | null) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Harness userId={userId} />); });
}

beforeEach(() => {
  vi.useFakeTimers();
  signOutMock.mockClear();
  // jsdom has no navigation; the hook assigns window.location.href on timeout.
  delete (window as any).location;
  (window as any).location = { href: '/' };
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  vi.useRealTimers();
});

describe('useSessionTimeout', () => {
  it('signs out after 4 hours of inactivity', async () => {
    mount('user-1');

    await act(async () => { await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS - 1000); });
    expect(signOutMock).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('warns 5 minutes before signing out', async () => {
    const onWarn = vi.fn();
    window.addEventListener(SESSION_WARNING_EVENT, onWarn);
    mount('user-1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS - WARNING_BEFORE_MS - 1000);
    });
    expect(onWarn).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(signOutMock).not.toHaveBeenCalled();

    window.removeEventListener(SESSION_WARNING_EVENT, onWarn);
  });

  it('resets the timer on a scroll inside a nested container (does not bubble)', async () => {
    mount('user-1');

    const scroller = document.createElement('div');
    container.appendChild(scroller);

    await act(async () => { await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS - 1000); });

    // `scroll` does not bubble — only a capture-phase listener sees this.
    act(() => { scroller.dispatchEvent(new Event('scroll', { bubbles: false })); });

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(signOutMock).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS); });
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when signed out', async () => {
    mount(null);
    await act(async () => { await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS * 2); });
    expect(signOutMock).not.toHaveBeenCalled();
  });
});
