/**
 * Outils Lumi du porte-à-porte et des formations (server/lib/agent/tools-d2d-formations.ts).
 * ─────────────────────────────────────────────────────────────────
 * - chaque déclaration passe validerArgs avec un exemple minimal (même boucle
 *   que tests/lumi-registre.test.ts) ;
 * - chaque écriture exige l'identité et passe par executerIdempotent ;
 * - les créations partent vers la BONNE route (chemin construit depuis un id
 *   validé, jamais une valeur libre), les modifications directes filtrent
 *   TOUJOURS sur org_id = ctx.orgId ;
 * - aucun texte brut de la base ne remonte au modèle ; chaque note est en
 *   français ;
 * - les manifestes (registre, permissions, topics) couvrent exactement les
 *   outils du module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validerArgs } from '../server/lib/agent/validation-args';
import { PERMISSION_KEYS } from '../src/lib/permissions';

const { appelInterneMock } = vi.hoisted(() => ({ appelInterneMock: vi.fn() }));

// tools-etendus tire Twilio, Resend, la sécurité… : on ne garde que les trois
// helpers utilisés, avec un executerIdempotent qui imite le vrai contrat
// (exécute l'action ; une erreur levée devient { error } sans texte brut).
vi.mock('../server/lib/agent/tools-etendus', () => {
  class AppelInterneIncertain extends Error { constructor(public cause: string) { super(cause); this.name = 'AppelInterneIncertain'; } }
  return {
    AppelInterneIncertain,
    appelInterne: (...a: any[]) => appelInterneMock(...a),
    champRequis: (v: any, nom: string) => {
      const s = v == null ? '' : String(v).trim();
      if (!s) throw new Error(`${nom} est requis — précise-le et réessaie.`);
      return s;
    },
    executerIdempotent: async (ctx: any, _outil: string, args: any, action: () => Promise<any>) => {
      if (ctx.dryRun) return { dry_run: true, args };
      try { return await action(); } catch (e: any) {
        const brut = e instanceof Error && !(e as any).code && !/constraint|violates|postgres|sql|relation|rls/i.test(e.message);
        return { error: brut ? e.message : 'L’action n’a pas fonctionné côté Lume.' };
      }
    },
  };
});

import {
  OUTILS_D2D_FORMATIONS, REGISTRE_D2D_FORMATIONS, PERMISSIONS_D2D_FORMATIONS, TOPICS_D2D_FORMATIONS,
} from '../server/lib/agent/tools-d2d-formations';
import { AppelInterneIncertain } from '../server/lib/agent/tools-etendus';

const PAR_NOM = Object.fromEntries(OUTILS_D2D_FORMATIONS.map((t) => [t.declaration.name, t]));
const NOMS = OUTILS_D2D_FORMATIONS.map((t) => t.declaration.name);
const ECRITURES = OUTILS_D2D_FORMATIONS.filter((t) => t.kind === 'write').map((t) => t.declaration.name);

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const ID2 = '44444444-4444-4444-8444-444444444444';

type Op = [string, any[]];
interface Appel { table: string; ops: Op[] }

/**
 * Client Supabase factice et chaînable : chaque `from()` enregistre la table
 * et la suite des appels ; la N-ième requête terminée reçoit la N-ième réponse.
 */
function fauxClient(reponses: Array<{ data?: any; error?: any; count?: number | null }> = []) {
  const appels: Appel[] = [];
  let i = 0;
  const prochaine = () => reponses[Math.min(i++, Math.max(reponses.length - 1, 0))] ?? { data: null, error: null };
  const client = {
    from(table: string) {
      const ops: Op[] = [];
      appels.push({ table, ops });
      const q: any = {};
      for (const m of ['select', 'update', 'upsert', 'insert', 'delete', 'eq', 'neq', 'is', 'in', 'or', 'not', 'order', 'limit', 'range', 'ilike', 'gte', 'lte']) {
        q[m] = (...a: any[]) => { ops.push([m, a]); return q; };
      }
      q.maybeSingle = () => { ops.push(['maybeSingle', []]); return Promise.resolve(prochaine()); };
      q.single = () => { ops.push(['single', []]); return Promise.resolve(prochaine()); };
      q.then = (res: any, rej: any) => Promise.resolve(prochaine()).then(res, rej);
      return q;
    },
  };
  return { client, appels };
}

