/**
 * L'image de production ne copie que `server/` et une liste explicite de
 * fichiers `src/` (Dockerfile). Un import `src/...` ajouté côté serveur sans
 * sa ligne COPY fait crasher le conteneur au démarrage : prod entière en 502
 * le 2026-09-14 (search_help → fonctionsData.ts). Ce test croise les deux.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const racine = resolve(__dirname, '..');
function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? fichiers(p) : p.endsWith('.ts') ? [p] : []; });
}

describe('Dockerfile : chaque fichier src/ importé par le serveur est copié dans l image', () => {
  it('aucun import src/ orphelin', () => {
    const docker = readFileSync(join(racine, 'Dockerfile'), 'utf8');
    const copies = new Set([...docker.matchAll(/^COPY (src\/[^\s]+) /gm)].map((m) => m[1]));
    const manquants: string[] = [];
    for (const f of fichiers(join(racine, 'server'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/from '((?:\.\.\/)+)(src\/[^']+)'/g)) {
        const cible = `${m[2]}.ts`;
        if (!copies.has(cible)) manquants.push(`${relative(racine, f)} → ${cible}`);
      }
    }
    expect(manquants).toEqual([]);
  });
});
