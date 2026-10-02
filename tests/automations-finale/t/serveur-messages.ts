/**
 * Le VRAI routeur des messages (`server/routes/automation-messages.ts`), monté
 * dans une app Express de test, et `fetch` branché dessus : un composant qui
 * appelle `/api/automations/rules/:id/messages` atteint la vraie route, qui
 * écrit dans la fausse base (`faux-supabase.ts`).
 *
 * Le fichier de test doit avoir déclaré :
 *   vi.mock('…/server/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabaseServeur());
 *   vi.mock('…/server/lib/automatisations-bureaux', () => ({ propagerAuxCopies: async () => [] }));
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

let serveur: Server | null = null;
let origine = '';
const vraiFetch = globalThis.fetch;

/** Chaque appel reçu par le serveur de test : méthode, chemin, corps. */
export const appels: Array<{ methode: string; chemin: string; corps: unknown }> = [];

/** Démarre le serveur (une fois) et branche `fetch` : les adresses relatives (`/api/…`) y arrivent. */
export async function brancherServeur(): Promise<void> {
  if (!serveur) {
    const { default: routeur } = await import('../../../server/routes/automation-messages');
    const app = express();
    app.use(express.json());
    app.use((req, _res, suite) => { appels.push({ methode: req.method, chemin: req.path, corps: req.body }); suite(); });
    app.use('/api', routeur);
    serveur = await new Promise<Server>((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
    origine = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  }
  appels.length = 0;
  globalThis.fetch = ((url: RequestInfo | URL, init?: RequestInit) => vraiFetch(
    typeof url === 'string' && url.startsWith('/') ? `${origine}${url}` : url, init,
  )) as typeof fetch;
}

export async function arreterServeur(): Promise<void> {
  globalThis.fetch = vraiFetch;
  const s = serveur;
  serveur = null;
  if (s) await new Promise((ok) => s.close(ok));
}

/** Un appel direct à la route, hors de tout écran. */
export async function appeler(id: string, corps: unknown, entetes: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await vraiFetch(`${origine}/api/automations/rules/${id}/messages`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jeton-de-test', ...entetes },
    body: JSON.stringify(corps),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
