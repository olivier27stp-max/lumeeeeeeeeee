/**
 * Lot ÉQUIPE ET PAIE de Lumi (server/lib/agent/tools-lot-paie.ts) :
 * - les manifestes (registre, permissions, topic) couvrent exactement les outils ;
 * - chaque lecture par ROUTE fait le bon GET, au nom de l'utilisateur, dans son bureau ;
 * - chaque écriture par ROUTE appelle le chemin de la page Commissions ;
 * - chaque écriture DIRECTE porte `id` + `org_id = ctx.orgId`, comme l'écran ;
 * - introuvable / autre entreprise → refus en français ; entrée invalide →
 *   refus AVANT toute écriture ; personne ne touche à sa propre paie (sauf le
 *   propriétaire).
 * Tout est simulé : une base en mémoire dont les filtres s'appliquent pour
 * vrai, `appelInterne` et `fetch` remplacés. Aucune base, aucune route réelle.
 *
 * Le module n'est pas encore branché dans outils-domaines.ts : il est importé
 * directement.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../server/lib/agent/tools-etendus', async (importActual) => {
  const orig = await importActual<typeof import('../server/lib/agent/tools-etendus')>();
  return {
    ...orig,
    appelInterne: vi.fn(),
    // L'idempotence (empreinte en base) est testée ailleurs : ici l'action tourne directement.
    executerIdempotent: vi.fn(async (_ctx: unknown, _outil: string, _args: unknown, action: () => Promise<Record<string, any>>) => action()),
  };
});

import { appelInterne, executerIdempotent, AppelInterneIncertain } from '../server/lib/agent/tools-etendus';
import { OUTILS_LOT_PAIE, REGISTRE_LOT_PAIE, PERMISSIONS_LOT_PAIE, TOPICS_LOT_PAIE } from '../server/lib/agent/tools-lot-paie';
import { validerArgs } from '../server/lib/agent/validation-args';
import { TOOLS_BY_NAME } from '../server/lib/agent/tools';
import { PERMISSION_KEYS, ROLE_PRESETS } from '../src/lib/permissions';

const SOURCE = readFileSync(resolve(__dirname, '..', 'server', 'lib', 'agent', 'tools-lot-paie.ts'), 'utf8');

const ORG = 'org-1';
const AUTRE = 'org-2';
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const U3 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // membre d'une AUTRE entreprise
const T1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const T2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [E1, E2, E3, E4, E5] = [id(1), id(2), id(3), id(4), id(5)];
const [C1, C2, C3, C4, C5, C6, C7] = [id(11), id(12), id(13), id(14), id(15), id(16), id(17)];

// ── Base en mémoire : les filtres s'appliquent pour vrai, chaque requête est enregistrée ──
type Ligne = Record<string, any>;
type Op = [string, unknown[]];
interface Appel { table: string; ops: Op[] }

function base(tables: Record<string, Ligne[]>, opts: { ecrituresMuettes?: boolean } = {}) {
  const appels: Appel[] = [];
  const from = (table: string) => {
    const appel: Appel = { table, ops: [] };
    appels.push(appel);
    let mode: 'select' | 'update' | 'delete' = 'select';
    let charge: Ligne = {};
    let limite: number | undefined;
    const filtres: Array<(l: Ligne) => boolean> = [];
    const tris: Array<[string, boolean]> = [];
    const q: any = {};
    const note = (m: string, a: unknown[]) => { appel.ops.push([m, a]); return q; };
    q.select = (...a: unknown[]) => note('select', a);
    q.update = (c: Ligne) => { mode = 'update'; charge = c; return note('update', [c]); };
    q.delete = () => { mode = 'delete'; return note('delete', []); };
    q.eq = (col: string, v: unknown) => { filtres.push((l) => l[col] === v); return note('eq', [col, v]); };
    q.is = (col: string, v: unknown) => { filtres.push((l) => (l[col] ?? null) === v); return note('is', [col, v]); };
    q.in = (col: string, vs: unknown[]) => { filtres.push((l) => vs.includes(l[col])); return note('in', [col, vs]); };
    // Seul usage : not(colonne, 'is', null) — « la colonne est renseignée ».
    q.not = (col: string, op: string, v: unknown) => { filtres.push((l) => (l[col] ?? null) !== v); return note('not', [col, op, v]); };
    q.gte = (col: string, v: string) => { filtres.push((l) => String(l[col]) >= v); return note('gte', [col, v]); };
    q.lte = (col: string, v: string) => { filtres.push((l) => String(l[col]) <= v); return note('lte', [col, v]); };
    q.order = (col: string, o?: { ascending?: boolean }) => { tris.push([col, o?.ascending !== false]); return note('order', [col, o]); };
    q.limit = (n: number) => { limite = n; return note('limit', [n]); };
    const executer = (): Ligne[] => {
      let lignes = (tables[table] ?? []).filter((l) => filtres.every((f) => f(l)));
      if (mode !== 'select' && opts.ecrituresMuettes) return []; // la RLS filtre sans lever
      if (mode === 'update') for (const l of lignes) Object.assign(l, charge);
      if (mode === 'delete') tables[table] = (tables[table] ?? []).filter((l) => !lignes.includes(l));
      for (const [col, asc] of [...tris].reverse()) {
        lignes = [...lignes].sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * (asc ? 1 : -1));
      }
      return limite ? lignes.slice(0, limite) : lignes;
    };
    // Des COPIES, comme une vraie réponse réseau : jamais la ligne de la base elle-même.
    const copie = (lignes: Ligne[]): Ligne[] => structuredClone(lignes);
    q.maybeSingle = async () => { appel.ops.push(['maybeSingle', []]); return { data: copie(executer())[0] ?? null, error: null }; };
    q.then = (ok: any, ko: any) => Promise.resolve().then(() => ({ data: copie(executer()), error: null })).then(ok, ko);
    return q;
  };
  return { client: { from } as any, appels, tables };
}

const verbe = (a: Appel) => (a.ops.find(([m]) => m === 'update' || m === 'delete')?.[0] ?? 'select');
const filtreOrg = (a: Appel) => a.ops.some(([m, args]) => m === 'eq' && args[0] === 'org_id' && args[1] === ORG);
const ecritures = (appels: Appel[]) => appels.filter((a) => verbe(a) !== 'select');
const chargeDe = (a: Appel) => a.ops.find(([m]) => m === 'update')?.[1][0] as Ligne;

const ilYA = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function donnees(role: string): Record<string, Ligne[]> {
  return {
    memberships: [
      { org_id: ORG, user_id: ME, role, status: 'active', full_name: 'Moi Même' },
      { org_id: ORG, user_id: U1, role: 'technician', status: 'active', full_name: 'Marc Roy' },
      { org_id: ORG, user_id: U2, role: 'sales_rep', status: 'active', full_name: 'Zoé Lambert' },
      { org_id: AUTRE, user_id: U3, role: 'technician', status: 'active', full_name: 'Étranger' },
    ],
    company_settings: [{ org_id: ORG, timezone: 'America/Toronto' }],
    time_entries: [
      // 16 sept. 2026, 8 h → 16 h à Toronto (UTC-4), pause de 30 min : 7,5 h.
      { id: E1, org_id: ORG, employee_id: U1, employee_name: 'Marc Roy', date: '2026-09-16', punch_in: '08:00:00', punch_out: '16:00:00', punch_in_at: '2026-09-16T12:00:00.000Z', punch_out_at: '2026-09-16T20:00:00.000Z', breaks: [{ start: '12:00:00', end: '12:30:00' }], status: 'completed', notes: '[APPROVED] matin', approved_at: null },
      // Pointage oublié : ouvert depuis 2 h, pause jamais fermée.
      { id: E2, org_id: ORG, employee_id: U1, employee_name: 'Marc Roy', date: ilYA(2).slice(0, 10), punch_in: '10:00:00', punch_out: null, punch_in_at: ilYA(2), punch_out_at: null, breaks: [{ start: '11:00:00' }], status: 'active', notes: null, approved_at: null },
      { id: E3, org_id: AUTRE, employee_id: U3, employee_name: 'Étranger', date: '2026-09-16', punch_in: '08:00:00', punch_out: null, punch_in_at: '2026-09-16T12:00:00.000Z', punch_out_at: null, breaks: [], status: 'active', notes: null, approved_at: null },
      // L'entrée du demandeur lui-même.
      { id: E4, org_id: ORG, employee_id: ME, employee_name: 'Moi Même', date: '2026-09-16', punch_in: '09:00:00', punch_out: '17:00:00', punch_in_at: '2026-09-16T13:00:00.000Z', punch_out_at: '2026-09-16T21:00:00.000Z', breaks: [], status: 'completed', notes: null, approved_at: null },
    ],
    fs_commission_entries: [
      { id: C1, org_id: ORG, user_id: U2, status: 'pending', amount: 125.5, invoice_id: 'inv-1', deleted_at: null },
      { id: C2, org_id: ORG, user_id: U2, status: 'approved', amount: 80, invoice_id: 'inv-2', deleted_at: null },
      { id: C3, org_id: ORG, user_id: U2, status: 'pending', amount: 40, invoice_id: null, deleted_at: null }, // estimation
      { id: C4, org_id: AUTRE, user_id: U3, status: 'pending', amount: 999, invoice_id: 'inv-x', deleted_at: null },
      { id: C5, org_id: ORG, user_id: ME, status: 'approved', amount: 60, invoice_id: 'inv-5', deleted_at: null },
      { id: C6, org_id: ORG, user_id: U2, status: 'paid', amount: 70, invoice_id: 'inv-6', deleted_at: null },
      { id: C7, org_id: ORG, user_id: U2, status: 'pending', amount: 10, invoice_id: 'inv-7', deleted_at: '2026-09-01T00:00:00Z' },
    ],
    teams: [
      { id: T1, org_id: ORG, name: 'Alpha', deleted_at: null },
      { id: T2, org_id: ORG, name: 'Bravo', deleted_at: null },
      { id: id(90), org_id: AUTRE, name: 'Ailleurs', deleted_at: null },
    ],
    // Mardi 2026-10-06 (jour 2).
    team_schedule_assignments: [
      { id: id(21), org_id: ORG, team_id: T2, user_id: ME, work_date: '2026-10-06', start_time: '09:00:00', end_time: '15:00:00', availability_status: 'available', note: 'renfort', recurring_schedule_id: null },
      { id: id(22), org_id: AUTRE, team_id: id(90), user_id: U3, work_date: '2026-10-06', start_time: '08:00:00', end_time: '17:00:00', availability_status: 'available', note: null, recurring_schedule_id: null },
    ],
    recurring_team_schedules: [
      { id: id(31), org_id: ORG, team_id: T1, user_id: U1, day_of_week: 2, start_time: '08:00:00', end_time: '17:00:00', effective_start_date: '2026-01-01', effective_end_date: null, is_active: true },
      { id: id(32), org_id: ORG, team_id: T1, user_id: U2, day_of_week: 2, start_time: '08:00:00', end_time: '17:00:00', effective_start_date: '2026-01-01', effective_end_date: null, is_active: true },
      // Série terminée avant la date : ne compte plus.
      { id: id(33), org_id: ORG, team_id: T2, user_id: U1, day_of_week: 2, start_time: '18:00:00', end_time: '20:00:00', effective_start_date: '2026-01-01', effective_end_date: '2026-06-30', is_active: true },
    ],
    time_off_requests: [
      { id: id(41), org_id: ORG, user_id: U2, start_date: '2026-10-05', end_date: '2026-10-09', all_day: true, start_time: null, end_time: null, kind: 'vacation', status: 'approved', reason: 'voyage' },
      { id: id(42), org_id: ORG, user_id: U1, start_date: '2026-10-06', end_date: '2026-10-06', all_day: false, start_time: '13:00:00', end_time: '17:00:00', kind: 'sick', status: 'approved', reason: 'dentiste' },
      { id: id(43), org_id: ORG, user_id: ME, start_date: '2026-10-06', end_date: '2026-10-06', all_day: true, start_time: null, end_time: null, kind: 'time_off', status: 'pending', reason: null },
      { id: id(44), org_id: AUTRE, user_id: U3, start_date: '2026-10-06', end_date: '2026-10-06', all_day: true, start_time: null, end_time: null, kind: 'sick', status: 'approved', reason: 'secret' },
    ],
  };
}

function outil(nom: string) {
  const t = OUTILS_LOT_PAIE.find((o) => o.declaration.name === nom);
  if (!t || typeof t.handler !== 'function') throw new Error(`outil absent ou sans handler : ${nom}`);
  return t;
}

interface Options { role?: string; sansJeton?: boolean; ecrituresMuettes?: boolean; prepare?: (t: Record<string, Ligne[]>) => void }

/** Comme la garde : validerArgs PUIS handler. Renvoie aussi les requêtes faites et l'état final de la base. */
async function executer(nom: string, args: Record<string, any>, o: Options = {}) {
  const t = outil(nom);
  const validation = validerArgs(t.declaration.parameters, args);
  if (!validation.ok) throw new Error(`args invalides pour ${nom} : ${validation.erreur}`);
  const tables = donnees(o.role ?? 'owner');
  o.prepare?.(tables);
  const { client, appels } = base(tables, { ecrituresMuettes: o.ecrituresMuettes });
  const ctx = { client, orgId: ORG, userId: ME, ...(o.sansJeton ? {} : { accessToken: 'jeton' }) };
  const resultat = await t.handler!(validation.args, ctx); // handler vérifié par outil()
  return { resultat, appels, tables, ctx };
}

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
afterAll(() => { vi.unstubAllGlobals(); });

