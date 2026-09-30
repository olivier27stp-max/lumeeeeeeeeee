/**
 * Deux prospects arrivés par le même webhook entrant sont DEUX prospects
 * (audit V2, D-02).
 *
 * L'entité de l'événement était l'id du webhook : la clé anti-doublon
 * « règle + entité » confondait deux appels à moins de 2 minutes, et le 2e
 * prospect (Zapier, Facebook) était reçu, consigné, jamais traité — mesuré
 * sur staging. Chaque appel est maintenant sa propre entité (sa trace de
 * réception) ; le même appel rejoué reste arrêté.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../server/lib/mailer', async () => (await import('../quarantaine/_simulations')).mailerSimule(vi.fn(async () => ({ sent: true, messageId: 'x' }))));
vi.mock('../../server/routes/emails', async () => (await import('../quarantaine/_simulations')).emailsSimules());

import { clientEnregistreur, journalExecutionsUnique } from '../quarantaine/automation/_enregistreur';

const ORG = '11111111-1111-4111-8111-111111111111';
const regle = { id: 'r-hook', org_id: ORG, name: 'Prospect Facebook', trigger_event: 'webhook.received', conditions: {}, delay_seconds: 0, is_active: true, actions: [{ type: 'create_task', config: { title: 'Rappeler le prospect' } }] };

async function moteur() {
  const { initAutomationEngine } = await import('../../server/lib/automationEngine');
  const { eventBus } = await import('../../server/lib/eventBus');
  const { client, journal } = clientEnregistreur({
    automation_rules: { data: [regle] },
    company_settings: { data: { company_name: 'A inc.' } },
    memberships: { data: [{ user_id: 'u-proprio', role: 'owner', status: 'active' }] },
    automation_execution_logs: journalExecutionsUnique(),
  });
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: null as any, baseUrl: 'http://test' });
  return { eventBus, journal };
}
const laisserTravailler = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };
const appel = (occurrence: string, nom: string) => ({ orgId: ORG, entityType: 'automation_webhook_receipt', entityId: occurrence, metadata: { nom, webhook_id: 'hook-1' } });

beforeEach(() => vi.useRealTimers());

describe('D-02 — une occurrence par appel reçu', () => {
  it('deux appels du même webhook à quelques secondes : deux exécutions', async () => {
    const { eventBus, journal } = await moteur();
    await eventBus.emit('webhook.received' as any, appel('trace-1', 'Marie'));
    await laisserTravailler();
    await eventBus.emit('webhook.received' as any, appel('trace-2', 'Paul'));
    await laisserTravailler();
    const cles = new Set(journal.filter((r) => r.table === 'automation_execution_logs' && r.op === 'insert').map((r) => (r.valeur as any).entity_id));
    expect([...cles].sort()).toEqual(['trace-1', 'trace-2']);
    expect(journal.filter((r) => r.table === 'tasks' && r.op === 'insert')).toHaveLength(2);
  });

  it('le MÊME appel émis deux fois : une seule exécution (anti-doublon intact)', async () => {
    const { eventBus, journal } = await moteur();
    await eventBus.emit('webhook.received' as any, appel('trace-1', 'Marie'));
    await laisserTravailler();
    await eventBus.emit('webhook.received' as any, appel('trace-1', 'Marie'));
    await laisserTravailler();
    expect(journal.filter((r) => r.table === 'tasks' && r.op === 'insert')).toHaveLength(1);
  });

  it('la route écrit la trace AVANT d’émettre, et en fait l’entité', () => {
    const route = readFileSync(join(__dirname, '..', '..', 'server', 'routes', 'webhooks-entrants.ts'), 'utf8');
    const iTrace = route.indexOf(".from('automation_webhook_receipts').insert({\n    webhook_id: hook.id, org_id: hook.org_id, statut: 'accepte'");
    const iEmission = route.indexOf("eventBus.emit('webhook.received'");
    expect(iTrace).toBeGreaterThan(-1);
    expect(iTrace).toBeLessThan(iEmission);
    expect(route.slice(iEmission, iEmission + 200)).toMatch(/entityId: occurrence/);
  });
});
