/**
 * LUMI — le cache de la conversation tient d'un message à l'autre.
 *
 * Mesuré en prod le 2026-10-01 (lumi_traces, conversation de 11 tours) : l'écriture
 * en cache valait TOUTE la conversation à chaque tour (2 088 → 9 103 tokens), sauf
 * quand deux tours tombaient dans la même minute. Le bloc système variable portait
 * l'heure à la minute, les indices d'outils et le repérage ; il précède les
 * messages, donc chaque changement invalidait tout ce qui suit.
 *
 * Ce que ces tests figent :
 *   - le bloc système ne contient plus rien qui change à chaque message ;
 *   - l'heure, les indices et le repérage partent dans un bloc placé APRÈS le
 *     point de cache du dernier message ;
 *   - ce bloc n'est jamais sauvegardé dans l'historique ;
 *   - le préfixe envoyé au tour suivant est identique, bloc pour bloc, à ce qui
 *     a été mis en cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
const envoyes: any[] = [];
const streamSpy = vi.fn((params: any) => { envoyes.push(JSON.parse(JSON.stringify(params))); return fluxFactice(reponses.shift()); });
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { stream: streamSpy }; } }));
vi.mock('../server/lib/agent/garde', () => ({
  resoudreNumeros: async (args: any) => ({ args }),
  PERMISSION_PAR_OUTIL: { list_invoices: { cle: 'invoices.read', capacite: 'la consultation des factures' } },
  executerOutilGarde: async () => ({ result: { ok: true, lignes: [{ id: 'inv-1', total_cents: 100 }] } }),
}));
vi.mock('../server/lib/agent/tools', () => ({
  AGENT_TOOLS: [{ kind: 'read', declaration: { name: 'list_invoices', description: 'Liste', parameters: { type: 'object', properties: {} } } }],
  TOOLS_BY_NAME: { list_invoices: { kind: 'read', handler: async () => ({}) } },
}));
vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => ({}) }));

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const base = (historique: any[], contexteTour: string) => ({
  client: {} as any, orgId: 'org-1', userId: 'user-1',
  systeme: [{ type: 'text' as const, text: 'stable' }, { type: 'text' as const, text: 'variable' }],
  historique, contexteTour,
  emettre: () => {}, journaliser: async () => {},
});
const blocsDe = (m: any) => (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content);
const sansCache = (b: any) => { const { cache_control, ...reste } = b; return reste; };

beforeEach(() => { reponses.length = 0; envoyes.length = 0; streamSpy.mockClear(); process.env.ANTHROPIC_API_KEY = 'sk-test'; });

describe('avecContexteDuTour', () => {
  it('ajoute le contexte en DERNIER bloc, après le point de cache', async () => {
    const { avecCacheConversation, avecContexteDuTour } = await import('../server/lib/lumi/orchestrateur');
    const r = avecContexteDuTour(avecCacheConversation([{ role: 'user', content: 'Mes factures ?' }]), 'Heure actuelle : 14 h 32.');
    const blocs = blocsDe(r[0]);
    expect(blocs).toHaveLength(2);
    expect(blocs[0]).toMatchObject({ type: 'text', text: 'Mes factures ?', cache_control: { type: 'ephemeral' } });
    expect(blocs[1].text).toContain('<contexte_du_tour>');
    expect(blocs[1].text).toContain('14 h 32');
    expect(blocs[1].cache_control).toBeUndefined();
  });

  it('après des résultats d’outils aussi (le texte suit les tool_result)', async () => {
    const { avecCacheConversation, avecContexteDuTour } = await import('../server/lib/lumi/orchestrateur');
    const msgs: any[] = [
      { role: 'user', content: 'Mes factures ?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'list_invoices', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] },
    ];
    const r = avecContexteDuTour(avecCacheConversation(msgs), 'ctx');
    expect(blocsDe(r[2]).map((b: any) => b.type)).toEqual(['tool_result', 'text']);
    expect(blocsDe(r[0])).toHaveLength(1); // le message d'origine du tour ne porte plus le contexte
  });

  it('sans contexte, ou si le dernier message est de Lumi : inchangé ; l’entrée n’est jamais modifiée', async () => {
    const { avecContexteDuTour } = await import('../server/lib/lumi/orchestrateur');
    const msgs: any[] = [{ role: 'user', content: 'Bonjour' }];
    expect(avecContexteDuTour(msgs, '')).toBe(msgs);
    expect(avecContexteDuTour(msgs, null)).toBe(msgs);
    const finLumi: any[] = [{ role: 'user', content: 'a' }, { role: 'assistant', content: [{ type: 'text', text: 'b' }] }];
    expect(avecContexteDuTour(finLumi, 'ctx')).toBe(finLumi);
    avecContexteDuTour(msgs, 'ctx');
    expect(msgs).toEqual([{ role: 'user', content: 'Bonjour' }]);
  });
});

describe('tour de Lumi avec contexte', () => {
  it('le contexte suit le DERNIER message à chaque appel et n’entre jamais dans l’historique', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ content: [{ type: 'tool_use', id: 'tu_1', name: 'list_invoices', input: {} }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Une facture en retard.' }], stop_reason: 'end_turn', usage });
    const r = await tourLumi(base([{ role: 'user', content: 'Mes factures en retard ?' }], 'Heure actuelle : 14 h 32.'));

    // Appel 1 : [texte + point de cache, contexte].
    const m1 = envoyes[0].messages;
    expect(blocsDe(m1[0]).map((b: any) => !!b.cache_control)).toEqual([true, false]);
    // Appel 2 : le message d'origine n'a plus le contexte ; il suit les résultats d'outils.
    const m2 = envoyes[1].messages;
    expect(blocsDe(m2[0])).toHaveLength(1);
    expect(blocsDe(m2[2]).map((b: any) => b.type)).toEqual(['tool_result', 'text']);
    expect(blocsDe(m2[2])[1].text).toContain('14 h 32');
    // Rien du contexte dans ce qui sera sauvegardé.
    expect(JSON.stringify(r.nouveauxMessages)).not.toContain('contexte_du_tour');
  });

  it('au tour SUIVANT, le préfixe est identique bloc pour bloc à ce qui a été mis en cache', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    const q1 = { role: 'user' as const, content: 'Mes factures en retard ?' };
    reponses.push({ content: [{ type: 'tool_use', id: 'tu_1', name: 'list_invoices', input: {} }], stop_reason: 'tool_use', usage });
    reponses.push({ content: [{ type: 'text', text: 'Une facture en retard.' }], stop_reason: 'end_turn', usage });
    const t1 = await tourLumi(base([q1], 'Heure actuelle : 14 h 32.'));
    const dernierAppelTour1 = envoyes[envoyes.length - 1].messages;

    // Tour 2, trois minutes plus tard : l'heure a changé, l'historique est celui de la base.
    reponses.push({ content: [{ type: 'text', text: 'De rien.' }], stop_reason: 'end_turn', usage });
    await tourLumi(base([q1, ...t1.nouveauxMessages, { role: 'user', content: 'Merci' }], 'Heure actuelle : 14 h 35.'));
    const appelTour2 = envoyes[envoyes.length - 1].messages;

    // Tout ce que le dernier appel du tour 1 a mis en cache (jusqu'à son point de
    // cache, donc SANS le bloc de contexte) se retrouve tel quel au début du tour 2.
    const aplatir = (msgs: any[]) => msgs.flatMap((m) => blocsDe(m).map((b: any) => ({ role: m.role, ...sansCache(b) })));
    const cacheTour1 = aplatir(dernierAppelTour1).filter((b: any) => !(b.type === 'text' && String(b.text).includes('contexte_du_tour')));
    const debutTour2 = aplatir(appelTour2).slice(0, cacheTour1.length);
    expect(debutTour2).toEqual(cacheTour1);
    // Et le système est le même aux deux tours : plus rien n'y change d'une minute à l'autre.
    expect(envoyes[envoyes.length - 1].system).toEqual(envoyes[0].system);
  });
});

describe('le temps donné à Lumi', () => {
  it('le JOUR du bloc système ne change pas d’une minute à l’autre ; l’HEURE, si', async () => {
    const { jourPourLumi, heurePourLumi } = await import('../server/lib/lumi/temps');
    const a = new Date('2026-10-01T18:32:00Z'), b = new Date('2026-10-01T18:47:00Z');
    expect(jourPourLumi('America/Toronto', 'fr', a)).toBe(jourPourLumi('America/Toronto', 'fr', b));
    expect(jourPourLumi('America/Toronto', 'fr', a)).toContain('2026-10-01');
    expect(jourPourLumi('America/Toronto', 'fr', a)).toContain('UTC-04:00');
    expect(jourPourLumi('America/Toronto', 'fr', a)).not.toMatch(/14 h 32|14:32/);
    expect(heurePourLumi('America/Toronto', 'fr', a)).toContain('14 h 32');
    expect(heurePourLumi('America/Toronto', 'fr', a)).not.toBe(heurePourLumi('America/Toronto', 'fr', b));
    // Le jour reste celui de l'ENTREPRISE : 22 h à Toronto, déjà le lendemain en UTC.
    expect(jourPourLumi('America/Toronto', 'fr', new Date('2026-10-02T02:00:00Z'))).toContain('2026-10-01');
  });

  it('branchement : la route met le jour dans le système et le reste dans le contexte du tour', () => {
    const route = readFileSync(resolve(__dirname, '../server/routes/lumi.ts'), 'utf8');
    expect(route).toContain('todayIso: jourPourLumi(fuseau, language)');
    expect(route).toContain('contexteTour: [');
    expect(route).toContain('heurePourLumi(ctx.fuseau, ctx.language)');
    // Les indices d'outils et le repérage ne retournent pas dans le bloc système.
    const systeme = route.slice(route.indexOf('systeme: opts.sousAgent'), route.indexOf('contexteTour: ['));
    expect(systeme).not.toContain('indiceOutils');
    expect(systeme).not.toContain('reperage');
  });
});
