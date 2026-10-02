/**
 * B-07 — activer « Client inactif » ne relance pas d'un coup les clients DÉJÀ
 * inactifs (mission finale, point 10). Seuls ceux qui franchissent le seuil
 * APRÈS l'activation déclenchent — et les anciens ne remplissent plus le
 * plafond horaire à leur place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const emis = vi.hoisted(() => ({ liste: [] as Array<{ entityId: string; metadata: Record<string, unknown> }> }));
vi.mock('../../../server/lib/eventBus', () => ({
  eventBus: { emit: vi.fn(async (_type: string, e: { entityId: string; metadata: Record<string, unknown> }) => { emis.liste.push(e); return true; }) },
}));

import { fauxSupabase, type Ligne } from './_faux-supabase';
import { balayerEntreprise } from '../../../server/lib/client-inactif';
import { casAnterieurALActivation, decalerMois } from '../../../server/lib/automations-activation';

const ORG = '11111111-1111-4111-8111-111111111111';
const JOUR = 86_400_000;
// 14 h à Montréal : dans la plage du balayage (9 h – 19 h).
const T = new Date('2026-10-05T18:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const ilYaMois = (mois: number, joursDePlus = 0) => iso(decalerMois(T.getTime(), -mois) - joursDePlus * JOUR);

/** Tout ce que la fonction SQL rendrait : les clients sans job depuis 6 mois, du plus ancien au plus récent. */
const candidats = (liste: Array<[string, string]>) => () =>
  liste.map(([client_id, dernier_job_at]) => ({ client_id, periode: `job-${client_id}`, dernier_job_at }))
    .sort((x, y) => (x.dernier_job_at < y.dernier_job_at ? -1 : 1));

const monde = (regles: Ligne[], liste: Array<[string, string]>) => fauxSupabase({
  company_settings: [{ org_id: ORG, timezone: 'America/Montreal' }],
  automation_rules: regles.map((r, i) => ({
    id: `r${i + 1}`, org_id: ORG, trigger_event: 'client.inactive', is_active: true, deleted_at: null, conditions: { mois: 6 }, ...r,
  })),
  clients_inactifs_declenches: [],
}, { rpc: { clients_inactifs: (args) => candidats(liste)().slice(0, args.p_limite) } });

beforeEach(() => { emis.liste.length = 0; });

describe('[B-07] le balayage n’émet que pour les clients devenus inactifs APRÈS l’activation', () => {
  // 20 clients inactifs depuis un an, 1 qui a franchi ses 6 mois hier.
  const VIEUX: Array<[string, string]> = Array.from({ length: 20 }, (_, i) => [`vieux-${i}`, ilYaMois(12, i)]);
  const NOUVEAU: [string, string] = ['nouveau', ilYaMois(6, 1)];

  it('règle activée il y a une semaine : les 20 clients déjà inactifs ne sont PAS relancés ; celui d’hier l’est', async () => {
    const sb = monde([{ activee_le: iso(T.getTime() - 7 * JOUR) }], [...VIEUX, NOUVEAU]);
    expect(await balayerEntreprise(sb.client, ORG, T)).toBe(1);
    expect(emis.liste.map((e) => e.entityId)).toEqual(['nouveau']);
    // Les anciens ne sont pas réservés : ils ne consomment ni le plafond horaire ni leur « une fois par période ».
    expect(sb.tables.clients_inactifs_declenches.map((l) => l.client_id)).toEqual(['nouveau']);
  });

  it('règle activée à l’instant : personne (aucun effet rétroactif)', async () => {
    const sb = monde([{ activee_le: iso(T.getTime()) }], VIEUX);
    expect(await balayerEntreprise(sb.client, ORG, T)).toBe(0);
    expect(emis.liste).toHaveLength(0);
  });

  it('plus de clients déjà inactifs que le plafond horaire : ils n’affament pas le nouveau', async () => {
    const beaucoup: Array<[string, string]> = Array.from({ length: 60 }, (_, i) => [`vieux-${i}`, ilYaMois(12, i)]);
    const sb = monde([{ activee_le: iso(T.getTime() - 7 * JOUR), conditions: { mois: 6, max_par_heure: 25 } }], [...beaucoup, NOUVEAU]);
    await balayerEntreprise(sb.client, ORG, T);
    expect(emis.liste.map((e) => e.entityId)).toEqual(['nouveau']);
  });

  it('date d’activation inconnue (ni `activee_le` ni `updated_at`) : comportement d’avant, les plus anciens d’abord dans la limite', async () => {
    const sb = monde([{}], [...VIEUX, NOUVEAU]);
    expect(await balayerEntreprise(sb.client, ORG, T)).toBe(21);
    expect(sb.appelsRpc[0].args.p_limite).toBe(25);
  });

  it('deux règles au même seuil : le filtre suit la plus ANCIENNE ; le moteur tranche ensuite pour la plus récente', async () => {
    const ancienne = { activee_le: iso(T.getTime() - 60 * JOUR) };
    const recente = { activee_le: iso(T.getTime()) };
    const client: [string, string] = ['c-mois-dernier', ilYaMois(6, 30)]; // seuil franchi il y a 30 jours
    const sb = monde([ancienne, recente], [client]);
    expect(await balayerEntreprise(sb.client, ORG, T)).toBe(1);
    const meta = { ...emis.liste[0].metadata };
    const evenement = { type: 'client.inactive', orgId: ORG, entityId: 'c-mois-dernier', metadata: meta };
    expect(await casAnterieurALActivation(sb.client, { ...ancienne, conditions: { mois: 6 } }, evenement)).toBeNull();
    expect(await casAnterieurALActivation(sb.client, { ...recente, conditions: { mois: 6 } }, evenement))
      .toBe('Le client était déjà inactif avant l’activation de l’automatisation');
  });
});
