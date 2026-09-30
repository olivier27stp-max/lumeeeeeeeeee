/**
 * Thème clair / sombre de TOUTE l'app (2026-09-30).
 *
 * Avant, ce fichier ne servait qu'à l'écran Lumi, faute de quoi on aurait eu
 * « un Lumi noir au milieu d'une app blanche ». Le reste de l'app est maintenant
 * peint avec des jetons sémantiques dont les valeurs vivent dans
 * src/global.css (:root / .dark:root) — les MÊMES couleurs que les palettes
 * CLAIR/SOMBRE ci-dessous, pour qu'il n'existe qu'une vérité.
 *
 * Ce fournisseur est monté à la RACINE (src/app/_layout.tsx) et fait deux
 * choses :
 *   1. il sert la palette aux endroits qui ont besoin d'une couleur en valeur
 *      (props `tintColor`, `style={{…}}`, cartes, graphiques) via useThemeLumi() ;
 *   2. il pousse le choix dans nativewind (`colorScheme`), ce qui permute les
 *      variables CSS et donc toutes les classes `bg-surface`, `text-ink`…
 *
 * Par défaut CLAIR, volontairement : on ne suit pas l'apparence du téléphone
 * tant que l'utilisateur n'a pas choisi. Le choix est gardé localement.
 *
 * ⚠️ Le web garde SA préférence dans `localStorage['lume-theme']` — donc dans
 * le navigateur, pas sur le compte. Il n'y a rien à lire depuis le téléphone.
 * Faire suivre le choix du web exigerait d'écrire la préférence sur le compte
 * (`auth user_metadata`, comme la langue le fait déjà dans lib/i18n) : c'est un
 * changement CÔTÉ WEB, hors mandat, en attente d'un OK.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colorScheme } from 'nativewind';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type ChoixTheme = 'clair' | 'sombre';
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
  /** Accent de Lumi = l'encre de l'app (#171717). Le web a un vert à lui ;
   *  l'app mobile est monochrome, et Lumi doit suivre l'app, pas le web. */
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
  lumi: '#171717',
  danger: '#DC2626',
  dangerFond: '#FEF2F2',
  succes: '#059669',
  succesFond: '#ECFDF5',
  attente: '#D97706',
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
  lumi: '#F5F5F5',
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

const Ctx = createContext<ValeurTheme>({ c: CLAIR, choix: 'clair', setChoix: () => {} });

export function ThemeLumiProvider({ children }: { children: React.ReactNode }) {
  const [choix, setChoixState] = useState<ChoixTheme>('clair');

  useEffect(() => {
    AsyncStorage.getItem(CLE)
      .then((v) => {
        if (v === 'clair' || v === 'sombre') setChoixState(v);
      })
      .catch(() => {
        /* stockage indisponible : on reste en clair */
      });
  }, []);

  const setChoix = (v: ChoixTheme) => {
    setChoixState(v);
    AsyncStorage.setItem(CLE, v).catch((e) => console.error('[lumi] thème non enregistré', e));
  };

  // Les classes Tailwind suivent le même choix : nativewind pose (ou retire) la
  // classe `dark`, ce qui permute les variables de global.css.
  useEffect(() => {
    colorScheme.set(choix === 'sombre' ? 'dark' : 'light');
  }, [choix]);

  const valeur = useMemo<ValeurTheme>(() => ({ c: choix === 'sombre' ? SOMBRE : CLAIR, choix, setChoix }), [choix]);

  return <Ctx.Provider value={valeur}>{children}</Ctx.Provider>;
}

export function useThemeLumi(): ValeurTheme {
  return useContext(Ctx);
}
