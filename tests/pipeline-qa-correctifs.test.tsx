// @vitest-environment jsdom
//
// Les correctifs de l'audit QA du 24 septembre 2026.
//
// Chaque test échoue sans son correctif. Ils protègent des défauts qui
// avaient tous en commun de MENTIR à l'utilisateur : un message de succès
// sans effet, une promesse que le code ne tenait pas, une clé technique
// affichée comme un libellé.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { libelleSource } from '../src/lib/pipeline/presentation';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── P0-5 : une seule table de libellés, quatre écrans ──────────
describe('P0-5 — les sources ont un nom lisible partout', () => {
  it('traduit les clés techniques', () => {
    // L'onglet Prévisions affichait « form_web » pendant qu'Historique
    // montrait « Formulaire web », sur la même donnée.
    expect(libelleSource('form_web', true)).toBe('Formulaire web');
    expect(libelleSource('manual', true)).toBe('Manuel');
    expect(libelleSource('d2d', true)).toBe('Porte-à-porte');
  });

  it('traduit en anglais aussi', () => {
    expect(libelleSource('form_web', false)).toBe('Web form');
    expect(libelleSource('manual', false)).toBe('Manual');
  });

  it('rend une source inconnue telle quelle', () => {
    // `deals.source` est du texte libre : un canal imprévu doit rester
    // reconnaissable, pas devenir « Autre ».
    expect(libelleSource('salon-2026', true)).toBe('salon-2026');
  });

  it('n existe qu à UN seul endroit', async () => {
    // Trois copies se contredisaient. Une quatrième réintroduirait le bug.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.join(process.cwd(), 'src');
    const copies: string[] = [];
    const parcourir = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) parcourir(p);
        else if (/\.tsx?$/.test(e.name)) {
          const t = fs.readFileSync(p, 'utf8');
          if (/function libelleSource\s*\(/.test(t)) copies.push(p);
        }
      }
    };
    parcourir(dir);
    expect(copies.map((c) => c.replace(/\\/g, '/').split('/src/')[1]))
      .toEqual(['lib/pipeline/presentation.ts']);
  });
});
