/**
 * Support humain dans Slack — le webhook entrant.
 *
 *   - signature v0 vérifiée sur le corps brut, rejet hors ±5 min, rejet sans secret
 *   - poignée de main url_verification
 *   - seuls les messages DANS un fil de ticket, pas de notre bot, sont relayés
 *   - une réponse dans un fil connu → message `agent` + ticket `answered` + notification + courriel
 *   - un rejeu Slack (même ts) n'écrit rien deux fois
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

const journal: Array<{ table: string; op: string; valeur?: unknown; filtres: unknown[] }> = [];
let ticketTrouve: Record<string, unknown> | null = null;
let doublonMessage = false;

vi.mock('../../server/lib/supabase', () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      const req = { table, op: 'select', valeur: undefined as unknown, filtres: [] as unknown[] };
      journal.push(req);
      const o: any = {};
      const self = () => o;
      for (const m of ['select', 'order', 'limit', 'neq']) o[m] = self;
      o.eq = (c: string, v: unknown) => { req.filtres.push([c, v]); return o; };
      o.is = (c: string, v: unknown) => { req.filtres.push([c, v]); return o; };
      o.insert = (v: unknown) => { req.op = 'insert'; req.valeur = v; return o; };
      o.update = (v: unknown) => { req.op = 'update'; req.valeur = v; return o; };
      o.maybeSingle = async () => {
        if (table === 'support_tickets' && req.op === 'select') return { data: ticketTrouve, error: null };
        if (table === 'support_messages' && req.op === 'insert') return doublonMessage ? { data: null, error: { code: '23505', message: 'dup' } } : { data: { id: 'm1', ...(req.valeur as object) }, error: null };
        return { data: null, error: null };
      };
      o.single = o.maybeSingle;
      o.then = (res: any) => Promise.resolve({ data: null, error: null }).then(res);
      return o;
    },
  }),
}));
const courriels: any[] = [];
vi.mock('../../server/lib/mailer', () => ({ isMailerConfigured: () => true, sendEmail: vi.fn(async (p: any) => { courriels.push(p); return { sent: true }; }) }));
vi.mock('../../server/lib/helpers', () => ({ resolvePublicBaseUrl: () => 'https://lumecrm.net', normalizeE164: (s: string) => s, findOrCreateConversation: async () => ({ id: 'c' }) }));
vi.mock('../../server/lib/slack', async (orig) => {
  const reel = await (orig as () => Promise<typeof import('../../server/lib/slack')>)();
  return { ...reel, identiteBot: async () => ({ user_id: 'UBOT', bot_id: 'BBOT' }), nomUtilisateurSlack: async (u: string) => (u === 'URAFBA' ? 'Rafba' : 'Support') };
});

import { verifierSignatureSlack } from '../../server/lib/slack';
import { estReponseDansUnFil, slackWebhookHandler } from '../../server/routes/webhooks-slack';

const SECRET = 'secret-de-test';
function signer(corps: string, ts = Math.floor(Date.now() / 1000)) {
  return { ts: String(ts), sig: `v0=${createHmac('sha256', SECRET).update(`v0:${ts}:${corps}`).digest('hex')}` };
}
function requete(corps: string, entetes: Record<string, string | undefined>) {
  return { body: Buffer.from(corps), header: (n: string) => entetes[n.toLowerCase()] } as any;
}
function reponse() {
  const r: any = { statut: 0, corps: null, status(s: number) { r.statut = s; return r; }, json(c: unknown) { r.corps = c; return r; } };
  return r;
}
const attendre = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => { journal.length = 0; courriels.length = 0; ticketTrouve = null; doublonMessage = false; process.env.SLACK_SIGNING_SECRET = SECRET; });

describe('signature Slack', () => {
  it('accepte une signature valide, refuse une signature altérée ou un horodatage vieux de 10 min', () => {
    const corps = '{"type":"x"}';
    const { ts, sig } = signer(corps);
    expect(verifierSignatureSlack({ signature: sig, timestamp: ts }, corps, SECRET)).toBe(true);
    // Dernier caractère changé pour un AUTRE (si le hash finit déjà par 0, on met 1) : sinon la « signature altérée » serait identique.
    const alteree = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
    expect(verifierSignatureSlack({ signature: alteree, timestamp: ts }, corps, SECRET)).toBe(false);
    expect(verifierSignatureSlack({ signature: sig, timestamp: ts }, corps + ' ', SECRET)).toBe(false);
    const vieux = signer(corps, Math.floor(Date.now() / 1000) - 600);
    expect(verifierSignatureSlack({ signature: vieux.sig, timestamp: vieux.ts }, corps, SECRET)).toBe(false);
    expect(verifierSignatureSlack({ signature: sig, timestamp: ts }, corps, '')).toBe(false);
  });

  it('sans secret configuré : 503, jamais OK', async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    const r = reponse();
    await slackWebhookHandler(requete('{}', {}), r);
    expect(r.statut).toBe(503);
  });

  it('signature invalide : 401', async () => {
    const r = reponse();
    await slackWebhookHandler(requete('{"type":"event_callback"}', { 'x-slack-signature': 'v0=faux', 'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)) }), r);
    expect(r.statut).toBe(401);
  });

  it('url_verification : renvoie le challenge', async () => {
    const corps = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });
    const { ts, sig } = signer(corps);
    const r = reponse();
    await slackWebhookHandler(requete(corps, { 'x-slack-signature': sig, 'x-slack-request-timestamp': ts }), r);
    expect(r.statut).toBe(200);
    expect(r.corps).toEqual({ challenge: 'abc123' });
  });
});

describe('estReponseDansUnFil', () => {
  const bot = { user_id: 'UBOT', bot_id: 'BBOT' };
  it('garde une réponse humaine dans un fil, et celle d’un AUTRE bot (Grok…)', () => {
    expect(estReponseDansUnFil({ type: 'message', channel: 'C1', user: 'URAFBA', text: 'Salut', ts: '2.0', thread_ts: '1.0' }, bot)).toBe(true);
    expect(estReponseDansUnFil({ type: 'message', subtype: 'bot_message', bot_id: 'BGROK', text: 'Bonjour', ts: '2.0', thread_ts: '1.0' }, bot)).toBe(true);
  });
  it('ignore notre propre bot, le parent du fil, les messages hors fil, les éditions/suppressions, le vide', () => {
    expect(estReponseDansUnFil({ type: 'message', user: 'UBOT', text: 'x', ts: '2.0', thread_ts: '1.0' }, bot)).toBe(false);
    expect(estReponseDansUnFil({ type: 'message', bot_id: 'BBOT', text: 'x', ts: '2.0', thread_ts: '1.0' }, bot)).toBe(false);
    expect(estReponseDansUnFil({ type: 'message', user: 'URAFBA', text: 'x', ts: '1.0', thread_ts: '1.0' }, bot)).toBe(false);
    expect(estReponseDansUnFil({ type: 'message', user: 'URAFBA', text: 'x', ts: '3.0' }, bot)).toBe(false);
    expect(estReponseDansUnFil({ type: 'message', subtype: 'message_changed', user: 'URAFBA', text: 'x', ts: '2.0', thread_ts: '1.0' }, bot)).toBe(false);
    expect(estReponseDansUnFil({ type: 'message', user: 'URAFBA', text: '   ', ts: '2.0', thread_ts: '1.0' }, bot)).toBe(false);
    expect(estReponseDansUnFil({ type: 'reaction_added', user: 'URAFBA', text: 'x', ts: '2.0', thread_ts: '1.0' }, bot)).toBe(false);
  });
});

describe('une réponse dans un fil de ticket', () => {
  const evenement = (extra: Record<string, unknown> = {}) => JSON.stringify({
    type: 'event_callback', event_id: 'Ev1',
    event: { type: 'message', channel: 'C1', user: 'URAFBA', text: 'Bonjour Marie, c’est réglé : voir <https://lumecrm.net/x|la page>', ts: '1700000002.000100', thread_ts: '1700000001.000100', ...extra },
  });
  async function poster(corps: string) {
    const { ts, sig } = signer(corps);
    const r = reponse();
    await slackWebhookHandler(requete(corps, { 'x-slack-signature': sig, 'x-slack-request-timestamp': ts }), r);
    await attendre();
    return r;
  }

  it('→ message agent enregistré, ticket « answered », notification + courriel au client', async () => {
    ticketTrouve = { id: 't1', org_id: 'org1', user_id: 'u1', subject: 'Facture bloquée', status: 'open', user_email: 'marie@ex.test', slack_channel_id: 'C1', slack_thread_ts: '1700000001.000100' };
    const r = await poster(evenement());
    expect(r.statut).toBe(200);
    const lecture = journal.find((j) => j.table === 'support_tickets' && j.op === 'select')!;
    expect(lecture.filtres).toEqual([['slack_channel_id', 'C1'], ['slack_thread_ts', '1700000001.000100']]);
    const msg = journal.find((j) => j.table === 'support_messages' && j.op === 'insert')!.valeur as any;
    expect(msg).toMatchObject({ ticket_id: 't1', org_id: 'org1', author: 'agent', author_name: 'Rafba', slack_ts: '1700000002.000100' });
    expect(msg.body).toBe('Bonjour Marie, c’est réglé : voir la page (https://lumecrm.net/x)');
    const statut = journal.filter((j) => j.table === 'support_tickets' && j.op === 'update').map((j) => (j.valeur as any).status);
    expect(statut).toContain('answered');
    const notif = journal.find((j) => j.table === 'notifications' && j.op === 'insert')!.valeur as any;
    expect(notif).toMatchObject({ org_id: 'org1', user_id: 'u1', type: 'support_reply', link: '/support?ticket=t1' });
    expect(courriels).toHaveLength(1);
    expect(courriels[0].to).toBe('marie@ex.test');
    expect(courriels[0].html).toContain('https://lumecrm.net/support?ticket=t1');
  });

  it('fil inconnu (pas un ticket) → rien', async () => {
    ticketTrouve = null;
    await poster(evenement());
    expect(journal.some((j) => j.table === 'support_messages')).toBe(false);
    expect(courriels).toHaveLength(0);
  });

  it('rejeu Slack (même ts déjà enregistré) → aucune notification, aucun courriel', async () => {
    ticketTrouve = { id: 't1', org_id: 'org1', user_id: 'u1', subject: 's', status: 'open', user_email: 'marie@ex.test', slack_channel_id: 'C1', slack_thread_ts: '1700000001.000100' };
    doublonMessage = true;
    await poster(evenement());
    expect(journal.some((j) => j.table === 'notifications')).toBe(false);
    expect(courriels).toHaveLength(0);
  });

  it('ticket fermé → la réponse n’est pas relayée', async () => {
    ticketTrouve = { id: 't1', org_id: 'org1', user_id: 'u1', subject: 's', status: 'closed', slack_channel_id: 'C1', slack_thread_ts: '1700000001.000100' };
    await poster(evenement());
    expect(journal.some((j) => j.table === 'support_messages')).toBe(false);
  });

  it('notre propre bot dans le fil (le transcript posté par nous) → ignoré', async () => {
    ticketTrouve = { id: 't1', org_id: 'org1', user_id: 'u1', subject: 's', status: 'open', slack_channel_id: 'C1', slack_thread_ts: '1700000001.000100' };
    await poster(evenement({ user: 'UBOT', bot_id: 'BBOT' }));
    expect(journal.some((j) => j.table === 'support_messages')).toBe(false);
  });
});
