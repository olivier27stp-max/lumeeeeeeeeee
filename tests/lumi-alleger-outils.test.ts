/**
 * Allègement des schémas d'outils : seules les descriptions qui répètent le
 * nom du paramètre disparaissent ; tout ce qui informe reste (2026-09-17).
 */
import { describe, it, expect } from 'vitest';
import { descriptionRedondante, allegerSchema, economie } from '../server/lib/lumi/alleger-outils';
import { AGENT_TOOLS } from '../server/lib/agent/tools';
import { TOPICS } from '../server/lib/lumi/topics';

describe('alleger-outils', () => {
  it('retire ce qui répète le nom, garde ce qui informe', () => {
    expect(descriptionRedondante('job_id', 'Job id.')).toBe(true);
    expect(descriptionRedondante('title', 'New title.')).toBe(true);
    expect(descriptionRedondante('quote_id', 'The quote id')).toBe(true);
    expect(descriptionRedondante('lead_id', 'Lead id (from a lead search).')).toBe(false);
    expect(descriptionRedondante('unit_price_cents', 'Unit price in CENTS.')).toBe(false);
    expect(descriptionRedondante('quantity', 'Default 1.')).toBe(false);
    expect(descriptionRedondante('start_date', 'YYYY-MM-DD.')).toBe(false);
    expect(descriptionRedondante('phone_number', 'Phone number if no client_id.')).toBe(false);
    expect(descriptionRedondante('status', 'New status.')).toBe(true);
    expect(descriptionRedondante('status', 'done or open.')).toBe(false);
  });
  it('ne touche ni les types, ni les enums, ni les champs requis ; récursif sur les tableaux', () => {
    const s = { type: 'object', properties: { job_id: { type: 'string', description: 'Job id.' }, status: { type: 'string', enum: ['a', 'b'], description: 'New status.' }, items: { type: 'array', items: { type: 'object', properties: { qty: { type: 'integer', description: 'Quantity (default 1).' }, name: { type: 'string', description: 'Item name.' } } } } }, required: ['job_id'] };
    const a = allegerSchema(s)!;
    expect(a.properties.job_id).toEqual({ type: 'string' });
    expect(a.properties.status).toEqual({ type: 'string', enum: ['a', 'b'] });
    expect(a.properties.items.items.properties.qty.description).toBe('Quantity (default 1).');
    expect(a.properties.items.items.properties.name.description).toBe('Item name.'); // « Item » n'est pas dans « name » : on garde
    expect(a.required).toEqual(['job_id']);
    expect(s.properties.job_id.description).toBe('Job id.'); // l'original n'est pas modifié
  });
  it('économise sur l ensemble des outils sans jamais retirer une description informative', () => {
    let total = 0;
    for (const t of AGENT_TOOLS) total += economie(t.declaration.parameters);
    expect(total).toBeGreaterThan(2000);
    const informatif = /[0-9()]|cents|default|from |YYYY/i;
    for (const t of AGENT_TOOLS) {
      const avant = JSON.stringify(t.declaration.parameters ?? {});
      const apres = JSON.stringify(allegerSchema(t.declaration.parameters) ?? {});
      for (const m of avant.matchAll(/"description":"([^"]+)"/g)) if (informatif.test(m[1])) expect(apres, `${t.declaration.name} : ${m[1]}`).toContain(m[1]);
    }
  });
  it('les sujets devis et terrain existent et allègent facturation et equipe', () => {
    const ids = TOPICS.map((t) => t.id);
    expect(ids).toContain('devis');
    expect(ids).toContain('terrain');
    const n = (id: string) => TOPICS.find((t) => t.id === id)!.outils.length;
    expect(n('devis')).toBeGreaterThan(15);
    expect(n('facturation')).toBeLessThan(55);
    expect(n('equipe')).toBeLessThan(50);
    expect(n('terrain')).toBeGreaterThan(20);
  });
});
