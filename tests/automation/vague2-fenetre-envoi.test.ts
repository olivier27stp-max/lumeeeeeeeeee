/**
 * Heures calmes et fenêtre d'envoi (audit V2, L4 et D-13).
 *
 * Mesuré sur staging : une demande d'avis immédiate partait à 20 h 01, et un
 * courriel immédiat à 20 h 18 alors que la règle avait une fenêtre 9 h-17 h
 * (« aucun message ne part en dehors de ces heures », promet l'écran).
 *
 * Mission finale, point 11 (B-08) : la fenêtre par défaut (8 h-20 h, heure de
 * l'entreprise) vaut maintenant pour TOUT message au client, courriel
 * immédiat compris — une confirmation par courriel sans fenêtre réglée
 * partait encore tout de suite, à 20 h 18 comme à 1 h du matin. Et le report
 * laisse une ligne au journal (`hors_heures`, B-09).
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
  const lignes = requetes(journal, 'automation_execution_logs', 'insert').map((r) => r.valeur as any);
  // La ligne « reporté : hors heures d'envoi » n'est pas une exécution.
  const executee = lignes.some((l) => l?.result_data?.saute_code !== 'hors_heures');
  const reportDit = lignes.filter((l) => l?.result_data?.saute_code === 'hors_heures');
  return { reportee, executee, reportDit };
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

  it('courriel immédiat SANS fenêtre réglée, à 20 h 18 : reporté lui aussi (fenêtre par défaut 8 h-20 h), et le journal le dit', async () => {
    // Avant la mission finale, ce cas était le « témoin » : la confirmation partait tout de suite, à toute heure.
    const r = await jouer({ type: 'send_email', config: { subject: 'S', body: 'B' } }, null);
    expect(r.reportee).toBe(true);
    expect(r.executee).toBe(false);
    expect(r.reportDit).toHaveLength(1);
    expect(r.reportDit[0]).toMatchObject({ result_success: true, action_type: 'send_email' });
    expect(String(r.reportDit[0].result_data.saute)).toMatch(/^Reporté : hors heures d’envoi/);
    expect(r.reportDit[0].result_data.prochain_creneau).toBe('2026-10-01T12:18:00.000Z'); // 8 h 18 à Montréal (pas de 30 min)
  });
});
