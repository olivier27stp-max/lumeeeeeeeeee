/**
 * Règle figée (audit Lumi B1) : un seul module instancie le SDK Anthropic,
 * `server/lib/lumi/llm.ts`. Partout ailleurs dans `server/`, le SDK ne
 * s'importe qu'en `import type`. Un nouveau `new Anthropic()` ailleurs fait
 * échouer ce test : c'est voulu (clé, délais, reprises, journalisation
 * uniforme à un seul endroit).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const AUTORISE = 'server/lib/lumi/llm.ts';

function fichiersTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...fichiersTs(p));
    else if (/\.(ts|mts)$/.test(e)) out.push(p);
  }
  return out;
}

describe('SDK Anthropic : un seul point d entrée', () => {
  const fichiers = fichiersTs('server').map((p) => p.split('\\').join('/'));
  it('seul llm.ts importe le SDK en valeur ou l instancie', () => {
    const fautifs = fichiers.filter((p) => {
      if (p === AUTORISE) return false;
      const s = readFileSync(p, 'utf8');
      return /^import\s+(?!type\s)[^;]*from\s+'@anthropic-ai\/sdk'/m.test(s) || /new Anthropic\(/.test(s);
    });
    expect(fautifs).toEqual([]);
  });
  it('llm.ts existe et expose clientAnthropic', () => {
    expect(readFileSync(AUTORISE, 'utf8')).toContain('export function clientAnthropic');
  });
});