const ctxAvec = (client: any) => ({ client, orgId: ORG, userId: USER, accessToken: 'jeton' }) as any;

const filtreOrg = (a: Appel) => a.ops.some(([m, args]) => m === 'eq' && args[0] === 'org_id' && args[1] === ORG);
const filtreActif = (a: Appel) => a.ops.some(([m, args]) => m === 'is' && args[0] === 'deleted_at' && args[1] === null);
const op = (a: Appel, nom: string) => a.ops.find(([m]) => m === nom)?.[1];

const ACCENT = /[àâéèêîôûç]/;

beforeEach(() => {
  appelInterneMock.mockReset();
});

// ─────────────────────────────────────────────────────────────────

describe('déclarations', () => {
  it('les noms sont uniques, ne recouvrent aucun outil existant du module, et toute écriture exige l identité + un handler', () => {
    expect(new Set(NOMS).size).toBe(NOMS.length);
    expect(NOMS).not.toContain('get_d2d_stats');
    expect(NOMS).not.toContain('list_courses');
    for (const t of OUTILS_D2D_FORMATIONS) {
      expect(typeof t.handler, t.declaration.name).toBe('function');
      expect(t.declaration.description.length, t.declaration.name).toBeGreaterThan(30);
      if (t.kind === 'write') expect(t.needsIdentity, t.declaration.name).toBe(true);
    }
    expect(ECRITURES.length).toBe(23);
    expect(NOMS.length).toBe(25);
  });

  it('couvre les gestes demandés : maisons, territoires, reps/équipes, pipeline, réglages, sessions, gamification, formations', () => {
    expect(NOMS).toEqual(expect.arrayContaining([
      'list_houses', 'create_house', 'update_house', 'log_house_event',
      'list_territories', 'create_territory', 'update_territory',
      'create_rep', 'create_d2d_team',
      'update_d2d_pipeline_item', 'update_d2d_settings',
      'start_field_session', 'end_field_session', 'pause_field_session', 'resume_field_session',
      'create_badge', 'create_challenge', 'create_battle',
      'create_course', 'update_course', 'publish_course', 'assign_course',
      'create_course_module', 'create_course_lesson', 'update_course_lesson',
    ]));
  });

  it('chaque déclaration accepte un exemple minimal conforme (aucun schéma hors du sous-ensemble de validerArgs)', () => {
    for (const [name, t] of Object.entries(PAR_NOM)) {
      const p: any = t.declaration.parameters ?? { type: 'object', properties: {} };
      const exemple: Record<string, unknown> = {};
      for (const k of p.required ?? []) {
        const s = p.properties?.[k] ?? {};
        exemple[k] = s.type === 'integer' || s.type === 'number' ? 1 : s.type === 'boolean' ? true : s.type === 'array' ? [] : s.type === 'object' ? {} : (s.enum?.[0] ?? 'x');
      }
      const r = validerArgs(p, exemple);
      expect(r.ok, `${name} : ${(r as any).erreur ?? ''}`).toBe(true);
    }
  });

  it('les énumérations reflètent les CHECK de la base (statuts de maison, étapes du pipeline, types de défi)', () => {
    const props = (n: string) => (PAR_NOM[n].declaration.parameters as any).properties;
    expect(props('update_house').status.enum).toEqual(['unknown', 'no_answer', 'not_interested', 'lead', 'quote_sent', 'sale', 'callback', 'do_not_knock', 'revisit']);
    expect(props('update_d2d_pipeline_item').stage.enum).toEqual(['new_prospect', 'no_response', 'quote_sent', 'closed_won', 'closed_lost']);
    expect(props('update_d2d_pipeline_item').d2d_status.enum).toEqual(['pending', 'follow_up', 'hot', 'cold', 'no_answer']);
    expect(props('create_challenge').type.enum).toEqual(['daily', 'weekly']);
    expect(props('create_course').status.enum).toEqual(['draft', 'published']);
    // Les colonnes de réglages sont celles de field_settings dans SCHEMA_SNAPSHOT (la route PUT cite des colonnes inexistantes).
    expect(Object.keys(props('update_d2d_settings')).sort()).toEqual(['ai_summaries_enabled', 'auto_followup_days', 'auto_revisit_days', 'feature_enabled', 'show_peer_payouts', 'territory_restriction_enabled', 'voice_notes_enabled']);
  });
});

// ─────────────────────────────────────────────────────────────────

