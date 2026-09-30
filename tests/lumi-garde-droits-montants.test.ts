/**
 * Qui ne voit pas les montants ne les écrit pas (audit des outils de Lumi, 2026-09-30).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argsContiennentMontant } from '../server/lib/agent/garde';

describe('argsContiennentMontant', () => {
  it('repère un prix, même dans une ligne', () => {
    expect(argsContiennentMontant({ job_id: 'j', line_items: [{ name: 'Vitres', unit_price_cents: 15000 }] })).toBe(true);
    expect(argsContiennentMontant({ amount_cents: 500 })).toBe(true);
    expect(argsContiennentMontant({ job_id: 'j', title: 'Lavage' })).toBe(false);
    expect(argsContiennentMontant({ line_items: [{ name: 'Vitres', unit_price_cents: null }] })).toBe(false);
  });
  it('la garde refuse une écriture avec montant à qui ne voit pas les montants, AVANT le handler', () => {
    const g = readFileSync(resolve(__dirname, '..', 'server', 'lib', 'agent', 'garde.ts'), 'utf8');
    const garde = g.indexOf("tool.kind === 'write' && argsContiennentMontant(opts.args)");
    expect(garde).toBeGreaterThan(0);
    expect(garde).toBeLessThan(g.indexOf('tool.handler(args, ctx)'));
  });
});
