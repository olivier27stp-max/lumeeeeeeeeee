// Global app "mode": Technician vs Sales reps. Owner/admin can switch (in More);
// technicians are locked to 'tech', sales reps to 'sales'. The mode drives both
// the bottom tabs and the Home content — they differ per persona.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState } from 'react';

import { usePermissions } from './usePermissions';

export type ViewMode = 'tech' | 'sales';

interface ViewModeValue {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  canSwitch: boolean; // owner/admin only
}

const Ctx = createContext<ViewModeValue>({ mode: 'tech', setMode: () => {}, canSwitch: false });
const STORAGE_KEY = 'lume_view_mode';

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const { role } = usePermissions();
  const isManager = role === 'owner' || role === 'admin';
  const locked: ViewMode | null = role === 'sales_rep' ? 'sales' : role === 'technician' ? 'tech' : null;

  const [stored, setStored] = useState<ViewMode>('tech');
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'tech' || v === 'sales') setStored(v);
    });
  }, []);

  // Locked roles ignore the stored preference; managers use their saved choice.
  const mode: ViewMode = locked ?? (isManager ? stored : 'tech');

  const setMode = (m: ViewMode) => {
    setStored(m);
    AsyncStorage.setItem(STORAGE_KEY, m);
  };

  return <Ctx.Provider value={{ mode, setMode, canSwitch: isManager }}>{children}</Ctx.Provider>;
}

export const useViewMode = () => useContext(Ctx);
