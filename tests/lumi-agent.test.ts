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
  it('écriture en cache 5 min à 125 %, 1 h à 200 % ; sans détail, tout à 200 %', async () => {
    const { coutEnCents } = await import('../server/lib/lumi/tarifs');
    const base = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
    // Sonnet 5 : entrée 2 $/M → 5 min = 2,5 $/M, 1 h = 4 $/M.
    expect(coutEnCents('claude-sonnet-5', { ...base, cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 0 } })).toBe(250);
    expect(coutEnCents('claude-sonnet-5', { ...base, cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 } })).toBe(400);
    expect(coutEnCents('claude-sonnet-5', { ...base, cache_creation_input_tokens: 1_000_000 })).toBe(400);
  });

  it('un modèle inconnu est facturé au tarif Opus 5 — jamais 0', async () => {
    const { coutEnCents } = await import('../server/lib/lumi/tarifs');
    expect(coutEnCents('modele-mystere', { input_tokens: 1_000_000, output_tokens: 0 })).toBe(500);
  });
  it('LUMI_MODEL n est honoré que s il est tarifé', async () => {
    const { modeleLumi } = await import('../server/lib/lumi/tarifs');
    expect(modeleLumi({ LUMI_MODEL: 'claude-sonnet-5' } as any)).toBe('claude-sonnet-5');
    // Défaut Sonnet 5 depuis le 2026-09-10 (mêmes tâches, 2,5× moins cher).
    expect(modeleLumi({ LUMI_MODEL: 'claude-opus-5' } as any)).toBe('claude-opus-5');
    expect(modeleLumi({ LUMI_MODEL: 'gpt-9' } as any)).toBe('claude-sonnet-5');
    expect(modeleLumi({} as any)).toBe('claude-sonnet-5');
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
    rpc: vi.fn(async (fn: string, args: any) => ({
      data: fn === 'lumi_depense_du_mois' ? (depenses[args.p_org] ?? 0)
        : fn === 'lumi_prochain_renouvellement' ? '2026-10-12T04:00:00Z'
        : fn === 'lumi_periode_courante' ? '2026-09-12' : null,
      error: null,
    })),
  };
}
vi.mock('../server/lib/supabase', () => ({
  companyOrgIds: async (_a: unknown, orgId: string) => [orgId],
  getServiceClient: () => ({ rpc: async () => ({ data: false }) }),
}));

describe('paliers de budget (le client n est jamais à sec)', () => {
  it('normal sous 70 %, économe à 70 %, restreint à 90 %, épuisé à 100 %', async () => {
    const { palierBudget, reglagesPourPalier } = await import('../server/lib/lumi/budget');
    expect(palierBudget(4000, 0)).toBe('normal');
    expect(palierBudget(4000, 2799)).toBe('normal');
    expect(palierBudget(4000, 2800)).toBe('econome');
    expect(palierBudget(4000, 3599)).toBe('econome');
    expect(palierBudget(4000, 3600)).toBe('restreint');
    expect(palierBudget(4000, 3999)).toBe('restreint');
    expect(palierBudget(4000, 4000)).toBe('epuise');
    expect(palierBudget(0, 500)).toBe('normal'); // pas de plafond → pas de pente
    // La pente joue AVANT tout refus : modèle moins cher, réflexion et historique réduits, puis étapes bornées.
    // Effort bas par défaut (règle stricte, LUMI_EFFORT=medium pour revenir) : la réflexion étendue est réservée aux sous-agents complexes.
    expect(reglagesPourPalier('normal', 'claude-sonnet-5')).toMatchObject({ model: 'claude-sonnet-5', effort: 'low', historique_messages: 60, max_etapes: 8, modele_autorise: true });
    expect(reglagesPourPalier('econome', 'claude-sonnet-5')).toMatchObject({ model: 'claude-haiku-4-5', effort: 'low', historique_messages: 6, max_etapes: 8 });
    expect(reglagesPourPalier('restreint', 'claude-sonnet-5')).toMatchObject({ model: 'claude-haiku-4-5', effort: 'low', max_etapes: 2 });
    expect(reglagesPourPalier('epuise', 'claude-sonnet-5')).toMatchObject({ max_etapes: 0, modele_autorise: false });
  });

  it('etatBudget expose le palier ; à plafond atteint, epuise reste vrai (garde-fou interne)', async () => {
    const { etatBudget } = await import('../server/lib/lumi/budget');
    // 1 000 crédits = 3 000 ¢ de plafond interne.
    const eco = await etatBudget(adminFactice({ slug: 'autopilot', includes_ai: true, lumi_credits_mensuels: 1000 }, { 'org-1': 2200 }) as any, 'org-1');
    expect(eco.palier).toBe('econome');
    const plein = await etatBudget(adminFactice({ slug: 'autopilot', includes_ai: true, lumi_credits_mensuels: 1000 }, { 'org-1': 3000 }) as any, 'org-1');
    expect(plein).toMatchObject({ palier: 'epuise', epuise: true });
  });

  it('le tour utilise le modèle et l effort du palier', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'text', text: 'Ok.' }], stop_reason: 'end_turn', usage });
    const journal: any[] = [];
    await tourLumi({ ...baseTour([], journal), reglages: { model: 'claude-haiku-4-5', effort: 'low' } });
    expect(instantanes[0].model).toBe('claude-haiku-4-5');
    // Haiku n'accepte pas l'effort : il n'est pas envoyé (voir parametresReflexion).
    expect(instantanes[0].output_config).toBeUndefined();
    expect(journal[0].model).toBe('claude-haiku-4-5');
  });

  it('plafond dur : réservation refusée → rien ne part au modèle, le tour rend plafond', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    const avant = instantanes.length;
    const reservations: number[] = [];
    const r = await tourLumi({ ...baseTour([], []), budget: { reserver: async (c) => { reservations.push(c); return { id: null, statut: 'capped' }; }, regler: async () => {} } });
    expect(r.plafond).toBe(true);
    expect(instantanes.length).toBe(avant);       // aucun appel API
    expect(reservations[0]).toBeGreaterThan(0);   // le coût maximal a bien été estimé
    // Palier épuisé : 0 étape → plafond sans même réserver.
    const r2 = await tourLumi({ ...baseTour([], []), reglages: { model: 'claude-haiku-4-5', effort: 'low', max_etapes: 0 } });
    expect(r2.plafond).toBe(true);
    expect(instantanes.length).toBe(avant);
  });

  it('réservation acceptée → réglée au coût réel après l appel', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'text', text: 'Ok.' }], stop_reason: 'end_turn', usage });
    const regles: Array<[string | null, number]> = [];
    const r = await tourLumi({ ...baseTour([], []), budget: { reserver: async () => ({ id: 'res-1', statut: 'ok' }), regler: async (id, c) => { regles.push([id, c]); } } });
    expect(r.plafond).toBeUndefined();
    expect(regles).toEqual([['res-1', r.cost_cents]]);
  });
});

