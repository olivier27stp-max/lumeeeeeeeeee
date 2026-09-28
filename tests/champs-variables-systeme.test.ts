/**
 * Champs système → variables de modèles ({{client.first_name}}…).
 *
 * Chaque champ système (un vrai champ de formulaire, avec une section) doit
 * avoir sa valeur calculée par server/lib/champs/variablesSysteme.ts — sinon la
 * variable s'afficherait dans « Insérer » et Réglages mais resterait vide dans
 * le courriel. On simule une base qui renvoie une ligne pour chaque table.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../server/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { valeursSysteme } from '../server/lib/champs/variablesSysteme';
import { champsSysteme } from '../src/lib/champs/standard';
import { OBJETS } from '../src/lib/champs/types';

/** Une ligne « pleine » : chaque colonne demandée reçoit une valeur plausible. */
function ligne(colonnes: string): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const c of colonnes.split(',').map((x) => x.trim())) {
    if (c.endsWith('_cents')) r[c] = 12500;
    else if (c === 'valid_until') r[c] = '2026-10-28T12:00:00Z';
    else if (c.endsWith('_at') || c.endsWith('_date')) r[c] = '2026-09-28T12:00:00Z';
    else if (c === 'tax_ids') r[c] = ['t1'];
    else if (c === 'tax_lines') r[c] = [{ name: 'TPS', enabled: true }];
    else if (c.startsWith('is_') || c.includes('required') || c.includes('show_') || c.includes('ask_') || c.includes('billing_') || c === 'display_as_company') r[c] = true;
    else if (c === 'deposit_type') r[c] = 'percentage';
    else if (c === 'deposit_value') r[c] = 25;
    else if (c === 'content') r[c] = '["a.png"]';
    else r[c] = `v_${c}`;
  }
  return r;
}

function fausseBase() {
  const requete = (table: string) => {
    let colonnes = '';
    const q: Record<string, unknown> = {};
    const soi = () => q;
    for (const m of ['eq', 'in', 'is', 'order', 'limit', 'not']) q[m] = soi;
    q.select = (c: string) => { colonnes = c; return q; };
    q.maybeSingle = async () => ({ data: ligne(colonnes), error: null });
    // Requête de liste (awaited directement) : deux lignes, sections comprises.
    q.then = (ok: (v: { data: unknown[]; error: null }) => unknown) => {
      const lignes = table === 'quote_sections'
        ? ['images', 'introduction', 'client_message'].map((t) => ({ ...ligne(colonnes), section_type: t, enabled: true }))
        : [ligne(colonnes), ligne(colonnes)];
      return Promise.resolve({ data: lignes, error: null }).then(ok);
    };
    return q;
  };
  return { from: requete } as never;
}

describe('champs système → variables', () => {
  for (const objet of OBJETS) {
    it(`${objet} : chaque champ système a une valeur`, async () => {
      const v = await valeursSysteme(fausseBase(), 'org', objet, 'id', 'fr', 'America/Toronto');
      const manquantes = champsSysteme(objet).map((c) => c.key).filter((k) => !(k in v));
      expect(manquantes, `${objet} : ${manquantes.join(', ')}`).toEqual([]);
      const vides = champsSysteme(objet).map((c) => c.key).filter((k) => v[k] === '');
      expect(vides, `${objet} vides : ${vides.join(', ')}`).toEqual([]);
    });
  }
});
