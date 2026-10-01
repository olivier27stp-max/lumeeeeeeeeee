/**
 * Lot « ventes » de Lumi (server/lib/agent/tools-lot-ventes.ts).
 *
 * Le module n'est pas encore branché dans outils-domaines.ts : il est importé
 * directement. Tout est simulé — aucune base, aucune route, aucun envoi.
 *
 * Le faux client Supabase garde des tables EN MÉMOIRE et applique pour vrai les
 * filtres eq / is / in : une fiche d'une autre entreprise ne ressort que si
 * l'outil a oublié son filtre `org_id` — et le test échoue alors.
 *
 * Pour chaque outil : le chemin normal lit ou écrit la bonne table (ou appelle
 * la bonne fonction) avec le filtre d'entreprise ; une fiche d'une autre
 * entreprise ou introuvable est refusée en français ; une entrée invalide est
 * refusée AVANT toute écriture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// appelInterne simulé (aucun serveur) ; executerIdempotent réduit à « exécute
// l'action » (aucune empreinte en base). Le reste du module reste réel.
vi.mock('../server/lib/agent/tools-etendus', async (importActual) => {
  const reel = await importActual<typeof import('../server/lib/agent/tools-etendus')>();
  return {
    ...reel,
    appelInterne: vi.fn(async () => ({ ok: true, status: 201, json: {} })),
    executerIdempotent: vi.fn(async (_ctx: unknown, _outil: string, _args: unknown, action: () => Promise<Record<string, unknown>>) => action()),
  };
});

import { appelInterne, AppelInterneIncertain, executerIdempotent } from '../server/lib/agent/tools-etendus';
import {
  OUTILS_LOT_VENTES, REGISTRE_LOT_VENTES, PERMISSIONS_LOT_VENTES, TOPICS_LOT_VENTES,
} from '../server/lib/agent/tools-lot-ventes';
import { AGENT_TOOLS } from '../server/lib/agent/tools';
import { validerArgs } from '../server/lib/agent/validation-args';
import { TOPICS } from '../server/lib/lumi/topics';
import { PERMISSION_KEYS } from '../src/lib/permissions';

const appel = appelInterne as unknown as ReturnType<typeof vi.fn>;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG = id(1);
const AUTRE_ORG = id(2);
const MOI = id(10);
const VENDEUR = id(11);
const CLIENT = id(20);
const CLIENT_AILLEURS = id(21);
const PIPELINE = id(30);
const E_NOUVEAU = id(31);
const E_DEVIS = id(32);
const E_GAGNE = id(33);
const DEAL = id(40);
const DEAL_AILLEURS = id(41);
const DEVIS = id(50);
const DEVIS_AILLEURS = id(51);
const CARTE = id(60);
const ARCHIVE_CLIENT = id(70);
const ARCHIVE_LEAD = id(71);
const ARCHIVE_JOB = id(72);

type Ligne = Record<string, any>;
type Filtre = [op: 'eq' | 'is' | 'in', colonne: string, valeur: unknown];
interface Requete { table: string; op: 'select' | 'update' | 'insert'; filtres: Filtre[]; valeurs?: any }
type Rpc = (args: Ligne, tables: Record<string, Ligne[]>) => { data: unknown; error: { code?: string; message: string } | null };

/** Tables en mémoire, filtres appliqués pour vrai, chaque requête et chaque RPC journalisée. */
function base(tables: Record<string, Ligne[]>, rpcs: Record<string, Rpc> = {}) {
  const requetes: Requete[] = [];
  const rpcAppels: Array<{ nom: string; args: Ligne }> = [];
  const from = (table: string) => {
    const lignes = (tables[table] ??= []);
    const r: Requete = { table, op: 'select', filtres: [] };
    const tris: Array<[string, boolean]> = [];
    let limite = Infinity;
    const garde = (l: Ligne) => r.filtres.every(([op, c, v]) =>
      op === 'eq' ? l[c] === v : op === 'is' ? (l[c] ?? null) === v : (v as unknown[]).includes(l[c]));
    const executer = (): Ligne[] => {
      requetes.push(r);
      if (r.op === 'insert') {
        const nouvelles = (Array.isArray(r.valeurs) ? r.valeurs : [r.valeurs]).map((v: Ligne) => ({ ...v }));
        lignes.push(...nouvelles);
        return nouvelles.map((l: Ligne) => ({ ...l }));
      }
      let cibles = lignes.filter(garde);
      if (r.op === 'update') for (const l of cibles) Object.assign(l, r.valeurs);
      for (const [c, asc] of [...tris].reverse()) {
        cibles = [...cibles].sort((a, b) => (asc ? 1 : -1) * String(a[c] ?? '').localeCompare(String(b[c] ?? '')));
      }
      return cibles.slice(0, limite).map((l) => ({ ...l }));
    };
    const q: any = {
      select: () => q,
      update: (v: Ligne) => { r.op = 'update'; r.valeurs = v; return q; },
      insert: (v: Ligne | Ligne[]) => { r.op = 'insert'; r.valeurs = v; return q; },
      eq: (c: string, v: unknown) => { r.filtres.push(['eq', c, v]); return q; },
      is: (c: string, v: unknown) => { r.filtres.push(['is', c, v]); return q; },
      in: (c: string, v: unknown[]) => { r.filtres.push(['in', c, v]); return q; },
      order: (c: string, o?: { ascending?: boolean }) => { tris.push([c, o?.ascending !== false]); return q; },
      limit: (n: number) => { limite = n; return q; },
      maybeSingle: async () => ({ data: executer()[0] ?? null, error: null }),
      single: async () => {
        const l = executer()[0];
        return l ? { data: l, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      },
      then: (ok: (v: { data: Ligne[]; error: null }) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve().then(() => ({ data: executer(), error: null as null })).then(ok, ko),
    };
    return q;
  };
  const rpc = async (nom: string, args: Ligne) => {
    rpcAppels.push({ nom, args });
    return rpcs[nom] ? rpcs[nom](args, tables) : { data: null, error: null };
  };
  const ecritures = () => requetes.filter((q) => q.op !== 'select');
  return { ctx: { client: { from, rpc } as never, orgId: ORG, userId: MOI, accessToken: 'jeton' }, tables, requetes, rpcAppels, ecritures };
}

/** Toute requête sur une table qui porte org_id est bornée à l'entreprise du contexte. */
const SANS_ORG = new Set(['quote_status_history']);
function toutEstBorneALOrg(requetes: Requete[]) {
  const fautives = requetes
    .filter((q) => q.op !== 'insert' && !SANS_ORG.has(q.table))
    .filter((q) => !q.filtres.some(([op, c, v]) => op === 'eq' && c === 'org_id' && v === ORG))
    .map((q) => `${q.op} ${q.table}`);
  expect(fautives).toEqual([]);
}

const outil = (nom: string) => {
  const t = OUTILS_LOT_VENTES.find((o) => o.declaration.name === nom);
  if (!t?.handler) throw new Error(`outil ${nom} absent ou sans handler`);
  return t.handler;
};

const ilYA = (jours: number) => new Date(Date.now() - jours * 86_400_000).toISOString();
/** Un consentement exprès donné il y a quatre mois (relatif : une date future ne fonde rien). */
const EXPRES = ilYA(120);

beforeEach(() => {
  appel.mockReset();
  appel.mockResolvedValue({ ok: true, status: 201, json: {} });
  (executerIdempotent as unknown as ReturnType<typeof vi.fn>).mockClear();
});

/* ── 1. Déclarations et manifestes ───────────────────────────── */

describe('déclarations et manifestes', () => {
  const noms = OUTILS_LOT_VENTES.map((t) => t.declaration.name);
  const ecritures = OUTILS_LOT_VENTES.filter((t) => t.kind === 'write').map((t) => t.declaration.name);

  it('huit outils, noms uniques, aucun ne double un outil existant', () => {
    expect(noms.sort()).toEqual([
      'create_deal', 'get_client_consent', 'list_archived', 'restore_archived',
      'set_client_consent', 'set_quote_discount_deposit', 'set_quote_status', 'update_deal',
    ]);
    // Vrai avant ET après le branchement : le seul outil de ce nom, c'est le nôtre.
    for (const t of OUTILS_LOT_VENTES) {
      expect(AGENT_TOOLS.filter((a) => a.declaration.name === t.declaration.name && a !== t), t.declaration.name).toEqual([]);
    }
  });

  it('descriptions anglaises et courtes ; écritures = write + needsIdentity + handler', () => {
    for (const t of OUTILS_LOT_VENTES) {
      const d = t.declaration.description;
      expect(d.length, t.declaration.name).toBeGreaterThan(40);
      expect(d.length, t.declaration.name).toBeLessThanOrEqual(360);
      expect(d, t.declaration.name).not.toMatch(/[àâçéèêëîïôùûü]/i);
      expect(typeof t.handler, t.declaration.name).toBe('function');
      if (t.kind === 'write') expect(t.needsIdentity, t.declaration.name).toBe(true);
      for (const [k, p] of Object.entries(t.declaration.parameters.properties)) {
        expect(['string', 'integer', 'number', 'boolean'], `${t.declaration.name}.${k}`).toContain((p as Ligne).type);
        if ((p as Ligne).enum) expect((p as Ligne).type, `${t.declaration.name}.${k} enum`).toBe('string');
        expect(String((p as Ligne).description).length, `${t.declaration.name}.${k}`).toBeLessThanOrEqual(130);
      }
    }
  });

  it('une écriture qui touche ce que le client voit ou reçoit le dit : « confirm first »', () => {
    for (const nom of ['set_quote_status', 'set_quote_discount_deposit', 'set_client_consent']) {
      expect(OUTILS_LOT_VENTES.find((t) => t.declaration.name === nom)?.declaration.description, nom).toMatch(/confirm first/i);
    }
  });

  it('chaque déclaration accepte un exemple minimal conforme (sous-ensemble validerArgs)', () => {
    for (const t of OUTILS_LOT_VENTES) {
      const p = t.declaration.parameters as Ligne;
      const exemple: Ligne = {};
      for (const k of p.required ?? []) {
        const s = p.properties?.[k] ?? {};
        exemple[k] = s.type === 'integer' || s.type === 'number' ? 1 : s.type === 'boolean' ? true : (s.enum?.[0] ?? 'x');
      }
      const r = validerArgs(p, exemple);
      expect(r.ok, t.declaration.name).toBe(true);
    }
  });

  it('REGISTRE = exactement les écritures ; PERMISSIONS = tous les outils, clés existantes ; TOPICS = chacun une fois', () => {
    expect(Object.keys(REGISTRE_LOT_VENTES).sort()).toEqual([...ecritures].sort());
    expect(Object.keys(PERMISSIONS_LOT_VENTES).sort()).toEqual([...noms].sort());
    for (const [nom, p] of Object.entries(PERMISSIONS_LOT_VENTES)) {
      expect(PERMISSION_KEYS as readonly string[], nom).toContain(p.cle);
      expect(p.capacite.length, nom).toBeGreaterThan(5);
    }
    const topics = new Set(TOPICS.map((t) => t.id));
    const ranges = Object.entries(TOPICS_LOT_VENTES).flatMap(([topic, liste]) => {
      expect(topics.has(topic as never), topic).toBe(true);
      return liste ?? [];
    });
    expect([...ranges].sort()).toEqual([...noms].sort());
  });

  it('le module n’utilise ni le client service_role ni console.log, et n’écrit aucune projection de total', () => {
    const source = readFileSync(resolve(__dirname, '..', 'server', 'lib', 'agent', 'tools-lot-ventes.ts'), 'utf8');
    expect(source).not.toMatch(/getServiceClient|console\.log/);
    // Les seuls imports d'exécution venant de src/ seraient absents de l'image Docker du serveur.
    expect(source.match(/^import (?!type)[^;]*from '\.\.\/\.\.\/\.\.\/src\//gm) ?? []).toEqual([]);
  });
});

/* ── 2. Pipeline de ventes ───────────────────────────────────── */

function pipelineDeBase(extra: Record<string, Ligne[]> = {}) {
  return base({
    clients: [
      { id: CLIENT, org_id: ORG, first_name: 'Marie', last_name: 'Tremblay', status: 'active', deleted_at: null },
      { id: CLIENT_AILLEURS, org_id: AUTRE_ORG, first_name: 'Autre', last_name: 'Bureau', status: 'active', deleted_at: null },
    ],
    pipelines_ventes: [
      { id: PIPELINE, org_id: ORG, name: 'Ventes', is_default: true, position: 1, archived_at: null },
      { id: id(39), org_id: AUTRE_ORG, name: 'Ailleurs', is_default: true, position: 1, archived_at: null },
    ],
    pipeline_stages: [
      { id: E_NOUVEAU, org_id: ORG, pipeline_id: PIPELINE, name_fr: 'Nouveau', name_en: 'New', kind: 'open', position: 1, archived_at: null },
      { id: E_DEVIS, org_id: ORG, pipeline_id: PIPELINE, name_fr: 'Devis envoyé', name_en: 'Quote sent', kind: 'open', position: 2, archived_at: null },
      { id: E_GAGNE, org_id: ORG, pipeline_id: PIPELINE, name_fr: 'Gagné', name_en: 'Won', kind: 'won', position: 3, archived_at: null },
    ],
    team_members: [
      { org_id: ORG, user_id: VENDEUR, first_name: 'Luc', last_name: 'Roy', email: 'luc@exemple.test' },
      { org_id: AUTRE_ORG, user_id: id(12), first_name: 'Hors', last_name: 'Bureau', email: 'hors@exemple.test' },
    ],
    deals: [],
    ...extra,
  }, {
    // Ce que fait la base : le deal naît à la première étape ouverte.
    pipeline_creer_deal: (args, tables) => {
      tables.deals.push({ id: DEAL, org_id: ORG, pipeline_id: args.p_pipeline_id, stage_id: E_NOUVEAU, client_id: args.p_client_id, title: null, deleted_at: null });
      return { data: { deal_id: DEAL, deal_existant: false, fusionne: true }, error: null };
    },
  });
}

describe('create_deal', () => {
  it('crée par la fonction de l’écran (pipeline_creer_deal), puis pose le titre et l’étape demandés', async () => {
    const b = pipelineDeBase();
    const r = await outil('create_deal')({
      client_id: CLIENT, title: 'Toiture', amount_cents: 250000, stage: 'devis envoye',
      assigned_user_id: VENDEUR, expected_close_date: '2026-11-15',
    }, b.ctx);

    expect(b.rpcAppels).toEqual([{
      nom: 'pipeline_creer_deal',
      args: {
        p_first_name: 'Marie Tremblay', p_last_name: null, p_email: null, p_phone: null, p_address: null,
        p_montant_cents: 250000, p_assigne_a: VENDEUR, p_date_fermeture_visee: '2026-11-15', p_source: null,
        p_client_id: CLIENT, p_quote_id: null, p_pipeline_id: PIPELINE,
      },
    }]);
    expect(b.tables.deals[0]).toMatchObject({ id: DEAL, title: 'Toiture', stage_id: E_DEVIS });
    // Le montant n'est JAMAIS écrit sur le deal : la base en fait un devis brouillon.
    expect(b.ecritures()).toHaveLength(1);
    expect(Object.keys(b.ecritures()[0].valeurs).sort()).toEqual(['stage_id', 'title']);
    toutEstBorneALOrg(b.requetes);
    expect(r).toMatchObject({
      created: true, amount_cents: 250000,
      deal: { id: DEAL, title: 'Toiture', client: 'Marie Tremblay', pipeline: 'Ventes', etape: 'Devis envoyé', responsable: 'Luc Roy' },
    });
    expect(r.note).toMatch(/Deal créé pour Marie Tremblay à l’étape « Devis envoyé »/);
    expect(r.note).toMatch(/devis brouillon/);
    expect(executerIdempotent).toHaveBeenCalledWith(expect.anything(), 'create_deal', expect.anything(), expect.any(Function));
  });

  it('sans étape ni titre : première étape du pipeline, aucune écriture de plus', async () => {
    const b = pipelineDeBase();
    const r = await outil('create_deal')({ client_id: CLIENT }, b.ctx);
    expect(b.rpcAppels[0].args).toMatchObject({ p_montant_cents: null, p_assigne_a: null, p_pipeline_id: PIPELINE });
    expect(b.ecritures()).toEqual([]);
    expect(r).toMatchObject({ created: true, amount_cents: null, deal: { title: 'Marie Tremblay', etape: 'Nouveau' } });
  });

  it('un client d’une autre entreprise est refusé, rien n’est créé', async () => {
    const b = pipelineDeBase();
    await expect(outil('create_deal')({ client_id: CLIENT_AILLEURS }, b.ctx)).rejects.toThrow(/Client introuvable dans cette entreprise/);
    expect(b.rpcAppels).toEqual([]);
    expect(b.ecritures()).toEqual([]);
  });

  it('un deal déjà ouvert pour ce client : on le dit, sans appeler la fonction (pas de devis estimatif en trop)', async () => {
    const b = pipelineDeBase({ deals: [{ id: DEAL, org_id: ORG, pipeline_id: PIPELINE, stage_id: E_DEVIS, client_id: CLIENT, title: 'Gouttières', deleted_at: null }] });
    const r = await outil('create_deal')({ client_id: CLIENT, amount_cents: 90000 }, b.ctx);
    expect(r).toMatchObject({ created: false, existing: true, deal: { id: DEAL, title: 'Gouttières', etape: 'Devis envoyé' } });
    expect(r.note).toMatch(/a déjà un deal ouvert/);
    expect(b.rpcAppels).toEqual([]);
  });

  it('entrées invalides refusées avant toute écriture', async () => {
    const cas: Array<[Ligne, RegExp]> = [
      [{ client_id: 'marie' }, /Le client n’est pas un identifiant valide/],
      [{ client_id: CLIENT, amount_cents: -500 }, /nombre entier de cents, positif/],
      [{ client_id: CLIENT, amount_cents: 999_999_999_99 }, /dépasse ce que Lumi accepte/],
      [{ client_id: CLIENT, expected_close_date: '15 novembre' }, /date au format AAAA-MM-JJ/],
      [{ client_id: CLIENT, assigned_user_id: 'luc' }, /Le responsable n’est pas un identifiant valide/],
      [{ client_id: CLIENT, stage: 'Négociation' }, /Aucune étape ouverte « Négociation ».*« Nouveau », « Devis envoyé »/],
      // Une étape gagnée n'est pas une étape de départ : update_deal_stage s'en charge.
      [{ client_id: CLIENT, stage: 'Gagné' }, /Aucune étape ouverte « Gagné »/],
      [{ client_id: CLIENT, pipeline: 'Ailleurs' }, /Aucun pipeline nommé « Ailleurs »/],
      [{ client_id: CLIENT, assigned_user_id: id(12) }, /ne fait pas partie de l’équipe/],
    ];
    for (const [args, message] of cas) {
      const b = pipelineDeBase();
      await expect(outil('create_deal')(args, b.ctx), JSON.stringify(args)).rejects.toThrow(message);
      expect(b.rpcAppels, JSON.stringify(args)).toEqual([]);
      expect(b.ecritures(), JSON.stringify(args)).toEqual([]);
    }
  });

  it('un refus de la base (phrase française de la fonction) est relayé ; une erreur technique ne l’est jamais', async () => {
    const refus = base(pipelineDeBase().tables, { pipeline_creer_deal: () => ({ data: null, error: { code: 'P0001', message: 'Vous n\'avez pas la permission de créer un lead' } }) });
    await expect(outil('create_deal')({ client_id: CLIENT }, refus.ctx)).rejects.toThrow(/Impossible de créer le deal : Vous n'avez pas la permission/);
    const panne = base(pipelineDeBase().tables, { pipeline_creer_deal: () => ({ data: null, error: { code: '42703', message: 'column deals.valeur does not exist' } }) });
    const erreur = await outil('create_deal')({ client_id: CLIENT }, panne.ctx).catch((e: Error) => e.message);
    expect(erreur).toMatch(/Impossible de créer le deal\. Dis-le simplement/);
    expect(erreur).not.toMatch(/column|deals\.valeur/);
  });
});

describe('update_deal', () => {
  const avecDeals = () => pipelineDeBase({
    deals: [
      { id: DEAL, org_id: ORG, pipeline_id: PIPELINE, stage_id: E_NOUVEAU, client_id: CLIENT, title: 'Toiture', assigned_user_id: null, assigned_at: null, expected_close_date: null, deleted_at: null, client: { first_name: 'Marie', last_name: 'Tremblay' } },
      { id: DEAL_AILLEURS, org_id: AUTRE_ORG, pipeline_id: id(39), stage_id: id(38), client_id: CLIENT_AILLEURS, title: 'Ailleurs', assigned_user_id: null, deleted_at: null },
    ],
  });

  it('modifie le titre, le responsable et la date visée sur `deals`, borné à l’entreprise', async () => {
    const b = avecDeals();
    const r = await outil('update_deal')({ deal_id: DEAL, title: 'Toiture et gouttières', assigned_user_id: VENDEUR, expected_close_date: '2026-12-01' }, b.ctx);
    expect(b.tables.deals[0]).toMatchObject({ title: 'Toiture et gouttières', assigned_user_id: VENDEUR, expected_close_date: '2026-12-01' });
    expect(b.tables.deals[0].assigned_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const ecrit = b.ecritures();
    expect(ecrit).toHaveLength(1);
    expect(ecrit[0]).toMatchObject({ table: 'deals', op: 'update' });
    expect(ecrit[0].filtres).toEqual(expect.arrayContaining([['eq', 'org_id', ORG], ['eq', 'id', DEAL], ['is', 'deleted_at', null]]));
    toutEstBorneALOrg(b.requetes);
    expect(r).toMatchObject({ updated: true, deal: { title: 'Toiture et gouttières', client: 'Marie Tremblay', responsable: 'Luc Roy', expected_close_date: '2026-12-01' } });
    expect(r.note).toMatch(/titre changé, assigné à Luc Roy, fermeture visée le 2026-12-01/);
  });

  it('clear_assignee retire le responsable ; un titre vide retire le titre', async () => {
    const b = avecDeals();
    b.tables.deals[0].assigned_user_id = VENDEUR;
    const r = await outil('update_deal')({ deal_id: DEAL, clear_assignee: true, title: '' }, b.ctx);
    expect(b.tables.deals[0]).toMatchObject({ assigned_user_id: null, assigned_at: null, title: null });
    expect(r.note).toMatch(/titre retiré, responsable retiré/);
  });

  it('un deal d’une autre entreprise est refusé et reste intact', async () => {
    const b = avecDeals();
    await expect(outil('update_deal')({ deal_id: DEAL_AILLEURS, title: 'Piraté' }, b.ctx)).rejects.toThrow(/Deal introuvable dans le pipeline de cette entreprise/);
    expect(b.tables.deals[1].title).toBe('Ailleurs');
    expect(b.ecritures()).toEqual([]);
  });

  it('entrées invalides refusées avant toute écriture — et le montant renvoie vers le devis', async () => {
    const cas: Array<[Ligne, RegExp]> = [
      [{ deal_id: 'le-deal', title: 'X' }, /Le deal n’est pas un identifiant valide/],
      [{ deal_id: DEAL }, /Aucun champ à modifier.*update_quote/],
      [{ deal_id: DEAL, assigned_user_id: VENDEUR, clear_assignee: true }, /pas les deux/],
      [{ deal_id: DEAL, expected_close_date: 'demain' }, /date au format AAAA-MM-JJ/],
      [{ deal_id: DEAL, assigned_user_id: id(12) }, /ne fait pas partie de l’équipe/],
    ];
    for (const [args, message] of cas) {
      const b = avecDeals();
      await expect(outil('update_deal')(args, b.ctx), JSON.stringify(args)).rejects.toThrow(message);
      expect(b.ecritures(), JSON.stringify(args)).toEqual([]);
    }
  });
});

/* ── 3. Devis ────────────────────────────────────────────────── */

function devisDeBase(devis: Ligne = {}) {
  return base({
    quotes: [
      {
        id: DEVIS, org_id: ORG, quote_number: 'Q-0008', title: 'Lavage', status: 'awaiting_response', lead_id: CLIENT,
        subtotal_cents: 100000, tax_rate: 15, discount_type: null, discount_value: 0, discount_cents: 0, tax_cents: 15000, total_cents: 115000,
        deposit_required: false, deposit_type: null, deposit_value: 0, approved_at: null, deleted_at: null, ...devis,
      },
      { id: DEVIS_AILLEURS, org_id: AUTRE_ORG, quote_number: 'Q-0001', title: 'Ailleurs', status: 'awaiting_response', subtotal_cents: 5000, deleted_at: null },
    ],
    quote_status_history: [],
    pipeline_deals: [
      { id: CARTE, org_id: ORG, lead_id: CLIENT, stage: 'quote_sent', created_at: '2026-09-01T00:00:00Z', deleted_at: null },
      { id: id(61), org_id: AUTRE_ORG, lead_id: CLIENT, stage: 'quote_sent', created_at: '2026-09-20T00:00:00Z', deleted_at: null },
    ],
  }, {
    set_deal_stage: () => ({ data: { ok: true }, error: null }),
    // Le calcul de la base (rpc_recalculate_quote) : rabais, taxe sur le net, total.
    rpc_recalculate_quote: (args, tables) => {
      const q = tables.quotes.find((l) => l.id === args.p_quote_id);
      if (!q) return { data: null, error: { message: 'Not authorized for this quote.' } };
      q.discount_cents = q.discount_type === 'percentage' ? Math.round(q.subtotal_cents * q.discount_value / 100) : q.discount_type === 'fixed' ? Math.round(q.discount_value * 100) : 0;
      q.tax_cents = Math.round((q.subtotal_cents - q.discount_cents) * q.tax_rate / 100);
      q.total_cents = q.subtotal_cents - q.discount_cents + q.tax_cents;
      return { data: null, error: null };
    },
  });
}

describe('set_quote_status', () => {
  it('approuvé : statut + approved_at sur `quotes`, journal du statut, ancien tableau synchronisé comme l’écran', async () => {
    const b = devisDeBase();
    const r = await outil('set_quote_status')({ quote_id: DEVIS, status: 'approved' }, b.ctx);
    expect(b.tables.quotes[0].status).toBe('approved');
    expect(b.tables.quotes[0].approved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const maj = b.ecritures().find((q) => q.table === 'quotes');
    expect(maj?.filtres).toEqual(expect.arrayContaining([['eq', 'org_id', ORG], ['eq', 'id', DEVIS], ['is', 'deleted_at', null]]));
    expect(Object.keys(maj?.valeurs).sort()).toEqual(['approved_at', 'status', 'updated_at']);
    expect(b.tables.quote_status_history).toEqual([{ quote_id: DEVIS, old_status: 'awaiting_response', new_status: 'approved', changed_by: MOI, reason: null }]);
    // La carte de l'ancien tableau est celle de CETTE entreprise, pas la plus récente d'une autre.
    expect(b.rpcAppels).toEqual([{ nom: 'set_deal_stage', args: { p_deal_id: CARTE, p_stage: 'closed_won' } }]);
    toutEstBorneALOrg(b.requetes);
    expect(r).toMatchObject({ updated: true, changed: true, quote: { quote_number: 'Q-0008', statut: 'accepté' }, de: 'en attente de réponse' });
    expect(r.note).toMatch(/Devis marqué approuvé/);
    expect(executerIdempotent).toHaveBeenCalledWith(expect.anything(), 'set_quote_status', expect.anything(), expect.any(Function));
  });

  it('en attente de réponse : pas d’approved_at, ancien tableau à « devis envoyé »', async () => {
    const b = devisDeBase({ status: 'approved', approved_at: '2026-09-10T00:00:00Z' });
    const r = await outil('set_quote_status')({ quote_id: DEVIS, status: 'awaiting_response' }, b.ctx);
    expect(b.tables.quotes[0].status).toBe('awaiting_response');
    expect(Object.keys(b.ecritures().find((q) => q.table === 'quotes')?.valeurs).sort()).toEqual(['status', 'updated_at']);
    expect(b.rpcAppels).toEqual([{ nom: 'set_deal_stage', args: { p_deal_id: CARTE, p_stage: 'quote_sent' } }]);
    expect(r.note).toBe('Devis remis « en attente de réponse ».');
  });

  it('déjà dans ce statut : rien n’est réécrit (l’événement « devis accepté » ne repart pas)', async () => {
    const b = devisDeBase({ status: 'approved' });
    const r = await outil('set_quote_status')({ quote_id: DEVIS, status: 'approved' }, b.ctx);
    expect(r).toMatchObject({ updated: true, changed: false });
    expect(b.ecritures()).toEqual([]);
    expect(b.rpcAppels).toEqual([]);
  });

  it('devis d’une autre entreprise, devis converti, statut ou identifiant invalide : refus avant toute écriture', async () => {
    const cas: Array<[Ligne, Ligne, RegExp]> = [
      [{}, { quote_id: DEVIS_AILLEURS, status: 'approved' }, /Devis introuvable dans cette entreprise/],
      [{ status: 'converted' }, { quote_id: DEVIS, status: 'awaiting_response' }, /déjà converti/],
      [{}, { quote_id: DEVIS, status: 'declined' }, /« approved » \(approuvé\) ou « awaiting_response ».*cancel_quote/],
      [{}, { quote_id: 'Q-0008', status: 'approved' }, /Le devis n’est pas un identifiant valide/],
    ];
    for (const [devis, args, message] of cas) {
      const b = devisDeBase(devis);
      await expect(outil('set_quote_status')(args, b.ctx), JSON.stringify(args)).rejects.toThrow(message);
      expect(b.ecritures(), JSON.stringify(args)).toEqual([]);
      expect(b.rpcAppels, JSON.stringify(args)).toEqual([]);
    }
    expect(devisDeBase().tables.quotes[1].status).toBe('awaiting_response');
  });
});

describe('set_quote_discount_deposit', () => {
  it('rabais + dépôt : écrit les réglages, laisse la base recalculer les totaux', async () => {
    const b = devisDeBase();
    const r = await outil('set_quote_discount_deposit')({
      quote_id: DEVIS, discount_type: 'percentage', discount_value: 10, deposit_required: true, deposit_type: 'percentage', deposit_value: 25,
    }, b.ctx);
    const ecrit = b.ecritures();
    expect(ecrit).toHaveLength(1);
    expect(ecrit[0]).toMatchObject({ table: 'quotes', op: 'update' });
    expect(ecrit[0].filtres).toEqual(expect.arrayContaining([['eq', 'org_id', ORG], ['eq', 'id', DEVIS], ['is', 'deleted_at', null]]));
    // Jamais de projection écrite à la main : ni total, ni sous-total, ni *_cents.
    expect(Object.keys(ecrit[0].valeurs).sort()).toEqual(['deposit_required', 'deposit_type', 'deposit_value', 'discount_type', 'discount_value', 'updated_at']);
    expect(ecrit[0].valeurs).toMatchObject({ discount_type: 'percentage', discount_value: 10, deposit_required: true, deposit_type: 'percentage', deposit_value: 25 });
    expect(b.rpcAppels).toEqual([{ nom: 'rpc_recalculate_quote', args: { p_quote_id: DEVIS } }]);
    toutEstBorneALOrg(b.requetes);
    expect(r).toMatchObject({
      updated: true, subtotal_cents: 100000, discount_cents: 10000, discount_percent: 10, tax_cents: 13500, total_cents: 103500,
      deposit_required: true, deposit_cents: 25875, deposit_percent: 25, quote: { quote_number: 'Q-0008', statut: 'en attente de réponse' },
    });
    // Devis déjà chez le client : la note le dit.
    expect(r.note).toMatch(/Le client voit ces nouveaux montants/);
  });

  it('dépôt seul (montant fixe en dollars) : aucun recalcul demandé', async () => {
    const b = devisDeBase({ status: 'draft' });
    const r = await outil('set_quote_discount_deposit')({ quote_id: DEVIS, deposit_type: 'fixed', deposit_value: 200 }, b.ctx);
    expect(b.ecritures()[0].valeurs).toMatchObject({ deposit_required: true, deposit_type: 'fixed', deposit_value: 200 });
    expect(b.ecritures()[0].valeurs).not.toHaveProperty('discount_value');
    expect(b.rpcAppels).toEqual([]);
    expect(r).toMatchObject({ deposit_required: true, deposit_cents: 20000, total_cents: 115000 });
    expect(r.note).toMatch(/Rien n’est parti chez le client/);
  });

  it('discount_value 0 retire le rabais ; deposit_required false retire le dépôt', async () => {
    const b = devisDeBase({ discount_type: 'fixed', discount_value: 50, discount_cents: 5000, deposit_required: true, deposit_type: 'percentage', deposit_value: 30 });
    const r = await outil('set_quote_discount_deposit')({ quote_id: DEVIS, discount_value: 0, deposit_required: false }, b.ctx);
    expect(b.tables.quotes[0]).toMatchObject({ discount_type: null, discount_value: 0, deposit_required: false, deposit_type: null, deposit_value: 0, total_cents: 115000 });
    expect(r).toMatchObject({ discount_cents: 0, deposit_required: false, deposit_cents: 0 });
  });

  it('refus avant toute écriture : rien à modifier, valeurs hors bornes, type manquant, devis converti ou d’une autre entreprise', async () => {
    const cas: Array<[Ligne, Ligne, RegExp]> = [
      [{}, { quote_id: DEVIS }, /Rien à modifier/],
      [{}, { quote_id: DEVIS, discount_type: 'percentage', discount_value: 120 }, /ne peut pas dépasser 100 %/],
      [{}, { quote_id: DEVIS, discount_type: 'fixed', discount_value: 1500 }, /dépasse le sous-total du devis/],
      [{}, { quote_id: DEVIS, discount_value: 10 }, /Précise le type de rabais/],
      [{}, { quote_id: DEVIS, discount_type: 'moitie', discount_value: 10 }, /Le type de rabais doit être/],
      [{}, { quote_id: DEVIS, discount_type: 'fixed', discount_value: -5 }, /Le rabais doit être un nombre positif/],
      [{}, { quote_id: DEVIS, deposit_type: 'fixed', deposit_value: 2000 }, /dépasse le total du devis/],
      [{}, { quote_id: DEVIS, deposit_required: true }, /Précise le type de dépôt/],
      [{}, { quote_id: DEVIS, deposit_required: false, deposit_value: 100 }, /pas les deux/],
      [{}, { quote_id: DEVIS, deposit_required: 'oui' }, /deposit_required doit être vrai ou faux/],
      [{ status: 'converted' }, { quote_id: DEVIS, discount_type: 'percentage', discount_value: 5 }, /déjà converti/],
      [{}, { quote_id: DEVIS_AILLEURS, discount_type: 'percentage', discount_value: 5 }, /Devis introuvable dans cette entreprise/],
      [{}, { quote_id: '8', discount_type: 'percentage', discount_value: 5 }, /Le devis n’est pas un identifiant valide/],
    ];
    for (const [devis, args, message] of cas) {
      const b = devisDeBase(devis);
      await expect(outil('set_quote_discount_deposit')(args, b.ctx), JSON.stringify(args)).rejects.toThrow(message);
      expect(b.ecritures(), JSON.stringify(args)).toEqual([]);
      expect(b.rpcAppels, JSON.stringify(args)).toEqual([]);
    }
  });

  it('recalcul raté après l’écriture : résultat « incomplet » RENVOYÉ (l’empreinte reste, pas de seconde écriture)', async () => {
    const b = base(devisDeBase().tables, { rpc_recalculate_quote: () => ({ data: null, error: { message: 'boom' } }) });
    const r = await outil('set_quote_discount_deposit')({ quote_id: DEVIS, discount_type: 'percentage', discount_value: 10 }, b.ctx);
    expect(r).toMatchObject({ updated: true, incomplet: true });
    expect(r.note).not.toMatch(/boom/);
  });
});

/* ── 4. Consentement commercial ──────────────────────────────── */

function clientsDeBase(fiche: Ligne = {}, extra: Record<string, Ligne[]> = {}) {
  return base({
    clients: [
      { id: CLIENT, org_id: ORG, first_name: 'Marie', last_name: 'Tremblay', email: 'marie@exemple.test', phone: '514-555-0101', status: 'active', email_consent_at: null, sms_consent_at: null, email_opt_out_at: null, deleted_at: null, ...fiche },
      { id: CLIENT_AILLEURS, org_id: AUTRE_ORG, first_name: 'Autre', last_name: 'Bureau', status: 'active', email_consent_at: null, sms_consent_at: null, deleted_at: null },
    ],
    jobs: [], invoices: [], quotes: [],
    ...extra,
  });
}

describe('get_client_consent', () => {
  it('exprès sur un canal, tacite sur l’autre — lu sur `clients` et les trois ancrages, bornés à l’entreprise', async () => {
    const b = clientsDeBase({ email_consent_at: EXPRES }, {
      jobs: [
        { id: id(80), org_id: ORG, client_id: CLIENT, created_at: ilYA(30), deleted_at: null },
        // Un job d'une autre entreprise ne fonde rien ici.
        { id: id(81), org_id: AUTRE_ORG, client_id: CLIENT, created_at: ilYA(1), deleted_at: null },
      ],
    });
    const r = await outil('get_client_consent')({ client_id: CLIENT }, b.ctx);
    expect(b.requetes.map((q) => q.table).sort()).toEqual(['clients', 'invoices', 'jobs', 'quotes']);
    expect(b.ecritures()).toEqual([]);
    toutEstBorneALOrg(b.requetes);
    expect(r).toMatchObject({
      client: 'Marie Tremblay',
      email: { consentement_expres_depuis: EXPRES, desabonne: false, envoi_commercial_permis: true, base: 'consentement exprès' },
      sms: { consentement_expres_depuis: null, envoi_commercial_permis: true, base: 'consentement tacite (relation d’affaires, 2 ans)' },
    });
    expect(r.sms.jusqu_au).toMatch(/^\d{4}-/);
  });

  it('aucune base : envoi commercial non permis ; un désabonnement prime sur un consentement exprès', async () => {
    const rien = await outil('get_client_consent')({ client_id: CLIENT }, clientsDeBase().ctx);
    expect(rien).toMatchObject({ email: { envoi_commercial_permis: false, base: 'aucune' }, sms: { envoi_commercial_permis: false, base: 'aucune' } });
    const desabonne = await outil('get_client_consent')({ client_id: CLIENT }, clientsDeBase({ email_consent_at: EXPRES, email_opt_out_at: ilYA(60) }).ctx);
    expect(desabonne.email).toMatchObject({ desabonne: true, envoi_commercial_permis: false, base: 'aucune' });
  });

  it('client d’une autre entreprise ou identifiant invalide : phrase française, aucune donnée', async () => {
    expect(await outil('get_client_consent')({ client_id: CLIENT_AILLEURS }, clientsDeBase().ctx)).toEqual({ error: expect.stringMatching(/Client introuvable dans cette entreprise/) });
    const b = clientsDeBase();
    expect(await outil('get_client_consent')({ client_id: 'marie' }, b.ctx)).toEqual({ error: expect.stringMatching(/identifiant valide/) });
    expect(b.requetes).toEqual([]);
  });
});

describe('set_client_consent', () => {
  it('accorde le consentement SMS : colonne `clients.sms_consent_at` + journal par la route de l’écran', async () => {
    const b = clientsDeBase();
    const r = await outil('set_client_consent')({ client_id: CLIENT, channel: 'sms', granted: true }, b.ctx);
    expect(b.tables.clients[0].sms_consent_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(b.tables.clients[0].email_consent_at).toBeNull();
    const ecrit = b.ecritures();
    expect(ecrit).toHaveLength(1);
    expect(ecrit[0].table).toBe('clients');
    expect(Object.keys(ecrit[0].valeurs)).toEqual(['sms_consent_at']);
    expect(ecrit[0].filtres).toEqual(expect.arrayContaining([['eq', 'org_id', ORG], ['eq', 'id', CLIENT], ['is', 'deleted_at', null]]));
    toutEstBorneALOrg(b.requetes);
    expect(appel).toHaveBeenCalledTimes(1);
    expect(appel).toHaveBeenCalledWith(expect.anything(), '/dsr/consent', {
      subject_type: 'client', subject_id: CLIENT, purpose: 'sms-marketing', granted: true, method: 'crm-manual', org_id: ORG,
    });
    expect(r).toMatchObject({ updated: true, client: 'Marie Tremblay', canal: 'texto', consent: true, journal_ecrit: true });
    expect(r.note).toMatch(/Consentement exprès au texto enregistré pour Marie Tremblay\.$/);
    expect(executerIdempotent).toHaveBeenCalledWith(expect.anything(), 'set_client_consent', expect.anything(), expect.any(Function));
  });

  it('retire le consentement courriel : colonne remise à null, retrait journalisé', async () => {
    const b = clientsDeBase({ email_consent_at: EXPRES });
    const r = await outil('set_client_consent')({ client_id: CLIENT, channel: 'email', granted: false }, b.ctx);
    expect(b.tables.clients[0].email_consent_at).toBeNull();
    expect(appel).toHaveBeenCalledWith(expect.anything(), '/dsr/consent', expect.objectContaining({ purpose: 'email-marketing', granted: false }));
    expect(r.note).toMatch(/Consentement au courriel retiré/);
  });

  it('déjà accordé : la date (la preuve) n’est pas réécrite, rien n’est journalisé', async () => {
    const b = clientsDeBase({ sms_consent_at: '2026-01-15T10:00:00.000Z' });
    const r = await outil('set_client_consent')({ client_id: CLIENT, channel: 'sms', granted: true }, b.ctx);
    expect(r).toMatchObject({ updated: false, depuis: '2026-01-15T10:00:00.000Z' });
    expect(b.tables.clients[0].sms_consent_at).toBe('2026-01-15T10:00:00.000Z');
    expect(b.ecritures()).toEqual([]);
    expect(appel).not.toHaveBeenCalled();
  });

  it('journal raté ou réponse perdue : le consentement reste enregistré, et on le dit', async () => {
    appel.mockResolvedValue({ ok: false, status: 500, json: { error: 'Failed to record consent.' } });
    const b = clientsDeBase();
    const r = await outil('set_client_consent')({ client_id: CLIENT, channel: 'email', granted: true }, b.ctx);
    expect(b.tables.clients[0].email_consent_at).toMatch(/^\d{4}-/);
    expect(r).toMatchObject({ updated: true, journal_ecrit: false });
    expect(r.note).toMatch(/journal de preuve n’a pas pu être écrit/);

    appel.mockRejectedValue(new AppelInterneIncertain('timeout'));
    const perdu = await outil('set_client_consent')({ client_id: CLIENT, channel: 'sms', granted: true }, clientsDeBase().ctx);
    expect(perdu).toMatchObject({ updated: true, journal_ecrit: false });
  });

  it('un client désabonné des courriels : le consentement est noté, mais la note dit que le désabonnement prime', async () => {
    const r = await outil('set_client_consent')({ client_id: CLIENT, channel: 'email', granted: true }, clientsDeBase({ email_opt_out_at: ilYA(60) }).ctx);
    expect(r.note).toMatch(/le désabonnement prime/);
  });

  it('client d’une autre entreprise ou entrée invalide : refus avant toute écriture et tout journal', async () => {
    const cas: Array<[Ligne, RegExp]> = [
      [{ client_id: CLIENT_AILLEURS, channel: 'sms', granted: true }, /Client introuvable dans cette entreprise/],
      [{ client_id: CLIENT, channel: 'fax', granted: true }, /Le canal doit être « email » \(courriel\) ou « sms » \(texto\)/],
      [{ client_id: CLIENT, channel: 'sms', granted: 'oui' }, /Précise si le client consent/],
      [{ client_id: CLIENT, channel: 'sms' }, /Précise si le client consent/],
      [{ client_id: 'marie', channel: 'sms', granted: true }, /Le client n’est pas un identifiant valide/],
    ];
    for (const [args, message] of cas) {
      const b = clientsDeBase();
      await expect(outil('set_client_consent')(args, b.ctx), JSON.stringify(args)).rejects.toThrow(message);
      expect(b.ecritures(), JSON.stringify(args)).toEqual([]);
      expect(appel, JSON.stringify(args)).not.toHaveBeenCalled();
    }
  });
});

/* ── 5. Archives ─────────────────────────────────────────────── */

/** La fonction de la base ne rend que les archives de l'entreprise DEMANDÉE. */
const ARCHIVES: Record<string, Ligne> = {
  [ORG]: {
    clients: [{ id: ARCHIVE_CLIENT, type: 'client', name: 'Marie Tremblay', company: 'Résidences T', email: 'marie@exemple.test', status: 'active', archived_at: '2026-09-20T10:00:00Z' }],
    leads: [{ id: ARCHIVE_LEAD, type: 'lead', name: 'Paul Gagnon', company: null, status: 'no_response', archived_at: '2026-09-25T10:00:00Z' }],
    jobs: [{ id: ARCHIVE_JOB, type: 'job', name: 'Lavage de vitres', client_name: 'Marie Tremblay', job_number: '33', status: 'cancelled', archived_at: '2026-09-10T10:00:00Z' }],
  },
  [AUTRE_ORG]: { clients: [{ id: id(79), type: 'client', name: 'Client Ailleurs', archived_at: '2026-09-28T10:00:00Z' }], leads: [], jobs: [] },
};

function archivesDeBase(role = 'owner', rpcs: Record<string, Rpc> = {}) {
  return base({
    memberships: [
      { org_id: ORG, user_id: MOI, role },
      { org_id: AUTRE_ORG, user_id: MOI, role: 'owner' },
    ],
  }, {
    list_archived_items: (args) => ({ data: ARCHIVES[args.p_org_id] ?? { clients: [], leads: [], jobs: [] }, error: null }),
    restore_client: () => ({ data: { client: 1, jobs: 2 }, error: null }),
    restore_lead: () => ({ data: { lead: 1 }, error: null }),
    restore_job: () => ({ data: { job: 1 }, error: null }),
    ...rpcs,
  });
}

describe('list_archived', () => {
  it('lit les archives de CETTE entreprise par la fonction de l’écran, du plus récent au plus ancien', async () => {
    const b = archivesDeBase();
    const r = await outil('list_archived')({}, b.ctx);
    expect(b.rpcAppels).toEqual([{ nom: 'list_archived_items', args: { p_org_id: ORG } }]);
    expect(r).toMatchObject({ counts: { clients: 1, leads: 1, jobs: 1 }, total_matching: 3, shown: 3 });
    expect(r.items.map((i: Ligne) => i.id)).toEqual([ARCHIVE_LEAD, ARCHIVE_CLIENT, ARCHIVE_JOB]);
    expect(r.items[0]).toMatchObject({ type: 'lead', genre: 'prospect', name: 'Paul Gagnon' });
    expect(r.items[2]).toMatchObject({ type: 'job', name: 'Lavage de vitres', client: 'Marie Tremblay', job_number: '33' });
    expect(JSON.stringify(r)).not.toMatch(/Client Ailleurs|marie@exemple\.test/);
  });

  it('filtre par type et par mots ; une panne devient une phrase, jamais le texte de la base', async () => {
    const b = archivesDeBase();
    expect((await outil('list_archived')({ entity_type: 'job' }, b.ctx)).items.map((i: Ligne) => i.id)).toEqual([ARCHIVE_JOB]);
    expect((await outil('list_archived')({ query: 'residences' }, b.ctx)).items.map((i: Ligne) => i.id)).toEqual([ARCHIVE_CLIENT]);
    expect(await outil('list_archived')({ query: 'introuvable' }, b.ctx)).toMatchObject({ total_matching: 0, items: [] });
    const panne = archivesDeBase('owner', { list_archived_items: () => ({ data: null, error: { code: '42501', message: 'Not authorized for this organization.' } }) });
    const r = await outil('list_archived')({}, panne.ctx);
    expect(r.error).toMatch(/La consultation a échoué côté Lume/);
    expect(r.error).not.toMatch(/authorized/);
  });
});

describe('restore_archived', () => {
  it('client : restore_client avec l’entreprise du contexte ; la note compte les jobs revenus', async () => {
    const b = archivesDeBase();
    const r = await outil('restore_archived')({ entity_type: 'client', entity_id: ARCHIVE_CLIENT }, b.ctx);
    expect(b.rpcAppels.map((a) => a.nom)).toEqual(['list_archived_items', 'restore_client']);
    expect(b.rpcAppels[1].args).toEqual({ p_org_id: ORG, p_client_id: ARCHIVE_CLIENT });
    toutEstBorneALOrg(b.requetes);
    expect(r).toMatchObject({ restored: true, item: { type: 'client', name: 'Marie Tremblay' }, jobs_restored: 2 });
    expect(r.note).toMatch(/Marie Tremblay est sorti des archives.*avec 2 job\(s\)/);
    expect(executerIdempotent).toHaveBeenCalledWith(expect.anything(), 'restore_archived', expect.anything(), expect.any(Function));
  });

  it('prospect et job : la fonction et le nom d’argument de leur type', async () => {
    const b = archivesDeBase('admin');
    await outil('restore_archived')({ entity_type: 'lead', entity_id: ARCHIVE_LEAD }, b.ctx);
    const r = await outil('restore_archived')({ entity_type: 'job', entity_id: ARCHIVE_JOB }, b.ctx);
    expect(b.rpcAppels.filter((a) => a.nom.startsWith('restore_'))).toEqual([
      { nom: 'restore_lead', args: { p_org_id: ORG, p_lead_id: ARCHIVE_LEAD } },
      { nom: 'restore_job', args: { p_org_id: ORG, p_job_id: ARCHIVE_JOB } },
    ]);
    expect(r).toMatchObject({ restored: true, item: { type: 'job', genre: 'job', name: 'Lavage de vitres' } });
    expect(r).not.toHaveProperty('jobs_restored');
  });

  it('refus sans aucune restauration : autre entreprise, mauvais type, rôle insuffisant, entrée invalide', async () => {
    const cas: Array<[string, Ligne, RegExp]> = [
      ['owner', { entity_type: 'client', entity_id: id(79) }, /n’est pas dans les archives de cette entreprise/],
      ['owner', { entity_type: 'client', entity_id: ARCHIVE_LEAD }, /est un prospect, pas un client/],
      ['sales_rep', { entity_type: 'client', entity_id: ARCHIVE_CLIENT }, /réservé au propriétaire et aux administrateurs/],
      ['owner', { entity_type: 'quote', entity_id: ARCHIVE_CLIENT }, /Le type doit être « client », « lead » \(prospect\) ou « job »/],
      ['owner', { entity_type: 'client', entity_id: 'marie' }, /n’est pas un identifiant valide/],
    ];
    for (const [role, args, message] of cas) {
      const b = archivesDeBase(role);
      await expect(outil('restore_archived')(args, b.ctx), JSON.stringify(args)).rejects.toThrow(message);
      expect(b.rpcAppels.filter((a) => a.nom.startsWith('restore_')), JSON.stringify(args)).toEqual([]);
    }
  });

  it('la base refuse ou ne restaure rien : phrase française, jamais le texte brut', async () => {
    const refus = archivesDeBase('owner', { restore_client: () => ({ data: null, error: { code: '42501', message: 'Only owner/admin can restore clients' } }) });
    await expect(outil('restore_archived')({ entity_type: 'client', entity_id: ARCHIVE_CLIENT }, refus.ctx)).rejects.toThrow(/réservé au propriétaire et aux administrateurs/);

    const panne = archivesDeBase('owner', { restore_job: () => ({ data: null, error: { code: '0A000', message: 'UPDATE is not allowed in a non-volatile function' } }) });
    const erreur = await outil('restore_archived')({ entity_type: 'job', entity_id: ARCHIVE_JOB }, panne.ctx).catch((e: Error) => e.message);
    expect(erreur).toMatch(/Impossible de restaurer ce job\. Dis-le simplement/);
    expect(erreur).not.toMatch(/UPDATE|volatile/);

    const vide = archivesDeBase('owner', { restore_lead: () => ({ data: { lead: 0 }, error: null }) });
    await expect(outil('restore_archived')({ entity_type: 'lead', entity_id: ARCHIVE_LEAD }, vide.ctx)).rejects.toThrow(/Rien n’a été restauré/);
  });
});
