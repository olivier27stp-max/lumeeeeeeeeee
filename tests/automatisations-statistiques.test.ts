/**
 * LES STATISTIQUES DES AUTOMATISATIONS — une route agrégée, de vrais chiffres.
 *
 * Audit du 2026-09-28 : « Total déclenché » et « En cours » valaient
 * toujours « — », l'onglet « Statistiques » d'une étape toujours « Aucun
 * passage encore ». Et une étape SAUTÉE (pas de numéro texto…) ne doit être
 * comptée ni comme un envoi, ni comme un échec.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const ORG = '11111111-2222-3333-4444-555555555555';
const R1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const R2 = 'aaaaaaaa-0000-4000-8000-000000000002';

let tables: Record<string, any[]> = {};
const filtres: Array<{ table: string; ruleId: string | null }> = [];

/** Faux client : filtre par automation_rule_id, pagine par `range`. */
function fauxClient() {
  return {
    from: (table: string) => {
      let regle: string | null = null;
      let de = 0; let a = 999;
      const chaine: any = {
        select: () => chaine, or: () => chaine, gte: () => chaine, order: () => chaine,
        eq: (col: string, v: string) => { if (col === 'automation_rule_id') regle = v; return chaine; },
        range: (x: number, y: number) => { de = x; a = y; return chaine; },
        then: (ok: (r: unknown) => unknown) => {
          filtres.push({ table, ruleId: regle });
          const lignes = (tables[table] ?? []).filter((l) => !regle || l.automation_rule_id === regle);
          return Promise.resolve({ data: lignes.slice(de, a + 1), error: null }).then(ok);
        },
      };
      return chaine;
    },
  };
}

vi.mock('../server/lib/supabase', () => ({
  requireAuthedClient: async () => ({ client: fauxClient(), orgId: ORG, user: { id: 'u1' } }),
  getServiceClient: () => fauxClient(),
}));

const { default: routeur, calculerStatistiques } = await import('../server/routes/automation-stats');

async function lire(chemin: string) {
  const app = express();
  app.use('/api', routeur);
  const serveur = app.listen(0);
  try {
    const { port } = serveur.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api${chemin}`, { headers: { Authorization: 'Bearer x' } });
    return { status: res.status, json: await res.json() as any };
  } finally {
    serveur.close();
  }
}

beforeEach(() => {
  filtres.length = 0;
  tables = {
    automation_scheduled_tasks: [
      { id: 't1', automation_rule_id: R1, entity_id: 'c1', status: 'completed', step_id: 'e1' },
      { id: 't2', automation_rule_id: R1, entity_id: 'c1', status: 'pending', step_id: 'e2' },
      { id: 't3', automation_rule_id: R1, entity_id: 'c2', status: 'completed', step_id: 'e1' },
      { id: 't4', automation_rule_id: R1, entity_id: 'c3', status: 'completed', step_id: 'e1' },
      { id: 't5', automation_rule_id: R2, entity_id: 'c9', status: 'running', step_id: null },
    ],
    automation_execution_logs: [
      { automation_rule_id: R1, entity_id: 'c1', scheduled_task_id: 't1', result_success: true, result_error: null, saute: null },
      // Texto impossible : SAUTÉ (M1), ni envoi ni échec.
      { automation_rule_id: R1, entity_id: 'c2', scheduled_task_id: 't3', result_success: true, result_error: null, saute: 'Aucun numéro texto configuré' },
      { automation_rule_id: R1, entity_id: 'c3', scheduled_task_id: 't4', result_success: false, result_error: 'Resend 500', saute: null },
      // Réservation du moteur encore « en cours » : pas encore un résultat.
      { automation_rule_id: R1, entity_id: 'c4', scheduled_task_id: null, result_success: false, result_error: 'en cours', saute: null },
      { automation_rule_id: R2, entity_id: 'c8', scheduled_task_id: null, result_success: true, result_error: null, saute: null },
    ],
  };
});

describe('par automatisation', () => {
  it('compte les fiches déclenchées, celles en cours, et sépare envois / sauts / échecs', async () => {
    const { par_regle, par_etape } = await calculerStatistiques(fauxClient() as never, ORG, null);
    expect(par_regle[R1]).toEqual({ declenches: 4, en_cours: 1, envoyes: 1, sautes: 1, echecs: 1 });
    expect(par_regle[R2]).toEqual({ declenches: 2, en_cours: 1, envoyes: 1, sautes: 0, echecs: 0 });
    expect(par_etape).toBeNull();
  });

  it('pagine au-delà des 1 000 lignes de PostgREST', async () => {
    tables.automation_scheduled_tasks = Array.from({ length: 2500 }, (_, i) => (
      { id: `t${i}`, automation_rule_id: R1, entity_id: `c${i}`, status: 'completed', step_id: null }));
    tables.automation_execution_logs = [];
    const { par_regle } = await calculerStatistiques(fauxClient() as never, ORG, null);
    expect(par_regle[R1].declenches).toBe(2500);
  });
});

describe('par étape', () => {
  it('rattache chaque exécution à son étape par sa tâche', async () => {
    const { par_etape } = await calculerStatistiques(fauxClient() as never, ORG, R1);
    expect(par_etape).toEqual({
      e1: { envoyes: 1, sautes: 1, echecs: 1, en_attente: 0 },
      e2: { envoyes: 0, sautes: 0, echecs: 0, en_attente: 1 },
    });
  });
});

describe('la route', () => {
  it('GET /api/automations/rules/stats répond les chiffres', async () => {
    const r = await lire('/automations/rules/stats');
    expect(r.status).toBe(200);
    expect(r.json.par_regle[R1].declenches).toBe(4);
  });

  it('?rule_id= ajoute le détail par étape, et refuse un identifiant forgé', async () => {
    expect((await lire(`/automations/rules/stats?rule_id=${R1}`)).json.par_etape.e1.sautes).toBe(1);
    expect((await lire('/automations/rules/stats?rule_id=x%27or%201')).status).toBe(400);
  });
});
