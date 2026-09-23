/**
 * T9 (unitaire) — LE TEMPS DANS LE MOTEUR D'AUTOMATISATIONS.
 *
 * Vrais modules, client enregistreur, horloge figée (`vi.setSystemTime`) et
 * fuseau du processus forcé par `process.env.TZ` (Node le relit à chaud) pour
 * reproduire Railway, où aucun TZ n'est posé → UTC.
 *
 * ROUGE ATTENDU aujourd'hui :
 *   T9.1  heure de rendez-vous formatée dans le fuseau du serveur (F2) — vérifié
 *         en prod : 12 SMS sur 12 annoncent l'heure UTC
 *   T9.2  rappel « 7 jours avant » calculé en millisecondes absolues → décalé
 *         d'une heure quand un changement d'heure tombe entre les deux dates
 *   T9.5  rappel « 2 h avant » un rendez-vous à 7 h repoussé par les heures
 *         calmes APRÈS le rendez-vous, au lieu d'être abandonné
 *
 * T9.11/T9.12 (jours de retard calculés en date UTC) ne sont PAS testables
 * sans exporter `detectOverdueInvoices` / `todayDateString` de scheduler.ts :
 * marqués `skip` avec le motif. Voir AUTOMATIONS_TEST_PLAN.md, T9.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../server/lib/mailer', () => ({ sendEmail: vi.fn(async () => ({ sent: true })), isMailerConfigured: () => true }));
vi.mock('../../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'test@lume.test' }), langueEntreprise: () => 'fr' }));
vi.mock('../../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));

import { clientEnregistreur, requetes } from './_enregistreur';

const ORG = '11111111-1111-4111-8111-111111111111';
const VISITE = '55555555-5555-4555-8555-555555555555';
const TZ_ORIGINE = process.env.TZ;

/** Heure locale (HH:MM) d'un instant à Montréal. */
const heureMontreal = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const dateMontreal = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

const visite = (startAt: string) => ({
  schedule_events: { data: { id: VISITE, job_id: 'job-a', start_at: startAt, status: 'scheduled', deleted_at: null, job: { id: 'job-a', title: 'Gouttières', property_address: '10 rue A', client_id: 'client-a', clients: { first_name: 'Alice', last_name: 'A', email: 'alice@a.test', phone: '+15145550101' } } } },
  company_settings: { data: { company_name: 'A inc.', default_language: 'fr' } },
  job_agreements: { data: null }, sms_opt_outs: { data: null }, conversations: { data: { id: 'conv-1', client_id: null } },
  messages: { data: null, count: 0 }, activity_log: { data: null }, automation_execution_logs: { data: null },
});

const regleRappel = (delaySeconds: number) => ({
  id: `regle-${delaySeconds}`, org_id: ORG, name: `Rappel ${delaySeconds}`, trigger_event: 'appointment.created', conditions: {}, delay_seconds: delaySeconds, is_active: true,
  actions: [{ type: 'send_sms', config: { body: 'Rappel [client_first_name] : [appointment_date] à [appointment_time]' } }],
});

let twilio: { messages: { create: ReturnType<typeof vi.fn> } };
beforeEach(() => { vi.clearAllMocks(); twilio = { messages: { create: vi.fn(async () => ({ sid: 'SM' })) } }; });
afterEach(() => { vi.useRealTimers(); if (TZ_ORIGINE === undefined) delete process.env.TZ; else process.env.TZ = TZ_ORIGINE; });

async function moteur(reponses: Record<string, any>) {
  const { initAutomationEngine, processScheduledTasks } = await import('../../../server/lib/automationEngine');
  const { eventBus } = await import('../../../server/lib/eventBus');
  const { client, journal } = clientEnregistreur(reponses);
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'http://test' });
  return { client, journal, eventBus, processScheduledTasks };
}
const laisserTravailler = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

describe('T9.1 — l’heure de rendez-vous écrite au client est celle de Montréal, quel que soit le fuseau du serveur', () => {
  // 13:00Z le 13 septembre = 09:00 à Montréal (heure avancée).
  const RDV = '2026-09-13T13:00:00Z';

  it('ROUGE ATTENDU (F2) : serveur en UTC (Railway) → « 09:00 », pas « 13:00 »', async () => {
    process.env.TZ = 'UTC';
    const { resolveEntityVariables } = await import('../../../server/lib/actions');
    const { client } = clientEnregistreur(visite(RDV));
    const vars = await resolveEntityVariables(client, ORG, 'schedule_event', VISITE);
    expect(vars.appointment_date).toBe('2026-09-13');
    expect(vars.appointment_time.replace(/\s*h\s*/, ':'), `heure écrite au client : « ${vars.appointment_time} » pour un rendez-vous à 9 h à Montréal`).toMatch(/^0?9:00$/);
  });

  it('témoin : serveur réglé sur America/Toronto → l’heure est juste (donc le résultat dépend du serveur, pas de l’entreprise)', async () => {
    process.env.TZ = 'America/Toronto';
    const { resolveEntityVariables } = await import('../../../server/lib/actions');
    const { client } = clientEnregistreur(visite(RDV));
    const vars = await resolveEntityVariables(client, ORG, 'schedule_event', VISITE);
    expect(vars.appointment_time.replace(/\s*h\s*/, ':')).toMatch(/^0?9:00$/);
  });

  it('ROUGE ATTENDU (F2) : un rendez-vous à 22 h à Montréal ne change pas de DATE sur un serveur UTC', async () => {
    process.env.TZ = 'UTC';
    const { resolveEntityVariables } = await import('../../../server/lib/actions');
    // 22:00 EDT le 13 = 02:00Z le 14.
    const { client } = clientEnregistreur(visite('2026-09-14T02:00:00Z'));
    const vars = await resolveEntityVariables(client, ORG, 'schedule_event', VISITE);
    expect(vars.appointment_date, `date écrite au client : ${vars.appointment_date}`).toBe('2026-09-13');
  });
});

