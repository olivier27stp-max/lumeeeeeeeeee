/**
 * Registre d'actions (item 4, AGENTFORCE_GAP.md B2) :
 * - validation des arguments contre la déclaration AVANT le handler (R2, R7) ;
 * - une seule source d'attributs pour les écritures (sensible, anodine,
 *   réversible, vers le client), couvrant exactement les outils d'écriture ;
 * - mode à blanc (R12) : rien n'est écrit, pas même l'empreinte.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validerArgs } from '../server/lib/agent/validation-args';
import { REGISTRE_ECRITURES, ECRITURES_SENSIBLES, ECRITURES_ANODINES, attributsEcriture } from '../server/lib/agent/registre';
import { TOOLS_BY_NAME } from '../server/lib/agent/tools';

const lu = (p: string) => readFileSync(resolve(__dirname, '..', ...p.split('/')), 'utf8');

describe('validerArgs : types, requis, choix, inconnus', () => {
  const schema = {
    type: 'object',
    properties: {
      client_id: { type: 'string' },
      amount_cents: { type: 'integer' },
      rate: { type: 'number' },
      urgent: { type: 'boolean' },
      status: { type: 'string', enum: ['draft', 'sent'] },
      items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'integer' } }, required: ['name'] } },
    },
    required: ['client_id'],
  };

  it('accepte une entrée conforme et convertit les nombres reçus en chaîne', () => {
    const r = validerArgs(schema, { client_id: 'c1', amount_cents: '50000', rate: 1.5, urgent: 'true', status: 'sent', items: [{ name: 'Lavage', qty: '2' }] });
    expect(r).toEqual({ ok: true, ignores: [], args: { client_id: 'c1', amount_cents: 50000, rate: 1.5, urgent: true, status: 'sent', items: [{ name: 'Lavage', qty: 2 }] } });
  });

  it('refuse proprement : champ requis manquant, entier non entier, texte pour un nombre, choix hors liste, item incomplet', () => {
    expect(validerArgs(schema, {})).toEqual({ ok: false, erreur: 'client_id : champ obligatoire manquant' });
    expect(validerArgs(schema, { client_id: 'c1', amount_cents: 12.5 })).toEqual({ ok: false, erreur: 'amount_cents : nombre entier attendu' });
    expect(validerArgs(schema, { client_id: 'c1', rate: 'beaucoup' })).toEqual({ ok: false, erreur: 'rate : nombre attendu' });
    expect(validerArgs(schema, { client_id: 'c1', status: 'paid' })).toMatchObject({ ok: false });
    expect(validerArgs(schema, { client_id: 'c1', items: [{ qty: 1 }] })).toEqual({ ok: false, erreur: 'items.0.name : champ obligatoire manquant' });
    expect(validerArgs(schema, { client_id: 'c1', items: 'x' })).toEqual({ ok: false, erreur: 'items : liste attendue' });
  });

  it('retire les champs inconnus et les signale ; les optionnels absents ou null ne bloquent pas', () => {
    const r = validerArgs(schema, { client_id: 'c1', invente: 1, rate: null });
    expect(r).toEqual({ ok: true, ignores: ['invente'], args: { client_id: 'c1' } });
  });

  it('sans déclaration de paramètres : tout passe tel quel', () => {
    expect(validerArgs(undefined, { a: 1 })).toEqual({ ok: true, ignores: [], args: { a: 1 } });
  });

  it('les 69 déclarations réelles acceptent un exemple minimal conforme (aucun schéma hors du sous-ensemble)', () => {
    for (const [name, t] of Object.entries(TOOLS_BY_NAME)) {
      const p: any = t.declaration.parameters ?? { type: 'object', properties: {} };
      const exemple: Record<string, unknown> = {};
      for (const k of p.required ?? []) {
        const s = p.properties?.[k] ?? {};
        exemple[k] = s.type === 'integer' || s.type === 'number' ? 1 : s.type === 'boolean' ? true : s.type === 'array' ? [] : s.type === 'object' ? {} : (s.enum?.[0] ?? 'x');
      }
      const r = validerArgs(p, exemple);
      expect(r.ok, `${name} : ${(r as any).erreur ?? ''}`).toBe(true);
    }
  });
});

describe('registre des écritures : une seule source', () => {
  it('couvre exactement les outils d écriture de TOOLS_BY_NAME', () => {
    const ecritures = Object.keys(TOOLS_BY_NAME).filter((n) => TOOLS_BY_NAME[n].kind === 'write').sort();
    expect(Object.keys(REGISTRE_ECRITURES).sort()).toEqual(ecritures);
  });
  it('les listes dérivées restent cohérentes et un envoi n est jamais réversible', () => {
    for (const n of ECRITURES_SENSIBLES) expect(REGISTRE_ECRITURES[n].sensible).toBe(true);
    for (const n of ECRITURES_ANODINES) expect(REGISTRE_ECRITURES[n].anodine).toBe(true);
    for (const [n, a] of Object.entries(REGISTRE_ECRITURES)) if (a.vers_client) expect(a.reversible, n).toBe(false);
    expect(attributsEcriture('send_sms')).toEqual({ sensible: true, anodine: false, reversible: false, vers_client: true });
    expect(attributsEcriture('search_clients')).toBeNull();
    // execution.ts et orchestrateur.ts n'ont plus leur propre liste.
    expect(lu('server/lib/lumi/execution.ts')).toContain("export { ECRITURES_SENSIBLES } from '../agent/registre';");
    expect(lu('server/lib/lumi/orchestrateur.ts')).toContain("export { ECRITURES_ANODINES } from '../agent/registre';");
  });
});

describe('mode à blanc (R12) et validation branchée (R2)', () => {
  it('executerIdempotent renvoie avant toute empreinte quand ctx.dryRun est vrai', () => {
    const src = lu('server/lib/agent/tools-etendus.ts');
    const fn = src.slice(src.indexOf('async function executerIdempotent('), src.indexOf('async function executerIdempotent(') + 900);
    expect(fn.indexOf('if (ctx.dryRun)')).toBeGreaterThan(0);
    expect(fn.indexOf('if (ctx.dryRun)')).toBeLessThan(fn.indexOf(".from('agent_actions')"));
    expect(fn).toContain('dry_run: true');
  });
  it('la garde valide les arguments avant le handler et lui passe la version normalisée', () => {
    const g = lu('server/lib/agent/garde.ts');
    expect(g.indexOf('validerArgs(tool.declaration.parameters, opts.args)')).toBeLessThan(g.indexOf('tool.handler(validation.args, ctx)'));
    expect(g).toContain('Paramètres invalides');
  });
  it('POST /lumi/execute accepte decision=dry_run et ne sauve ni n exécute rien', () => {
    const r = lu('server/routes/lumi.ts');
    expect(r).toContain("decision: z.enum(['confirm', 'cancel', 'dry_run'])");
    expect(r).toContain("if (decision === 'dry_run') {");
    expect(r).toContain('return res.json({ dry_run: true, simulations });');
  });
});