const reponse = (corps: unknown, status = 200) => ({ ok: status < 400, status, json: async () => corps });
const getOk = (corps: unknown) => fetchMock.mockResolvedValue(reponse(corps));
const routeOk = (json: Record<string, any> = {}) => vi.mocked(appelInterne).mockResolvedValue({ ok: true, status: 200, json });
const NOTE_FR = /[éèêàçôù’]/;

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(appelInterne).mockReset();
  vi.mocked(executerIdempotent).mockClear();
});

const NOMS = OUTILS_LOT_PAIE.map((t) => t.declaration.name);
const ECRITURES = OUTILS_LOT_PAIE.filter((t) => t.kind === 'write').map((t) => t.declaration.name);

// ─────────────────────────────────────────────────────────────────

describe('déclarations du lot paie', () => {
  it('10 outils, noms uniques, aucun ne collisionne avec un outil d un autre module', () => {
    expect(NOMS).toEqual([
      'get_payroll_amounts', 'get_payroll_history',
      'list_time_entries', 'update_time_entry', 'delete_time_entry', 'force_punch_out',
      'list_commissions', 'approve_commission', 'mark_commission_paid',
      'get_team_schedule',
    ]);
    expect(new Set(NOMS).size).toBe(NOMS.length);
    // Avant le branchement : absent du registre. Après : c'est CET outil, pas un homonyme.
    for (const t of OUTILS_LOT_PAIE) {
      const connu = TOOLS_BY_NAME[t.declaration.name];
      expect(connu === undefined || connu === t, t.declaration.name).toBe(true);
    }
    // get_payroll_summary existe déjà (heures seulement) : le nom n'est pas réutilisé.
    expect(NOMS).not.toContain('get_payroll_summary');
  });

  it('chaque déclaration accepte un exemple minimal conforme', () => {
    for (const t of OUTILS_LOT_PAIE) {
      const p: any = t.declaration.parameters ?? { type: 'object', properties: {} };
      const exemple: Record<string, unknown> = {};
      for (const k of p.required ?? []) {
        const s = p.properties?.[k] ?? {};
        exemple[k] = s.type === 'integer' || s.type === 'number' ? 1 : s.type === 'boolean' ? true : (s.enum?.[0] ?? 'x');
      }
      const r = validerArgs(p, exemple);
      expect(r.ok, `${t.declaration.name} : ${(r as any).erreur ?? ''}`).toBe(true);
    }
  });

  it('descriptions en anglais et courtes ; écritures à identité, dans executerIdempotent sous leur nom', () => {
    for (const t of OUTILS_LOT_PAIE) {
      expect(typeof t.handler, t.declaration.name).toBe('function');
      expect(t.needsIdentity, t.declaration.name).toBe(true);
      expect(t.declaration.description, t.declaration.name).not.toMatch(NOTE_FR);
      expect(t.declaration.description.length, t.declaration.name).toBeLessThanOrEqual(260);
      for (const [k, s] of Object.entries((t.declaration.parameters as any)?.properties ?? {})) {
        expect((s as any).description, `${t.declaration.name}.${k}`).not.toMatch(NOTE_FR);
        expect(String((s as any).description).length, `${t.declaration.name}.${k}`).toBeLessThanOrEqual(90);
      }
      if (t.kind === 'write') expect(SOURCE, t.declaration.name).toContain(`executerIdempotent(ctx, '${t.declaration.name}', args`);
    }
    expect(ECRITURES).toEqual(['update_time_entry', 'delete_time_entry', 'force_punch_out', 'approve_commission', 'mark_commission_paid']);
  });

  it('jamais le client service ; aucun refus rédigé ne contient de jargon que executerIdempotent retraduirait', () => {
    expect(SOURCE).not.toMatch(/getServiceClient|service_role/);
    expect(SOURCE).not.toMatch(/console\.log/);
    const refus = SOURCE.split('\n').filter((l) => l.includes('new Refus('));
    expect(refus.length).toBeGreaterThan(20);
    for (const l of refus) expect(l, l.trim()).not.toMatch(/constraint|violates|postgres|sql|null value|rls|row-level|permission denied/i);
  });
});

