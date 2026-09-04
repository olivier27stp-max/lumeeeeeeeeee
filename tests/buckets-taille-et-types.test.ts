/**
 * CHAQUE BUCKET A UN PLAFOND ET DES TYPES AUTORISÉS.
 *
 * CONSTAT DU 2026-09-04 (staging, session réelle d'un membre)
 * `avatars`, `company-logos` (publics) et `job-photos` n'avaient ni
 * limite de taille ni restriction de type. Un fichier de 30 Mo de zéros
 * y est entré sans broncher. Les limites de l'application (10 à 15 Mo,
 * image/*) vivent dans le navigateur et le relais serveur : un membre
 * qui parle directement à Supabase Storage n'en a aucune.
 *
 * Après la migration : HTML refusé (« mime type not supported »), PNG de
 * 30 Mo refusé (« exceeded the maximum allowed size »), PNG, SVG, HEIC,
 * vidéo et PDF-dans-attachments acceptés.
 *
 * CE QUE CES TESTS FIGENT
 * La migration couvre les trois buckets, ne touche pas `attachments`
 * (qui reçoit légitimement PDF et vidéos jusqu'à 50 Mo), et laisse
 * passer ce que les téléphones produisent vraiment.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '..', 'supabase/migrations/20260904180000_buckets_taille_et_types.sql'),
  'utf8',
);

/** Extrait, par bucket, la limite (en Mo) et les types déclarés. */
const BUCKETS = (() => {
  const out = new Map<string, { mo: number; types: string[] }>();
  const re = /file_size_limit\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024,\s*allowed_mime_types\s*=\s*array\[([^\]]+)\]\s*where id = '([\w-]+)'/g;
  for (const m of SRC.matchAll(re)) {
    out.set(m[3], { mo: Number(m[1]), types: m[2].split(',').map((s) => s.trim().replace(/'/g, '')) });
  }
  return out;
})();

describe('les buckets sans plafond en reçoivent un', () => {
  for (const b of ['avatars', 'company-logos', 'job-photos']) {
    it(`${b} a une limite de taille et des types`, () => {
      expect(BUCKETS.has(b)).toBe(true);
      expect(BUCKETS.get(b)!.mo).toBeGreaterThan(0);
      expect(BUCKETS.get(b)!.types.length).toBeGreaterThan(0);
    });
  }

  it('attachments n est pas touché', () => {
    // Il reçoit des PDF, des vidéos, des devis signés : tous types, 50 Mo.
    expect(BUCKETS.has('attachments')).toBe(false);
    expect(SRC).not.toMatch(/where id = 'attachments'/);
  });

  it('migration-files et director-panel ne sont pas touchés', () => {
    // Ils ont déjà leurs limites et ne sont accessibles qu'au serveur.
    expect(SRC).not.toMatch(/where id = 'migration-files'/);
    expect(SRC).not.toMatch(/where id = 'director-panel'/);
  });
});

describe('les plafonds laissent passer ce qui est légitime', () => {
  it('un avatar ou un logo accepte au moins 5 Mo', () => {
    // Une photo de téléphone moderne fait 3 à 5 Mo.
    expect(BUCKETS.get('avatars')!.mo).toBeGreaterThanOrEqual(5);
    expect(BUCKETS.get('company-logos')!.mo).toBeGreaterThanOrEqual(5);
  });

  it('une photo de job accepte au moins 20 Mo', () => {
    // Une courte vidéo de chantier dépasse facilement 10 Mo.
    expect(BUCKETS.get('job-photos')!.mo).toBeGreaterThanOrEqual(20);
  });

  it('job-photos accepte les vidéos, pas seulement les images', () => {
    expect(BUCKETS.get('job-photos')!.types).toContain('video/*');
  });

  it('les types sont des jokers, pas une liste fermée', () => {
    // `image/*` couvre HEIC, AVIF, WebP… Une liste fermée refuserait le
    // prochain format que sortira un téléphone.
    for (const b of ['avatars', 'company-logos', 'job-photos']) {
      expect(BUCKETS.get(b)!.types).toContain('image/*');
    }
  });

  it('aucun plafond ne dépasse 50 Mo', () => {
    // Au-delà, ce n'est plus une image : c'est un cours vidéo, et ceux-là
    // ont leur propre bucket (director-panel, 100 Mo).
    for (const [, v] of BUCKETS) expect(v.mo).toBeLessThanOrEqual(50);
  });
});
