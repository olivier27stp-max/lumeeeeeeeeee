/**
 * Lumi — lot ENTREPRISE, AUTOMATISATIONS et STATISTIQUES
 * (server/lib/agent/tools-lot-entreprise.ts).
 *
 * Le module n'est pas encore branché dans outils-domaines.ts : il est importé
 * directement. Tout est simulé — une base en mémoire dont les filtres eq/is
 * s'appliquent POUR VRAI (une fiche d'une autre entreprise est donc réellement
 * invisible), `appelInterne` espionné pour les routes POST/PATCH, et `fetch`
 * remplacé pour les routes GET/DELETE. Aucun serveur, aucune base, aucun envoi.
 *
 * Par outil : le bon chemin (route ou table, filtre org) ; introuvable ou autre
 * entreprise = refus en français ; entrée invalide = refus AVANT toute
 * écriture ; une automatisation copiée ou tirée d'un modèle finit inactive.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// appelInterne simulé (aucun serveur) ; executerIdempotent réduit à « exécute
// l'action » (l'empreinte est testée dans lumi-registre) — une erreur devient
// { error }, comme en vrai. Le reste du module (dates, champRequis…) est réel.
vi.mock('../server/lib/agent/tools-etendus', async (importActual) => {
  const reel = await importActual<typeof import('../server/lib/agent/tools-etendus')>();
  return {
    ...reel,
    appelInterne: vi.fn(),
    executerIdempotent: vi.fn(async (_ctx: unknown, _outil: string, _args: unknown, action: () => Promise<Record<string, any>>) => {
      try { return await action(); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    }),
  };
});

import { validerArgs } from '../server/lib/agent/validation-args';
import { PERMISSION_KEYS } from '../src/lib/permissions';
import { TOPICS_PAR_ID } from '../server/lib/lumi/topics';
import { TOOLS_BY_NAME } from '../server/lib/agent/tools';
import { CLES_MONTANTS } from '../server/lib/agent/garde';
import { MODELES_AUTOMATISATION } from '../server/lib/automationTemplates';
import { appelInterne, executerIdempotent, AppelInterneIncertain, bornesJourOrg } from '../server/lib/agent/tools-etendus';
import {
  OUTILS_LOT_ENTREPRISE, REGISTRE_LOT_ENTREPRISE, PERMISSIONS_LOT_ENTREPRISE, TOPICS_LOT_ENTREPRISE,
} from '../server/lib/agent/tools-lot-entreprise';

const ORG = '11111111-1111-4111-8111-111111111111';
const AUTRE_ORG = '22222222-2222-4222-8222-222222222222';
const USER = '99999999-9999-4999-8999-999999999999';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Ligne = Record<string, unknown>;
interface Op { table: string; op: string; args: any[] }

const appel = vi.mocked(appelInterne);
const idempotent = vi.mocked(executerIdempotent);
const fauxFetch = vi.fn();

/**
 * Une base en mémoire. Les filtres eq/is s'appliquent pour vrai, update modifie
 * les lignes retenues, upsert/insert en ajoutent une. `refuseEcriture` imite la
 * RLS : l'écriture « réussit » sans toucher aucune ligne.
 */
function base(
  tables: Record<string, Ligne[]> = {},
  options: { rpc?: Record<string, { data?: unknown; error?: { code?: string; message: string } | null }>; refuseEcriture?: string[]; sansSession?: boolean } = {},
) {
  const ops: Op[] = [];
  const requetes: Array<{ table: string; ops: Op[] }> = [];
  const rpcAppels: Array<{ nom: string; args: Record<string, unknown> }> = [];
  const from = (table: string) => {
    const toutes = tables[table] ?? (tables[table] = []);
    const filtres: Array<(l: Ligne) => boolean> = [];
    let mode: 'select' | 'update' | 'ajout' = 'select';
    let charge: Ligne = {};
    const requete = { table, ops: [] as Op[] };
    requetes.push(requete);
    const note = (op: string, args: any[]) => { const o = { table, op, args }; ops.push(o); requete.ops.push(o); };
    const executer = (): Ligne[] => {
      const refuse = (options.refuseEcriture ?? []).includes(table);
      if (mode === 'ajout') {
        if (refuse) return [];
        const ligne = { id: id(900 + toutes.length), ...charge };
        toutes.push(ligne);
        return [ligne];
      }
      const cibles = toutes.filter((l) => filtres.every((f) => f(l)));
      if (mode === 'update') {
        if (refuse) return [];
        for (const l of cibles) Object.assign(l, charge);
      }
      return cibles;
    };
    const q: any = {
      select: (...a: any[]) => { note('select', a); return q; },
      update: (c: Ligne) => { mode = 'update'; charge = c; note('update', [c]); return q; },
      upsert: (c: Ligne, o: unknown) => { mode = 'ajout'; charge = c; note('upsert', [c, o]); return q; },
      insert: (c: Ligne) => { mode = 'ajout'; charge = c; note('insert', [c]); return q; },
      eq: (col: string, v: unknown) => { filtres.push((l) => l[col] === v); note('eq', [col, v]); return q; },
      is: (col: string, v: unknown) => { filtres.push((l) => (l[col] ?? null) === v); note('is', [col, v]); return q; },
      limit: (n: number) => { note('limit', [n]); return q; },
      maybeSingle: async () => ({ data: executer()[0] ?? null, error: null }),
      then: (ok: (r: { data: Ligne[]; error: null }) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: executer(), error: null }).then(ok, ko),
    };
    return q;
  };
  const rpc = vi.fn(async (nom: string, args: Record<string, unknown>) => {
    rpcAppels.push({ nom, args });
    return { data: null, error: null, ...(options.rpc?.[nom] ?? { error: { message: 'fonction non préparée' } }) };
  });
  const ctx = { client: { from, rpc } as any, orgId: ORG, userId: USER, ...(options.sansSession ? {} : { accessToken: 'jeton' }) };
  return { ctx, ops, requetes, rpcAppels, tables };
}

const OUTIL = Object.fromEntries(OUTILS_LOT_ENTREPRISE.map((t) => [t.declaration.name, t]));
const TOUS = OUTILS_LOT_ENTREPRISE.map((t) => t.declaration.name);
const ECRITURES = OUTILS_LOT_ENTREPRISE.filter((t) => t.kind === 'write').map((t) => t.declaration.name);
const lancer = (nom: string, args: Record<string, any>, b: ReturnType<typeof base>) => OUTIL[nom].handler!(args, b.ctx);