describe('manifestes', () => {
  it('le registre couvre exactement les écritures, et un envoi client serait toujours irréversible', () => {
    expect(Object.keys(REGISTRE_D2D_FORMATIONS).sort()).toEqual([...ECRITURES].sort());
    for (const [n, a] of Object.entries(REGISTRE_D2D_FORMATIONS)) {
      expect(a.vers_client, n).toBe(false); // rien ici n'atteint un client
      if (a.vers_client) expect(a.reversible, n).toBe(false);
    }
    expect(REGISTRE_D2D_FORMATIONS.end_field_session).toEqual({ sensible: true, reversible: false, vers_client: false });
  });

  it('chaque outil a une permission de la page Rôles (clé réelle) et une capacité en français', () => {
    expect(Object.keys(PERMISSIONS_D2D_FORMATIONS).sort()).toEqual([...NOMS].sort());
    for (const [n, p] of Object.entries(PERMISSIONS_D2D_FORMATIONS)) {
      expect(PERMISSION_KEYS as readonly string[], `${n} : ${p.cle}`).toContain(p.cle);
      expect(p.capacite.length, n).toBeGreaterThan(5);
    }
    expect(PERMISSIONS_D2D_FORMATIONS.list_houses.cle).toBe('door_to_door.access');
    expect(PERMISSIONS_D2D_FORMATIONS.create_house.cle).toBe('door_to_door.edit');
    expect(PERMISSIONS_D2D_FORMATIONS.update_d2d_pipeline_item.cle).toBe('door_to_door.convert');
    // Pas de clé « courses » dans permissions.ts : les écritures de cours = gestion d'équipe.
    expect((PERMISSION_KEYS as readonly string[]).some((k) => k.startsWith('courses.'))).toBe(false);
    for (const n of ['create_course', 'update_course', 'publish_course', 'assign_course', 'create_course_module', 'create_course_lesson', 'update_course_lesson']) {
      expect(PERMISSIONS_D2D_FORMATIONS[n].cle, n).toBe('team.update');
    }
  });

  it('tous les outils sont dans le topic « equipe », une seule fois', () => {
    expect(Object.keys(TOPICS_D2D_FORMATIONS)).toEqual(['equipe']);
    expect([...(TOPICS_D2D_FORMATIONS.equipe ?? [])].sort()).toEqual([...NOMS].sort());
    expect(new Set(TOPICS_D2D_FORMATIONS.equipe).size).toBe(NOMS.length);
  });
});

// ─────────────────────────────────────────────────────────────────

describe('lectures : filtrées sur l org et sans texte brut', () => {
  it('list_houses filtre org_id + deleted_at, applique les filtres demandés et traduit les statuts', async () => {
    const { client, appels } = fauxClient([{ data: [{ id: ID, address: '12 rue X', current_status: 'sale', visit_count: 2 }], error: null, count: 7 }]);
    const r = await PAR_NOM.list_houses.handler!({ territory_id: ID2, status: 'sale', search: 'Rue', limit: 1 }, ctxAvec(client));
    expect(appels[0].table).toBe('field_house_profiles');
    expect(filtreOrg(appels[0])).toBe(true);
    expect(filtreActif(appels[0])).toBe(true);
    expect(appels[0].ops).toContainEqual(['eq', ['territory_id', ID2]]);
    expect(appels[0].ops).toContainEqual(['eq', ['current_status', 'sale']]);
    expect(appels[0].ops).toContainEqual(['ilike', ['address_normalized', '%rue%']]);
    expect(r).toMatchObject({ total_matching: 7, shown: 1, houses: [{ id: ID, adresse: '12 rue X', statut: 'vente', visites: 2 }] });
    expect(r.note).toMatch(ACCENT);
  });

  it('list_territories filtre org_id et une erreur de base devient une phrase générique', async () => {
    const { client, appels } = fauxClient([{ data: null, error: { code: '42P01', message: 'relation "field_territories" does not exist' } }]);
    const r = await PAR_NOM.list_territories.handler!({}, ctxAvec(client));
    expect(appels[0].table).toBe('field_territories');
    expect(filtreOrg(appels[0])).toBe(true);
    expect(r.error).toMatch(ACCENT);
    expect(JSON.stringify(r)).not.toMatch(/relation|42P01/);
  });
});

// ─────────────────────────────────────────────────────────────────