describe('budget mensuel', () => {
  it('Autopilot : 1 000 crédits (plafond interne 3 000 ¢), dépense lue en base, reste calculé, renouvellement', async () => {
    const { etatBudget } = await import('../server/lib/lumi/budget');
    const b = await etatBudget(adminFactice({ slug: 'autopilot', includes_ai: true, lumi_credits_mensuels: 1000 }, { 'org-1': 1234.5 }) as any, 'org-1');
    expect(b).toMatchObject({ plan_slug: 'autopilot', includes_ai: true, credits_mensuels: 1000, budget_cents: 3000, depense_cents: 1234.5, reste_cents: 1765.5, epuise: false });
    expect(b.renouvellement_le).toMatch(/^2026-10-1[12]$/);
  });
  it('épuisé quand la dépense atteint le plafond des crédits', async () => {
    const { etatBudget } = await import('../server/lib/lumi/budget');
    const b = await etatBudget(adminFactice({ slug: 'autopilot', includes_ai: true, lumi_credits_mensuels: 1000 }, { 'org-1': 3000 }) as any, 'org-1');
    expect(b.epuise).toBe(true);
    expect(b.reste_cents).toBe(0);
  });
  it('plan sans IA (ou sans abonnement) → pas de Lumi, sans lire la dépense', async () => {
    const { etatBudget } = await import('../server/lib/lumi/budget');
    const admin = adminFactice({ slug: 'starter', includes_ai: false, lumi_credits_mensuels: 0 }, { 'org-1': 0 });
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
  resoudreNumeros: async (args: any) => ({ args }),
  PERMISSION_PAR_OUTIL: { list_invoices: { cle: 'invoices.read', capacite: 'la consultation des factures' }, create_job: { cle: 'jobs.create', capacite: 'la création de jobs' } },
  executerOutilGarde: async (o: any) => {
    outilsExecutes.push({ name: o.name, args: o.args });
    if (o.name === 'get_payroll_summary') return { refus: 'Les accès Lume de cette personne n\'incluent pas la paie.' };
    if (o.name === 'build_report') return { result: { rapport: { type: 'retards', titre: 'Comptes à recevoir', sous_titre: 'En date du 10 sept.', periode: null, genere_le: '2026-09-10T12:00:00Z', langue: 'fr', sections: [{ titre: 'Retards', kpis: [{ label: 'Total', valeur: '1 971,82 $' }] }] } } };
    return { result: { ok: true, lignes: [{ id: 'inv-1', total_cents: 100 }] } };
  },
}));
vi.mock('../server/lib/agent/tools', () => ({
  AGENT_TOOLS: [
    { kind: 'read', declaration: { name: 'list_invoices', description: 'Liste', parameters: { type: 'object', properties: {} } } },
    { kind: 'read', declaration: { name: 'get_payroll_summary', description: 'Paie', parameters: { type: 'object', properties: {} } } },
    { kind: 'write', declaration: { name: 'create_job', description: 'Crée', parameters: { type: 'object', properties: { title: { type: 'string' } } } } },
    { kind: 'read', canal: 'lumi', declaration: { name: 'build_report', description: 'Rapport', parameters: { type: 'object', properties: {} } } },
  ],
  TOOLS_BY_NAME: {
    list_invoices: { kind: 'read', handler: async () => ({}) },
    get_payroll_summary: { kind: 'read', handler: async () => ({}) },
    create_job: { kind: 'write', handler: async () => ({}) },
    build_report: { kind: 'read', handler: async () => ({}) },
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
    expect(journal[0].model).toBe('claude-sonnet-5');
    expect(emis.some((e) => e.type === 'text' && e.delta === 'Bonjour !')).toBe(true);
    // Le prompt système et les outils sont mis en cache ; effort medium ; réflexion adaptative.
    const params = instantanes[0];
    // Cache d'une heure : la reprise d'une conversation après une pause ne
    // réécrit plus le contexte (2,6 ¢ sur les 6 ¢ d'un tour, mesuré en prod).
    const charges = params.tools.filter((t: any) => !t.defer_loading && !t.type);
        // 5 minutes, pas 1 h : 214 des 241 écarts entre appels mesurés en prod
    // sont sous 5 min, et une lecture rafraîchit le minuteur gratuitement.
    // L'écriture 1 h coûte 2× l'entrée, la 5 min 1,25×. Voir CACHE_1H.
    expect(charges[charges.length - 1].cache_control).toEqual({ type: 'ephemeral' });
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config).toEqual({ effort: 'low' }); // effort bas par défaut (règle stricte, regles-cout.ts)
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

  // Passe de référence du 2026-10-01 : au palier restreint (2 étapes), une question à
  // deux lectures finissait en erreur « trop d'étapes », sans réponse (6 cas sur 115).
  it('limite d’étapes atteinte : un appel de CONCLUSION sans outils répond, au lieu d’une erreur sans réponse', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'l1', name: 'list_invoices', input: {} }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'tool_use', id: 'l2', name: 'list_invoices', input: { status: 'overdue' } }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Deux factures, dont une en retard.' }], stop_reason: 'end_turn', usage });
    const emis: any[] = [];
    const r = await tourLumi({ ...baseTour(emis, []), contexteTour: 'Il est 9 h.', reglages: { model: 'claude-haiku-4-5', effort: 'low', max_etapes: 2 } });
    expect(r.texte).toBe('Deux factures, dont une en retard.');
    expect(emis.some((e) => e.type === 'error')).toBe(false);
    expect(streamSpy).toHaveBeenCalledTimes(3);
    // Les deux étapes du palier gardent leurs outils ; seule la conclusion en est privée…
    expect(instantanes[0].tool_choice).toBeUndefined();
    expect(instantanes[1].tool_choice).toBeUndefined();
    expect(instantanes[2].tool_choice).toEqual({ type: 'none' });
    // …et le modèle le sait : la consigne suit le contexte du tour, après le point de cache.
    const texteDe = (i: number) => JSON.stringify(instantanes[i].messages[instantanes[i].messages.length - 1]);
    expect(texteDe(2)).toContain('tu ne peux plus appeler d’outil');
    expect(texteDe(2)).toContain('Il est 9 h.');
    expect(texteDe(1)).not.toContain('tu ne peux plus appeler d’outil');
    // Le préfixe en cache ne bouge pas : mêmes outils, même système.
    expect(instantanes[2].tools).toEqual(instantanes[1].tools);
    expect(instantanes[2].system).toEqual(instantanes[1].system);
  });

  // Passe de référence du 2026-10-01, cas terrain-13 : un technicien a obtenu une carte
  // « supprimer le client ». Le modèle avait appelé un outil qu'on ne lui avait pas donné.
  it('LE RÔLE : un outil hors des outils permis ne donne ni carte ni exécution — le modèle reçoit le refus', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [
      { type: 'tool_use', id: 'w_interdit', name: 'create_job', input: { title: 'Lavage' } },
      { type: 'tool_use', id: 'r_interdit', name: 'get_payroll_summary', input: {} },
    ], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Ton rôle ne permet pas ça.' }], stop_reason: 'end_turn', usage });
    const emis: any[] = [];
    const r = await tourLumi({ ...baseTour(emis, []), outilsPermis: new Set(['list_invoices']) });
    expect(r.proposition).toBeNull();
    expect(emis.some((e) => e.type === 'proposal')).toBe(false);
    expect(outilsExecutes).toEqual([]); // la lecture interdite n'atteint même pas la garde
    expect(emis.filter((e) => e.type === 'tool' && e.statut === 'refus').map((e) => e.name)).toEqual(['create_job', 'get_payroll_summary']);
    const retour = instantanes[1].messages[instantanes[1].messages.length - 1].content.filter((b: any) => b.type === 'tool_result');
    expect(retour).toHaveLength(2);
    expect(retour.every((b: any) => b.is_error)).toBe(true);
    expect(retour[0].content).toContain('ne permet pas la création de jobs');
    expect(retour[0].content).toContain('Rien n\'a été fait ni proposé');
    expect(r.texte).toBe('Ton rôle ne permet pas ça.');
  });

  it('LE RÔLE : un outil permis passe comme avant (aucun faux refus)', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'w_ok', name: 'create_job', input: { title: 'Lavage' } }], stop_reason: 'tool_use', usage });
    const emis: any[] = [];
    const r = await tourLumi({ ...baseTour(emis, []), outilsPermis: new Set(['list_invoices', 'create_job']) });
    expect(r.proposition).toMatchObject({ tool: 'create_job' });
    expect(emis.some((e) => e.type === 'tool' && e.statut === 'refus')).toBe(false);
  });

  it('plafond de coût du tour : les outils sont retirés ET le modèle en est averti', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    // Un premier appel très cher (30 000 tokens d'entrée plein tarif ≈ 9 ¢, au-dessus du plafond de 6 ¢).
    const cher = { input_tokens: 30_000, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    reponses.push({ content: [{ type: 'tool_use', id: 'l1', name: 'list_invoices', input: {} }], stop_reason: 'tool_use', usage: cher });
    reponses.push({ content: [{ type: 'text', text: 'Voici ce que j’ai : une facture. Il resterait à vérifier les paiements.' }], stop_reason: 'end_turn', usage });
    const r = await tourLumi({ ...baseTour([], []), contexteTour: 'Il est 9 h.' });
    expect(r.texte).toContain('Voici ce que j’ai');
    expect(instantanes[0].tool_choice).toBeUndefined();
    expect(instantanes[1].tool_choice).toEqual({ type: 'none' });
    // Avant, le modèle perdait ses outils sans le savoir : il annonçait « je vérifie » et s'arrêtait là.
    const dernier = JSON.stringify(instantanes[1].messages[instantanes[1].messages.length - 1]);
    expect(dernier).toContain('tu ne peux plus appeler d’outil');
    expect(dernier).toContain('Il est 9 h.');
  });

  it('limite d’étapes : une ÉCRITURE à la dernière étape reste une carte (aucun appel de plus)', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'l1', name: 'list_invoices', input: {} }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'tool_use', id: 'w1', name: 'create_job', input: { title: 'Lavage' } }], stop_reason: 'tool_use', usage });
    const emis: any[] = [];
    const r = await tourLumi({ ...baseTour(emis, []), reglages: { model: 'claude-haiku-4-5', effort: 'low', max_etapes: 2 } });
    expect(r.proposition).toMatchObject({ tool: 'create_job' });
    expect(streamSpy).toHaveBeenCalledTimes(2);
    expect(emis.some((e) => e.type === 'error')).toBe(false);
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

  it('un rapport (build_report) part à l interface en événement report, et au modèle en tool_result', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push(
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_r', name: 'build_report', input: { type: 'retards' } }], usage },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Voilà ton rapport ci-dessous.' }], usage },
    );
    const emis: any[] = [];
    await tourLumi(baseTour(emis, []));
    const ev = emis.find((e) => e.type === 'report');
    expect(ev).toMatchObject({ tool_use_id: 'tu_r', rapport: { type: 'retards', titre: 'Comptes à recevoir' } });
    const second = instantanes[1].messages.at(-1);
    expect(second.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_r' });
    expect(second.content[0].content).toContain('"rapport"');
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
describe('outils différés (tool search)', () => {
  // La structure sur les 67 vrais outils est testée sans mock dans
  // tests/lumi-outils-differes.test.ts.
  it('le prompt dit au modèle de chercher les outils cachés avant de dire non', async () => {
    const { promptSystemeLumi } = await import('../server/lib/lumi/orchestrateur');
    const stable = promptSystemeLumi({ companyName: 'X', userName: null, language: 'fr', todayIso: '2026-09-10' })[0].text;
    expect(stable).toContain('tool_search_tool_regex');
    expect(stable).toMatch(/invoice\|payment/); // les familles d'outils, avec leurs motifs de recherche
  });

  it('une réponse sans appel client (recherche seule) relance la boucle sans message vide', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'server_tool_use', id: 'srvtoolu_1', name: 'tool_search_tool_regex', input: { pattern: 'quote' } }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Voilà.' }], stop_reason: 'end_turn', usage });
    const emis: any[] = [], journal: any[] = [];
    const r = await tourLumi(baseTour(emis, journal));
    expect(r.texte).toBe('Voilà.');
    expect(instantanes).toHaveLength(2);
    // Aucun message utilisateur vide intercalé : le 2e appel reçoit [historique, assistant].
    const derniers = instantanes[1].messages.slice(-1);
    expect(derniers[0].role).toBe('assistant');
  });
});

