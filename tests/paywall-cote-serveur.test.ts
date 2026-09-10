/**
 * LE PAYWALL QUI N'EXISTAIT QUE DANS LE NAVIGATEUR.
 *
 * Audit du 2026-09-09, C1 : la vérification d'abonnement vivait dans React.
 * Aucune des 72 routes serveur ne regardait l'abonnement. Un compte gratuit
 * + un token Supabase = le produit complet, en silence.
 *
 * `server/lib/subscription-guard.ts` ferme l'API. Ces tests figent :
 *   - la règle (active, trialing, past_due en grâce → passe ; le reste → 402)
 *   - ce qui DOIT rester ouvert sans abonnement (payer, s'inscrire, se plaindre)
 *   - le bypass bêta lu côté serveur, sous ses deux noms d'env
 *   - les modes log / off
 *   - le fail-open journalisé quand la vérification elle-même tombe en panne
 *   - qu'un token qui n'est pas un utilisateur Supabase n'est pas bloqué ici
 *     (c'est la route qui tranche — agents, MCP, cron ont leur propre auth)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const ORG = '11111111-2222-3333-4444-555555555555';
const USER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// Ce que la « DB » répond, piloté par chaque test.
const monde = {
  utilisateur: null as null | { id: string; email: string },
  abonnement: null as null | { status: string; past_due_since?: string | null },
  erreurLecture: null as null | string,
};

const admin = {
  from: vi.fn((table: string) => {
    const chaine: any = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) chaine[m] = vi.fn(() => chaine);
    chaine.maybeSingle = vi.fn(async () => {
      if (table === 'orgs') return { data: { company_group_id: null }, error: null };
      if (monde.erreurLecture) return { data: null, error: { message: monde.erreurLecture } };
      return { data: monde.abonnement, error: null };
    });
    return chaine;
  }),
};

vi.mock('../server/lib/supabase', () => ({
  getServiceClient: () => admin,
  companyOrgIds: async (_a: unknown, orgId: string) => [orgId],
  resolveOrgId: async () => (monde.utilisateur ? ORG : null),
  buildSupabaseWithAuth: () => ({
    auth: {
      getUser: async () =>
        monde.utilisateur
          ? { data: { user: monde.utilisateur }, error: null }
          : { data: { user: null }, error: { message: 'invalid jwt' } },
    },
    rpc: async () => ({ data: false }),
  }),
}));

import type { ModeGarde } from '../server/lib/subscription-guard';
const garde = await import('../server/lib/subscription-guard');

async function appeler(path: string, opts: { mode?: ModeGarde; env?: NodeJS.ProcessEnv; token?: string | null; method?: string } = {}) {
  const app = express();
  app.use(garde.subscriptionGuard({ mode: opts.mode ?? 'enforce', env: opts.env ?? {} }));
  app.all('/api/*', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const headers: Record<string, string> = {};
    if (opts.token !== null) headers.Authorization = `Bearer ${opts.token ?? 'eyJ.fake.token'}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: opts.method ?? 'GET', headers });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  garde.viderCacheGarde();
  monde.utilisateur = { id: USER, email: 'client@exemple.com' };
  monde.abonnement = null;
  monde.erreurLecture = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('la règle', () => {
  it('active et trialing passent', () => {
    expect(garde.verdictPourAbonnement({ status: 'active' }).autorise).toBe(true);
    expect(garde.verdictPourAbonnement({ status: 'trialing' }).autorise).toBe(true);
  });
  it('aucun abonnement, canceled, unpaid → refus', () => {
    expect(garde.verdictPourAbonnement(null)).toEqual({ autorise: false, raison: 'aucun' });
    expect(garde.verdictPourAbonnement({ status: 'canceled' }).autorise).toBe(false);
    expect(garde.verdictPourAbonnement({ status: 'unpaid' }).autorise).toBe(false);
  });
  it('past_due passe pendant la grâce, puis se ferme', () => {
    const t0 = Date.parse('2026-09-01T00:00:00Z');
    const depuis = new Date(t0).toISOString();
    expect(garde.verdictPourAbonnement({ status: 'past_due', past_due_since: depuis }, t0 + 3 * 86400_000).raison).toBe('past_due_grace');
    expect(garde.verdictPourAbonnement({ status: 'past_due', past_due_since: depuis }, t0 + 8 * 86400_000)).toMatchObject({
      autorise: false, raison: 'past_due_expire',
    });
  });
  it('past_due sans date de départ → grâce complète (mieux vaut ouvrir à tort que fermer sans préavis)', () => {
    expect(garde.verdictPourAbonnement({ status: 'past_due', past_due_since: null }).autorise).toBe(true);
  });
});

describe('le middleware', () => {
  it('LE BUG : sans abonnement, /api/clients répondait — maintenant 402', async () => {
    const r = await appeler('/api/clients/search');
    expect(r.status).toBe(402);
    expect(r.json).toMatchObject({ error: 'subscription_required', reason: 'aucun' });
  });

  it('avec un abonnement actif, tout passe', async () => {
    monde.abonnement = { status: 'active' };
    expect((await appeler('/api/clients/search')).status).toBe(200);
    expect((await appeler('/api/messages/send', { method: 'POST' })).status).toBe(200);
  });

  it('ce qui permet de PAYER reste ouvert sans abonnement', async () => {
    for (const p of [
      '/api/billing/current', '/api/billing/create-checkout-session', '/api/billing/plans',
      '/api/me/is-beta-bypassed', '/api/auth/register', '/api/webhooks/stripe',
      '/api/client-errors', '/api/invitations/accept', '/api/health', '/api/portal/x', '/api/pay/x',
    ]) {
      const r = await appeler(p, { method: p.startsWith('/api/webhooks') ? 'POST' : 'GET' });
      expect(r.status, p).toBe(200);
    }
  });

  it('bypass bêta : BETA_BYPASS_EMAILS, insensible à la casse', async () => {
    const env = { BETA_BYPASS_EMAILS: 'Client@Exemple.com, autre@x.com' };
    expect((await appeler('/api/clients/search', { env })).status).toBe(200);
  });

  it('bypass bêta : l ancien nom VITE_ est encore honoré côté serveur (pas de verrouillage au déploiement)', async () => {
    const env = { VITE_BETA_BYPASS_EMAILS: 'client@exemple.com' };
    expect((await appeler('/api/clients/search', { env })).status).toBe(200);
  });

  it('un autre email n est pas bypassé', async () => {
    const env = { BETA_BYPASS_EMAILS: 'autre@x.com' };
    expect((await appeler('/api/clients/search', { env })).status).toBe(402);
  });

  it('mode log : laisse passer mais journalise ce qui aurait été bloqué', async () => {
    const r = await appeler('/api/clients/search', { mode: 'log' });
    expect(r.status).toBe(200);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('AURAIT BLOQUÉ GET /api/clients/search'));
  });

  it('mode off : ne touche à rien', async () => {
    expect((await appeler('/api/clients/search', { mode: 'off' })).status).toBe(200);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('un token qui n est pas un utilisateur Supabase passe : la route tranche', async () => {
    monde.utilisateur = null;
    expect((await appeler('/api/agent-things', { token: 'jwt-agent-externe' })).status).toBe(200);
  });

  it('sans en-tête Authorization, on ne bloque pas (la route renverra 401 elle-même)', async () => {
    expect((await appeler('/api/clients/search', { token: null })).status).toBe(200);
  });

  it('panne de la lecture subscriptions → fail-open journalisé, pas un faux « aucun abonnement »', async () => {
    monde.erreurLecture = 'connection refused';
    const r = await appeler('/api/clients/search');
    expect(r.status).toBe(200);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail-open'), expect.anything());
  });

  it('le cache : un refus n est pas figé — après un paiement, la 2e lecture voit l abonnement', async () => {
    expect((await appeler('/api/clients/search')).status).toBe(402);
    monde.abonnement = { status: 'active' };
    garde.viderCacheGarde();
    expect((await appeler('/api/clients/search')).status).toBe(200);
  });
});

describe('la liste des exemptions', () => {
  it('reprend les préfixes publics du RBAC (une seule liste à maintenir)', async () => {
    const { PUBLIC_ROUTE_PREFIXES } = await import('../server/lib/route-permissions');
    for (const p of PUBLIC_ROUTE_PREFIXES) expect(garde.estExemptee(p + 'x'), p).toBe(true);
  });
  it('ne laisse pas passer le métier', () => {
    for (const p of ['/api/clients/search', '/api/jobs/assign-team', '/api/invoices/from-job', '/api/emails/send', '/api/ai/chat']) {
      expect(garde.estExemptee(p), p).toBe(false);
    }
  });
});