describe('créations : par la route de l application, chemin bâti depuis un id validé', () => {
  const okRoute = (json: any = { id: ID }) => appelInterneMock.mockResolvedValue({ ok: true, status: 201, json });

  it.each([
    ['create_house', { address: '12 rue X', lat: 46.8, lng: -71.2, status: 'lead' }, '/field-sales/houses', 'house_id'],
    ['create_territory', { name: 'Nord', polygon: [[-71.2, 46.8], [-71.1, 46.8], [-71.1, 46.9]] }, '/field-sales/territories', 'territory_id'],
    ['create_rep', { user_id: USER, display_name: 'Marc' }, '/field-sales/reps', 'rep_id'],
    ['create_d2d_team', { name: 'Alpha', member_ids: [ID2] }, '/field-sales/teams', 'team_id'],
    ['start_field_session', { latitude: 46.8, longitude: -71.2 }, '/field-sessions/start', 'session_id'],
    ['create_badge', { slug: 'First Sale', name_fr: 'Première vente' }, '/gamification/badges', 'badge_id'],
    ['create_challenge', { name_fr: 'Semaine portes', type: 'weekly', metric_slug: 'knocks', start_date: '2026-09-14', end_date: '2026-09-20' }, '/gamification/challenges', 'challenge_id'],
    ['create_battle', { name: 'Duel', metric_slug: 'sales', opponent_user_id: ID2, start_date: '2026-09-14', end_date: '2026-09-20' }, '/gamification/battles', 'battle_id'],
    ['create_course', { title: 'Sécurité' }, '/courses', 'course_id'],
    ['assign_course', { course_id: ID, user_ids: [USER] }, `/courses/${ID}/assign`, 'course_id'],
    ['create_course_module', { course_id: ID, title: 'Intro' }, `/courses/${ID}/modules`, 'module_id'],
    ['create_course_lesson', { module_id: ID, title: 'Bienvenue', content_type: 'text', text_content: 'Bonjour' }, `/courses/modules/${ID}/lessons`, 'lesson_id'],
    ['log_house_event', { house_id: ID, event_type: 'sale', note_text: 'Vendu' }, `/field-sales/houses/${ID}/events`, 'event_id'],
  ])('%s appelle %s et répond avec une note française', async (nom, args, chemin, cleId) => {
    okRoute();
    const { client } = fauxClient();
    const r = await PAR_NOM[nom as string].handler!(args as any, ctxAvec(client));
    expect(appelInterneMock).toHaveBeenCalledTimes(1);
    expect(appelInterneMock.mock.calls[0][1]).toBe(chemin);
    expect(r.error, `${nom} : ${r.error}`).toBeUndefined();
    expect(r[cleId as string]).toBe(ID);
    expect(r.note).toMatch(ACCENT);
  });

  it('un identifiant qui n est pas un UUID n atteint jamais un chemin de route', async () => {
    const { client } = fauxClient();
    for (const [nom, args] of [
      ['log_house_event', { house_id: '../admin', event_type: 'knock' }],
      ['assign_course', { course_id: 'x', user_ids: [USER] }],
      ['create_course_module', { course_id: '1 OR 1=1', title: 'T' }],
      ['create_course_lesson', { module_id: 'abc', title: 'T' }],
    ] as const) {
      const r = await PAR_NOM[nom].handler!(args as any, ctxAvec(client));
      expect(r.error, nom).toMatch(/identifiant/);
      expect(appelInterneMock).not.toHaveBeenCalled();
    }
  });

  it('le corps envoyé reflète les arguments validés (territoire : anneau GeoJSON fermé ; duel : challenger = utilisateur courant)', async () => {
    okRoute();
    const { client } = fauxClient();
    await PAR_NOM.create_territory.handler!({ name: 'Nord', polygon: [[-71.2, 46.8], [-71.1, 46.8], [-71.1, 46.9]], color: '#000' }, ctxAvec(client));
    expect(appelInterneMock.mock.calls[0][2]).toEqual({
      name: 'Nord', color: '#000',
      geojson: { type: 'Polygon', coordinates: [[[-71.2, 46.8], [-71.1, 46.8], [-71.1, 46.9], [-71.2, 46.8]]] },
    });
    appelInterneMock.mockClear(); okRoute();
    await PAR_NOM.create_battle.handler!({ name: 'Duel', metric_slug: 'sales', opponent_user_id: ID2, start_date: '2026-09-14', end_date: '2026-09-20' }, ctxAvec(client));
    expect(appelInterneMock.mock.calls[0][2]).toMatchObject({ type: 'rep_vs_rep', challenger_user_id: USER, opponent_user_id: ID2 });
    appelInterneMock.mockClear(); okRoute();
    await PAR_NOM.create_badge.handler!({ slug: 'First Sale', name_fr: 'Première vente' }, ctxAvec(client));
    expect(appelInterneMock.mock.calls[0][2]).toMatchObject({ slug: 'first_sale', name_fr: 'Première vente', name_en: 'Première vente' });
  });

  it('un refus de la route devient une erreur lisible ; une réponse jamais arrivée est signalée incertaine, pas relancée', async () => {
    const { client } = fauxClient();
    appelInterneMock.mockResolvedValue({ ok: false, status: 403, json: { error: 'Zone « Nord » réservée — assignée à un autre représentant.' } });
    const refus = await PAR_NOM.create_house.handler!({ address: '12 rue X', lat: 46.8, lng: -71.2 }, ctxAvec(client));
    expect(refus.error).toContain('refusé');
    expect(refus.error).toContain('Zone « Nord » réservée');

    appelInterneMock.mockRejectedValue(new AppelInterneIncertain('timeout'));
    const incertain = await PAR_NOM.log_house_event.handler!({ house_id: ID, event_type: 'knock' }, ctxAvec(client));
    expect(incertain).toMatchObject({ incertain: true });
    expect(incertain.error).toBeUndefined();
    expect(incertain.note).toMatch(/PEUT-ÊTRE/);
  });

  it('create_house signale une fusion avec une maison existante au lieu d annoncer une création', async () => {
    okRoute({ id: ID, merged: true, client_id: ID2, current_status: 'lead' });
    const { client } = fauxClient();
    const r = await PAR_NOM.create_house.handler!({ address: '12 rue X', lat: 46.8, lng: -71.2 }, ctxAvec(client));
    expect(r).toMatchObject({ house_id: ID, merged: true, client_id: ID2, statut: 'prospect' });
    expect(r.note).toMatch(/fusionné/);
  });

  it('les validations métier refusent avant tout appel : polygone trop court, dates inversées, duel contre soi-même, coordonnées absentes', async () => {
    const { client } = fauxClient();
    const cas: Array<[string, any, RegExp]> = [
      ['create_territory', { name: 'N', polygon: [[-71, 46], [-70, 46]] }, /3 points/],
      ['create_challenge', { name_fr: 'D', type: 'daily', metric_slug: 'leads', start_date: '2026-09-20', end_date: '2026-09-14' }, /date de fin/],
      ['create_battle', { name: 'D', metric_slug: 'sales', opponent_user_id: USER, start_date: '2026-09-14', end_date: '2026-09-20' }, /différentes/],
      ['create_house', { address: '12 rue X', lat: 'nord', lng: -71.2 }, /latitude/i],
      ['assign_course', { course_id: ID }, /membre ou une équipe/],
    ];
    for (const [nom, args, attendu] of cas) {
      const r = await PAR_NOM[nom].handler!(args, ctxAvec(client));
      expect(r.error, nom).toMatch(attendu);
    }
    expect(appelInterneMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────

describe('sessions terrain : la session ouverte est résolue dans l org de l utilisateur', () => {
  it('end_field_session sans session_id cherche la session ouverte (org + user) puis appelle /field-sessions/:id/end', async () => {
    const { client, appels } = fauxClient([{ data: { id: ID, status: 'active' }, error: null }]);
    appelInterneMock.mockResolvedValue({ ok: true, status: 200, json: { id: ID, total_duration_minutes: 95, doors_knocked: 40 } });
    const r = await PAR_NOM.end_field_session.handler!({ latitude: 46.8, longitude: -71.2 }, ctxAvec(client));
    expect(appels[0].table).toBe('fs_field_sessions');
    expect(filtreOrg(appels[0])).toBe(true);
    expect(appels[0].ops).toContainEqual(['eq', ['user_id', USER]]);
    expect(appels[0].ops).toContainEqual(['in', ['status', ['active', 'paused']]]);
    expect(appelInterneMock.mock.calls[0][1]).toBe(`/field-sessions/${ID}/end`);
    expect(appelInterneMock.mock.calls[0][2]).toEqual({ latitude: 46.8, longitude: -71.2 });
    expect(r).toMatchObject({ session_id: ID, duree_minutes: 95, portes_cognees: 40 });
    expect(r.note).toMatch(ACCENT);
  });

  it('pause/resume refusent un état incohérent sans appeler la route, et disent quand aucune session n est ouverte', async () => {
    const dejaEnPause = fauxClient([{ data: { id: ID, status: 'paused' }, error: null }]);
    const r1 = await PAR_NOM.pause_field_session.handler!({}, ctxAvec(dejaEnPause.client));
    expect(r1.error).toMatch(/déjà en pause/);
    const dejaActive = fauxClient([{ data: { id: ID, status: 'active' }, error: null }]);
    const r2 = await PAR_NOM.resume_field_session.handler!({}, ctxAvec(dejaActive.client));
    expect(r2.error).toMatch(/déjà active/);
    const aucune = fauxClient([{ data: null, error: null }]);
    const r3 = await PAR_NOM.pause_field_session.handler!({}, ctxAvec(aucune.client));
    expect(r3.error).toMatch(/Aucune session/);
    expect(appelInterneMock).not.toHaveBeenCalled();

    appelInterneMock.mockResolvedValue({ ok: true, status: 200, json: { id: ID } });
    const explicite = fauxClient();
    const r4 = await PAR_NOM.resume_field_session.handler!({ session_id: ID }, ctxAvec(explicite.client));
    expect(explicite.appels).toHaveLength(0); // id fourni : pas de recherche
    expect(appelInterneMock.mock.calls[0][1]).toBe(`/field-sessions/${ID}/resume`);
    expect(r4.note).toMatch(ACCENT);
  });
});

// ─────────────────────────────────────────────────────────────────

describe('modifications directes (miroir des routes PUT/PATCH) : toujours org_id = ctx.orgId', () => {
  it.each([
    ['update_house', { house_id: ID, status: 'callback', territory_id: ID2 }, 'field_house_profiles', { current_status: 'callback', territory_id: ID2 }],
    ['update_territory', { territory_id: ID, name: 'Sud', is_exclusive: true }, 'field_territories', { name: 'Sud', is_exclusive: true }],
    ['update_d2d_pipeline_item', { deal_id: ID, stage: 'closed_won', d2d_status: 'hot' }, 'pipeline_deals', { stage: 'closed_won', d2d_status: 'hot' }],
    ['update_course', { course_id: ID, title: 'Sécurité 2', visibility: 'assigned' }, 'courses', { title: 'Sécurité 2', visibility: 'assigned' }],
    ['publish_course', { course_id: ID }, 'courses', { status: 'published' }],
  ])('%s met à jour %s filtré sur l org et l id, hors corbeille, avec une note française', async (nom, args, table, attendu) => {
    const { client, appels } = fauxClient([{ data: { id: ID, title: 'T', name: 'Sud', current_status: 'callback', stage: 'closed_won', status: 'published' }, error: null }]);
    const r = await PAR_NOM[nom as string].handler!(args as any, ctxAvec(client));
    expect(r.error, `${nom} : ${r.error}`).toBeUndefined();
    expect(appels).toHaveLength(1);
    expect(appels[0].table).toBe(table);
    expect(filtreOrg(appels[0])).toBe(true);
    expect(filtreActif(appels[0])).toBe(true);
    expect(appels[0].ops).toContainEqual(['eq', ['id', ID]]);
    expect(op(appels[0], 'update')![0]).toMatchObject(attendu as any);
    expect(op(appels[0], 'update')![0].updated_at).toBeTruthy();
    expect(r.note).toMatch(ACCENT);
    expect(appelInterneMock).not.toHaveBeenCalled();
  });

  it('update_d2d_pipeline_item pose won_at / lost_at comme la route, et refuse un appel sans changement', async () => {
    const perdu = fauxClient([{ data: { id: ID, stage: 'closed_lost' }, error: null }]);
    await PAR_NOM.update_d2d_pipeline_item.handler!({ deal_id: ID, stage: 'closed_lost', lost_reason: 'Trop cher' }, ctxAvec(perdu.client));
    const u = op(perdu.appels[0], 'update')![0];
    expect(u).toMatchObject({ stage: 'closed_lost', lost_reason: 'Trop cher' });
    expect(u.lost_at).toBeTruthy();
    expect(u.won_at).toBeUndefined();
    const rien = fauxClient();
    const r = await PAR_NOM.update_d2d_pipeline_item.handler!({ deal_id: ID }, ctxAvec(rien.client));
    expect(r.error).toMatch(/Rien à modifier/);
    expect(rien.appels).toHaveLength(0);
  });

  it('update_d2d_settings fait un upsert sur field_settings porté par org_id (colonnes réelles du schéma)', async () => {
    const { client, appels } = fauxClient([{ data: { id: ID }, error: null }]);
    const r = await PAR_NOM.update_d2d_settings.handler!({ auto_revisit_days: 5, voice_notes_enabled: false }, ctxAvec(client));
    expect(appels[0].table).toBe('field_settings');
    const [ligne, options] = op(appels[0], 'upsert')!;
    expect(ligne).toMatchObject({ org_id: ORG, auto_revisit_days: 5, voice_notes_enabled: false });
    expect(options).toEqual({ onConflict: 'org_id' });
    expect(r).toMatchObject({ champs_modifies: ['auto_revisit_days', 'voice_notes_enabled'] });
    expect(r.note).toMatch(ACCENT);
    const hors = await PAR_NOM.update_d2d_settings.handler!({ auto_followup_days: 900 }, ctxAvec(fauxClient().client));
    expect(hors.error).toMatch(/365/);
  });

  it('update_course_lesson remonte leçon → module → cours et exige que le COURS soit dans l org avant d écrire', async () => {
    const { client, appels } = fauxClient([
      { data: { id: ID, module_id: ID2 }, error: null },        // course_lessons
      { data: { id: ID2, course_id: ORG }, error: null },       // course_modules
      { data: { id: ORG }, error: null },                       // courses (org check)
      { data: { id: ID, title: 'Bienvenue 2' }, error: null },  // update
    ]);
    const r = await PAR_NOM.update_course_lesson.handler!({ lesson_id: ID, title: 'Bienvenue 2', duration_min: 4 }, ctxAvec(client));
    expect(appels.map((a) => a.table)).toEqual(['course_lessons', 'course_modules', 'courses', 'course_lessons']);
    expect(filtreOrg(appels[2])).toBe(true);
    expect(filtreActif(appels[2])).toBe(true);
    expect(op(appels[3], 'update')![0]).toMatchObject({ title: 'Bienvenue 2', duration_min: 4 });
    expect(appels[3].ops).toContainEqual(['eq', ['module_id', ID2]]);
    expect(r).toMatchObject({ lesson_id: ID, titre: 'Bienvenue 2' });
    expect(r.note).toMatch(ACCENT);

    // Cours d'une autre org : la vérification échoue, AUCUNE écriture.
    const autre = fauxClient([
      { data: { id: ID, module_id: ID2 }, error: null },
      { data: { id: ID2, course_id: ORG }, error: null },
      { data: null, error: null },
    ]);
    const refus = await PAR_NOM.update_course_lesson.handler!({ lesson_id: ID, title: 'X' }, ctxAvec(autre.client));
    expect(refus.error).toMatch(/introuvable/);
    expect(autre.appels.map((a) => a.table)).toEqual(['course_lessons', 'course_modules', 'courses']);
  });

  it('une ligne absente ou une erreur Postgres ne laisse jamais passer de texte brut', async () => {
    const absente = fauxClient([{ data: null, error: null }]);
    const r1 = await PAR_NOM.update_house.handler!({ house_id: ID, status: 'lead' }, ctxAvec(absente.client));
    expect(r1.error).toMatch(/introuvable/);
    const brute = fauxClient([{ data: null, error: { code: '23514', message: 'new row violates check constraint "field_house_profiles_current_status_check"' } }]);
    const r2 = await PAR_NOM.update_house.handler!({ house_id: ID, status: 'lead' }, ctxAvec(brute.client));
    expect(r2.error).toBeTruthy();
    expect(JSON.stringify(r2)).not.toMatch(/constraint|23514|field_house_profiles/);
  });

  it('en mode à blanc, rien n est écrit ni appelé', async () => {
    const { client, appels } = fauxClient();
    const r = await PAR_NOM.publish_course.handler!({ course_id: ID }, { ...ctxAvec(client), dryRun: true });
    expect(r).toMatchObject({ dry_run: true });
    expect(appels).toHaveLength(0);
    expect(appelInterneMock).not.toHaveBeenCalled();
  });
});
