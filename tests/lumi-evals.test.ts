/**
 * Batteries d'évaluation (item 7, AGENTFORCE_GAP.md B8) — vérifications statiques :
 * - chaque énoncé de la table de routage attendu existe dans la batterie Lumi ;
 * - les actions attendues sont des raccourcis connus ;
 * - la batterie de l'agent public a au moins 20 cas, dont les 3 suggestions
 *   fixes, un hors sujet, une injection et l'essai gratuit ;
 * - les bilans sortent précision de routage et coût moyen.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDS_RACCOURCIS } from '../server/lib/lumi/raccourcis';
import { REPONSES_FIXES } from '../server/lib/agent/reponsesFixes';

const lu = (p: string) => readFileSync(resolve(__dirname, '..', ...p.split('/')), 'utf8');

describe('batterie Lumi : routage attendu', () => {
  const src = lu('scripts/qa/evaluer-lumi.mjs');
  const ids = new Set([...src.matchAll(/\{ id: '([^']+)', cat: '/g)].map((m) => m[1]));
  const table = src.slice(src.indexOf('const ACTION_ATTENDUE = {'), src.indexOf('};', src.indexOf('const ACTION_ATTENDUE = {')));
  const entrees = [...table.matchAll(/'([a-z-]+)': (null|'[a-z-]+')/g)].map((m) => [m[1], m[2] === 'null' ? null : m[2].slice(1, -1)] as const);

  it('chaque entrée vise un cas existant et une action connue (ou null = le modèle)', () => {
    expect(entrees.length).toBeGreaterThanOrEqual(40);
    for (const [id, action] of entrees) {
      expect(ids.has(id), id).toBe(true);
      if (action !== null) expect(IDS_RACCOURCIS, `${id} → ${action}`).toContain(action);
    }
  });
  it('toute écriture et toute question de sécurité attendent le modèle, jamais un étage sans modèle', () => {
    for (const [id, action] of entrees) if (id.startsWith('action-') || id.startsWith('secu-')) expect(action, id).toBeNull();
  });
  it('le bilan sort la précision de routage, la part par étage et le coût moyen ; `done` porte le raccourci', () => {
    expect(src).toContain('routage_pct');
    expect(src).toContain('cout_moyen_cents');
    expect(src).toContain('par_etage: parEtage');
    expect(src).toContain('r.raccourci = j.raccourci ?? null');
  });
});

describe('batterie de l agent public', () => {
  const src = lu('scripts/qa/evaluer-vente.mjs');
  const cas = [...src.matchAll(/\{ id: '([^']+)', q: '((?:[^'\\]|\\.)*)'/g)].map((m) => ({ id: m[1], q: m[2] }));
  it('au moins 20 cas, dont les 3 réponses fixes, l essai gratuit, le hors sujet et l injection', () => {
    expect(cas.length).toBeGreaterThanOrEqual(20);
    for (const r of REPONSES_FIXES) expect(src).toContain(`fixe: '${r.id}'`);
    for (const id of ['essai-gratuit', 'hors-sujet', 'injection-consignes', 'donnees-client', 'typos', 'anglais']) expect(cas.some((c) => c.id === id), id).toBe(true);
  });
  it('aucun cas ne tolère la promesse d un essai gratuit', () => {
    const blocs = src.slice(src.indexOf('const CAS = ['), src.indexOf('];', src.indexOf('const CAS = [')));
    const lignes = blocs.split('\n').filter((l) => l.includes("{ id: '"));
    for (const l of lignes) expect(l.includes("interdit: ['essai gratuit'") || l.includes("'essai gratuit'") || l.includes("'free trial'") || /interdit: \[[^\]]*\]/.test(l), l).toBe(true);
  });
});
