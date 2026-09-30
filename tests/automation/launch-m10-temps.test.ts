/**
 * Launch 2026-09-28 — M10 (partie 1).
 *   1. Report en heures calmes dans le fuseau de l'ENTREPRISE (pas Montréal).
 *   2. Rappel « X avant » sans date : jamais planifié APRÈS, saut journalisé.
 *   3. Une confirmation qui passe par la file (reportée, ou 1re étape d'un
 *      parcours) reste TRANSACTIONNELLE : ni plafond, ni consentement marketing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const etat = vi.hoisted(() => ({
  e: { sms: [] as any[], courriels: [] as any[], appels: [] as any[], slack: [] as any[] },
  client: { current: null as any },
}));
vi.mock('../../server/lib/supabase', async (orig) => ({ ...(await orig<any>()), getServiceClient: () => etat.client.current }));
vi.mock('../../server/lib/mailer', async (orig) => ({
  ...(await orig<any>()),
  isMailerConfigured: () => true,
  sendEmail: vi.fn(async (p: any) => { etat.e.courriels.push({ to: p.to, subject: p.subject, html: p.html }); return { sent: true, messageId: 't' }; }),
}));
vi.mock('../../server/lib/twilioProvisioning', async (orig) => ({ ...(await orig<any>()), getOrgSmsFromNumber: async () => '+15550000000' }));

import { jouer, evenementPour, courant, monde } from './filet-regression/_banc';
import { oublierDrapeaux } from '../../server/lib/automations-drapeaux';
import { PACK_PARCOURS } from '../../server/lib/automationPack.data';

const TZ = process.env.TZ;
process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.lume.test';
beforeEach(() => { oublierDrapeaux(); Object.defineProperty(etat.client, 'current', { get: () => courant.client, configurable: true }); });
afterEach(() => { vi.useRealTimers(); if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ; });

const ecrits = (s: any, table: string) => s.ecritures.filter((w: any) => w.table === table && w.op === 'insert').flatMap((w: any) => (Array.isArray(w.valeur) ? w.valeur : [w.valeur]));

describe('M10 — fuseau, date absente, confirmations', () => {
  it('heures calmes : report calculé dans le fuseau de l’entreprise (Vancouver)', async () => {
    // Horloge du banc : 15 h UTC = 8 h à Vancouver, 11 h à Montréal. Fenêtre 9 h – 17 h.
    const base = monde({ id: 'x', trigger_event: 'appointment.created' });
    const vancouver = { company_settings: { data: [{ ...base.company_settings.data[0], timezone: 'America/Vancouver' }] } };
    const s: any = await jouer({ id: 'conf', trigger_event: 'appointment.created', delay_seconds: 0, settings: { fenetre: { debut: 9, fin: 17 } }, actions: [{ type: 'send_sms', config: { body: 'Confirmé' } }] } as any,
      evenementPour('appointment.created'), etat.e, vancouver);
    const tache = ecrits(s, 'automation_scheduled_tasks')[0];
    expect(tache?.execute_at).toBe('2026-09-13T16:00:00.000Z'); // 9 h à Vancouver
    expect(tache?.action_config?.report_heures_calmes).toBe(true);
  }, 30_000);

  it('rappel « 1 jour avant » sur un rendez-vous SANS date : rien de planifié après, saut journalisé', async () => {
    const base = monde({ id: 'x', trigger_event: 'appointment.created' });
    const sansDate = { schedule_events: { data: [{ ...base.schedule_events.data[0], start_at: null, start_time: null }] } };
    const s: any = await jouer({ id: 'veille', trigger_event: 'appointment.created', delay_seconds: -86400, actions: [{ type: 'send_sms', config: { body: 'Demain !' } }] } as any,
      evenementPour('appointment.created'), etat.e, sansDate);
    expect(ecrits(s, 'automation_scheduled_tasks')).toHaveLength(0);
    const log = ecrits(s, 'automation_execution_logs').find((l: any) => l.result_data?.saute_code);
    expect(log?.result_data?.saute_code).toBe('date_absente');
  }, 30_000);

  it('confirmation d’ouverture de parcours (1re étape) : part même sans consentement marketing', async () => {
    // Aucun job/devis/facture récent : pas de relation d'affaires, pas de consentement exprès.
    const sansRelation = { jobs: { data: [] }, quotes: { data: [] }, invoices: { data: [] } };
    const rdv = PACK_PARCOURS.find((p) => p.preset_key === 'pack_rendez_vous')!;
    const s: any = await jouer({ id: 'pack-rdv', name: 'Rendez-vous', trigger_event: rdv.trigger_event, actions: rdv.actions, steps: rdv.steps, preset_key: rdv.preset_key } as any,
      evenementPour('appointment.created'), etat.e, sansRelation);
    expect(s.envois.filter((x: any) => x.canal === 'sms' && /confirmé/.test(x.texte))).toHaveLength(1);
  }, 30_000);
});
