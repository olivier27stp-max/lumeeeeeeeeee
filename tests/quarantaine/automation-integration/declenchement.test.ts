/**
 * T1 (intégration, STAGING) — DÉCLENCHEMENT : rejeu et déplacement de visite.
 *
 *   T1.3  le même hook « visite créée » rejoué une heure plus tard → pas de
 *         seconde confirmation                                       ROUGE (F12/F3)
 *   T1.4  visite déplacée par le hook prévu → anciens rappels annulés avec
 *         motif, nouveaux rappels calés sur la nouvelle date              vert
 *
 * Opt-in `AUTOMATIONS_IT=1` / `DB_URL` ; refuse la prod ; fixtures `qa-t1-*`
 * nettoyées. Voir `_fixtures.ts`.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { Banc, DISPONIBLE, attendre, type OrgTest } from './_fixtures';

const sms: Array<{ to: string; body: string }> = [];
vi.mock('../../../server/lib/mailer', () => ({ isMailerConfigured: () => true, sendEmail: vi.fn(async () => ({ sent: true, messageId: 'test' })) }));
vi.mock('../../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'qa@lume.test' }) }));
vi.mock('../../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));
const twilio = { messages: { create: vi.fn(async (p: { to: string; body: string }) => { sms.push({ to: p.to, body: p.body }); return { sid: `SM_${sms.length}` }; }) } };

const banc = new Banc('t1');
let A: OrgTest;
let jeton = '';

function figerLHeure(offsetMs = 0) {
  const d = new Date(); d.setUTCHours(18, 0, 0, 0);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(d.getTime() + offsetMs));
}

describe.skipIf(!DISPONIBLE)('T1 — déclenchement (staging)', () => {
  beforeAll(async () => {
    A = await banc.creerOrg('A');
    jeton = await banc.jetonDe(A.owner.email);
    await banc.demarrerServeur({ client: twilio, phoneNumber: '+15550000000' });
  }, 60_000);
  afterAll(async () => { vi.useRealTimers(); await banc.nettoyer(); }, 60_000);
  beforeEach(() => { sms.length = 0; twilio.messages.create.mockClear(); figerLHeure(); });

  it('T1.4 — visite déplacée : anciens rappels annulés avec motif, nouveaux rappels sur la nouvelle date', async () => {
    const corps = { eventId: A.visite, jobId: A.job, clientId: A.client.id };
    expect((await banc.poster(jeton, A.id, 'appointment-created', corps)).statut).toBe(200);
    await attendre(async () => (await banc.tracesDe(A.visite)).taches.filter((t) => t.status === 'pending').length >= 2);
    const avant = (await banc.tracesDe(A.visite)).taches.filter((t) => t.status === 'pending');
    expect(avant.length).toBeGreaterThanOrEqual(2);

    // Déplacement de 5 jours par le hook prévu à cet effet.
    const { data: v } = await banc.admin.from('schedule_events').select('start_at').eq('id', A.visite).single();
    const nouveauStart = new Date(new Date(v!.start_at).getTime() + 5 * 86400_000).toISOString();
    await banc.admin.from('schedule_events').update({ start_at: nouveauStart, end_at: new Date(new Date(nouveauStart).getTime() + 3600_000).toISOString() }).eq('id', A.visite);
    const r = await banc.poster(jeton, A.id, 'appointment-rescheduled', { eventId: A.visite, jobId: A.job, startTime: nouveauStart });
    expect(r.statut).toBe(200);
    expect(r.corps.cancelled).toBe(avant.length);

    await attendre(async () => (await banc.tracesDe(A.visite)).taches.filter((t) => t.status === 'pending').length >= 2);
    const { taches } = await banc.tracesDe(A.visite);
    const annulees = taches.filter((t) => t.status === 'cancelled');
    const pendantes = taches.filter((t) => t.status === 'pending');
    expect(annulees.map((t) => t.id).sort()).toEqual(avant.map((t) => t.id).sort());
    for (const t of annulees) expect(t.last_error).toMatch(/déplacé/);
    // Les nouveaux rappels sont calés sur la NOUVELLE date : J-1 = start − 24 h.
    const j1 = pendantes.find((t) => t.execution_key.endsWith(`${A.regles.get('job_reminder_1d')}:${A.visite}:0`.slice(-45)) || t.automation_rule_id === A.regles.get('job_reminder_1d'));
    expect(j1, 'rappel J-1 non replanifié').toBeDefined();
    expect(new Date(j1!.execute_at).toISOString()).toBe(new Date(new Date(nouveauStart).getTime() - 86400_000).toISOString());
  }, 40_000);

  it('T1.3 — ROUGE ATTENDU (F12/F3) : le même hook rejoué une heure plus tard ne renvoie pas de confirmation', async () => {
    const corps = { eventId: A.visite, jobId: A.job, clientId: A.client.id };
    await banc.poster(jeton, A.id, 'appointment-created', corps);
    await attendre(async () => sms.some((s) => /confirm/i.test(s.body)));
    await new Promise((r) => setTimeout(r, 2500)); // laisser retomber tout ce qui est en vol (dont la confirmation de T1.4)
    const apresPremier = sms.filter((s) => /confirm/i.test(s.body)).length;
    expect(apresPremier).toBeGreaterThanOrEqual(1);

    figerLHeure(3600_000); // une heure plus tard, même corps (sauvegarde du job sans changement, double onglet…)
    await banc.poster(jeton, A.id, 'appointment-created', corps);
    await new Promise((r) => setTimeout(r, 2500));
    const total = sms.filter((s) => /confirm/i.test(s.body)).length;
    expect(total, `le rejeu a renvoyé ${total - apresPremier} confirmation(s) de plus au client`).toBe(apresPremier);
  }, 40_000);
});
