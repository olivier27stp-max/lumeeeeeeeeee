/**
 * Launch 2026-09-28 — bloc 4 : l'aperçu d'une automatisation.
 *
 * La route n'avait AUCUNE règle de permission et lisait tout en service_role :
 * n'importe quel membre obtenait le nom, le courriel et le téléphone du
 * dernier client. Maintenant : `automations.read` exigé par le RBAC, et la
 * règle comme le client se lisent avec la session de l'utilisateur (RLS).
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const etat = vi.hoisted(() => ({ lectures: [] as string[], servicesUtilises: [] as string[] }));
const faux = (source: string, donnees: Record<string, any>) => ({
  from: (t: string) => {
    (source === 'service' ? etat.servicesUtilises : etat.lectures).push(t);
    const q: any = {};
    for (const m of ['select', 'eq', 'is', 'not', 'order', 'limit']) q[m] = () => q;
    q.maybeSingle = async () => ({ data: donnees[t] ?? null, error: null });
    return q;
  },
});
vi.mock('../../server/lib/supabase', async (orig) => ({
  ...(await orig<any>()),
  requireAuthedClient: async () => ({ orgId: 'org', user: { id: 'u' }, client: faux('user', {}) }), // la RLS refuse : rien
  getServiceClient: () => faux('service', { automation_rules: { id: 'r' }, clients: { id: 'c', first_name: 'Marie', email: 'm@x.test' } }),
}));

import router from '../../server/routes/automation-test';

const app = express();
app.use(express.json());
app.use('/api', router);
const serveur = app.listen(0);
afterAll(() => serveur.close());

describe('aperçu d’une automatisation', () => {
  it('sans le droit de voir l’automatisation (RLS) : 404, aucun client lu en service_role', async () => {
    const r = await fetch(`http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api/automations/rules/r/apercu`, { method: 'POST' });
    expect(r.status).toBe(404);
    expect(etat.lectures).toContain('automation_rules');
    expect(etat.servicesUtilises).not.toContain('automation_rules');
    expect(etat.servicesUtilises).not.toContain('clients');
  });

  it('la route exige « Voir les automatisations » dans le RBAC', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('server/lib/route-permissions.ts', 'utf8')).toContain("'POST /api/automations/rules/:id/apercu': 'automations.read'");
  });
});