describe('manifestes : registre, permissions, topic', () => {
  it('REGISTRE_LOT_PAIE couvre exactement les écritures, toutes sensibles (paie d autrui)', () => {
    expect(Object.keys(REGISTRE_LOT_PAIE).sort()).toEqual([...ECRITURES].sort());
    for (const [n, a] of Object.entries(REGISTRE_LOT_PAIE)) {
      expect(a.sensible, n).toBe(true);
      expect(a.vers_client, n).toBe(false);
    }
    expect(REGISTRE_LOT_PAIE.delete_time_entry.reversible).toBe(false); // pas de deleted_at sur time_entries
    expect(REGISTRE_LOT_PAIE.force_punch_out.reversible).toBe(false);
    expect(REGISTRE_LOT_PAIE.approve_commission.reversible).toBe(false);
    expect(REGISTRE_LOT_PAIE.mark_commission_paid.reversible).toBe(true);
  });

  it('PERMISSIONS_LOT_PAIE couvre exactement les outils, avec des clés existantes de la page Rôles', () => {
    expect(Object.keys(PERMISSIONS_LOT_PAIE).sort()).toEqual([...NOMS].sort());
    for (const [n, p] of Object.entries(PERMISSIONS_LOT_PAIE)) {
      expect((PERMISSION_KEYS as readonly string[]).includes(p.cle), `${n} → ${p.cle}`).toBe(true);
      expect(p.capacite.length, n).toBeGreaterThan(3);
    }
    // La paie et l'approbation / le versement des commissions restent hors de portée d'un vendeur et d'un technicien.
    for (const n of ['get_payroll_amounts', 'get_payroll_history', 'approve_commission', 'mark_commission_paid']) {
      expect(ROLE_PRESETS.sales_rep[PERMISSIONS_LOT_PAIE[n].cle], n).toBe(false);
      expect(ROLE_PRESETS.technician[PERMISSIONS_LOT_PAIE[n].cle], n).toBe(false);
      expect(ROLE_PRESETS.admin[PERMISSIONS_LOT_PAIE[n].cle], n).toBe(true);
    }
    // Un vendeur lit SES commissions (la route borne à lui) ; un technicien lit ses entrées de temps.
    expect(ROLE_PRESETS.sales_rep[PERMISSIONS_LOT_PAIE.list_commissions.cle]).toBe(true);
    expect(ROLE_PRESETS.technician[PERMISSIONS_LOT_PAIE.list_time_entries.cle]).toBe(true);
  });

  it('TOPICS_LOT_PAIE.equipe liste chaque outil une fois, et rien d autre', () => {
    expect(Object.keys(TOPICS_LOT_PAIE)).toEqual(['equipe']);
    expect([...(TOPICS_LOT_PAIE.equipe ?? [])].sort()).toEqual([...NOMS].sort());
  });
});

// ─────────────────────────────────────────────────────────────────

describe('get_payroll_amounts — GET /payroll/period-summary', () => {
  const resume = {
    period: { start: '2026-09-14', end: '2026-09-27', payDate: '2026-10-02' },
    rows: [
      { user_id: U1, name: 'Marc Roy', role: 'technician', hours: 72.5, rate_cents: 2500, gross_cents: 181250, commission_cents: 0, adjustments_cents: -5000, total_cents: 176250, adjustments: [{ id: 'adj-1', user_id: U1, amount_cents: -5000, note: 'outil perdu', created_at: 'x' }], payment: null },
      { user_id: U2, name: 'Zoé Lambert', role: 'sales_rep', hours: 0, rate_cents: 0, gross_cents: 0, commission_cents: 20550, adjustments_cents: 0, total_cents: 20550, adjustments: [], payment: { user_id: U2, total_cents: 20000, paid_at: '2026-09-28T12:00:00Z', note: null }, ecart_depuis_versement_cents: 550, commission_plan_missing: false },
    ],
    migration_missing: false,
  };

  it('période courante : même route que l écran, session et bureau de l utilisateur, montants en cents', async () => {
    getOk(resume);
    const { resultat, appels } = await executer('get_payroll_amounts', {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/payroll\/period-summary$/);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Authorization: 'Bearer jeton', 'x-org-id': ORG });
    expect(init.body).toBeUndefined();
    expect(appels).toEqual([]); // rien n'est recalculé en base : une seule vérité, la route
    expect(resultat.period).toEqual({ start: '2026-09-14', end: '2026-09-27', pay_date: '2026-10-02' });
    expect(resultat.members[0]).toEqual({
      user_id: U1, name: 'Marc Roy', role: 'technicien', hours: 72.5, rate_cents: 2500, gross_cents: 181250,
      commission_cents: 0, adjustments_cents: -5000, total_cents: 176250, paid: false,
      adjustments: [{ amount_cents: -5000, note: 'outil perdu' }],
    });
    expect(resultat.members[1]).toMatchObject({ paid: true, paid_at: '2026-09-28T12:00:00Z', paid_total_cents: 20000, gap_since_payment_cents: 550 });
    expect(resultat.totals).toEqual({ hours: 72.5, gross_cents: 181250, commission_cents: 20550, adjustments_cents: -5000, total_cents: 196800, paid_count: 1, unpaid_count: 1 });
    expect(resultat.note).toMatch(/1 payé\(s\), 1 à payer/);
  });

  it('period_ref passe en ?ref= ; user_id ne garde que ce membre, et un inconnu est refusé', async () => {
    getOk(resume);
    const { resultat } = await executer('get_payroll_amounts', { period_ref: '2026-09-16', user_id: U1 });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/payroll\/period-summary\?ref=2026-09-16$/);
    expect(resultat.count).toBe(1);
    expect(resultat.totals.total_cents).toBe(176250);
    const absent = await executer('get_payroll_amounts', { user_id: U3 });
    expect(absent.resultat.error).toMatch(/pas de ligne de paie/);
  });

  it('entrée invalide refusée avant tout appel ; 403 de la route → phrase en français ; sans session → refus', async () => {
    expect((await executer('get_payroll_amounts', { period_ref: '16 septembre' })).resultat.error).toMatch(/AAAA-MM-JJ/);
    expect((await executer('get_payroll_amounts', { user_id: 'marc' })).resultat.error).toMatch(/identifiant valide/);
    expect((await executer('get_payroll_amounts', {}, { sansJeton: true })).resultat.error).toMatch(/session Lume/);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(reponse({ error: 'Admin role required.' }, 403));
    const refus = await executer('get_payroll_amounts', {}, { role: 'sales_rep' });
    expect(refus.resultat).toEqual({ error: expect.stringMatching(/Ton rôle dans Lume ne permet pas la consultation de la paie/) });
    expect(JSON.stringify(refus.resultat)).not.toContain('Admin role required');
  });

  it('route muette (timeout) ou en panne : phrase générique, jamais l erreur brute', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('socket hang up'), { name: 'AbortError' }));
    const muet = await executer('get_payroll_amounts', {});
    expect(muet.resultat.error).toMatch(/n'a pas répondu à temps/);
    fetchMock.mockResolvedValue(reponse({ error: 'relation "payroll_payments" does not exist' }, 500));
    const panne = await executer('get_payroll_amounts', {});
    expect(panne.resultat.error).toMatch(/n'a pas fonctionné côté Lume \(500\)/);
    expect(panne.resultat.error).not.toMatch(/relation/);
  });
});

