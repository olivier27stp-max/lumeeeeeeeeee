/**
 * Launch 2026-09-28 — M7 : une adresse qui a rebondi n'est plus relancée.
 *
 * L'action courriel des automatisations n'appelait jamais
 * `adresseInjoignable()` (seules les relances de factures le faisaient) :
 * on écrivait à des adresses mortes et le journal disait « succès ».
 * Maintenant : étape SAUTÉE avec son motif, rien ne part, le parcours continue.
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

import { jouer, evenementPour, courant } from './filet-regression/_banc';
import { oublierDrapeaux } from '../../server/lib/automations-drapeaux';

const TZ = process.env.TZ;
process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.lume.test';
beforeEach(() => { oublierDrapeaux(); Object.defineProperty(etat.client, 'current', { get: () => courant.client, configurable: true }); });
afterEach(() => { vi.useRealTimers(); if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ; });

const REBOND = { email_deliveries: { data: [{ id: 'livraison-1', status: 'bounced' }] } };
const parcours = {
  id: 'relance', name: 'Relance', trigger_event: 'quote.sent', actions: [{ type: 'send_email', config: { subject: 'A', body: 'A' } }],
  steps: [
    { id: 'c1', type: 'action', action: { type: 'send_email', config: { subject: 'Votre soumission', body: 'Bonjour' } }, suivant: 'c2' },
    { id: 'c2', type: 'action', action: { type: 'send_sms', config: { body: 'Petit rappel' } }, suivant: null },
  ],
};

describe('M7 — rebonds', () => {
  it('adresse qui a rebondi : courriel sauté (motif), le parcours continue au texto', async () => {
    const s: any = await jouer(parcours as any, evenementPour('quote.sent'), etat.e, REBOND);
    expect(s.envois.filter((x: any) => x.canal === 'courriel')).toHaveLength(0);
    expect(s.envois.filter((x: any) => x.canal === 'sms')).toHaveLength(1);
    const log = s.ecritures.filter((w: any) => w.table === 'automation_execution_logs' && w.op === 'insert').map((w: any) => w.valeur)
      .find((v: any) => v.action_type === 'send_email');
    expect(log.result_success).toBe(true);
    expect(log.result_data).toMatchObject({ saute_code: 'adresse_injoignable' });
  }, 30_000);

  it('adresse saine : le courriel part', async () => {
    const s: any = await jouer(parcours as any, evenementPour('quote.sent'), etat.e);
    expect(s.envois.filter((x: any) => x.canal === 'courriel')).toHaveLength(1);
  }, 30_000);
});
