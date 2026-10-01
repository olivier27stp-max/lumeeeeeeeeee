// @vitest-environment jsdom
//
// Statistiques (/insights) — corrections de l'audit du 2026-09-30 (STATS_AUDIT.md) qui se
// vérifient sans base : période calculée le soir, pagination sans plafond, valeur vie
// moyenne, et le VRAI rendu des mois de la carte Revenu à l'heure de Montréal.
// Les chiffres contre la base : tests/stats/*.integration.test.ts (stack locale).
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/i18n', () => ({ useTranslation: () => ({ language: 'fr', t: {} }) }));

import { periodRange } from '../src/lib/insightsPeriod';
import { toutesLesLignes, toutesLesLignesParId, toutesLesLignesEnParallele, TAILLE_PAGE } from '../src/lib/lignesPaginees';
import RevenueTrendCard from '../src/components/insights/RevenueTrendCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => { process.env.TZ = 'America/Toronto'; });

describe('periodRange — dates LOCALES, même le soir', () => {
  it('le 30 septembre à 21 h (Toronto, déjà le 1er octobre en UTC), « 12 derniers mois » finit le 30', () => {
    expect(periodRange('12m', new Date('2026-10-01T01:00:00Z'))).toMatchObject({ from: '2025-09-30', to: '2026-09-30' });
  });
  it('le 1er janvier à 00 h 30, « cette année » commence le 1er janvier', () => {
    expect(periodRange('ytd', new Date('2026-01-01T05:30:00Z'))).toMatchObject({ from: '2026-01-01', to: '2026-01-01' });
  });
  it('« 12 dernières semaines » = 84 jours, en semaines', () => {
    expect(periodRange('12w', new Date('2026-09-30T16:00:00Z'))).toEqual({ from: '2026-07-08', to: '2026-09-30', granularity: 'week' });
  });
});

describe('toutesLesLignes — aucune troncature silencieuse', () => {
  it('lit 2 500 lignes en 3 pages (PostgREST en rend 1 000 au plus)', async () => {
    const appels: Array<[number, number]> = [];
    const lignes = await toutesLesLignes(async (a, b) => {
      appels.push([a, b]);
      return { data: Array.from({ length: Math.max(0, Math.min(2500, b + 1) - a) }, (_, i) => a + i), error: null };
    });
    expect(lignes).toHaveLength(2500);
    expect(appels).toEqual([[0, TAILLE_PAGE - 1], [1000, 1999], [2000, 2999]]);
  });
  it('par curseur : chaque page reprend APRÈS le dernier id (pas d’OFFSET quadratique)', async () => {
    const ids = Array.from({ length: 2300 }, (_, i) => ({ id: String(i).padStart(5, '0') }));
    const curseurs: Array<string | null> = [];
    const lignes = await toutesLesLignesParId(async (apres) => {
      curseurs.push(apres);
      const reste = ids.filter((x) => apres == null || x.id > apres);
      return { data: reste.slice(0, TAILLE_PAGE), error: null };
    });
    expect(lignes).toHaveLength(2300);
    expect(curseurs).toEqual([null, '00999', '01999']);
  });
  it('en parallèle : le total vient de la 1re page, les autres partent ensemble', async () => {
    const lignes = await toutesLesLignesEnParallele(async (a, b, compter) => ({
      data: Array.from({ length: Math.max(0, Math.min(2500, b + 1) - a) }, (_, i) => a + i), error: null, count: compter ? 2500 : null,
    }));
    expect(lignes).toEqual(Array.from({ length: 2500 }, (_, i) => i));
  });
  it('une erreur remonte (pas de zéro silencieux)', async () => {
    await expect(toutesLesLignes(async () => ({ data: null, error: new Error('panne') }))).rejects.toThrow('panne');
  });
});

describe('RevenueTrendCard — chaque mois porte SON nom', () => {
  let racine: Root | null = null; let hote: HTMLDivElement | null = null;
  afterEach(() => { act(() => racine?.unmount()); hote?.remove(); });

  it('à Montréal, le point du 2026-09-01 s’appelle « sept. », pas « août »', async () => {
    hote = document.createElement('div'); document.body.appendChild(hote);
    racine = createRoot(hote);
    const points = [
      { debut: '2026-08-01', encaisseCents: 137970, factureCents: 0 },
      { debut: '2026-09-01', encaisseCents: 100483, factureCents: 0 },
    ];
    await act(async () => {
      racine!.render(<RevenueTrendCard points={points} granularite="month" chargement={false} erreur={false} onRetry={() => {}} onDetail={() => {}} />);
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const texte = hote.textContent ?? '';
    expect(texte).toMatch(/août/);
    expect(texte).toMatch(/sept\./);
    // Le total au cent près est porté par l'attribut title (l'infobulle arrondissait au dollar).
    expect(hote.querySelector('[data-cents]')?.getAttribute('data-cents')).toBe('238453');
    expect(hote.querySelector('[data-cents]')?.getAttribute('title')?.replace(/\s/g, ' ')).toBe('2 384,53 $');
  });
});
