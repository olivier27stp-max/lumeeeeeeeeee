/**
 * À REPORTER — `server/routes/automation-rules.ts` (route
 * `POST /api/automations/templates/utiliser`), hors de la zone de l'agent T.
 *
 * 02-chaque-modele:246 [MOD-029] : interface en ANGLAIS, bureau qui écrit en
 * français. L'aperçu annonce « Contract signed », « Use this template » — et
 * l'éditeur ouvre « Contrat signé ».
 *
 * Cause : la route nomme la copie d'après la langue des MESSAGES du bureau
 * (`company_settings.default_language`, l. 770 : `const en = reglages?.default_language === 'en'`),
 * pas d'après celle de l'INTERFACE (`Accept-Language`, que l'écran envoie déjà :
 * `entetes()` de src/lib/automationBuilderApi.ts). Le nom et la description
 * d'une automatisation sont des libellés d'interface ; ils ne partent à aucun
 * client. Le correctif exact est dans `D:/lume-final/notes/T-corrections.md`.
 *
 * ROUGE jusqu'au report. La VRAIE route, sur le faux Supabase du lot 2.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Ligne } from '../../automation/lot2-faux-supabase';

const ORG = '11111111-2222-4333-8444-555555555555';
const { etat, client: fauxClient } = await vi.hoisted(async () => (await import('../../automation/lot2-faux-supabase')).creerFausseBase());

vi.mock('../../../server/lib/supabase', () => ({
  requireAuthedClient: async () => ({ client: fauxClient(), orgId: ORG, user: { id: 'u1' } }),
  getServiceClient: () => fauxClient(),
}));
vi.mock('../../../server/lib/automatisations-bureaux', () => ({
  bureauxCibles: vi.fn(), copierVersBureaux: vi.fn(), propagerAuxCopies: vi.fn(async () => []),
}));

const { default: routeurRegles } = await import('../../../server/routes/automation-rules');

let serveur: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', routeurRegles);
  await new Promise<void>((ok) => { serveur = app.listen(0, '127.0.0.1', () => ok()); });
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise((ok) => serveur.close(ok)); });

async function utiliser(langueInterface: 'fr' | 'en'): Promise<{ status: number; json: Ligne }> {
  const res = await fetch(`${base}/automations/templates/utiliser`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x', 'Accept-Language': langueInterface },
    body: JSON.stringify({ templateId: 'agreement_signed' }),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Ligne };
}
function poser(langueDesMessages: 'fr' | 'en'): void {
  etat.ecritures.length = 0;
  etat.tables = {
    automation_rules: [], automation_folders: [], org_features: [], custom_fields: [],
    company_settings: [{ id: 'cs', org_id: ORG, default_language: langueDesMessages }],
  };
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('02-chaque-modele:246 — la copie porte le nom que l’aperçu annonçait', () => {
  it('interface en ANGLAIS, bureau qui écrit en français : « Contract signed »', async () => {
    poser('fr');
    const r = await utiliser('en');
    expect(r.status).toBeLessThan(300);
    expect(r.json.name).toBe('Contract signed');
  });

  it('interface en FRANÇAIS, bureau qui écrit en anglais : « Contrat signé »', async () => {
    poser('en');
    const r = await utiliser('fr');
    expect(r.status).toBeLessThan(300);
    expect(r.json.name).toBe('Contrat signé');
  });

  it('les deux langues identiques : inchangé', async () => {
    poser('fr');
    expect((await utiliser('fr')).json.name).toBe('Contrat signé');
  });
});
