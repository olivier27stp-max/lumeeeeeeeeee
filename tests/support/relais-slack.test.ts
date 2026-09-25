/**
 * Relevé périodique des fils Slack (filet quand l'abonnement aux événements
 * ne livre rien) : relit `conversations.replies` des tickets ouverts et relaie
 * ce qui n'est pas encore enregistré.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const journal: Array<{ table: string; op: string; valeur?: unknown }> = [];
let tickets: any[] = [];
let connus: string[] = [];
vi.mock('../../server/lib/supabase', () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      const req = { table, op: 'select', valeur: undefined as unknown };
      journal.push(req);
      const o: any = {};
      const self = () => o;
      for (const m of ['select', 'order', 'limit', 'neq', 'eq', 'in', 'not', 'gte', 'is']) o[m] = self;
      o.insert = (v: unknown) => { req.op = 'insert'; req.valeur = v; return o; };
      o.update = (v: unknown) => { req.op = 'update'; req.valeur = v; return o; };
      o.maybeSingle = async () => (table === 'support_messages' && req.op === 'insert' ? { data: { id: 'm', ...(req.valeur as object) }, error: null } : { data: null, error: null });
      o.single = o.maybeSingle;
      o.then = (res: any, rej?: any) => Promise.resolve({
        data: table === 'support_tickets' && req.op === 'select' ? tickets : table === 'support_messages' && req.op === 'select' ? connus.map((slack_ts) => ({ slack_ts })) : null,
        error: null,
      }).then(res, rej);
      return o;
    },
  }),
}));
const courriels: any[] = [];
vi.mock('../../server/lib/mailer', () => ({ isMailerConfigured: () => true, sendEmail: vi.fn(async (p: any) => { courriels.push(p); return { sent: true }; }) }));
vi.mock('../../server/lib/helpers', () => ({ resolvePublicBaseUrl: () => 'https://lumecrm.net', normalizeE164: (s: string) => s, findOrCreateConversation: async () => ({ id: 'c' }) }));
let repliques: any[] = [];
const accuses: Array<{ channel: string; ts: string; ok: boolean }> = [];
vi.mock('../../server/lib/slack', () => ({
  isSlackConfigured: () => true,
  identiteBot: async () => ({ user_id: 'UBOT', bot_id: 'BBOT' }),
  nomUtilisateurSlack: async (u: string) => (u === 'URAFBA' ? 'Rafba' : 'Support'),
  texteDepuisSlack: (s: string) => s.trim(),
  lireRepliquesSlack: async () => repliques,
  accuserLivraisonSlack: async (channel: string, ts: string, ok: boolean) => { accuses.push({ channel, ts, ok }); },
}));

import { releverReponsesSlack, cadenceReleveMs } from '../../server/lib/support/relais-slack';

const ticket = { id: 't1', org_id: 'org1', user_id: 'u1', subject: 'Facture', status: 'open', user_email: 'marie@ex.test', slack_channel_id: 'C1', slack_thread_ts: '1.0' };
beforeEach(() => { journal.length = 0; courriels.length = 0; tickets = [ticket]; connus = []; repliques = []; });

describe('relevé des fils Slack', () => {
  it('une réponse humaine pas encore enregistrée → relayée (message agent, ticket répondu, courriel)', async () => {
    repliques = [
      { ts: '2.0', user: 'UBOT', bot_id: 'BBOT', text: 'transcript (notre bot)' },
      { ts: '3.0', user: 'URAFBA', text: 'Test 2' },
    ];
    const n = await releverReponsesSlack();
    expect(n).toBe(1);
    const inserts = journal.filter((j) => j.table === 'support_messages' && j.op === 'insert').map((j) => j.valeur as any);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ ticket_id: 't1', author: 'agent', author_name: 'Rafba', body: 'Test 2', slack_ts: '3.0' });
    expect(journal.some((j) => j.table === 'support_tickets' && j.op === 'update' && (j.valeur as any).status === 'answered')).toBe(true);
    expect(courriels).toHaveLength(1);
    // ✅ posé sur le message de Rafba dans Slack : la preuve visible que c'est rendu.
    expect(accuses.at(-1)).toEqual({ channel: 'C1', ts: '3.0', ok: true });
  });

  it('une réponse déjà enregistrée (par le webhook) n’est pas relayée deux fois', async () => {
    connus = ['3.0'];
    repliques = [{ ts: '3.0', user: 'URAFBA', text: 'Test 2' }];
    expect(await releverReponsesSlack()).toBe(0);
    expect(journal.some((j) => j.table === 'support_messages' && j.op === 'insert')).toBe(false);
  });

  it('un autre bot (Grok) dans le fil est relayé SEULEMENT s il est autorisé (SLACK_BOTS_RELAYES) ; notre bot et le parent ne le sont pas', async () => {
    process.env.SLACK_BOTS_RELAYES = 'BGROK';
    repliques = [
      { ts: '1.0', user: 'UBOT', bot_id: 'BBOT', text: 'parent' },
      { ts: '4.0', bot_id: 'BGROK', subtype: 'bot_message', text: 'Réponse de Grok' },
      { ts: '5.0', user: 'UBOT', text: 'nous' },
    ];
    expect(await releverReponsesSlack()).toBe(1);
    const inserts = journal.filter((j) => j.table === 'support_messages' && j.op === 'insert').map((j) => j.valeur as any);
    expect(inserts.map((i) => i.body)).toEqual(['Réponse de Grok']);
  });

  it('aucun ticket ouvert → aucun appel Slack', async () => {
    tickets = [];
    expect(await releverReponsesSlack()).toBe(0);
  });

  it('cadence : défaut 45 s, plancher 10 s, 0 désactive', () => {
    expect(cadenceReleveMs({})).toBe(45_000);
    expect(cadenceReleveMs({ SLACK_POLL_MS: '20000' })).toBe(20_000);
    expect(cadenceReleveMs({ SLACK_POLL_MS: '500' })).toBe(45_000);
    expect(cadenceReleveMs({ SLACK_POLL_MS: '0' })).toBe(0);
  });
});
