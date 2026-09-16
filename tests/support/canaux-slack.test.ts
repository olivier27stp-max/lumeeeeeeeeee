/**
 * Un canal Slack par entreprise cliente.
 *   - nom de canal : minuscules, sans accent, tirets, préfixe client-
 *   - premier ticket d'une entreprise → canal créé, sujet posé, membres de #support invités, mapping enregistré
 *   - entreprise déjà connue → même canal, rien de recréé
 *   - message au premier niveau dans le canal → dernier ticket ouvert ; sans ticket ouvert → ticket proactif
 *   - nos propres messages, les réponses de fil et les événements « joined » sont ignorés ; last_seen_ts avance
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const journal: Array<{ table: string; op: string; valeur?: unknown; filtres: unknown[] }> = [];
let mappings: any[] = [];
let ticketsOuverts: any[] = [];
let derniersTickets: any[] = [];
vi.mock('../../server/lib/supabase', () => ({
  getServiceClient: () => client,
}));
const client: any = {
  from: (table: string) => {
    const req = { table, op: 'select', valeur: undefined as unknown, filtres: [] as unknown[] };
    journal.push(req);
    const o: any = {};
    const self = () => o;
    for (const m of ['select', 'order', 'limit', 'neq', 'not', 'gte', 'is']) o[m] = self;
    o.eq = (c: string, v: unknown) => { req.filtres.push([c, v]); return o; };
    o.in = (c: string, v: unknown) => { req.filtres.push([c, v]); return o; };
    o.insert = (v: unknown) => { req.op = 'insert'; req.valeur = v; return o; };
    o.update = (v: unknown) => { req.op = 'update'; req.valeur = v; return o; };
    const reponse = () => {
      if (table === 'support_slack_channels' && req.op === 'select') {
        const org = (req.filtres as Array<[string, unknown]>).find(([c]) => c === 'org_id')?.[1];
        return org ? mappings.find((m) => m.org_id === org) || null : mappings;
      }
      if (table === 'support_slack_channels' && req.op === 'insert') { mappings.push(req.valeur); return req.valeur; }
      if (table === 'support_tickets' && req.op === 'select') {
        const ouverts = req.filtres.some(([c]: any) => c === 'status');
        return (ouverts ? ticketsOuverts : derniersTickets)[0] || null;
      }
      if (table === 'support_tickets' && req.op === 'insert') return { id: 'neuf', ...(req.valeur as object) };
      if (table === 'support_messages' && req.op === 'insert') return { id: 'm', ...(req.valeur as object) };
      return null;
    };
    o.maybeSingle = async () => ({ data: reponse(), error: null });
    o.single = o.maybeSingle;
    o.then = (res: any, rej?: any) => Promise.resolve({ data: reponse(), error: null }).then(res, rej);
    return o;
  },
};

const slack = { crees: [] as string[], invites: [] as any[], sujets: [] as any[], postes: [] as any[], historique: [] as any[], membres: ['URAFBA', 'UBOT', 'UGROK'], archives: [] as string[], desarchives: [] as string[], accuses: [] as any[] };
vi.mock('../../server/lib/slack', () => ({
  canalSupport: () => 'CSUPPORT',
  identiteBot: async () => ({ user_id: 'UBOT', bot_id: 'BBOT' }),
  creerCanalSlack: async (nom: string) => { slack.crees.push(nom); return { id: `C_${nom}`, name: nom }; },
  inviterDansCanal: async (channel: string, users: string[]) => { slack.invites.push({ channel, users }); },
  membresDuCanal: async () => slack.membres,
  definirSujetCanal: async (channel: string, topic: string) => { slack.sujets.push({ channel, topic }); },
  envoyerMessageSlack: async (p: any) => { slack.postes.push(p); return { ts: '9.9', channel: p.channel }; },
  lireHistoriqueSlack: async () => slack.historique,
  accuserLivraisonSlack: async (channel: string, ts: string, ok: boolean) => { slack.accuses.push({ channel, ts, ok }); },
  archiverCanalSlack: async (c: string) => { slack.archives.push(c); },
  desarchiverCanalSlack: async (c: string) => { slack.desarchives.push(c); },
  echapperSlack: (s: string) => s,
}));
vi.mock('../../server/lib/mailer', () => ({ isMailerConfigured: () => false, sendEmail: vi.fn() }));
vi.mock('../../server/lib/helpers', () => ({ resolvePublicBaseUrl: () => 'https://lumecrm.net', normalizeE164: (s: string) => s, findOrCreateConversation: async () => ({ id: 'c' }) }));

import { nomCanalPour, canalClient, ticketPourMessageCanal, messagesCanauxClients, archiverCanauxInactifs, joursAvantArchivage } from '../../server/lib/support/canaux-slack';

beforeEach(() => { journal.length = 0; mappings = []; ticketsOuverts = []; derniersTickets = []; slack.crees = []; slack.invites = []; slack.sujets = []; slack.postes = []; slack.historique = []; slack.archives = []; slack.desarchives = []; });

describe('archivage des canaux inactifs', () => {
  it('sans demande vivante depuis 7 jours → archivé et marqué ; avec une demande vivante → gardé', async () => {
    mappings = [
      { org_id: 'org-calme', channel_id: 'C_calme', channel_name: 'client-calme', last_seen_ts: null, archived_at: null },
      { org_id: 'org-actif', channel_id: 'C_actif', channel_name: 'client-actif', last_seen_ts: null, archived_at: null },
    ];
    // Le mock rend « un ticket vivant » seulement pour org-actif.
    ticketsOuverts = [];
    const brut = client.from;
    client.from = (table: string) => {
      const o = brut(table);
      if (table === 'support_tickets') {
        const req = journal.at(-1)!;
        o.or = () => o;
        o.maybeSingle = async () => ({ data: req.filtres.some(([c, v]: any) => c === 'org_id' && v === 'org-actif') ? { id: 'vivant' } : null, error: null });
      }
      return o;
    };
    try {
      expect(await archiverCanauxInactifs(client, 7)).toBe(1);
    } finally { client.from = brut; }
    expect(slack.archives).toEqual(['C_calme']);
    const maj = journal.filter((j) => j.table === 'support_slack_channels' && j.op === 'update').map((j) => j.valeur as any);
    expect(maj).toHaveLength(1);
    expect(maj[0].archived_at).toBeTruthy();
  });

  it('un canal archivé est désarchivé à la prochaine demande', async () => {
    mappings = [{ org_id: 'org1', channel_id: 'C1', channel_name: 'client-x', last_seen_ts: null, archived_at: '2026-09-01T00:00:00Z' }];
    const c = await canalClient(client, 'org1', 'X', 'Scale');
    expect(c.archived_at).toBeNull();
    expect(slack.desarchives).toEqual(['C1']);
    expect(slack.crees).toEqual([]);
  });

  it('délai : défaut 7 jours, 0 désactive', () => {
    expect(joursAvantArchivage({})).toBe(7);
    expect(joursAvantArchivage({ SLACK_ARCHIVE_APRES_JOURS: '3' })).toBe(3);
    expect(joursAvantArchivage({ SLACK_ARCHIVE_APRES_JOURS: '0' })).toBe(0);
  });
});

describe('nomCanalPour', () => {
  it('normalise le nom de l’entreprise pour Slack', () => {
    expect(nomCanalPour('Plomberie Tremblay inc.')).toBe('client-plomberie-tremblay-inc');
    expect(nomCanalPour('Éric & Fils — Électricité')).toBe('client-eric-fils-electricite');
    expect(nomCanalPour('   ')).toBe('client-sans-nom');
    expect(nomCanalPour('A'.repeat(90)).length).toBeLessThanOrEqual(80);
  });
});

describe('canalClient', () => {
  it('première escalade : crée #client-…, pose le sujet, invite les membres de #support (pas le bot), enregistre le mapping', async () => {
    const c = await canalClient(client, 'org1', 'Plomberie Tremblay', 'Autopilot');
    expect(c).toMatchObject({ org_id: 'org1', channel_id: 'C_client-plomberie-tremblay', channel_name: 'client-plomberie-tremblay' });
    expect(slack.crees).toEqual(['client-plomberie-tremblay']);
    expect(slack.sujets[0].topic).toContain('Autopilot');
    expect(slack.invites[0]).toEqual({ channel: 'C_client-plomberie-tremblay', users: ['URAFBA', 'UGROK'] });
    expect(mappings).toHaveLength(1);
  });

  it('entreprise déjà connue : même canal, rien de recréé', async () => {
    mappings = [{ org_id: 'org1', channel_id: 'C1', channel_name: 'client-x', last_seen_ts: null }];
    const c = await canalClient(client, 'org1', 'X', 'Scale');
    expect(c.channel_id).toBe('C1');
    expect(slack.crees).toEqual([]);
  });
});

describe('ticketPourMessageCanal', () => {
  it('un ticket ouvert → c’est lui', async () => {
    ticketsOuverts = [{ id: 't-ouvert', org_id: 'org1', status: 'open' }];
    expect((await ticketPourMessageCanal(client, 'org1', 'Salut'))?.id).toBe('t-ouvert');
  });
  it('aucun ticket ouvert mais un ancien → nouveau ticket « répondu », adressé au même demandeur', async () => {
    derniersTickets = [{ id: 't-vieux', org_id: 'org1', status: 'closed', user_id: 'u1', user_email: 'm@x.test', user_name: 'Marie', priority: 'normal', plan_slug: 'pro', sla_key: '1d', company_name: 'X', slack_channel_id: 'C1' }];
    const t = await ticketPourMessageCanal(client, 'org1', 'Bonjour Marie, petite question');
    expect(t).toMatchObject({ id: 'neuf', user_id: 'u1', status: 'answered', subject: 'Bonjour Marie, petite question', escalation_reason: 'Message proactif de l’équipe (Slack)' });
  });
  it('jamais de ticket → null (on ne sait pas à qui écrire)', async () => {
    expect(await ticketPourMessageCanal(client, 'org-inconnue', 'x')).toBeNull();
  });
});

describe('messagesCanauxClients', () => {
  it('relève les messages humains au premier niveau, ignore les nôtres, les fils et les « joined », avance last_seen_ts', async () => {
    mappings = [{ org_id: 'org1', channel_id: 'C1', channel_name: 'client-x', last_seen_ts: '1.0' }];
    ticketsOuverts = [{ id: 't1', org_id: 'org1', status: 'open', slack_thread_ts: '0.5' }];
    slack.historique = [
      { ts: '2.0', user: 'UBOT', bot_id: 'BBOT', text: 'en-tête (nous)' },
      { ts: '3.0', user: 'URAFBA', subtype: 'channel_join', text: 'a rejoint' },
      { ts: '4.0', user: 'URAFBA', text: 'Bonjour, on regarde ça' },
      { ts: '5.0', user: 'URAFBA', thread_ts: '0.5', text: 'réponse de fil' },
      { ts: '6.0', bot_id: 'BGROK', subtype: 'bot_message', text: 'Grok : voici la réponse' },
    ];
    const out = await messagesCanauxClients(client);
    expect(out.map((x) => x.message.text)).toEqual(['Bonjour, on regarde ça', 'Grok : voici la réponse']);
    expect(out[0].ticket.id).toBe('t1');
    const maj = journal.find((j) => j.table === 'support_slack_channels' && j.op === 'update')!.valeur as any;
    expect(maj.last_seen_ts).toBe('6.0');
  });
});
