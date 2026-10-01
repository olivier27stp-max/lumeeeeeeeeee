/**
 * LUMI — fins de réponse anormales (mission fiabilité, 2026-10-01).
 *
 * `stop_reason: max_tokens` passait pour une fin normale : le contenu était
 * sauvegardé tel quel. Coupé au milieu d'un bloc d'action, il laissait dans
 * l'historique un `tool_use` aux arguments incomplets, sans `tool_result` —
 * de quoi faire refuser chaque tour suivant par l'API, ou faire réapparaître
 * une écriture tronquée comme carte à confirmer.
 *
 * Ce que ces tests figent :
 *   - une réponse coupée ne propose et n'exécute RIEN, et le dit ;
 *   - l'historique sauvegardé reste valide pour l'API (texte seulement, jamais vide) ;
 *   - un refus sans texte ne laisse pas un message assistant vide ;
 *   - le tour rend ce que la mesure attend (stop_reason, appels, outils chargés, premier token).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
const streamSpy = vi.fn((_params: any) => fluxFactice(reponses.shift()));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { stream: streamSpy }; } }));

const outilsExecutes: string[] = [];
vi.mock('../server/lib/agent/garde', () => ({
  resoudreNumeros: async (args: any) => ({ args }),
  PERMISSION_PAR_OUTIL: { list_invoices: { cle: 'invoices.read', capacite: 'la consultation des factures' }, create_job: { cle: 'jobs.create', capacite: 'la création de jobs' } },
  executerOutilGarde: async (o: any) => { outilsExecutes.push(o.name); return { result: { ok: true } }; },
}));
vi.mock('../server/lib/agent/tools', () => ({
  AGENT_TOOLS: [
    { kind: 'read', declaration: { name: 'list_invoices', description: 'Liste', parameters: { type: 'object', properties: {} } } },
    { kind: 'write', declaration: { name: 'create_job', description: 'Crée', parameters: { type: 'object', properties: { title: { type: 'string' } } } } },
  ],
  TOOLS_BY_NAME: {
    list_invoices: { kind: 'read', handler: async () => ({}) },
    create_job: { kind: 'write', handler: async () => ({}) },
  },
}));
vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => ({}) }));

const usage = { input_tokens: 100, output_tokens: 2048, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
function tour(emis: any[], extra: Record<string, unknown> = {}) {
  return {
    client: {} as any, orgId: 'org-1', userId: 'user-1',
    systeme: [{ type: 'text' as const, text: 'sys' }],
    historique: [{ role: 'user' as const, content: 'Crée un job de lavage pour Tremblay' }],
    emettre: (e: any) => emis.push(e),
    journaliser: async () => {},
    ...extra,
  };
}
/** Un historique que l'API accepte : aucun message assistant vide, aucun tool_use sans tool_result. */
function historiqueValide(messages: any[]): boolean {
  return messages.every((m, i) => {
    if (m.role !== 'assistant') return true;
    const blocs = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
    if (!blocs.length) return false;
    const actions = blocs.filter((b: any) => b.type === 'tool_use');
    if (!actions.length) return true;
    const suivant = messages[i + 1];
    return !!suivant && Array.isArray(suivant.content) && actions.every((a: any) => suivant.content.some((r: any) => r.type === 'tool_result' && r.tool_use_id === a.id));
  });
}

beforeEach(() => { reponses.length = 0; outilsExecutes.length = 0; streamSpy.mockClear(); process.env.ANTHROPIC_API_KEY = 'sk-test'; });