describe('T9.2 — rappel « X jours avant » à cheval sur un changement d’heure', () => {
  it('ROUGE ATTENDU : rendez-vous le 2 nov. 2026 à 10 h (heure normale) → rappel J-7 le 26 oct. à 10 h locale, pas 11 h', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T14:00:00Z'));
    // 2026-11-02 10:00 EST = 15:00Z (le retour à l'heure normale a lieu le 1er nov. à 2 h).
    // 7 jours = 604 800 s absolues ; le 26 oct. est encore à l'heure avancée : même instant UTC, heure locale +1.
    const { eventBus, journal } = await moteur({ ...visite('2026-11-02T15:00:00Z'), automation_rules: { data: [regleRappel(-604800)] } });
    await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: {} });
    await laisserTravailler();
    const inserts = requetes(journal, 'automation_scheduled_tasks', 'insert');
    expect(inserts).toHaveLength(1);
    const executeAt = (inserts[0].valeur as any).execute_at as string;
    expect(dateMontreal(executeAt)).toBe('2026-10-26');
    expect(heureMontreal(executeAt), `rappel calé à ${heureMontreal(executeAt)} heure de Montréal (${executeAt}) pour un rendez-vous à 10:00`).toBe('10:00');
  });

  it('témoin : J-1 du même rendez-vous — le changement d’heure est déjà passé le 1er nov. à 2 h, l’heure locale est juste', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T14:00:00Z'));
    const { eventBus, journal } = await moteur({ ...visite('2026-11-02T15:00:00Z'), automation_rules: { data: [regleRappel(-86400)] } });
    await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: {} });
    await laisserTravailler();
    const executeAt = (requetes(journal, 'automation_scheduled_tasks', 'insert')[0].valeur as any).execute_at as string;
    expect(dateMontreal(executeAt)).toBe('2026-11-01');
    expect(heureMontreal(executeAt)).toBe('10:00');
  });

  it('témoin : sans changement d’heure entre les deux, le rappel tombe à la bonne heure', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-10T14:00:00Z'));
    const { eventBus, journal } = await moteur({ ...visite('2026-09-15T14:00:00Z'), automation_rules: { data: [regleRappel(-86400)] } });
    await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: {} });
    await laisserTravailler();
    const executeAt = (requetes(journal, 'automation_scheduled_tasks', 'insert')[0].valeur as any).execute_at as string;
    expect(dateMontreal(executeAt)).toBe('2026-09-14');
    expect(heureMontreal(executeAt)).toBe('10:00');
  });
});

describe('T9.3/T9.4 — heures calmes et changement d’heure du printemps', () => {
  it('isQuietHours : bornes exactes à Montréal, été et hiver', async () => {
    const { isQuietHours } = await import('../../../server/lib/automationEngine');
    // Été (EDT = UTC−4)
    expect(isQuietHours(new Date('2026-07-15T11:59:00Z'))).toBe(true);   // 07:59
    expect(isQuietHours(new Date('2026-07-15T12:00:00Z'))).toBe(false);  // 08:00
    expect(isQuietHours(new Date('2026-07-15T23:59:00Z'))).toBe(false);  // 19:59
    expect(isQuietHours(new Date('2026-07-16T00:00:00Z'))).toBe(true);   // 20:00
    // Hiver (EST = UTC−5)
    expect(isQuietHours(new Date('2026-01-15T12:59:00Z'))).toBe(true);   // 07:59
    expect(isQuietHours(new Date('2026-01-15T13:00:00Z'))).toBe(false);  // 08:00
    expect(isQuietHours(new Date('2026-01-16T00:59:00Z'))).toBe(false);  // 19:59
    expect(isQuietHours(new Date('2026-01-16T01:00:00Z'))).toBe(true);   // 20:00
  });

  it('nextSendTime : un rappel prévu 01:30 le dimanche du passage à l’heure avancée part à 08:00, jamais dans le trou 02:00-03:00', async () => {
    const { nextSendTime } = await import('../../../server/lib/automationEngine');
    // 2026-03-08 : 01:30 EST = 06:30Z. À 02:00 EST l'horloge saute à 03:00 EDT.
    const prochain = nextSendTime(new Date('2026-03-08T06:30:00Z'));
    expect(prochain.toISOString()).toBe('2026-03-08T12:00:00.000Z'); // 08:00 EDT
    expect(heureMontreal(prochain.toISOString())).toBe('08:00');
  });

  it('nextSendTime : hors heures calmes, l’envoi est immédiat (+30 min au plus)', async () => {
    const { nextSendTime } = await import('../../../server/lib/automationEngine');
    const depuis = new Date('2026-09-15T18:00:00Z'); // 14:00 EDT
    expect(nextSendTime(depuis).getTime() - depuis.getTime()).toBeLessThanOrEqual(30 * 60_000);
  });
});