describe('get_payroll_history — GET /payroll/history', () => {
  const versements = [
    { period_start: '2026-09-14', period_end: '2026-09-27', hours: '72.50', gross_cents: 181250, commission_cents: 0, adjustments_cents: -5000, total_cents: 176250, note: 'virement 42', paid_at: '2026-09-28T12:00:00Z' },
    { period_start: '2026-08-31', period_end: '2026-09-13', hours: '80.00', gross_cents: 200000, commission_cents: 0, adjustments_cents: 0, total_cents: 200000, note: null, paid_at: '2026-09-14T12:00:00Z' },
  ];

  it('membre vérifié dans l org (org_id), puis la route de l écran avec user_id', async () => {
    getOk({ payments: versements, migration_missing: false });
    const { resultat, appels } = await executer('get_payroll_history', { user_id: U1 });
    expect(appels.map((a) => a.table)).toEqual(['memberships']);
    expect(filtreOrg(appels[0])).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toMatch(new RegExp(`/api/payroll/history\\?user_id=${U1}$`));
    expect(resultat).toMatchObject({ user_id: U1, name: 'Marc Roy', count: 2 });
    expect(resultat.payments[0]).toEqual({ period_start: '2026-09-14', period_end: '2026-09-27', hours: 72.5, gross_cents: 181250, commission_cents: 0, adjustments_cents: -5000, total_cents: 176250, paid_at: '2026-09-28T12:00:00Z', payment_note: 'virement 42' });
    expect(resultat.note).toMatch(/2 période\(s\) payée\(s\) pour Marc Roy/);
    const borne = await executer('get_payroll_history', { user_id: U1, limit: 1 });
    expect(borne.resultat.count).toBe(1);
  });

  it('membre d une autre entreprise ou identifiant invalide : refus en français, la route n est pas appelée', async () => {
    expect((await executer('get_payroll_history', { user_id: U3 })).resultat.error).toMatch(/introuvable dans cette entreprise/);
    expect((await executer('get_payroll_history', { user_id: 'marc' })).resultat.error).toMatch(/identifiant valide/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────

describe('list_time_entries', () => {
  it('entrées de l org seulement, heures à l heure de l entreprise, heures payées = calcul de la paie', async () => {
    const { resultat, appels } = await executer('list_time_entries', { from: '2026-09-16', to: '2026-09-16' });
    for (const a of appels) expect(filtreOrg(a), a.table).toBe(true);
    const lecture = appels.find((a) => a.table === 'time_entries')!;
    // Un jour de marge de chaque côté (la colonne `date` est en UTC), puis tri sur le jour local.
    expect(lecture.ops).toContainEqual(['gte', ['date', '2026-09-15']]);
    expect(lecture.ops).toContainEqual(['lte', ['date', '2026-09-17']]);
    expect(resultat.entries.map((e: any) => e.id).sort()).toEqual([E1, E4].sort()); // E3 est d'une autre entreprise
    const e1 = resultat.entries.find((e: any) => e.id === E1);
    expect(e1).toEqual({ id: E1, user_id: U1, name: 'Marc Roy', date: '2026-09-16', weekday: 'mercredi', clock_in_at: '2026-09-16T08:00', clock_out_at: '2026-09-16T16:00', hours: 7.5, open: false, approved: true, breaks: 1, notes: 'matin' });
    expect(resultat.note).toMatch(NOTE_FR);
  });

  it('open_only et user_id filtrent en base ; période par défaut = 7 derniers jours', async () => {
    const { resultat, appels } = await executer('list_time_entries', { user_id: U1, open_only: true });
    const lecture = appels.find((a) => a.table === 'time_entries')!;
    expect(lecture.ops).toContainEqual(['eq', ['employee_id', U1]]);
    expect(lecture.ops).toContainEqual(['is', ['punch_out', null]]);
    expect(resultat.entries).toHaveLength(1);
    expect(resultat.entries[0]).toMatchObject({ id: E2, open: true, clock_out_at: null, hours: 0 });
  });

  it('un technicien ne voit que SES entrées ; demander celles d un collègue est refusé', async () => {
    const { resultat, appels } = await executer('list_time_entries', { from: '2026-09-16', to: '2026-09-16' }, { role: 'technician' });
    expect(appels.find((a) => a.table === 'time_entries')!.ops).toContainEqual(['eq', ['employee_id', ME]]);
    expect(resultat.entries.map((e: any) => e.id)).toEqual([E4]);
    const refus = await executer('list_time_entries', { user_id: U1 }, { role: 'technician' });
    expect(refus.resultat.error).toMatch(/que tes propres entrées/);
    expect(refus.appels.some((a) => a.table === 'time_entries')).toBe(false);
  });

  it('dates invalides refusées', async () => {
    expect((await executer('list_time_entries', { from: 'hier' })).resultat.error).toMatch(/AAAA-MM-JJ/);
    expect((await executer('list_time_entries', { from: '2026-09-20', to: '2026-09-16' })).resultat.error).toMatch(/from doit précéder to/);
  });
});

describe('update_time_entry — écriture directe, comme l écran, horodatages compris', () => {
  it('corrige le départ : update sur id + org_id, heure affichée ET horodatage de paie, heures recalculées', async () => {
    const { resultat, appels, tables, ctx } = await executer('update_time_entry', { entry_id: E1, clock_out_at: '2026-09-16T17:00:00-04:00' });
    expect(executerIdempotent).toHaveBeenCalledWith(ctx, 'update_time_entry', expect.any(Object), expect.any(Function));
    for (const a of appels) expect(filtreOrg(a), a.table).toBe(true);
    const [maj] = ecritures(appels);
    expect(ecritures(appels)).toHaveLength(1);
    expect(maj.table).toBe('time_entries');
    expect(maj.ops).toContainEqual(['eq', ['id', E1]]);
    expect(chargeDe(maj)).toEqual({ punch_out_at: '2026-09-16T21:00:00.000Z', punch_out: '17:00:00' });
    expect(tables.time_entries.find((e) => e.id === E1)).toMatchObject({ punch_out: '17:00:00', punch_out_at: '2026-09-16T21:00:00.000Z', punch_in: '08:00:00' });
    expect(resultat).toMatchObject({ updated: true, entry_id: E1, user_id: U1, name: 'Marc Roy', clock_in_at: '2026-09-16T08:00', clock_out_at: '2026-09-16T17:00', hours: 8.5, previous: { clock_out_at: '2026-09-16T16:00', hours: 7.5 } });
    expect(resultat.note).toMatch(/Entrée de Marc Roy corrigée/);
    expect(resultat.note).toMatch(/déjà approuvées/);
    expect(appelInterne).not.toHaveBeenCalled();
  });

  it('une heure sans décalage est l heure de l ENTREPRISE ; changer de journée déplace la date', async () => {
    const naive = await executer('update_time_entry', { entry_id: E1, clock_in_at: '2026-09-16T07:30' });
    expect(chargeDe(ecritures(naive.appels)[0])).toEqual({ punch_in_at: '2026-09-16T11:30:00.000Z', punch_in: '07:30:00' });
    const nuit = await executer('update_time_entry', { entry_id: E1, clock_in_at: '2026-09-15T22:00', clock_out_at: '2026-09-16T06:00' });
    expect(chargeDe(ecritures(nuit.appels)[0])).toEqual({
      punch_in_at: '2026-09-16T02:00:00.000Z', punch_in: '22:00:00', date: '2026-09-15',
      punch_out_at: '2026-09-16T10:00:00.000Z', punch_out: '06:00:00',
    });
  });

  it('donner sa sortie à une entrée ouverte la termine et ferme la pause restée ouverte', async () => {
    const fin = ilYA(0.5);
    const { appels } = await executer('update_time_entry', { entry_id: E2, clock_out_at: fin });
    const charge = chargeDe(ecritures(appels)[0]);
    expect(charge).toMatchObject({ punch_out_at: fin, status: 'completed' });
    expect(charge.breaks).toEqual([{ start: '11:00:00', end: expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/) }]);
  });

  it('entrée d une autre entreprise ou inconnue : introuvable, aucune écriture', async () => {
    for (const entryId of [E3, id(999)]) {
      const tables = donnees('owner');
      const { client, appels } = base(tables);
      const appel = outil('update_time_entry').handler!({ entry_id: entryId, clock_out_at: '2026-09-16T17:00' }, { client, orgId: ORG, userId: ME, accessToken: 'jeton' });
      await expect(appel).rejects.toThrow(/introuvable dans cette entreprise/);
      expect(ecritures(appels)).toEqual([]);
      expect(tables.time_entries.find((e) => e.id === E3)?.punch_out_at).toBeNull();
    }
  });

  it('entrées invalides refusées AVANT toute lecture ou écriture', async () => {
    const cas: Array<[Record<string, any>, RegExp]> = [
      [{ entry_id: 'entrée-de-marc', clock_out_at: '2026-09-16T17:00' }, /identifiant valide/],
      [{ entry_id: E1 }, /Rien à changer/],
      [{ entry_id: E1, clock_out_at: '17h' }, /date-heure complète/],
      [{ entry_id: E1, clock_in_at: '2026-09-16' }, /date-heure complète/],
    ];
    for (const [args, motif] of cas) {
      const tables = donnees('owner');
      const { client, appels } = base(tables);
      await expect(outil('update_time_entry').handler!(args, { client, orgId: ORG, userId: ME, accessToken: 'jeton' })).rejects.toThrow(motif);
      expect(appels).toEqual([]);
    }
  });

  it('heures incohérentes refusées sans écriture : départ avant l arrivée, quart de plus de 24 h, futur, valeurs identiques', async () => {
    const cas: Array<[Record<string, any>, RegExp]> = [
      [{ entry_id: E1, clock_out_at: '2026-09-16T07:00' }, /départ doit suivre l.arrivée/],
      [{ entry_id: E1, clock_in_at: '2026-09-16T18:00' }, /départ doit suivre l.arrivée/],
      [{ entry_id: E1, clock_in_at: '2026-09-14T08:00' }, /plus de 24 heures/],
      [{ entry_id: E2, clock_out_at: new Date(Date.now() + 3_600_000).toISOString() }, /dans le futur/],
      [{ entry_id: E1, clock_out_at: '2026-09-16T16:00' }, /déjà ces heures/],
    ];
    for (const [args, motif] of cas) {
      const tables = donnees('owner');
      const { client, appels } = base(tables);
      await expect(outil('update_time_entry').handler!(args, { client, orgId: ORG, userId: ME, accessToken: 'jeton' })).rejects.toThrow(motif);
      expect(ecritures(appels), JSON.stringify(args)).toEqual([]);
    }
  });

  it('un admin ne corrige pas SES heures ; le propriétaire le peut ; un technicien ne corrige rien', async () => {
    await expect(executer('update_time_entry', { entry_id: E4, clock_out_at: '2026-09-16T18:00' }, { role: 'admin' })).rejects.toThrow(/pour toi-même : demande au propriétaire/);
    const proprio = await executer('update_time_entry', { entry_id: E4, clock_out_at: '2026-09-16T18:00' }, { role: 'owner' });
    expect(proprio.resultat.updated).toBe(true);
    const tables = donnees('technician');
    const { client, appels } = base(tables);
    await expect(outil('update_time_entry').handler!({ entry_id: E1, clock_out_at: '2026-09-16T17:00' }, { client, orgId: ORG, userId: ME, accessToken: 'jeton' }))
      .rejects.toThrow(/réservé aux administrateurs et propriétaires/);
    expect(appels.map((a) => a.table)).toEqual(['memberships']); // refusé avant même de lire l'entrée
  });

  it('une écriture que la RLS filtre (zéro ligne) n est jamais annoncée comme faite', async () => {
    await expect(executer('update_time_entry', { entry_id: E1, clock_out_at: '2026-09-16T17:00' }, { ecrituresMuettes: true })).rejects.toThrow(/n'a rien changé/);
  });
});

describe('delete_time_entry', () => {
  it('supprime sur id + org_id, comme l écran ; la ligne part vraiment et le résultat le dit définitif', async () => {
    const { resultat, appels, tables } = await executer('delete_time_entry', { entry_id: E1 });
    for (const a of appels) expect(filtreOrg(a), a.table).toBe(true);
    const [suppression] = ecritures(appels);
    expect(ecritures(appels)).toHaveLength(1);
    expect(suppression.table).toBe('time_entries');
    expect(verbe(suppression)).toBe('delete');
    expect(suppression.ops).toContainEqual(['eq', ['id', E1]]);
    expect(tables.time_entries.some((e) => e.id === E1)).toBe(false);
    expect(tables.time_entries).toHaveLength(3); // rien d'autre n'est parti
    expect(resultat).toMatchObject({ deleted: true, entry_id: E1, name: 'Marc Roy', hours: 7.5 });
    expect(resultat.note).toMatch(/supprimée définitivement \(7\.5 h\) — elle ne se récupère pas/);
  });

  it('autre entreprise, identifiant invalide, soi-même, technicien : refusés, rien n est supprimé', async () => {
    const cas: Array<[string, string, RegExp]> = [
      [E3, 'owner', /introuvable dans cette entreprise/],
      ['pas-un-id', 'owner', /identifiant valide/],
      [E4, 'admin', /pour toi-même/],
      [E1, 'technician', /réservé aux administrateurs/],
    ];
    for (const [entryId, role, motif] of cas) {
      const tables = donnees(role);
      const { client, appels } = base(tables);
      await expect(outil('delete_time_entry').handler!({ entry_id: entryId }, { client, orgId: ORG, userId: ME, accessToken: 'jeton' })).rejects.toThrow(motif);
      expect(ecritures(appels)).toEqual([]);
      expect(tables.time_entries).toHaveLength(4);
    }
    await expect(executer('delete_time_entry', { entry_id: E1 }, { ecrituresMuettes: true })).rejects.toThrow(/n'a rien changé/);
  });
});

describe('force_punch_out', () => {
  it('par user_id : retrouve LE pointage ouvert du membre et le ferme maintenant (mêmes colonnes que l écran + la pause)', async () => {
    const avant = Date.now();
    const { resultat, appels } = await executer('force_punch_out', { user_id: U1 });
    for (const a of appels) expect(filtreOrg(a), a.table).toBe(true);
    const recherche = appels.find((a) => a.table === 'time_entries' && verbe(a) === 'select')!;
    expect(recherche.ops).toContainEqual(['eq', ['employee_id', U1]]);
    expect(recherche.ops).toContainEqual(['is', ['punch_out', null]]);
    const [maj] = ecritures(appels);
    expect(maj.ops).toContainEqual(['eq', ['id', E2]]);
    expect(maj.ops).toContainEqual(['is', ['punch_out', null]]); // jamais par-dessus une sortie pointée entre-temps
    const charge = chargeDe(maj);
    expect(Object.keys(charge).sort()).toEqual(['breaks', 'punch_out', 'punch_out_at', 'status']);
    expect(charge.status).toBe('completed');
    expect(charge.punch_out).toMatch(/^\d{2}:\d{2}:00$/);
    expect(Date.parse(charge.punch_out_at)).toBeGreaterThanOrEqual(avant);
    expect(Date.parse(charge.punch_out_at)).toBeLessThanOrEqual(Date.now());
    expect(charge.breaks[0].end).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(resultat).toMatchObject({ punched_out: true, entry_id: E2, user_id: U1, name: 'Marc Roy' });
    expect(resultat.note).toMatch(/Pointage de Marc Roy fermé à/);
    expect(resultat.note).toMatch(/pause restée ouverte a été fermée/);
  });

  it('par entry_id avec l heure réelle de fin ; un quart très long est signalé', async () => {
    const ouvert = (t: Record<string, Ligne[]>) => { Object.assign(t.time_entries.find((e) => e.id === E2)!, { date: '2026-09-16', punch_in_at: '2026-09-16T12:00:00.000Z', breaks: [] }); };
    const { resultat, appels } = await executer('force_punch_out', { entry_id: E2, clock_out_at: '2026-09-16T16:30' }, { prepare: ouvert });
    expect(chargeDe(ecritures(appels)[0])).toEqual({ punch_out: '16:30:00', punch_out_at: '2026-09-16T20:30:00.000Z', status: 'completed' });
    expect(resultat).toMatchObject({ clock_in_at: '2026-09-16T08:00', clock_out_at: '2026-09-16T16:30', hours: 8.5 });
    const long = await executer('force_punch_out', { entry_id: E2, clock_out_at: '2026-09-17T06:00' }, { prepare: ouvert });
    expect(long.resultat.note).toMatch(/c’est long/);
  });

  it('refus sans écriture : aucun identifiant, membre d ailleurs, rien d ouvert, déjà fermé, deux pointages ouverts, départ avant l arrivée', async () => {
    const deuxOuverts = (t: Record<string, Ligne[]>) => { t.time_entries.push({ ...t.time_entries.find((e) => e.id === E2)!, id: E5, date: '2026-09-20' }); };
    const cas: Array<[Record<string, any>, RegExp, ((t: Record<string, Ligne[]>) => void)?]> = [
      [{}, /Précise entry_id ou user_id/],
      [{ user_id: U3 }, /introuvable dans cette entreprise/],
      [{ entry_id: E3 }, /introuvable dans cette entreprise/],
      [{ user_id: U2 }, /Zoé Lambert n’a aucun pointage ouvert/],
      [{ entry_id: E1 }, /déjà fermé/],
      [{ entry_id: E2, user_id: U2 }, /n’appartient pas à ce membre/],
      [{ user_id: U1 }, /2 pointages ouverts .* précise entry_id/, deuxOuverts],
      [{ entry_id: E2, clock_out_at: '2026-01-01T08:00' }, /départ doit suivre l.arrivée/],
      [{ entry_id: E2, clock_out_at: 'ce soir' }, /date-heure complète/],
    ];
    for (const [args, motif, prepare] of cas) {
      const tables = donnees('owner');
      prepare?.(tables);
      const { client, appels } = base(tables);
      await expect(outil('force_punch_out').handler!(args, { client, orgId: ORG, userId: ME, accessToken: 'jeton' }), JSON.stringify(args)).rejects.toThrow(motif);
      expect(ecritures(appels), JSON.stringify(args)).toEqual([]);
    }
  });

  it('un admin ne ferme pas SON pointage par ce chemin ; un technicien ne ferme celui de personne', async () => {
    const monPointage = (t: Record<string, Ligne[]>) => { Object.assign(t.time_entries.find((e) => e.id === E4)!, { punch_out: null, punch_out_at: null, status: 'active' }); };
    await expect(executer('force_punch_out', { entry_id: E4 }, { role: 'admin', prepare: monPointage })).rejects.toThrow(/pour toi-même/);
    await expect(executer('force_punch_out', { user_id: U1 }, { role: 'technician' })).rejects.toThrow(/réservé aux administrateurs/);
    const proprio = await executer('force_punch_out', { entry_id: E4 }, { role: 'owner', prepare: monPointage });
    expect(proprio.resultat.punched_out).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────

describe('list_commissions — GET /commissions', () => {
  const lignes = [
    { id: C1, user_id: U2, status: 'pending', amount: 125.5, base_amount: 1255, invoice_id: 'inv-1', triggered_at: '2026-09-17T02:30:00Z', rep_name: 'Zoé Lambert', rule_name: 'Plan 10 %', invoice_number: 'INV-000017', job_number: 'J-33', client_name: 'Sophie Tremblay', is_estimate: false, paid_at: null, calc_breakdown: { gros: 'objet' } },
    { id: C6, user_id: U2, status: 'paid', amount: 70, base_amount: 700, invoice_id: 'inv-6', triggered_at: '2026-09-10T15:00:00Z', rep_name: 'Zoé Lambert', rule_name: 'Plan 10 %', invoice_number: 'INV-000012', job_number: null, client_name: 'Marc Gagnon', is_estimate: false, paid_at: '2026-09-28T12:00:00Z' },
    { id: C3, user_id: U2, status: 'pending', amount: 40, base_amount: 400, invoice_id: null, triggered_at: '2026-09-20T15:00:00Z', rep_name: 'Zoé Lambert', rule_name: 'Plan 10 %', invoice_number: null, job_number: 'J-40', client_name: 'Nadia Gauthier', is_estimate: true, paid_at: null },
  ];

  it('mêmes paramètres que la page (userId, status, from, to), montants en cents, totaux de la paie', async () => {
    getOk(lignes);
    const { resultat, appels } = await executer('list_commissions', { status: 'pending', user_id: U2, from: '2026-09-01', to: '2026-09-30' });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/commissions');
    expect(Object.fromEntries(url.searchParams)).toEqual({ userId: U2, status: 'pending', from: '2026-09-01', to: '2026-09-30' });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer jeton', 'x-org-id': ORG });
    for (const a of appels) expect(filtreOrg(a), a.table).toBe(true);
    expect(resultat.totals).toEqual({ owed_cents: 19550, pending_cents: 12550, approved_cents: 0, paid_cents: 7000, reversed_cents: 0, estimated_cents: 4000, sales: 2 });
    expect(resultat.commissions[0]).toEqual({
      id: C1, user_id: U2, rep: 'Zoé Lambert', statut: 'en attente', amount_cents: 12550, base_amount_cents: 125500,
      earned_on: '2026-09-16', // 02:30 UTC le 17 = le 16 au soir à l'heure de l'entreprise
      invoice_number: 'INV-000017', job_number: 'J-33', client: 'Sophie Tremblay', plan: 'Plan 10 %',
    });
    expect(resultat.commissions[1]).toMatchObject({ statut: 'versée', paid_on: '2026-09-28' });
    expect(resultat.commissions[2].statut).toMatch(/^estimation/);
    expect(JSON.stringify(resultat)).not.toContain('calc_breakdown');
    expect(resultat.note).toMatch(/3 commission\(s\) : 195,50/);
  });

  it('sans filtre : aucune chaîne de requête ; limit borne la liste, pas les totaux', async () => {
    getOk(lignes);
    const { resultat } = await executer('list_commissions', { limit: 1 });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/commissions$/);
    expect(resultat).toMatchObject({ count: 3, returned: 1 });
    expect(resultat.totals.owed_cents).toBe(19550);
  });

  it('filtres invalides refusés avant l appel ; 403 traduit', async () => {
    expect(validerArgs(outil('list_commissions').declaration.parameters, { status: 'payée' }).ok).toBe(false);
    expect((await executer('list_commissions', { from: '2026-09-01' })).resultat.error).toMatch(/vont ensemble/);
    expect((await executer('list_commissions', { from: '2026-09-30', to: '2026-09-01' })).resultat.error).toMatch(/from doit précéder to/);
    expect((await executer('list_commissions', { user_id: 'zoé' })).resultat.error).toMatch(/identifiant valide/);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(reponse({ error: 'Forbidden' }, 403));
    expect((await executer('list_commissions', {})).resultat.error).toMatch(/Ton rôle dans Lume ne permet pas la consultation des commissions/);
  });
});

describe('approve_commission et mark_commission_paid — les routes de la page Commissions', () => {
  const CAS = [
    { outil: 'approve_commission', id: C1, chemin: `/commissions/${C1}/approve`, json: { id: C1, status: 'approved', amount: 125.5, user_id: U2 }, attendu: { approved: true, amount_cents: 12550 }, note: /Commission de Zoé Lambert approuvée \(125,50/ },
    { outil: 'mark_commission_paid', id: C2, chemin: `/commissions/${C2}/mark-paid`, json: { id: C2, status: 'paid', amount: 80, user_id: U2, paid_at: '2026-09-30T15:00:00Z' }, attendu: { paid: true, amount_cents: 8000, paid_at: '2026-09-30T15:00:00Z' }, note: /Commission de Zoé Lambert marquée versée \(80,00/ },
  ];

  for (const cas of CAS) {
    it(`${cas.outil} → POST /api${cas.chemin.replace(cas.id, ':id')}, sans écriture directe`, async () => {
      routeOk(cas.json);
      const { resultat, appels, ctx } = await executer(cas.outil, { commission_id: cas.id });
      expect(appelInterne).toHaveBeenCalledTimes(1);
      expect(appelInterne).toHaveBeenCalledWith(ctx, cas.chemin, {});
      expect(executerIdempotent).toHaveBeenCalledWith(ctx, cas.outil, expect.any(Object), expect.any(Function));
      // Le client de l'utilisateur ne sert qu'à LIRE (la commission, le nom) : la route écrit.
      expect(ecritures(appels)).toEqual([]);
      for (const a of appels) expect(filtreOrg(a), a.table).toBe(true);
      const lecture = appels.find((a) => a.table === 'fs_commission_entries')!;
      expect(lecture.ops).toContainEqual(['eq', ['id', cas.id]]);
      expect(lecture.ops).toContainEqual(['is', ['deleted_at', null]]);
      expect(resultat).toMatchObject({ commission_id: cas.id, user_id: U2, name: 'Zoé Lambert', ...cas.attendu });
      expect(resultat.note).toMatch(cas.note);
    });
  }

  it('introuvable, autre entreprise, supprimée, identifiant invalide : refus en français, la route n est pas appelée', async () => {
    for (const outilNom of ['approve_commission', 'mark_commission_paid']) {
      for (const commissionId of [id(998), C4, C7]) {
        await expect(executer(outilNom, { commission_id: commissionId })).rejects.toThrow(/introuvable dans cette entreprise/);
      }
      await expect(executer(outilNom, { commission_id: 'la dernière' })).rejects.toThrow(/identifiant valide/);
    }
    expect(appelInterne).not.toHaveBeenCalled();
  });

  it('mauvais statut refusé avant la route : estimation, déjà approuvée, pas encore approuvée, déjà versée', async () => {
    await expect(executer('approve_commission', { commission_id: C3 })).rejects.toThrow(/estimation .* ne s’approuve pas/);
    await expect(executer('approve_commission', { commission_id: C2 })).rejects.toThrow(/est approuvée — seule une commission en attente/);
    await expect(executer('mark_commission_paid', { commission_id: C1 })).rejects.toThrow(/approuve-la d’abord/);
    await expect(executer('mark_commission_paid', { commission_id: C6 })).rejects.toThrow(/est versée — seule une commission approuvée/);
    expect(appelInterne).not.toHaveBeenCalled();
  });

  it('personne n approuve ni ne verse SA commission, sauf le propriétaire', async () => {
    const maCommissionEnAttente = (t: Record<string, Ligne[]>) => { t.fs_commission_entries.find((c) => c.id === C5)!.status = 'pending'; };
    await expect(executer('approve_commission', { commission_id: C5 }, { role: 'admin', prepare: maCommissionEnAttente })).rejects.toThrow(/ta propre commission pour toi-même/);
    await expect(executer('mark_commission_paid', { commission_id: C5 }, { role: 'admin' })).rejects.toThrow(/ta propre commission pour toi-même/);
    await expect(executer('mark_commission_paid', { commission_id: C5 }, { role: 'sales_rep' })).rejects.toThrow(/pour toi-même/);
    expect(appelInterne).not.toHaveBeenCalled();
    routeOk({ amount: 60, paid_at: '2026-09-30T15:00:00Z' });
    const proprio = await executer('mark_commission_paid', { commission_id: C5 }, { role: 'owner' });
    expect(proprio.resultat).toMatchObject({ paid: true, amount_cents: 6000 });
  });

  it('refus de la route : rôle (403) et période de paie déjà versée (409) restent des phrases d exploitant', async () => {
    vi.mocked(appelInterne).mockResolvedValue({ ok: false, status: 403, json: { error: 'Only owners and admins can manage commission rules.' } });
    await expect(executer('approve_commission', { commission_id: C1 })).rejects.toThrow(/Ton rôle dans Lume ne permet pas l'approbation de la commission de Zoé Lambert/);
    vi.mocked(appelInterne).mockResolvedValue({ ok: false, status: 409, json: { error: 'Période de paie déjà versée (du 2026-09-14 au 2026-09-27) : cette commission est verrouillée.', code: 'periode_verrouillee' } });
    await expect(executer('mark_commission_paid', { commission_id: C2 })).rejects.toThrow(/le versement de la commission de Zoé Lambert : Période de paie déjà versée/);
  });

  it('réponse jamais revenue → « incertain » SANS lever : l empreinte est gardée, pas de second versement', async () => {
    vi.mocked(appelInterne).mockRejectedValue(new AppelInterneIncertain('timeout'));
    const { resultat } = await executer('mark_commission_paid', { commission_id: C2 });
    expect(resultat.incertain).toBe(true);
    expect(resultat.note).toMatch(/PEUT-ÊTRE fait/);
    expect(appelInterne).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────

describe('get_team_schedule — qui travaille, qui est absent', () => {
  it('même résolution que la grille : récurrence, assignation du jour, congé approuvé qui remplace ou rogne', async () => {
    const { resultat, appels } = await executer('get_team_schedule', { date: '2026-10-06' });
    for (const a of appels) expect(filtreOrg(a), `${a.table} sans org_id`).toBe(true);
    // memberships : le rôle du demandeur, la composition des équipes, les noms.
    expect(appels.map((a) => a.table).sort()).toEqual(['company_settings', 'memberships', 'memberships', 'memberships', 'recurring_team_schedules', 'schedule_events', 'team_schedule_assignments', 'teams', 'time_off_requests']);
    const recurrences = appels.find((a) => a.table === 'recurring_team_schedules')!;
    expect(recurrences.ops).toContainEqual(['in', ['day_of_week', [2]]]);
    expect(resultat.job_visits).toBeUndefined(); // aucune visite ce jour-là : rien d'ajouté à la réponse
    expect(recurrences.ops).toContainEqual(['eq', ['is_active', true]]);
    expect(appels.find((a) => a.table === 'time_off_requests')!.ops).toContainEqual(['in', ['status', ['pending', 'approved']]]);

    expect(resultat).toMatchObject({ date: '2026-10-06', jour: 'mardi', working_count: 2 });
    // Marc : récurrence 8 h–17 h, rognée par son congé de l'après-midi. Moi : assignation du jour, demande en attente.
    expect(resultat.working).toEqual([
      { user_id: U1, name: 'Marc Roy', team_id: T1, team: 'Alpha', start_time: '08:00', end_time: '13:00', partial_time_off: true },
      { user_id: ME, name: 'Moi Même', team_id: T2, team: 'Bravo', start_time: '09:00', end_time: '15:00', pending_time_off: true, note: 'renfort' },
    ]);
    // Zoé : vacances toute la journée → absente, hors de la liste au travail. La série terminée en juin ne compte plus.
    expect(resultat.off).toEqual([
      { user_id: U2, name: 'Zoé Lambert', type: 'vacances', all_day: true, from: '2026-10-05', to: '2026-10-09', reason: 'voyage' },
      { user_id: U1, name: 'Marc Roy', type: 'maladie', all_day: false, start_time: '13:00', end_time: '17:00', from: '2026-10-06', to: '2026-10-06', reason: 'dentiste' },
    ]);
    expect(resultat.pending_requests).toEqual([{ user_id: ME, name: 'Moi Même', type: 'congé', all_day: true, from: '2026-10-06', to: '2026-10-06' }]);
    // Rien de l'autre entreprise.
    expect(JSON.stringify(resultat)).not.toMatch(/Étranger|secret|Ailleurs/);
    expect(resultat.note).toMatch(/Le mardi 2026-10-06 : 2 personne\(s\) à l’horaire, 2 absente\(s\), 1 demande\(s\) de congé en attente/);
  });

  it('le motif d une absence ne va qu aux gestionnaires', async () => {
    const { resultat } = await executer('get_team_schedule', { date: '2026-10-06' }, { role: 'technician' });
    expect(resultat.off).toHaveLength(2);
    expect(JSON.stringify(resultat.off)).not.toMatch(/voyage|dentiste/);
  });

  it('une ligne « retirée » masque l occurrence récurrente ; « indisponible » compte comme absent', async () => {
    const { resultat } = await executer('get_team_schedule', { date: '2026-10-06' }, {
      prepare: (t) => {
        t.time_off_requests.length = 0;
        t.team_schedule_assignments.push(
          { id: id(23), org_id: ORG, team_id: T1, user_id: U1, work_date: '2026-10-06', start_time: '08:00:00', end_time: '17:00:00', availability_status: 'removed', note: null, recurring_schedule_id: id(31) },
          { id: id(24), org_id: ORG, team_id: T1, user_id: U2, work_date: '2026-10-06', start_time: '08:00:00', end_time: '17:00:00', availability_status: 'unavailable', note: 'formation', recurring_schedule_id: null },
        );
      },
    });
    expect(resultat.working.map((p: any) => p.name)).toEqual(['Moi Même']);
    expect(resultat.off).toEqual([{ user_id: U2, name: 'Zoé Lambert', type: 'indisponible', all_day: true, from: '2026-10-06', to: '2026-10-06', note: 'formation' }]);
  });

  it('team_id ne garde que cette équipe ; une équipe d ailleurs ou une date invalide est refusée ; jour vide dit pourquoi', async () => {
    const alpha = await executer('get_team_schedule', { date: '2026-10-06', team_id: T1 });
    expect(alpha.resultat.team).toBe('Alpha');
    expect(alpha.resultat.working.map((p: any) => p.name)).toEqual(['Marc Roy']);
    expect(alpha.resultat.pending_requests).toEqual([]); // la demande est celle d'un membre de Bravo
    expect((await executer('get_team_schedule', { date: '2026-10-06', team_id: id(90) })).resultat.error).toMatch(/Équipe introuvable dans cette entreprise/);
    expect((await executer('get_team_schedule', { date: 'mardi' })).resultat.error).toMatch(/AAAA-MM-JJ/);
    const vide = await executer('get_team_schedule', { date: '2026-10-04' }); // dimanche, rien de posé
    expect(vide.resultat).toMatchObject({ jour: 'dimanche', working: [], off: [], pending_requests: [] });
    expect(vide.resultat.note).toMatch(/Aucun horaire d’équipe ni congé posé/);
  });

  // Passe en prod du 2026-10-02 : « c koi l'horaire de la gang cette semaine » = sept appels, un par jour.
  it('une semaine en UN appel : chaque table lue une seule fois, un jour par ligne', async () => {
    const { resultat, appels } = await executer('get_team_schedule', { date: '2026-10-05', date_to: '2026-10-11' });
    for (const table of ['team_schedule_assignments', 'recurring_team_schedules', 'time_off_requests', 'schedule_events', 'teams']) {
      expect(appels.filter((a) => a.table === table), table).toHaveLength(1);
    }
    for (const a of appels) expect(filtreOrg(a), `${a.table} sans org_id`).toBe(true);
    expect(resultat).toMatchObject({ from: '2026-10-05', to: '2026-10-11' });
    expect(resultat.days.map((d: any) => d.jour)).toEqual(['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']);
    // Le mardi de la semaine = le même contenu que l'appel d'un seul jour.
    expect(resultat.days[1].working.map((p: any) => p.name)).toEqual(['Marc Roy', 'Moi Même']);
    expect(resultat.days[1].pending_requests).toHaveLength(1);
    // Zoé en vacances du 5 au 9 : absente du lundi au vendredi, pas la fin de semaine.
    expect(resultat.days.map((d: any) => !!d.off?.some((x: any) => x.name === 'Zoé Lambert'))).toEqual([true, true, true, true, true, false, false]);
    expect(resultat.days[0].note).toBeUndefined(); // une seule note, pour la période
    // Un jour sans horaire, congé ni visite tient en une ligne.
    expect(resultat.days[5]).toEqual({ date: '2026-10-10', jour: 'samedi', nothing_scheduled: true });
    expect(resultat.note).toMatch(/Du 2026-10-05 au 2026-10-11 : 1 jour\(s\) avec un horaire d’équipe posé, 0 jour\(s\) avec des visites de job/);
  });

  it('date_to avant date, ou plus de 14 jours : refusé avant toute lecture de l horaire', async () => {
    expect((await executer('get_team_schedule', { date: '2026-10-05', date_to: '2026-10-04' })).resultat.error).toMatch(/date_to doit être le même jour que date, ou un jour après/);
    const trop = await executer('get_team_schedule', { date: '2026-10-05', date_to: '2026-10-19' });
    expect(trop.resultat.error).toMatch(/Au plus 14 jours/);
    expect(trop.appels.some((a) => a.table === 'team_schedule_assignments')).toBe(false);
    expect((await executer('get_team_schedule', { date: '2026-10-05', date_to: '2026-10-18' })).resultat.days).toHaveLength(14);
  });

  // Prod, 2026-10-02 : la grille Horaire tient en 2 lignes pour tous les clients ; « ki travail demain »
  // répondait « personne » alors que des équipes avaient des visites.
  it('grille vide : « qui travaille » se lit sur les visites de jobs, par équipe avec ses membres', async () => {
    const visite = (team_id: string | null, start_at: string, plus: Ligne = {}) => ({ org_id: ORG, team_id, assigned_user: null, start_at, status: 'scheduled', deleted_at: null, ...plus });
    const { resultat } = await executer('get_team_schedule', { date: '2026-10-03' }, {
      prepare: (t) => {
        t.memberships[1].team_id = T1; // Marc et Zoé sont dans Alpha
        t.memberships[2].team_id = T1;
        t.memberships[3].team_id = id(90); // l'étranger, dans l'équipe d'ailleurs
        t.schedule_events = [
          visite(T1, '2026-10-03T13:00:00.000Z'), // 9 h à Toronto
          visite(T1, '2026-10-03T17:30:00.000Z'),
          visite(null, '2026-10-03T15:00:00.000Z'), // sans équipe
          visite(T2, '2026-10-04T03:00:00.000Z'), // 23 h le 3 à Toronto : compte pour le 3
          visite(T2, '2026-10-03T00:30:00.000Z'), // 20 h 30 le 2 à Toronto : PAS le 3
          visite(T2, '2026-10-03T14:00:00.000Z', { status: 'cancelled' }),
          visite(T1, '2026-10-03T16:00:00.000Z', { deleted_at: '2026-10-01T00:00:00Z' }),
          visite(id(90), '2026-10-03T13:00:00.000Z', { org_id: AUTRE }),
        ];
      },
    });
    expect(resultat).toMatchObject({ date: '2026-10-03', jour: 'samedi', working_count: 0, working: [], off: [] });
    expect(resultat.job_visits).toEqual({
      count: 4,
      teams: [
        { team_id: T1, team: 'Alpha', members: ['Marc Roy', 'Zoé Lambert'], visits: 2, first_at: '09:00' },
        { team_id: T2, team: 'Bravo', members: [], visits: 1, first_at: '23:00' },
      ],
      without_team: 1,
    });
    expect(resultat.note).toMatch(/la grille Horaire n’est pas remplie\), mais 4 visite\(s\) de job ce jour-là : ceux qui travaillent sont les équipes de job_visits ; 1 visite\(s\) sans équipe assignée/);
    expect(JSON.stringify(resultat)).not.toMatch(/Étranger|Ailleurs/);
  });

  it('team_id ne garde que les visites de cette équipe', async () => {
    const { resultat } = await executer('get_team_schedule', { date: '2026-10-03', team_id: T2 }, {
      prepare: (t) => {
        t.schedule_events = [
          { org_id: ORG, team_id: T1, assigned_user: null, start_at: '2026-10-03T13:00:00.000Z', status: 'scheduled', deleted_at: null },
          { org_id: ORG, team_id: T2, assigned_user: null, start_at: '2026-10-03T18:00:00.000Z', status: 'completed', deleted_at: null },
        ];
      },
    });
    expect(resultat.team).toBe('Bravo');
    expect(resultat.job_visits).toMatchObject({ count: 1, teams: [{ team: 'Bravo', visits: 1, first_at: '14:00' }], without_team: 0 });
  });

  it('sans date : aujourd hui, au fuseau de l entreprise (lu avec org_id)', async () => {
    const { resultat, appels } = await executer('get_team_schedule', {});
    expect(resultat.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const reglages = appels.find((a) => a.table === 'company_settings')!;
    expect(filtreOrg(reglages)).toBe(true);
  });
});

describe('list_time_entries : le jour de la semaine est donné, pas deviné', () => {
  it('chaque entrée porte son jour, calculé sur la date locale', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../server/lib/agent/tools-lot-paie.ts'), 'utf8');
    // Vu en prod le 2026-10-01 : sans ce champ, Lumi écrivait « lundi 24 septembre » pour un jeudi.
    expect(source).toContain('weekday: JOURS_FR[new Date(`${jourLocal}T00:00:00Z`).getUTCDay()]');
    const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    expect(jours[new Date('2026-09-24T00:00:00Z').getUTCDay()]).toBe('jeudi');
    expect(jours[new Date('2026-09-29T00:00:00Z').getUTCDay()]).toBe('mardi');
  });
});
