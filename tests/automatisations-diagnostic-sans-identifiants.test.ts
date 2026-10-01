/**
 * Le diagnostic `GET /api/automations/test` ne montre pas les identifiants de
 * la PLATEFORME à un bureau.
 *
 * Audit du 2026-10-01 (constat roles-11, observé avec un compte admin d'un
 * bureau de test) : la réponse contenait l'identifiant SMTP de Lume, le début
 * du SID Twilio et le numéro de téléphone de la plateforme. Ce sont des
 * réglages de Lume, pas du bureau : l'admin d'une entreprise cliente n'a pas à
 * les lire. Le diagnostic dit maintenant « configuré » ou « non configuré ».
 *
 * La vraie route est montée ; l'authentification et la base sont simulées.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const etat = vi.hoisted(() => ({ admin: true }));

vi.mock('../server/lib/supabase', async (orig) => {
  // Toute lecture rend « rien » : le diagnostic saute alors ses étapes sur les données.
  const chaine: unknown = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === 'then') return (ok: (v: unknown) => void) => Promise.resolve({ data: [], count: 0, error: null }).then(ok);
      if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: null, error: null });
      return () => chaine;
    },
    apply: () => chaine,
  });
  return {
    ...(await orig<Record<string, unknown>>()),
    requireAuthedClient: async () => ({ orgId: '11111111-1111-4111-8111-111111111111', user: { id: 'u1', email: 'admin@lume-qa.test' }, client: {} }),
    isOrgAdminOrOwner: async () => etat.admin,
    getServiceClient: () => ({ from: () => chaine }),
  };
});

import router from '../server/routes/automation-test';

const SECRETS = {
  TWILIO_ACCOUNT_SID: 'ACfauxsidplateforme0123456789abcd',
  TWILIO_AUTH_TOKEN: 'jeton-twilio-plateforme',
  TWILIO_PHONE_NUMBER: '+15145550199',
  SMTP_USER: 'expediteur-plateforme@lume-interne.test',
  SMTP_PASS: 'mot-de-passe-smtp',
};
const avant: Record<string, string | undefined> = {};

let serveur: Server;
let base = '';
beforeAll(async () => {
  for (const [cle, valeur] of Object.entries(SECRETS)) { avant[cle] = process.env[cle]; process.env[cle] = valeur; }
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  await new Promise<void>((ok) => { serveur = app.listen(0, '127.0.0.1', () => ok()); });
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
});
afterAll(async () => {
  for (const cle of Object.keys(SECRETS)) { if (avant[cle] === undefined) delete process.env[cle]; else process.env[cle] = avant[cle]; }
  await new Promise((ok) => serveur.close(ok));
});
beforeEach(() => { etat.admin = true; });

type Resultat = { name: string; passed: boolean; details: string };

describe('GET /api/automations/test', () => {
  it('ne contient ni l’identifiant SMTP, ni le SID Twilio (même tronqué), ni le numéro de la plateforme', async () => {
    const r = await fetch(`${base}/api/automations/test`);
    expect(r.status).toBe(200);
    const brut = await r.text();
    expect(brut).not.toContain(SECRETS.SMTP_USER);
    expect(brut).not.toContain('lume-interne.test');
    expect(brut).not.toContain(SECRETS.TWILIO_ACCOUNT_SID.slice(0, 8));
    expect(brut).not.toContain(SECRETS.TWILIO_PHONE_NUMBER);
    expect(brut).not.toContain(SECRETS.TWILIO_AUTH_TOKEN);
    expect(brut).not.toContain(SECRETS.SMTP_PASS);
  });

  it('dit quand même si les textos et les courriels sont configurés', async () => {
    const corps = (await (await fetch(`${base}/api/automations/test`)).json()) as { results: Resultat[] };
    const twilio = corps.results.find((x) => x.name === 'Twilio SMS configured');
    const smtp = corps.results.find((x) => x.name === 'SMTP email configured');
    expect(twilio?.passed).toBe(true);
    expect(smtp?.passed).toBe(true);
    expect(twilio?.details).toBe('Configured');
    expect(smtp?.details).toBe('Configured');
  });

  it('reste réservé aux administrateurs du bureau', async () => {
    etat.admin = false;
    const r = await fetch(`${base}/api/automations/test`);
    expect(r.status).toBe(403);
  });
});
