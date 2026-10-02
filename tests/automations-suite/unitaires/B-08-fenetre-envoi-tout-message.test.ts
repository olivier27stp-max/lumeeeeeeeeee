/**
 * B-08 — la fenêtre d'envoi (8 h-20 h par défaut, heure de l'entreprise) vaut
 * pour TOUT message au client : texto ET courriel, règle à délai ou non.
 *
 * Avant : le courriel d'une règle « à plat » sans délai était exempté. Une
 * facture devient « en retard » à minuit, heure de l'entreprise, et le
 * balayage tourne jour et nuit : « votre facture est en retard » partait à
 * 0 h 05. Et le cron des relances de paiement partait à 13:00 UTC pour tout
 * le monde — 5 h du matin à Vancouver.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const etat = vi.hoisted(() => ({ courriels: [] as string[], service: null as unknown }));
vi.mock('../../../server/lib/mailer', async (orig) => ({
  ...(await orig<any>()),
  isMailerConfigured: () => true,
  sendEmail: vi.fn(async (p: { to: string }) => { etat.courriels.push(p.to); return { sent: true, messageId: 'x' }; }),
}));
vi.mock('../../../server/lib/supabase', async (orig) => ({ ...(await orig<any>()), getServiceClient: () => etat.service }));

import { fauxSupabase, type Ligne } from './_faux-supabase';
import { tacheAttendLaFenetre, creneauLisible } from '../../../server/lib/automationEngine';
import { viderCacheFuseau } from '../../../server/lib/automations-fuseau-org';
import { viderCachePause } from '../../../server/lib/automations-pause-org';

const ORG = '11111111-1111-4111-8111-111111111111';
// 0 h 05 à Montréal, le 2 octobre 2026 : la facture vient de devenir « en retard ».
const NUIT = new Date('2026-10-02T04:05:00Z');
const MIDI = new Date('2026-10-02T16:00:00Z');

beforeEach(() => { etat.courriels.length = 0; viderCacheFuseau(); viderCachePause(); });
afterEach(() => vi.useRealTimers());

async function facturEnRetard(quand: Date, regle: Ligne) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(quand);
  const { initAutomationEngine } = await import('../../../server/lib/automationEngine');
  const { eventBus } = await import('../../../server/lib/eventBus');
  const sb = fauxSupabase({
    company_settings: [{ org_id: ORG, company_name: 'Nettoyage A', timezone: 'America/Montreal', automations_paused: false }],
    automation_rules: [{
      id: 'r1', org_id: ORG, name: 'Facture en retard', trigger_event: 'invoice.overdue', conditions: {}, delay_seconds: 0,
      is_active: true, deleted_at: null, steps: null, settings: null, ...regle,
    }],
    invoices: [{ id: 'f1', org_id: ORG, status: 'sent', client_id: 'c1', invoice_number: 'INV-1', total_cents: 10000, balance_cents: 10000 }],
    clients: [{ id: 'c1', org_id: ORG, first_name: 'Marie', email: 'marie@example.test', phone: '+15145550142', email_consent_at: '2026-01-01T00:00:00Z', sms_consent_at: '2026-01-01T00:00:00Z' }],
  });
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: sb.client, twilio: null as never, baseUrl: 'http://t' });
  await eventBus.emit('invoice.overdue', { orgId: ORG, entityType: 'invoice', entityId: 'f1', metadata: { days_overdue: 1 } });
  for (let i = 0; i < 80; i++) await new Promise((r) => setImmediate(r));
  return sb;
}

describe('[B-08] quels envois attendent la fenêtre', () => {
  it('tout message au client, repris ou non ; jamais une notification interne, une tâche, un webhook', () => {
    for (const type of ['send_sms', 'send_email', 'request_review', 'envoyer_facture', 'envoyer_soumission']) {
      expect(tacheAttendLaFenetre(type, {}, null), type).toBe(true);
      expect(tacheAttendLaFenetre(type, { reprise_immediate: true }, null), `${type} (reprise)`).toBe(true);
    }
    for (const type of ['create_notification', 'create_task', 'ajouter_note', 'ajouter_etiquette', 'webhook', 'update_custom_field']) {
      expect(tacheAttendLaFenetre(type, {}, null), type).toBe(false);
    }
  });

  it('le prochain créneau se dit dans le fuseau de l’entreprise', () => {
    expect(creneauLisible(new Date('2026-10-02T12:00:00Z'), 'America/Montreal')).toMatch(/2 oct\.?,? 08 h 00/);
    expect(creneauLisible(new Date('2026-10-02T12:00:00Z'), 'America/Vancouver')).toMatch(/05 h 00/);
  });
});

describe('[B-08] règle « à plat » sans délai, la nuit', () => {
  const COURRIEL = { type: 'send_email', config: { subject: 'Votre facture est en retard', body: 'Bonjour' } };

  it('courriel « facture en retard » à 0 h 05 : RIEN ne part ; il est reporté à 8 h, heure de l’entreprise', async () => {
    const sb = await facturEnRetard(NUIT, { actions: [COURRIEL] });
    expect(etat.courriels).toEqual([]);
    const [tache] = sb.tables.automation_scheduled_tasks;
    expect(tache).toMatchObject({ status: 'pending', action_config: { type: 'send_email', report_heures_calmes: true, motif_code: 'hors_heures' } });
    // 8 h 05 à Montréal (heure avancée) = 12:05 UTC.
    expect(tache.execute_at).toBe('2026-10-02T12:05:00.000Z');
  });

  /** L'action a-t-elle été EXÉCUTÉE tout de suite (une ligne de journal qui n'est pas un report), sans tâche reportée ? */
  const executeeToutDeSuite = (sb: Awaited<ReturnType<typeof facturEnRetard>>, type: string) => ({
    reportee: (sb.tables.automation_scheduled_tasks ?? []).some((t) => t.action_config?.report_heures_calmes === true),
    executee: (sb.tables.automation_execution_logs ?? []).some((l) => l.action_type === type && l.result_data?.saute_code !== 'hors_heures'),
  });

  it('témoin : le même courriel à midi est exécuté tout de suite, sans report', async () => {
    expect(executeeToutDeSuite(await facturEnRetard(MIDI, { actions: [COURRIEL] }), 'send_email')).toEqual({ reportee: false, executee: true });
  });

  it('une tâche interne n’est PAS concernée : elle est créée la nuit, sans attendre 8 h', async () => {
    const sb = await facturEnRetard(NUIT, { actions: [{ type: 'create_task', config: { title: 'Appeler le client' } }] });
    expect(executeeToutDeSuite(sb, 'create_task')).toEqual({ reportee: false, executee: true });
  });

  it('le réglage par automatisation est gardé : avec une fenêtre élargie à toute la journée, le courriel est exécuté la nuit', async () => {
    const sb = await facturEnRetard(NUIT, { actions: [COURRIEL], settings: { fenetre: { debut: 0, fin: 24 } } });
    expect(executeeToutDeSuite(sb, 'send_email')).toEqual({ reportee: false, executee: true });
  });
});

