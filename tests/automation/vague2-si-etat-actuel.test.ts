/**
 * Une étape « Si » se juge sur l'état ACTUEL, avec les clés que l'éditeur
 * propose (audit V2, D-11).
 *
 * Les exemples cliquables (« statut = », « montant > », « created_at >= »)
 * visaient des clés jamais relues : condition toujours fausse. Et pour un
 * prospect, la relecture passait par la vue `leads_active`, qui n'existe
 * plus (vérifié en prod le 2026-09-30) : chaque branche était jugée sur
 * l'état d'ORIGINE.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../server/lib/mailer', async () => (await import('../quarantaine/_simulations')).mailerSimule(vi.fn(async () => ({ sent: true, messageId: 'x' }))));
vi.mock('../../server/routes/emails', async () => (await import('../quarantaine/_simulations')).emailsSimules());

import { clientEnregistreur, requetes } from '../quarantaine/automation/_enregistreur';

const ORG = '11111111-1111-4111-8111-111111111111';

async function brancheSuivie(entityType: string, conditions: Record<string, unknown>, lignes: Record<string, unknown>) {
  const { processScheduledTasks, initAutomationEngine } = await import('../../server/lib/automationEngine');
  const etapes = [
    { id: 'si1', type: 'si', conditions, alors: 'oui', sinon: 'non' },
    { id: 'oui', type: 'action', action: { type: 'create_task', config: { title: 'alors' } } },
    { id: 'non', type: 'action', action: { type: 'create_task', config: { title: 'sinon' } } },
  ];
  const tache = {
    id: 't-si', org_id: ORG, automation_rule_id: 'r1', entity_type: entityType, entity_id: 'e1', attempts: 0, status: 'pending', step_id: 'si1',
    execute_at: new Date().toISOString(), created_at: new Date().toISOString(), execution_key: 'r1:e1:si1',
    action_config: { type: '__sequence__', etape: 'si', trigger_event: 'quote.sent', event_metadata: {} },
    sequence_context: { franchies: 1 },
    automation_rules: { name: 'R', actions: [], conditions: {}, steps: etapes },
  };
  const { client, journal } = clientEnregistreur({
    automation_scheduled_tasks: (req: any) => (req.op === 'select' ? { data: [tache] } : { data: [{ id: tache.id }] }),
    company_settings: { data: { company_name: 'A', timezone: 'America/Montreal' } },
    ...lignes,
  });
  initAutomationEngine({ supabase: client, twilio: null as any, baseUrl: 'http://t' });
  await processScheduledTasks(client);
  const planifiee = requetes(journal, 'automation_scheduled_tasks', 'insert').map((r) => (r.valeur as any).step_id);
  return { planifiee, lectures: journal.filter((r) => r.op === 'select').map((r) => r.table) };
}

describe('D-11 — les exemples de l’éditeur fonctionnent', () => {
  it('« statut = sent », « montant > 1000 », « created_at >= 2026-06-01 » sur un devis → alors', async () => {
    const r = await brancheSuivie('quote',
      { statut: { eq: 'sent' }, montant: { gt: 1000 }, created_at: { gte: '2026-06-01' } },
      { quotes: { data: [{ status: 'sent', total_cents: 162690, created_at: '2026-09-12T15:00:00Z' }] } });
    expect(r.planifiee).toEqual(['oui']);
  });

  it('prospect : la relecture passe par clients (pas leads_active) et voit « qualifié »', async () => {
    const r = await brancheSuivie('lead',
      { lead_status: { eq: 'qualified' } },
      { clients: { data: [{ status: 'lead', lead_status: 'qualified', source: 'facebook', created_at: '2026-09-01T00:00:00Z' }] } });
    expect(r.lectures).not.toContain('leads_active');
    expect(r.planifiee).toEqual(['oui']);
  });
});
