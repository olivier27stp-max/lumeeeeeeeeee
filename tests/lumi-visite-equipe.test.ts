/**
 * Une visite dit quelle équipe la fait (server/lib/agent/tools.ts, fetchScheduleEvents).
 *
 * Passe en prod du 2026-10-02 : « qui travaille lundi prochain » — Lumi lisait l'horaire des
 * visites et répondait « une visite chez Isabelle Fournier… tu veux que je vérifie qui y est
 * assigné ? ». L'équipe était dans la visite (`schedule_events.team_id`), jamais rendue.
 */
import { describe, it, expect } from 'vitest';
import { TOOLS_BY_NAME } from '../server/lib/agent/tools';

type Ligne = Record<string, any>;

/** Base en mémoire : eq / is / in / gte / lte s'appliquent pour vrai ; chaque table lue est notée. */
function base(tables: Record<string, Ligne[]>) {
  const lues: string[] = [];
  const from = (table: string) => {
    lues.push(table);
    const filtres: Array<(l: Ligne) => boolean> = [];
    const q: any = {};
    q.select = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.ilike = () => q;
    q.eq = (col: string, v: unknown) => { filtres.push((l) => l[col] === v); return q; };
    q.is = (col: string, v: unknown) => { filtres.push((l) => (l[col] ?? null) === v); return q; };
    q.in = (col: string, vs: unknown[]) => { filtres.push((l) => vs.includes(l[col])); return q; };
    q.gte = (col: string, v: string) => { filtres.push((l) => String(l[col]) >= v); return q; };
    q.lte = (col: string, v: string) => { filtres.push((l) => String(l[col]) <= v); return q; };
    q.then = (ok: any, ko: any) => Promise.resolve({ data: (tables[table] ?? []).filter((l) => filtres.every((f) => f(l))), error: null }).then(ok, ko);
    return q;
  };
  return { ctx: { client: { from }, orgId: 'org-1', userId: 'u-1' } as never, lues };
}

const visite = (id: string, job_id: string, team_id: string | null, plus: Ligne = {}) => ({
  id, org_id: 'org-1', job_id, team_id, start_at: '2026-10-05T14:00:00.000Z', end_at: '2026-10-05T16:00:00.000Z', status: 'scheduled', deleted_at: null, ...plus,
});
const job = (id: string, client: string, plus: Ligne = {}) => ({
  id, org_id: 'org-1', title: 'Lavage à pression', client_name: client, property_address: '5480 13e Avenue, Montréal', status: 'scheduled', total_cents: 25000, deleted_at: null, ...plus,
});
const periode = { start_date: '2026-10-05', end_date: '2026-10-05' };
const lire = (tables: Record<string, Ligne[]>) => {
  const b = base(tables);
  return TOOLS_BY_NAME.query_schedule.handler!(periode, b.ctx).then((r) => ({ r: r as any, lues: b.lues }));
};

describe('query_schedule : chaque visite dit son équipe', () => {
  const tables = () => ({
    schedule_events: [visite('e1', 'j1', 't1'), visite('e2', 'j2', 't1', { start_at: '2026-10-05T18:00:00.000Z' }), visite('e3', 'j3', null, { start_at: '2026-10-05T19:00:00.000Z' })],
    jobs: [job('j1', 'Isabelle Fournier'), job('j2', 'Sophie Tremblay'), job('j3', 'Marie Roy')],
    teams: [{ id: 't1', org_id: 'org-1', name: 'Pression' }, { id: 't9', org_id: 'org-2', name: 'Ailleurs' }],
    memberships: [
      { org_id: 'org-1', team_id: 't1', full_name: 'Olivier Gauthier', status: 'active' },
      { org_id: 'org-1', team_id: 't1', full_name: 'Ancien Employé', status: 'suspended' },
      { org_id: 'org-1', team_id: null, full_name: 'Sans Équipe', status: 'active' },
      { org_id: 'org-2', team_id: 't1', full_name: 'Étranger', status: 'active' },
    ],
  });

  it('le nom de l’équipe sur la visite, ses membres actifs une seule fois à côté', async () => {
    const { r } = await lire(tables());
    expect(r.count).toBe(3);
    expect(r.events.map((e: any) => [e.client_name, e.team])).toEqual([['Isabelle Fournier', 'Pression'], ['Sophie Tremblay', 'Pression'], ['Marie Roy', undefined]]);
    expect(r.teams).toEqual([{ team: 'Pression', members: ['Olivier Gauthier'] }]);
    expect(JSON.stringify(r)).not.toMatch(/Étranger|Ailleurs|Ancien|team_id/);
  });

  it('aucune visite assignée à une équipe : ni lecture des équipes, ni clé en plus', async () => {
    const t = tables();
    for (const e of t.schedule_events) e.team_id = null;
    const { r, lues } = await lire(t);
    expect(lues).toEqual(['schedule_events', 'jobs']);
    expect(r.teams).toBeUndefined();
    expect(Object.keys(r.events[0])).not.toContain('team');
  });

  it('une équipe supprimée ou illisible : la visite reste, sans équipe', async () => {
    const t = tables();
    t.teams = [];
    const { r } = await lire(t);
    expect(r.count).toBe(3);
    expect(r.events.every((e: any) => e.team === undefined)).toBe(true);
    expect(r.teams).toBeUndefined();
  });

  it('la description renvoie vers l’horaire des employés pour « qui travaille »', () => {
    const d = TOOLS_BY_NAME.query_schedule.declaration.description;
    expect(d).toMatch(/assigned team/);
    expect(d).toMatch(/get_team_schedule/);
  });
});
