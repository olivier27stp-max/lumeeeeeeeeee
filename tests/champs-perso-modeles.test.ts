/**
 * Champs suggérés par métier : src/lib/champs/modeles.ts
 * Chaque métier proposé à l'inscription a son modèle, et chaque modèle est
 * installable tel quel (clés valides, jamais celle d'un champ standard,
 * options sans doublon, même clé = même type partout pour que la copie
 * devis → job → facture et les réinstallations restent cohérentes).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INDUSTRIES_MODELES, MODELES_CHAMPS, champsDuModele } from '../src/lib/champs/modeles';
import { clesStandard } from '../src/lib/champs/standard';
import { TYPES_CHAMP } from '../src/lib/champs/types';

const lire = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('modèles de champs par métier', () => {
  it('un modèle pour chaque métier proposé à l’inscription', () => {
    const bloc = /INDUSTRY_KEYS = \[([^\]]+)\]/.exec(lire('src/components/workspace/WorkspaceForm.tsx'))![1];
    const inscription = [...bloc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect([...INDUSTRIES_MODELES].sort()).toEqual(inscription);
  });

  it.each(INDUSTRIES_MODELES)('%s : installable tel quel', (industrie) => {
    const modele = MODELES_CHAMPS[industrie];
    expect(modele.length).toBeGreaterThan(0);
    expect(new Set(modele.map((m) => m.id)).size).toBe(modele.length);
    for (const m of modele) {
      expect(m.key).toMatch(/^[a-z][a-z0-9_]{0,49}$/);
      expect(TYPES_CHAMP).toContain(m.field_type);
      expect(m.fr.trim() && m.en.trim()).toBeTruthy();
      for (const o of m.objets) expect(clesStandard(o)).not.toContain(m.key);
      const liste = m.field_type === 'dropdown_single' || m.field_type === 'dropdown_multi';
      expect(!!m.options?.length).toBe(liste);
      for (const langue of ['fr', 'en'] as const) {
        const libelles = (m.options ?? []).map((o) => o[langue].toLowerCase());
        expect(new Set(libelles).size).toBe(libelles.length);
      }
      if (m.document) expect(m.objets.some((o) => o === 'quote' || o === 'invoice')).toBe(true);
    }
    // Une clé n'apparaît qu'une fois par objet.
    const paires = champsDuModele(industrie).map((x) => `${x.objet}:${x.modele.key}`);
    expect(new Set(paires).size).toBe(paires.length);
  });

  it('même clé = même type d’un métier à l’autre', () => {
    const types = new Map<string, string>();
    for (const i of INDUSTRIES_MODELES) {
      for (const m of MODELES_CHAMPS[i]) {
        const t = types.get(m.key);
        if (t) expect(`${m.key}:${m.field_type}`).toBe(`${m.key}:${t}`);
        types.set(m.key, m.field_type);
      }
    }
  });

  it('routes déclarées dans la page Rôles et avant /:id', () => {
    const perms = lire('server/lib/route-permissions.ts');
    expect(perms).toContain("'GET /api/custom-fields/templates': 'settings.read'");
    expect(perms).toContain("'POST /api/custom-fields/templates': 'settings.update'");
    const routes = lire('server/routes/custom-fields.ts');
    expect(routes.indexOf("'/custom-fields/templates'")).toBeLessThan(routes.indexOf("'/custom-fields/:id'"));
  });

  it('l’inscription pose les champs sans jamais pouvoir la faire échouer', () => {
    const b = lire('server/routes/billing.ts');
    expect(b).toMatch(/void installerModele\(admin, auth\.orgId, industry\)\s*\.catch\(/);
  });
});