describe('cache glissant de la conversation', () => {
  it('le dernier message porte un point de cache 5 min, et l historique d origine n est pas touché', async () => {
    const { avecCacheConversation } = await import('../server/lib/lumi/orchestrateur');
    const hist: any[] = [
      { role: 'user', content: 'Bonjour' },
      { role: 'assistant', content: [{ type: 'text', text: 'Salut' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }, { type: 'tool_result', tool_use_id: 't2', content: '{}' }] },
    ];
    const copie = JSON.parse(JSON.stringify(hist));
    const out = avecCacheConversation(hist) as any[];
    expect(out).toHaveLength(3);
    expect(out[2].content[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(out[2].content[0].cache_control).toBeUndefined();
    expect(out[0]).toBe(hist[0]); // les messages précédents sont les mêmes objets
    expect(hist).toEqual(copie);  // rien de muté : la base ne stocke jamais cache_control
  });

  it('un message texte (string) devient un bloc texte avec point de cache', async () => {
    const { avecCacheConversation } = await import('../server/lib/lumi/orchestrateur');
    const out = avecCacheConversation([{ role: 'user', content: 'Bonjour' }]) as any[];
    expect(out[0].content).toEqual([{ type: 'text', text: 'Bonjour', cache_control: { type: 'ephemeral' } }]);
  });

  it('chaque appel au modèle passe l historique avec le point de cache', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'tu1', name: 'list_invoices', input: {} }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Fini.' }], stop_reason: 'end_turn', usage });
    await tourLumi(baseTour([], []));
    expect(instantanes).toHaveLength(2);
    for (const p of instantanes) {
      const dernier = p.messages[p.messages.length - 1];
      const blocs = dernier.content;
      expect(blocs[blocs.length - 1].cache_control).toEqual({ type: 'ephemeral' });
      // Un seul point de cache dans les messages (max 4 par requête, 2 déjà pris par outils + prompt).
      const points = p.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])).filter((b: any) => b.cache_control).length;
      expect(points).toBe(1);
    }
  });
});