const reponse = (status: number, json: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
const accentue = (s: unknown) => typeof s === 'string' && /[àâçéèêëîïôûùü’]/.test(s);
/** CHAQUE requête sur la table porte eq(colonne, ORG) — ou ajoute une ligne dont la colonne vaut ORG. */
function filtreOrg(b: { requetes: Array<{ table: string; ops: Op[] }> }, table: string, colonne = 'org_id'): boolean {
  const requetes = b.requetes.filter((r) => r.table === table);
  return requetes.length > 0 && requetes.every((r) => r.ops.some((o) =>
    (o.op === 'eq' && o.args[0] === colonne && o.args[1] === ORG)
    || ((o.op === 'upsert' || o.op === 'insert') && o.args[0]?.[colonne] === ORG)));
}

const regles = () => ({
  automation_rules: [
    { id: id(1), org_id: ORG, name: 'Relance de devis', is_active: true, is_preset: false, deleted_at: null },
    { id: id(2), org_id: AUTRE_ORG, name: 'Chez le voisin', is_active: true, is_preset: false, deleted_at: null },
    { id: id(3), org_id: ORG, name: 'À la corbeille', is_active: false, is_preset: false, deleted_at: '2026-09-01T00:00:00Z' },
    { id: id(4), org_id: ORG, name: 'Rappel fourni', is_active: true, is_preset: true, deleted_at: null },
  ] as Ligne[],
});

beforeEach(() => {
  appel.mockReset();
  appel.mockResolvedValue({ ok: true, status: 200, json: {} });
  idempotent.mockClear();
  fauxFetch.mockReset();
  vi.stubGlobal('fetch', fauxFetch);
});
afterAll(() => { vi.unstubAllGlobals(); });

/* ── 1. Manifestes et déclarations ───────────────────────────── */

describe('manifestes', () => {
  it('12 outils, noms uniques ; un nom déjà enregistré ailleurs ne peut être que le nôtre', () => {
    expect(TOUS.length).toBe(12);
    expect(new Set(TOUS).size).toBe(TOUS.length);
    // Avant le branchement : aucun de ces noms n'existe. Après : c'est le même objet.
    for (const n of TOUS) if (TOOLS_BY_NAME[n]) expect(TOOLS_BY_NAME[n], `${n} existe déjà ailleurs`).toBe(OUTIL[n]);
    // Ce que le lot devait NE PAS refaire.
    for (const existant of ['get_company_info', 'toggle_automation_rule', 'update_automation_message', 'build_report', 'list_automations', 'get_tax_config']) {
      expect(TOUS).not.toContain(existant);
    }
  });

  it('REGISTRE = exactement les écritures ; aucune n’atteint un client', () => {
    expect(Object.keys(REGISTRE_LOT_ENTREPRISE).sort()).toEqual([...ECRITURES].sort());
    expect(ECRITURES.sort()).toEqual(['create_automation_from_template', 'delete_automation_rule', 'duplicate_automation_rule', 'pause_all_automations', 'rename_automation_rule', 'update_company_settings']);
    for (const [n, a] of Object.entries(REGISTRE_LOT_ENTREPRISE)) expect(a.vers_client, n).toBe(false);
    for (const n of ['update_company_settings', 'delete_automation_rule', 'pause_all_automations', 'create_automation_from_template']) expect(REGISTRE_LOT_ENTREPRISE[n].sensible, n).toBe(true);
  });

  it('PERMISSIONS = tous les outils, avec une clé réelle de la page Rôles', () => {
    expect(Object.keys(PERMISSIONS_LOT_ENTREPRISE).sort()).toEqual([...TOUS].sort());
    for (const [n, p] of Object.entries(PERMISSIONS_LOT_ENTREPRISE)) {
      expect((PERMISSION_KEYS as readonly string[]).includes(p.cle), `${n} → ${p.cle}`).toBe(true);
      expect(p.capacite.length, n).toBeGreaterThan(8);
    }
    for (const n of ECRITURES.filter((x) => x !== 'update_company_settings')) expect(PERMISSIONS_LOT_ENTREPRISE[n].cle, n).toBe('automations.update');
    expect(PERMISSIONS_LOT_ENTREPRISE.update_company_settings.cle).toBe('settings.update');
    expect(PERMISSIONS_LOT_ENTREPRISE.list_automation_templates.cle).toBe('automations.read');
  });

  it('TOPICS : chaque outil exactement une fois, sur un topic qui existe', () => {
    const cites: string[] = [];
    for (const [topic, outils] of Object.entries(TOPICS_LOT_ENTREPRISE)) {
      expect(TOPICS_PAR_ID.has(topic as any), `topic inconnu : ${topic}`).toBe(true);
      cites.push(...(outils ?? []));
    }
    expect(cites.sort()).toEqual([...TOUS].sort());
  });

  it('déclarations : anglais ASCII et court, écritures à identité, exemple minimal accepté', () => {
    for (const t of OUTILS_LOT_ENTREPRISE) {
      const n = t.declaration.name;
      expect(typeof t.handler, n).toBe('function');
      if (t.kind === 'write') expect(t.needsIdentity, n).toBe(true);
      expect(t.declaration.description, n).toMatch(/^[\x20-\x7E]+$/);
      expect(t.declaration.description.length, n).toBeGreaterThan(40);
      expect(t.declaration.description.length, n).toBeLessThanOrEqual(300);
      const p: any = t.declaration.parameters;
      for (const [k, s] of Object.entries(p.properties as Record<string, any>)) {
        expect(['string', 'integer', 'number', 'boolean'], `${n}.${k}`).toContain(s.type);
        if (s.description) expect(s.description, `${n}.${k}`).toMatch(/^[\x20-\x7E]+$/);
      }
      const exemple: Record<string, unknown> = {};
      for (const k of p.required ?? []) {
        const s = p.properties?.[k] ?? {};
        exemple[k] = s.type === 'integer' || s.type === 'number' ? 1 : s.type === 'boolean' ? true : (s.enum?.[0] ?? 'x');
      }
      const r = validerArgs(p, exemple);
      expect(r.ok, `${n} : ${(r as any).erreur ?? ''}`).toBe(true);
    }
  });

  it('les lectures de statistiques ont la même période que les rapports : from / to, facultatifs', () => {
    for (const n of ['get_taxes_collected', 'get_quote_win_rate', 'get_payment_methods_breakdown', 'get_team_performance', 'list_stripe_payouts']) {
      const p: any = OUTIL[n].declaration.parameters;
      expect(Object.keys(p.properties), n).toEqual(expect.arrayContaining(['from', 'to']));
      expect(p.required ?? [], n).toEqual([]);
      expect(OUTIL[n].kind, n).toBe('read');
    }
  });

  it('le module n’utilise jamais le client service_role, ni console.log', () => {
    const source = readFileSync(resolve(__dirname, '../server/lib/agent/tools-lot-entreprise.ts'), 'utf8');
    expect(source).not.toMatch(/getServiceClient|SERVICE_ROLE_KEY|from '\.\.\/supabase'/);
    expect(source).not.toMatch(/console\.log/);
  });
});

/* ── 2. Taxes perçues ────────────────────────────────────────── */

describe('get_taxes_collected', () => {
  const corps = { from: '2026-09-01', to: '2026-09-30', total_cents: 14975, configured: true, taxes: [{ name: 'TPS', rate: 5, cents: 5000, registration_number: '123456789 RT0001' }, { name: 'TVQ', rate: 9.975, cents: 9975, registration_number: null }] };

  it('appelle GET /taxes/collected avec la période, la session et l’entreprise', async () => {
    fauxFetch.mockResolvedValue(reponse(200, corps));
    const b = base();
    const r = await lancer('get_taxes_collected', { from: '2026-09-01', to: '2026-09-30' }, b);
    expect(fauxFetch).toHaveBeenCalledTimes(1);
    const [url, init] = fauxFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/taxes\/collected\?from=2026-09-01&to=2026-09-30$/);
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jeton', 'x-org-id': ORG });
    expect(r).toMatchObject({ periode: { du: '2026-09-01', au: '2026-09-30' }, total_tax_cents: 14975 });
    expect(r.taxes).toEqual([
      { name: 'TPS', rate: 5, tax_cents: 5000, registration_number: '123456789 RT0001' },
      { name: 'TVQ', rate: 9.975, tax_cents: 9975, registration_number: null },
    ]);
    expect(accentue(r.note)).toBe(true);
    expect(b.ops).toEqual([]); // aucune lecture directe en base
  });

  it('sans dates : du 1er du mois à aujourd’hui ; dates inversées remises dans l’ordre', async () => {
    fauxFetch.mockResolvedValue(reponse(200, { total_cents: 0, configured: false, taxes: [] }));
    const r = await lancer('get_taxes_collected', {}, base());
    expect(String(fauxFetch.mock.calls[0][0])).toMatch(/from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}$/);
    expect(r.periode.du.slice(0, 7)).toBe(r.periode.au.slice(0, 7));
    expect(r.note).toMatch(/Aucun groupe de taxes par défaut/);
    const inverse = await lancer('get_taxes_collected', { from: '2026-09-30', to: '2026-09-01' }, base());
    expect(inverse.periode).toEqual({ du: '2026-09-01', au: '2026-09-30' });
  });

  it('une date mal écrite est refusée sans appeler la route', async () => {
    for (const mauvaise of ['30 septembre', '2026-13-01', '2026-02-31']) {
      const r = await lancer('get_taxes_collected', { from: mauvaise }, base());
      expect(r.error, mauvaise).toMatch(/AAAA-MM-JJ/);
    }
    expect(fauxFetch).not.toHaveBeenCalled();
  });

  it('refus, session absente ou route muette : une phrase en français, jamais un chiffre', async () => {
    fauxFetch.mockResolvedValueOnce(reponse(403, { error: 'Forbidden' }));
    expect((await lancer('get_taxes_collected', {}, base())).error).toMatch(/Ton rôle dans Lume ne permet pas de consulter les taxes perçues/);
    fauxFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const muette = await lancer('get_taxes_collected', {}, base());
    expect(muette.error).toMatch(/pas répondu à temps/);
    expect(muette.total_tax_cents).toBeUndefined();
    fauxFetch.mockClear();
    expect((await lancer('get_taxes_collected', {}, base({}, { sansSession: true }))).error).toMatch(/session Lume/);
    expect(fauxFetch).not.toHaveBeenCalled();
  });
});

