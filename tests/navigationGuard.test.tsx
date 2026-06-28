// @vitest-environment jsdom
import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { UNSAFE_NavigationContext } from 'react-router-dom';
import { NavigationGuardProvider, useNavigationGuard } from '../src/contexts/NavigationGuard';

type GuardApi = ReturnType<typeof useNavigationGuard>;

function makeNavigator() {
  const calls: Array<{ method: string; args: any[] }> = [];
  return {
    push: (...args: any[]) => { calls.push({ method: 'push', args }); },
    replace: (...args: any[]) => { calls.push({ method: 'replace', args }); },
    go: (..._args: any[]) => {},
    calls,
  };
}

let latestGuard: GuardApi | null = null;
function Consumer({ when }: { when: boolean }) {
  latestGuard = useNavigationGuard(when);
  return null;
}

function Harness({ navigator, when }: { navigator: any; when: boolean }) {
  return (
    <UNSAFE_NavigationContext.Provider value={{ navigator, basename: '/' } as any}>
      <NavigationGuardProvider>
        <Consumer when={when} />
      </NavigationGuardProvider>
    </UNSAFE_NavigationContext.Provider>
  );
}

describe('NavigationGuard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latestGuard = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(navigator: any, when: boolean) {
    act(() => root.render(<Harness navigator={navigator} when={when} />));
  }

  it('lets navigation through when the form is not dirty', () => {
    const nav = makeNavigator();
    render(nav, false);
    act(() => nav.push('/somewhere'));
    expect(nav.calls).toEqual([{ method: 'push', args: ['/somewhere'] }]);
    expect(latestGuard!.active).toBe(false);
  });

  it('blocks navigation when dirty and surfaces the prompt', () => {
    const nav = makeNavigator();
    render(nav, true);
    act(() => nav.push('/leave'));
    // navigation parked, not executed
    expect(nav.calls).toEqual([]);
    expect(latestGuard!.active).toBe(true);
  });

  it('confirmLeave runs the parked navigation with original args', () => {
    const nav = makeNavigator();
    render(nav, true);
    act(() => nav.replace('/quotes/42', { state: 1 }));
    expect(nav.calls).toEqual([]);
    expect(latestGuard!.active).toBe(true);
    act(() => latestGuard!.confirmLeave());
    expect(nav.calls).toEqual([{ method: 'replace', args: ['/quotes/42', { state: 1 }] }]);
    expect(latestGuard!.active).toBe(false);
  });

  it('cancelLeave discards the parked navigation', () => {
    const nav = makeNavigator();
    render(nav, true);
    act(() => nav.push('/leave'));
    act(() => latestGuard!.cancelLeave());
    expect(nav.calls).toEqual([]);
    expect(latestGuard!.active).toBe(false);
  });

  it('release() lets the immediate next navigation through without a prompt', () => {
    const nav = makeNavigator();
    render(nav, true);
    // Simulate a successful save: release synchronously, then navigate.
    act(() => {
      latestGuard!.release();
      nav.push('/quotes/99');
    });
    expect(nav.calls).toEqual([{ method: 'push', args: ['/quotes/99'] }]);
    expect(latestGuard!.active).toBe(false);
  });

  it('works correctly under StrictMode (mount→cleanup→mount, no double-wrap)', () => {
    const nav = makeNavigator();
    const originalPush = nav.push;
    act(() =>
      root.render(
        <React.StrictMode>
          <Harness navigator={nav} when={true} />
        </React.StrictMode>,
      ),
    );
    // Still patched once and functioning: a dirty nav is blocked.
    act(() => nav.push('/leave'));
    expect(nav.calls).toEqual([]);
    expect(latestGuard!.active).toBe(true);
    // Confirm runs the original exactly once (not twice from double-wrapping).
    act(() => latestGuard!.confirmLeave());
    expect(nav.calls).toEqual([{ method: 'push', args: ['/leave'] }]);
    // After full unmount, the original method is restored.
    act(() => root.unmount());
    expect(nav.push).toBe(originalPush);
    root = createRoot(container);
  });

  it('restores the original navigator methods on unmount', () => {
    const nav = makeNavigator();
    const originalPush = nav.push;
    render(nav, true);
    expect(nav.push).not.toBe(originalPush); // patched
    act(() => root.unmount());
    expect(nav.push).toBe(originalPush); // restored
    // re-create root so afterEach unmount is a no-op-safe
    root = createRoot(container);
  });
});
