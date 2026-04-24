import { useEffect } from 'react';

/**
 * Toggles the command palette when the user presses Ctrl+K or Cmd+K.
 * Expects a state setter; prevents the browser's default search-bar focus.
 */
export function useCommandPaletteShortcut(setOpen: (updater: (prev: boolean) => boolean) => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [setOpen]);
}
