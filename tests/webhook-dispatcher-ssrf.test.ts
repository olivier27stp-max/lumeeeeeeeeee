/**
 * Vague 3 (audit V2, C26, Faible) — les webhooks sortants « intégrations »
 * (`webhookDispatcher.ts`) n'avaient AUCUNE garde SSRF et suivaient les
 * redirections. Ils passent maintenant par `posterSansSsrf`, comme l'action
 * « webhook » des automatisations. Aucun appel réseau ici : DNS et fetch
 * sont des doublures.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clientEnregistreur, requetes } from './automation/filet-regression/_enregistreur';

const etat = vi.hoisted(() => ({ client: null as any, url: '' }));
vi.mock('./../server/lib/supabase', () => ({ getServiceClient: () => etat.client }));

function monde(url: string) {
  const r = clientEnregistreur({
    webhook_deliveries: (req) => (req.op === 'select'
      ? { data: [{ id: 'dl1', endpoint_id: 'ep1', org_id: 'org-a', event_name: 'invoice.paid', payload: { a: 1 }, attempt_count: 0, status: 'pending' }] }
      : { data: null }),
    webhook_endpoints: (req) => (req.op === 'select' ? { data: [{ id: 'ep1', org_id: 'org-a', url, secret: 's3cret', is_active: true }] } : { data: null }),
  });
  etat.client = r.client;
  return r.journal;
}

const fetchEspion = vi.fn(async () => new Response('ok', { status: 200 }));
beforeEach(() => { fetchEspion.mockClear(); vi.stubGlobal('fetch', fetchEspion); });

describe('C26 — webhooks d’intégration : garde SSRF', () => {
  it.each(['http://127.0.0.1/hook', 'http://169.254.169.254/latest/meta-data', 'http://localhost:3002/api', 'http://[::1]/x', 'http://[::7f00:1]/x'])(
    '%s : aucun appel, livraison abandonnée avec le motif', async (url) => {
      const journal = monde(url);
      const { attemptDelivery } = await import('../server/lib/webhookDispatcher');
      const r = await attemptDelivery('dl1');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/^Adresse refusée/);
      expect(fetchEspion).not.toHaveBeenCalled();
      const maj = requetes(journal, 'webhook_deliveries', 'update').map((q) => q.valeur as Record<string, unknown>);
      expect(maj).toEqual([{ status: 'abandoned', error_message: r.error }]);
    },
  );

  it('la route est écrite pour passer par posterSansSsrf', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../server/lib/webhookDispatcher.ts', import.meta.url), 'utf8');
    expect(src).toContain('posterSansSsrf(endpoint.url');
    expect(src).not.toMatch(/await fetch\(endpoint\.url/);
  });
});
