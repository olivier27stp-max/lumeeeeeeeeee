/**
 * FormPageHost — renders item-creation/edit forms full-page inside the CRM
 * shell content area (to the right of the sidebar, below the top bar) instead
 * of as a floating popup. The portal target #page-content-area is provided by
 * the app shell in App.tsx.
 *
 * Children should fill the host with `absolute inset-0` (the host is relative).
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function FormPageHost({ children, fullscreen }: { children: React.ReactNode; fullscreen?: boolean }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById('page-content-area'));
  }, []);

  // Fullscreen mode: for callers that are themselves fullscreen overlays
  // covering the shell (satellite measure) — the portal target would sit
  // underneath them and the form would be clipped.
  // z-[120]: above fullscreen pages (measure is z-50) but below the floating
  // pickers the form opens (ServicePicker is z-[130]).
  if (fullscreen) return <div className="fixed inset-0 z-[120]">{children}</div>;

  // Fallback: if the shell target isn't mounted yet, render in place so the
  // form is never lost (still functional, just not portaled).
  if (!host) return <>{children}</>;
  return createPortal(children, host);
}
