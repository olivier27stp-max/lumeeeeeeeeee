/**
 * « Publiée » ne s'écrit jamais avec la session de l'utilisateur — création et
 * copie vers d'autres bureaux (audit du 2026-10-01, roles-05).
 *
 * La base refuse à une session d'utilisateur d'insérer une règle publiée et de
 * faire passer `is_active` de faux à vrai (déclencheur `automation_rules_garde`).
 * Deux chemins du serveur écrivaient encore « publiée » avec le client de
 * l'utilisateur : créer une automatisation « déjà publiée », et la copier vers
 * un autre bureau en reprenant l'état de l'original. Ils écrivent maintenant un
 * BROUILLON avec la session, puis le serveur publie.
 *
 * Deux faux clients sur les MÊMES tables : on sait qui a écrit quoi.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { creerFausseBase, type Ecriture } from './lot2-faux-supabase';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SOURCE = 'aaaaaaaa-0000-4000-8000-00000000000a';

const bases = vi.hoisted(() => ({ u: null as unknown as ReturnType<typeof import('./lot2-faux-supabase').creerFausseBase>, s: null as unknown as ReturnType<typeof import('./lot2-faux-supabase').creerFausseBase> }));

vi.mock('../../server/lib/supabase', () => ({
  requireAuthedClient: async () => ({ client: bases.u.client(), orgId: A, user: { id: 'u1' } }),
  buildSupabaseWithAuth: () => bases.u.client(),
  getServiceClient: () => bases.s.client(),
}));
vi.mock('../../server/lib/rbac', () => ({
  getUserContext: async () => ({ role: 'admin' }),
  hasPermission: () => true,
}));
vi.mock('../../server/lib/logger', () => ({ logger: { error: () => {}, warn: () => {}, info: () => {} } }));
vi.mock('../../server/lib/platformFeatures', async (orig) => ({ ...(await orig<Record<string, unknown>>()) }));

const { copierVersBureaux } = await import('../../server/lib/automatisations-bureaux');

const etapeTexto = [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], merci.' } }, suivant: null }];
const regleSource = (extra: Record<string, unknown> = {}) => ({
  id: SOURCE, org_id: A, name: 'Merci après la job', description: '', trigger_event: 'job.completed', conditions: {}, delay_seconds: 0,
  actions: [], steps: etapeTexto, settings: null, is_active: true, is_preset: false, preset_key: null, pipeline_id: null, stage_id: null,
  deleted_at: null, purged_at: null, modele_id: null, ...extra,
});

beforeEach(() => {
  bases.u = creerFausseBase();
  bases.s = creerFausseBase();
  // Les mêmes tables pour les deux clients : seule la liste des écritures les distingue.
  bases.s.etat.tables = bases.u.etat.tables;
  const orgs = (id: string, name: string) => ({ id, name, created_at: '2026-01-01T00:00:00Z', deleted_at: null, archived_at: null, company_group_id: 'g1' });
  bases.u.etat.tables.orgs = [orgs(A, 'Bureau A'), orgs(B, 'Bureau B')];
  bases.u.etat.tables.memberships = [
    { id: 'm1', user_id: 'u1', org_id: A, status: 'active', orgs: orgs(A, 'Bureau A') },
    { id: 'm2', user_id: 'u1', org_id: B, status: 'active', orgs: orgs(B, 'Bureau B') },
  ];
  bases.u.etat.tables.company_settings = [{ id: 'c1', org_id: B, company_name: 'Bureau B' }];
  bases.u.etat.tables.automation_rules = [regleSource()];
});

const surRegles = (liste: Ecriture[]) => liste.filter((e) => e.table === 'automation_rules');

describe('copier une automatisation PUBLIÉE vers un autre bureau', () => {
  it('la session écrit un brouillon dans le bureau cible ; le serveur reprend l’état publié', async () => {
    const res = await copierVersBureaux('Bearer x', 'u1', A, SOURCE, [B]);
    expect(res).toHaveLength(1);
    expect(res![0]).toMatchObject({ org_id: B, statut: 'copiee', active: true });

    const utilisateur = surRegles(bases.u.etat.ecritures);
    expect(utilisateur).toHaveLength(1);
    expect(utilisateur[0]).toMatchObject({ op: 'insert' });
    expect(utilisateur[0].valeurs).toMatchObject({ org_id: B, is_active: false, is_preset: false, preset_key: null });

    const service = surRegles(bases.s.etat.ecritures);
    expect(service).toHaveLength(1);
    expect(service[0]).toMatchObject({ op: 'update', valeurs: { is_active: true } });

    const copie = bases.u.etat.tables.automation_rules.find((r) => r.org_id === B);
    expect(copie?.is_active).toBe(true);
  });

  it('original en brouillon : la copie reste en brouillon, le serveur n’écrit rien', async () => {
    bases.u.etat.tables.automation_rules = [regleSource({ is_active: false })];
    const res = await copierVersBureaux('Bearer x', 'u1', A, SOURCE, [B]);
    expect(res![0]).toMatchObject({ statut: 'copiee', active: false });
    expect(surRegles(bases.s.etat.ecritures)).toEqual([]);
    expect(bases.u.etat.tables.automation_rules.find((r) => r.org_id === B)?.is_active).toBe(false);
  });

  it('règle de même nom déjà dans le bureau cible, en brouillon : mise à jour par la session SANS is_active: true, puis publication par le serveur', async () => {
    const existante = 'bbbbbbbb-0000-4000-8000-00000000000b';
    bases.u.etat.tables.automation_rules.push({ ...regleSource({ id: existante, org_id: B, is_active: false }) });
    const res = await copierVersBureaux('Bearer x', 'u1', A, SOURCE, [B]);
    expect(res![0]).toMatchObject({ statut: 'mise_a_jour', active: true, rule_id: existante });
    const utilisateur = surRegles(bases.u.etat.ecritures);
    expect(utilisateur.every((e) => (e.valeurs as { is_active?: unknown }).is_active !== true)).toBe(true);
    expect(surRegles(bases.s.etat.ecritures)).toMatchObject([{ op: 'update', ids: [existante], valeurs: { is_active: true } }]);
  });
});

describe('créer une automatisation « déjà publiée »', () => {
  async function creer(corps: Record<string, unknown>) {
    const { default: routeur } = await import('../../server/routes/automation-rules');
    const app = express();
    app.use(express.json());
    app.use('/api', routeur);
    const serveur = app.listen(0);
    try {
      const { port } = serveur.address() as AddressInfo;
      const r = await fetch(`http://127.0.0.1:${port}/api/automations/rules`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' }, body: JSON.stringify(corps),
      });
      return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, unknown> | null };
    } finally { serveur.close(); }
  }
  const CORPS = { name: 'Merci', trigger_event: 'job.completed', delay_seconds: 0, actions: [{ type: 'send_sms', config: { body: 'Merci [client_first_name] !' } }], steps: etapeTexto };

  it('is_active: true demandé : insérée en brouillon par la session, publiée par le serveur, rendue « publiée »', async () => {
    const r = await creer({ ...CORPS, is_active: true });
    expect(r.status).toBe(201);
    expect(r.json?.is_active).toBe(true);
    const utilisateur = surRegles(bases.u.etat.ecritures);
    expect(utilisateur).toHaveLength(1);
    expect(utilisateur[0].valeurs).toMatchObject({ is_active: false, is_preset: false });
    expect(surRegles(bases.s.etat.ecritures)).toMatchObject([{ op: 'update', valeurs: { is_active: true } }]);
  });

  it('sans is_active : un brouillon, et le serveur n’écrit rien', async () => {
    const r = await creer(CORPS);
    expect(r.status).toBe(201);
    expect(r.json?.is_active).toBe(false);
    expect(surRegles(bases.s.etat.ecritures)).toEqual([]);
  });
});