describe('paramètres de réflexion selon le modèle', () => {
  it('Sonnet/Opus : adaptatif + effort ; Haiku : rien (sinon 400 de l API)', async () => {
    const { parametresReflexion } = await import('../server/lib/lumi/orchestrateur');
    expect(parametresReflexion('claude-sonnet-5', 'medium')).toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } });
    expect(parametresReflexion('claude-opus-5', 'low')).toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'low' } });
    expect(parametresReflexion('claude-haiku-4-5', 'low')).toEqual({});
  });

  it('le tour en mode économe (Haiku) part sans thinking ni output_config', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'text', text: 'Ok.' }], stop_reason: 'end_turn', usage });
    await tourLumi({ ...baseTour([], []), reglages: { model: 'claude-haiku-4-5', effort: 'low' } });
    expect(instantanes[0].model).toBe('claude-haiku-4-5');
    expect(instantanes[0].thinking).toBeUndefined();
    expect(instantanes[0].output_config).toBeUndefined();
  });
});

describe('mode de confirmation', () => {
  it('demander = rien ; argent = tout sauf argent, envois et gestes irréversibles ; tout = tout SAUF « jamais d’office »', async () => {
    const { outilsAutorisesParMode, ECRITURES_SENSIBLES } = await import('../server/lib/lumi/execution');
    const ecritures = ['create_job', 'create_task', 'update_job_status', 'remember_this', 'create_quote', 'send_sms', 'mark_invoice_paid', 'merge_clients', 'archive_job'];
    expect(outilsAutorisesParMode('demander', ecritures).size).toBe(0);
    const argent = outilsAutorisesParMode('argent', ecritures);
    expect([...argent].sort()).toEqual(['create_job', 'create_task', 'remember_this', 'update_job_status']);
    // Audit 2026-09-30 : même en mode « tout », l'argent, les envois au client et l'irréversible demandent la carte.
    expect([...outilsAutorisesParMode('tout', ecritures)].sort()).toEqual(['archive_job', 'create_job', 'create_quote', 'create_task', 'remember_this', 'update_job_status']);
    for (const s of ['create_quote', 'send_sms', 'send_email', 'mark_invoice_paid', 'send_payment_reminders', 'merge_clients']) expect(ECRITURES_SENSIBLES.has(s), s).toBe(true);
  });
});

