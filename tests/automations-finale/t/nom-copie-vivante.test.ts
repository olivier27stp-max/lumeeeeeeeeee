/**
 * LE NOM D'UNE COPIE DE MODÈLE — décision du 2026-10-01 sur 02-chaque-modele:351.
 *
 * Deux automatisations du même nom dans une liste sont indiscernables : la
 * copie est numérotée (« Contrat signé (2) ») — mais SEULEMENT quand une
 * automatisation VIVANTE du même bureau porte déjà ce nom. Vivante = ni à la
 * corbeille, ni supprimée définitivement ; un préréglage fourni, même en
 * brouillon, compte (il est dans la liste, sous son nom traduit). Sinon : le
 * nom nu.
 *
 * La VRAIE route `POST /api/automations/templates/utiliser`
 * (server/routes/automation-rules.ts) et le vrai `nomDisponible`
 * (src/lib/automationTemplates.ts), sur le faux Supabase du lot 2.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Ligne } from '../../automation/lot2-faux-supabase';

const ORG = '11111111-2222-4333-8444-555555555555';
const AUTRE_ORG = '99999999-2222-4333-8444-555555555555';
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

/** « Utiliser ce modèle » sur « Contrat signé » : le nom de la copie créée. */
async function nomDeLaCopie(): Promise<unknown> {
  const res = await fetch(`${base}/automations/templates/utiliser`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x', 'Accept-Language': 'fr' },
    body: JSON.stringify({ templateId: 'agreement_signed' }),
  });
  expect(res.status).toBeLessThan(300);
  return ((await res.json()) as Ligne).name;
}
let n = 0;
const regle = (sup: Record<string, unknown>): Ligne => {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`, org_id: ORG, name: 'Contrat signé', is_active: true, is_preset: false,
    preset_key: null, deleted_at: null, purged_at: null, trigger_event: 'agreement.signed', actions: [], steps: null, ...sup,
  } as Ligne;
};
function poser(regles: Ligne[]): void {
  etat.ecritures.length = 0;
  etat.tables = {
    automation_rules: regles, automation_folders: [], org_features: [], custom_fields: [],
    company_settings: [{ id: 'cs', org_id: ORG, default_language: 'fr' }],
  };
}

beforeEach(() => { n = 0; vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('le nom d’une copie de modèle : numéroté seulement si une automatisation VIVANTE du bureau porte déjà ce nom', () => {
  it('rien de ce nom dans le bureau : le nom nu', async () => {
    poser([regle({ name: 'Bienvenue' })]);
    expect(await nomDeLaCopie()).toBe('Contrat signé');
  });

  it('une automatisation vivante porte ce nom : « Contrat signé (2) », puis « (3) »', async () => {
    poser([regle({})]);
    expect(await nomDeLaCopie()).toBe('Contrat signé (2)');
    expect(await nomDeLaCopie()).toBe('Contrat signé (3)');
  });

  it('le préréglage FOURNI du même nom compte — même en brouillon, et bien qu’il soit stocké sous son nom anglais', async () => {
    poser([regle({ name: 'Contract Signed', is_preset: true, preset_key: 'agreement_signed', is_active: false })]);
    expect(await nomDeLaCopie()).toBe('Contrat signé (2)');
  });

  it('à la corbeille : elle ne compte pas — le nom nu', async () => {
    poser([regle({ deleted_at: '2026-09-30T12:00:00.000Z', is_active: false })]);
    expect(await nomDeLaCopie()).toBe('Contrat signé');
  });

  it('supprimée définitivement : elle ne compte pas — le nom nu', async () => {
    poser([regle({ deleted_at: '2026-09-30T12:00:00.000Z', purged_at: '2026-10-01T12:00:00.000Z', is_active: false })]);
    expect(await nomDeLaCopie()).toBe('Contrat signé');
  });

  it('le même nom dans un AUTRE bureau : il ne compte pas — le nom nu', async () => {
    poser([regle({ org_id: AUTRE_ORG })]);
    expect(await nomDeLaCopie()).toBe('Contrat signé');
  });

  it('la corbeille ne « réserve » pas un numéro : vivante + « (2) » à la corbeille → « (2) »', async () => {
    poser([regle({}), regle({ name: 'Contrat signé (2)', deleted_at: '2026-09-30T12:00:00.000Z' })]);
    expect(await nomDeLaCopie()).toBe('Contrat signé (2)');
  });
});
