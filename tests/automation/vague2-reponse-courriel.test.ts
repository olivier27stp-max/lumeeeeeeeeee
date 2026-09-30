/**
 * Un client qui répond PAR COURRIEL est un client qui a répondu (audit V2, C12).
 *
 * Seul le texto émettait `client.replied`, et « a-t-il répondu ? » ne lisait
 * que les textos : un client qui répondait « oui » par courriel à une relance
 * continuait de la recevoir.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../server/lib/mailer', async () => (await import('../quarantaine/_simulations')).mailerSimule(vi.fn(async () => ({ sent: true, messageId: 'x' }))));
vi.mock('../../server/routes/emails', async () => (await import('../quarantaine/_simulations')).emailsSimules());

import { clientEnregistreur, requetes } from '../quarantaine/automation/_enregistreur';

const ORG = '11111111-1111-4111-8111-111111111111';

describe('C12 — la réponse par courriel arrête l’attente', () => {
  it('« attendre la réponse » : un courriel entrant du client → branche « réponse »', async () => {
    const { processScheduledTasks, initAutomationEngine } = await import('../../server/lib/automationEngine');
    const etapes = [
      { id: 'att', type: 'attendre', mode: 'reponse', delai_secondes: 86_400, si_reponse: 'merci', suivant: 'relance' },
      { id: 'merci', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler — il a répondu' } } },
      { id: 'relance', type: 'action', action: { type: 'send_email', config: { subject: 'Relance', body: 'x' } } },
    ];
    const tache = {
      id: 't-att', org_id: ORG, automation_rule_id: 'r1', entity_type: 'client', entity_id: 'c1', attempts: 0, status: 'pending', step_id: 'att',
      execute_at: new Date().toISOString(), created_at: new Date(Date.now() - 3600_000).toISOString(), execution_key: 'r1:c1:step:att',
      action_config: { type: '__sequence__', etape: 'attendre', mode: 'reponse', si_reponse: 'merci', suivant: 'relance', trigger_event: 'quote.sent', event_metadata: {} },
      sequence_context: { franchies: 1 },
      automation_rules: { name: 'R', actions: [], conditions: {}, steps: etapes },
    };
    const { client, journal } = clientEnregistreur({
      automation_scheduled_tasks: (req: any) => (req.op === 'select' ? { data: [tache] } : { data: [{ id: tache.id }] }),
      company_settings: { data: { company_name: 'A', timezone: 'America/Montreal' } },
      clients: { data: [{ id: 'c1', email: 'marie@example.test', status: 'active', deleted_at: null }] },
      messages: { data: [] },                     // aucun texto
      email_accounts: { data: [{ id: 'boite-1' }] },
      email_messages: { data: [{ id: 'courriel-1' }] }, // …mais un courriel entrant
    });
    initAutomationEngine({ supabase: client, twilio: null as any, baseUrl: 'http://t' });
    await processScheduledTasks(client);
    expect(requetes(journal, 'automation_scheduled_tasks', 'insert').map((r) => (r.valeur as any).step_id)).toEqual(['merci']);
    const lecture = requetes(journal, 'email_messages', 'select')[0];
    expect(lecture?.filtres).toContainEqual(['eq', 'direction', 'inbound']);
    expect(lecture?.filtres).toContainEqual(['in', 'account_id', ['boite-1']]);
  });
});

describe('C12 — la synchro de la boîte signale la réponse', () => {
  it('un NOUVEAU courriel entrant d’un client connu émet client.replied (canal courriel)', () => {
    const sync = readFileSync(join(__dirname, '..', '..', 'server', 'lib', 'email', 'sync', 'gmail.ts'), 'utf8');
    expect(sync).toMatch(/if \(!dejaVu && direction === 'inbound' && folder === 'inbox' && from\.email\)/);
    expect(sync).toMatch(/eventBus\.emit\('client\.replied'[\s\S]{0,200}canal: 'courriel'/);
    // Seulement une adresse du carnet de clients DU bureau.
    expect(sync).toMatch(/from\('clients'\)\.select\('id'\)\s*\n?\s*\.eq\('org_id', orgId\)/);
  });
});
