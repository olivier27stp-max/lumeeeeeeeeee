/**
 * LUMI — pas de carte sur une cible qui n'existe pas, ni pour un rôle sans droit
 * (baseline en prod du 2026-10-01, 220 demandes).
 *
 *   - « Marque la facture 8888 comme réglée » → carte mark_invoice_paid, avec
 *     « Je vais marquer la facture 8888 comme réglée » : l'erreur du résolveur
 *     de numéros était ignorée.
 *   - « Mets Kevin Bouchard sur la job » → carte assign_job avec l'identifiant
 *     inventé « kevin_bouchard » : l'aperçu la signalait, la carte partait quand même.
 *   - Un technicien : « supprime le client Luc Bergeron » → carte delete_client
 *     préparée par le code (actions directes), sans regarder son rôle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const reponses: any[] = [];
function fluxFactice(reponse: any) {
  const handlers: Record<string, (...a: any[]) => void> = {};
  return {
    on(ev: string, fn: (...a: any[]) => void) { handlers[ev] = fn; return this; },
    async finalMessage() { for (const b of reponse.content) if (b.type === 'text' && handlers.text) handlers.text(b.text, b.text); return reponse; },
  };
}
const envoyes: any[] = [];
const streamSpy = vi.fn((params: any) => { envoyes.push(JSON.parse(JSON.stringify(params))); return fluxFactice(reponses.shift()); });
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { stream: streamSpy }; } }));

let numeros: (args: any) => any = (args) => ({ args });
vi.mock('../server/lib/agent/garde', () => ({
  resoudreNumeros: async (args: any) => numeros(args),
  PERMISSION_PAR_OUTIL: { mark_invoice_paid: { cle: 'invoices.update', capacite: 'les factures' }, assign_job: { cle: 'jobs.update', capacite: 'les jobs' } },
  executerOutilGarde: async () => ({ result: { ok: true } }),
}));
vi.mock('../server/lib/agent/tools', () => ({
  AGENT_TOOLS: [
    { kind: 'write', declaration: { name: 'mark_invoice_paid', description: 'Paie', parameters: { type: 'object', properties: {} } } },
    { kind: 'write', declaration: { name: 'assign_job', description: 'Assigne', parameters: { type: 'object', properties: {} } } },
  ],
  TOOLS_BY_NAME: {
    mark_invoice_paid: { kind: 'write', handler: async () => ({}) },
    assign_job: { kind: 'write', handler: async () => ({}) },
    // Seul cet outil porte sa déclaration : c'est elle que la carte doit respecter.
    create_job: { kind: 'write', handler: async () => ({}), declaration: { name: 'create_job', parameters: { type: 'object', properties: { title: { type: 'string' }, client_id: { type: 'string' } }, required: ['title'] } } },
  },
}));
vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => ({}) }));
let apercu: any = { genre: 'action', cibles: [], details: [] };
vi.mock('../server/lib/lumi/fiches', async (orig) => ({ ...(await orig() as object), apercuProposition: async () => apercu }));

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const tour = (emis: any[]) => ({
  client: {} as any, orgId: 'org-1', userId: 'user-1',
  systeme: [{ type: 'text' as const, text: 'sys' }],
  historique: [{ role: 'user' as const, content: 'x' }],
  emettre: (e: any) => emis.push(e), journaliser: async () => {},
});

beforeEach(() => {
  reponses.length = 0; envoyes.length = 0; streamSpy.mockClear();
  numeros = (args) => ({ args });
  apercu = { genre: 'action', cibles: [], details: [] };
  process.env.ANTHROPIC_API_KEY = 'sk-test';
});

describe('écriture sur une cible introuvable', () => {
  it('numéro inexistant (« facture 8888 ») : aucune carte, le modèle reçoit l’erreur et le dit', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    numeros = () => ({ erreur: 'Aucun(e) facture n° 8888 dans cette entreprise : vérifie le numéro avec l’utilisateur.' });
    reponses.push({ content: [{ type: 'tool_use', id: 'tu_1', name: 'mark_invoice_paid', input: { invoice_id: '8888', method: 'check' } }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Je ne trouve pas de facture 8888.' }], stop_reason: 'end_turn', usage });
    const emis: any[] = [];
    const r = await tourLumi(tour(emis));
    expect(r.proposition).toBeNull();
    expect(emis.some((e) => e.type === 'proposal')).toBe(false);
    const dernier = envoyes[1].messages[envoyes[1].messages.length - 1].content[0];
    expect(dernier).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1', is_error: true });
    expect(dernier.content).toContain('8888');
    expect(r.texte).toContain('Je ne trouve pas');
  });

  it('identifiant inventé (« kevin_bouchard ») signalé par l’aperçu : aucune carte', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    apercu = { genre: 'action', cibles: [{ libelle: { fr: 'Membre', en: 'Member' }, valeur: '« kevin_bouchard » ne correspond à aucune fiche', alerte: true }], details: [] };
    reponses.push({ content: [{ type: 'tool_use', id: 'tu_2', name: 'assign_job', input: { job_id: '11111111-1111-4111-8111-111111111111', assignee_user_id: 'kevin_bouchard' } }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Je ne trouve aucun Kevin Bouchard dans l’équipe.' }], stop_reason: 'end_turn', usage });
    const emis: any[] = [];
    const r = await tourLumi(tour(emis));
    expect(r.proposition).toBeNull();
    expect(emis.some((e) => e.type === 'proposal')).toBe(false);
    const dernier = envoyes[1].messages[envoyes[1].messages.length - 1].content[0];
    expect(dernier.is_error).toBe(true);
    expect(dernier.content).toContain('Membre');
    expect(dernier.content).toContain('invente jamais');
  });

  it('témoin : une cible qui existe donne bien une carte, avec son aperçu', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    apercu = { genre: 'action', cibles: [{ libelle: { fr: 'Facture', en: 'Invoice' }, valeur: 'INV-0007 · 459,90 $' }], details: [] };
    reponses.push({ content: [{ type: 'tool_use', id: 'tu_3', name: 'mark_invoice_paid', input: { invoice_id: '22222222-2222-4222-8222-222222222222' } }], stop_reason: 'tool_use', usage });
    const emis: any[] = [];
    const r = await tourLumi(tour(emis));
    expect(r.proposition).toMatchObject({ tool: 'mark_invoice_paid', tool_use_id: 'tu_3' });
    expect(emis.find((e) => e.type === 'proposal').apercu.cibles[0].valeur).toContain('INV-0007');
  });
});

describe('la carte montre ce qui s’exécutera', () => {
  it('un champ que l’outil ne déclare pas (« total_cents ») : aucune carte, le modèle doit reformuler', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'tu_4', name: 'create_job', input: { title: 'Lavage de vitres', total_cents: 24000 } }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Je reprends avec une ligne à 240 $.' }], stop_reason: 'end_turn', usage });
    const emis: any[] = [];
    const r = await tourLumi(tour(emis));
    expect(r.proposition).toBeNull();
    expect(emis.some((e) => e.type === 'proposal')).toBe(false);
    const dernier = envoyes[1].messages[envoyes[1].messages.length - 1].content[0];
    expect(dernier).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_4', is_error: true });
    expect(dernier.content).toContain('total_cents');
    expect(dernier.content).toContain('ignorés à l');
  });

  it('un paramètre requis manquant : aucune carte non plus', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'tu_5', name: 'create_job', input: { client_id: '33333333-3333-4333-8333-333333333333' } }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Quel titre pour ce job ?' }], stop_reason: 'end_turn', usage });
    const r = await tourLumi(tour([]));
    expect(r.proposition).toBeNull();
    expect(envoyes[1].messages[envoyes[1].messages.length - 1].content[0].content).toContain('Paramètres invalides');
  });

  it('témoin : des paramètres déclarés et complets donnent la carte', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'tu_6', name: 'create_job', input: { title: 'Lavage de vitres' } }], stop_reason: 'tool_use', usage });
    const r = await tourLumi(tour([]));
    expect(r.proposition).toMatchObject({ tool: 'create_job', args: { title: 'Lavage de vitres' } });
  });
});

describe('ciblesIntrouvables', () => {
  it('trouve les lignes en alerte où qu’elles soient dans l’aperçu', async () => {
    const { ciblesIntrouvables } = await import('../server/lib/lumi/apercu-action');
    expect(ciblesIntrouvables({ genre: 'action', cibles: [{ libelle: { fr: 'Client', en: 'Client' }, valeur: 'x', alerte: true }, { libelle: { fr: 'Job', en: 'Job' }, valeur: 'ok' }], details: [] })).toEqual(['Client']);
    expect(ciblesIntrouvables([{ a: { lignes: [{ libelle: { fr: 'Devis', en: 'Quote' }, valeur: 'x', alerte: true }] } }], 'en')).toEqual(['Quote']);
    expect(ciblesIntrouvables({ genre: 'action', cibles: [{ libelle: { fr: 'Job', en: 'Job' }, valeur: 'ok' }], details: [] })).toEqual([]);
    expect(ciblesIntrouvables(null)).toEqual([]);
  });
});

describe('action directe : le rôle d’abord', () => {
  it('pas de carte préparée par le code pour un outil que le rôle ne permet pas', () => {
    const src = readFileSync(resolve(__dirname, '../server/lib/lumi/actions-directes.ts'), 'utf8');
    const carte = src.slice(src.indexOf('    // Carte'));
    const garde = 'if (ctx.outilsPermis && !ctx.outilsPermis.has(a.tool)) return null;';
    expect(carte.indexOf(garde)).toBeGreaterThan(-1);
    expect(carte.indexOf(garde)).toBeLessThan(carte.indexOf('await resoudre(a, ctx);'));
    const route = readFileSync(resolve(__dirname, '../server/routes/lumi.ts'), 'utf8');
    expect(route.match(/repondreActionDirecte\([^\n]*outilsPermis: await outilsPermisDe\(ctx\.auth\.user\.id, ctx\.auth\.orgId\)/g)?.length).toBe(2);
  });
});
