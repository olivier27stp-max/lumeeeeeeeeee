// `deals` a DEUX liens vers `pipeline_stages` (l'étape courante, et l'étape
// d'où le deal a été perdu). Une jointure PostgREST sans nommer le lien —
// `pipeline_stages!inner(kind)` — est ambiguë : la requête ENTIÈRE échoue
// (« more than one relationship was found »), et comme supabase-js ne lève
// pas, la fonctionnalité meurt en silence. C'est ce qui a éteint, sans bruit,
// le repli « deal ouvert du client » de « Devis ouvert par le client »
// (trouvé le 2026-09-28). On nomme toujours le lien : deals_stage_same_org.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : fichiers(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe('jointure deals → pipeline_stages', () => {
  it('nomme toujours le lien (jamais `pipeline_stages!inner(` ou `pipeline_stages(` depuis deals)', () => {
    const racine = resolve(__dirname, '..');
    const fautifs: string[] = [];
    for (const f of [...fichiers(join(racine, 'server')), ...fichiers(join(racine, 'src'))]) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/from\('deals'\)[\s\S]{0,200}?select\(\s*['`]([^'`]*)['`]/g)) {
        if (/pipeline_stages(!inner)?\(/.test(m[1])) fautifs.push(`${f.slice(racine.length + 1)} : ${m[1]}`);
      }
    }
    expect(fautifs).toEqual([]);
  });
});
