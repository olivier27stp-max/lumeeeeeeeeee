/**
 * Recent Items Hook — tracks last visited entities across the CRM
 * Stores in localStorage, max 8 items, sorted by last access
 */

import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

export interface RecentItem {
  path: string;
  label: string;
  type: 'client' | 'job' | 'invoice' | 'quote' | 'lead';
  visitedAt: number;
}

const STORAGE_KEY = 'lume-recent-items';
const MAX_ITEMS = 8;

function loadRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRecent(items: RecentItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
}

export function useRecentItems() {
  const [items, setItems] = useState<RecentItem[]>(loadRecent);
  const location = useLocation();

  // Auto-track detail page visits
  useEffect(() => {
    const path = location.pathname;
    let type: RecentItem['type'] | null = null;
    let label = '';

    if (/^\/clients\/[a-f0-9-]+$/.test(path)) {
      type = 'client';
      label = 'Client';
    } else if (/^\/jobs\/[a-f0-9-]+$/.test(path)) {
      type = 'job';
      label = 'Job';
    } else if (/^\/invoices\/[a-f0-9-]+/.test(path)) {
      type = 'invoice';
      label = 'Invoice';
    } else if (/^\/quotes\/[a-f0-9-]+$/.test(path)) {
      type = 'quote';
      label = 'Quote';
    }

    if (type) {
      setItems(prev => {
        const filtered = prev.filter(i => i.path !== path);
        const updated = [{ path, label, type: type!, visitedAt: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
        saveRecent(updated);
        return updated;
      });
    }
  }, [location.pathname]);

  const addRecent = useCallback((path: string, label: string, type: RecentItem['type']) => {
    setItems(prev => {
      const filtered = prev.filter(i => i.path !== path);
      const updated = [{ path, label, type, visitedAt: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
      saveRecent(updated);
      return updated;
    });
  }, []);

  const updateLabel = useCallback((path: string, label: string) => {
    setItems(prev => {
      const updated = prev.map(i => i.path === path ? { ...i, label } : i);
      saveRecent(updated);
      return updated;
    });
  }, []);

  return { recentItems: items, addRecent, updateLabel };
}