describe('« toujours confirmer » : l écriture autorisée part d office', () => {
  it('carte déjà confirmée, reçu émis, tool_result executed, et le tour continue', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'tu-w', name: 'create_job', input: { title: 'Vitres' } }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Job créé.' }], stop_reason: 'end_turn', usage });
    const emis: any[] = [];
    const r = await tourLumi({ ...baseTour(emis, []), autorisations: new Set(['create_job']) });
    expect(r.proposition).toBeNull();               // rien en attente : c'est fait
    expect(r.texte).toBe('Job créé.');
    const prop = emis.find((e) => e.type === 'proposal');
    expect(prop).toMatchObject({ tool: 'create_job', auto: true });
    const recu = emis.find((e) => e.type === 'executed');
    expect(recu).toMatchObject({ tool_use_id: 'tu-w', ok: true, auto: true });
    expect(outilsExecutes.map((o) => o.name)).toContain('create_job');
    // Le modèle reçoit le résultat exécuté (avec la note « DONE »), puis conclut.
    const resultat = instantanes[1].messages.at(-1).content[0];
    expect(resultat.type).toBe('tool_result');
    expect(JSON.parse(resultat.content)).toMatchObject({ executed: true, auto: true });
  });

  it('sans autorisation, la même écriture reste une proposition', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'tu-w2', name: 'create_job', input: { title: 'Vitres' } }], stop_reason: 'tool_use', usage });
    const emis: any[] = [];
    const r = await tourLumi({ ...baseTour(emis, []), autorisations: new Set(['send_sms']) });
    expect(r.proposition?.tool).toBe('create_job');
    expect(emis.find((e) => e.type === 'executed')).toBeUndefined();
    expect(outilsExecutes.map((o) => o.name)).not.toContain('create_job');
  });
});

