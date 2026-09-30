/**
 * « Utiliser ce modèle » (2026-09-30) — la route crée UNE automatisation en
 * brouillon dans l'entreprise de la SESSION, et ne touche à rien d'autre.
 *
 * Le bug d'avant : « Partir d'un modèle » ne créait rien et donnait
 * l'impression que les automatisations existantes tombaient en brouillon.
 * Ici on prouve l'inverse : un seul INSERT, aucun UPDATE, aucune autre table.
 */
import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const ORG_SESSION = '11111111-1111-4111-8111-111111111111';
const etat = vi.hoisted(() => ({
  ops: [] as Array<{ table: string; op: string; valeur?: any }>,
  noms: [] as string[],
  langue: 'fr' as string,
  retard: 0,
}));

vi.mock('../../server/lib/supabase', async (orig) => ({
  ...(await orig<any>()),
  requireAuthedClient: async () => ({
    orgId: ORG_SESSION, user: { id: 'u' },
    client: {
      from: (table: string) => {
        const q: any = {};
        let op = 'select';
        let valeur: any;
        for (const m of ['select', 'eq', 'is', 'order', 'limit', 'in']) q[m] = () => q;
        q.insert = (v: any) => { op = 'insert'; valeur = v; return q; };
        q.update = (v: any) => { op = 'update'; valeur = v; etat.ops.push({ table, op, valeur: v }); return q; };
        q.delete = () => { op = 'delete'; etat.ops.push({ table, op }); return q; };
        const resoudre = async () => {
          if (op === 'insert') {
            await new Promise((r) => setTimeout(r, etat.retard));
            etat.ops.push({ table, op, valeur });
            return { data: { id: `nouvelle-${etat.ops.length}`, ...valeur }, error: null };
          }
          if (table === 'company_settings') return { data: { default_language: etat.langue }, error: null };
          return { data: null, error: null };
        };
        q.maybeSingle = resoudre;
        q.single = resoudre;
        q.then = (ok: any, ko: any) => {
          // Lecture de liste (les noms existants).
          if (table === 'automation_rules' && op === 'select') return Promise.resolve({ data: etat.noms.map((name) => ({ name })), error: null }).then(ok, ko);
          return resoudre().then(ok, ko);
        };
        return q;
      },
    },
  }),
}));

import router from '../../server/routes/automation-rules';
import { trouverModele } from '../../server/lib/automationTemplates';

const app = express();
app.use(express.json());
app.use('/api', router);
const serveur = app.listen(0);
const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api/automations/templates`;
afterAll(() => serveur.close());

const utiliser = (corps: unknown, cle = '') => fetch(`${base}/utiliser`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(cle ? { 'idempotency-key': cle } : {}) },
  body: JSON.stringify(corps),
});

beforeEach(() => { etat.ops.length = 0; etat.noms = []; etat.langue = 'fr'; etat.retard = 0; });

describe('GET /automations/templates', () => {
  it('renvoie le catalogue sans rien écrire', async () => {
    const r = await fetch(base);
    expect(r.status).toBe(200);
    const corps = await r.json() as { modeles: Array<{ id: string }> };
    expect(corps.modeles.length).toBeGreaterThanOrEqual(40);
    expect(etat.ops).toEqual([]);
  });
});

describe('POST /automations/templates/utiliser', () => {
  it('crée exactement UNE automatisation, en brouillon, et ne touche à rien d’autre', async () => {
    const r = await utiliser({ templateId: 'pack_relance_devis' }, 'k-1');
    expect(r.status).toBe(201);
    expect(etat.ops).toHaveLength(1);
    const [ins] = etat.ops;
    expect(ins).toMatchObject({ table: 'automation_rules', op: 'insert' });
    expect(ins.valeur).toMatchObject({ org_id: ORG_SESSION, is_active: false, is_preset: false, preset_key: null });
    expect(etat.ops.filter((o) => o.op !== 'insert')).toEqual([]);
  });

  it('copie profonde : nouveaux identifiants d’étapes, modèle intact', async () => {
    const modele = trouverModele('pack_relance_devis');
    const avant = JSON.stringify(modele);
    await utiliser({ templateId: 'pack_relance_devis' }, 'k-2');
    const steps = etat.ops[0].valeur.steps as Array<{ id: string }>;
    const anciens = new Set((modele?.steps ?? []).map((e) => e.id));
    expect(steps.length).toBe(modele?.steps?.length);
    expect(steps.some((e) => anciens.has(e.id))).toBe(true); // mêmes formats « eN »…
    expect(steps.map((e) => e.id)).toEqual(steps.map((_, i) => `e${i + 1}`)); // …mais renumérotés, à neuf
    expect(JSON.stringify(modele)).toBe(avant);
  });

  it('l’entreprise vient de la session : un org_id glissé dans le corps est refusé', async () => {
    const r = await utiliser({ templateId: 'pack_depot', org_id: '99999999-9999-4999-8999-999999999999' });
    expect(r.status).toBe(400);
    expect(etat.ops).toEqual([]);
  });

  it('nom déjà pris → suffixe (2)', async () => {
    etat.noms = ['Dépôt — demande et rappel'];
    await utiliser({ templateId: 'pack_depot' }, 'k-3');
    expect(etat.ops[0].valeur.name).toBe('Dépôt — demande et rappel (2)');
  });

  it('langue d’automatisation de l’entreprise : nom anglais si « en »', async () => {
    etat.langue = 'en';
    await utiliser({ templateId: 'pack_depot' }, 'k-4');
    expect(etat.ops[0].valeur.name).toBe('Deposit — request and reminder');
  });

  it('double clic (même clé d’idempotence) = une seule création', async () => {
    etat.retard = 80;
    const [a, b] = await Promise.all([utiliser({ templateId: 'pack_depot' }, 'k-double'), utiliser({ templateId: 'pack_depot' }, 'k-double')]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((await a.json()).id).toBe((await b.json()).id);
    expect(etat.ops.filter((o) => o.op === 'insert')).toHaveLength(1);
  });

  it('modèle inconnu → 404, rien d’écrit', async () => {
    const r = await utiliser({ templateId: 'nexiste_pas' });
    expect(r.status).toBe(404);
    expect(etat.ops).toEqual([]);
  });
});
