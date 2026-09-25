/**
 * Maintien du cache 1 h de Lumi : on pinge seulement dans la foulée d'une
 * activité réelle, jamais dans le vide, et le ping vise exactement le préfixe
 * des vrais appels (même bloc stable, mêmes outils).
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../server/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { doitPinger, fenetreMaintienMs, pingerCache, DELAI_RAFRAICHISSEMENT_MS, signalerAppelLumi, prefixesSuivis, MAX_PREFIXES_CHAUDS } from '../server/lib/lumi/cache-chaud';
import { outilsClaude, promptSystemeLumi } from '../server/lib/lumi/orchestrateur';

const MIN = 60_000;
const T0 = 10 * MIN; // instant du dernier appel réel (0 = « jamais »)
const fenetreMs = 120 * MIN;

describe('doitPinger', () => {
  it('aucun appel réel → jamais', () => {
    expect(doitPinger({ dernierAppelReel: 0, dernierPing: 0, maintenant: T0 + 50 * MIN, fenetreMs })).toBe(false);
  });
  it('moins de 50 min après un appel réel → non (le cache est encore chaud)', () => {
    expect(doitPinger({ dernierAppelReel: T0, dernierPing: 0, maintenant: T0 + 49 * MIN, fenetreMs })).toBe(false);
  });
  it('50 min après l appel réel → oui ; 50 min après le ping → encore oui', () => {
    expect(doitPinger({ dernierAppelReel: T0, dernierPing: 0, maintenant: T0 + 50 * MIN, fenetreMs })).toBe(true);
    expect(doitPinger({ dernierAppelReel: T0, dernierPing: T0 + 50 * MIN, maintenant: T0 + 60 * MIN, fenetreMs })).toBe(false);
    expect(doitPinger({ dernierAppelReel: T0, dernierPing: T0 + 50 * MIN, maintenant: T0 + 100 * MIN, fenetreMs })).toBe(true);
  });
  it('au-delà de la fenêtre → on laisse expirer (pas de ping dans le vide)', () => {
    expect(doitPinger({ dernierAppelReel: T0, dernierPing: T0 + 100 * MIN, maintenant: T0 + 150 * MIN, fenetreMs })).toBe(false);
  });
  it('fenêtre 0 → désactivé', () => {
    expect(doitPinger({ dernierAppelReel: T0, dernierPing: 0, maintenant: T0 + 50 * MIN, fenetreMs: 0 })).toBe(false);
  });
  it('DELAI_RAFRAICHISSEMENT_MS est sous le TTL d une heure', () => {
    expect(DELAI_RAFRAICHISSEMENT_MS).toBeLessThan(60 * MIN);
  });
});

describe('fenetreMaintienMs', () => {
  // 12 h depuis le 2026-09-22 : mesuré en prod, au-delà d'une heure sans
  // appel le cache est froid à 100 % (5,25 ¢ le tour contre 2,06 ¢), et une
  // fenêtre de 2 h ne couvrait pas la personne qui revient après le dîner.
  it('défaut 720 min (12 h), valeur lue, 0 désactive, valeur absurde → défaut', () => {
    expect(fenetreMaintienMs({})).toBe(720 * MIN);
    expect(fenetreMaintienMs({ LUMI_CACHE_CHAUD_MINUTES: '30' })).toBe(30 * MIN);
    expect(fenetreMaintienMs({ LUMI_CACHE_CHAUD_MINUTES: '0' })).toBe(0);
    expect(fenetreMaintienMs({ LUMI_CACHE_CHAUD_MINUTES: 'abc' })).toBe(720 * MIN);
  });
});

describe('pingerCache', () => {
  it('vise le même préfixe qu un vrai tour : bloc stable identique, mêmes outils, sortie minuscule', async () => {
    let params: any = null;
    const client = { messages: { create: async (p: any) => { params = p; return { usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 6700, cache_creation_input_tokens: 0 } } as any; } } };
    const r = await pingerCache(client, 'claude-sonnet-5');
    const reel = promptSystemeLumi({ companyName: 'Coquin lavage', userName: 'Will', language: 'fr', todayIso: '2026-09-16' });
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.system[0]).toEqual(reel[0]);              // bloc stable + point de cache 1 h
    expect(params.tools).toEqual(outilsClaude());           // même ordre, même point de cache
    // `max_tokens: 0` depuis le 2026-09-22 : l'API fait le prefill (donc écrit
    // le cache) et rend `content: []` sans facturer de sortie. Vérifié contre
    // la vraie API : écrit 5 762 tokens, sortie 0, relus au tour suivant.
    expect(params.max_tokens).toBe(0);
    // NI `thinking` NI `output_config` : ils ne font pas partie du préfixe mis
    // en cache (seuls `tools` et `system` comptent), donc les omettre ne change
    // rien à l'entrée écrite — et `max_tokens: 0` est refusé avec certaines de
    // leurs combinaisons. Un réchauffement n'a pas à réfléchir.
    expect(params.thinking).toBeUndefined();
    expect(params.output_config).toBeUndefined();
    expect(r.cache_lu).toBe(6700);
    expect(r.cost_cents).toBeGreaterThan(0);
    expect(r.cost_cents).toBeLessThan(0.3);
  });
});

describe('signalerAppelLumi : un préfixe par jeu d outils', () => {
  it('suit le jeu de base et chaque sous-agent séparément, jamais plus de MAX_PREFIXES_CHAUDS', () => {
    const p = (n: string) => ({ systeme: [{ type: 'text' as const, text: n }], outils: [] });
    signalerAppelLumi('claude-sonnet-5', p('base'), 'base');
    signalerAppelLumi('claude-sonnet-5', p('facturation'), 'facturation');
    expect([...prefixesSuivis().keys()]).toEqual(['base', 'facturation']);
    for (let i = 0; i < MAX_PREFIXES_CHAUDS + 3; i++) signalerAppelLumi('claude-sonnet-5', p(`t${i}`), `t${i}`);
    expect(prefixesSuivis().size).toBe(MAX_PREFIXES_CHAUDS);
    expect(prefixesSuivis().has('base')).toBe(false); // le plus ancien est parti
  });
});

/**
 * Traçabilité des appels d'ENTRETIEN (2026-09-22).
 *
 * Le préchauffage et le réchauffement sont facturés et n'ont aucun
 * utilisateur derrière. Sans trace en base, la seule façon de savoir s'ils
 * tournent est de lire les journaux Railway — c'est exactement ce qui avait
 * rendu `cache-chaud` invisible jusqu'à l'audit du 2026-09-18.
 */
describe('les appels d entretien laissent une trace', () => {
  it('le code trace le préchauffage ET le réchauffement', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('server/lib/lumi/cache-chaud.ts', 'utf8'));
    expect(src).toMatch(/tracerEntretien\('prechauffage'/);
    expect(src).toMatch(/tracerEntretien\('rechauffement'/);
  });

  it('la trace passe par un canal accepté, sans org (appel de plateforme)', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('server/lib/lumi/cache-chaud.ts', 'utf8'));
    const fn = src.slice(src.indexOf('async function tracerEntretien'), src.indexOf('export async function prechaufferCache'));
    // `canal: 'lumi'` : la contrainte CHECK de lumi_traces refuse tout nouveau
    // canal (23514 vérifié en base) — pas de migration pour de la traçabilité.
    expect(fn).toMatch(/canal: 'lumi'/);
    expect(fn).toMatch(/orgId: null/);
  });

  it('une trace qui échoue n empêche JAMAIS le serveur de démarrer', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('server/lib/lumi/cache-chaud.ts', 'utf8'));
    const fn = src.slice(src.indexOf('async function tracerEntretien'), src.indexOf('export async function prechaufferCache'));
    expect(fn).toMatch(/catch\s*\{/);
  });
});