describe('plusieurs écritures dans une réponse = une carte', () => {
  it('le tour émet UNE proposition avec le groupe, et laisse toutes les écritures en attente', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [
      { type: 'tool_use', id: 'w1', name: 'create_job', input: { title: 'Vitres' } },
      { type: 'tool_use', id: 'w2', name: 'create_job', input: { title: 'Gouttières' } },
    ], stop_reason: 'tool_use', usage });
    const emis: any[] = [];
    const r = await tourLumi(baseTour(emis, []));
    const props = emis.filter((e) => e.type === 'proposal');
    expect(props).toHaveLength(1);
    expect(props[0].groupe).toHaveLength(2);
    expect(props[0].groupe.map((g: any) => g.tool_use_id)).toEqual(['w1', 'w2']);
    expect(r.proposition?.groupe?.length).toBe(2);
    expect(outilsExecutes).toHaveLength(0);
    // Aucun tool_result d'erreur « une seule action à la fois » n'est plus renvoyé.
    expect(instantanes).toHaveLength(1);
  });

  it('propositionsEnAttente renvoie toutes les écritures sans réponse du dernier message', async () => {
    const { propositionsEnAttente, propositionEnAttente } = await import('../server/routes/lumi');
    const msgs: any[] = [
      { role: 'user', content: 'Fais tout' },
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'r1', name: 'list_invoices', input: {} },
        { type: 'tool_use', id: 'w1', name: 'create_job', input: { title: 'A' } },
        { type: 'tool_use', id: 'w2', name: 'create_job', input: { title: 'B' } },
      ] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: '{}' }] },
    ];
    expect(propositionsEnAttente(msgs).map((a) => a.tool_use_id)).toEqual(['w1', 'w2']);
    expect(propositionEnAttente(msgs)?.tool_use_id).toBe('w1');
    // Une fois résolues, plus rien en attente.
    msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w1', content: '{}' }, { type: 'tool_result', tool_use_id: 'w2', content: '{}' }] });
    expect(propositionsEnAttente(msgs)).toEqual([]);
  });

  it('rendreMessages regroupe les écritures d un même message et suit le pire état', async () => {
    const { rendreMessages } = await import('../server/routes/lumi');
    const msgs: any[] = [
      { role: 'user', content: 'Fais tout' },
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'w1', name: 'create_job', input: { title: 'A' } },
        { type: 'tool_use', id: 'w2', name: 'create_job', input: { title: 'B' } },
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'w1', content: JSON.stringify({ executed: true, result: {} }) },
        { type: 'tool_result', tool_use_id: 'w2', content: JSON.stringify({ error: 'refusé' }) },
      ] },
    ];
    const carte = rendreMessages(msgs).find((m) => m.proposal)!.proposal!;
    expect(carte.groupe?.map((g) => g.statut)).toEqual(['confirmee', 'echouee']);
    expect(carte.statut).toBe('echouee');
  });
});

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

  it('rendreMessages : un rapport stocké dans le tool_result revient avec sa carte au rechargement', async () => {
    const { rendreMessages } = await import('../server/routes/lumi');
    const rapport = { type: 'jobs', titre: 'Rapport des jobs', sous_titre: 'Semaine', periode: { du: '2026-09-07', au: '2026-09-13' }, genere_le: '2026-09-10T12:00:00Z', langue: 'fr', sections: [{ titre: 'En chiffres', kpis: [{ label: 'Jobs', valeur: '5' }] }] };
    const r = rendreMessages([
      { role: 'user', content: 'Rapport ?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_r', name: 'build_report', input: { type: 'jobs' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_r', content: JSON.stringify({ rapport, note: 'x' }) }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Voilà.' }] },
    ] as any);
    expect(r[1]).toMatchObject({ role: 'assistant', tools: ['build_report'], report: { titre: 'Rapport des jobs' } });
    expect(r[2]).toMatchObject({ role: 'assistant', text: 'Voilà.' });
    expect(r[2]).not.toHaveProperty('report');
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
    const { CONSIGNES_COLLEGUE, CONSIGNES_COLLEGUE_LUMI } = await import('../server/lib/agent/consignesCollegue');
    const blocs = promptSystemeLumi({ companyName: 'Coquin lavage', userName: 'Will', language: 'fr', todayIso: '2026-09-10' });
    const stable = blocs[0].text;
        // 5 minutes, pas 1 h : 214 des 241 écarts entre appels mesurés en prod
    // sont sous 5 min, et une lecture rafraîchit le minuteur gratuitement.
    // L'écriture 1 h coûte 2× l'entrée, la 5 min 1,25×. Voir CACHE_1H.
    expect(blocs[0].cache_control).toEqual({ type: 'ephemeral' });
    // Mêmes consignes que le MCP, sauf les « attends un OUI » : dans Lumi, c'est la carte qui demande le OUI.
    expect(stable).toContain(CONSIGNES_COLLEGUE_LUMI);
    expect(CONSIGNES_COLLEGUE).toContain('attends un OUI');
    expect(stable).not.toContain('attends un OUI');
    expect(stable).not.toContain('seulement après un OUI clair');
    expect(stable).toContain("c'est elle qui demande le OUI, pas toi");
    expect(CONSIGNES_COLLEGUE_LUMI.split(/\r?\n/).length).toBe(CONSIGNES_COLLEGUE.split(/\r?\n/).length - 1);
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
    // La partie variable (date, prénom, entreprise) reste hors cache.
    expect(stable).not.toContain('2026-09-10');
    expect(blocs[1].text).toContain('2026-09-10');
    expect(stable).not.toContain('Coquin lavage');
    expect(blocs[1].text).toContain('Entreprise : Coquin lavage.');
    // Le bloc stable est IDENTIQUE d'une org à l'autre : un seul préfixe en
    // cache pour toute la plateforme, pas une écriture 1 h par entreprise.
    const autre = promptSystemeLumi({ companyName: 'Plomberie Roy', userName: 'Marc', language: 'fr', todayIso: '2026-09-11' });
    expect(autre[0].text).toBe(stable);
    // … et d'une langue à l'autre : la consigne de langue est dans le bloc variable (B1).
    const anglais = promptSystemeLumi({ companyName: 'Roy Plumbing', userName: 'Marc', language: 'en', todayIso: '2026-09-11' });
    expect(anglais[0].text).toBe(stable);
    expect(anglais[1].text).toContain('Always reply in English');
    expect(autre[1].text).toContain('Réponds toujours en français');
    expect(autre[1].text).toContain('Entreprise : Plomberie Roy.');
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

// ── Recherche d'outil mise en pause par l'API (pause_turn) ──────────────
// Passes d'évaluation du 2026-10-01, en prod : 4 puis 7 tours sur 221 finissaient en
// « Lumi failed to respond ». La trace donne la cause : 400 « messages.1:
// `tool_search_tool_regex` tool use … was found without a corresponding
// `tool_search_tool_result` block ». La réponse s'était arrêtée sur la demande de
// recherche d'outil ; son résultat, arrivé au début de la réponse suivante, était rangé
// dans un SECOND message assistant.
describe('recherche d’outil en pause : la suite du tour reste dans le même message', () => {
  const recherche = { type: 'server_tool_use', id: 'srvtoolu_1', name: 'tool_search_tool_regex', input: { pattern: 'invoice' } };
  const trouve = { type: 'tool_search_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'tool_search_tool_search_result', tool_references: [{ type: 'tool_reference', tool_name: 'list_invoices' }] } };
  const forme = (msgs: any[]) => msgs.map((m) => `${m.role}[${typeof m.content === 'string' ? 'texte' : m.content.map((b: any) => b.type).join(',')}]`).join(' ');

  it('pause_turn puis outil : l’appel suivant envoie la demande ET son résultat dans un seul message assistant', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [recherche], stop_reason: 'pause_turn', usage });
    reponses.push({ content: [trouve, { type: 'tool_use', id: 'tu_1', name: 'list_invoices', input: {} }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Une facture en retard.' }], stop_reason: 'end_turn', usage });
    const r = await tourLumi(baseTour([], []));
    expect(streamSpy).toHaveBeenCalledTimes(3);
    // 2e appel : la réponse en pause est renvoyée telle quelle, en dernier, sans message utilisateur.
    expect(forme(instantanes[1].messages)).toBe('user[texte] assistant[server_tool_use]');
    // 3e appel : UN message assistant, la demande suivie de son résultat — jamais deux.
    expect(forme(instantanes[2].messages)).toBe('user[texte] assistant[server_tool_use,tool_search_tool_result,tool_use] user[tool_result]');
    // Ce qui est enregistré a la même forme : la conversation reste rejouable au tour suivant.
    expect(forme(r.nouveauxMessages)).toBe('assistant[server_tool_use,tool_search_tool_result,tool_use] user[tool_result] assistant[text]');
    expect(r.texte).toBe('Une facture en retard.');
    expect(outilsExecutes.map((o) => o.name)).toEqual(['list_invoices']);
  });

  it('pause_turn puis texte : un seul message assistant enregistré', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'text', text: 'Je cherche. ' }, recherche], stop_reason: 'pause_turn', usage });
    reponses.push({ content: [trouve, { type: 'text', text: 'Rien à signaler.' }], stop_reason: 'end_turn', usage });
    const r = await tourLumi(baseTour([], []));
    expect(forme(r.nouveauxMessages)).toBe('assistant[text,server_tool_use,tool_search_tool_result,text]');
  });

  it('un tour normal n’est pas touché : chaque réponse garde son message', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'tu_1', name: 'list_invoices', input: {} }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Voilà.' }], stop_reason: 'end_turn', usage });
    const r = await tourLumi(baseTour([], []));
    expect(forme(r.nouveauxMessages)).toBe('assistant[tool_use] user[tool_result] assistant[text]');
  });

  it('une conversation enregistrée AVANT le correctif (deux messages assistant de suite) est réparée à la relecture', async () => {
    const { assainirPourApi, fusionnerAssistantsConsecutifs } = await import('../server/lib/lumi/historique');
    const casse: any[] = [
      { role: 'user', content: 'Mes factures en retard' },
      { role: 'assistant', content: [recherche] },
      { role: 'assistant', content: [trouve, { type: 'text', text: 'Une facture en retard.' }] },
      { role: 'user', content: 'Et celles payées ?' },
    ];
    expect(forme(assainirPourApi(casse))).toBe('user[texte] assistant[server_tool_use,tool_search_tool_result,text] user[texte]');
    // Un historique sain revient tel quel (même tableau : rien n'est recopié pour rien).
    const sain: any[] = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }];
    expect(fusionnerAssistantsConsecutifs(sain)).toBe(sain);
    // Un message texte suivi d'un message en blocs : le texte devient un bloc, rien n'est perdu.
    expect(fusionnerAssistantsConsecutifs([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'assistant', content: [{ type: 'text', text: 'c' }] }] as any)[1])
      .toEqual({ role: 'assistant', content: [{ type: 'text', text: 'b' }, { type: 'text', text: 'c' }] });
  });

  it('un refus 400 de l’API emporte la FORME de la conversation vers la trace, jamais son contenu', async () => {
    const { tourLumi, formeDesMessages } = await import('../server/lib/lumi/orchestrateur');
    const refus = Object.assign(new Error('400 invalid_request_error'), { status: 400 });
    streamSpy.mockImplementationOnce(() => ({ on() { return this; }, async finalMessage() { throw refus; } }) as any);
    await expect(tourLumi({ ...baseTour([], []), historique: [{ role: 'user', content: 'Le numéro de Nathalie Côté est le 514-555-0101' }] })).rejects.toBe(refus);
    expect((refus as any).forme_messages).toBe('0:user[texte]');
    expect(formeDesMessages([{ role: 'user', content: 'x' }, { role: 'assistant', content: [recherche as any] }])).toBe('0:user[texte] 1:assistant[server_tool_use]');
    const route = (await import('node:fs')).readFileSync('server/routes/lumi.ts', 'utf8');
    expect(route).toContain("typeof e?.forme_messages === 'string' ? { forme_messages: e.forme_messages }");
  });
});

