/**
 * LE DOCKERFILE QUI COPIE UN FICHIER DISPARU.
 *
 * Le 2026-09-09, l'audit I3 a déplacé crypto.ts, stripeClient.ts et
 * paypalClient.ts de src/lib/ vers server/lib/. Tests verts, typecheck vert,
 * build Vite vert, CI verte… et le déploiement Railway a échoué en silence :
 * le Dockerfile copiait encore ces trois fichiers un par un. La prod est
 * restée sur l'ancien build sans qu'aucun signal ne remonte ici.
 *
 * Ce test lit chaque `COPY` du Dockerfile (hors `--from=`, qui copie depuis
 * une étape précédente) et vérifie que la source existe dans le dépôt.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');

describe('chaque COPY du Dockerfile pointe sur un chemin du dépôt', () => {
  const lignes = readFileSync(resolve(RACINE, 'Dockerfile'), 'utf8').split('\n');
  const copies = lignes
    .map((l, i) => ({ l: l.trim(), n: i + 1 }))
    .filter(({ l }) => /^COPY\s/.test(l) && !/--from=/.test(l));

  it('il y a bien des COPY à vérifier', () => {
    expect(copies.length).toBeGreaterThan(0);
  });

  for (const { l, n } of copies) {
    // COPY [--chown=...] <src>... <dest> : tout sauf le dernier argument.
    const args = l.replace(/^COPY\s+/, '').split(/\s+/).filter((a) => !a.startsWith('--'));
    const sources = args.slice(0, -1);
    for (const src of sources) {
      it(`ligne ${n} : ${src} existe`, () => {
        expect(existsSync(resolve(RACINE, src)), `${src} est copié par le Dockerfile mais n'existe plus`).toBe(true);
      });
    }
  }
});