describe('[B-08] relances de paiement (cron) : une entreprise pour qui il fait nuit n’est pas relancée', () => {
  const monde = (fuseau: string) => fauxSupabase({
    reminder_settings: [{ org_id: ORG, enabled: true, schedule: [{ days_after_due: 1, channel: 'email' }] }],
    company_settings: [{ org_id: ORG, company_name: 'A', timezone: fuseau }],
    automation_rules: [],
    invoices: [],
  });

  it('13:00 UTC, entreprise à Vancouver (5 ou 6 h du matin) : sautée, aucune facture lue', async () => {
    const { executerRelancesPaiement } = await import('../../../server/routes/reminders-cron');
    const sb = monde('America/Vancouver');
    etat.service = sb.client;
    const r = await executerRelancesPaiement({ publicBase: 'https://app.lume.test', aujourdHui: new Date('2026-10-02T13:00:00Z') });
    expect(r.hors_fenetre).toBe(1);
    expect(sb.lectures()).not.toContain('invoices');
  });

  it('13:00 UTC, entreprise à Montréal (9 h) : traitée', async () => {
    const { executerRelancesPaiement } = await import('../../../server/routes/reminders-cron');
    const sb = monde('America/Montreal');
    etat.service = sb.client;
    const r = await executerRelancesPaiement({ publicBase: 'https://app.lume.test', aujourdHui: new Date('2026-10-02T13:00:00Z') });
    expect(r.hors_fenetre).toBe(0);
    expect(sb.lectures()).toContain('invoices');
  });

  it('filet horaire du tick : une entreprise n’y passe qu’à sa PREMIÈRE heure d’envoi (8 h chez elle)', async () => {
    const { executerRelancesPaiement } = await import('../../../server/routes/reminders-cron');
    const a8h = monde('America/Vancouver');
    etat.service = a8h.client;
    await executerRelancesPaiement({ publicBase: 'https://app.lume.test', aujourdHui: new Date('2026-10-02T15:10:00Z'), premiereHeureSeulement: true }); // 8 h 10
    expect(a8h.lectures()).toContain('invoices');
    viderCacheFuseau();
    const a11h = monde('America/Vancouver');
    etat.service = a11h.client;
    await executerRelancesPaiement({ publicBase: 'https://app.lume.test', aujourdHui: new Date('2026-10-02T18:10:00Z'), premiereHeureSeulement: true }); // 11 h 10
    expect(a11h.lectures()).not.toContain('invoices');
  });
});