// ── Recherche d'outil restée en suspens à côté d'un outil de Lume ────────
// Après le correctif de la pause (ci-dessus), « texte à Nathalie pis mets sa job en
// cours » plantait encore en prod. La forme envoyée, relevée dans la trace le
// 2026-10-01 à 22 h 02 UTC :
//   5:assistant[tool_use,server_tool_use] 6:user[tool_result]  → 400
// Le modèle demande un de nos outils ET une recherche d'outil dans la même réponse ;
// l'API s'arrête pour le nôtre, la recherche n'a jamais lieu, sa demande reste là.
describe('recherche d’outil en suspens à côté d’un outil de Lume : retirée avant l’appel suivant', () => {
  const orpheline = { type: 'server_tool_use', id: 'srvtoolu_9', name: 'tool_search_tool_regex', input: { pattern: 'job.*status' } };
  const faite = { type: 'server_tool_use', id: 'srvtoolu_1', name: 'tool_search_tool_regex', input: { pattern: 'invoice' } };
  const resultat = { type: 'tool_search_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'tool_search_tool_search_result', tool_references: [{ type: 'tool_reference', tool_name: 'list_invoices' }] } };
  const lecture = { type: 'tool_use', id: 'tu_1', name: 'list_invoices', input: {} };
  const forme = (msgs: any[]) => msgs.map((m) => `${m.role}[${typeof m.content === 'string' ? 'texte' : m.content.map((b: any) => b.type).join(',')}]`).join(' ');

  it('la forme qui plantait en prod : l’appel suivant part sans la recherche en suspens', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [lecture, orpheline], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Une facture en retard.' }], stop_reason: 'end_turn', usage });
    const r = await tourLumi(baseTour([], []));
    expect(forme(instantanes[1].messages)).toBe('user[texte] assistant[tool_use] user[tool_result]');
    expect(forme(r.nouveauxMessages)).toBe('assistant[tool_use] user[tool_result] assistant[text]');
    expect(outilsExecutes.map((o) => o.name)).toEqual(['list_invoices']);
    expect(r.texte).toBe('Une facture en retard.');
  });

  it('l’autre forme relevée en prod — la recherche en suspens AVANT notre outil, après la réflexion', async () => {
    // 22 h 04 UTC, « assigne la job de Marie Roy à… » : 1:assistant[thinking,server_tool_use,tool_use] 2:user[tool_result] → 400
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'thinking', thinking: '…', signature: 's' }, orpheline, lecture], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Voilà.' }], stop_reason: 'end_turn', usage });
    const r = await tourLumi(baseTour([], []));
    expect(forme(instantanes[1].messages)).toBe('user[texte] assistant[thinking,tool_use] user[tool_result]');
    expect(forme(r.nouveauxMessages)).toBe('assistant[thinking,tool_use] user[tool_result] assistant[text]');
  });

  it('une recherche qui a EU son résultat reste, la réflexion aussi ; seule celle en suspens part', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'thinking', thinking: '…', signature: 's' }, faite, resultat, lecture, orpheline], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Voilà.' }], stop_reason: 'end_turn', usage });
    await tourLumi(baseTour([], []));
    expect(forme(instantanes[1].messages)).toBe('user[texte] assistant[thinking,server_tool_use,tool_search_tool_result,tool_use] user[tool_result]');
    const assistant = instantanes[1].messages[1].content;
    expect(assistant.find((b: any) => b.type === 'server_tool_use').id).toBe('srvtoolu_1');
  });

  it('en pause (pause_turn), la recherche en suspens est renvoyée telle quelle : l’API l’attend', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [orpheline], stop_reason: 'pause_turn', usage });
    reponses.push({ content: [{ type: 'tool_search_tool_result', tool_use_id: 'srvtoolu_9', content: { type: 'tool_search_tool_search_result', tool_references: [] } }, { type: 'text', text: 'Rien trouvé.' }], stop_reason: 'end_turn', usage });
    const r = await tourLumi(baseTour([], []));
    expect(forme(instantanes[1].messages)).toBe('user[texte] assistant[server_tool_use]');
    expect(forme(r.nouveauxMessages)).toBe('assistant[server_tool_use,tool_search_tool_result,text]');
  });

  it('une conversation enregistrée dans cette forme est réparée à la relecture ; le dernier message n’est jamais touché', async () => {
    const { assainirPourApi, sansRechercheOrpheline } = await import('../server/lib/lumi/historique');
    const cassee: any[] = [
      { role: 'user', content: 'Mes factures en retard' },
      { role: 'assistant', content: [lecture, orpheline] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '{}' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Une facture.' }] },
      { role: 'user', content: 'Merci' },
    ];
    expect(forme(assainirPourApi(cassee))).toBe('user[texte] assistant[tool_use] user[tool_result] assistant[text] user[texte]');
    // Un message sans recherche en suspens revient TEL QUEL (même objet).
    const sain = { role: 'assistant', content: [faite, resultat, lecture] } as any;
    expect(sansRechercheOrpheline(sain)).toBe(sain);
    // En dernière position (reprise d'une pause), rien n'est retiré.
    const enPause: any[] = [{ role: 'user', content: 'a' }, { role: 'assistant', content: [orpheline] }];
    expect(forme(assainirPourApi(enPause))).toBe('user[texte] assistant[server_tool_use]');
  });
});

