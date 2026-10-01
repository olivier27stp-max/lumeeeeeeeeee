/**
 * Un bureau de TEST (au bac à sable des envois) n'ouvre pas de canal Slack.
 *
 * Mission « Lumi fiable », 2026-10-01 : le bac à sable interceptait courriels et
 * textos, mais pas l'escalade du support. « Je veux parler à quelqu'un » depuis
 * un bureau de test créait un vrai canal Slack et écrivait à l'équipe —
 * impossible d'évaluer le support en production sans déranger de vraies
 * personnes. L'escalade d'un bureau de test suit maintenant le repli par
 * courriel, que le bac à sable consigne.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const slack = vi.hoisted(() => ({ envoyer: vi.fn(async () => ({ ts: '1.1', channel: 'C1' })), configure: true }));
const bac = vi.hoisted(() => ({ simule: false }));
const courriels = vi.hoisted(() => [] as Array<{ to: string; subject: string }>);

vi.mock('../../server/lib/slack', () => ({
  isSlackConfigured: () => slack.configure,
  canalSupport: () => 'C-SUPPORT',
  envoyerMessageSlack: slack.envoyer,
  echapperSlack: (s: string) => s,
  deposerFichierSlack: vi.fn(async () => {}),
}));
vi.mock('../../server/lib/support/canaux-slack', () => ({
  canalClient: vi.fn(async () => ({ org_id: 'o', channel_id: 'C-CLIENT', channel_name: 'support-client', last_seen_ts: null })),
  signalerDansSupport: vi.fn(async () => {}),
}));
vi.mock('../../server/lib/bac-a-sable', async (original) => ({
  ...(await original<typeof import('../../server/lib/bac-a-sable')>()),
  verdictBacASable: vi.fn(async () => ({ simule: bac.simule, mode: 'succes', orgId: 'o', raison: bac.simule ? 'entreprise' : null })),
}));
vi.mock('../../server/lib/mailer', () => ({
  isMailerConfigured: () => true,
  sendEmail: vi.fn(async (p: { to: string; subject: string }) => { courriels.push({ to: p.to, subject: p.subject }); return { sent: true }; }),
}));
vi.mock('../../server/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

import { escaladerTicket, type Ticket } from '../../server/lib/support/tickets';

function adminFactice(): { admin: SupabaseClient; ecritures: Array<Record<string, unknown>> } {
  const ecritures: Array<Record<string, unknown>> = [];
  const chaine = (table: string): any => {
    const c: any = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'is', 'in']) c[m] = () => c;
    c.update = (v: Record<string, unknown>) => { ecritures.push({ table, ...v }); return c; };
    c.insert = (v: Record<string, unknown>) => { ecritures.push({ table, insert: true, ...v }); return c; };
    c.single = async () => ({ data: null, error: null });
    c.maybeSingle = async () => ({ data: null, error: null });
    c.then = (r: (x: unknown) => unknown) => r({ data: [], error: null });
    return c;
  };
  return { admin: { from: chaine, storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) } } as unknown as SupabaseClient, ecritures };
}

const ticket = { id: 't1', org_id: 'o', user_id: 'u', subject: 'Je veux parler à quelqu’un', status: 'ai', priority: 'normal', company_name: '[TEST] QA', user_name: 'Test', user_email: 'eval@lume-qa.test', slack_thread_ts: null, slack_channel_id: null } as unknown as Ticket;
const ctx = { companyName: '[TEST] QA', planLabel: 'Autopilot', langue: 'fr', userName: 'Test', slaKey: 'standard' } as never;

beforeEach(() => { slack.envoyer.mockClear(); courriels.length = 0; slack.configure = true; });

describe('escalade du support', () => {
  it('bureau de test : aucun message Slack, repli par courriel (intercepté par le bac à sable), ticket marqué escaladé', async () => {
    bac.simule = true;
    const { admin, ecritures } = adminFactice();
    const r = await escaladerTicket(admin, ticket, ctx, 'Demande de parler à un humain');
    expect(slack.envoyer).not.toHaveBeenCalled();
    expect(r.canal).toBe('email');
    expect(courriels).toHaveLength(1);
    const maj = ecritures.find((e) => e.table === 'support_tickets');
    expect(maj).toMatchObject({ status: 'open' });
    expect(maj?.slack_thread_ts).toBeUndefined();
    expect(ecritures.some((e) => e.table === 'support_messages' && e.body === 'escalated:email')).toBe(true);
  });

  it('vrai client : l’escalade passe par Slack, comme avant', async () => {
    bac.simule = false;
    const { admin, ecritures } = adminFactice();
    const r = await escaladerTicket(admin, ticket, ctx, 'Demande de parler à un humain');
    expect(slack.envoyer).toHaveBeenCalled();
    expect(r.canal).toBe('slack');
    expect(courriels).toHaveLength(0);
    expect(ecritures.find((e) => e.table === 'support_tickets')).toMatchObject({ slack_thread_ts: '1.1' });
  });
});
