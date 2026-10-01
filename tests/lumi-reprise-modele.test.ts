/**
 * Une erreur passagère du modèle se reprend ; elle ne fait plus tomber le tour.
 *
 * Passe d'évaluation du 2026-10-01 (221 demandes, 5 tours simultanés) : 4 tours
 * ont fini en « Lumi failed to respond ». La réservation de budget avait
 * réussi, puis le flux du modèle a échoué en moins d'une seconde ; rien n'était
 * retenté et la réservation restait ouverte jusqu'au balayage. Rejouées à
 * froid, les mêmes demandes passaient.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.LUMI_REPRISE_MODELE_MS = '0,0';

const reponses: any[] = [];
const streamSpy = vi.fn(() => {
  const r = reponses.shift();
  const handlers: Record<string, (...a: any[]) => void> = {};
  return {
    on(ev: string, fn: (...a: any[]) => void) { handlers[ev] = fn; return this; },
    async finalMessage() {
      for (const t of r.textesAvant ?? []) handlers.text?.(t, t);
      if (r.erreur) throw r.erreur;
      for (const b of r.content) if (b.type === 'text' && handlers.text) handlers.text(b.text, b.text);
      return r;
    },
  };
});
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { stream: streamSpy }; } }));
vi.mock('../server/lib/supabase', () => ({ companyOrgIds: async (_a: unknown, o: string) => [o], getServiceClient: () => ({ rpc: async () => ({ data: false }) }) }));
vi.mock('../server/lib/agent/garde', () => ({
  resoudreNumeros: async (args: any) => ({ args }),
  PERMISSION_PAR_OUTIL: { list_invoices: { cle: 'invoices.read', capacite: 'la consultation des factures' } },
  executerOutilGarde: async () => ({ result: { ok: true } }),
}));
vi.mock('../server/lib/agent/tools', () => ({
  AGENT_TOOLS: [{ kind: 'read', declaration: { name: 'list_invoices', description: 'Liste', parameters: { type: 'object', properties: {} } } }],
  TOOLS_BY_NAME: { list_invoices: { kind: 'read', handler: async () => ({}) } },
}));

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const ok = (texte: string) => ({ content: [{ type: 'text', text: texte }], stop_reason: 'end_turn', usage });
const surcharge = () => ({ erreur: Object.assign(new Error('Overloaded'), { status: 529, error: { type: 'error', error: { type: 'overloaded_error' } } }) });

function tour(emis: any[], regles: Array<[string | null, number]>) {
  return {
    client: {} as any, orgId: 'org-1', userId: 'user-1',
    systeme: [{ type: 'text' as const, text: 'sys' }],
    historique: [{ role: 'user' as const, content: 'Bonjour' }],
    emettre: (e: any) => emis.push(e),
    journaliser: async () => {},
    budget: { reserver: async () => ({ id: 'res-1', statut: 'ok' as const }), regler: async (id: string | null, c: number) => { regles.push([id, c]); } },
  };
}

beforeEach(() => { reponses.length = 0; streamSpy.mockClear(); process.env.ANTHROPIC_API_KEY = 'sk-test'; });

describe('erreurPassagereDuModele', () => {
  it('surcharge, débit, erreurs serveur, coupure : oui ; requête invalide, clé, droit, trop gros : non', async () => {
    const { erreurPassagereDuModele } = await import('../server/lib/lumi/orchestrateur');
    for (const e of [{ status: 529 }, { status: 429 }, { status: 500 }, { status: 503 }, { status: 408 }, { error: { type: 'error', error: { type: 'overloaded_error' } } }, { name: 'APIConnectionError' }, { name: 'APIConnectionTimeoutError' }, new Error('fetch failed'), new Error('socket hang up')])
      expect(erreurPassagereDuModele(e), JSON.stringify(e)).toBe(true);
    for (const e of [{ status: 400 }, { status: 401 }, { status: 403 }, { status: 404 }, { status: 413 }, new Error('messages.3: tool_result sans tool_use'), null, undefined])
      expect(erreurPassagereDuModele(e), JSON.stringify(e)).toBe(false);
  });
});

describe('reprise de l’appel au modèle', () => {
  it('surcharge puis succès : le tour répond, sans erreur à l’écran, et la reprise est comptée', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push(surcharge(), ok('Trois factures en retard.'));
    const emis: any[] = [], regles: Array<[string | null, number]> = [];
    const r = await tourLumi(tour(emis, regles));
    expect(r.texte).toBe('Trois factures en retard.');
    expect(emis.some((e) => e.type === 'error')).toBe(false);
    expect(streamSpy).toHaveBeenCalledTimes(2);
    expect(r.reprises_modele).toBe(1);
    // Une seule réservation, réglée une fois, au coût réel.
    expect(regles).toHaveLength(1);
    expect(regles[0][1]).toBeGreaterThan(0);
  });

  it('deux reprises au plus : à la troisième erreur le tour échoue et la réservation est rendue (coût 0)', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push(surcharge(), surcharge(), surcharge());
    const regles: Array<[string | null, number]> = [];
    await expect(tourLumi(tour([], regles))).rejects.toThrow('Overloaded');
    expect(streamSpy).toHaveBeenCalledTimes(3);
    expect(regles).toEqual([['res-1', 0]]);
  });

  it('requête invalide (400) : aucune reprise — elle reviendrait à l’identique', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ erreur: Object.assign(new Error('invalid_request_error'), { status: 400 }) });
    const regles: Array<[string | null, number]> = [];
    await expect(tourLumi(tour([], regles))).rejects.toThrow('invalid_request_error');
    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(regles).toEqual([['res-1', 0]]);
  });

  it('du texte déjà parti à l’écran : pas de reprise (l’utilisateur le lirait deux fois)', async () => {
    const { tourLumi } = await import('../server/lib/lumi/orchestrateur');
    reponses.push({ textesAvant: ['Voici tes fac'], ...surcharge() }, ok('ne doit pas être appelé'));
    const emis: any[] = [];
    await expect(tourLumi(tour(emis, []))).rejects.toThrow('Overloaded');
    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(emis.filter((e) => e.type === 'text').map((e) => e.delta).join('')).toBe('Voici tes fac');
  });
});