/* ── 3. Fiche de l'entreprise ────────────────────────────────── */

describe('update_company_settings', () => {
  const tables = () => ({
    company_settings: [
      { id: 'cs1', org_id: ORG, company_name: 'Ancien nom', phone: '418-555-0100', email: 'a@b.ca', website: '', street1: '', street2: '', city: 'Québec', province: 'QC', postal_code: '', country: 'Canada', weather_lat: 46.8, weather_lng: -71.2, revenue_goal_cents: 0 },
      { id: 'cs2', org_id: AUTRE_ORG, company_name: 'Voisin inc.', phone: '', city: 'Montréal', weather_lat: 45.5, weather_lng: -73.6, revenue_goal_cents: 100 },
    ] as Ligne[],
    orgs: [{ id: ORG, name: 'Ancien nom' }, { id: AUTRE_ORG, name: 'Voisin inc.' }] as Ligne[],
  });

  it('écrit SEULEMENT les champs donnés, filtré par org, et synchronise le nom de l’espace', async () => {
    const b = base(tables());
    const r = await lancer('update_company_settings', { company_name: ' Lavage Coquin ', website: 'www.coquin.ca', city: 'Lévis', revenue_goal_cents: 50000000 }, b);
    expect(r.error, JSON.stringify(r)).toBeUndefined();
    expect(r.updated).toBe(true);
    expect(r.champs_modifies.sort()).toEqual(['city', 'company_name', 'revenue_goal_cents', 'website']);
    const maj = b.ops.find((o) => o.table === 'company_settings' && o.op === 'update')!.args[0];
    expect(maj).toMatchObject({ company_name: 'Lavage Coquin', website: 'https://www.coquin.ca', city: 'Lévis', revenue_goal_cents: 50000000, weather_lat: null, weather_lng: null });
    expect(Object.keys(maj)).not.toEqual(expect.arrayContaining(['phone', 'email', 'org_id', 'logo_url', 'default_language']));
    expect(filtreOrg(b, 'company_settings')).toBe(true);
    // La fiche de l'entreprise, et elle seule.
    expect(b.tables.company_settings[0]).toMatchObject({ company_name: 'Lavage Coquin', phone: '418-555-0100', city: 'Lévis', weather_lat: null });
    expect(b.tables.company_settings[1]).toMatchObject({ company_name: 'Voisin inc.', city: 'Montréal', weather_lat: 45.5, revenue_goal_cents: 100 });
    expect(b.tables.orgs).toEqual([{ id: ORG, name: 'Lavage Coquin' }, { id: AUTRE_ORG, name: 'Voisin inc.' }]);
    expect(filtreOrg(b, 'orgs', 'id')).toBe(true);
    // Le montant porte un nom masquable par rôle.
    expect(r.entreprise.revenue_goal_cents).toBe(50000000);
    expect(CLES_MONTANTS.test('revenue_goal_cents')).toBe(true);
    expect(accentue(r.note)).toBe(true);
    expect(appel).not.toHaveBeenCalled();
    expect(fauxFetch).not.toHaveBeenCalled();
  });

  it('une ville inchangée garde ses coordonnées météo ; sans changement de nom, `orgs` n’est pas touchée', async () => {
    const b = base(tables());
    const r = await lancer('update_company_settings', { city: 'Québec', phone: '418-555-0199' }, b);
    expect(r.error).toBeUndefined();
    expect(b.tables.company_settings[0]).toMatchObject({ phone: '418-555-0199', weather_lat: 46.8 });
    expect(b.ops.some((o) => o.table === 'orgs')).toBe(false);
  });

  it('une entrée invalide est refusée AVANT toute lecture ou écriture', async () => {
    const cas: Array<[Record<string, any>, RegExp]> = [
      [{}, /Rien à modifier/],
      [{ email: 'pas-un-courriel' }, /courriel invalide/],
      [{ website: 'pas un site' }, /site web invalide/],
      [{ company_name: '   ' }, /ne peut pas être vide/],
      [{ phone: '5'.repeat(51) }, /trop long/],
      [{ revenue_goal_cents: -5 }, /objectif de revenus/],
      [{ revenue_goal_cents: 12.5 }, /objectif de revenus/],
      [{ revenue_goal_cents: 3_000_000_000 }, /objectif de revenus/],
    ];
    for (const [args, attendu] of cas) {
      const b = base(tables());
      const r = await lancer('update_company_settings', args, b);
      expect(r.error, JSON.stringify(args)).toMatch(attendu);
      expect(b.ops, JSON.stringify(args)).toEqual([]);
    }
  });

  it('un rôle que la RLS filtre (0 ligne) reçoit un refus, pas un faux succès', async () => {
    const b = base(tables(), { refuseEcriture: ['company_settings'] });
    const r = await lancer('update_company_settings', { company_name: 'Pirate inc.' }, b);
    expect(r.error).toMatch(/Seuls le propriétaire ou un administrateur/);
    expect(b.tables.company_settings[0].company_name).toBe('Ancien nom');
    expect(b.ops.some((o) => o.table === 'orgs')).toBe(false);
  });

  it('sans fiche : création sur org_id (jamais une 2e fiche), au nom de l’utilisateur', async () => {
    const b = base({ company_settings: [{ id: 'cs2', org_id: AUTRE_ORG, company_name: 'Voisin inc.' }], orgs: [{ id: ORG, name: 'x' }] });
    const r = await lancer('update_company_settings', { company_name: 'Nouvelle inc.' }, b);
    expect(r.error, JSON.stringify(r)).toBeUndefined();
    const [charge, opts] = b.ops.find((o) => o.op === 'upsert')!.args;
    expect(charge).toMatchObject({ org_id: ORG, created_by: USER, company_name: 'Nouvelle inc.' });
    expect(opts).toEqual({ onConflict: 'org_id' });
    expect(b.tables.company_settings[0].company_name).toBe('Voisin inc.');
  });

  it('nom de l’espace non synchronisé : la fiche est faite, on prévient sans échouer', async () => {
    const b = base(tables(), { refuseEcriture: ['orgs'] });
    const r = await lancer('update_company_settings', { company_name: 'Lavage Coquin' }, b);
    expect(r.updated).toBe(true);
    expect(r.warning).toMatch(/sélecteur d’entreprise/);
  });
});