describe('réponse coupée par max_tokens', () => {
  it('coupée dans une ÉCRITURE : aucune carte, rien d’exécuté, et Lumi le dit', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'text', text: 'Je prépare le job.' }, { type: 'tool_use', id: 'tu_w', name: 'create_job', input: { title: 'Lav' } }], stop_reason: 'max_tokens', usage });
    const emis: any[] = [];
    const r = await tourLumi(tour(emis));
    expect(r.proposition).toBeNull();
    expect(emis.some((e) => e.type === 'proposal')).toBe(false);
    expect(r.tronque).toBe(true);
    expect(r.texte).toContain('Je prépare le job.');
    expect(r.texte).toContain('rien n’a été fait');
    expect(emis.some((e) => e.type === 'error' && e.message === 'reponse_coupee')).toBe(true);
    // Sauvegardé : du texte seulement, plus aucun bloc d'action.
    const dernier = r.nouveauxMessages[r.nouveauxMessages.length - 1] as any;
    expect(dernier.content.every((b: any) => b.type === 'text')).toBe(true);
    expect(historiqueValide(r.nouveauxMessages)).toBe(true);
    expect(streamSpy).toHaveBeenCalledTimes(1);
  });

  it('coupée dans une LECTURE : l’outil n’est pas exécuté avec des arguments incomplets', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'tu_r', name: 'list_invoices', input: {} }], stop_reason: 'max_tokens', usage });
    const emis: any[] = [];
    const r = await tourLumi(tour(emis));
    expect(outilsExecutes).toEqual([]);
    expect(historiqueValide(r.nouveauxMessages)).toBe(true);
    expect(r.texte).toContain('coupée');
  });

  // Phase 4 de la mission (« toutes les valeurs de stop_reason gérées ») : la fenêtre
  // de contexte pleine coupe la génération comme max_tokens, et passait pour une fin normale.
  it('fenêtre de contexte pleine (model_context_window_exceeded) : traitée comme une coupe, jamais comme une fin normale', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'text', text: 'Voici le début du rapp' }, { type: 'tool_use', id: 'tu_c', name: 'create_job', input: { title: 'Lav' } }], stop_reason: 'model_context_window_exceeded', usage });
    const emis: any[] = [];
    const r = await tourLumi(tour(emis));
    expect(r.tronque).toBe(true);
    expect(r.proposition).toBeNull();
    expect(emis.some((e) => e.type === 'proposal')).toBe(false);
    expect(outilsExecutes).toEqual([]);
    expect(r.texte).toContain('rien n’a été fait');
    expect(emis.some((e) => e.type === 'error' && e.message === 'reponse_coupee')).toBe(true);
    expect(historiqueValide(r.nouveauxMessages)).toBe(true);
    expect(r.stop_reason).toBe('model_context_window_exceeded');
  });

  it('coupée dans le TEXTE : le texte reçu est gardé, avec l’avis « continue »', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'text', text: 'Voici tes 40 factures : 1) INV-001…' }], stop_reason: 'max_tokens', usage });
    const emis: any[] = [];
    const r = await tourLumi(tour(emis));
    expect(r.texte.startsWith('Voici tes 40 factures')).toBe(true);
    expect(r.texte).toContain('Écris « continue »');
    expect(r.tronque).toBe(true);
    expect(historiqueValide(r.nouveauxMessages)).toBe(true);
  });

  it('coupée pendant la RÉFLEXION (aucun texte) : jamais un message assistant vide', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'thinking', thinking: 'Je dois d’abord…' }], stop_reason: 'max_tokens', usage });
    const emis: any[] = [];
    const r = await tourLumi(tour(emis));
    const dernier = r.nouveauxMessages[r.nouveauxMessages.length - 1] as any;
    expect(dernier.content).toHaveLength(1);
    expect(dernier.content[0].type).toBe('text');
    expect(dernier.content[0].text.length).toBeGreaterThan(10);
    expect(emis.some((e) => e.type === 'text')).toBe(true);
  });

  it('en anglais quand la conversation est en anglais', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'tu_w', name: 'create_job', input: {} }], stop_reason: 'max_tokens', usage });
    const r = await tourLumi(tour([], { langue: 'en' }));
    expect(r.texte).toContain('nothing was done');
  });
});

describe('refus et réponse vide', () => {
  it('refus sans texte : un avis est sauvegardé (historique valide) et l’erreur « refusal » part', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [], stop_reason: 'refusal', usage });
    const emis: any[] = [];
    const r = await tourLumi(tour(emis));
    expect(emis.some((e) => e.type === 'error' && e.message === 'refusal')).toBe(true);
    expect(r.texte).toBe('Je ne peux pas répondre à cette demande.');
    expect(historiqueValide(r.nouveauxMessages)).toBe(true);
    expect(r.tronque).toBe(false);
  });

  it('refus avec du texte : le texte du modèle est gardé tel quel, sans avis ajouté', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'text', text: 'Je ne peux pas faire ça.' }], stop_reason: 'refusal', usage });
    const r = await tourLumi(tour([]));
    expect(r.texte).toBe('Je ne peux pas faire ça.');
  });

  it('fin normale mais contenu vide : avis « réessaie », jamais un message vide', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [], stop_reason: 'end_turn', usage });
    const emis: any[] = [];
    const r = await tourLumi(tour(emis));
    expect(r.texte).toContain('Réessaie');
    expect(emis.some((e) => e.type === 'error' && e.message === 'reponse_vide')).toBe(true);
    expect(historiqueValide(r.nouveauxMessages)).toBe(true);
  });
});

describe('mesure du tour', () => {
  it('rend stop_reason, appels au modèle, outils chargés et délai du premier texte', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'tu_1', name: 'list_invoices', input: {} }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Une facture en retard.' }], stop_reason: 'end_turn', usage });
    const r = await tourLumi(tour([]));
    expect(r.stop_reason).toBe('end_turn');
    expect(r.appels_modele).toBe(2);
    expect(r.outils_charges).toBeGreaterThan(0);
    expect(typeof r.premier_token_ms).toBe('number');
    expect(r.tronque).toBeUndefined();
  });
});

describe('trace du tour (route)', () => {
  it('un refus est tracé « refus », un tour coupé ou inachevé « erreur », et la mesure part dans params', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const route = readFileSync(resolve(__dirname, '../server/routes/lumi.ts'), 'utf8');
    expect(route).toContain("erreurModele === 'refusal' ? 'refus' : erreurModele ? 'erreur' : 'ok'");
    expect(route).toMatch(/mesure: \{ \.\.\.mesure, \.\.\.\(erreurModele \? \{ erreur_modele: erreurModele \} : \{\}\) \}/);
    for (const champ of ['stop_reason', 'appels_modele', 'outils_charges', 'premier_token_ms']) expect(route).toContain(`${champ}: resultat.${champ}`);
    // La langue de la conversation part à l'agent : les avis par gabarit suivent l'utilisateur.
    expect(route).toContain("langue: ctx.language === 'en' ? 'en' : 'fr'");
  });
});
