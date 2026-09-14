/**
 * PERF (intégration, STAGING) — UN TICK RÉEL DE 50 TÂCHES : requêtes et durée.
 *
 * On enveloppe `globalThis.fetch` (supabase-js passe par là) pour COMPTER les
 * appels PostgREST d'un dépilage de 50 tâches `send_sms` échues, contre la
 * vraie base. Le temps est rapporté à titre indicatif (dépend du réseau) ; le
 * nombre de requêtes est un cliquet.
 *
 * Mesure attendue d'après la lecture du code (A8) : ~10 à 15 requêtes par
 * tâche, séquentielles → 50 tâches ≈ 500 à 750 requêtes par tick.
 *
 * Opt-in `AUTOMATIONS_IT=1` / `DB_URL` ; refuse la prod ; fixtures `qa-perf-*`
 * nettoyées.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Banc, DISPONIBLE, type OrgTest } from './_fixtures';

vi.mock('../../server/lib/mailer', () => ({ isMailerConfigured: () => true, sendEmail: vi.fn(async () => ({ sent: true, messageId: 'test' })) }));
vi.mock('../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'qa@lume.test' }) }));
vi.mock('../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));
const twilio = { messages: { create: vi.fn(async () => ({ sid: 'SM_perf' })) } };

const banc = new Banc('perf');
let A: OrgTest;

describe.skipIf(!DISPONIBLE)('PERF — un tick de 50 tâches (staging)', () => {
  beforeAll(async () => {
    A = await banc.creerOrg('A');
    await banc.demarrerServeur({ client: twilio, phoneNumber: '+15550000000' });
  }, 60_000);
  afterAll(async () => { await banc.nettoyer(); }, 60_000);

  it('50 tâches send_sms échues : requêtes PostgREST comptées, durée rapportée', async () => {
    const { processScheduledTasks } = await import('../../server/lib/automationEngine');
    const lignes = Array.from({ length: 50 }, (_, i) => ({
      org_id: A.id, automation_rule_id: A.regles.get('job_reminder_2h'), entity_type: 'schedule_event', entity_id: A.visite,
      action_config: { type: 'send_sms', config: { body: `Perf ${i} [client_first_name]` }, trigger_event: 'appointment.created', event_metadata: {} },
      status: 'pending', attempts: 0, execution_key: `perf-${banc.stamp}-${i}`, execute_at: new Date(Date.now() - 60_000).toISOString(),
    }));
    const { error } = await banc.admin.from('automation_scheduled_tasks').insert(lignes);
    if (error) throw new Error(error.message);

    // Compteur d'appels réseau : chaque requête supabase-js est un fetch vers /rest/v1/.
    const fetchOrigine = globalThis.fetch;
    const parTable: Record<string, number> = {};
    let total = 0;
    globalThis.fetch = (async (entree: any, init?: any) => {
      const url = String(entree instanceof Request ? entree.url : entree);
      if (url.includes('/rest/v1/')) {
        total += 1;
        const table = (url.split('/rest/v1/')[1] || '').split('?')[0];
        parTable[table] = (parTable[table] || 0) + 1;
      }
      return fetchOrigine(entree, init);
    }) as typeof fetch;

    const debut = performance.now();
    try {
      await processScheduledTasks(banc.admin);
    } finally {
      globalThis.fetch = fetchOrigine;
    }
    const dureeMs = Math.round(performance.now() - debut);

    const { data: etat } = await banc.admin.from('automation_scheduled_tasks').select('status').eq('org_id', A.id).like('execution_key', `perf-${banc.stamp}-%`);
    const completees = (etat || []).filter((r) => r.status === 'completed').length;
    expect(completees).toBe(50);
    expect(twilio.messages.create).toHaveBeenCalledTimes(50);

    const parTache = Math.round((total / 50) * 10) / 10;
    process.stdout.write(`[perf] tick de 50 tâches send_sms : ${total} requêtes PostgREST (${parTache}/tâche), ${dureeMs} ms (${Math.round(dureeMs / 50)} ms/tâche)` + '\n' + Object.entries(parTable).sort((a, b) => b[1] - a[1]).map(([t, n]) => `   ${t.padEnd(30)} ${String(n).padStart(4)}`).join('\n') + '\n');
    // Cliquet : ~11 requêtes/tâche mesurées ; au-delà de 15, le moteur en fait plus qu'avant.
    expect(parTache, `${parTache} requêtes par tâche : ${JSON.stringify(parTable)}`).toBeLessThanOrEqual(15);
  }, 180_000);
});