/* ── 4. Automatisations ──────────────────────────────────────── */

describe('delete_automation_rule', () => {
  it('passe par DELETE /automations/rules/:id (la route annule les envois prévus)', async () => {
    fauxFetch.mockResolvedValue(reponse(200, { ok: true }));
    const b = base(regles());
    const r = await lancer('delete_automation_rule', { rule_id: id(1) }, b);
    expect(r).toMatchObject({ deleted: true, rule_id: id(1), name: 'Relance de devis', etait_active: true });
    expect(accentue(r.note)).toBe(true);
    const [url, init] = fauxFetch.mock.calls[0];
    expect(String(url)).toMatch(new RegExp(`/api/automations/rules/${id(1)}$`));
    expect(init.method).toBe('DELETE');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jeton', 'x-org-id': ORG });
    // La lecture préalable est bornée à l'entreprise et hors corbeille ; aucune écriture directe.
    expect(filtreOrg(b, 'automation_rules')).toBe(true);
    expect(b.ops.some((o) => o.op === 'is' && o.args[0] === 'deleted_at' && o.args[1] === null)).toBe(true);
    expect(b.ops.some((o) => ['update', 'insert', 'upsert'].includes(o.op))).toBe(false);
  });

  it('autre entreprise, corbeille, préréglage, identifiant fantaisiste : refus en français, route jamais appelée', async () => {
    const cas: Array<[string, RegExp]> = [
      [id(2), /introuvable dans cette entreprise/],
      [id(3), /introuvable dans cette entreprise/],
      [id(4), /fournie par Lume.*ne se supprime pas/],
      ['../../payments', /identifiant valide/],
      ['', /requis/],
    ];
    for (const [ruleId, attendu] of cas) {
      const r = await lancer('delete_automation_rule', { rule_id: ruleId }, base(regles()));
      expect(r.error, ruleId).toMatch(attendu);
    }
    expect(fauxFetch).not.toHaveBeenCalled();
  });

  it('refus de la route traduit ; réponse jamais revenue = incertain (pas de nouvelle tentative à l’aveugle)', async () => {
    fauxFetch.mockResolvedValueOnce(reponse(403, { error: 'Votre rôle ne permet pas de supprimer une automatisation.' }));
    expect((await lancer('delete_automation_rule', { rule_id: id(1) }, base(regles()))).error).toMatch(/Ton rôle dans Lume ne permet pas la suppression/);
    fauxFetch.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const r = await lancer('delete_automation_rule', { rule_id: id(1) }, base(regles()));
    expect(r.incertain).toBe(true);
    expect(r.deleted).toBeUndefined();
    expect(r.note).toMatch(/PEUT-ÊTRE/);
  });

  it('« déjà fait » ne vaut plus si la règle a été restaurée entre-temps', async () => {
    fauxFetch.mockResolvedValue(reponse(200, { ok: true }));
    const b = base(regles());
    await lancer('delete_automation_rule', { rule_id: id(1) }, b);
    const options = idempotent.mock.calls[0][4]!;
    expect(await options.encoreValable!({ rule_id: id(1) })).toBe(false); // toujours présente : la suppression est à refaire
    expect(await options.encoreValable!({ rule_id: id(3) })).toBe(true); // à la corbeille : c'est bien déjà fait
  });
});

describe('duplicate_automation_rule', () => {
  it('passe par POST /automations/rules/:id/duplicate et annonce un BROUILLON', async () => {
    appel.mockResolvedValue({ ok: true, status: 201, json: { id: id(50), name: 'Relance de devis (copie)', is_active: false } });
    const b = base(regles());
    const r = await lancer('duplicate_automation_rule', { rule_id: id(1) }, b);
    expect(appel).toHaveBeenCalledTimes(1);
    expect(appel.mock.calls[0].slice(1)).toEqual([`/automations/rules/${id(1)}/duplicate`, {}, 'POST']);
    expect(r).toMatchObject({ duplicated: true, rule_id: id(50), name: 'Relance de devis (copie)', copie_de: 'Relance de devis', is_active: false });
    expect(r.note).toMatch(/EN BROUILLON/);
    expect(r.warning).toBeUndefined();
    expect(filtreOrg(b, 'automation_rules')).toBe(true);
    expect(b.ops.some((o) => o.op === 'update')).toBe(false); // la route a déjà rendu un brouillon
  });

  it('si la route rendait une copie ACTIVE, l’outil l’éteint lui-même, dans l’entreprise', async () => {
    appel.mockResolvedValue({ ok: true, status: 201, json: { id: id(50), name: 'Relance de devis (copie)', is_active: true } });
    const tables = regles();
    tables.automation_rules.push({ id: id(50), org_id: ORG, name: 'Relance de devis (copie)', is_active: true, is_preset: false, deleted_at: null });
    const b = base(tables);
    const r = await lancer('duplicate_automation_rule', { rule_id: id(1) }, b);
    const maj = b.ops.find((o) => o.op === 'update')!;
    expect(maj.args[0]).toMatchObject({ is_active: false });
    expect(b.tables.automation_rules.find((l) => l.id === id(50))!.is_active).toBe(false);
    expect(b.tables.automation_rules.find((l) => l.id === id(1))!.is_active).toBe(true); // l'originale ne bouge pas
    expect(filtreOrg(b, 'automation_rules')).toBe(true);
    expect(r.is_active).toBe(false);
  });

  it('brouillon impossible à confirmer : l’outil le DIT au lieu d’annoncer « inactive »', async () => {
    appel.mockResolvedValue({ ok: true, status: 201, json: { id: id(50), name: 'Copie' } }); // pas de is_active dans la réponse
    const r = await lancer('duplicate_automation_rule', { rule_id: id(1) }, base(regles(), { refuseEcriture: ['automation_rules'] }));
    expect(r.is_active).toBeNull();
    expect(r.warning).toMatch(/pas pu confirmer/);
  });

  it('autre entreprise ou corbeille : refus, route jamais appelée ; route muette = incertain', async () => {
    for (const ruleId of [id(2), id(3), 'abc']) {
      const r = await lancer('duplicate_automation_rule', { rule_id: ruleId }, base(regles()));
      expect(r.error, ruleId).toMatch(/introuvable dans cette entreprise|identifiant valide/);
    }
    expect(appel).not.toHaveBeenCalled();
    appel.mockRejectedValueOnce(new AppelInterneIncertain('timeout'));
    const r = await lancer('duplicate_automation_rule', { rule_id: id(1) }, base(regles()));
    expect(r.incertain).toBe(true);
    expect(r.duplicated).toBeUndefined();
  });
});

