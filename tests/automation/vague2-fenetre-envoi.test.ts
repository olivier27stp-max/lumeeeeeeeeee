/**
 * Heures calmes et fenêtre d'envoi (audit V2, L4 et D-13).
 *
 * Mesuré sur staging : une demande d'avis immédiate partait à 20 h 01, et un
 * courriel immédiat à 20 h 18 alors que la règle avait une fenêtre 9 h-17 h
 * (« aucun message ne part en dehors de ces heures », promet l'écran).
 * Une confirmation immédiate par courriel SANS fenêtre réglée, elle, part
 * tout de suite : c'est voulu.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../server/lib/mailer', async () => (await import('../quarantaine/_simulations')).mailerSimule(vi.fn(async () => ({ sent: true, messageId: 'x' }))));
vi.mock('../../server/routes/emails', async () => (await import('../quarantaine/_simulations')).emailsSimules());

import { clientEnregistreur, requetes } from '../quarantaine/automation/_enregistreur';

const ORG = '11111111-1111-4111-8111-111111111111';
// 20 h 18 à Montréal (heure avancée) : hors de la fenêtre par défaut ET de 9 h-17 h.
const SOIR = new Date('2026-10-01T00:18:00Z');

afterEach(() => vi.useRealTimers());

async function jouer(action: { type: string; config: Record<string, unknown> }, settings: Record<string, unknown> | null) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(SOIR);
  const { initAutomationEngine } = await import('../../server/lib/automationEngine');
  const { eventBus } = await import('../../server/lib/eventBus');
  const { client, journal } = clientEnregistreur({
    automation_rules: { data: [{ id: 'r1', org_id: ORG, name: 'R', trigger_event: 'job.completed', conditions: {}, delay_seconds: 0, is_active: true, settings, actions: [action] }] },
    company_settings: { data: { company_name: 'A', timezone: 'America/Montreal', review_enabled: true, google_review_url: 'https://g.page/x' } },
    jobs: { data: [{ id: 'j1', client_id: 'c1', title: 'Gouttières' }] },
    clients: { data: [{ id: 'c1', first_name: 'Marie', email: 'marie@example.test', phone: '+15145550142', email_consent_at: '2026-01-01T00:00:00Z', sms_consent_at: '2026-01-01T00:00:00Z', email_opt_out_at: null }] },
    memberships: { data: [{ user_id: 'u1', role: 'owner', status: 'active' }] },
  });
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: null as any, baseUrl: 'http://t' });
  await eventBus.emit('job.completed', { orgId: ORG, entityType: 'job', entityId: 'j1', metadata: {} });
  for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
  const reportee = requetes(journal, 'automation_scheduled_tasks', 'insert').some((r) => (r.valeur as any)?.action_config?.report_heures_calmes === true);
  const executee = requetes(journal, 'automation_execution_logs', 'insert').length > 0;
  return { reportee, executee };
}

describe('L4 — la demande d’avis respecte les heures calmes', () => {
  it('à 20 h 18, elle est reportée au matin, pas envoyée', async () => {
    const r = await jouer({ type: 'request_review', config: {} }, null);
    expect(r.reportee).toBe(true);
    expect(r.executee).toBe(false);
  });
});

describe('D-13 — une fenêtre réglée vaut pour tous les messages', () => {
  it('courriel immédiat, fenêtre 9 h-17 h, à 20 h 18 : reporté', async () => {
    const r = await jouer({ type: 'send_email', config: { subject: 'S', body: 'B' } }, { fenetre: { debut: 9, fin: 17 } });
    expect(r.reportee).toBe(true);
    expect(r.executee).toBe(false);
  });

  it('témoin : confirmation immédiate par courriel SANS fenêtre réglée → part tout de suite', async () => {
    const r = await jouer({ type: 'send_email', config: { subject: 'S', body: 'B' } }, null);
    expect(r.reportee).toBe(false);
    expect(r.executee).toBe(true);
  });
});
