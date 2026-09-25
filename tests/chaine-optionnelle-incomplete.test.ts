// `a?.b.c` ne protège que `a` — pas `b`.
//
// CE QUE CE TEST PROTÈGE. Écrire `settingsPayload?.settings.default_provider`
// donne l'impression d'être prudent : le `?.` rassure. Mais il ne couvre que
// le PREMIER maillon. Si la réponse du serveur arrive sans `settings`, la
// lecture de `.default_provider` casse — et l'écran affiche « Cannot read
// properties of undefined (reading 'default_provider') ».
//
// C'est ce que Rafba a vu en production le 2026-09-25. Le fichier fautif
// savait pourtant que le champ pouvait manquer : vingt lignes plus haut,
// `if (!settingsPayload?.settings) return []`. Une seule ligne avait oublié
// la garde.
//
// On interdit donc le motif là où il lit une réponse serveur. Les refs DOM
// (`ref.current?.dataset.x`, `ref.current?.style.y`) restent permises : quand
// l'élément existe, `dataset` et `style` existent toujours.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** Tous les .ts/.tsx de src/, sans les tests. */
function fichiersSrc(dir = 'src'): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...fichiersSrc(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Propriétés d'objets natifs toujours présentes dès que leur porteur existe.
 * Les lire après `?.` ne peut pas casser.
 */
const SURES = new Set([
  'dataset', 'style', 'classList', 'current', 'length', 'value', 'checked',
  'files', 'parentElement', 'children', 'target', 'currentTarget',
]);

describe('chaînes optionnelles — `a?.b.c` est un piège', () => {
  it('aucune lecture `?.x.y` sur une donnée non native', () => {
    const fautifs: string[] = [];

    for (const f of fichiersSrc()) {
      const lignes = fs.readFileSync(f, 'utf8').split('\n');
      lignes.forEach((ligne, i) => {
        // On ignore les commentaires : le motif y est cité pour l'expliquer.
        const nu = ligne.trim();
        if (nu.startsWith('//') || nu.startsWith('*') || nu.startsWith('/*')) return;

        // `truc?.champ.autre` — mais pas `truc?.champ.methode(` ni
        // `truc?.champ?.autre`, qui sont corrects.
        const re = /\w+\?\.([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)(?!\s*\()/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(ligne)) !== null) {
          if (SURES.has(m[1])) continue;
          fautifs.push(`${f}:${i + 1}  ${nu.slice(0, 90)}`);
        }
      });
    }

    expect(fautifs, `\n${fautifs.join('\n')}\n\n→ écrire \`a?.b?.c\` : le premier \`?.\` ne protège QUE \`a\`.`)
      .toEqual([]);
  });
});