describe('rename_automation_rule', () => {
  it('passe par PATCH /automations/rules/:id avec le nom SEUL (jamais is_active)', async () => {
    appel.mockResolvedValue({ ok: true, status: 200, json: { id: id(1), name: 'Relance 3 jours', is_active: true } });
    const b = base(regles());
    const r = await lancer('rename_automation_rule', { rule_id: id(1), name: '  Relance 3 jours ' }, b);
    expect(appel.mock.calls[0].slice(1)).toEqual([`/automations/rules/${id(1)}`, { name: 'Relance 3 jours' }, 'PATCH']);
    expect(r).toMatchObject({ updated: true, rule_id: id(1), name: 'Relance 3 jours', ancien_nom: 'Relance de devis' });
    expect(accentue(r.note)).toBe(true);
    expect(filtreOrg(b, 'automation_rules')).toBe(true);
    expect(b.ops.some((o) => o.op === 'update')).toBe(false);
  });

  it('nom vide, trop long ou identique, règle d’une autre entreprise : refus avant la route', async () => {
    const cas: Array<[Record<string, any>, RegExp]> = [
      [{ rule_id: id(1), name: '   ' }, /requis/],
      [{ rule_id: id(1), name: 'x'.repeat(121) }, /120 caractères/],
      [{ rule_id: id(1), name: 'Relance de devis' }, /s’appelle déjà/],
      [{ rule_id: id(2), name: 'Volé' }, /introuvable dans cette entreprise/],
      [{ rule_id: id(3), name: 'Fantôme' }, /introuvable dans cette entreprise/],
    ];
    for (const [args, attendu] of cas) expect((await lancer('rename_automation_rule', args, base(regles()))).error, JSON.stringify(args)).toMatch(attendu);
    expect(appel).not.toHaveBeenCalled();
  });

  it('le refus de la route garde son explication', async () => {
    appel.mockResolvedValue({ ok: false, status: 409, json: { error: 'Cette automatisation est à la corbeille : restaurez-la pour la modifier.' } });
    const r = await lancer('rename_automation_rule', { rule_id: id(1), name: 'Autre' }, base(regles()));
    expect(r.error).toMatch(/Lume a refusé le changement de nom.*corbeille/);
  });
});

describe('pause_all_automations', () => {
  it('par défaut : POST /automations/pause { paused: true }, et rend l’état RELU', async () => {
    appel.mockResolvedValue({ ok: true, status: 200, json: { paused: true } });
    const b = base();
    const r = await lancer('pause_all_automations', {}, b);
    expect(appel.mock.calls[0].slice(1)).toEqual(['/automations/pause', { paused: true }, 'POST']);
    expect(r).toMatchObject({ updated: true, paused: true });
    expect(r.note).toMatch(/arrêtées/);
    expect(b.ops).toEqual([]); // l'interrupteur vit dans la route (cache du moteur vidé), pas en écriture directe
  });

  it('paused=false reprend, et le dit : des messages peuvent repartir', async () => {
    appel.mockResolvedValue({ ok: true, status: 200, json: { paused: false } });
    const r = await lancer('pause_all_automations', { paused: false }, base());
    expect(appel.mock.calls[0][2]).toEqual({ paused: false });
    expect(r).toMatchObject({ updated: true, paused: false });
    expect(r.note).toMatch(/repris.*messages aux clients/);
  });

  it('état réel différent de l’état demandé, rôle refusé, valeur non booléenne : jamais un faux « arrêté »', async () => {
    appel.mockResolvedValueOnce({ ok: true, status: 200, json: { paused: false } });
    expect((await lancer('pause_all_automations', { paused: true }, base())).error).toMatch(/ne sont PAS arrêtées/);
    appel.mockResolvedValueOnce({ ok: false, status: 403, json: { error: 'Seul un administrateur peut arrêter les automatisations. Rien n’a été arrêté.' } });
    expect((await lancer('pause_all_automations', {}, base())).error).toMatch(/Ton rôle dans Lume ne permet pas l’arrêt.*Rien n’a été arrêté/);
    appel.mockClear();
    expect((await lancer('pause_all_automations', { paused: 'oui' }, base())).error).toMatch(/tout arrêter \(true\) ou reprendre \(false\)/);
    expect(appel).not.toHaveBeenCalled();
  });

  it('« déjà fait » est revérifié contre la base, dans l’entreprise', async () => {
    appel.mockResolvedValue({ ok: true, status: 200, json: { paused: true } });
    const b = base({ company_settings: [{ id: 'cs1', org_id: ORG, automations_paused: false }, { id: 'cs2', org_id: AUTRE_ORG, automations_paused: true }] });
    await lancer('pause_all_automations', {}, b);
    const options = idempotent.mock.calls[0][4]!;
    expect(await options.encoreValable!({ paused: true })).toBe(false); // reprises à l'écran depuis : à refaire
    expect(await options.encoreValable!({ paused: false })).toBe(true);
    expect(filtreOrg(b, 'company_settings')).toBe(true);
  });
});

describe('list_automation_templates', () => {
  it('rend la bibliothèque entière, sans base ni route', async () => {
    const b = base();
    const r = await lancer('list_automation_templates', {}, b);
    expect(r.count).toBe(MODELES_AUTOMATISATION.length);
    expect(r.count).toBeGreaterThan(10);
    expect(r.templates.map((t: any) => t.template_key).sort()).toEqual(MODELES_AUTOMATISATION.map((m) => m.id).sort());
    for (const t of r.templates) {
      expect(t.name.length, t.template_key).toBeGreaterThan(3);
      expect(t.trigger, t.template_key).not.toMatch(/^[a-z_]+\.[a-z_.]+$/); // un libellé, pas la clé technique
    }
    expect(r.note).toMatch(/EN BROUILLON/);
    expect(b.ops).toEqual([]);
    expect(appel).not.toHaveBeenCalled();
    expect(fauxFetch).not.toHaveBeenCalled();
  });

  it('filtre par catégorie et par mots ; langue anglaise ; catégorie inconnue refusée', async () => {
    const soumissions = await lancer('list_automation_templates', { category: 'soumissions' }, base());
    expect(soumissions.count).toBe(MODELES_AUTOMATISATION.filter((m) => m.categorie === 'soumissions').length);
    expect(soumissions.count).toBeGreaterThan(0);
    const modele = MODELES_AUTOMATISATION[0];
    const trouve = await lancer('list_automation_templates', { search: modele.nom.fr.toUpperCase() }, base());
    expect(trouve.templates.map((t: any) => t.template_key)).toContain(modele.id);
    const en = await lancer('list_automation_templates', { search: modele.nom.en, language: 'en' }, base());
    expect(en.templates.find((t: any) => t.template_key === modele.id).name).toBe(modele.nom.en);
    expect((await lancer('list_automation_templates', { search: 'zzzz-introuvable' }, base())).count).toBe(0);
    expect((await lancer('list_automation_templates', { category: 'cuisine' }, base())).error).toMatch(/Catégorie inconnue/);
  });

  it('la liste complète est abrégée (pas de description) ; le détail vient avec un filtre', async () => {
    const tout = await lancer('list_automation_templates', {}, base());
    expect(tout.templates.every((t: any) => t.description === undefined)).toBe(true);
    expect(tout.note).toMatch(/Liste abrégée/);
    // Sous la borne des résultats d'outils (20 000 caractères), avec de la marge.
    expect(JSON.stringify(tout).length).toBeLessThan(9000);
    const filtre = await lancer('list_automation_templates', { category: 'soumissions' }, base());
    expect(filtre.templates.every((t: any) => typeof t.description === 'string' && t.description.length > 10)).toBe(true);
    expect(filtre.note).not.toMatch(/Liste abrégée/);
  });
});

