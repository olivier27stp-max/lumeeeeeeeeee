/**
 * Launch 2026-09-28 — M6 : un plan de 4 visites = UNE confirmation.
 *
 * Les visites créées en lot portent `suppress_immediate` (seule la 1re
 * confirme). Le garde ne valait que pour les règles simples : le pack
 * « rendez-vous » est un parcours, et chaque visite du plan envoyait sa
 * confirmation. Les rappels, eux, restent calés sur CHAQUE visite.
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
import { PACK_PARCOURS } from '../../server/lib/automationPack.data';
import { premiereEtapeSansConfirmation } from '../../server/lib/automationSequences';

const TZ = process.env.TZ;
process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.lume.test';
beforeEach(() => { oublierDrapeaux(); Object.defineProperty(etat.client, 'current', { get: () => courant.client, configurable: true }); });
afterEach(() => { vi.useRealTimers(); if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ; });

const rdv = PACK_PARCOURS.find((p) => p.preset_key === 'pack_rendez_vous')!;
const regle = { id: 'pack-rdv', name: 'Rendez-vous', trigger_event: rdv.trigger_event, actions: rdv.actions, steps: rdv.steps, preset_key: rdv.preset_key };
const confirmation = (s: any) => s.envois.filter((x: any) => (x.canal === 'sms' && /confirmé/.test(x.texte)) || (x.canal === 'courriel' && /confirm/i.test(x.subject ?? ''))).length;

describe('M6 — plan de visites', () => {
  it('4 visites (la 1re normale, 3 en lot) → une seule confirmation, des rappels pour chacune', async () => {
    let confirmations = 0;
    let visitesAvecRappel = 0;
    for (let i = 0; i < 4; i++) {
      const ev = evenementPour('appointment.created');
      if (i > 0) ev.metadata = { ...ev.metadata, suppress_immediate: true };
      const s: any = await jouer(regle as any, ev, etat.e);
      if (confirmation(s) > 0) confirmations++;
      if (s.planifie.some((p: any) => p.execute_at === '2026-09-18T13:00:00.000Z')) visitesAvecRappel++;
    }
    expect(confirmations).toBe(1);
    expect(visitesAvecRappel).toBe(4);
  }, 60_000);

  it('saute seulement les actions du début', () => {
    const e = premiereEtapeSansConfirmation(rdv.steps as any);
    expect(e?.type).toBe('attendre');
    expect(premiereEtapeSansConfirmation([{ id: 'a', type: 'action', action: { type: 'send_sms', config: { body: 'x' } }, suivant: null }] as any)).toBeNull();
  });
});
