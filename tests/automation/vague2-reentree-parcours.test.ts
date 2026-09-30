/**
 * « Laisser le client repasser » vaut aussi pour un PARCOURS (audit V2, D-12).
 *
 * La clé d'une étape (`règle:entité:step:id`) était la même d'un passage à
 * l'autre : un 2e passage était refusé par l'index unique tant que le 1er
 * attendait encore. Mesuré sur staging (reentree-oui-parcours : 1 tâche).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../server/lib/mailer', async () => (await import('../quarantaine/_simulations')).mailerSimule(vi.fn(async () => ({ sent: true, messageId: 'x' }))));
vi.mock('../../server/routes/emails', async () => (await import('../quarantaine/_simulations')).emailsSimules());

import { clientEnregistreur, requetes } from '../quarantaine/automation/_enregistreur';
import { cleEtape } from '../../server/lib/automationSequences';
import { champsFiltrables } from '../../server/routes/webhooks-entrants';

const ORG = '11111111-1111-4111-8111-111111111111';
const etapes = [
  { id: 'e1', type: 'attendre', delai_secondes: 86_400, suivant: 'e2' },
  { id: 'e2', type: 'action', action: { type: 'create_task', config: { title: 'Rappel' } } },
];

async function deuxPassages(reentree: boolean) {
  const { initAutomationEngine } = await import('../../server/lib/automationEngine');
  const { eventBus } = await import('../../server/lib/eventBus');
  const { client, journal } = clientEnregistreur({
    automation_rules: { data: [{ id: 'r1', org_id: ORG, name: 'R', trigger_event: 'job.completed', conditions: {}, delay_seconds: 0, is_active: true, settings: { reentree }, actions: [{ type: 'create_task', config: { title: 'x' } }], steps: etapes }] },
    company_settings: { data: { company_name: 'A' } },
  });
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: null as any, baseUrl: 'http://t' });
  for (let i = 0; i < 2; i++) {
    await eventBus.emit('job.completed', { orgId: ORG, entityType: 'job', entityId: 'j1', metadata: {} });
    for (let k = 0; k < 40; k++) await new Promise((r) => setImmediate(r));
  }
  return new Set(requetes(journal, 'automation_scheduled_tasks', 'insert').map((r) => (r.valeur as any).execution_key));
}

describe('D-12 — deux passages d’un parcours', () => {
  it('repasser permis : deux clés d’étape distinctes', async () => {
    expect((await deuxPassages(true)).size).toBe(2);
  });

  it('témoin : repasser NON permis → la même clé (l’index refuse le 2e)', async () => {
    expect((await deuxPassages(false)).size).toBe(1);
  });

  it('un appel extérieur ne peut pas injecter un « passage »', () => {
    expect(champsFiltrables({ passage: 'x', source: 'facebook' })).toEqual({ source: 'facebook' });
    expect(cleEtape('r', 'e', 's', undefined)).toBe('r:e:step:s');
  });
});