describe('create_automation_from_template', () => {
  const modele = MODELES_AUTOMATISATION[0];

  it('passe par POST /automations/templates/utiliser et annonce un BROUILLON', async () => {
    appel.mockResolvedValue({ ok: true, status: 201, json: { id: id(60), name: modele.nom.fr, is_active: false } });
    const b = base(regles());
    const r = await lancer('create_automation_from_template', { template_key: modele.id }, b);
    expect(appel.mock.calls[0].slice(1)).toEqual(['/automations/templates/utiliser', { templateId: modele.id }, 'POST']);
    expect(r).toMatchObject({ created: true, rule_id: id(60), name: modele.nom.fr, modele: modele.nom.fr, etapes: modele.nb_etapes, is_active: false });
    expect(r.note).toMatch(/EN BROUILLON/);
    expect(b.ops).toEqual([]); // rien d'écrit en direct quand la route rend un brouillon
  });

  it('si la route rendait une automatisation ACTIVE, l’outil l’éteint avant de répondre', async () => {
    appel.mockResolvedValue({ ok: true, status: 201, json: { id: id(60), name: modele.nom.fr, is_active: true } });
    const b = base({ automation_rules: [{ id: id(60), org_id: ORG, name: modele.nom.fr, is_active: true, deleted_at: null }] });
    const r = await lancer('create_automation_from_template', { template_key: modele.id }, b);
    expect(b.ops.find((o) => o.op === 'update')!.args[0]).toMatchObject({ is_active: false });
    expect(filtreOrg(b, 'automation_rules')).toBe(true);
    expect(b.tables.automation_rules[0].is_active).toBe(false);
    expect(r.is_active).toBe(false);
  });

  it('modèle inconnu ou clé fantaisiste : refus avant la route', async () => {
    for (const cle of ['modele_qui_n_existe_pas', '../../rules', '', 'DROP TABLE']) {
      const r = await lancer('create_automation_from_template', { template_key: cle }, base());
      expect(r.error, cle).toMatch(/n’existe pas dans la bibliothèque|requis/);
    }
    expect(appel).not.toHaveBeenCalled();
  });

  it('refus de la route (rôle) et réponse jamais revenue', async () => {
    appel.mockResolvedValueOnce({ ok: false, status: 403, json: { error: 'Votre rôle ne permet pas de créer une automatisation.' } });
    expect((await lancer('create_automation_from_template', { template_key: modele.id }, base())).error).toMatch(/Ton rôle dans Lume ne permet pas la création/);
    appel.mockRejectedValueOnce(new AppelInterneIncertain('timeout'));
    const r = await lancer('create_automation_from_template', { template_key: modele.id }, base());
    expect(r.incertain).toBe(true);
    expect(r.created).toBeUndefined();
  });

  it('« déjà fait » ne vaut que si l’automatisation créée existe encore', async () => {
    appel.mockResolvedValue({ ok: true, status: 201, json: { id: id(1), name: 'x', is_active: false } });
    const b = base(regles());
    await lancer('create_automation_from_template', { template_key: modele.id }, b);
    const options = idempotent.mock.calls[0][4]!;
    expect(await options.encoreValable!({ rule_id: id(1) })).toBe(true);
    expect(await options.encoreValable!({ rule_id: id(3) })).toBe(false); // à la corbeille
    expect(await options.encoreValable!({ rule_id: id(2) })).toBe(false); // d'une autre entreprise : invisible
  });
});

/* ── 5. Statistiques ─────────────────────────────────────────── */

