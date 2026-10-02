/**
 * B-12 — modifier une automatisation ACTIVE pendant que des clients y sont
 * (mission finale, point 15). Le comportement décidé :
 *   1. une exécution en cours suit la version COURANTE du parcours à sa
 *      prochaine étape ;
 *   2. une étape qui attend garde l'échéance déjà fixée ;
 *   3. étape supprimée ou remplacée → arrêt propre, « étape retirée du
 *      parcours », sans erreur et sans sauter à une autre étape.
 *
 * Avant : la tâche exécutait la COPIE de son action prise à la planification
 * — le client recevait l'ancien message de l'étape en attente, puis le
 * nouveau de la suivante.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const etat = vi.hoisted(() => ({ appels: [] as string[] }));
vi.mock('../../../server/lib/url-sortante', async (orig) => ({
  ...(await orig<any>()),
  posterSansSsrf: vi.fn(async (url: string) => { etat.appels.push(url); return new Response('ok', { status: 200 }); }),
}));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fauxSupabase, type Ligne } from './_faux-supabase';
import { actionCouranteDeLaTache } from '../../../server/lib/automationEngine';
import { viderCacheFuseau } from '../../../server/lib/automations-fuseau-org';
import { viderCachePause } from '../../../server/lib/automations-pause-org';

const ORG = '11111111-1111-4111-8111-111111111111';
const hook = (version: string) => ({ type: 'webhook', config: { url: `https://hooks.example.test/${version}` } });
const etape = (id: string, action: Ligne, suivant: string | null = null) => ({ id, type: 'action', action, suivant });

beforeEach(() => { etat.appels.length = 0; viderCacheFuseau(); viderCachePause(); });
afterEach(() => vi.useRealTimers());

describe('[B-12] quelle action exécute une tâche déjà en file', () => {
  const copie = { ...hook('v1'), event_metadata: {} };

  it('parcours : l’action de l’étape telle qu’elle est écrite AUJOURD’HUI, pas la copie de la planification', () => {
    const r = actionCouranteDeLaTache({ step_id: 'b', action_config: copie, automation_rules: { steps: [etape('b', hook('v2'))] } });
    expect(r).toEqual({ type: 'webhook', config: { url: 'https://hooks.example.test/v2' } });
  });

  it('parcours : le TYPE de l’action a changé (un courriel devenu texto) → c’est le texto qui part', () => {
    const r = actionCouranteDeLaTache({
      step_id: 'b', action_config: { type: 'send_email', config: { subject: 'S' } },
      automation_rules: { steps: [etape('b', { type: 'send_sms', config: { body: 'Texto' } })] },
    });
    expect(r).toEqual({ type: 'send_sms', config: { body: 'Texto' } });
  });

  it('parcours : l’étape d’action est devenue une attente ou une condition (même identifiant) → remplacée', () => {
    const r = actionCouranteDeLaTache({ step_id: 'b', action_config: copie, automation_rules: { steps: [{ id: 'b', type: 'attendre', delai_secondes: 60, suivant: null }] } });
    expect(r).toBe('retiree');
  });

  it('règle à plat : l’action du même rang, dans sa version courante', () => {
    const r = actionCouranteDeLaTache({ action_config: { ...copie, action_index: 1 }, automation_rules: { steps: null, actions: [hook('autre'), hook('v2')] } });
    expect(r).toEqual({ type: 'webhook', config: { url: 'https://hooks.example.test/v2' } });
  });

  it('règle à plat : l’action de ce rang a disparu, ou n’est plus du même type → remplacée', () => {
    expect(actionCouranteDeLaTache({ action_config: { ...copie, action_index: 1 }, automation_rules: { steps: null, actions: [hook('v2')] } })).toBe('retiree');
    expect(actionCouranteDeLaTache({ action_config: { ...copie, action_index: 0 }, automation_rules: { steps: null, actions: [{ type: 'send_sms', config: {} }] } })).toBe('retiree');
  });

  it('tâche planifiée avant ce correctif (sans rang) : elle garde sa copie', () => {
    expect(actionCouranteDeLaTache({ action_config: copie, automation_rules: { steps: null, actions: [hook('v2')] } }))
      .toEqual({ type: 'webhook', config: { url: 'https://hooks.example.test/v1' } });
  });

  it('étape « si » ou attente en file : rien à exécuter, la tâche reste ce qu’elle est', () => {
    const r = actionCouranteDeLaTache({
      step_id: 's', action_config: { type: '__sequence__', etape: 'si' },
      automation_rules: { steps: [{ id: 's', type: 'si', conditions: {}, alors: null, sinon: null }] },
    });
    expect(r).toEqual({ type: '__sequence__', config: {} });
  });
});

describe('[B-12] dans la file : le texte a été réécrit pendant l’attente', () => {
  const tache = (extra: Ligne = {}): Ligne => ({
    id: 'tache-1', org_id: ORG, automation_rule_id: 'r1', entity_type: 'webhook', entity_id: 'e1', attempts: 0, status: 'pending', step_id: 'b',
    execute_at: new Date(Date.now() - 1000).toISOString(), created_at: new Date(Date.now() - 86_400_000).toISOString(), execution_key: 'r1:e1:step:b',
    action_config: { ...hook('v1'), event_metadata: {} }, sequence_context: {},
    automation_rules: {
      name: 'Parcours', actions: [], conditions: {}, settings: null, is_active: true, deleted_at: null, trigger_event: 'webhook.received', delay_seconds: 0,
      steps: [etape('a', hook('a-v2'), 'b'), etape('b', hook('v2'), null)],
    },
    ...extra,
  });

  async function passer(t: Ligne) {
    const { initAutomationEngine, processScheduledTasks } = await import('../../../server/lib/automationEngine');
    const { eventBus } = await import('../../../server/lib/eventBus');
    const sb = fauxSupabase({ company_settings: [{ org_id: ORG, timezone: 'America/Toronto', automations_paused: false }], automation_scheduled_tasks: [t] });
    eventBus.removeAllListeners();
    initAutomationEngine({ supabase: sb.client, twilio: null as never, baseUrl: 'http://t' });
    await processScheduledTasks(sb.client);
    return sb;
  }

  it('l’étape part dans sa version COURANTE (V2), à l’échéance déjà fixée ; le journal consigne ce qui est parti', async () => {
    const sb = await passer(tache());
    expect(etat.appels).toEqual(['https://hooks.example.test/v2']);
    expect(sb.tables.automation_scheduled_tasks[0].status).toBe('completed');
    expect(sb.tables.automation_execution_logs[0]).toMatchObject({ action_type: 'webhook', action_config: { url: 'https://hooks.example.test/v2' }, result_success: true });
  });

  it('l’étape a été supprimée (identifiant disparu) : arrêt propre « étape retirée », rien ne part, aucune étape suivante n’est planifiée', async () => {
    const t = tache();
    t.automation_rules.steps = [etape('a', hook('a-v2'), 'b2'), etape('b2', hook('v2'), 'c'), etape('c', hook('c-v2'), null)];
    const sb = await passer(t);
    expect(etat.appels).toEqual([]);
    expect(sb.tables.automation_scheduled_tasks).toHaveLength(1);
    expect(sb.tables.automation_scheduled_tasks[0]).toMatchObject({ status: 'cancelled', action_config: { motif_code: 'etape_retiree' } });
    expect(sb.tables.automation_execution_logs.map((l) => [l.result_success, l.result_data.saute_code])).toEqual([[true, 'etape_retiree']]);
  });
});

describe('[B-12] le comportement est écrit là où on le cherchera', () => {
  it('en-tête du module des parcours et de la fonction du moteur : les trois règles du point 15', () => {
    const lire = (f: string) => readFileSync(resolve(__dirname, '../../../server/lib', f), 'utf8');
    for (const source of [lire('automationSequences.ts'), lire('automationEngine.ts')]) {
      expect(source).toMatch(/MODIFIER UNE AUTOMATISATION ACTIVE/);
      expect(source).toMatch(/version COURANTE/);
      expect(source).toMatch(/garde l'échéance déjà fixée/);
      expect(source).toMatch(/étape retirée du\s+(\*\s+)?parcours/);
    }
  });
});
