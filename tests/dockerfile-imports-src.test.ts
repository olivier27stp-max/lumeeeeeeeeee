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

/** Résout un import relatif vers un fichier .ts/.tsx existant (ou null si hors dépôt / paquet). */
function resoudre(depuis: string, chemin: string): string | null {
  const base = resolve(depuis, '..', chemin);
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), base]) {
    try { if (statSync(c).isFile()) return c; } catch { /* suivant */ }
  }
  return null;
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

  it('aucun import src/ orphelin, même INDIRECT (un fichier copié qui en importe un autre)', () => {
    /*
     * 2026-09-30 : fonctionsData.ts (copié, importé par search_help) s'est mis
     * à importer lumiCreditsFormat.ts, qui importe src/i18n — ni l'un ni
     * l'autre dans l'image. Le premier test ne regardait que les imports
     * DIRECTS du serveur : il est resté vert, et la prod a répondu 502 près
     * de deux heures. On suit maintenant toute la chaîne.
     */
    const docker = readFileSync(join(racine, 'Dockerfile'), 'utf8');
    const copies = new Set([...docker.matchAll(/^COPY (src\/[^\s]+) /gm)].map((m) => m[1]));
    const aVisiter = [...copies].map((c) => join(racine, c));
    const vus = new Set<string>();
    const manquants: string[] = [];
    while (aVisiter.length) {
      const f = aVisiter.pop()!; // pop() sur un tableau non vide : jamais undefined
      if (vus.has(f)) continue;
      vus.add(f);
      let texte = '';
      try { texte = readFileSync(f, 'utf8'); } catch { continue; }
      for (const m of texte.matchAll(/(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g)) {
        if (/^import type /m.test(texte.slice(Math.max(0, (m.index ?? 0) - 200), m.index ?? 0).split('\n').pop() ?? '')) continue;
        const cible = resoudre(f, m[1]);
        if (!cible) continue;
        const rel = relative(racine, cible).replace(/\\/g, '/');
        if (!rel.startsWith('src/')) continue;
        if (!copies.has(rel)) manquants.push(`${relative(racine, f).replace(/\\/g, '/')} → ${rel}`);
        else aVisiter.push(cible);
      }
    }
    expect(manquants).toEqual([]);
  });
});