describe('statistiques (rpc_insights_*)', () => {
  const periode = { from: '2026-09-01', to: '2026-09-30' };
  const argsAttendus = { p_org: ORG, p_from: '2026-09-01', p_to: '2026-09-30', p_filtres: {} };

  it('get_quote_win_rate : taux en nombre, sur les décidées et en valeur ; deals du pipeline', async () => {
    const b = base({}, { rpc: {
      rpc_insights_soumissions: { data: [{ nombre: 10, valeur_cents: 1000000, approuvees: 4, valeur_approuvee_cents: 500000, en_attente: 2, valeur_en_attente_cents: 200000 }] },
      rpc_insights_pipeline_velocity: { data: [{ total_deals: 6, won_deals: 3, lost_deals: 1, win_rate: 75 }] },
    } });
    const r = await lancer('get_quote_win_rate', periode, b);
    expect(b.rpcAppels.map((a) => a.nom).sort()).toEqual(['rpc_insights_pipeline_velocity', 'rpc_insights_soumissions']);
    for (const a of b.rpcAppels) expect(a.args).toEqual(argsAttendus);
    expect(r).toMatchObject({
      periode: { du: '2026-09-01', au: '2026-09-30' },
      soumissions_creees: 10, gagnees: 4, en_attente: 2, perdues_ou_fermees: 4,
      taux_de_gain_pct: 40, taux_de_gain_sur_les_decidees_pct: 50, taux_de_gain_en_valeur_pct: 50,
      valeur_creee_cents: 1000000, valeur_gagnee_cents: 500000, valeur_en_attente_cents: 200000,
      pipeline: { deals_gagnes: 3, deals_perdus: 1, taux_de_gain_pct: 75 },
    });
    expect(accentue(r.note)).toBe(true);
  });

  it('get_quote_win_rate : aucune soumission = taux null (jamais 0 %) ; deals illisibles = dit, pas inventé', async () => {
    const b = base({}, { rpc: {
      rpc_insights_soumissions: { data: [{ nombre: 0, valeur_cents: 0, approuvees: 0, valeur_approuvee_cents: 0, en_attente: 0, valeur_en_attente_cents: 0 }] },
      rpc_insights_pipeline_velocity: { error: { message: 'boom' } },
    } });
    const r = await lancer('get_quote_win_rate', periode, b);
    expect(r.taux_de_gain_pct).toBeNull();
    expect(r.taux_de_gain_en_valeur_pct).toBeNull();
    expect(r.pipeline).toBeNull();
    expect(r.note).toMatch(/Aucune soumission/);
  });

  it('get_payment_methods_breakdown : parts et libellés français', async () => {
    const b = base({}, { rpc: { rpc_insights_payment_mix: { data: [{ method: 'card', cents: 7500 }, { method: 'e-transfer', cents: 2000 }, { method: 'other', cents: 500 }] } } });
    const r = await lancer('get_payment_methods_breakdown', periode, b);
    expect(b.rpcAppels).toEqual([{ nom: 'rpc_insights_payment_mix', args: argsAttendus }]);
    expect(r.total_cents).toBe(10000);
    expect(r.modes).toEqual([
      { method: 'card', mode: 'carte', amount_cents: 7500, part_pct: 75 },
      { method: 'e-transfer', mode: 'virement Interac', amount_cents: 2000, part_pct: 20 },
      { method: 'other', mode: 'autre ou non précisé', amount_cents: 500, part_pct: 5 },
    ]);
    const vide = await lancer('get_payment_methods_breakdown', periode, base({}, { rpc: { rpc_insights_payment_mix: { data: [] } } }));
    expect(vide).toMatchObject({ total_cents: 0, modes: [] });
    expect(vide.note).toMatch(/Aucun paiement/);
  });

  it('get_team_performance : une ligne par équipe, montants en _cents', async () => {
    const b = base({}, { rpc: { rpc_insights_team_performance: { data: [
      { team_id: id(70), team_name: 'Équipe Nord', jobs_count: 12, jobs_completed: 9, completion_rate: 75, revenue_cents: 450000, avg_job_value_cents: 50000 },
      { team_id: id(71), team_name: null, jobs_count: 0, jobs_completed: 0, completion_rate: 0, revenue_cents: 0, avg_job_value_cents: 0 },
    ] } } });
    const r = await lancer('get_team_performance', periode, b);
    expect(b.rpcAppels).toEqual([{ nom: 'rpc_insights_team_performance', args: argsAttendus }]);
    expect(r.count).toBe(2);
    expect(r.equipes[0]).toEqual({ team_id: id(70), team: 'Équipe Nord', jobs: 12, jobs_completes: 9, taux_de_completion_pct: 75, revenue_cents: 450000, avg_job_value_cents: 50000 });
    expect(r.equipes[1].team).toBe('—');
    const vide = await lancer('get_team_performance', periode, base({}, { rpc: { rpc_insights_team_performance: { data: [] } } }));
    expect(vide.note).toMatch(/Aucune équipe active/);
  });

  // Passe en prod du 2026-10-02 : « mes clients me paient surtout comment ? », posée le 2 du mois,
  // recevait « aucun paiement depuis le début d'octobre ».
  describe('sans période, mois encore vide : repli sur les 12 derniers mois', () => {
    /** Les n premiers appels rpc répondent `data` ; les suivants, ce que la base a préparé. */
    const dAbord = (b: ReturnType<typeof base>, ...reponses: unknown[]) => {
      for (const data of reponses) {
        b.ctx.client.rpc.mockImplementationOnce(async (nom: string, args: Record<string, unknown>) => { b.rpcAppels.push({ nom, args }); return { data, error: null }; });
      }
    };
    const unAnAvant = (jour: string) => {
      const [a, m, j] = jour.split('-').map(Number);
      return new Date(Date.UTC(a - 1, m - 1, j + 1)).toISOString().slice(0, 10);
    };

    it('get_payment_methods_breakdown : second appel sur 12 mois, et la réponse le dit', async () => {
      const b = base({}, { rpc: { rpc_insights_payment_mix: { data: [{ method: 'card', cents: 7500 }, { method: 'cash', cents: 2500 }] } } });
      dAbord(b, []);
      const r = await lancer('get_payment_methods_breakdown', {}, b);
      expect(b.rpcAppels).toHaveLength(2);
      const [mois, annee] = b.rpcAppels.map((a) => a.args as { p_from: string; p_to: string });
      expect(mois.p_from).toBe(`${mois.p_to.slice(0, 7)}-01`);
      expect(annee).toMatchObject({ p_to: mois.p_to, p_from: unAnAvant(mois.p_to) });
      expect(r).toMatchObject({ periode_elargie: true, periode: { du: annee.p_from, au: annee.p_to }, total_cents: 10000 });
      expect(r.modes.map((m: any) => m.part_pct)).toEqual([75, 25]);
      expect(r.note).toMatch(/12 derniers mois — dis la période/);
    });

    it('rien non plus sur 12 mois : on reste sur le mois, sans prétendre avoir élargi', async () => {
      const b = base({}, { rpc: { rpc_insights_payment_mix: { data: [] } } });
      const r = await lancer('get_payment_methods_breakdown', {}, b);
      expect(b.rpcAppels).toHaveLength(2);
      expect(r.periode_elargie).toBeUndefined();
      expect(r.periode.du).toBe(`${r.periode.au.slice(0, 7)}-01`);
      expect(r.note).toMatch(/Aucun paiement/);
    });

    it('une date demandée, même une seule : jamais de repli', async () => {
      for (const args of [periode, { from: '2026-09-01' }, { to: '2026-09-30' }]) {
        const b = base({}, { rpc: { rpc_insights_payment_mix: { data: [] } } });
        const r = await lancer('get_payment_methods_breakdown', args, b);
        expect(b.rpcAppels, JSON.stringify(args)).toHaveLength(1);
        expect(r.periode_elargie).toBeUndefined();
      }
    });

    it('get_quote_win_rate : les deux lectures refaites sur 12 mois', async () => {
      const b = base({}, { rpc: {
        rpc_insights_soumissions: { data: [{ nombre: 8, valeur_cents: 800000, approuvees: 4, valeur_approuvee_cents: 400000, en_attente: 0, valeur_en_attente_cents: 0 }] },
        rpc_insights_pipeline_velocity: { data: [{ won_deals: 1, lost_deals: 1 }] },
      } });
      dAbord(b, [{ nombre: 0 }], [{ won_deals: 0, lost_deals: 0 }]);
      const r = await lancer('get_quote_win_rate', {}, b);
      expect(b.rpcAppels.map((a) => a.nom)).toEqual(['rpc_insights_soumissions', 'rpc_insights_pipeline_velocity', 'rpc_insights_soumissions', 'rpc_insights_pipeline_velocity']);
      expect(b.rpcAppels[2].args.p_from).toBe(unAnAvant(String(b.rpcAppels[0].args.p_to)));
      expect(r).toMatchObject({ periode_elargie: true, soumissions_creees: 8, taux_de_gain_pct: 50, pipeline: { deals_gagnes: 1, deals_perdus: 1 } });
      expect(r.note).toMatch(/12 derniers mois/);
    });

    it('get_team_performance : des équipes sans aucun job ce mois-ci → 12 mois ; aucune équipe → pas de second appel', async () => {
      const equipe = (jobs: number) => ({ team_id: id(70), team_name: 'Équipe Nord', jobs_count: jobs, jobs_completed: jobs, completion_rate: jobs ? 100 : 0, revenue_cents: jobs * 10000, avg_job_value_cents: jobs ? 10000 : 0 });
      const b = base({}, { rpc: { rpc_insights_team_performance: { data: [equipe(12)] } } });
      dAbord(b, [equipe(0)]);
      const r = await lancer('get_team_performance', {}, b);
      expect(b.rpcAppels).toHaveLength(2);
      expect(r).toMatchObject({ periode_elargie: true, equipes: [{ team: 'Équipe Nord', jobs: 12, revenue_cents: 120000 }] });
      expect(r.note).toMatch(/12 derniers mois/);

      const sansEquipe = base({}, { rpc: { rpc_insights_team_performance: { data: [] } } });
      const vide = await lancer('get_team_performance', {}, sansEquipe);
      expect(sansEquipe.rpcAppels).toHaveLength(1);
      expect(vide.note).toMatch(/Aucune équipe active/);
    });
  });

  it('refus de la base (42501), panne ou date invalide : une phrase en français, jamais de chiffres', async () => {
    const outils: Array<[string, string]> = [['get_quote_win_rate', 'rpc_insights_soumissions'], ['get_payment_methods_breakdown', 'rpc_insights_payment_mix'], ['get_team_performance', 'rpc_insights_team_performance']];
    for (const [nom, fonction] of outils) {
      const refuse = await lancer(nom, periode, base({}, { rpc: { [fonction]: { error: { code: '42501', message: 'Not allowed' } }, rpc_insights_pipeline_velocity: { data: [] } } }));
      expect(refuse.error, nom).toMatch(/Ton rôle dans Lume ne donne pas accès aux statistiques/);
      const panne = await lancer(nom, periode, base({}, { rpc: { [fonction]: { error: { message: 'relation "x" does not exist' } }, rpc_insights_pipeline_velocity: { data: [] } } }));
      expect(panne.error, nom).toMatch(/La consultation a échoué côté Lume/);
      expect(panne.error, nom).not.toMatch(/relation/); // l'erreur brute de la base ne sort jamais
      const b = base();
      expect((await lancer(nom, { from: 'hier' }, b)).error, nom).toMatch(/AAAA-MM-JJ/);
      expect(b.rpcAppels, nom).toEqual([]);
    }
  });
});

