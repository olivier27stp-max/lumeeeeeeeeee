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

export default function FormPageHost({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById('page-content-area'));
  }, []);

  // Fallback: if the shell target isn't mounted yet, render in place so the
  // form is never lost (still functional, just not portaled).
  if (!host) return <>{children}</>;
  return createPortal(children, host);
}
