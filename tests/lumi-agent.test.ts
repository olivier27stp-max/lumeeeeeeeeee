/**
 * LUMI — L'ASSISTANT IA DANS L'APPLICATION.
 *
 * Décision produit (2026-09-10) : l'IA tourne sur NOTRE API (Claude Opus 5),
 * pas via le MCP du client. Ces tests figent ce qui protège l'argent et les
 * données :
 *   - le coût d'un appel se calcule au tarif du modèle, en cents décimaux
 *   - le budget mensuel par plan (Autopilot 150 $, Scale 80 $) est lu en
 *     base et un tour est REFUSÉ avant l'appel quand il est atteint
 *   - un outil de LECTURE s'exécute avec les gardes du MCP (permission de la
 *     page Rôles) ; un outil d'ÉCRITURE n'est JAMAIS exécuté par
 *     l'orchestrateur : il devient une proposition à confirmer
 *   - une proposition sans réponse est retrouvée (et annulée par le message
 *     suivant) pour que l'historique reste valide pour l'API
 *   - le lecteur SSE du client découpe correctement les événements
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Tarifs ──────────────────────────────────────────────────────
describe('coût d un appel', () => {
  it('Opus 5 : entrée 5 $, sortie 25 $, cache lu 0,50 $, cache écrit 6,25 $ par million', async () => {
    const { coutEnCents } = await import('../server/lib/lumi/tarifs');
    // 1 000 entrée + 500 sortie + 12 000 cache lu + 0 cache écrit
    // = 0,005 + 0,0125 + 0,006 = 0,0235 $ = 2,35 ¢
    expect(coutEnCents('claude-opus-5', { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 12000, cache_creation_input_tokens: 0 })).toBe(2.35);
  });
  it('un modèle inconnu est facturé au tarif Opus 5 — jamais 0', async () => {
    const { coutEnCents } = await import('../server/lib/lumi/tarifs');
    expect(coutEnCents('modele-mystere', { input_tokens: 1_000_000, output_tokens: 0 })).toBe(500);
  });
  it('LUMI_MODEL n est honoré que s il est tarifé', async () => {
    const { modeleLumi } = await import('../server/lib/lumi/tarifs');
    expect(modeleLumi({ LUMI_MODEL: 'claude-sonnet-5' } as any)).toBe('claude-sonnet-5');
    expect(modeleLumi({ LUMI_MODEL: 'gpt-9' } as any)).toBe('claude-opus-5');
    expect(modeleLumi({} as any)).toBe('claude-opus-5');
  });
});

// ── Budget ──────────────────────────────────────────────────────
function adminFactice(plan: any, depenses: Record<string, number>) {
  return {
    from: vi.fn((table: string) => {
      const c: any = {};
      for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = vi.fn(() => c);
      c.maybeSingle = vi.fn(async () => ({ data: table === 'subscriptions' ? (plan ? { status: 'active', plans: plan } : null) : { company_group_id: null }, error: null }));
      c.insert = vi.fn(async () => ({ error: null }));
      c.then = (r: any) => r({ data: [], error: null });
      return c;
    }),
    rpc: vi.fn(async (fn: string, args: any) => ({ data: fn === 'lumi_depense_du_mois' ? (depenses[args.p_org] ?? 0) : null, error: null })),
  };
}
vi.mock('../server/lib/supabase', () => ({
  companyOrgIds: async (_a: unknown, orgId: string) => [orgId],
  getServiceClient: () => ({ rpc: async () => ({ data: false }) }),
}));

describe('budget mensuel', () => {
  it('Autopilot : 150 $, dépense lue en base, reste calculé', async () => {
    const { etatBudget } = await import('../server/lib/lumi/budget');
    const b = await etatBudget(adminFactice({ slug: 'autopilot', includes_ai: true, ai_monthly_budget_cents: 15000 }, { 'org-1': 1234.5 }) as any, 'org-1');
    expect(b).toMatchObject({ plan_slug: 'autopilot', includes_ai: true, budget_cents: 15000, depense_cents: 1234.5, reste_cents: 13765.5, epuise: false });
  });
  it('Scale : 80 $ — épuisé quand la dépense atteint le budget', async () => {
    const { etatBudget } = await import('../server/lib/lumi/budget');
    const b = await etatBudget(adminFactice({ slug: 'pro', includes_ai: true, ai_monthly_budget_cents: 8000 }, { 'org-1': 8000 }) as any, 'org-1');
    expect(b.epuise).toBe(true);
    expect(b.reste_cents).toBe(0);
  });
  it('plan sans IA (ou sans abonnement) → pas de Lumi, sans lire la dépense', async () => {
    const { etatBudget } = await import('../server/lib/lumi/budget');
    const admin = adminFactice({ slug: 'starter', includes_ai: false, ai_monthly_budget_cents: 0 }, { 'org-1': 0 });
    const b = await etatBudget(admin as any, 'org-1');
    expect(b.includes_ai).toBe(false);
    expect(admin.rpc).not.toHaveBeenCalled();
    const b2 = await etatBudget(adminFactice(null, {}) as any, 'org-1');
    expect(b2.includes_ai).toBe(false);
  });
});

// ── Orchestrateur (SDK simulé) ──────────────────────────────────
const reponses: any[] = [];
function fluxFactice(reponse: any) {
  const handlers: Record<string, (...a: any[]) => void> = {};
  return {
    on(ev: string, fn: (...a: any[]) => void) { handlers[ev] = fn; return this; },
    async finalMessage() {
      for (const b of reponse.content) if (b.type === 'text' && handlers.text) handlers.text(b.text, b.text);
      return reponse;
    },
  };
}
// L'orchestrateur mute son tableau `messages` : on fige une copie par appel.
const instantanes: any[] = [];
const streamSpy = vi.fn((params: any) => { instantanes.push(JSON.parse(JSON.stringify(params))); return fluxFactice(reponses.shift()); });
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { stream: streamSpy }; } }));

const outilsExecutes: Array<{ name: string; args: any }> = [];
vi.mock('../server/lib/agent/garde', () => ({
  PERMISSION_PAR_OUTIL: { list_invoices: { cle: 'invoices.read', capacite: 'la consultation des factures' }, create_job: { cle: 'jobs.create', capacite: 'la création de jobs' } },
  executerOutilGarde: async (o: any) => {
    outilsExecutes.push({ name: o.name, args: o.args });
    if (o.name === 'get_payroll_summary') return { refus: 'Les accès Lume de cette personne n\'incluent pas la paie.' };
    return { result: { ok: true, lignes: [{ id: 'inv-1', total_cents: 100 }] } };
  },
}));
vi.mock('../server/lib/agent/tools', () => ({
  AGENT_TOOLS: [
    { kind: 'read', declaration: { name: 'list_invoices', description: 'Liste', parameters: { type: 'object', properties: {} } } },
    { kind: 'read', declaration: { name: 'get_payroll_summary', description: 'Paie', parameters: { type: 'object', properties: {} } } },
    { kind: 'write', declaration: { name: 'create_job', description: 'Crée', parameters: { type: 'object', properties: { title: { type: 'string' } } } } },
  ],
  TOOLS_BY_NAME: {
    list_invoices: { kind: 'read', handler: async () => ({}) },
    get_payroll_summary: { kind: 'read', handler: async () => ({}) },
    create_job: { kind: 'write', handler: async () => ({}) },
  },
}));

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
function baseTour(emis: any[], journal: any[]) {
  return {
    client: {} as any, orgId: 'org-1', userId: 'user-1',
    systeme: [{ type: 'text' as const, text: 'sys' }],
    historique: [{ role: 'user' as const, content: 'Bonjour' }],
    emettre: (e: any) => emis.push(e),
    journaliser: async (u: any, model: string, cost: number) => { journal.push({ u, model, cost }); },
  };
}

beforeEach(() => { reponses.length = 0; outilsExecutes.length = 0; instantanes.length = 0; streamSpy.mockClear(); process.env.ANTHROPIC_API_KEY = 'sk-test'; });

describe('orchestrateur', () => {
  it('texte simple : streamé, journalisé, aucun outil', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'text', text: 'Bonjour !' }], stop_reason: 'end_turn', usage });
    const emis: any[] = [], journal: any[] = [];
    const r = await tourLumi(baseTour(emis, journal));
    expect(r.texte).toBe('Bonjour !');
    expect(r.proposition).toBeNull();
    expect(journal).toHaveLength(1);
    expect(journal[0].model).toBe('claude-opus-5');
    expect(emis.some((e) => e.type === 'text' && e.delta === 'Bonjour !')).toBe(true);
    // Le prompt système et les outils sont mis en cache ; effort medium ; réflexion adaptative.
    const params = instantanes[0];
    expect(params.tools[params.tools.length - 1].cache_control).toEqual({ type: 'ephemeral' });
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config).toEqual({ effort: 'medium' });
  });

  it('outil de LECTURE : exécuté avec les gardes, résultat renvoyé au modèle, second appel', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'tu_1', name: 'list_invoices', input: { status: 'overdue' } }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Une facture en retard.' }], stop_reason: 'end_turn', usage });
    const emis: any[] = [], journal: any[] = [];
    const r = await tourLumi(baseTour(emis, journal));
    expect(outilsExecutes).toEqual([{ name: 'list_invoices', args: { status: 'overdue' } }]);
    expect(streamSpy).toHaveBeenCalledTimes(2);
    const deuxieme = instantanes[1].messages;
    const dernier = deuxieme[deuxieme.length - 1];
    expect(dernier.role).toBe('user');
    expect(dernier.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' });
    expect(r.nouveauxMessages).toHaveLength(3); // assistant(tool_use) + user(tool_result) + assistant(texte)
    expect(journal).toHaveLength(2);
  });

  it('LE GARDE : un outil d ÉCRITURE n est jamais exécuté — il devient une proposition', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'text', text: 'Je prépare le job.' }, { type: 'tool_use', id: 'tu_w', name: 'create_job', input: { title: 'Lavage' } }], stop_reason: 'tool_use', usage });
    const emis: any[] = [], journal: any[] = [];
    const r = await tourLumi(baseTour(emis, journal));
    expect(outilsExecutes).toEqual([]);
    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(r.proposition).toEqual({ tool_use_id: 'tu_w', tool: 'create_job', args: { title: 'Lavage' } });
    expect(emis.find((e) => e.type === 'proposal')).toMatchObject({ tool: 'create_job', capacite: 'la création de jobs' });
  });

  it('refus par la page Rôles : le modèle reçoit le motif, en erreur, sans exécution réelle', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'tu_p', name: 'get_payroll_summary', input: {} }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Votre rôle ne le permet pas.' }], stop_reason: 'end_turn', usage });
    const emis: any[] = [], journal: any[] = [];
    await tourLumi(baseTour(emis, journal));
    const resultat = instantanes[1].messages.at(-1).content[0];
    expect(resultat.is_error).toBe(true);
    expect(resultat.content).toContain('paie');
    expect(emis.find((e) => e.type === 'tool' && e.statut === 'refus')).toBeTruthy();
  });

  it('refus du modèle (stop_reason refusal) → événement error, pas de boucle', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [], stop_reason: 'refusal', usage });
    const emis: any[] = [];
    await tourLumi(baseTour(emis, []));
    expect(emis.find((e) => e.type === 'error')?.message).toBe('refusal');
    expect(streamSpy).toHaveBeenCalledTimes(1);
  });
});

// ── Proposition en attente / rendu ──────────────────────────────
describe('proposition en attente', () => {
  it('retrouvée quand le dernier tool_use d écriture n a pas de tool_result', async () => {
    const { propositionEnAttente } = await import('../server/routes/lumi');
    const msgs: any[] = [
      { role: 'user', content: 'Crée un job' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_w', name: 'create_job', input: { title: 'X' } }] },
    ];
    expect(propositionEnAttente(msgs)).toEqual({ tool_use_id: 'tu_w', tool: 'create_job', args: { title: 'X' } });
    msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_w', content: '{"cancelled":true}' }] });
    expect(propositionEnAttente(msgs)).toBeNull();
  });
  it('rendreMessages : texte, outils consultés, proposition et son sort', async () => {
    const { rendreMessages } = await import('../server/routes/lumi');
    const msgs: any[] = [
      { role: 'user', content: 'Factures ?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'list_invoices', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '[]' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Aucune.' }, { type: 'tool_use', id: 'tu_w', name: 'create_job', input: { title: 'X' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_w', content: '{"executed":true}' }] },
    ];
    const r = rendreMessages(msgs);
    expect(r[0]).toEqual({ role: 'user', text: 'Factures ?', tools: [] });
    expect(r[1]).toMatchObject({ role: 'assistant', tools: ['list_invoices'] });
    expect(r[2]).toMatchObject({ role: 'assistant', text: 'Aucune.', proposal: { tool: 'create_job', statut: 'confirmee' } });
  });
});

// ── Lecteur SSE côté client ─────────────────────────────────────
describe('le client lit le flux SSE', () => {
  it('découpe les événements, même coupés entre deux paquets', async () => {
    const morceaux = [
      'event: text\ndata: {"delta":"Bon"}\n\nevent: te',
      'xt\ndata: {"delta":"jour"}\n\nevent: done\ndata: {"conversation_id":"c1","cost_cents":0.5,"budget":{},"proposal":null}\n\n',
    ];
    const flux = new ReadableStream({
      start(ctl) { for (const m of morceaux) ctl.enqueue(new TextEncoder().encode(m)); ctl.close(); },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(flux, { status: 200 })));
    vi.doMock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } }));
    vi.doMock('../src/lib/deviceToken', () => ({ deviceTokenHeader: () => ({}) }));
    const { envoyerMessageLumi } = await import('../src/lib/lumiApi');
    const recus: any[] = [];
    await envoyerMessageLumi({ conversation_id: null, message: 'x', language: 'fr' }, (e) => recus.push(e));
    expect(recus.map((e) => e.type)).toEqual(['text', 'text', 'done']);
    expect(recus[0].delta + recus[1].delta).toBe('Bonjour');
    expect(recus[2].conversation_id).toBe('c1');
    vi.unstubAllGlobals();
  });
  it('une réponse non-2xx devient une ErreurLumi avec son code (quota, plan)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Monthly AI budget reached.', code: 'quota_epuise', budget: { epuise: true } }), { status: 429 })));
    const { envoyerMessageLumi, ErreurLumi } = await import('../src/lib/lumiApi');
    await expect(envoyerMessageLumi({ conversation_id: null, message: 'x', language: 'fr' }, () => {})).rejects.toBeInstanceOf(ErreurLumi);
    vi.unstubAllGlobals();
  });
});

// ── Consignes « collègue » : jamais de langage base de données ──────────
describe('Lumi parle comme un collègue, pas comme une base de données', () => {
  it('le prompt de Lumi porte les mêmes consignes de présentation que le MCP, dans la partie mise en cache', async () => {
    const { promptSystemeLumi } = await import('../server/lib/lumi/orchestrateur');
    const { CONSIGNES_COLLEGUE } = await import('../server/lib/agent/consignesCollegue');
    const blocs = promptSystemeLumi({ companyName: 'Coquin lavage', userName: 'Will', language: 'fr', todayIso: '2026-09-10' });
    const stable = blocs[0].text;
    expect(blocs[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(stable).toContain(CONSIGNES_COLLEGUE);
    // Les règles qui comptent, nommément — si quelqu'un raccourcit le texte, ce test le dit.
    for (const regle of [
      "N'affiche JAMAIS d'identifiant technique",
      "Ne mentionne jamais les noms d'outils",
      'affiche-les en dollars canadiens (12500 → 125,00 $)',
      'Ne parle pas de la mécanique (outils, base de données, MCP, session, colonnes)',
      "N'expose JAMAIS de noms d'outils, de signatures, de champs, de messages d'erreur bruts",
    ]) expect(stable).toContain(regle);
    // Dans Lumi l'utilisateur est déjà connecté : pas de consigne de reconnexion OAuth.
    expect(stable).not.toContain('session_a_reconnecter');
    // La partie variable (date, prénom) reste hors cache.
    expect(stable).not.toContain('2026-09-10');
    expect(blocs[1].text).toContain('2026-09-10');
  });
});

// ── Le routeur est monté (la PR SEO #329 l'avait fait disparaître de server/index.ts) ──
describe('le routeur Lumi est monté dans le serveur', () => {
  it('server/index.ts importe et monte routes/lumi, avec ses limiteurs', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('server/index.ts', 'utf8');
    expect(src).toContain("import lumiRouter from './routes/lumi';");
    expect(src).toContain("app.use('/api', lumiRouter);");
    expect(src).toContain("app.use('/api/lumi', agentLimiter);");
    expect(src).toContain("app.use('/api/lumi', redisRateLimit(");
  });
});