/* ── 6. Versements Stripe ────────────────────────────────────── */

describe('list_stripe_payouts', () => {
  const liste = { provider: 'stripe', currency: 'CAD', items: [
    { id: 'po_1', date: '2026-09-12T10:00:00.000Z', type: 'bank_account', status: 'paid', net: 123456, currency: 'CAD', arrival_date: '2026-09-14T00:00:00.000Z', method: 'standard' },
    { id: 'po_2', date: '2026-09-20T10:00:00.000Z', type: 'bank_account', status: 'failed', net: 5000, currency: 'CAD', arrival_date: null, method: 'standard' },
  ], next_cursor: null, has_more: false };
  const resume = { provider: 'stripe', currency: 'cad', available: 1000, on_the_way: 2000, deposited_week: 0, deposited_month: 123456, meta: { source: 'stripe.balance' } };
  const servir = (parRoute: { list?: [number, unknown]; summary?: [number, unknown] }) => fauxFetch.mockImplementation(async (url: string) => {
    const [status, corps] = String(url).includes('/payouts/list') ? (parRoute.list ?? [200, liste]) : (parRoute.summary ?? [200, resume]);
    return reponse(status, corps);
  });

  it('lit GET /payments/payouts/list et /summary pour CETTE entreprise, bornes en jours de l’entreprise', async () => {
    servir({});
    const r = await lancer('list_stripe_payouts', { from: '2026-09-01', to: '2026-09-30' }, base());
    const urls = fauxFetch.mock.calls.map((c) => new URL(String(c[0])));
    const u = urls.find((x) => x.pathname === '/api/payments/payouts/list')!;
    expect(Object.fromEntries(u.searchParams)).toEqual({
      orgId: ORG, provider: 'stripe', limit: '20',
      date_from: bornesJourOrg('2026-09-01').debut, date_to: bornesJourOrg('2026-09-30').fin,
    });
    const s = urls.find((x) => x.pathname === '/api/payments/payouts/summary')!;
    expect(Object.fromEntries(s.searchParams)).toEqual({ orgId: ORG, provider: 'stripe' });
    for (const c of fauxFetch.mock.calls) expect(c[1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer jeton', 'x-org-id': ORG } });

    expect(r).toMatchObject({ connected: true, count: 2, has_more: false, total_period_cents: 123456 });
    expect(r.payouts[0]).toEqual({ payout_id: 'po_1', created_at: '2026-09-12T10:00:00.000Z', arrival_date: '2026-09-14T00:00:00.000Z', status: 'paid', statut: 'versé', amount_cents: 123456, currency: 'CAD', method: 'standard' });
    expect(r.payouts[1].statut).toBe('échoué');
    expect(r.solde).toEqual({ available_cents: 1000, on_the_way_cents: 2000, deposited_week_cents: 0, deposited_month_cents: 123456, currency: 'CAD' });
    // Tout montant porte un nom que le masquage par rôle reconnaît.
    for (const k of ['amount_cents', 'total_period_cents', ...Object.keys(r.solde).filter((x) => x !== 'currency')]) expect(CLES_MONTANTS.test(k), k).toBe(true);
    expect(accentue(r.note)).toBe(true);
  });

  it('la limite est bornée à 50', async () => {
    servir({});
    await lancer('list_stripe_payouts', { limit: 500 }, base());
    const u = fauxFetch.mock.calls.map((c) => new URL(String(c[0]))).find((x) => x.pathname.endsWith('/list'))!;
    expect(u.searchParams.get('limit')).toBe('50');
  });

  it('aucun compte Stripe : dit, sans erreur ni montant', async () => {
    servir({ list: [409, { error: 'Connect Stripe first in Payment settings.' }], summary: [200, { ...resume, available: 0, on_the_way: 0, meta: { source: 'not_connected' } }] });
    const r = await lancer('list_stripe_payouts', {}, base());
    expect(r).toMatchObject({ connected: false, payouts: [] });
    expect(r.note).toMatch(/Aucun compte Stripe n’est connecté/);
    expect(r.solde).toBeUndefined();
  });

  it('solde illisible : les versements sortent, le solde est null et c’est dit', async () => {
    servir({ summary: [500, { error: 'Unable to load payout summary.' }] });
    const r = await lancer('list_stripe_payouts', {}, base());
    expect(r.connected).toBe(true);
    expect(r.solde).toBeNull();
    expect(r.note).toMatch(/solde Stripe n’a pas pu être lu/);
  });

  it('refus, date invalide, session absente : phrase en français', async () => {
    servir({ list: [403, { error: 'Forbidden for this organization.' }] });
    expect((await lancer('list_stripe_payouts', {}, base())).error).toMatch(/Ton rôle dans Lume ne permet pas de consulter les versements Stripe/);
    fauxFetch.mockClear();
    expect((await lancer('list_stripe_payouts', { to: '2026-9-1' }, base())).error).toMatch(/AAAA-MM-JJ/);
    expect((await lancer('list_stripe_payouts', {}, base({}, { sansSession: true }))).error).toMatch(/session Lume/);
    expect(fauxFetch).not.toHaveBeenCalled();
  });
});
