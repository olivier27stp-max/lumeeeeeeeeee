/**
 * Thème clair / sombre — pour l'instant utilisé par l'écran Lumi seulement.
 *
 * Le reste de l'app est écrit en classes nativewind claires codées en dur
 * (`bg-white`, `text-ink`…) : lui donner un mode sombre voudrait dire reprendre
 * 208 fichiers, ce qui dépasse le mandat. Lumi, lui, est un écran neuf : il
 * lit sa palette ici et fonctionne dans les deux thèmes.
 *
 * Le réglage suit l'apparence du TÉLÉPHONE par défaut (`useColorScheme`, qui
 * demande `userInterfaceStyle: "automatic"` dans app.json), et l'utilisateur
 * peut le forcer depuis l'en-tête de Lumi ; son choix est gardé localement.
 *
 * ⚠️ Le web garde SA préférence dans `localStorage['lume-theme']` — donc dans
 * le navigateur, pas sur le compte. Il n'y a rien à lire depuis le téléphone.
 * Faire suivre le choix du web exigerait d'écrire la préférence sur le compte
 * (`auth user_metadata`, comme la langue le fait déjà dans lib/i18n) : c'est un
 * changement CÔTÉ WEB, hors mandat, en attente d'un OK.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

export type ChoixTheme = 'auto' | 'clair' | 'sombre';
const CLE = 'lume-theme-lumi';

export interface PaletteLumi {
  sombre: boolean;
  /** Fond de l'écran. */
  fond: string;
  /** Cartes, bulles, barre de saisie. */
  carte: string;
  /** Fond légèrement creusé (bulle utilisateur, chips). */
  creux: string;
  texte: string;
  texteDoux: string;
  texteTenu: string;
  bordure: string;
  bordureForte: string;
  /** Couleur d'action (noir en clair, blanc en sombre) + son texte. */
  action: string;
  texteSurAction: string;
  /** Vert de Lumi, identique au web (#3FAF97). */
  lumi: string;
  danger: string;
  dangerFond: string;
  succes: string;
  succesFond: string;
  attente: string;
  attenteFond: string;
}

const CLAIR: PaletteLumi = {
  sombre: false,
  fond: '#FAFAFA',
  carte: '#FFFFFF',
  creux: '#F5F5F5',
  texte: '#171717',
  texteDoux: '#525252',
  texteTenu: '#A3A3A3',
  bordure: '#E5E5E5',
  bordureForte: '#D4D4D4',
  action: '#171717',
  texteSurAction: '#FFFFFF',
  lumi: '#3FAF97',
  danger: '#DC2626',
  dangerFond: '#FEF2F2',
  succes: '#059669',
  succesFond: '#ECFDF5',
  attente: '#B45309',
  attenteFond: '#FFFBEB',
};

const SOMBRE: PaletteLumi = {
  sombre: true,
  fond: '#0B0B0C',
  carte: '#161618',
  creux: '#212124',
  texte: '#F5F5F5',
  texteDoux: '#A1A1A6',
  texteTenu: '#6E6E73',
  bordure: '#2A2A2E',
  bordureForte: '#3A3A3F',
  action: '#F5F5F5',
  texteSurAction: '#0B0B0C',
  lumi: '#4FC4AA',
  danger: '#F87171',
  dangerFond: '#2A1416',
  succes: '#34D399',
  succesFond: '#0E2620',
  attente: '#FBBF24',
  attenteFond: '#2A2213',
};

interface ValeurTheme {
  c: PaletteLumi;
  choix: ChoixTheme;
  setChoix: (v: ChoixTheme) => void;
}

const Ctx = createContext<ValeurTheme>({ c: CLAIR, choix: 'auto', setChoix: () => {} });

export function ThemeLumiProvider({ children }: { children: React.ReactNode }) {
  const systeme = useColorScheme();
  const [choix, setChoixState] = useState<ChoixTheme>('auto');

  useEffect(() => {
    AsyncStorage.getItem(CLE)
      .then((v) => {
        if (v === 'auto' || v === 'clair' || v === 'sombre') setChoixState(v);
      })
      .catch(() => {
        /* stockage indisponible : on reste sur « auto » */
      });
  }, []);

  const setChoix = (v: ChoixTheme) => {
    setChoixState(v);
    AsyncStorage.setItem(CLE, v).catch((e) => console.error('[lumi] thème non enregistré', e));
  };

  const valeur = useMemo<ValeurTheme>(() => {
    const sombre = choix === 'sombre' || (choix === 'auto' && systeme === 'dark');
    return { c: sombre ? SOMBRE : CLAIR, choix, setChoix };
  }, [choix, systeme]);

  return <Ctx.Provider value={valeur}>{children}</Ctx.Provider>;
}

export function useThemeLumi(): ValeurTheme {
  return useContext(Ctx);
}