describe('T9.5 — un rappel « avant » que les heures calmes repousseraient APRÈS le rendez-vous est abandonné', () => {
  it('ROUGE ATTENDU : rappel 2 h avant un rendez-vous à 7 h, échu à 5 h → annulé, pas envoyé à 8 h (une heure après le passage)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T09:05:00Z')); // 05:05 EDT
    const tache = {
      id: 'tache-1', org_id: ORG, automation_rule_id: 'regle--7200', entity_type: 'schedule_event', entity_id: VISITE, attempts: 0,
      execute_at: '2026-09-15T09:00:00Z', status: 'pending', execution_key: 'k',
      action_config: { type: 'send_sms', config: { body: 'Rappel' }, trigger_event: 'appointment.created', event_metadata: { start_time: '2026-09-15T11:00:00Z' } },
      automation_rules: { name: 'Rappel 2 h', actions: [], conditions: {} },
    };
    const { processScheduledTasks, client, journal } = await moteur({ ...visite('2026-09-15T11:00:00Z'), automation_scheduled_tasks: { data: [tache] } });
    await processScheduledTasks(client);
    const misesAJour = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any);
    expect(misesAJour.length).toBeGreaterThan(0);
    const derniere = misesAJour.at(-1);
    const rendezVous = new Date('2026-09-15T11:00:00Z').getTime();
    const repousseApres = derniere.execute_at && new Date(derniere.execute_at).getTime() > rendezVous;
    expect(derniere.status === 'cancelled' || !repousseApres, `rappel repoussé à ${derniere.execute_at} (${heureMontreal(derniere.execute_at)}) pour un rendez-vous à 07:00`).toBe(true);
    expect(twilio.messages.create).not.toHaveBeenCalled();
  });
});

describe('T9.6 — rendez-vous pris à court terme', () => {
  it('rendez-vous demain 9 h, règle J-7 → aucune tâche (créneau dépassé) ; règle J-1 → tâche aujourd’hui 9 h', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T12:00:00Z')); // aujourd'hui 08:00 EDT
    const rdv = '2026-09-16T13:00:00Z';                   // demain 09:00 EDT
    const { eventBus, journal } = await moteur({ ...visite(rdv), automation_rules: { data: [regleRappel(-604800), regleRappel(-86400)] } });
    await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: {} });
    await laisserTravailler();
    const inserts = requetes(journal, 'automation_scheduled_tasks', 'insert').map((r) => r.valeur as any);
    expect(inserts.map((i) => i.automation_rule_id)).toEqual(['regle--86400']);
    expect(inserts[0].execute_at).toBe('2026-09-15T13:00:00.000Z');
  });

  it('légèrement en retard (10 min) → exécution dans 5 s, le message reste juste', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T13:10:00Z')); // 09:10 EDT ; rappel J-1 prévu 09:00
    const rdv = '2026-09-16T13:00:00Z';
    const { eventBus, journal } = await moteur({ ...visite(rdv), automation_rules: { data: [regleRappel(-86400)] } });
    await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: {} });
    await laisserTravailler();
    const executeAt = new Date((requetes(journal, 'automation_scheduled_tasks', 'insert')[0].valeur as any).execute_at).getTime();
    expect(executeAt - Date.now()).toBeCloseTo(5000, -3);
  });

  it('franchement dépassé (2 h) → abandonné, rien de planifié', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T15:00:00Z')); // 11:00 EDT ; rappel J-1 prévu 09:00
    const { eventBus, journal } = await moteur({ ...visite('2026-09-16T13:00:00Z'), automation_rules: { data: [regleRappel(-86400)] } });
    await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: {} });
    await laisserTravailler();
    expect(requetes(journal, 'automation_scheduled_tasks', 'insert')).toHaveLength(0);
  });
});

describe('T9.11/T9.12 — jours de retard et « aujourd’hui » dans le fuseau de l’entreprise', () => {
  it.skip('non testable : detectOverdueInvoices et todayDateString ne sont pas exportés de server/lib/scheduler.ts (F14) — à tester dès qu’une fonction dateOrg() partagée existe', () => {});
});
