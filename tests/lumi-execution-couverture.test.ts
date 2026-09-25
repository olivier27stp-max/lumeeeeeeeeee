/**
 * Chaque outil d'ÉCRITURE de Lumi est soit exécuté par la batterie d'exécution
 * réelle (scripts/qa/executer-outils-staging.mts), soit exclu avec une raison
 * écrite. Un nouvel outil d'écriture sans scénario fait échouer ce test : la
 * fiabilité se mesure, elle ne se suppose pas (2026-09-17).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AGENT_TOOLS } from '../server/lib/agent/tools';

describe('couverture de la batterie d exécution', () => {
  const src = readFileSync(resolve(__dirname, '..', 'scripts', 'qa', 'executer-outils-staging.mts'), 'utf8');
  const executes = new Set([...src.matchAll(/\bex\('([a-z_0-9]+)'/g)].map((m) => m[1]));
  const exclus = new Set([...src.matchAll(/\bexclu\('([a-z_0-9]+)'/g)].map((m) => m[1]));
  // Les exclusions écrites dans une boucle : for (const n of ['a', 'b']) exclu(n, …)
  for (const m of src.matchAll(/for \(const n of \[([^\]]+)\]\) exclu\(n,/g)) for (const x of m[1].matchAll(/'([a-z_0-9]+)'/g)) exclus.add(x[1]);
  const ecritures = AGENT_TOOLS.filter((t) => t.kind === 'write').map((t) => t.declaration.name);

  it('chaque outil d écriture a un scénario ou une exclusion motivée', () => {
    const manquants = ecritures.filter((n) => !executes.has(n) && !exclus.has(n));
    expect(manquants, `outils d'écriture sans scénario ni exclusion : ${manquants.join(', ')}`).toEqual([]);
  });
  it('les exclusions portent une raison lisible et ne sont pas la majorité', () => {
    for (const m of src.matchAll(/\bexclu\('([a-z_0-9]+)',\s*'([^']*)'/g)) expect(m[2].length, m[1]).toBeGreaterThan(9);
    expect(exclus.size).toBeLessThan(ecritures.length / 4);
  });
  it('le scénario refuse la prod et varie ses noms par passe (anti double-clic)', () => {
    expect(src).toContain("throw new Error('Refus : la prod.')");
    expect(src).toContain('const R = Date.now().toString(36)');
    expect(src).toContain('suffixer(brut)');
  });
});
