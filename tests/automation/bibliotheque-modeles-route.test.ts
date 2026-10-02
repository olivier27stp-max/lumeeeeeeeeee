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

/** `interfaceEn` : la langue de l'INTERFACE de qui clique (`Accept-Language`, comme l'envoie l'application). */
const utiliser = (corps: unknown, cle = '', interfaceEn?: boolean) => fetch(`${base}/utiliser`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(cle ? { 'idempotency-key': cle } : {}),
    ...(interfaceEn === undefined ? {} : { 'accept-language': interfaceEn ? 'en' : 'fr' }),
  },
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

  it('un modèle d’une seule vague devient un parcours modifiable, rappel « la veille » compris', async () => {
    await utiliser({ templateId: 'job_reminder_1d' }, 'k-veille');
    const v = etat.ops[0].valeur;
    expect(v.delay_seconds).toBe(0);
    expect(v.steps[0]).toMatchObject({ id: 'e1', type: 'attendre', mode: 'avant_date', secondes_avant: 86_400, suivant: 'e2' });
    expect(v.steps.slice(1).every((e: { type: string }) => e.type === 'action')).toBe(true);
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

  /*
   * RÈGLE DÉCIDÉE (2026-10-02, triage « modèles » 02-chaque-modele:246) — elle
   * remplace « nom anglais si le bureau envoie en anglais », que ce cas figeait.
   * Le NOM et la description d'une copie sont des libellés d'interface, que
   * seul l'utilisateur lit : ils suivent la langue de l'INTERFACE. Les MESSAGES
   * de la copie, eux, ne dépendent pas de qui clique : les deux textes du
   * modèle sont copiés, et le moteur envoie celui de la langue du bureau.
   */
  const modeleDepot = trouverModele('pack_depot')!;
  /** Les textes qui partent aux clients, tels que la copie les porte (français et anglais). */
  const messagesDe = (steps: Array<{ type: string; action?: { config?: Record<string, unknown> } }>) => steps
    .filter((e) => e.type === 'action')
    .map((e) => Object.fromEntries(Object.entries(e.action?.config ?? {}).filter(([cle]) => /^(body|subject)(_en)?$/.test(cle))));

  it('interface ANGLAISE, bureau qui envoie en FRANÇAIS : nom et description en anglais', async () => {
    etat.langue = 'fr';
    await utiliser({ templateId: 'pack_depot' }, 'k-4', true);
    expect(etat.ops[0].valeur.name).toBe('Deposit — request and reminder');
    expect(etat.ops[0].valeur.name).toBe(modeleDepot.nom.en);
    expect(etat.ops[0].valeur.description).toBe(modeleDepot.description.en);
  });

  it('interface FRANÇAISE, bureau qui envoie en ANGLAIS : nom et description en français (l’ancienne règle donnait l’anglais)', async () => {
    etat.langue = 'en';
    await utiliser({ templateId: 'pack_depot' }, 'k-5', false);
    expect(etat.ops[0].valeur.name).toBe('Dépôt — demande et rappel');
    expect(etat.ops[0].valeur.name).toBe(modeleDepot.nom.fr);
    expect(etat.ops[0].valeur.description).toBe(modeleDepot.description.fr);
  });

  it('sans langue d’interface annoncée : français, la langue par défaut de Lume — quel que soit le bureau', async () => {
    etat.langue = 'en';
    await utiliser({ templateId: 'pack_depot' }, 'k-6');
    expect(etat.ops[0].valeur.name).toBe(modeleDepot.nom.fr);
  });

  it('un nom déjà pris est suffixé dans la langue de l’interface', async () => {
    etat.noms = ['Deposit — request and reminder'];
    await utiliser({ templateId: 'pack_depot' }, 'k-7', true);
    expect(etat.ops[0].valeur.name).toBe('Deposit — request and reminder (2)');
  });

  it('les MESSAGES de la copie ne suivent pas l’interface : dans les quatre combinaisons, les mêmes textes — ceux du modèle, français ET anglais', async () => {
    const copies: string[] = [];
    let n = 0;
    for (const bureau of ['fr', 'en']) {
      for (const interfaceEn of [false, true]) {
        etat.ops.length = 0;
        etat.langue = bureau;
        await utiliser({ templateId: 'pack_depot' }, `k-messages-${++n}`, interfaceEn);
        copies.push(JSON.stringify(messagesDe(etat.ops[0].valeur.steps)));
      }
    }
    expect(new Set(copies).size).toBe(1);
    const attendus = messagesDe((modeleDepot.steps ?? []) as never);
    expect(JSON.parse(copies[0])).toEqual(attendus);
    // Le modèle porte bien les deux langues : c'est le moteur (`champLocalise`) qui choisit à l'envoi.
    expect(attendus.some((m) => typeof m.body === 'string' && typeof m.body_en === 'string')).toBe(true);
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
