// @vitest-environment jsdom
/**
 * Le français est la langue par défaut du site et de l'app, sans condition.
 *
 * Décision du 2026-09-23 : un visiteur qui n'a jamais choisi voit le français,
 * MÊME si son navigateur est configuré en anglais. Un Windows/Chrome en anglais
 * est très courant au Québec ; suivre `navigator.languages` servait donc de
 * l'anglais à une majorité de visiteurs locaux, à l'inverse de ce que la Charte
 * de la langue française demande d'un service offert ici.
 *
 * L'anglais n'apparaît que sur un choix EXPLICITE : le sélecteur de région du
 * site (qui écrit `lume-language`) ou la préférence du compte
 * (user_metadata.language, appliquée par LanguageProvider après connexion).
 *
 * Ce test est un cliquet : il échoue si quelqu'un remet une détection de la
 * langue du navigateur dans le choix initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      updateUser: () => Promise.resolve({ data: null, error: null }),
    },
  },
}));

/** Impose la liste de locales que le navigateur annoncerait. */
function simulerNavigateur(locales: string[]) {
  Object.defineProperty(window.navigator, 'languages', { value: locales, configurable: true });
  Object.defineProperty(window.navigator, 'language', { value: locales[0] ?? '', configurable: true });
}

describe('langue par défaut', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('sert le français à un visiteur dont le navigateur est en anglais', async () => {
    simulerNavigateur(['en-US', 'en']);
    const { useTranslation, LanguageProvider } = await import('../src/i18n/LanguageContext');
    expect(langueRendue(LanguageProvider, useTranslation)).toBe('fr');
  });

  it('sert le français à un navigateur en français', async () => {
    simulerNavigateur(['fr-CA', 'fr']);
    const { useTranslation, LanguageProvider } = await import('../src/i18n/LanguageContext');
    expect(langueRendue(LanguageProvider, useTranslation)).toBe('fr');
  });

  it('sert le français à un navigateur dans une tout autre langue', async () => {
    simulerNavigateur(['es-MX', 'pt-BR']);
    const { useTranslation, LanguageProvider } = await import('../src/i18n/LanguageContext');
    expect(langueRendue(LanguageProvider, useTranslation)).toBe('fr');
  });

  it("respecte l'anglais quand il a été choisi explicitement", async () => {
    simulerNavigateur(['fr-CA']);
    localStorage.setItem('lume-language', 'en');
    const { useTranslation, LanguageProvider } = await import('../src/i18n/LanguageContext');
    expect(langueRendue(LanguageProvider, useTranslation)).toBe('en');
  });

  it('retombe sur le français si le stockage est indisponible (mode privé)', async () => {
    simulerNavigateur(['en-US']);
    const vrai = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('stockage bloqué'); };
    try {
      const { useTranslation, LanguageProvider } = await import('../src/i18n/LanguageContext');
      expect(langueRendue(LanguageProvider, useTranslation)).toBe('fr');
    } finally {
      Storage.prototype.getItem = vrai;
    }
  });

  it("le choix initial ne consulte plus la langue du navigateur", () => {
    const source = readFileSync(resolve(__dirname, '../src/i18n/LanguageContext.tsx'), 'utf8');
    const debut = source.indexOf('function getInitialLanguage');
    const fin = source.indexOf('export function LanguageProvider');
    expect(debut).toBeGreaterThan(-1);
    const corps = source.slice(debut, fin);
    // Les mentions en commentaire expliquent justement pourquoi on ne le fait
    // pas : on ne regarde que le code, commentaires retirés.
    const code = corps.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/navigator\s*\.\s*languages?/);
  });

  it('le document HTML servi est en français', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
    expect(html).toMatch(/<html[^>]*\slang="fr"/);
  });

  it('la région par défaut du site marketing est le Canada français', async () => {
    const { readRegion } = await import('../src/hooks/useRegion');
    expect(readRegion()).toBe('ca-fr');
  });
});

/** Monte le provider et retourne la langue effectivement rendue. */
function langueRendue(
  LanguageProvider: React.ComponentType<{ children: React.ReactNode }>,
  useTranslation: () => { language: string }
): string {
  const React = require('react') as typeof import('react');
  const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');
  let vue = '';
  function Sonde() {
    vue = useTranslation().language;
    return null;
  }
  renderToStaticMarkup(React.createElement(LanguageProvider, null, React.createElement(Sonde)));
  return vue;
}