// ── Démarrage à froid : il ne retire plus ses outils à Lumi ──────────────
// Rejeu en prod du 2026-10-01, juste après un déploiement : « assigne la job de Marie
// Roy à l'équipe Pression » → deux lectures, puis « confirme-moi au prochain message »
// au lieu d'une carte. Le premier appel avait ÉCRIT le cache du sujet (13 000 à
// 21 000 tokens, 4 à 6 ¢) : compté en entier contre le plafond du tour (6 ¢) depuis
// que le cache est en 5 minutes, il retirait les outils dès la deuxième étape.
describe('plafond de coût du tour : le démarrage à froid ne compte pas', () => {
  // 30 000 tokens écrits en cache 5 min = 7,5 ¢ (2 $ le million × 1,25) : à lui seul au-dessus du plafond de 6 ¢.
  const froid = { input_tokens: 200, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 30_000, cache_creation: { ephemeral_5m_input_tokens: 30_000, ephemeral_1h_input_tokens: 0 } };
  const chaud = { input_tokens: 200, output_tokens: 40, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 0 } };

  it('premier appel à cache froid, puis une lecture : la deuxième étape garde ses outils et propose l’action', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'l1', name: 'list_invoices', input: {} }], stop_reason: 'tool_use', usage: froid });
    reponses.push({ content: [{ type: 'tool_use', id: 'w1', name: 'create_job', input: { title: 'Lavage' } }], stop_reason: 'tool_use', usage: chaud });
    const r = await tourLumi(baseTour([], []));
    expect(instantanes[1].tool_choice).toBeUndefined();
    expect(JSON.stringify(instantanes[1].messages)).not.toContain('tu ne peux plus appeler d’outil');
    expect(r.proposition).toMatchObject({ tool: 'create_job' });
    // Le coût réel, lui, est compté en entier : seul le plafond du tour l'écarte.
    expect(r.cost_cents).toBeGreaterThan(7);
  });

  it('une écriture de cache aux étapes SUIVANTES compte toujours : une boucle qui grossit est arrêtée', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'l1', name: 'list_invoices', input: {} }], stop_reason: 'tool_use', usage: chaud });
    reponses.push({ content: [{ type: 'tool_use', id: 'l2', name: 'list_invoices', input: {} }], stop_reason: 'tool_use', usage: froid });
    reponses.push({ content: [{ type: 'text', text: 'Voilà ce que j’ai.' }], stop_reason: 'end_turn', usage: chaud });
    await tourLumi(baseTour([], []));
    expect(instantanes[1].tool_choice).toBeUndefined();
    expect(instantanes[2].tool_choice).toEqual({ type: 'none' });
  });

  it('un premier appel cher en ENTRÉE (pas en écriture de cache) atteint toujours le plafond', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    const cher = { input_tokens: 30_000, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    reponses.push({ content: [{ type: 'tool_use', id: 'l1', name: 'list_invoices', input: {} }], stop_reason: 'tool_use', usage: cher });
    reponses.push({ content: [{ type: 'text', text: 'Voilà.' }], stop_reason: 'end_turn', usage: chaud });
    await tourLumi(baseTour([], []));
    expect(instantanes[1].tool_choice).toEqual({ type: 'none' });
  });
});
